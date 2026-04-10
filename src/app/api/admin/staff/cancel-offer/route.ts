export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { DEFAULT_VENUE_ID as VENUE_ID } from "@/lib/standards/venue-default";
import { parseCanonicalStaffDocId } from "@/lib/identity/global-user-staff-bridge";

/**
 * POST /api/admin/staff/cancel-offer
 * Отменить предложение (черновик): ставит status: 'rejected'. Только venues/{venueId}/staff (без корневой staff).
 * Body: { staffId: string } или { userId: string, venueId?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    let staffId = typeof body.staffId === "string" ? body.staffId.trim() : "";
    let venueId = typeof body.venueId === "string" ? body.venueId.trim() : VENUE_ID;
    if (!staffId) {
      const userId = typeof body.userId === "string" ? body.userId.trim() : "";
      venueId = typeof body.venueId === "string" ? body.venueId.trim() : VENUE_ID;
      if (!userId) {
        return NextResponse.json({ error: "staffId или userId обязателен" }, { status: 400 });
      }
      staffId = `${venueId}_${userId}`;
    } else {
      const parsed = parseCanonicalStaffDocId(staffId);
      if (parsed?.venueId) venueId = parsed.venueId;
    }

    const firestore = getAdminFirestore();
    const venueStaffRef = firestore.collection("venues").doc(venueId).collection("staff").doc(staffId);
    const snap = await venueStaffRef.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: true, message: "Запись не найдена" });
    }
    const d = snap.data() ?? {};
    if (d.active === true) {
      return NextResponse.json(
        { error: "Сотрудник уже в штате, отмена невозможна" },
        { status: 409 }
      );
    }
    await venueStaffRef.update({
      status: "rejected",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ ok: true, message: "Предложение отменено. Можно отправить заново." });
  } catch (err) {
    console.error("[admin/staff/cancel-offer]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
