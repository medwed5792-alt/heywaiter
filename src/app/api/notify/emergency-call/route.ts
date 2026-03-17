export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const VENUE_ID = "venue_andrey_alt";
const EMERGENCY_TEXT =
  "🚨 КРИТИЧЕСКИЙ ВЫЗОВ (SOS)! ТРЕБУЕТСЯ ВМЕШАТЕЛЬСТВО ЛПР!";

/**
 * POST /api/notify/emergency-call
 * Тело: { staffId?: string }
 * Источник: Mini App — кнопка «SOS / ВЫЗОВ ОХРАНЫ».
 * Создаёт событие в venues/venue_andrey_alt/events для отображения на дашборде.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const staffId = typeof (body as { staffId?: string }).staffId === "string"
      ? (body as { staffId: string }).staffId.trim()
      : "";

    const firestore = getAdminFirestore();
    let sender = "Сотрудник";
    if (staffId) {
      const staffSnap = await firestore.collection("staff").doc(staffId).get();
      if (staffSnap.exists) {
        const d = staffSnap.data() ?? {};
        const first = (d.firstName as string) ?? "";
        const last = (d.lastName as string) ?? "";
        const role = (d.role as string) ?? (d.position as string) ?? "";
        sender = [first, last].filter(Boolean).join(" ") || role || sender;
      }
    }

    await firestore
      .collection("venues")
      .doc(VENUE_ID)
      .collection("events")
      .add({
        type: "emergency",
        text: EMERGENCY_TEXT,
        message: EMERGENCY_TEXT,
        sender,
        read: false,
        venueId: VENUE_ID,
        createdAt: FieldValue.serverTimestamp(),
        timestamp: FieldValue.serverTimestamp(),
      });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[notify/emergency-call]", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}
