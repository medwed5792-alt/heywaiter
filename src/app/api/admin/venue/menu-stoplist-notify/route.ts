export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { notifyStaffAboutStopList } from "@/lib/notifications/staff-stoplist-alert";

/**
 * POST /api/admin/venue/menu-stoplist-notify
 * Тело: { venueId: string, changes: { dishName: string, active: boolean }[] }
 * Вызывается после записи venues/{venueId}/configs/menu, если у позиций изменился active.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { venueId, changes } = body as {
      venueId?: string;
      changes?: Array<{ dishName?: string; active?: boolean }>;
    };

    if (!venueId?.trim()) {
      return NextResponse.json({ error: "venueId required" }, { status: 400 });
    }
    if (!Array.isArray(changes) || changes.length === 0) {
      return NextResponse.json({ ok: true, skipped: "no_changes" });
    }

    const normalized = changes
      .map((c) => ({
        dishName: typeof c.dishName === "string" ? c.dishName.trim() : "",
        active: c.active === true,
      }))
      .filter((c) => c.dishName.length > 0);

    if (normalized.length === 0) {
      return NextResponse.json({ ok: true, skipped: "empty_dish_names" });
    }

    const firestore = getAdminFirestore();
    await notifyStaffAboutStopList({
      firestore,
      venueId: venueId.trim(),
      changes: normalized,
    });

    return NextResponse.json({ ok: true, notified: normalized.length });
  } catch (err) {
    console.error("[menu-stoplist-notify]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
