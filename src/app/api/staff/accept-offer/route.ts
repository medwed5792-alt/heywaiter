export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { acceptOffer } from "@/lib/accept-offer";

/**
 * POST /api/staff/accept-offer
 * Единая точка принятия оффера (Mini App и бот вызывают одну логику).
 * Тело: { staffId: string, telegramId?: string } — telegramId обязателен при вызове из Mini App (проверка владельца).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const staffId = typeof body.staffId === "string" ? body.staffId.trim() : "";
    const telegramId = typeof body.telegramId === "string" ? body.telegramId.trim() : "";

    if (!staffId) {
      return NextResponse.json({ error: "staffId обязателен" }, { status: 400 });
    }

    if (telegramId) {
      const firestore = getAdminFirestore();
      const staffSnap = await firestore.collection("staff").doc(staffId).get();
      if (staffSnap.exists) {
        const data = staffSnap.data() ?? {};
        if (String(data.tgId) !== String(telegramId)) {
          return NextResponse.json(
            { error: "Это предложение предназначено другому пользователю" },
            { status: 403 }
          );
        }
      }
    }

    const result = await acceptOffer(staffId);
    if (!result.ok) {
      const status = result.error === "Предложение не найдено" ? 404 : result.error === "Вы уже в штате" ? 409 : 400;
      return NextResponse.json(
        { error: result.error, alreadyActive: result.alreadyActive },
        { status }
      );
    }
    if (result.alreadyActive) {
      return NextResponse.json(
        { ok: true, message: "Вы уже в штате.", alreadyActive: true },
        { status: 200 }
      );
    }
    return NextResponse.json({
      ok: true,
      message: "Вы приняты в команду. Откройте пульт сотрудника для начала смены.",
    });
  } catch (err) {
    console.error("[staff/accept-offer]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
