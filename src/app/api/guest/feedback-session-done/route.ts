import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getEffectiveBotToken } from "@/lib/webhook/bots-store";
import {
  ACTIVE_SESSIONS_ORDER_AWAITING_FEEDBACK,
  activeSessionsIndexDocIdForTelegramUser,
} from "@/lib/active-sessions-index";
import { verifyTelegramWebAppInitData } from "@/lib/telegram-webapp-init-data";

export const runtime = "nodejs";

const IDX = "active_sessions";

/**
 * POST /api/guest/feedback-session-done
 * После экрана отзыва: закрывает доменную сессию стола и сбрасывает фазу в индексе active_sessions.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { initData?: string };
    const initData = typeof body.initData === "string" ? body.initData.trim() : "";
    if (!initData) {
      return NextResponse.json({ error: "initData required" }, { status: 400 });
    }

    const token = await getEffectiveBotToken("telegram", "client");
    if (!token) {
      return NextResponse.json({ error: "guest_bot_token_unconfigured" }, { status: 503 });
    }
    const v = verifyTelegramWebAppInitData(initData, token);
    if (!v.ok) {
      return NextResponse.json({ error: v.reason }, { status: 401 });
    }

    const fs = getAdminFirestore();
    const idxRef = fs.collection(IDX).doc(activeSessionsIndexDocIdForTelegramUser(v.userId));
    const idxSnap = await idxRef.get();
    if (!idxSnap.exists) {
      return NextResponse.json({ ok: true, already: true });
    }
    const idx = (idxSnap.data() ?? {}) as { vr_id?: string; table_id?: string; order_status?: string };
    const vrId = typeof idx.vr_id === "string" ? idx.vr_id.trim() : "";
    const tableId = typeof idx.table_id === "string" ? idx.table_id.trim() : "";
    const os = typeof idx.order_status === "string" ? idx.order_status.trim() : "";
    if (!vrId || !tableId) {
      await idxRef.delete().catch(() => undefined);
      return NextResponse.json({ ok: true });
    }
    if (os !== ACTIVE_SESSIONS_ORDER_AWAITING_FEEDBACK) {
      return NextResponse.json({ ok: true, already: true });
    }

    const q = await fs
      .collection("activeSessions")
      .where("venueId", "==", vrId)
      .where("tableId", "==", tableId)
      .where("status", "in", ["awaiting_guest_feedback", "completed"])
      .limit(1)
      .get();

    const batch = fs.batch();
    if (!q.empty) {
      batch.update(q.docs[0]!.ref, {
        status: "closed",
        closedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    batch.set(
      idxRef,
      {
        last_seen: FieldValue.serverTimestamp(),
        order_status: "visit_ended",
      },
      { merge: true }
    );
    await batch.commit();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/guest/feedback-session-done]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server_error" },
      { status: 500 }
    );
  }
}
