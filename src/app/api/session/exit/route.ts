import { NextRequest, NextResponse } from "next/server";
import { exitParticipant } from "@/domain/usecases/session/masterSplitBill";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const venueId = String(body.venueId ?? "").trim();
    const tableId = String(body.tableId ?? "").trim();
    const uid = String(body.uid ?? "").trim();
    if (!venueId || !tableId || !uid) {
      return NextResponse.json({ ok: false, error: "venueId, tableId, uid required" }, { status: 400 });
    }
    const res = await exitParticipant(venueId, tableId, uid);
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

