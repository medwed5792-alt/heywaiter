export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";

/**
 * GET /api/venues/[venueId]/geo
 * Геозона заведения из venues/{venueId}.geo (lat, lng, radius в метрах).
 * Для гео-валидации смены в Staff Workspace.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ venueId: string }> }
) {
  try {
    const { venueId } = await params;
    if (!venueId) {
      return NextResponse.json({ error: "venueId обязателен" }, { status: 400 });
    }

    const firestore = getAdminFirestore();
    const doc = await firestore.collection("venues").doc(venueId).get();
    if (!doc.exists) {
      return NextResponse.json({ error: "Заведение не найдено" }, { status: 404 });
    }

    const geo = doc.data()?.geo as { lat?: number; lng?: number; radius?: number } | undefined;
    if (geo?.lat == null || geo?.lng == null) {
      return NextResponse.json({
        lat: null,
        lng: null,
        radius: null,
        configured: false,
      });
    }

    return NextResponse.json({
      lat: geo.lat,
      lng: geo.lng,
      radius: geo.radius ?? 100,
      configured: true,
    });
  } catch (err) {
    console.error("[venues/geo]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}
