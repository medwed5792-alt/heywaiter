/**
 * Deep Links для мессенджеров (QR & Social Bridge).
 * Основной формат: `v:venueId:t:tableId` (короче, чем v_…_t_…).
 *
 * Гостевой Telegram: t.me/<NEXT_PUBLIC_GUEST_BOT_USERNAME>/<NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME>?startapp=...
 */

import type { MessengerChannel } from "./types";

/** Без @ — для URL и сравнения с initDataUnsafe.receiver.username */
export const GUEST_TELEGRAM_BOT_USERNAME = (
  process.env.NEXT_PUBLIC_GUEST_BOT_USERNAME ?? "HeyWaiter_bot"
)
  .trim()
  .replace(/^@/, "");

const TELEGRAM_MINIAPP_NAME = (process.env.NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME ?? "waiter").trim();
const BOT_WHATSAPP = process.env.NEXT_PUBLIC_WHATSAPP_PHONE ?? "";
const BOT_VIBER_URI = process.env.NEXT_PUBLIC_VIBER_BOT_URI ?? "heywaiter";
const BOT_LINE_ID = process.env.NEXT_PUBLIC_LINE_BOT_ID ?? "";

function buildStartPayload(venueId: string, tableId: string, visitorId?: string | null): string {
  const base = `v:${venueId}:t:${tableId}`;
  return visitorId?.trim() ? `${base}:vid:${visitorId.trim()}` : base;
}

/**
 * Ссылка для открытия гостевого Mini App: `t.me/HeyWaiter_bot/waiter?startapp=...`
 * (значения из NEXT_PUBLIC_*).
 */
export function buildTelegramStartAppLink(venueId: string, tableId: string): string {
  const payload = buildStartPayload(venueId, tableId);
  return `https://t.me/${GUEST_TELEGRAM_BOT_USERNAME}/${TELEGRAM_MINIAPP_NAME}?startapp=${encodeURIComponent(payload)}`;
}

export interface BuildDeepLinkOptions {
  /** @deprecated Не используется: гостевой бот задаётся только через NEXT_PUBLIC_GUEST_BOT_USERNAME. */
  telegramUsername?: string | null;
}

export function buildDeepLink(
  channel: MessengerChannel,
  venueId: string,
  tableId: string,
  visitorId?: string | null,
  _options?: BuildDeepLinkOptions
): string {
  const payloadWithOptionalVisitor = buildStartPayload(venueId, tableId, visitorId);

  switch (channel) {
    case "telegram": {
      const startPayload = buildStartPayload(venueId, tableId);
      return `https://t.me/${GUEST_TELEGRAM_BOT_USERNAME}/${TELEGRAM_MINIAPP_NAME}?startapp=${encodeURIComponent(startPayload)}`;
    }
    case "whatsapp":
      const text = encodeURIComponent(`start ${payloadWithOptionalVisitor}`);
      return BOT_WHATSAPP
        ? `https://wa.me/${BOT_WHATSAPP.replace(/\D/g, "")}?text=${text}`
        : `https://wa.me/?text=${text}`;
    case "viber":
      return `viber://pa?chatURI=${BOT_VIBER_URI}&context=${encodeURIComponent(payloadWithOptionalVisitor)}`;
    case "instagram":
    case "facebook":
      return `https://m.me/?text=${encodeURIComponent(payloadWithOptionalVisitor)}`;
    case "wechat":
      return `https://wechat.com/?text=${encodeURIComponent(payloadWithOptionalVisitor)}`;
    case "vk":
      return `https://vk.com/?text=${encodeURIComponent(payloadWithOptionalVisitor)}`;
    case "line":
      if (!BOT_LINE_ID) return "#";
      return `https://line.me/R/ti/p/@${BOT_LINE_ID.replace(/^@/, "")}?start=${encodeURIComponent(payloadWithOptionalVisitor)}`;
    default:
      return `/#${payloadWithOptionalVisitor}`;
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
