/**
 * Серверная отправка Telegram-уведомлений официанту / ЛПР (Staff Bot).
 * Используется API route и createGuestEvent в Node-контексте.
 */
import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import type { ServiceRole } from "@/lib/types";
import { LPR_ROLES } from "@/lib/types";
import { getWaiterIdFromTablePayload } from "@/lib/standards/table-waiter";
import { sendMessage } from "@/adapters/telegram/telegramApi";
import { resolveStaffFirestoreIdToGlobalUser } from "@/lib/identity/global-user-staff-bridge";

async function getTelegramIdsForStaff(
  firestore: Firestore,
  venueId: string,
  staffIds: string[]
): Promise<Set<string>> {
  const vid = venueId.trim();
  const tgIds = new Set<string>();
  for (const sid of staffIds) {
    const resolved = vid ? await resolveStaffFirestoreIdToGlobalUser(firestore, sid, vid) : null;
    if (!resolved) continue;
    const globalSnap = await firestore.collection("global_users").doc(resolved.globalUserId).get();
    if (!globalSnap.exists) continue;
    const globalData = globalSnap.data() ?? {};
    const identities = globalData.identities as { tg?: string } | undefined;
    const tgId = identities?.tg?.trim();
    if (tgId) tgIds.add(tgId);
  }
  return tgIds;
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
  const vid = venueId.trim();
  if (!vid) return [];
  const snap = await firestore
    .collection("global_users")
    .where("staffVenueOnShift", "array-contains", vid)
    .get();
  const ids: string[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    const aff = Array.isArray(data.affiliations) ? data.affiliations : [];
    const row = aff.find((a: { venueId?: string }) => a?.venueId === vid);
    const role = (row?.role as string) ?? (row?.position as string) ?? "";
    if (role && LPR_ROLES.includes(role as ServiceRole)) ids.push(`${vid}_${d.id}`);
  }
  return ids;
}

export interface PushCallWaiterInput {
  venueId: string;
  tableId: string;
  customerUid?: string;
}

function callWaiterMessage(tableId: string): string {
  return `🔔 Стол №${tableId}: Вызов официанта`;
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

  const baseMessage = callWaiterMessage(tableId);

  const firestore = getAdminFirestore();
  const waiterId = await getOperationalWaiterForTable(firestore, venueId, tableId);

  let targetUids: string[];
  let message: string;
  let notificationType: string;
  let isOrphan: boolean;

  if (waiterId) {
    targetUids = [waiterId];
    message = baseMessage;
    notificationType = "call_waiter";
    isOrphan = false;
  } else {
    targetUids = await getLprStaffIds(firestore, venueId);
    message = baseMessage;
    notificationType = "orphan_call";
    isOrphan = true;
  }

  const tgIds = await getTelegramIdsForStaff(firestore, venueId, targetUids);
  const { getBotTokenFromStore } = await import("@/lib/webhook/bots-store");
  const token =
    (await getBotTokenFromStore("telegram", "staff")) || process.env.TELEGRAM_STAFF_TOKEN;
  if (token && tgIds.size > 0) {
    for (const chatId of tgIds) {
      try {
        await sendMessage(token, {
          chat_id: chatId,
          text: message,
          reply_markup: {
            inline_keyboard: [[{ text: "✅ ОК", callback_data: "read_notify" }]],
          },
        });
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
    ...(input.customerUid && { customerUid: input.customerUid, visitorId: input.customerUid }),
    createdAt: new Date(),
  });

  return { ok: true, targetUids, isOrphan };
}
