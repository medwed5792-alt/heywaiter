/**
 * 7 каналов × 2 типа бота = 14 вебхуков.
 * Токены из env: TELEGRAM_CLIENT_TOKEN, TELEGRAM_STAFF_TOKEN, ...
 */
import type { MessengerChannel } from "@/lib/types";

export const WEBHOOK_CHANNELS: MessengerChannel[] = [
  "telegram",
  "whatsapp",
  "vk",
  "viber",
  "wechat",
  "instagram",
  "facebook",
  "line",
];

export type BotType = "client" | "staff";

const ENV_KEYS: Record<string, Record<BotType, string>> = {
  telegram: { client: "TELEGRAM_CLIENT_TOKEN", staff: "TELEGRAM_STAFF_TOKEN" },
  whatsapp: { client: "WHATSAPP_CLIENT_TOKEN", staff: "WHATSAPP_STAFF_TOKEN" },
  vk: { client: "VK_CLIENT_TOKEN", staff: "VK_STAFF_TOKEN" },
  viber: { client: "VIBER_CLIENT_TOKEN", staff: "VIBER_STAFF_TOKEN" },
  wechat: { client: "WECHAT_CLIENT_TOKEN", staff: "WECHAT_STAFF_TOKEN" },
  instagram: { client: "INSTAGRAM_CLIENT_TOKEN", staff: "INSTAGRAM_STAFF_TOKEN" },
  facebook: { client: "FACEBOOK_CLIENT_TOKEN", staff: "FACEBOOK_STAFF_TOKEN" },
  line: { client: "LINE_CLIENT_TOKEN", staff: "LINE_STAFF_TOKEN" },
};

export function getBotToken(channel: string, botType: BotType): string | undefined {
  const keys = ENV_KEYS[channel];
  if (!keys) return undefined;
  let token: string | undefined = process.env[keys[botType]];
  if (channel === "telegram") {
    if (!token && botType === "client") {
      token = process.env.TELEGRAM_BOT_TOKEN ?? process.env.TELEGRAM_TOKEN;
    }
    if (!token && botType === "staff") {
      token = process.env.TELEGRAM_TOKEN;
    }
  }
  return token;
}

export function isKnownChannel(channel: string): channel is MessengerChannel {
  return WEBHOOK_CHANNELS.includes(channel as MessengerChannel);
}

export function isKnownBotType(botType: string): botType is BotType {
  return botType === "client" || botType === "staff";
}
