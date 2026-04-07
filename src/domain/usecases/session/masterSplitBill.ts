import { FieldValue } from "firebase-admin/firestore";
import type { ActiveSessionParticipant, ActiveSessionParticipantStatus } from "@/lib/types";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { buildTelegramCustomerUid, extractMessengerExternalIdFromCustomerUid } from "@/lib/identity/customer-uid";
import { releaseTableOccupancy } from "@/domain/usecases/session/closeTableSession";

type SessionDocShape = {
  masterId?: string;
  participants?: ActiveSessionParticipant[];
  isPrivate?: boolean;
  status?: string;
  venueId?: string;
  tableId?: string;
};

function normalizeParticipants(raw: unknown): ActiveSessionParticipant[] {
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
      joinedAt: d.joinedAt ?? new Date(),
      updatedAt: d.updatedAt ?? new Date(),
    });
  }
  return out;
}

async function getCurrentSessionRef(venueId: string, tableId: string) {
  const firestore = getAdminFirestore();
  const snap = await firestore
    .collection("activeSessions")
    .where("venueId", "==", venueId)
    .where("tableId", "==", tableId)
    .where("status", "==", "check_in_success")
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].ref;
}

export async function getCurrentSessionState(venueId: string, tableId: string) {
  const ref = await getCurrentSessionRef(venueId, tableId);
  if (!ref) return null;
  const snap = await ref.get();
  if (!snap.exists) return null;
  const d = (snap.data() || {}) as SessionDocShape;
  return {
    sessionId: snap.id,
    masterId: typeof d.masterId === "string" ? d.masterId : "",
    isPrivate: typeof d.isPrivate === "boolean" ? d.isPrivate : true,
    participants: normalizeParticipants(d.participants),
  };
}

export async function setTablePrivacy(
  venueId: string,
  tableId: string,
  actorUid: string,
  allowJoin: boolean
): Promise<{ ok: boolean; isPrivate?: boolean; error?: string }> {
  const uid = actorUid.trim();
  if (!uid) return { ok: false, error: "actorUid is required" };
  const ref = await getCurrentSessionRef(venueId, tableId);
  if (!ref) return { ok: false, error: "Session not found" };
  const firestore = getAdminFirestore();
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, error: "Session not found" };
    const d = (snap.data() || {}) as SessionDocShape;
    const masterId = typeof d.masterId === "string" ? d.masterId.trim() : "";
    if (!masterId || masterId !== uid) {
      return { ok: false, error: "Only master can change privacy" };
    }
    const isPrivate = !allowJoin;
    tx.update(ref, {
      isPrivate,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, isPrivate };
  });
}

export async function markParticipantPaid(
  venueId: string,
  tableId: string,
  uid: string
): Promise<{ ok: boolean; error?: string }> {
  const actor = uid.trim();
  if (!actor) return { ok: false, error: "uid is required" };
  const ref = await getCurrentSessionRef(venueId, tableId);
  if (!ref) return { ok: false, error: "Session not found" };
  const firestore = getAdminFirestore();
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, error: "Session not found" };
    const d = (snap.data() || {}) as SessionDocShape;
    const participants = normalizeParticipants(d.participants);
    const idx = participants.findIndex((p) => p.uid === actor);
    if (idx === -1) return { ok: false, error: "Participant not found" };
    participants[idx] = {
      ...participants[idx],
      status: "paid",
      updatedAt: new Date(),
    };
    tx.update(ref, {
      participants,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  });
}

export async function exitParticipant(
  venueId: string,
  tableId: string,
  uid: string
): Promise<{ ok: boolean; error?: string }> {
  const actor = uid.trim();
  if (!actor) return { ok: false, error: "uid is required" };
  const ref = await getCurrentSessionRef(venueId, tableId);
  if (!ref) return { ok: false, error: "Session not found" };
  const firestore = getAdminFirestore();
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, error: "Session not found" };
    const d = (snap.data() || {}) as SessionDocShape;
    const participants = normalizeParticipants(d.participants);
    const idx = participants.findIndex((p) => p.uid === actor);
    if (idx === -1) return { ok: false, error: "Participant not found" };
    participants[idx] = {
      ...participants[idx],
      status: "exited",
      updatedAt: new Date(),
    };
    tx.update(ref, {
      participants,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  });
}

export function canCloseTable(participants: ActiveSessionParticipant[]): boolean {
  // Table can be auto-closed only if there are no active participants.
  return participants.every((p) => p.status !== "active");
}

async function completeOrdersForTable(
  venueId: string,
  tableId: string,
  customerUid?: string
): Promise<{ updatedCount: number }> {
  const firestore = getAdminFirestore();
  const base = firestore
    .collection("orders")
    .where("venueId", "==", venueId)
    .where("tableId", "==", tableId)
    .where("status", "in", ["pending", "ready"]);

  const legacyTelegramId = extractMessengerExternalIdFromCustomerUid(customerUid ?? null);

  const [primarySnap, legacySnap] = await Promise.all([
    customerUid ? base.where("customerUid", "==", customerUid).get() : base.get(),
    legacyTelegramId ? base.where("guestChatId", "==", legacyTelegramId).get() : Promise.resolve(null),
  ]);

  const docs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const d of primarySnap.docs) docs.set(d.id, d);
  if (legacySnap) {
    for (const d of legacySnap.docs) docs.set(d.id, d);
  }
  if (docs.size === 0) return { updatedCount: 0 };

  const batch = firestore.batch();
  for (const doc of docs.values()) {
    const normalizedUid =
      customerUid ||
      buildTelegramCustomerUid((doc.data() as Record<string, unknown>).guestChatId as string | undefined);
    batch.update(doc.ref, {
      status: "completed",
      ...(normalizedUid ? { customerUid: normalizedUid } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return { updatedCount: docs.size };
}

export async function payMyBill(
  venueId: string,
  tableId: string,
  uid: string
): Promise<{ ok: boolean; updatedOrders?: number; error?: string }> {
  const actor = uid.trim();
  if (!actor) return { ok: false, error: "uid is required" };
  const { updatedCount } = await completeOrdersForTable(venueId, tableId, actor);
  const mark = await markParticipantPaid(venueId, tableId, actor);
  if (!mark.ok) return { ok: false, error: mark.error };
  return { ok: true, updatedOrders: updatedCount };
}

export async function closeTableByMaster(
  venueId: string,
  tableId: string,
  masterUid: string
): Promise<{ ok: boolean; closed?: boolean; updatedOrders?: number; error?: string }> {
  const actor = masterUid.trim();
  if (!actor) return { ok: false, error: "masterUid is required" };
  const ref = await getCurrentSessionRef(venueId, tableId);
  if (!ref) return { ok: false, error: "Session not found" };

  const firestore = getAdminFirestore();
  const state = await getCurrentSessionState(venueId, tableId);
  if (!state) return { ok: false, error: "Session not found" };
  if (state.masterId !== actor) return { ok: false, error: "Only master can close table" };

  const { updatedCount } = await completeOrdersForTable(venueId, tableId);

  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const d = (snap.data() || {}) as SessionDocShape;
    const participants = normalizeParticipants(d.participants).map((p) => ({
      ...p,
      status: p.status === "active" ? ("paid" as const) : p.status,
      updatedAt: new Date(),
    }));
    tx.update(ref, {
      participants,
      status: "closed",
      closedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  await releaseTableOccupancy(venueId, tableId);

  return { ok: true, closed: true, updatedOrders: updatedCount };
}

