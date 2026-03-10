/**
 * Deep Links для мессенджеров (QR & Social Bridge).
 * Формат: v_{venueId}_t_{tableId} — контракт с ботами.
 */

import type { MessengerChannel } from "./types";

const BOT_TELEGRAM = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "HeyWaiter_bot";
/** Короткое имя Mini App в Telegram (например "waiter") — открытие без перехода в чат. */
const TELEGRAM_MINIAPP_NAME = process.env.NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME ?? "waiter";
const BOT_WHATSAPP = process.env.NEXT_PUBLIC_WHATSAPP_PHONE ?? "";
const BOT_VIBER_URI = process.env.NEXT_PUBLIC_VIBER_BOT_URI ?? "heywaiter";
const BOT_LINE_ID = process.env.NEXT_PUBLIC_LINE_BOT_ID ?? "";

/** Без @ для URL (если передано @username — убираем @). */
function telegramBotUsername(override?: string | null): string {
  if (override && override.trim()) {
    return override.trim().replace(/^@/, "");
  }
  return BOT_TELEGRAM.replace(/^@/, "");
}

/**
 * Ссылка для открытия Telegram Mini App (короткое имя "waiter").
 * Формат: https://t.me/BotUsername/waiter?startapp=v_venueId_t_tableId_vid_visitorId
 */
export function buildTelegramStartAppLink(
  venueId: string,
  tableId: string,
  visitorId: string,
  telegramUsername?: string | null
): string {
  const payload = `v_${venueId}_t_${tableId}_vid_${visitorId}`;
  const bot = telegramBotUsername(telegramUsername);
  return `https://t.me/${bot}/${TELEGRAM_MINIAPP_NAME}?startapp=${encodeURIComponent(payload)}`;
}

export interface BuildDeepLinkOptions {
  /** @username бота из Firestore (system_settings/bots.tg_client_username). */
  telegramUsername?: string | null;
}

export function buildDeepLink(
  channel: MessengerChannel,
  venueId: string,
  tableId: string,
  visitorId?: string | null,
  options?: BuildDeepLinkOptions
): string {
  const payload = visitorId
    ? `v_${venueId}_t_${tableId}_vid_${visitorId}`
    : `v_${venueId}_t_${tableId}`;

  switch (channel) {
    case "telegram": {
      const bot = telegramBotUsername(options?.telegramUsername);
      return `https://t.me/${bot}/${TELEGRAM_MINIAPP_NAME}?startapp=${encodeURIComponent(payload)}`;
    }
    case "whatsapp":
      const text = encodeURIComponent(`start ${payload}`);
      return BOT_WHATSAPP
        ? `https://wa.me/${BOT_WHATSAPP.replace(/\D/g, "")}?text=${text}`
        : `https://wa.me/?text=${text}`;
    case "viber":
      return `viber://pa?chatURI=${BOT_VIBER_URI}&context=${encodeURIComponent(payload)}`;
    case "instagram":
    case "facebook":
      return `https://m.me/?text=${encodeURIComponent(payload)}`;
    case "wechat":
      return `https://wechat.com/?text=${encodeURIComponent(payload)}`;
    case "vk":
      return `https://vk.com/?text=${encodeURIComponent(payload)}`;
    case "line":
      if (!BOT_LINE_ID) return "#";
      return `https://line.me/R/ti/p/@${BOT_LINE_ID.replace(/^@/, "")}?start=${encodeURIComponent(payload)}`;
    default:
      return `/#${payload}`;
  }
}

export const messengerLabels: Record<string, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  vk: "ВКонтакте",
  viber: "Viber",
  instagram: "Instagram",
  facebook: "Facebook",
  wechat: "WeChat",
  line: "Line",
};
