export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";

/**
 * GET /api/staff/notifications?staffId=...&venueId=...&limit=30
 * Лог входящих вызовов для сотрудника (только чтение). Возвращает уведомления, где targetUids содержит staffId.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const staffId = searchParams.get("staffId")?.trim();
    const venueId = searchParams.get("venueId")?.trim();
    const limit = Math.min(Number(searchParams.get("limit")) || 30, 100);

    if (!staffId) {
      return NextResponse.json(
        { error: "staffId обязателен" },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();
    const fetchLimit = venueId ? limit * 3 : limit;
    const snap = await firestore
      .collection("staffNotifications")
      .where("targetUids", "array-contains", staffId)
      .orderBy("createdAt", "desc")
      .limit(fetchLimit)
      .get();

    let docs = snap.docs;
    if (venueId) {
      docs = docs.filter((d) => (d.data().venueId as string) === venueId).slice(0, limit);
    }

    const list = docs.map((d) => {
      const data = d.data();
      const createdAt = data.createdAt;
      return {
        id: d.id,
        message: data.message ?? "",
        tableId: data.tableId ?? null,
        venueId: data.venueId ?? null,
        type: data.type ?? null,
        read: data.read === true,
        createdAt: createdAt?.toDate?.()?.toISOString?.() ?? (typeof createdAt === "string" ? createdAt : null),
      };
    });

    return NextResponse.json({ notifications: list });
  } catch (err) {
    console.error("[staff/notifications]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}
