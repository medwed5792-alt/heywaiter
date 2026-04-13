import { getAdminFirestore } from "@/lib/firebase-admin";
import { syncGuestGlobalProfileOnVisit } from "@/lib/identity/guest-global-profile";
import { pickNewestFreshActiveSessionDoc } from "@/lib/session-freshness";

const ACTIVE_SESSION_STATUS = ["check_in_success", "payment_confirmed"] as const;

export type GuestPolitePhase = "working" | "thank_you" | "free";

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

/**
 * Единый серверный «автомат»: активная сессия → архив с отзывом → свободны.
 * Телефон не читает archived_visits и не восстанавливает стол из localStorage.
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

  const [archMaster, archParticipant] = await Promise.all([
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
  ]);

  const archById = new Map<string, (typeof archMaster.docs)[number]>();
  for (const d of archMaster.docs) archById.set(d.id, d);
  for (const d of archParticipant.docs) archById.set(d.id, d);

  const archPick = pickNewestFreshActiveSessionDoc([...archById.values()], nowMs);
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
