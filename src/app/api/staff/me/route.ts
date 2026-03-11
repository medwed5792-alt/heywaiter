export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";

/**
 * GET /api/staff/me?venueId=...&telegramId=...
 * Возвращает запись сотрудника для Mini App: userId, staffId, onShift по telegramId и venueId.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get("venueId")?.trim();
    const telegramId = searchParams.get("telegramId")?.trim();

    if (!venueId || !telegramId) {
      return NextResponse.json(
        { error: "venueId и telegramId обязательны" },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();
    const byCompositeId = firestore.collection("staff").doc(`${venueId}_${telegramId}`);
    let snap = await byCompositeId.get();

    if (!snap.exists) {
      const byTg = await firestore
        .collection("staff")
        .where("venueId", "==", venueId)
        .where("tgId", "==", telegramId)
        .limit(1)
        .get();
      if (!byTg.empty) {
        snap = byTg.docs[0];
      } else {
        const byUserId = await firestore
          .collection("staff")
          .where("venueId", "==", venueId)
          .where("userId", "==", telegramId)
          .limit(1)
          .get();
        if (byUserId.empty) {
          return NextResponse.json(
            { error: "Сотрудник не найден для этого заведения" },
            { status: 404 }
          );
        }
        snap = byUserId.docs[0];
      }
    }

    const id = snap.id;
    const d = snap.data() ?? {};
    const userId = (d.userId as string) || (d.tgId as string) || telegramId;

    return NextResponse.json({
      userId,
      staffId: id,
      venueId: d.venueId ?? venueId,
      onShift: d.onShift === true,
      shiftStartTime: (d.shiftStartTime as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? null,
      shiftEndTime: (d.shiftEndTime as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? null,
    });
  } catch (err) {
    console.error("[staff/me]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}
