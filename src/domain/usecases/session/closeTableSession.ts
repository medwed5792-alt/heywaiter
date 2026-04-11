/**
 * Единая точка: завершение сессии за столом + освобождение стола в venues/{venueId}/tables/{tableId}.
 * Статус «свободен» в схеме Table — "free" (см. Table.status).
 *
 * Протокол выхода: check_in_success/payment_confirmed → (только дашборд) awaiting_guest_feedback + стол free →
 * гость: отзыв → чаевые → closed (finalizeGuestSessionClosedAfterFeedback).
 * Статус closed + стол free принудительно: только админ-операции (force) или сброс зависших сессий.
 */
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getWaiterIdFromTablePayload } from "@/lib/standards/table-waiter";
import { buildArchivedVisitPayload } from "@/domain/usecases/session/archiveClosedVisit";

/** В кодовой базе свободный стол = Table.status "free" (аналог «vacant»). */
export const TABLE_STATUS_VACANT = "free" as const;

export type CloseAwaitingFeedbackResult =
  | { ok: true }
  | { ok: false; error: string; httpStatus: number };

/**
 * Только админ-дашборд: визит завершён — сессия в фазу отзыва, стол свободен.
 * Один `batch.commit()` — сессия и стол уходят в хранилище атомарно (без окна рассинхрона).
 * `participants` — опционально: список участников с тем же коммитом, что и переход в awaiting_guest_feedback.
 */
export async function closeSessionAwaitingGuestFeedback(params: {
  venueId: string;
  tableId: string;
  sessionId: string;
  participants?: unknown[];
}): Promise<CloseAwaitingFeedbackResult> {
  const venueId = String(params.venueId ?? "").trim();
  const tableId = String(params.tableId ?? "").trim();
  const sessionId = String(params.sessionId ?? "").trim();
  if (!venueId || !tableId || !sessionId) {
    return { ok: false, error: "venueId, tableId, sessionId required", httpStatus: 400 };
  }

  const fs = getAdminFirestore();
  const sessionRef = fs.collection("activeSessions").doc(sessionId);
  const tableRef = fs.doc(`venues/${venueId}/tables/${tableId}`);

  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    return { ok: false, error: "session_not_found", httpStatus: 404 };
  }
  const sData = (sessionSnap.data() ?? {}) as Record<string, unknown>;
  if (String(sData.venueId ?? "").trim() !== venueId || String(sData.tableId ?? "").trim() !== tableId) {
    return { ok: false, error: "session_mismatch", httpStatus: 400 };
  }
  const st = String(sData.status ?? "").trim();
  if (
    st !== "check_in_success" &&
    st !== "payment_confirmed" &&
    st !== "awaiting_guest_feedback" &&
    st !== "completed"
  ) {
    return { ok: false, error: "session_not_active", httpStatus: 409 };
  }

  const tableSnap = await tableRef.get();
  const existing = tableSnap.exists ? (tableSnap.data() ?? {}) : {};
  const waiterSwid = getWaiterIdFromTablePayload(existing as Record<string, unknown>);

  const batch = fs.batch();
  batch.update(sessionRef, {
    status: "awaiting_guest_feedback",
    feedbackRequestedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...(waiterSwid ? { assignedStaffId: waiterSwid } : {}),
    ...(params.participants !== undefined ? { participants: params.participants } : {}),
  });
  batch.set(
    tableRef,
    {
      status: TABLE_STATUS_VACANT,
      currentGuest: null,
      assignments: ((existing as Record<string, unknown>).assignments as Record<string, string> | undefined) ?? {},
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    await batch.commit();
  } catch (e) {
    console.error("[closeSessionAwaitingGuestFeedback]", e);
    return { ok: false, error: e instanceof Error ? e.message : "batch_failed", httpStatus: 500 };
  }
  return { ok: true };
}

export type CloseSessionClosedResult = { ok: true } | { ok: false; error: string };

/**
 * Финальный шаг гостя после экрана отзыва: сессия → closed (если в фазе awaiting_guest_feedback / completed).
 * Стол на этом шаге уже свободен.
 */
export async function finalizeGuestSessionClosedAfterFeedback(params: {
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
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    return { ok: true };
  }

  const sData = (sessionSnap.data() ?? {}) as Record<string, unknown>;
  const v = String(sData.venueId ?? "").trim() === venueId;
  const t = String(sData.tableId ?? "").trim() === tableId;
  if (!v || !t) {
    return { ok: false, error: "session_mismatch" };
  }

  const st = String(sData.status ?? "").trim();
  if (st !== "awaiting_guest_feedback" && st !== "completed") {
    return { ok: true };
  }

  const archiveRef = fs.collection("archived_visits").doc(sessionId);
  const archiveSnap = await archiveRef.get();
  let archivedPayload: Record<string, unknown> | null = null;
  if (!archiveSnap.exists) {
    archivedPayload = await buildArchivedVisitPayload(fs, sessionId, sData, "guest_feedback_finalized");
  }

  const batch = fs.batch();
  batch.update(sessionRef, {
    status: "closed",
    closedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  if (archivedPayload) {
    batch.set(archiveRef, archivedPayload);
  }

  try {
    await batch.commit();
    return { ok: true };
  } catch (e) {
    console.error("[finalizeGuestSessionClosedAfterFeedback]", e);
    return { ok: false, error: e instanceof Error ? e.message : "batch_failed" };
  }
}

/**
 * Принудительно: сессия → closed и стол free в одном batch.
 * Только админ-сценарии (зависшие сессии) — не путь гостя и не обычное закрытие из дашборда.
 */
export async function closeSessionForceClosedAndFreeTable(params: {
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

  const sessionSnap = await sessionRef.get();
  const tableSnap = await tableRef.get();
  if (!sessionSnap.exists) {
    return { ok: false, error: "session_not_found" };
  }
  const sData = (sessionSnap.data() ?? {}) as Record<string, unknown>;
  if (String(sData.venueId ?? "").trim() !== venueId || String(sData.tableId ?? "").trim() !== tableId) {
    return { ok: false, error: "session_mismatch" };
  }

  const existing = tableSnap.exists ? (tableSnap.data() ?? {}) : {};
  const archiveRef = fs.collection("archived_visits").doc(sessionId);
  const archiveSnap = await archiveRef.get();
  let archivedPayload: Record<string, unknown> | null = null;
  if (!archiveSnap.exists) {
    archivedPayload = await buildArchivedVisitPayload(fs, sessionId, sData, "force_closed");
  }

  const batch = fs.batch();
  batch.update(sessionRef, {
    status: "closed",
    closedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  if (archivedPayload) {
    batch.set(archiveRef, archivedPayload);
  }
  batch.set(
    tableRef,
    {
      status: TABLE_STATUS_VACANT,
      currentGuest: null,
      assignments: ((existing as Record<string, unknown>).assignments as Record<string, string> | undefined) ?? {},
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    await batch.commit();
    return { ok: true };
  } catch (e) {
    console.error("[closeSessionForceClosedAndFreeTable]", e);
    return { ok: false, error: e instanceof Error ? e.message : "batch_failed" };
  }
}
