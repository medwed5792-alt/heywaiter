import { NextRequest, NextResponse } from "next/server";
import { closeSessionAwaitingGuestFeedback } from "@/domain/usecases/session/closeTableSession";

export const runtime = "nodejs";

/**
 * POST /api/admin/close-table-for-feedback
 * Закрывает визит для гостя: сессия → awaiting_guest_feedback, стол освобождается (activeSessions — единственный источник).
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

    const result = await closeSessionAwaitingGuestFeedback({ venueId, tableId, sessionId });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.httpStatus });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[admin/close-table-for-feedback]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server_error" },
      { status: 500 }
    );
  }
}
