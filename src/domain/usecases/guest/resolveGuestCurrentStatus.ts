import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  FEEDBACK_SESSION_ID_PREFIX,
  GUEST_FEEDBACK_ACT_STATUS,
} from "@/lib/feedback-act-session";
import { findGuestExistingBattleSessionDoc } from "@/domain/usecases/check-in/checkInGuest";
import { resolveGuestPoliteState } from "@/domain/usecases/guest/resolveGuestPoliteState";
import {
  collectGlobalUserSessionLookupKeys,
  preferredClientSessionUid,
} from "@/lib/identity/global-user-session-lookup-keys";
import { isActiveSessionWithinMaxAge } from "@/lib/session-freshness";

export type GuestMiniAppServerStatus = "ACT_1" | "ACT_2" | "WELCOME";

export type ResolveGuestCurrentStatusResult =
  | {
      status: "ACT_1";
      globalUserFirestoreId: string;
      sessionParticipantUid: string;
      act1: { venueId: string; tableId: string; sessionId: string };
    }
  | {
      status: "ACT_2";
      globalUserFirestoreId: string;
      sessionParticipantUid: string;
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
      sessionParticipantUid: string;
    };

function chunkKeys(keys: string[], size: number): string[][] {
  const dedup = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
  const out: string[][] = [];
  for (let i = 0; i < dedup.length; i += size) out.push(dedup.slice(i, i + size));
  return out;
}

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

async function findBestFeedbackActForLookupKeys(
  lookupKeys: string[],
  nowMs: number
): Promise<QueryDocumentSnapshot | null> {
  if (lookupKeys.length === 0) return null;
  const fs = getAdminFirestore();
  const byId = new Map<string, QueryDocumentSnapshot>();

  for (const chunk of chunkKeys(lookupKeys, 10)) {
    try {
      const snap = await fs
        .collection("activeSessions")
        .where("sessionKind", "==", "feedback_act")
        .where("status", "==", GUEST_FEEDBACK_ACT_STATUS)
        .where("masterId", "in", chunk)
        .limit(25)
        .get();
      for (const d of snap.docs) byId.set(d.id, d);
    } catch {
      /* индекс / сеть */
    }
  }

  for (const chunk of chunkKeys(lookupKeys, 10)) {
    try {
      const snap = await fs
        .collection("activeSessions")
        .where("sessionKind", "==", "feedback_act")
        .where("status", "==", GUEST_FEEDBACK_ACT_STATUS)
        .where("participantUids", "array-contains-any", chunk)
        .limit(25)
        .get();
      for (const d of snap.docs) byId.set(d.id, d);
    } catch {
      try {
        for (const k of chunk) {
          const one = await fs
            .collection("activeSessions")
            .where("sessionKind", "==", "feedback_act")
            .where("status", "==", GUEST_FEEDBACK_ACT_STATUS)
            .where("participantUids", "array-contains", k)
            .limit(25)
            .get();
          for (const d of one.docs) byId.set(d.id, d);
        }
      } catch {
        /* */
      }
    }
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

function act2FromFeedbackSnap(
  picked: QueryDocumentSnapshot,
  globalUserFirestoreId: string,
  sessionParticipantUid: string
): Extract<ResolveGuestCurrentStatusResult, { status: "ACT_2" }> {
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
    status: "ACT_2",
    globalUserFirestoreId,
    sessionParticipantUid,
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

function pickBestThankYou(
  results: Awaited<ReturnType<typeof resolveGuestPoliteState>>[]
): Extract<Awaited<ReturnType<typeof resolveGuestPoliteState>>, { phase: "thank_you" }> | null {
  const thanks = results.filter((r): r is Extract<typeof r, { phase: "thank_you" }> => r.phase === "thank_you");
  if (thanks.length === 0) return null;
  if (thanks.length === 1) return thanks[0]!;
  return thanks.sort((a, b) => b.visitId.localeCompare(a.visitId))[0]!;
}

/**
 * Универсальный статус мини-аппа гостя по профилю global_users (все каналы из identities).
 */
export async function resolveGuestCurrentStatusFromProfile(args: {
  profileDocId: string;
  profileData: Record<string, unknown>;
}): Promise<ResolveGuestCurrentStatusResult | null> {
  const profileDocId = String(args.profileDocId ?? "").trim();
  if (!profileDocId) return null;

  const sessionParticipantUid = preferredClientSessionUid(profileDocId, args.profileData);
  const lookupKeys = collectGlobalUserSessionLookupKeys(profileDocId, args.profileData);
  if (lookupKeys.length === 0) {
    return { status: "WELCOME", globalUserFirestoreId: profileDocId, sessionParticipantUid };
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
        status: "ACT_1",
        globalUserFirestoreId: profileDocId,
        sessionParticipantUid,
        act1: { venueId, tableId, sessionId: battle.id },
      };
    }
  }

  const keySample = lookupKeys.slice(0, 12);
  const politeResults = await Promise.all(keySample.map((k) => resolveGuestPoliteState(k)));
  const thank = pickBestThankYou(politeResults);
  if (thank) {
    return {
      status: "ACT_2",
      globalUserFirestoreId: profileDocId,
      sessionParticipantUid,
      act2: {
        visitId: thank.visitId,
        feedbackActSessionId: thank.feedbackActSessionId,
        venueId: thank.venueId,
        tableId: thank.tableId,
        tableNumber: thank.tableNumber,
        feedbackStaffId: thank.feedbackStaffId,
      },
    };
  }

  const feedbackSnap = await findBestFeedbackActForLookupKeys(lookupKeys, nowMs);
  if (feedbackSnap) {
    const raw = feedbackSnap.data() as Record<string, unknown>;
    const v = String(raw.venueId ?? "").trim();
    const t = String(raw.tableId ?? "").trim();
    if (v && t) {
      return act2FromFeedbackSnap(feedbackSnap, profileDocId, sessionParticipantUid);
    }
  }

  return { status: "WELCOME", globalUserFirestoreId: profileDocId, sessionParticipantUid };
}
