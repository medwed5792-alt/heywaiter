import { NextRequest, NextResponse } from "next/server";
import { resolveGuestPoliteState } from "@/domain/usecases/guest/resolveGuestPoliteState";

/**
 * «Вежливый запрос»: один вызов с global_users id — сервер возвращает фазу без догадок на клиенте.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { globalGuestUid?: string };
    const globalGuestUid = String(body.globalGuestUid ?? "").trim();
    if (!globalGuestUid) {
      return NextResponse.json({ ok: false, error: "globalGuestUid required" }, { status: 400 });
    }

    const resolved = await resolveGuestPoliteState(globalGuestUid);

    if (resolved.phase === "working") {
      return NextResponse.json({
        ok: true,
        phase: "working",
        globalGuestUid: resolved.globalGuestUid,
        working: {
          venueId: resolved.venueId,
          tableId: resolved.tableId,
          sessionId: resolved.sessionId,
        },
      });
    }

    if (resolved.phase === "thank_you") {
      return NextResponse.json({
        ok: true,
        phase: "thank_you",
        globalGuestUid: resolved.globalGuestUid,
        thankYou: {
          visitId: resolved.visitId,
          venueId: resolved.venueId,
          tableId: resolved.tableId,
          tableNumber: resolved.tableNumber,
          feedbackStaffId: resolved.feedbackStaffId,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      phase: "free",
      globalGuestUid: resolved.globalGuestUid,
    });
  } catch (e) {
    console.error("guest/polite-state error:", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
