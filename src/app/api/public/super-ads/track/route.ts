/**
 * POST /api/public/super-ads/track — инкремент показов/кликов (публичный, best-effort).
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const adId = typeof body.adId === "string" ? body.adId.trim() : "";
    const event = body.event === "click" ? "click" : body.event === "impression" ? "impression" : "";
    if (!adId || !event) {
      return NextResponse.json({ error: "adId and event (impression|click) required" }, { status: 400 });
    }

    const { getAdminFirestore } = await import("@/lib/firebase-admin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const firestore = getAdminFirestore();
    const ref = firestore.collection("super_ads_catalog").doc(adId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const field = event === "click" ? "clicks" : "impressions";
    await ref.update({
      [field]: FieldValue.increment(1),
      updatedAt: new Date(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[public/super-ads/track]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
