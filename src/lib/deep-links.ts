/**
 * Deep Links для мессенджеров (QR & Social Bridge).
 * Основной формат: `v:venueId:t:tableId` (короче, чем v_…_t_…).
 */

import type { MessengerChannel } from "./types";

/**
 * Единственный гостевой Telegram-бот для шлюза и Mini App.
 * Ссылки «Открыть в Telegram» / startapp ведут только сюда, без подмены из env или Firestore.
 */
export const GUEST_TELEGRAM_BOT_USERNAME = "SotaGuestBot";

/** Короткое имя Mini App в Telegram (например "waiter") — открытие без перехода в чат. */
const TELEGRAM_MINIAPP_NAME = process.env.NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME ?? "waiter";
const BOT_WHATSAPP = process.env.NEXT_PUBLIC_WHATSAPP_PHONE ?? "";
const BOT_VIBER_URI = process.env.NEXT_PUBLIC_VIBER_BOT_URI ?? "heywaiter";
const BOT_LINE_ID = process.env.NEXT_PUBLIC_LINE_BOT_ID ?? "";

function guestTelegramBotForUrl(): string {
  return GUEST_TELEGRAM_BOT_USERNAME.replace(/^@/, "");
}

function buildStartPayload(venueId: string, tableId: string, visitorId?: string | null): string {
  const base = `v:${venueId}:t:${tableId}`;
  return visitorId?.trim() ? `${base}:vid:${visitorId.trim()}` : base;
}

/**
 * Ссылка для открытия Telegram Mini App у гостевого бота @SotaGuestBot.
 * startapp — лимит Telegram ~64 символа; гость идентифицируется локально (VisitorProvider).
 */
export function buildTelegramStartAppLink(venueId: string, tableId: string): string {
  const payload = buildStartPayload(venueId, tableId);
  const bot = guestTelegramBotForUrl();
  return `https://t.me/${bot}/${TELEGRAM_MINIAPP_NAME}?startapp=${encodeURIComponent(payload)}`;
}

export interface BuildDeepLinkOptions {
  /**
   * @deprecated Игнорируется для Telegram: гостевой шлюз всегда использует @SotaGuestBot.
   * Оставлено для обратной совместимости вызовов buildDeepLink(..., { telegramUsername }).
   */
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
      const bot = guestTelegramBotForUrl();
      const startPayload = buildStartPayload(venueId, tableId);
      return `https://t.me/${bot}/${TELEGRAM_MINIAPP_NAME}?startapp=${encodeURIComponent(startPayload)}`;
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
