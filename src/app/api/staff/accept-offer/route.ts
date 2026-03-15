export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * POST /api/staff/accept-offer
 * Принять предложение (из Личного кабинета или бота). Тело: { staffId: string, telegramId: string }
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
    if (!staffSnap.exists) {
      return NextResponse.json({ error: "Предложение не найдено" }, { status: 404 });
    }
    const staffData = staffSnap.data() ?? {};
    if (String(staffData.tgId) !== String(telegramId)) {
      return NextResponse.json({ error: "Это предложение предназначено другому пользователю" }, { status: 403 });
    }
    if (staffData.active === true) {
      return NextResponse.json({ error: "Вы уже в штате", alreadyActive: true }, { status: 409 });
    }

    const userId = staffData.userId as string;
    const venueId = staffData.venueId as string;

    await staffRef.update({
      active: true,
      status: "active",
      updatedAt: FieldValue.serverTimestamp(),
    });

    const globalRef = firestore.collection("global_users").doc(userId);
    const globalSnap = await globalRef.get();
    if (globalSnap.exists) {
      const globalData = globalSnap.data() ?? {};
      const affiliations = Array.isArray(globalData.affiliations) ? [...globalData.affiliations] : [];
      if (!affiliations.some((a: { venueId: string }) => a.venueId === venueId)) {
        affiliations.push({
          venueId,
          role: "waiter",
          status: "active",
          onShift: false,
        });
        await globalRef.update({
          affiliations,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    return NextResponse.json({ ok: true, message: "Вы приняты в команду. Откройте пульт сотрудника для начала смены." });
  } catch (err) {
    console.error("[staff/accept-offer]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
