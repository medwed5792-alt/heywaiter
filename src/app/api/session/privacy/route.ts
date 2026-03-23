import { NextRequest, NextResponse } from "next/server";
import { setTablePrivacy } from "@/domain/usecases/session/masterSplitBill";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const venueId = String(body.venueId ?? "").trim();
    const tableId = String(body.tableId ?? "").trim();
    const actorUid = String(body.actorUid ?? "").trim();
    const allowJoin = Boolean(body.allowJoin);
    if (!venueId || !tableId || !actorUid) {
      return NextResponse.json(
        { ok: false, error: "venueId, tableId, actorUid required" },
        { status: 400 }
      );
    }
    const res = await setTablePrivacy(venueId, tableId, actorUid, allowJoin);
    return NextResponse.json(res, { status: res.ok ? 200 : 403 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

