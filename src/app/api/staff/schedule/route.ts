export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";

/**
 * GET /api/staff/schedule?staffId=...&venueId=...
 * Возвращает смены сотрудника для Mini App (только чтение).
 * Фильтр: staffId и venueId текущего сотрудника.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const staffId = searchParams.get("staffId")?.trim();
    const venueId = searchParams.get("venueId")?.trim();

    if (!staffId || !venueId) {
      return NextResponse.json(
        { error: "staffId и venueId обязательны" },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();
    const snap = await firestore
      .collection("scheduleEntries")
      .where("staffId", "==", staffId)
      .where("venueId", "==", venueId)
      .get();

    const entries = snap.docs.map((d) => {
      const data = d.data();
      const slot = (data.slot as { date?: string; startTime?: string; endTime?: string }) ?? {};
      return {
        id: d.id,
        venueId: data.venueId ?? venueId,
        staffId: data.staffId ?? staffId,
        slot: {
          date: slot.date ?? "",
          startTime: slot.startTime ?? "10:00",
          endTime: slot.endTime ?? "18:00",
        },
        planHours: data.planHours ?? 0,
        factHours: data.factHours,
        checkIn: data.checkIn,
        checkOut: data.checkOut,
        role: data.role ?? "waiter",
      };
    });

    // Сортируем по дате слота
    entries.sort((a, b) => (a.slot.date || "").localeCompare(b.slot.date || ""));

    return NextResponse.json({ entries });
  } catch (err) {
    console.error("[staff/schedule]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}
