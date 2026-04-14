import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  FEEDBACK_SESSION_ID_PREFIX,
  GUEST_FEEDBACK_ACT_STATUS,
} from "@/lib/feedback-act-session";
import { findGuestExistingBattleSessionDoc } from "@/domain/usecases/check-in/checkInGuest";
import { resolveGuestPoliteState } from "@/domain/usecases/guest/resolveGuestPoliteState";
import { canonicalGlobalUserLookupKeys } from "@/lib/identity/global-user-session-lookup-keys";
import { isActiveSessionWithinMaxAge } from "@/lib/session-freshness";

export type GuestMiniAppServerStatus = "WORKING" | "FEEDBACK" | "WELCOME";

export type ResolveGuestCurrentStatusResult =
  | {
      status: "WORKING";
      globalUserFirestoreId: string;
      act1: { venueId: string; tableId: string; sessionId: string };
    }
  | {
      status: "FEEDBACK";
      globalUserFirestoreId: string;
      act2: {
        visitId: string;
        feedbackActSessionId: string;
        venueId: string;
        tableId: string;
        tableNumber: number;
        feedbackStaffId: string | null;
      };
    }
  | {
      status: "WELCOME";
      globalUserFirestoreId: string;
    };

function visitTimestampMillis(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  if (v && typeof v === "object" && "seconds" in v && typeof (v as { seconds: number }).seconds === "number") {
    return (v as { seconds: number }).seconds * 1000;
  }
  return 0;
}

async function findBestFeedbackActForCanonicalUid(
  canonicalUid: string,
  nowMs: number
): Promise<QueryDocumentSnapshot | null> {
  const uid = String(canonicalUid ?? "").trim();
  if (!uid) return null;
  const fs = getAdminFirestore();
  const byId = new Map<string, QueryDocumentSnapshot>();

  try {
    const m = await fs
      .collection("activeSessions")
      .where("sessionKind", "==", "feedback_act")
      .where("status", "==", GUEST_FEEDBACK_ACT_STATUS)
      .where("masterId", "==", uid)
      .limit(25)
      .get();
    for (const d of m.docs) byId.set(d.id, d);
  } catch {
    /* */
  }

  try {
    const p = await fs
      .collection("activeSessions")
      .where("sessionKind", "==", "feedback_act")
      .where("status", "==", GUEST_FEEDBACK_ACT_STATUS)
      .where("participantUids", "array-contains", uid)
      .limit(25)
      .get();
    for (const d of p.docs) byId.set(d.id, d);
  } catch {
    /* */
  }

  const feedbackDocs = [...byId.values()].filter((d) => d.id.startsWith(FEEDBACK_SESSION_ID_PREFIX));
  const fresh = feedbackDocs.filter((d) => isActiveSessionWithinMaxAge(d.data() as Record<string, unknown>, nowMs));
  const pool = fresh.length > 0 ? fresh : feedbackDocs;
  if (pool.length === 0) return null;
  return pool.sort((a, b) => {
    const ta = visitTimestampMillis((a.data() as Record<string, unknown>).createdAt);
    const tb = visitTimestampMillis((b.data() as Record<string, unknown>).createdAt);
    return tb - ta;
  })[0]!;
}

function feedbackFromSnap(
  picked: QueryDocumentSnapshot,
  globalUserFirestoreId: string
): Extract<ResolveGuestCurrentStatusResult, { status: "FEEDBACK" }> {
  const raw = (picked.data() ?? {}) as Record<string, unknown>;
  const visitId =
    typeof raw.sourceSessionId === "string" && raw.sourceSessionId.trim()
      ? raw.sourceSessionId.trim()
      : picked.id.replace(FEEDBACK_SESSION_ID_PREFIX, "").trim();
  const staff =
    typeof raw.assignedStaffId === "string" && raw.assignedStaffId.trim()
      ? raw.assignedStaffId.trim()
      : null;
  return {
    status: "FEEDBACK",
    globalUserFirestoreId,
    act2: {
      visitId,
      feedbackActSessionId: picked.id,
      venueId: String(raw.venueId ?? "").trim(),
      tableId: String(raw.tableId ?? "").trim(),
      tableNumber: typeof raw.tableNumber === "number" ? raw.tableNumber : 0,
      feedbackStaffId: staff,
    },
  };
}

/**
 * Фаза гостя только по каноническому id global_users (без tg:/legacy в запросах).
 */
export async function resolveGuestCurrentStatusFromProfile(args: {
  profileDocId: string;
  profileData: Record<string, unknown>;
}): Promise<ResolveGuestCurrentStatusResult | null> {
  const profileDocId = String(args.profileDocId ?? "").trim();
  if (!profileDocId) return null;

  const lookupKeys = canonicalGlobalUserLookupKeys(profileDocId);
  if (lookupKeys.length === 0) {
    return { status: "WELCOME", globalUserFirestoreId: profileDocId };
  }

  const fs = getAdminFirestore();
  const nowMs = Date.now();

  const battle = await findGuestExistingBattleSessionDoc(fs, lookupKeys, nowMs);
  if (battle) {
    const d = battle.data() as Record<string, unknown>;
    const venueId = String(d.venueId ?? "").trim();
    const tableId = String(d.tableId ?? "").trim();
    if (venueId && tableId) {
      return {
        status: "WORKING",
        globalUserFirestoreId: profileDocId,
        act1: { venueId, tableId, sessionId: battle.id },
      };
    }
  }

  const polite = await resolveGuestPoliteState(profileDocId);
  if (polite.phase === "thank_you") {
    return {
      status: "FEEDBACK",
      globalUserFirestoreId: profileDocId,
      act2: {
        visitId: polite.visitId,
        feedbackActSessionId: polite.feedbackActSessionId,
        venueId: polite.venueId,
        tableId: polite.tableId,
        tableNumber: polite.tableNumber,
        feedbackStaffId: polite.feedbackStaffId,
      },
    };
  }

  const feedbackSnap = await findBestFeedbackActForCanonicalUid(profileDocId, nowMs);
  if (feedbackSnap) {
    const raw = feedbackSnap.data() as Record<string, unknown>;
    const v = String(raw.venueId ?? "").trim();
    const t = String(raw.tableId ?? "").trim();
    if (v && t) {
      return feedbackFromSnap(feedbackSnap, profileDocId);
    }
  }

  return { status: "WELCOME", globalUserFirestoreId: profileDocId };
}
