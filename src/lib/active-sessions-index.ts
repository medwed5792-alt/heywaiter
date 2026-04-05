/**
 * Индекс Firestore `active_sessions` (tg_*): склейка Telegram ↔ стол для recover и фаза «ожидаем отзыв».
 */
export const ACTIVE_SESSIONS_ORDER_AWAITING_FEEDBACK = "AWAITING_FEEDBACK" as const;

export function activeSessionsIndexDocIdForTelegramUser(telegramUserId: string): string {
  const id = telegramUserId.trim();
  return id ? `tg_${id}` : "";
}

/** Участник `tg:123456789` → цифровой id для документа индекса. */
export function telegramNumericIdFromParticipantUid(participantUid: string): string | null {
  const u = participantUid.trim();
  if (!u.startsWith("tg:")) return null;
  const rest = u.slice(3).trim();
  return /^\d+$/.test(rest) ? rest : null;
}

export function collectTelegramNumericIdsFromSessionDoc(data: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const masterId = typeof data.masterId === "string" ? data.masterId.trim() : "";
  const m0 = telegramNumericIdFromParticipantUid(masterId);
  if (m0) ids.add(m0);
  for (const p of Array.isArray(data.participants) ? data.participants : []) {
    const uid = typeof (p as { uid?: string })?.uid === "string" ? (p as { uid: string }).uid.trim() : "";
    const m = telegramNumericIdFromParticipantUid(uid);
    if (m) ids.add(m);
  }
  return [...ids];
}
