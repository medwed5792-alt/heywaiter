export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { resolveVenueId } from "@/lib/standards/venue-default";

/**
 * Документ venues/{venueId}/tables/{id} считается мусором и удаляется, если:
 * - поля number нет;
 * - number — null / undefined;
 * - number — пустая строка или строка "0";
 * - number — число 0 или не конечное.
 */
export function isInvalidVenueTableNumber(data: Record<string, unknown>): boolean {
  if (!("number" in data)) return true;
  const n = data.number;
  if (n === null || n === undefined) return true;
  if (typeof n === "string") {
    const t = n.trim();
    return t === "" || t === "0";
  }
  if (typeof n === "number") {
    return !Number.isFinite(n) || n === 0;
  }
  return true;
}

/**
 * POST /api/admin/purge-invalid-venue-tables
 * Удаляет из venues/{venueId}/tables документы с невалидным number (0 / нет / пусто).
 * Тело: { "venueId"?: string, "dryRun"?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const venueId = resolveVenueId((body.venueId as string) || undefined);
    const dryRun = body.dryRun === true;

    const firestore = getAdminFirestore();
    const ref = firestore.collection("venues").doc(venueId).collection("tables");
    const snap = await ref.get();

    const toDelete: string[] = [];
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>;
      if (isInvalidVenueTableNumber(data)) {
        toDelete.push(d.id);
      }
    }

    if (!dryRun && toDelete.length > 0) {
      const BATCH = 450;
      for (let i = 0; i < toDelete.length; i += BATCH) {
        const batch = firestore.batch();
        for (const id of toDelete.slice(i, i + BATCH)) {
          batch.delete(ref.doc(id));
        }
        await batch.commit();
      }
    }

    return NextResponse.json({
      ok: true,
      venueId,
      dryRun,
      deletedCount: dryRun ? 0 : toDelete.length,
      matchedCount: toDelete.length,
      deletedIds: toDelete,
    });
  } catch (err) {
    console.error("[purge-invalid-venue-tables]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
