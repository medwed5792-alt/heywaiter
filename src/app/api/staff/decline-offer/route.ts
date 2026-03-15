export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

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
    const staffRef = firestore.collection("staff").doc(staffId);
    const staffSnap = await staffRef.get();
    if (staffSnap.exists) {
      const data = staffSnap.data() ?? {};
      if (String(data.tgId) !== String(telegramId)) {
        return NextResponse.json({ error: "Это предложение предназначено другому пользователю" }, { status: 403 });
      }
      await staffRef.update({
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
