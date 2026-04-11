/**
 * Поиск сессии гостя в фазе пост-визита (отзыв / чаевые) в коллекции activeSessions.
 * Учитывает global_users id и канонический tg:&lt;id&gt; в masterId / participantUids.
 */

import type { Firestore, QueryDocumentSnapshot, QuerySnapshot } from "firebase-admin/firestore";
import { buildTgCustomerUid } from "@/lib/identity/customer-uid";
import { findGuestByExternalIdentity } from "@/lib/identity/global-guest-hub";
import { pickNewestFreshActiveSessionDoc } from "@/lib/session-freshness";

const FEEDBACK_PHASE_STATUSES = ["awaiting_guest_feedback", "completed"] as const;

export async function findActiveSessionInGuestFeedbackPhaseForTelegramUser(
  firestore: Firestore,
  telegramUserId: string
): Promise<QueryDocumentSnapshot | null> {
  const tg = String(telegramUserId ?? "").trim();
  if (!tg) return null;

  const tgCustomerUid = buildTgCustomerUid(tg);
  const globalUid = String((await findGuestByExternalIdentity("tg", tg)) ?? "").trim();

  const queries: Promise<QuerySnapshot>[] = [];

  if (globalUid) {
    queries.push(
      firestore
        .collection("activeSessions")
        .where("masterId", "==", globalUid)
        .where("status", "in", [...FEEDBACK_PHASE_STATUSES])
        .limit(15)
        .get()
    );
    queries.push(
      firestore
        .collection("activeSessions")
        .where("participantUids", "array-contains", globalUid)
        .where("status", "in", [...FEEDBACK_PHASE_STATUSES])
        .limit(15)
        .get()
    );
  }

  queries.push(
    firestore
      .collection("activeSessions")
      .where("masterId", "==", tgCustomerUid)
      .where("status", "in", [...FEEDBACK_PHASE_STATUSES])
      .limit(15)
      .get()
  );
  queries.push(
    firestore
      .collection("activeSessions")
      .where("participantUids", "array-contains", tgCustomerUid)
      .where("status", "in", [...FEEDBACK_PHASE_STATUSES])
      .limit(15)
      .get()
  );

  const snaps = await Promise.all(queries);
  const byId = new Map<string, QueryDocumentSnapshot>();
  for (const snap of snaps) {
    for (const d of snap.docs) {
      byId.set(d.id, d);
    }
  }
  return pickNewestFreshActiveSessionDoc([...byId.values()], Date.now());
}
