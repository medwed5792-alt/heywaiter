export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { resolveVenueId } from "@/lib/standards/venue-default";

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

    const venueIdToUse = resolveVenueId(venueId);
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
      status: "pending" | "processing" | "completed" | null;
      title: string | null;
      guestName: string | null;
      amount: number | null;
      items: string[] | null;
      read: boolean;
      createdAt: string | null;
      createdAtMs: number;
    }> = [];

    // 1) venues/{venueId}/staff/{staffId}/notifications
    const perStaffSnap = await firestore
      .collection("venues")
      .doc(venueIdToUse)
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
        status:
          data.status === "pending" || data.status === "processing" || data.status === "completed"
            ? data.status
            : null,
        title: typeof data.title === "string" ? data.title : null,
        guestName: typeof data.guestName === "string" ? data.guestName : null,
        amount: typeof data.amount === "number" ? data.amount : null,
        items: Array.isArray(data.items) ? data.items.filter((x: unknown) => typeof x === "string") : null,
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
        status:
          data.status === "pending" || data.status === "processing" || data.status === "completed"
            ? data.status
            : null,
        title: typeof data.title === "string" ? data.title : null,
        guestName: typeof data.guestName === "string" ? data.guestName : null,
        amount: typeof data.amount === "number" ? data.amount : null,
        items: Array.isArray(data.items) ? data.items.filter((x: unknown) => typeof x === "string") : null,
        read: data.read === true,
        createdAt: toIsoOrNull(data.createdAt),
        createdAtMs,
      });
    });

    // 3) Broadcast split/full bill requests without explicit targetUids (fallback delivery)
    const broadcastSnap = await firestore
      .collection("staffNotifications")
      .where("venueId", "==", venueIdToUse)
      .orderBy("createdAt", "desc")
      .limit(fetchLimit)
      .get();

    broadcastSnap.docs.forEach((d) => {
      const data = d.data();
      const type = data.type as string | undefined;
      const targetUids = Array.isArray(data.targetUids) ? data.targetUids : [];
      if (
        type !== "split_bill_request" &&
        type !== "full_bill_request" &&
        type !== "preorder_guest_cancelled"
      )
        return;
      if (targetUids.length > 0 && !targetUids.includes(staffId)) return;
      if (listWithMeta.some((x) => x.id === d.id)) return;
      const createdAtMs = toMs(data.createdAt) ?? 0;
      listWithMeta.push({
        id: d.id,
        message: data.message ?? "",
        tableId: data.tableId ?? null,
        venueId: data.venueId ?? null,
        type: data.type ?? null,
        status:
          data.status === "pending" || data.status === "processing" || data.status === "completed"
            ? data.status
            : null,
        title: typeof data.title === "string" ? data.title : null,
        guestName: typeof data.guestName === "string" ? data.guestName : null,
        amount: typeof data.amount === "number" ? data.amount : null,
        items: Array.isArray(data.items) ? data.items.filter((x: unknown) => typeof x === "string") : null,
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
