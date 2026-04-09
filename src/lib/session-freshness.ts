/**
 * «Предохранитель» АК-47: сессии старше окна по createdAt не блокируют вход и не подхватываются check-in.
 */
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function activeSessionCreatedAtMillis(data: Record<string, unknown>): number | null {
  const v = data.createdAt;
  if (v == null) return null;
  if (typeof (v as { toDate?: () => Date }).toDate === "function") {
    const d = (v as { toDate: () => Date }).toDate();
    const t = d.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === "object" && v !== null && "seconds" in v && typeof (v as { seconds: number }).seconds === "number") {
    return (v as { seconds: number }).seconds * 1000;
  }
  return null;
}

export function isActiveSessionWithinMaxAge(
  data: Record<string, unknown>,
  nowMs: number = Date.now(),
  maxAgeMs: number = SESSION_MAX_AGE_MS
): boolean {
  const createdMs = activeSessionCreatedAtMillis(data);
  if (createdMs == null) return false;
  return nowMs - createdMs <= maxAgeMs;
}

export function pickNewestFreshActiveSessionDoc<T extends { id: string; data: () => Record<string, unknown> }>(
  docs: T[],
  nowMs: number = Date.now(),
  maxAgeMs: number = SESSION_MAX_AGE_MS
): T | null {
  let best: T | null = null;
  let bestCreated = -Infinity;
  for (const d of docs) {
    const raw = d.data() as Record<string, unknown>;
    if (!isActiveSessionWithinMaxAge(raw, nowMs, maxAgeMs)) continue;
    const cm = activeSessionCreatedAtMillis(raw);
    const t = cm ?? 0;
    if (t >= bestCreated) {
      bestCreated = t;
      best = d;
    }
  }
  return best;
}
