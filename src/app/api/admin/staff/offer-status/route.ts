export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";

import { DEFAULT_VENUE_ID as VENUE_ID } from "@/lib/standards/venue-default";

/**
 * GET /api/admin/staff/offer-status?userId=...&venueId=...
 * Статус оффера по userId и venueId для отображения кнопки "Отменить предложение" в админке.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId")?.trim();
    const venueId = searchParams.get("venueId")?.trim() || VENUE_ID;
    if (!userId) {
      return NextResponse.json({ error: "userId обязателен" }, { status: 400 });
    }
    const firestore = getAdminFirestore();
    const staffDocId = `${venueId}_${userId}`;
    const snap = await firestore.collection("staff").doc(staffDocId).get();
    if (!snap.exists) {
      return NextResponse.json({ status: null, staffId: null });
    }
    const d = snap.data() ?? {};
    const status = (d.status as string) ?? (d.active === true ? "active" : null);
    return NextResponse.json({ status: status || null, staffId: staffDocId });
  } catch (err) {
    console.error("[admin/staff/offer-status]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
