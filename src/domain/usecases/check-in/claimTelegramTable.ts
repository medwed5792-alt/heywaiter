/**
 * Закрепление стола за Telegram-пользователем после проверки initData на API.
 * Склеивает типичный сценарий: check-in в браузере с anon:… → вход в Mini App с tg:…
 */

import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { guestCustomerUidsMatch } from "@/lib/identity/customer-uid";
import type {
  ActiveSessionParticipant,
  ActiveSessionParticipantStatus,
} from "@/lib/types";

function normalizeParticipants(raw: unknown): ActiveSessionParticipant[] {
  const now = new Date();
  if (!Array.isArray(raw)) return [];
  const out: ActiveSessionParticipant[] = [];
  for (const item of raw) {
    const d = (item ?? {}) as Record<string, unknown>;
    const uid = typeof d.uid === "string" ? d.uid.trim() : "";
    if (!uid) continue;
    const status = d.status as ActiveSessionParticipantStatus | undefined;
    out.push({
      uid,
      status: status === "paid" || status === "exited" ? status : "active",
      joinedAt: (d.joinedAt as Date) ?? now,
      updatedAt: (d.updatedAt as Date) ?? now,
    });
  }
  return out;
}

async function bumpGuestVisit(customerUid: string, venueId: string): Promise<void> {
  const firestore = getAdminFirestore();
  const ref = firestore.doc(`users/${customerUid}/visits/${venueId.trim()}`);
  await ref.set(
    {
      lastVisitAt: FieldValue.serverTimestamp(),
      totalVisits: FieldValue.increment(1),
    },
    { merge: true }
  );
}

export type ClaimTelegramTableResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: "no_session" | "table_private" | "invalid_input" };

/**
 * Добавляет tg-пользователя в активную сессию стола или переносит master/participants с anon: на tg:.
 */
export async function claimTelegramTableForVerifiedUser(input: {
  venueId: string;
  tableId: string;
  telegramUserId: string;
}): Promise<ClaimTelegramTableResult> {
  const venueId = input.venueId?.trim() ?? "";
  const tableId = input.tableId?.trim() ?? "";
  const tgRaw = String(input.telegramUserId ?? "").trim();
  if (!venueId || !tableId || !tgRaw) return { ok: false, error: "invalid_input" };

  const currentUid = `tg:${tgRaw}`;
  const firestore = getAdminFirestore();
  const now = new Date();

  const snap = await firestore
    .collection("activeSessions")
    .where("venueId", "==", venueId)
    .where("tableId", "==", tableId)
    .where("status", "==", "check_in_success")
    .limit(1)
    .get();

  if (snap.empty) return { ok: false, error: "no_session" };

  const docSnap = snap.docs[0]!;
  const existingData = docSnap.data() as Record<string, unknown>;
  const existingMasterId = (existingData.masterId as string | undefined)?.trim();
  const isPrivate =
    typeof existingData.isPrivate === "boolean" ? (existingData.isPrivate as boolean) : true;
  let participants = normalizeParticipants(existingData.participants);

  const existingParticipantIdx = participants.findIndex((p) => guestCustomerUidsMatch(p.uid, currentUid));
  const existingParticipant =
    existingParticipantIdx >= 0 ? participants[existingParticipantIdx]! : null;

  if (existingParticipant) {
    const nextStatus: ActiveSessionParticipantStatus =
      existingParticipant.status === "exited" ? "active" : existingParticipant.status;
    if (nextStatus !== existingParticipant.status) {
      participants[existingParticipantIdx] = {
        ...existingParticipant,
        status: nextStatus,
        updatedAt: now,
      };
      await firestore.collection("activeSessions").doc(docSnap.id).update({
        participants,
        updatedAt: now,
      });
      await bumpGuestVisit(currentUid, venueId);
    }
    return { ok: true, sessionId: docSnap.id };
  }

  // Приватный стол: в браузере остался master anon: — тот же гость заходит из Telegram.
  if (
    isPrivate &&
    existingMasterId?.startsWith("anon:") &&
    currentUid.startsWith("tg:") &&
    !guestCustomerUidsMatch(existingMasterId, currentUid)
  ) {
    const merged = participants.map((p) =>
      guestCustomerUidsMatch(p.uid, existingMasterId)
        ? { ...p, uid: currentUid, status: "active" as ActiveSessionParticipantStatus, updatedAt: now }
        : p
    );
    let nextParts = merged;
    if (!nextParts.some((p) => guestCustomerUidsMatch(p.uid, currentUid))) {
      nextParts = [
        ...merged,
        { uid: currentUid, status: "active" as const, joinedAt: now, updatedAt: now },
      ];
    }
    await firestore.collection("activeSessions").doc(docSnap.id).update({
      masterId: currentUid,
      participants: nextParts,
      updatedAt: now,
    });
    await bumpGuestVisit(currentUid, venueId);
    return { ok: true, sessionId: docSnap.id };
  }

  if (isPrivate && existingMasterId && !guestCustomerUidsMatch(existingMasterId, currentUid)) {
    return { ok: false, error: "table_private" };
  }

  if (!existingMasterId || !isPrivate || guestCustomerUidsMatch(existingMasterId, currentUid)) {
    participants = [...participants, { uid: currentUid, status: "active", joinedAt: now, updatedAt: now }];
    await firestore.collection("activeSessions").doc(docSnap.id).update({
      participants,
      ...(existingMasterId ? {} : { masterId: currentUid }),
      updatedAt: now,
    });
    await bumpGuestVisit(currentUid, venueId);
    return { ok: true, sessionId: docSnap.id };
  }

  return { ok: false, error: "table_private" };
}
