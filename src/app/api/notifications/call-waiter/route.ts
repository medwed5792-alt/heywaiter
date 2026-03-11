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

    const assignedId = await getAssignedStaffForTable(firestore, venueId, tableId, "waiter");
    const assignedOnShift = assignedId
      ? await isStaffOnShift(firestore, assignedId, venueId)
      : false;

    const waiterIds = await getStaffIdsByRoleOnShift(firestore, venueId, "waiter");
    const lprIds = await getLprStaffIds(firestore, venueId);

    const rawTargetUids = Array.from(
      new Set([
        ...(assignedOnShift && assignedId ? [assignedId] : []),
        ...waiterIds,
        ...lprIds,
      ])
    );

    const targetUids: string[] = [];
    for (const id of rawTargetUids) {
      const onShift = await isStaffOnShift(firestore, id, venueId);
      if (onShift) targetUids.push(id);
    }

    const message = isRequestBill
      ? `Запрос счёта, стол №${tableId}`
      : `Вызов официанта, стол №${tableId}`;

    const tgIds = await getTelegramIdsForStaff(firestore, targetUids);
    // Только Staff Bot: Firestore (tg_staff_token) → env TELEGRAM_STAFF_TOKEN. Клиентский токен не используем.
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
      type: isRequestBill ? "request_bill" : "role_call",
      role: "waiter" as ServiceRole,
      message,
      read: false,
      targetUids,
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

async function getAssignedStaffForTable(
  firestore: Firestore,
  venueId: string,
  tableId: string,
  role: ServiceRole
): Promise<string | null> {
  const snap = await firestore
    .collection("activeSessions")
    .where("venueId", "==", venueId)
    .where("tableId", "==", tableId)
    .where("status", "==", "check_in_success")
    .limit(1)
    .get();
  const doc = snap.docs[0];
  if (!doc?.exists) return null;
  const assignments = doc.data()?.assignments as Record<string, string> | undefined;
  return assignments?.[role] ?? null;
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
    const role = d.data().serviceRole as ServiceRole | undefined;
    if (role && LPR_ROLES.includes(role)) ids.push(d.id);
  });
  return ids;
}

async function getStaffIdsByRoleOnShift(
  firestore: Firestore,
  venueId: string,
  role: ServiceRole
): Promise<string[]> {
  const snap = await firestore
    .collection("staff")
    .where("venueId", "==", venueId)
    .where("active", "==", true)
    .where("onShift", "==", true)
    .where("serviceRole", "==", role)
    .get();
  return snap.docs.map((d) => d.id);
}
