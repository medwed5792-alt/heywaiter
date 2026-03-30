import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { sendMessage } from "@/adapters/telegram/telegramApi";

async function getTelegramIdsForStaffIds(firestore: Firestore, staffDocIds: string[]): Promise<Set<string>> {
  const tgIds = new Set<string>();
  for (const sid of staffDocIds) {
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

async function resolveTargetStaffIdsForVenue(firestore: Firestore, venueId: string): Promise<string[]> {
  const onShift = await firestore
    .collection("staff")
    .where("venueId", "==", venueId)
    .where("active", "==", true)
    .where("onShift", "==", true)
    .get();
  if (!onShift.empty) return onShift.docs.map((d) => d.id);
  const active = await firestore.collection("staff").where("venueId", "==", venueId).where("active", "==", true).get();
  return active.docs.map((d) => d.id);
}

export type PreorderGuestCancelStaffAlertArgs = {
  firestore: Firestore;
  venueId: string;
  customerUid: string;
  orderDisplayId: string;
  message: string;
};

/**
 * Алерт персоналу: предзаказ отменён гостем (in-app staffNotifications + best-effort Telegram Staff-бот).
 */
export async function notifyStaffPreorderGuestCancelled(args: PreorderGuestCancelStaffAlertArgs): Promise<void> {
  const venueId = args.venueId.trim();
  if (!venueId) return;

  const targetUids = await resolveTargetStaffIdsForVenue(args.firestore, venueId);
  if (targetUids.length === 0) {
    console.warn("[preorder guest cancel staff] нет активных сотрудников для venueId", venueId);
  }

  await args.firestore.collection("staffNotifications").add({
    type: "preorder_guest_cancelled",
    title: "Предзаказ отменён гостем",
    message: args.message,
    venueId,
    tableId: null,
    tableNumber: null,
    sessionId: null,
    status: "pending",
    read: false,
    targetUids,
    customerUid: args.customerUid.trim(),
    visitorId: args.customerUid.trim(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const tgIds = await getTelegramIdsForStaffIds(args.firestore, targetUids);
  try {
    const { getBotTokenFromStore } = await import("@/lib/webhook/bots-store");
    const token =
      (await getBotTokenFromStore("telegram", "staff")) || process.env.TELEGRAM_STAFF_TOKEN;
    if (token && tgIds.size > 0) {
      for (const chatId of tgIds) {
        try {
          await sendMessage(token, {
            chat_id: chatId,
            text: args.message,
          });
        } catch (err) {
          console.error("[preorder guest cancel staff] telegram", chatId, err);
        }
      }
    }
  } catch (e) {
    console.warn("[preorder guest cancel staff] telegram блок пропущен", e);
  }
}
