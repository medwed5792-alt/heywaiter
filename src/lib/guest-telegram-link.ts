/**
 * Единая ссылка входа в Mini App: /mini-app?v=...&t=...
 */

import type { Firestore } from "firebase/firestore";

/**
 * Полная HTTPS-ссылка на гостевой Mini App.
 */
export async function buildTelegramStartAppLinkResolved(
  _db: Firestore,
  venueId: string,
  tableId: string
): Promise<string> {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://heywaiter.vercel.app").trim().replace(/\/$/, "");
  return `${base}/mini-app?v=${encodeURIComponent(venueId.trim())}&t=${encodeURIComponent(tableId.trim())}`;
}
