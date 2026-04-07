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
import {
  ACTIVE_SESSIONS_ORDER_AWAITING_FEEDBACK,
  activeSessionsIndexDocIdForTelegramUser,
  collectTelegramNumericIdsFromSessionDoc,
} from "@/lib/active-sessions-index";
import { getWaiterIdFromTablePayload } from "@/lib/standards/table-waiter";

const IDX = "active_sessions";

/** В кодовой базе свободный стол = Table.status "free" (аналог «vacant»). */
export const TABLE_STATUS_VACANT = "free" as const;

export type CloseAwaitingFeedbackResult =
  | { ok: true; indexedGuests: number }
  | { ok: false; error: string; httpStatus: number };

/**
 * Только админ-дашборд: визит завершён — сессия в фазу отзыва, стол свободен, индекс active_sessions обновлён.
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

  const tgIds = collectTelegramNumericIdsFromSessionDoc(sData);
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

  try {
    await batch.commit();
  } catch (e) {
    console.error("[closeSessionAwaitingGuestFeedback]", e);
    return { ok: false, error: e instanceof Error ? e.message : "batch_failed", httpStatus: 500 };
  }
  return { ok: true, indexedGuests: tgIds.length };
}

export type CloseSessionClosedResult = { ok: true } | { ok: false; error: string };

/**
 * Финальный шаг гостя после экрана отзыва: сессия → closed (если в нужной фазе), индекс → visit_ended.
 * Стол на этом шаге уже свободен. Один batch — сессия и индекс без рассинхрона.
 */
export async function finalizeGuestSessionClosedAfterFeedback(params: {
  venueId: string;
  tableId: string;
  sessionId: string;
  telegramUserId: string;
}): Promise<CloseSessionClosedResult> {
  const venueId = String(params.venueId ?? "").trim();
  const tableId = String(params.tableId ?? "").trim();
  const sessionId = String(params.sessionId ?? "").trim();
  const telegramUserId = String(params.telegramUserId ?? "").trim();
  if (!venueId || !tableId || !sessionId || !telegramUserId) {
    return { ok: false, error: "venueId, tableId, sessionId, telegramUserId required" };
  }

  const fs = getAdminFirestore();
  const sessionRef = fs.collection("activeSessions").doc(sessionId);
  const idxId = activeSessionsIndexDocIdForTelegramUser(telegramUserId);
  if (!idxId) {
    return { ok: false, error: "invalid_telegram_user" };
  }
  const idxRef = fs.collection(IDX).doc(idxId);

  const sessionSnap = await sessionRef.get();
  const batch = fs.batch();
  if (sessionSnap.exists) {
    const sData = (sessionSnap.data() ?? {}) as Record<string, unknown>;
    const v = String(sData.venueId ?? "").trim() === venueId;
    const t = String(sData.tableId ?? "").trim() === tableId;
    if (v && t) {
      const st = String(sData.status ?? "").trim();
      if (st === "awaiting_guest_feedback" || st === "completed") {
        batch.update(sessionRef, {
          status: "closed",
          closedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  }
  batch.set(
    idxRef,
    {
      last_seen: FieldValue.serverTimestamp(),
      order_status: "visit_ended",
    },
    { merge: true }
  );

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
  const batch = fs.batch();
  batch.update(sessionRef, {
    status: "closed",
    closedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
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
    return { ok: true };
  } catch (e) {
    console.error("[closeSessionForceClosedAndFreeTable]", e);
    return { ok: false, error: e instanceof Error ? e.message : "batch_failed" };
  }
}
