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

    const FIXED_VENUE_ID = "venue_andrey_alt";
    const venueIdToUse = venueId || FIXED_VENUE_ID;
    const toMs = (value: any): number | null => {
      try {
        const d = value?.toDate?.();
        if (d instanceof Date) return d.getTime();
        if (value instanceof Date) return value.getTime();
        if (typeof value === "string") {
          const dt = new Date(value);
          if (!Number.isNaN(dt.getTime())) return dt.getTime();
        }
        return null;
      } catch {
        return null;
      }
    };

    const toIsoOrNull = (value: any): string | null => {
      const ms = toMs(value);
      return ms == null ? null : new Date(ms).toISOString();
    };

    const listWithMeta: Array<{
      id: string;
      message: string;
      tableId: string | null;
      venueId: string | null;
      type: string | null;
      read: boolean;
      createdAt: string | null;
      createdAtMs: number;
    }> = [];

    // 1) Новый источник уведомлений: venues/venue_andrey_alt/staff/[STAFF_ID]/notifications
    const perStaffSnap = await firestore
      .collection("venues")
      .doc(FIXED_VENUE_ID)
      .collection("staff")
      .doc(staffId)
      .collection("notifications")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    perStaffSnap.docs.forEach((d) => {
      const data = d.data() ?? {};
      const createdAtMs = toMs(data.createdAt) ?? 0;
      listWithMeta.push({
        id: d.id,
        message: data.message ?? "",
        tableId: data.tableId ?? null,
        venueId: data.venueId ?? venueIdToUse ?? null,
        type: data.type ?? null,
        read: data.read === true,
        createdAt: toIsoOrNull(data.createdAt),
        createdAtMs,
      });
    });

    // 2) Старый источник (для совместимости со всеми остальными уведомлениями)
    const fetchLimit = limit * 3;
    const snap = await firestore
      .collection("staffNotifications")
      .where("targetUids", "array-contains", staffId)
      .orderBy("createdAt", "desc")
      .limit(fetchLimit)
      .get();

    let docs = snap.docs;
    if (venueIdToUse) {
      docs = docs.filter((d) => (d.data().venueId as string) === venueIdToUse).slice(0, fetchLimit);
    }

    docs.forEach((d) => {
      const data = d.data();
      const createdAtMs = toMs(data.createdAt) ?? 0;
      listWithMeta.push({
        id: d.id,
        message: data.message ?? "",
        tableId: data.tableId ?? null,
        venueId: data.venueId ?? null,
        type: data.type ?? null,
        read: data.read === true,
        createdAt: toIsoOrNull(data.createdAt),
        createdAtMs,
      });
    });

    listWithMeta.sort((a, b) => b.createdAtMs - a.createdAtMs);

    return NextResponse.json({
      notifications: listWithMeta
        .slice(0, limit)
        .map(({ createdAtMs, ...rest }) => rest),
    });
  } catch (err) {
    console.error("[staff/notifications]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}
