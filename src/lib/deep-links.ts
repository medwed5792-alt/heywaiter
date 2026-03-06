/**
 * Deep Links для мессенджеров (QR & Social Bridge).
 * Формат: v_{venueId}_t_{tableId} — контракт с ботами.
 */

import type { MessengerChannel } from "./types";

const BOT_TELEGRAM = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "HeyWaiter_bot";
const BOT_WHATSAPP = process.env.NEXT_PUBLIC_WHATSAPP_PHONE ?? "";
const BOT_VIBER_URI = process.env.NEXT_PUBLIC_VIBER_BOT_URI ?? "heywaiter";

export function buildDeepLink(
  channel: MessengerChannel,
  venueId: string,
  tableId: string
): string {
  const payload = `v_${venueId}_t_${tableId}`;

  switch (channel) {
    case "telegram":
      return `tg://resolve?domain=${BOT_TELEGRAM}&start=${payload}`;
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
};
