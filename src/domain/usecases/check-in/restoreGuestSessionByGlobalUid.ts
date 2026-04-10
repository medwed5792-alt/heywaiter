import { getAdminFirestore } from "@/lib/firebase-admin";
import { isActiveSessionWithinMaxAge, activeSessionCreatedAtMillis } from "@/lib/session-freshness";
import { syncGuestGlobalProfileOnVisit } from "@/lib/identity/guest-global-profile";

/** «Активный» визит за столом в терминах Staff-lock / бесшовного входа. */
const RESTORE_SESSION_STATUS = "check_in_success" as const;

export type RestoreGuestSessionResult =
  | {
      ok: true;
      sessionId: string;
      venueId: string;
      tableId: string;
      messageGuest: string;
    }
  | { ok: false; reason: "invalid_uid" | "not_found" };

/**
 * Найти свежую (< SESSION_MAX_AGE_MS) сессию, где пользователь — мастер или в participantUids (global UID).
 * Без привязки к мессенджеру: идентификатор = id документа global_users.
 */
export async function restoreGuestSessionByGlobalUid(globalGuestUid: string): Promise<RestoreGuestSessionResult> {
  const uid = String(globalGuestUid ?? "").trim();
  if (!uid) return { ok: false, reason: "invalid_uid" };

  const fs = getAdminFirestore();
  const nowMs = Date.now();

  const [byMaster, byParticipant] = await Promise.all([
    fs
      .collection("activeSessions")
      .where("masterId", "==", uid)
      .where("status", "==", RESTORE_SESSION_STATUS)
      .limit(25)
      .get(),
    fs
      .collection("activeSessions")
      .where("participantUids", "array-contains", uid)
      .where("status", "==", RESTORE_SESSION_STATUS)
      .limit(25)
      .get(),
  ]);

  const byId = new Map<string, (typeof byMaster.docs)[number]>();
  for (const d of byMaster.docs) byId.set(d.id, d);
  for (const d of byParticipant.docs) byId.set(d.id, d);

  let best: (typeof byMaster.docs)[number] | null = null;
  let bestCreated = -Infinity;

  for (const d of byId.values()) {
    const raw = d.data() as Record<string, unknown>;
    if (!isActiveSessionWithinMaxAge(raw, nowMs)) continue;
    const cm = activeSessionCreatedAtMillis(raw);
    const t = cm ?? 0;
    if (t >= bestCreated) {
      bestCreated = t;
      best = d;
    }
  }

  if (!best) return { ok: false, reason: "not_found" };

  const data = best.data() as Record<string, unknown>;
  const venueId = String(data.venueId ?? "").trim();
  const tableId = String(data.tableId ?? "").trim();
  if (!venueId || !tableId) return { ok: false, reason: "not_found" };

  await syncGuestGlobalProfileOnVisit(fs, {
    globalUid: uid,
    venueId,
    tableId,
  });

  return {
    ok: true,
    sessionId: best.id,
    venueId,
    tableId,
    messageGuest: "Сессия восстановлена. Добро пожаловать обратно!",
  };
}
