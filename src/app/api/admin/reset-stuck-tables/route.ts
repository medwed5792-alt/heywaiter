export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { DEFAULT_VENUE_ID as VENUE_ID } from "@/lib/standards/venue-default";
import { closeSessionForceClosedAndFreeTable } from "@/domain/usecases/session/closeTableSession";

const STUCK_AGE_MS = 2 * 60 * 60 * 1000; // 2 часа

/**
 * POST /api/admin/reset-stuck-tables
 * Закрывает «зависшие» сессии: check_in_success без гостя или старше 2 ч.
 * Сессия → closed и стол → free в одной транзакции (единый use-case).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const venueId = (body.venueId as string)?.trim() || VENUE_ID;
    const firestore = getAdminFirestore();
    const cutoff = new Date(Date.now() - STUCK_AGE_MS);
    const snap = await firestore
      .collection("activeSessions")
      .where("venueId", "==", venueId)
      .where("status", "==", "check_in_success")
      .get();

    let closed = 0;
    for (const d of snap.docs) {
      const data = d.data();
      const guestId = data.guestId;
      const createdAt = data.createdAt?.toDate?.() ?? null;
      const tableId = typeof data.tableId === "string" ? data.tableId.trim() : "";
      const isStuck = !guestId || (createdAt && createdAt < cutoff);
      if (!isStuck || !tableId) continue;
      const r = await closeSessionForceClosedAndFreeTable({
        venueId,
        tableId,
        sessionId: d.id,
      });
      if (r.ok) closed++;
    }
    return NextResponse.json({ ok: true, closed });
  } catch (err) {
    console.error("[admin/reset-stuck-tables]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
