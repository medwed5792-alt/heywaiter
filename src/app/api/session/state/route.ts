import { NextRequest, NextResponse } from "next/server";
import { getCurrentSessionState } from "@/domain/usecases/session/masterSplitBill";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const venueId = String(body.venueId ?? "").trim();
    const tableId = String(body.tableId ?? "").trim();
    if (!venueId || !tableId) {
      return NextResponse.json({ ok: false, error: "venueId and tableId required" }, { status: 400 });
    }
    const state = await getCurrentSessionState(venueId, tableId);
    return NextResponse.json({ ok: true, state });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

