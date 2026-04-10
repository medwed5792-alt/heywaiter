export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { parseCanonicalStaffDocId } from "@/lib/identity/global-user-staff-bridge";

/**
 * POST /api/staff/decline-offer
 * Отклонить предложение. Тело: { staffId: string, telegramId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const staffId = typeof body.staffId === "string" ? body.staffId.trim() : "";
    const telegramId = typeof body.telegramId === "string" ? body.telegramId.trim() : "";
    if (!staffId || !telegramId) {
      return NextResponse.json({ error: "staffId и telegramId обязательны" }, { status: 400 });
    }

    const firestore = getAdminFirestore();
    const parsed = parseCanonicalStaffDocId(staffId);
    if (!parsed) {
      return NextResponse.json({ error: "Некорректный staffId" }, { status: 400 });
    }
    const { venueId, globalUserId } = parsed;

    const byTg = await firestore
      .collection("global_users")
      .where("identities.tg", "==", telegramId)
      .limit(1)
      .get();
    if (byTg.empty || byTg.docs[0].id !== globalUserId) {
      return NextResponse.json({ error: "Это предложение предназначено другому пользователю" }, { status: 403 });
    }

    const venueStaffRef = firestore.collection("venues").doc(venueId).collection("staff").doc(staffId);
    const snap = await venueStaffRef.get();
    if (snap.exists) {
      await venueStaffRef.update({
        status: "declined",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return NextResponse.json({ ok: true, message: "Предложение отклонено." });
  } catch (err) {
    console.error("[staff/decline-offer]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
