/**
 * Сборка Telegram deep link: https://t.me/...?...startapp=v_ID_t_ID
 */

import type { Firestore } from "firebase/firestore";

/**
 * Полная deep link ссылка для открытия Mini App внутри Telegram.
 */
export async function buildTelegramStartAppLinkResolved(
  _db: Firestore,
  venueId: string,
  tableId: string
): Promise<string> {
  const bot = (process.env.NEXT_PUBLIC_GUEST_BOT_USERNAME ?? "HeyWaiter_bot").trim().replace(/^@/, "");
  const miniAppName = (process.env.NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME ?? "waiter").trim();
  const payload = `v_${venueId.trim()}_t_${tableId.trim()}`;
  return `https://t.me/${bot}/${miniAppName}?startapp=${encodeURIComponent(payload)}`;
}
