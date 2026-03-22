/**
 * GET/POST super_ads_catalog — UI Супер-Админа: /super/system (рекламные слоты).
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { superAdFromFirestoreDoc } from "@/lib/super-ads";
import type { SuperAdSchedule } from "@/lib/ad-schedule";

export async function GET() {
  try {
    const { getAdminFirestore } = await import("@/lib/firebase-admin");
    const firestore = getAdminFirestore();
    const snap = await firestore.collection("super_ads_catalog").get();
    const ads = snap.docs.map((d) => superAdFromFirestoreDoc(d.id, d.data() as Record<string, unknown>));
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

function parseSchedule(body: Record<string, unknown>): SuperAdSchedule | undefined {
  const raw = body.schedule;
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Record<string, unknown>;
  const days = Array.isArray(s.daysOfWeek)
    ? s.daysOfWeek.map((x) => Number(x)).filter((n) => !Number.isNaN(n) && n >= 0 && n <= 6)
    : undefined;
  const startTime = typeof s.startTime === "string" ? s.startTime.trim() : undefined;
  const endTime = typeof s.endTime === "string" ? s.endTime.trim() : undefined;
  const timezone = typeof s.timezone === "string" ? s.timezone.trim() : undefined;
  if ((!days || days.length === 0) && !startTime && !endTime && !timezone) return undefined;
  return {
    ...(days && days.length > 0 ? { daysOfWeek: days } : {}),
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
    ...(timezone ? { timezone } : {}),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { getAdminFirestore } = await import("@/lib/firebase-admin");
    const firestore = getAdminFirestore();

    const regions = Array.isArray(body.regions) ? body.regions.map((x) => String(x).trim()).filter(Boolean) : [];
    const countries = Array.isArray(body.countries)
      ? body.countries.map((x) => String(x).trim()).filter(Boolean)
      : [];
    const venueLevels = Array.isArray(body.venueLevels)
      ? body.venueLevels
          .map((x) => Number(x))
          .filter((n) => !Number.isNaN(n) && n >= 1 && n <= 5)
      : [];
    const schedule = parseSchedule(body);

    const ref = await firestore.collection("super_ads_catalog").add({
      title: typeof body.title === "string" ? body.title.trim() : "",
      body: typeof body.body === "string" ? body.body.trim() : "",
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl.trim() : "",
      href: typeof body.href === "string" ? body.href.trim() : "",
      active: body.active !== false,
      placements: Array.isArray(body.placements) ? body.placements.map(String) : [],
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
      regions,
      countries,
      venueLevels,
      category: typeof body.category === "string" ? body.category.trim() : "",
      ...(schedule ? { schedule } : {}),
      isGlobalReserve: body.isGlobalReserve === true,
      impressions: 0,
      clicks: 0,
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
