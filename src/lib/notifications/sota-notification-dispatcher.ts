import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { PREORDER_CARTS_SUBCOLLECTION } from "@/lib/pre-order";

export type SotaGuestChannel = "tg" | "wa" | "vk" | "anon" | "unknown";

export type PreorderCartNotificationContext = {
  venueId: string;
  cartDocId: string;
};

/**
 * Разбор unified customerUid / legacy префиксов для выбора канала доставки.
 */
export function parseSotaGuestChannel(customerId: string): { channel: SotaGuestChannel; rest: string } {
  const id = customerId.trim();
  if (id.startsWith("tg:")) return { channel: "tg", rest: id.slice(3).trim() };
  if (id.startsWith("telegram_user_id:")) return { channel: "tg", rest: id.slice("telegram_user_id:".length).trim() };
  if (id.startsWith("wa:")) return { channel: "wa", rest: id.slice(3).trim() };
  if (id.startsWith("vk:")) return { channel: "vk", rest: id.slice(3).trim() };
  if (id.startsWith("anon:")) return { channel: "anon", rest: id.slice(5).trim() };
  if (id.startsWith("anonymous_id:")) return { channel: "anon", rest: id.slice("anonymous_id:".length).trim() };
  return { channel: "unknown", rest: id };
}

/**
 * Диспетчер уведомлений гостю по каналу, заданному префиксом customerId.
 * Реальные API мессенджеров (кроме заглушки Telegram) — TODO.
 *
 * @param adminDb Firestore Admin (для anon: — запись lastNotification в корзину)
 */
export async function sendSotaNotification(
  adminDb: Firestore,
  customerId: string,
  message: string,
  cartContext?: PreorderCartNotificationContext
): Promise<void> {
  const { channel, rest } = parseSotaGuestChannel(customerId);

  switch (channel) {
    case "tg": {
      const chatId = rest;
      // Заглушка: дальше — sendMessage(clientBotToken, { chat_id, text: message })
      console.log("[SOTA notify][tg] stub sendMessage", { chatId, message });
      break;
    }
    case "wa": {
      // TODO: Integration — WhatsApp Cloud API / Business
      console.log("[SOTA notify][wa] TODO: Integration", { externalId: rest, message });
      break;
    }
    case "vk": {
      // TODO: Integration — VK Messages API
      console.log("[SOTA notify][vk] TODO: Integration", { externalId: rest, message });
      break;
    }
    case "anon": {
      if (!cartContext?.venueId?.trim() || !cartContext.cartDocId?.trim()) {
        console.warn("[SOTA notify][anon] skip lastNotification: missing cartContext", { customerId });
        return;
      }
      await adminDb
        .collection("venues")
        .doc(cartContext.venueId.trim())
        .collection(PREORDER_CARTS_SUBCOLLECTION)
        .doc(cartContext.cartDocId.trim())
        .set(
          {
            lastNotification: {
              text: message,
              at: FieldValue.serverTimestamp(),
            },
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: Date.now(),
          },
          { merge: true }
        );
      break;
    }
    default:
      console.warn("[SOTA notify] unknown customerUid prefix, skip", { customerId, message });
  }
}
