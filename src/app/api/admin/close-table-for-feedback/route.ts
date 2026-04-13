import { NextRequest, NextResponse } from "next/server";
import { finishServiceAndMoveToArchive } from "@/domain/usecases/session/closeTableSession";

export const runtime = "nodejs";

/**
 * POST /api/admin/close-table-for-feedback
 * Каскад Ступень 1→2: атомарный перенос в archived_visits + удаление из activeSessions, стол free.
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

    const result = await finishServiceAndMoveToArchive({ venueId, tableId, sessionId });
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
