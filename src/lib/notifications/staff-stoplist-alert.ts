import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { sendMessage } from "@/adapters/telegram/telegramApi";
import { getTelegramIdsForStaffIds, resolveTargetStaffIdsForVenue } from "@/lib/notifications/staff-notify-helpers";

export type StopListStaffNotifyChange = {
  dishName: string;
  /** true — снова в продаже (АКТИВНО), false — стоп (СТОП) */
  active: boolean;
};

export type NotifyStaffAboutStopListArgs = {
  firestore: Firestore;
  venueId: string;
  changes: StopListStaffNotifyChange[];
};

function formatLine(dishName: string, active: boolean): string {
  return `Администратор: ${dishName} -> ${active ? "АКТИВНО" : "СТОП"}`;
}

/**
 * Уведомляет персонал о смене флага active у позиций меню (витрина / стоп-лист).
 * Пишет в staffNotifications (как отдельные сообщения) и шлёт сводку в Telegram Staff-бот при наличии токена.
 */
export async function notifyStaffAboutStopList(args: NotifyStaffAboutStopListArgs): Promise<void> {
  const venueId = args.venueId.trim();
  if (!venueId || !args.changes.length) return;

  const targetUids = await resolveTargetStaffIdsForVenue(args.firestore, venueId);
  if (targetUids.length === 0) {
    console.warn("[notifyStaffAboutStopList] нет активных сотрудников для venueId", venueId);
  }

  const lines = args.changes.map((c) => formatLine(c.dishName.trim() || "—", c.active));

  for (const message of lines) {
    await args.firestore.collection("staffNotifications").add({
      type: "menu_stoplist_change",
      title: "Меню: стоп-лист",
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
  }

  const tgIds = await getTelegramIdsForStaffIds(args.firestore, venueId, targetUids);
  const combined = lines.join("\n");
  try {
    const { getBotTokenFromStore } = await import("@/lib/webhook/bots-store");
    const token = (await getBotTokenFromStore("telegram", "staff")) || process.env.TELEGRAM_STAFF_TOKEN;
    if (token && tgIds.size > 0) {
      for (const chatId of tgIds) {
        try {
          await sendMessage(token, {
            chat_id: chatId,
            text: combined,
          });
        } catch (err) {
          console.error("[notifyStaffAboutStopList] telegram", chatId, err);
        }
      }
    }
  } catch (e) {
    console.warn("[notifyStaffAboutStopList] telegram пропущен", e);
  }
}
