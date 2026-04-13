import { Timestamp, type QuerySnapshot } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { syncGuestGlobalProfileOnVisit } from "@/lib/identity/guest-global-profile";
import { activeSessionCreatedAtMillis, pickNewestFreshActiveSessionDoc } from "@/lib/session-freshness";

const ACTIVE_SESSION_STATUS = ["check_in_success", "payment_confirmed"] as const;

/** Окно «только что закрыли стол»: без активной сессии архив за этот интервал → обязательно thank_you. */
const ARCHIVE_RECENT_MS = 5 * 60 * 1000;

export type ResolveGuestPoliteStateResult =
  | {
      phase: "working";
      globalGuestUid: string;
      venueId: string;
      tableId: string;
      sessionId: string;
    }
  | {
      phase: "thank_you";
      globalGuestUid: string;
      visitId: string;
      venueId: string;
      tableId: string;
      tableNumber: number;
      feedbackStaffId: string | null;
    }
  | { phase: "free"; globalGuestUid: string };

function fieldAsMillis(raw: Record<string, unknown>, key: string): number | null {
  const v = raw[key];
  if (v == null) return null;
  return activeSessionCreatedAtMillis({ createdAt: v } as Record<string, unknown>);
}

function archivedEventTimeMs(raw: Record<string, unknown>): number {
  return (
    fieldAsMillis(raw, "archivedAt") ??
    fieldAsMillis(raw, "closedAt") ??
    fieldAsMillis(raw, "createdAt") ??
    0
  );
}

function archivedQualifiesForThankYou(raw: Record<string, unknown>, nowMs: number): boolean {
  if (raw.guestFeedbackPending === true) return true;
  const ev = archivedEventTimeMs(raw);
  if (ev <= 0) return false;
  return nowMs - ev <= ARCHIVE_RECENT_MS;
}

function pickBestArchivedThankYouDoc(
  docs: Array<{ id: string; data: () => Record<string, unknown> }>,
  nowMs: number
): (typeof docs)[number] | null {
  let best: (typeof docs)[number] | null = null;
  let bestT = -Infinity;
  for (const d of docs) {
    const raw = d.data() as Record<string, unknown>;
    if (!archivedQualifiesForThankYou(raw, nowMs)) continue;
    const t = archivedEventTimeMs(raw);
    if (t >= bestT) {
      bestT = t;
      best = d;
    }
  }
  return best;
}

async function fetchRecentArchivedByTime(
  fs: ReturnType<typeof getAdminFirestore>,
  uid: string,
  sinceTs: Timestamp
): Promise<Array<{ id: string; data: () => Record<string, unknown> }>> {
  const out: Array<{ id: string; data: () => Record<string, unknown> }> = [];
  const tryPush = (snap: QuerySnapshot) => {
    for (const d of snap.docs) {
      out.push(d as { id: string; data: () => Record<string, unknown> });
    }
  };
  try {
    const [m, p] = await Promise.all([
      fs
        .collection("archived_visits")
        .where("masterId", "==", uid)
        .where("archivedAt", ">=", sinceTs)
        .orderBy("archivedAt", "desc")
        .limit(15)
        .get(),
      fs
        .collection("archived_visits")
        .where("participantUids", "array-contains", uid)
        .where("archivedAt", ">=", sinceTs)
        .orderBy("archivedAt", "desc")
        .limit(15)
        .get(),
    ]);
    tryPush(m);
    tryPush(p);
  } catch {
    // нет индекса / поля archivedAt — опираемся на выборку по guestFeedbackPending ниже
  }
  return out;
}

/**
 * Единый серверный «автомат»: активная сессия → архив (ожидание отзыва или недавнее закрытие) → свободны.
 */
export async function resolveGuestPoliteState(globalGuestUid: string): Promise<ResolveGuestPoliteStateResult> {
  const uid = String(globalGuestUid ?? "").trim();
  if (!uid) return { phase: "free", globalGuestUid: "" };

  const fs = getAdminFirestore();
  const nowMs = Date.now();

  const [byMaster, byParticipant] = await Promise.all([
    fs
      .collection("activeSessions")
      .where("masterId", "==", uid)
      .where("status", "in", [...ACTIVE_SESSION_STATUS])
      .limit(25)
      .get(),
    fs
      .collection("activeSessions")
      .where("participantUids", "array-contains", uid)
      .where("status", "in", [...ACTIVE_SESSION_STATUS])
      .limit(25)
      .get(),
  ]);

  const sessionById = new Map<string, (typeof byMaster.docs)[number]>();
  for (const d of byMaster.docs) sessionById.set(d.id, d);
  for (const d of byParticipant.docs) sessionById.set(d.id, d);

  const sessionPick = pickNewestFreshActiveSessionDoc([...sessionById.values()], nowMs);
  if (sessionPick) {
    const data = sessionPick.data() as Record<string, unknown>;
    const venueId = String(data.venueId ?? "").trim();
    const tableId = String(data.tableId ?? "").trim();
    if (venueId && tableId) {
      await syncGuestGlobalProfileOnVisit(fs, {
        globalUid: uid,
        venueId,
        tableId,
      });
      return {
        phase: "working",
        globalGuestUid: uid,
        venueId,
        tableId,
        sessionId: sessionPick.id,
      };
    }
  }

  const sinceTs = Timestamp.fromMillis(nowMs - ARCHIVE_RECENT_MS);

  const [archPendingMaster, archPendingParticipant, recentTimeDocs] = await Promise.all([
    fs
      .collection("archived_visits")
      .where("masterId", "==", uid)
      .where("guestFeedbackPending", "==", true)
      .limit(15)
      .get(),
    fs
      .collection("archived_visits")
      .where("participantUids", "array-contains", uid)
      .where("guestFeedbackPending", "==", true)
      .limit(15)
      .get(),
    fetchRecentArchivedByTime(fs, uid, sinceTs),
  ]);

  const archById = new Map<string, { id: string; data: () => Record<string, unknown> }>();
  const add = (snap: typeof archPendingMaster) => {
    for (const d of snap.docs) {
      archById.set(d.id, d as { id: string; data: () => Record<string, unknown> });
    }
  };
  add(archPendingMaster);
  add(archPendingParticipant);
  for (const d of recentTimeDocs) {
    archById.set(d.id, d);
  }

  const archPick = pickBestArchivedThankYouDoc([...archById.values()], nowMs);
  if (archPick) {
    const raw = archPick.data() as Record<string, unknown>;
    const staff =
      typeof raw.assignedStaffId === "string" && raw.assignedStaffId.trim()
        ? raw.assignedStaffId.trim()
        : null;
    return {
      phase: "thank_you",
      globalGuestUid: uid,
      visitId: archPick.id,
      venueId: String(raw.venueId ?? "").trim(),
      tableId: String(raw.tableId ?? "").trim(),
      tableNumber: typeof raw.tableNumber === "number" ? raw.tableNumber : 0,
      feedbackStaffId: staff,
    };
  }

  return { phase: "free", globalGuestUid: uid };
}
