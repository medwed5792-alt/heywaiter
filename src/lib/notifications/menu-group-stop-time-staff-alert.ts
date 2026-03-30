import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { sendMessage } from "@/adapters/telegram/telegramApi";
import { getTelegramIdsForStaffIds, resolveTargetStaffIdsForVenue } from "@/lib/notifications/staff-notify-helpers";

export type MenuGroupStopTimeStaffAlertArgs = {
  firestore: Firestore;
  venueId: string;
  groupId: string;
  groupName: string;
};

function formatStopText(groupName: string): string {
  return `Система: Группа ${groupName} -> СТОП (время вышло)`;
}

/**
 * Алерт персоналу о том, что группа меню стала недоступна по расписанию.
 * Доставка: staffNotifications + best-effort Telegram staff bot.
 */
export async function notifyStaffAboutMenuGroupStopTime(args: MenuGroupStopTimeStaffAlertArgs): Promise<void> {
  const venueId = args.venueId.trim();
  if (!venueId) return;

  const targetUids = await resolveTargetStaffIdsForVenue(args.firestore, venueId);
  if (targetUids.length === 0) {
    console.warn("[menu group stop time] нет активных сотрудников для venueId", venueId);
  }

  const message = formatStopText(args.groupName);

  await args.firestore.collection("staffNotifications").add({
    type: "menu_group_stop_time",
    title: "Меню: стоп-лист по расписанию",
    message,
    venueId,
    tableId: null,
    tableNumber: null,
    sessionId: null,
    status: "completed",
    read: false,
    targetUids,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const tgIds = await getTelegramIdsForStaffIds(args.firestore, targetUids);
  try {
    const { getBotTokenFromStore } = await import("@/lib/webhook/bots-store");
    const token = (await getBotTokenFromStore("telegram", "staff")) || process.env.TELEGRAM_STAFF_TOKEN;
    if (token && tgIds.size > 0) {
      const combined = message;
      for (const chatId of tgIds) {
        try {
          await sendMessage(token, { chat_id: chatId, text: combined });
        } catch (err) {
          console.error("[menu group stop time] telegram", chatId, err);
        }
      }
    }
  } catch (e) {
    console.warn("[menu group stop time] telegram пропущен", e);
  }
}

