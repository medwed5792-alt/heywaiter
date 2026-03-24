/**
 * Сборка ссылки t.me/.../waiter?startapp= для гостя: SOTA-токен или легаси v:…:t:…
 */

import { doc, getDoc, type Firestore } from "firebase/firestore";
import { GUEST_TELEGRAM_BOT_USERNAME } from "@/lib/deep-links";
import { buildSotaStartappToken } from "@/lib/sota-id";

const TELEGRAM_MINIAPP_NAME = (process.env.NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME ?? "waiter").trim();

function legacyStartPayload(venueId: string, tableId: string): string {
  return `v:${venueId}:t:${tableId}`;
}

/**
 * Полная HTTPS-ссылка на гостевой Mini App с учётом SOTA в Firestore.
 */
export async function buildTelegramStartAppLinkResolved(
  db: Firestore,
  venueId: string,
  tableId: string
): Promise<string> {
  const vSnap = await getDoc(doc(db, "venues", venueId));
  const venueSota = vSnap.exists() ? (vSnap.data()?.sotaId as string | undefined) : undefined;
  if (venueSota && typeof venueSota === "string" && venueSota.trim()) {
    const tSnap = await getDoc(doc(db, "venues", venueId, "tables", tableId));
    const tData = tSnap.exists() ? tSnap.data() : undefined;
    const code =
      (tData?.sotaTableCode != null && String(tData.sotaTableCode).trim() !== ""
        ? String(tData.sotaTableCode).trim()
        : null) ??
      (tData?.number != null ? String(Number(tData.number)) : null) ??
      tableId;
    const token = buildSotaStartappToken(venueSota.trim(), code);
    return `https://t.me/${GUEST_TELEGRAM_BOT_USERNAME}/${TELEGRAM_MINIAPP_NAME}?startapp=${encodeURIComponent(token)}`;
  }
  const payload = legacyStartPayload(venueId, tableId);
  return `https://t.me/${GUEST_TELEGRAM_BOT_USERNAME}/${TELEGRAM_MINIAPP_NAME}?startapp=${encodeURIComponent(payload)}`;
}
