/**
 * GET /api/public/super-ads?placement=...
 * Публичная выдача активных объявлений из super_ads_catalog (для Mini App / AdSpace).
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { SuperAdCatalogItem } from "@/lib/super-ads";
import { filterAdsForPlacement } from "@/lib/super-ads";

export async function GET(request: NextRequest) {
  try {
    const { getAdminFirestore } = await import("@/lib/firebase-admin");
    const firestore = getAdminFirestore();
    const snap = await firestore.collection("super_ads_catalog").get();
    const placement = request.nextUrl.searchParams.get("placement")?.trim() ?? "";

    let ads: SuperAdCatalogItem[] = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        title: data.title as string | undefined,
        body: data.body as string | undefined,
        imageUrl: data.imageUrl as string | undefined,
        href: data.href as string | undefined,
        active: data.active as boolean | undefined,
        placements: data.placements as string[] | undefined,
        sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : undefined,
      };
    });

    ads = ads.filter((a) => a.active !== false);

    if (placement) {
      ads = filterAdsForPlacement(ads, placement);
    }

    ads.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    return NextResponse.json({ ads });
  } catch (err) {
    console.error("[public/super-ads]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error", ads: [] },
      { status: 500 }
    );
  }
}
