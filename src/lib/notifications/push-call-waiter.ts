/**
 * Серверная отправка Telegram-уведомлений официанту / ЛПР (Staff Bot).
 * Используется API route и createGuestEvent в Node-контексте.
 */
import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import type { ServiceRole } from "@/lib/types";
import { LPR_ROLES } from "@/lib/types";
import { getWaiterIdFromTablePayload } from "@/lib/standards/table-waiter";

const TELEGRAM_API = "https://api.telegram.org/bot";

export type PushCallWaiterType = "call_waiter" | "request_bill" | "sos";

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
    let tgId: string | null =
      (staffData.tgId as string) || (staffData.identity as { externalId?: string })?.externalId || null;
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

async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  withQuickOk: boolean
): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (withQuickOk) {
    body.reply_markup = {
      inline_keyboard: [[{ text: "✅ ОК", callback_data: "read_notify" }]],
    };
  }
  const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram API: ${res.status} ${err}`);
  }
}

/** ID официанта со стола — та же логика, что getWaiterIdFromTablePayload. */
export async function getOperationalWaiterForTable(
  firestore: Firestore,
  venueId: string,
  tableId: string
): Promise<string | null> {
  const tableRef = firestore.collection("venues").doc(venueId).collection("tables").doc(tableId);
  const tableSnap = await tableRef.get();
  if (!tableSnap.exists) return null;
  return getWaiterIdFromTablePayload(tableSnap.data() as Record<string, unknown>);
}

async function getLprStaffIds(firestore: Firestore, venueId: string): Promise<string[]> {
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

export interface PushCallWaiterInput {
  venueId: string;
  tableId: string;
  visitorId?: string;
  type?: PushCallWaiterType;
}

/**
 * Если за столом закреплён официант — уведомление уходит ему (без проверки onShift).
 * Иначе — fan-out на ЛПР на смене (как «безхозный» вызов).
 */
export async function pushCallWaiterNotification(input: PushCallWaiterInput): Promise<{
  ok: boolean;
  targetUids: string[];
  isOrphan: boolean;
}> {
  const venueId = input.venueId?.trim();
  const tableId = input.tableId?.trim();
  if (!venueId || !tableId) {
    return { ok: false, targetUids: [], isOrphan: true };
  }

  const requestType = input.type ?? "call_waiter";
  const isRequestBill = requestType === "request_bill";
  const isSos = requestType === "sos";

  const baseMessage = isRequestBill
    ? `🔔 Стол №${tableId}: Счёт.`
    : isSos
      ? `🆘 SOS: стол №${tableId}.`
      : `🔔 Стол №${tableId}: Вызов.`;

  const firestore = getAdminFirestore();
  const waiterId = await getOperationalWaiterForTable(firestore, venueId, tableId);

  let targetUids: string[];
  let message: string;
  let notificationType: string;
  let isOrphan: boolean;
  const isRegularCall = !isRequestBill && !isSos;

  if (waiterId) {
    targetUids = [waiterId];
    message = baseMessage;
    notificationType = isRequestBill ? "request_bill" : isSos ? "sos" : "role_call";
    isOrphan = false;
  } else {
    targetUids = await getLprStaffIds(firestore, venueId);
    message = `⚠️ Без закрепления: ${baseMessage}`;
    notificationType = "orphan_call";
    isOrphan = true;
  }

  const tgIds = await getTelegramIdsForStaff(firestore, targetUids);
  const { getBotTokenFromStore } = await import("@/lib/webhook/bots-store");
  const token =
    (await getBotTokenFromStore("telegram", "staff")) || process.env.TELEGRAM_STAFF_TOKEN;
  if (token && tgIds.size > 0) {
    for (const chatId of tgIds) {
      try {
        await sendTelegramMessage(token, chatId, message, isRegularCall);
      } catch (err) {
        console.error("[push-call-waiter] Telegram send to", chatId, err);
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
    ...(input.visitorId && { visitorId: input.visitorId }),
    createdAt: new Date(),
  });

  return { ok: true, targetUids, isOrphan };
}
