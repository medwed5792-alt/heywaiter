export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";

const DEFAULT_VENUE_ID = "venue_andrey_alt";

function isPhantomNumber(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "number") return value === 0;
  if (typeof value === "string") {
    const s = value.trim();
    return s === "" || s === "0";
  }
  return false;
}

/**
 * POST /api/admin/cleanup-phantom-tables
 * Удаляет физически документы venues/{venueId}/tables, где number пустой/0/'0'.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const venueId = (body.venueId as string | undefined)?.trim() || DEFAULT_VENUE_ID;

    const firestore = getAdminFirestore();
    const snap = await firestore.collection("venues").doc(venueId).collection("tables").get();

    const phantomRefs = snap.docs.filter((d) => isPhantomNumber(d.data()?.number)).map((d) => d.ref);

    let deleted = 0;
    const BATCH_MAX = 450; // безопасно меньше лимита Firestore (500)
    for (let i = 0; i < phantomRefs.length; i += BATCH_MAX) {
      const chunk = phantomRefs.slice(i, i + BATCH_MAX);
      const batch = firestore.batch();
      chunk.forEach((ref) => batch.delete(ref));
      await batch.commit();
      deleted += chunk.length;
    }

    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    console.error("[admin/cleanup-phantom-tables]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

