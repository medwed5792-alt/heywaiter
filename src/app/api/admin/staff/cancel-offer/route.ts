export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { DEFAULT_VENUE_ID as VENUE_ID } from "@/lib/standards/venue-default";

/**
 * POST /api/admin/staff/cancel-offer
 * Отменить предложение (черновик): ставит status: 'rejected'. Админ сможет отправить оффер заново.
 * Body: { staffId: string } или { userId: string, venueId?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    let staffId = typeof body.staffId === "string" ? body.staffId.trim() : "";
    if (!staffId) {
      const userId = typeof body.userId === "string" ? body.userId.trim() : "";
      const venueId = typeof body.venueId === "string" ? body.venueId.trim() : VENUE_ID;
      if (!userId) {
        return NextResponse.json({ error: "staffId или userId обязателен" }, { status: 400 });
      }
      staffId = `${venueId}_${userId}`;
    }
    const firestore = getAdminFirestore();
    const staffRef = firestore.collection("staff").doc(staffId);
    const snap = await staffRef.get();
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
    await staffRef.update({
      status: "rejected",
      updatedAt: FieldValue.serverTimestamp(),
    });
    const venueStaffRef = firestore.collection("venues").doc(d.venueId as string).collection("staff").doc(staffId);
    const venueSnap = await venueStaffRef.get();
    if (venueSnap.exists) {
      await venueStaffRef.update({
        status: "rejected",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return NextResponse.json({ ok: true, message: "Предложение отменено. Можно отправить заново." });
  } catch (err) {
    console.error("[admin/staff/cancel-offer]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
