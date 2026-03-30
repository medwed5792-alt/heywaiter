import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { sendMessage } from "@/adapters/telegram/telegramApi";
import { getTelegramIdsForStaffIds, resolveTargetStaffIdsForVenue } from "@/lib/notifications/staff-notify-helpers";

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
