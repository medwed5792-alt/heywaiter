export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import type { ServiceRole } from "@/lib/types";
import { LPR_ROLES } from "@/lib/types";
import { IS_GEO_DEBUG } from "@/lib/geo";

const TELEGRAM_API = "https://api.telegram.org/bot";

type RequestType = "call_waiter" | "request_bill";

/**
 * Для каждого staffId (id документа staff) получает Telegram ID для отправки:
 * Global ID -> global_users[userId].identities.tg, иначе staff.tgId.
 */
async function getTelegramIdsForStaff(
  firestore: Firestore,
  staffIds: string[]
): Promise<Set<string>> {
  const tgIds = new Set<string>();
  for (const sid of staffIds) {
    const staffSnap = await firestore.collection("staff").doc(sid).get();
    if (!staffSnap.exists) continue;
    const staffData = staffSnap.data() ?? {};
    const userId = (staffData.userId as string) || sid;
    let tgId: string | null = (staffData.tgId as string) || (staffData.identity as { externalId?: string })?.externalId || null;
    const globalSnap = await firestore.collection("global_users").doc(userId).get();
    if (globalSnap.exists) {
      const globalData = globalSnap.data() ?? {};
      const identities = globalData.identities as { tg?: string } | undefined;
      if (identities?.tg) tgId = identities.tg;
    }
    if (tgId && tgId.trim()) tgIds.add(tgId.trim());
  }
  return tgIds;
}

async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram API: ${res.status} ${err}`);
  }
}

/**
 * POST /api/notifications/call-waiter
 * Умная маршрутизация: находит всех сотрудников venueId с onShift === true,
 * для каждого берёт Global ID и identities.tg, отправляет уведомление в Telegram
 * через Staff Bot (@waitertalk_bot). Сообщение содержит номер стола (параметр t).
 * Тело: venueId, tableId, type?: "call_waiter" | "request_bill", visitorId?
 * При IS_GEO_DEBUG серверная проверка координат не выполняется — вызов принимается из любой точки.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const venueId = (body.venueId as string)?.trim();
    const tableId = (body.tableId as string)?.trim();
    const visitorId = (body.visitorId as string)?.trim() ?? undefined;
    const requestType = ((body.type as string) || "call_waiter") as RequestType;
    const isRequestBill = requestType === "request_bill";

    if (!venueId || !tableId) {
      return NextResponse.json(
        { ok: false, error: "venueId и tableId обязательны" },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();

    const baseMessage = isRequestBill
      ? `Запрос счёта, стол №${tableId}`
      : `Вызов официанта, стол №${tableId}`;

    const waiterId = await getOperationalWaiterForTable(firestore, venueId, tableId);
    const waiterOnShift = waiterId ? await isStaffOnShift(firestore, waiterId, venueId) : false;

    let targetUids: string[];
    let message: string;
    let notificationType: string;
    let isOrphan: boolean;

    if (waiterId && waiterOnShift) {
      targetUids = [waiterId];
      message = baseMessage;
      notificationType = isRequestBill ? "request_bill" : "role_call";
      isOrphan = false;
    } else {
      targetUids = await getLprStaffIds(firestore, venueId);
      message = `⚠️ SOS: Вызов со стола без ответственного! ${baseMessage}`;
      notificationType = "orphan_call";
      isOrphan = true;
    }

    const tgIds = await getTelegramIdsForStaff(firestore, targetUids);
    const { getBotTokenFromStore } = await import("@/lib/webhook/bots-store");
    const token =
      (await getBotTokenFromStore("telegram", "staff")) ||
      process.env.TELEGRAM_STAFF_TOKEN;
    if (token && tgIds.size > 0) {
      for (const chatId of tgIds) {
        try {
          await sendTelegramMessage(token, chatId, message);
        } catch (err) {
          console.error("[call-waiter] Telegram send to", chatId, err);
        }
      }
    }

    await firestore.collection("staffNotifications").add({
      venueId,
      tableId,
      sessionId: null,
      type: notificationType,
      role: "waiter" as ServiceRole,
      message,
      read: false,
      targetUids,
      ...(isOrphan && { orphanTable: true }),
      ...(visitorId && { visitorId }),
      createdAt: new Date(),
    });

    return NextResponse.json({ ok: true, message: "Вызов отправлен" });
  } catch (err) {
    console.error("[call-waiter]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}

async function isStaffOnShift(
  firestore: Firestore,
  staffId: string,
  venueId: string
): Promise<boolean> {
  const snap = await firestore.collection("staff").doc(staffId).get();
  if (!snap.exists) return false;
  const d = snap.data();
  return (d?.venueId === venueId && d?.onShift === true) || false;
}

/** Ответственный за стол: waiterId из документа стола (коллекция tables / venues/.../tables). */
async function getOperationalWaiterForTable(
  firestore: Firestore,
  venueId: string,
  tableId: string
): Promise<string | null> {
  const tableRef = firestore.collection("venues").doc(venueId).collection("tables").doc(tableId);
  const tableSnap = await tableRef.get();
  if (!tableSnap.exists) return null;
  const data = tableSnap.data() ?? {};
  const assignments = data.assignments as Record<string, string> | undefined;
  return (data.waiterId as string) ?? assignments?.waiter ?? (data.assignedStaffId as string) ?? null;
}

/** Сотрудники, у которых этот стол закреплён в Команде (assignedTableIds). Только официанты и ЛПР. */
async function getNativeStaffIdsForTable(
  firestore: Firestore,
  venueId: string,
  tableId: string
): Promise<string[]> {
  const snap = await firestore
    .collection("staff")
    .where("venueId", "==", venueId)
    .where("active", "==", true)
    .where("assignedTableIds", "array-contains", tableId)
    .get();
  const ids: string[] = [];
  snap.docs.forEach((d) => {
    const data = d.data();
    const position = (data.position as string) ?? (data.serviceRole as string) ?? (data.role as string) ?? "";
    const isWaiter = position === "waiter" || (data.role as string) === "waiter";
    const isLpr = position && LPR_ROLES.includes(position as ServiceRole);
    if (isWaiter || isLpr) ids.push(d.id);
  });
  return ids;
}

async function getLprStaffIds(
  firestore: Firestore,
  venueId: string
): Promise<string[]> {
  const snap = await firestore
    .collection("staff")
    .where("venueId", "==", venueId)
    .where("active", "==", true)
    .where("onShift", "==", true)
    .get();
  const ids: string[] = [];
  snap.docs.forEach((d) => {
    const data = d.data();
    const role = (data.position as string) ?? (data.serviceRole as string) ?? (data.role as string);
    if (role && LPR_ROLES.includes(role as ServiceRole)) ids.push(d.id);
  });
  return ids;
}

