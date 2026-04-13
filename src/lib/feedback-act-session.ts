/**
 * Второй акт визита: отдельный документ activeSessions с префиксом id — виден в Дашборде, не блокирует стол.
 */
export const FEEDBACK_SESSION_ID_PREFIX = "feedback_" as const;

/** Статус «только отзыв/чаевые», не путать с боевой сессией. */
export const GUEST_FEEDBACK_ACT_STATUS = "guest_feedback_act" as const;

export function buildFeedbackActSessionId(sourceSessionId: string): string {
  const sid = String(sourceSessionId ?? "").trim();
  if (!sid) return "";
  if (sid.startsWith(FEEDBACK_SESSION_ID_PREFIX)) return sid;
  return `${FEEDBACK_SESSION_ID_PREFIX}${sid}`;
}

export function stripFeedbackActSessionPrefix(sessionId: string): string {
  const s = String(sessionId ?? "").trim();
  if (s.startsWith(FEEDBACK_SESSION_ID_PREFIX)) {
    return s.slice(FEEDBACK_SESSION_ID_PREFIX.length);
  }
  return s;
}

export function isFeedbackActSessionId(sessionId: string): boolean {
  return String(sessionId ?? "").trim().startsWith(FEEDBACK_SESSION_ID_PREFIX);
}

export function isFeedbackActSessionRecord(args: { id: string; status?: string }): boolean {
  if (isFeedbackActSessionId(args.id)) return true;
  return args.status === GUEST_FEEDBACK_ACT_STATUS;
}
