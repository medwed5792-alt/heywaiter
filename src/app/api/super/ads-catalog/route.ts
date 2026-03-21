/**
 * GET/POST super_ads_catalog — только для UI Супер-Админа (/super/catalog → вкладка «Реклама»).
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { SuperAdCatalogItem } from "@/lib/super-ads";

export async function GET() {
  try {
    const { getAdminFirestore } = await import("@/lib/firebase-admin");
    const firestore = getAdminFirestore();
    const snap = await firestore.collection("super_ads_catalog").get();
    const ads: SuperAdCatalogItem[] = snap.docs.map((d) => {
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
    ads.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return NextResponse.json({ ads });
  } catch (err) {
    console.error("[super/ads-catalog] GET", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { getAdminFirestore } = await import("@/lib/firebase-admin");
    const firestore = getAdminFirestore();
    const ref = await firestore.collection("super_ads_catalog").add({
      title: typeof body.title === "string" ? body.title.trim() : "",
      body: typeof body.body === "string" ? body.body.trim() : "",
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl.trim() : "",
      href: typeof body.href === "string" ? body.href.trim() : "",
      active: body.active !== false,
      placements: Array.isArray(body.placements) ? body.placements.map(String) : [],
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
      updatedAt: new Date(),
    });
    return NextResponse.json({ ok: true, id: ref.id });
  } catch (err) {
    console.error("[super/ads-catalog] POST", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
