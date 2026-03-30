import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { PREORDER_CARTS_SUBCOLLECTION } from "@/lib/pre-order";

export type SotaGuestChannel = "tg" | "wa" | "vk" | "anon" | "unknown";

export type PreorderCartNotificationContext = {
  venueId: string;
  cartDocId: string;
};

/** Если текст из ЦУП не пришёл или пустой — не оставляем дыру в UX/логах. */
const FALLBACK_NOTIFICATION_TEXT_RU =
  "Обновление по вашему заказу. Откройте приложение заведения, чтобы увидеть детали.";

export type SendSotaNotificationMeta = {
  /** Для лога: status_confirmed, status_ready, … */
  statusKey?: string;
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

function platformLabelForLog(channel: SotaGuestChannel): string {
  switch (channel) {
    case "tg":
      return "Telegram";
    case "wa":
      return "WhatsApp";
    case "vk":
      return "VK";
    case "anon":
      return "Anon";
    case "unknown":
      return "Unknown";
    default:
      return String(channel);
  }
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
  cartContext?: PreorderCartNotificationContext,
  meta?: SendSotaNotificationMeta
): Promise<void> {
  const { channel, rest } = parseSotaGuestChannel(customerId);
  const statusLabel = meta?.statusKey?.trim() || "notify";
  const platform = platformLabelForLog(channel);
  const idForLog = (rest || customerId.trim() || "—").slice(0, 256);

  const body = (message ?? "").trim() || FALLBACK_NOTIFICATION_TEXT_RU;

  console.log(`Sending [${statusLabel}] to [${platform}] for ID [${idForLog}]`);

  try {
    switch (channel) {
      case "tg": {
        const chatId = rest;
        // Заглушка: дальше — sendMessage(clientBotToken, { chat_id, text: body })
        console.log("[SOTA notify][tg] stub sendMessage", { chatId, message: body });
        break;
      }
      case "wa": {
        // TODO: Integration — WhatsApp Cloud API / Business
        console.log("[SOTA notify][wa] TODO: Integration", { externalId: rest, message: body });
        break;
      }
      case "vk": {
        // TODO: Integration — VK Messages API
        console.log("[SOTA notify][vk] TODO: Integration", { externalId: rest, message: body });
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
                text: body,
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
        console.warn("[SOTA notify] unknown customerUid prefix, skip", { customerId, message: body });
    }
  } catch (e) {
    console.error(
      `[SOTA notify] failed Sending [${statusLabel}] to [${platform}] for ID [${idForLog}]`,
      e instanceof Error ? e.message : e
    );
  }
}
