export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { notifyStaffAboutMenuGroupStopTime } from "@/lib/notifications/menu-group-stop-time-staff-alert";
import { FieldValue } from "firebase-admin/firestore";
import { isNowInMenuGroupInterval, parseVenueMenuVenueBlock } from "@/lib/system-configs/venue-menu-config";
import { venueLocalCalendarMinuteKey } from "@/lib/iana-wall-clock";
import { readVenueTimezone } from "@/lib/venue-timezone";

type Body = {
  venueId?: string;
  categoryId?: string;
  categoryName?: string;
  /** Устарело: дедупликация только по серверному времени в TZ заведения. */
  eventMinute?: number;
};

/**
 * POST /api/guest/menu-group-time-stop-notify
 * Алерт персоналу: группа меню недоступна по расписанию. Решение только по серверному UTC и TZ заведения.
 *
 * Authorization: Bearer <Firebase ID token>
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization") || request.headers.get("Authorization") || "";
    const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    const idToken = m?.[1]?.trim();
    if (!idToken) {
      return NextResponse.json({ error: "Требуется Authorization: Bearer <idToken>" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as Body;
    const venueId = body.venueId?.trim() ?? "";
    const groupId = body.categoryId?.trim() ?? "";
    const groupName = body.categoryName?.trim() ?? "";

    if (!venueId || !groupId || !groupName) {
      return NextResponse.json({ error: "venueId, categoryId, categoryName обязательны" }, { status: 400 });
    }

    const adminAuth = getAdminAuth();
    await adminAuth.verifyIdToken(idToken);

    const firestore = getAdminFirestore();
    const serverNow = new Date();

    const venueSnap = await firestore.collection("venues").doc(venueId).get();
    if (!venueSnap.exists) {
      return NextResponse.json({ error: "Заведение не найдено" }, { status: 404 });
    }
    const venueData = (venueSnap.data() ?? {}) as Record<string, unknown>;
    const timeZone = readVenueTimezone(venueData);

    const menuSnap = await firestore.collection("venues").doc(venueId).collection("configs").doc("menu").get();
    if (!menuSnap.exists) {
      return NextResponse.json({ ok: true, skipped: "no_menu" });
    }
    const block = parseVenueMenuVenueBlock(menuSnap.data() as Record<string, unknown>);
    const cat = block?.categories?.find((c) => c.id === groupId);
    if (!cat || cat.isActive !== true) {
      return NextResponse.json({ ok: true, skipped: "category_inactive" });
    }

    const inSlot = isNowInMenuGroupInterval({
      now: serverNow,
      timeZone,
      availableFrom: cat.availableFrom,
      availableTo: cat.availableTo,
    });
    if (inSlot) {
      return NextResponse.json({ ok: true, skipped: "slot_still_open" });
    }

    const minuteKey = venueLocalCalendarMinuteKey(serverNow, timeZone);
    const eventKey = `${venueId}_${groupId}_${minuteKey}`;
    const dedupeRef = firestore.doc(`venues/${venueId}/configs/menuGroupScheduleStopNotifications/${eventKey}`);

    const existing = await dedupeRef.get();
    if (existing.exists) {
      return NextResponse.json({ ok: true, skipped: "already_notified" });
    }

    await dedupeRef.set(
      {
        createdAt: FieldValue.serverTimestamp(),
        venueId,
        groupId,
        groupName,
        eventKey,
        venueMinuteKey: minuteKey,
        timeZone,
      },
      { merge: false }
    );

    await notifyStaffAboutMenuGroupStopTime({
      firestore,
      venueId,
      groupId,
      groupName,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[menu group stop time notify]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
