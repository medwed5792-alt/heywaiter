/**
 * Поиск архивного визита в фазе отзыва (Ступень 2) для Telegram-пользователя.
 * Данные только в archived_visits; activeSessions не используется.
 */

import type { Firestore, QueryDocumentSnapshot, QuerySnapshot } from "firebase-admin/firestore";
import { buildTgCustomerUid } from "@/lib/identity/customer-uid";
import { findGuestByExternalIdentity } from "@/lib/identity/global-guest-hub";
import { pickNewestFreshActiveSessionDoc } from "@/lib/session-freshness";

/** archived_visits: поле guestFeedbackPending + свежий createdAt из снимка сессии */
export async function findArchivedVisitPendingFeedbackForTelegramUser(
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
        .collection("archived_visits")
        .where("masterId", "==", globalUid)
        .where("guestFeedbackPending", "==", true)
        .limit(15)
        .get()
    );
    queries.push(
      firestore
        .collection("archived_visits")
        .where("participantUids", "array-contains", globalUid)
        .where("guestFeedbackPending", "==", true)
        .limit(15)
        .get()
    );
  }

  queries.push(
    firestore
      .collection("archived_visits")
      .where("masterId", "==", tgCustomerUid)
      .where("guestFeedbackPending", "==", true)
      .limit(15)
      .get()
  );
  queries.push(
    firestore
      .collection("archived_visits")
      .where("participantUids", "array-contains", tgCustomerUid)
      .where("guestFeedbackPending", "==", true)
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

/** @deprecated Используйте findArchivedVisitPendingFeedbackForTelegramUser */
export async function findActiveSessionInGuestFeedbackPhaseForTelegramUser(
  firestore: Firestore,
  telegramUserId: string
): Promise<QueryDocumentSnapshot | null> {
  return findArchivedVisitPendingFeedbackForTelegramUser(firestore, telegramUserId);
}
