/**
 * Служебная коллекция active_sessions: склейка «аккаунт мессенджера → текущий стол».
 * Не путать с доменной коллекцией activeSessions (сессия стола в зале).
 *
 * ID документа: tg_<telegram_user_id> (в перспективе vk_…, wa_…).
 * Поля: vr_id (Firestore id заведения), table_id, last_seen, order_status.
 */

export const GUEST_ACTIVE_SESSIONS_COLLECTION = "active_sessions";

/** Сколько держим привязку для «холодного старта» без start_param. */
export const GUEST_CONTEXT_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/** Допустимый возраст подписи initData при вызове API (сек). */
export const TELEGRAM_INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;

export function guestMessengerContextDocId(channel: "telegram", externalUserId: string): string {
  const id = String(externalUserId ?? "").trim();
  if (!id) return "";
  if (channel === "telegram") return `tg_${id}`;
  return `${channel}_${id}`;
}

export type GuestActiveSessionIndexDoc = {
  vr_id: string;
  table_id: string;
  /** Firestore Timestamp или server time при записи */
  last_seen: unknown;
  order_status?: string;
};
