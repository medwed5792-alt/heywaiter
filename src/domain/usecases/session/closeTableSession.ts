/**
 * Единая точка: завершение сессии за столом + освобождение стола в venues/{venueId}/tables/{tableId}.
 * Статус «свободен» в схеме Table — "free" (см. Table.status).
 */
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore, WriteBatch } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  ACTIVE_SESSIONS_ORDER_AWAITING_FEEDBACK,
  activeSessionsIndexDocIdForTelegramUser,
  collectTelegramNumericIdsFromSessionDoc,
} from "@/lib/active-sessions-index";
import { getWaiterIdFromTablePayload } from "@/lib/standards/table-waiter";

const IDX = "active_sessions";

/** В кодовой базе свободный стол = Table.status "free" (аналог «vacant»). */
export const TABLE_STATUS_VACANT = "free" as const;

export function applyReleaseTableToBatch(
  batch: WriteBatch,
  fs: Firestore,
  venueId: string,
  tableId: string,
  existingTableData: Record<string, unknown>
): void {
  const assignments = (existingTableData.assignments as Record<string, string> | undefined) ?? {};
  const tableRef = fs.doc(`venues/${venueId}/tables/${tableId}`);
  batch.set(
    tableRef,
    {
      status: TABLE_STATUS_VACANT,
      currentGuest: null,
      assignments,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Только освободить стол (после того как сессия уже обновлена в другой транзакции).
 */
export async function releaseTableOccupancy(venueId: string, tableId: string): Promise<void> {
  const v = venueId.trim();
  const t = tableId.trim();
  if (!v || !t) return;
  const fs = getAdminFirestore();
  const tableRef = fs.doc(`venues/${v}/tables/${t}`);
  const tableSnap = await tableRef.get();
  const existing = tableSnap.exists ? (tableSnap.data() ?? {}) : {};
  const batch = fs.batch();
  applyReleaseTableToBatch(batch, fs, v, t, existing as Record<string, unknown>);
  await batch.commit();
}

export type CloseAwaitingFeedbackResult =
  | { ok: true; indexedGuests: number }
  | { ok: false; error: string; httpStatus: number };

/**
 * Админ: визит завершён — сессия в фазу отзыва, стол свободен, индекс active_sessions обновлён.
 */
export async function closeSessionAwaitingGuestFeedback(params: {
  venueId: string;
  tableId: string;
  sessionId: string;
}): Promise<CloseAwaitingFeedbackResult> {
  const venueId = String(params.venueId ?? "").trim();
  const tableId = String(params.tableId ?? "").trim();
  const sessionId = String(params.sessionId ?? "").trim();
  if (!venueId || !tableId || !sessionId) {
    return { ok: false, error: "venueId, tableId, sessionId required", httpStatus: 400 };
  }

  const fs = getAdminFirestore();
  const sessionRef = fs.collection("activeSessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    return { ok: false, error: "session_not_found", httpStatus: 404 };
  }
  const sData = (sessionSnap.data() ?? {}) as Record<string, unknown>;
  if (String(sData.venueId ?? "").trim() !== venueId || String(sData.tableId ?? "").trim() !== tableId) {
    return { ok: false, error: "session_mismatch", httpStatus: 400 };
  }
  const st = String(sData.status ?? "").trim();
  if (st !== "check_in_success" && st !== "awaiting_guest_feedback" && st !== "completed") {
    return { ok: false, error: "session_not_active", httpStatus: 409 };
  }

  const tgIds = collectTelegramNumericIdsFromSessionDoc(sData);
  const tableRef = fs.doc(`venues/${venueId}/tables/${tableId}`);
  const tableSnap = await tableRef.get();
  const existing = tableSnap.exists ? (tableSnap.data() ?? {}) : {};
  const waiterSwid = getWaiterIdFromTablePayload(existing as Record<string, unknown>);

  const batch = fs.batch();
  batch.update(sessionRef, {
    status: "awaiting_guest_feedback",
    feedbackRequestedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...(waiterSwid ? { assignedStaffId: waiterSwid } : {}),
  });
  applyReleaseTableToBatch(batch, fs, venueId, tableId, existing as Record<string, unknown>);

  for (const tg of tgIds) {
    const idxId = activeSessionsIndexDocIdForTelegramUser(tg);
    if (!idxId) continue;
    batch.set(
      fs.collection(IDX).doc(idxId),
      {
        vr_id: venueId,
        table_id: tableId,
        last_seen: FieldValue.serverTimestamp(),
        order_status: ACTIVE_SESSIONS_ORDER_AWAITING_FEEDBACK,
      },
      { merge: true }
    );
  }

  await batch.commit();
  return { ok: true, indexedGuests: tgIds.length };
}

export type CloseSessionClosedResult = { ok: true } | { ok: false; error: string };

/**
 * Сессия закрыта окончательно (closed) + стол освобождён. Для бота и прямых закрытий без фазы отзыва.
 */
export async function closeSessionAsClosedAndFreeTable(params: {
  venueId: string;
  tableId: string;
  sessionId: string;
}): Promise<CloseSessionClosedResult> {
  const venueId = String(params.venueId ?? "").trim();
  const tableId = String(params.tableId ?? "").trim();
  const sessionId = String(params.sessionId ?? "").trim();
  if (!venueId || !tableId || !sessionId) {
    return { ok: false, error: "venueId, tableId, sessionId required" };
  }

  const fs = getAdminFirestore();
  const sessionRef = fs.collection("activeSessions").doc(sessionId);
  const tableRef = fs.doc(`venues/${venueId}/tables/${tableId}`);
  const [sessionSnap, tableSnap] = await Promise.all([sessionRef.get(), tableRef.get()]);
  if (!sessionSnap.exists) {
    return { ok: false, error: "session_not_found" };
  }
  const sData = (sessionSnap.data() ?? {}) as Record<string, unknown>;
  if (String(sData.venueId ?? "").trim() !== venueId || String(sData.tableId ?? "").trim() !== tableId) {
    return { ok: false, error: "session_mismatch" };
  }

  const existing = tableSnap.exists ? (tableSnap.data() ?? {}) : {};
  const batch = fs.batch();
  batch.update(sessionRef, {
    status: "closed",
    closedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  applyReleaseTableToBatch(batch, fs, venueId, tableId, existing as Record<string, unknown>);
  await batch.commit();
  return { ok: true };
}
