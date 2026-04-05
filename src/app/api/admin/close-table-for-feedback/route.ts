import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  ACTIVE_SESSIONS_ORDER_AWAITING_FEEDBACK,
  activeSessionsIndexDocIdForTelegramUser,
  collectTelegramNumericIdsFromSessionDoc,
} from "@/lib/active-sessions-index";

export const runtime = "nodejs";

const IDX = "active_sessions";

/**
 * POST /api/admin/close-table-for-feedback
 * Закрывает визит для гостя: сессия → awaiting_guest_feedback, индекс active_sessions → AWAITING_FEEDBACK, стол освобождается.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      venueId?: string;
      tableId?: string;
      sessionId?: string;
    };
    const venueId = String(body.venueId ?? "").trim();
    const tableId = String(body.tableId ?? "").trim();
    const sessionId = String(body.sessionId ?? "").trim();
    if (!venueId || !tableId || !sessionId) {
      return NextResponse.json({ error: "venueId, tableId, sessionId required" }, { status: 400 });
    }

    const fs = getAdminFirestore();
    const sessionRef = fs.collection("activeSessions").doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) {
      return NextResponse.json({ error: "session_not_found" }, { status: 404 });
    }
    const sData = (sessionSnap.data() ?? {}) as Record<string, unknown>;
    if (String(sData.venueId ?? "").trim() !== venueId || String(sData.tableId ?? "").trim() !== tableId) {
      return NextResponse.json({ error: "session_mismatch" }, { status: 400 });
    }
    const st = String(sData.status ?? "").trim();
    if (st !== "check_in_success" && st !== "awaiting_guest_feedback") {
      return NextResponse.json({ error: "session_not_active" }, { status: 409 });
    }

    const tgIds = collectTelegramNumericIdsFromSessionDoc(sData);
    const tableRef = fs.doc(`venues/${venueId}/tables/${tableId}`);
    const tableSnap = await tableRef.get();
    const existing = tableSnap.exists ? (tableSnap.data() ?? {}) : {};
    const assignments = (existing.assignments as Record<string, string> | undefined) ?? {};

    const batch = fs.batch();
    batch.update(sessionRef, {
      status: "awaiting_guest_feedback",
      feedbackRequestedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(
      tableRef,
      {
        status: "free",
        currentGuest: null,
        assignments,
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

    await batch.commit();
    return NextResponse.json({ ok: true, indexedGuests: tgIds.length });
  } catch (e) {
    console.error("[admin/close-table-for-feedback]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server_error" },
      { status: 500 }
    );
  }
}
