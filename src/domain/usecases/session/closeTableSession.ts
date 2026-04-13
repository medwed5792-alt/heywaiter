/**
 * Единая точка: завершение боя за столом + освобождение стола.
 *
 * Каскадная модель:
 * — Ступень 1 (бой): только документы в activeSessions со статусами обслуживания.
 * — Админ «Закрыть стол»: атомарно перенос (set + delete) в archived_visits, запись из activeSessions удаляется.
 * — Ступень 2 (сервис): гость работает только с archived_visits (guestFeedbackPending), без activeSessions.
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

/** Статусы, при которых документ ещё считается «боевой» сессией в activeSessions (до переноса в архив). */
const BATTLE_SESSION_STATUSES = [
  "check_in_success",
  "payment_confirmed",
  "awaiting_guest_feedback",
  "completed",
] as const;

/**
 * Админ: завершить обслуживание — перенос снимка в archived_visits и удаление из activeSessions в одном batch.
 * Стол освобождается; Staff-Lock снимается вместе с currentGuest.
 */
export async function finishServiceAndMoveToArchive(params: {
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
  const archiveRef = fs.collection("archived_visits").doc(sessionId);

  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    const arch = await archiveRef.get();
    if (arch.exists) {
      return { ok: true };
    }
    return { ok: false, error: "session_not_found", httpStatus: 404 };
  }

  const sData = (sessionSnap.data() ?? {}) as Record<string, unknown>;
  if (String(sData.venueId ?? "").trim() !== venueId || String(sData.tableId ?? "").trim() !== tableId) {
    return { ok: false, error: "session_mismatch", httpStatus: 400 };
  }
  const st = String(sData.status ?? "").trim();
  if (!BATTLE_SESSION_STATUSES.includes(st as (typeof BATTLE_SESSION_STATUSES)[number])) {
    return { ok: false, error: "session_not_active", httpStatus: 409 };
  }

  const tableSnap = await tableRef.get();
  const existing = tableSnap.exists ? (tableSnap.data() ?? {}) : {};
  const waiterSwid = getWaiterIdFromTablePayload(existing as Record<string, unknown>);

  const archivedPayload = await buildArchivedVisitPayload(fs, sessionId, sData, "service_finished");
  const archiveDoc: Record<string, unknown> = {
    ...archivedPayload,
    guestFeedbackPending: true,
    ...(waiterSwid ? { assignedStaffId: waiterSwid } : {}),
    ...(params.participants !== undefined
      ? { participants: params.participants }
      : Array.isArray(sData.participants)
        ? { participants: sData.participants }
        : {}),
  };

  const batch = fs.batch();
  batch.set(archiveRef, archiveDoc, { merge: false });
  batch.delete(sessionRef);
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
    console.error("[finishServiceAndMoveToArchive]", e);
    return { ok: false, error: e instanceof Error ? e.message : "batch_failed", httpStatus: 500 };
  }
  return { ok: true };
}

/** @deprecated Имя сохранено для совместимости импортов; используйте finishServiceAndMoveToArchive. */
export const closeSessionAwaitingGuestFeedback = finishServiceAndMoveToArchive;

export type CloseSessionClosedResult = { ok: true } | { ok: false; error: string };

/**
 * Гость завершил отзыв: только archived_visits (activeSessions уже нет).
 */
export async function finalizeArchivedVisitAfterGuestFeedback(params: {
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
  const archiveRef = fs.collection("archived_visits").doc(sessionId);
  const snap = await archiveRef.get();
  if (!snap.exists) {
    return { ok: true };
  }
  const d = (snap.data() ?? {}) as Record<string, unknown>;
  if (String(d.venueId ?? "").trim() !== venueId || String(d.tableId ?? "").trim() !== tableId) {
    return { ok: false, error: "session_mismatch" };
  }
  if (d.guestFeedbackPending !== true) {
    return { ok: true };
  }

  try {
    await archiveRef.update({
      guestFeedbackPending: false,
      guestFeedbackFinalizedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  } catch (e) {
    console.error("[finalizeArchivedVisitAfterGuestFeedback]", e);
    return { ok: false, error: e instanceof Error ? e.message : "update_failed" };
  }
}

/** @deprecated */
export const finalizeGuestSessionClosedAfterFeedback = finalizeArchivedVisitAfterGuestFeedback;

/**
 * Принудительно: архив + удаление activeSessions + стол free в одном batch.
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
  const archiveRef = fs.collection("archived_visits").doc(sessionId);

  const sessionSnap = await sessionRef.get();
  const tableSnap = await tableRef.get();
  if (!sessionSnap.exists) {
    const arch = await archiveRef.get();
    if (arch.exists) {
      const batchFree = fs.batch();
      const existing = tableSnap.exists ? (tableSnap.data() ?? {}) : {};
      batchFree.set(
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
        await batchFree.commit();
      } catch (e) {
        console.error("[closeSessionForceClosedAndFreeTable] free table", e);
        return { ok: false, error: e instanceof Error ? e.message : "batch_failed" };
      }
      return { ok: true };
    }
    return { ok: false, error: "session_not_found" };
  }
  const sData = (sessionSnap.data() ?? {}) as Record<string, unknown>;
  if (String(sData.venueId ?? "").trim() !== venueId || String(sData.tableId ?? "").trim() !== tableId) {
    return { ok: false, error: "session_mismatch" };
  }

  const existing = tableSnap.exists ? (tableSnap.data() ?? {}) : {};
  const archiveSnap = await archiveRef.get();
  let archivedPayload: Record<string, unknown> | null = null;
  if (!archiveSnap.exists) {
    archivedPayload = await buildArchivedVisitPayload(fs, sessionId, sData, "force_closed");
  }

  const batch = fs.batch();
  if (archivedPayload) {
    batch.set(
      archiveRef,
      { ...archivedPayload, guestFeedbackPending: false },
      { merge: false }
    );
  }
  batch.delete(sessionRef);
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
