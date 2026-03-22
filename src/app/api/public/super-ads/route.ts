/**
 * GET /api/public/super-ads?placement=...&venueId=...&location=...&country=...
 * Подбор релевантных баннеров из super_ads_catalog с таргетингом и «железным» глобальным резервом.
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { AdDeliveryContext } from "@/lib/super-ads";
import {
  selectAdsForDelivery,
  superAdFromFirestoreDoc,
  toPublicSuperAdItem,
} from "@/lib/super-ads";

export async function GET(request: NextRequest) {
  try {
    const { getAdminFirestore } = await import("@/lib/firebase-admin");
    const firestore = getAdminFirestore();
    const placement = request.nextUrl.searchParams.get("placement")?.trim() ?? "";
    const venueId = request.nextUrl.searchParams.get("venueId")?.trim() ?? "";
    const location = request.nextUrl.searchParams.get("location")?.trim() ?? "";
    const countryParam = request.nextUrl.searchParams.get("country")?.trim() ?? "";

    const snap = await firestore.collection("super_ads_catalog").get();
    const all = snap.docs.map((d) => superAdFromFirestoreDoc(d.id, d.data() as Record<string, unknown>));

    if (!placement) {
      const loose = all
        .filter((a) => a.active !== false)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      return NextResponse.json({ ads: loose.map(toPublicSuperAdItem) });
    }

    let region = location;
    let venueLevel: number | undefined;
    let category: string | undefined;

    let country = countryParam;

    if (venueId) {
      const venueSnap = await firestore.collection("venues").doc(venueId).get();
      if (venueSnap.exists) {
        const v = venueSnap.data() as Record<string, unknown>;
        if (!region && typeof v.adRegion === "string" && v.adRegion.trim()) {
          region = v.adRegion.trim();
        }
        if (!country && typeof v.adCountry === "string" && v.adCountry.trim()) {
          country = v.adCountry.trim();
        }
        if (typeof v.adVenueLevel === "number" && v.adVenueLevel >= 1 && v.adVenueLevel <= 5) {
          venueLevel = v.adVenueLevel;
        }
        if (typeof v.adCategory === "string" && v.adCategory.trim()) {
          category = v.adCategory.trim();
        }
      }
    }

    const ctx: AdDeliveryContext = {
      region: region || "",
      ...(country ? { country } : {}),
      venueLevel,
      category,
    };

    const { ads: selected } = selectAdsForDelivery(all, placement, ctx);

    return NextResponse.json({ ads: selected.map(toPublicSuperAdItem) });
  } catch (err) {
    console.error("[public/super-ads]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error", ads: [] },
      { status: 500 }
    );
  }
}
