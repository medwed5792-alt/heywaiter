import { NextRequest, NextResponse } from "next/server";
import { closeTableByMaster } from "@/domain/usecases/session/masterSplitBill";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const venueId = String(body.venueId ?? "").trim();
    const tableId = String(body.tableId ?? "").trim();
    const masterUid = String(body.masterUid ?? "").trim();
    if (!venueId || !tableId || !masterUid) {
      return NextResponse.json(
        { ok: false, error: "venueId, tableId, masterUid required" },
        { status: 400 }
      );
    }
    const res = await closeTableByMaster(venueId, tableId, masterUid);
    return NextResponse.json(res, { status: res.ok ? 200 : 403 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

