import { NextRequest, NextResponse } from "next/server";
import { getEffectiveBotToken } from "@/lib/webhook/bots-store";
import { verifyTelegramWebAppInitData } from "@/lib/telegram-webapp-init-data";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { finalizeArchivedVisitAfterGuestFeedback } from "@/domain/usecases/session/closeTableSession";
import { findArchivedVisitPendingFeedbackForTelegramUser } from "@/lib/active-session-feedback-phase";

export const runtime = "nodejs";

/**
 * POST /api/guest/feedback-session-done
 * После экрана отзыва: ищем сессию в activeSessions (masterId / participantUids + фаза отзыва),
 * затем archived_visits.guestFeedbackPending → false (finalizeArchivedVisitAfterGuestFeedback).
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
    const archiveDoc = await findArchivedVisitPendingFeedbackForTelegramUser(fs, v.userId);
    if (!archiveDoc) {
      return NextResponse.json({ ok: true, already: true });
    }

    const s = archiveDoc.data() as Record<string, unknown>;
    const venueId = String(s.venueId ?? "").trim();
    const tableId = String(s.tableId ?? "").trim();
    if (!venueId || !tableId) {
      return NextResponse.json({ ok: true, already: true });
    }

    const done = await finalizeArchivedVisitAfterGuestFeedback({
      venueId,
      tableId,
      sessionId: archiveDoc.id,
    });
    if (!done.ok) {
      return NextResponse.json({ error: done.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/guest/feedback-session-done]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server_error" },
      { status: 500 }
    );
  }
}
