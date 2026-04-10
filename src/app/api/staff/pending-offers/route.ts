export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";

/**
 * GET /api/staff/pending-offers?telegramId=...
 * Список предложений о работе (status: pending_offer) по tgId для отображения в Личном кабинете.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const telegramId = searchParams.get("telegramId")?.trim();
    if (!telegramId) {
      return NextResponse.json({ error: "telegramId обязателен" }, { status: 400 });
    }

    const firestore = getAdminFirestore();
    const snap = await firestore
      .collectionGroup("staff")
      .where("tgId", "==", telegramId)
      .where("status", "==", "pending_offer")
      .get();

    const offers: { staffId: string; venueId: string; venueName: string }[] = [];
    for (const d of snap.docs) {
      const data = d.data();
      const venueId = (data.venueId as string) ?? "";
      let venueName = venueId;
      try {
        const venueSnap = await firestore.collection("venues").doc(venueId).get();
        if (venueSnap.exists) {
          venueName = (venueSnap.data()?.name as string) ?? venueId;
        }
      } catch (_) {}
      offers.push({ staffId: d.id, venueId, venueName });
    }

    return NextResponse.json({ offers });
  } catch (err) {
    console.error("[staff/pending-offers]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
