export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { notifyStaffAboutMenuGroupStopTime } from "@/lib/notifications/menu-group-stop-time-staff-alert";
import { FieldValue } from "firebase-admin/firestore";

type Body = {
  venueId?: string;
  categoryId?: string;
  categoryName?: string;
  eventMinute?: number;
};

/**
 * POST /api/guest/menu-group-time-stop-notify
 * Клиент (гость) шлёт уведомление о том, что группа перестала быть доступна по времени.
 * Сервер: дедупликация + алерт персоналу через staffNotifications + Telegram.
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
    const eventMinute = Number(body.eventMinute);

    if (!venueId || !groupId || !groupName) {
      return NextResponse.json({ error: "venueId, categoryId, categoryName обязательны" }, { status: 400 });
    }
    if (!Number.isFinite(eventMinute) || eventMinute < 0) {
      return NextResponse.json({ error: "eventMinute некорректен" }, { status: 400 });
    }

    const adminAuth = getAdminAuth();
    await adminAuth.verifyIdToken(idToken);

    const firestore = getAdminFirestore();
    const eventKey = `${venueId}_${groupId}_${Math.floor(eventMinute)}`;
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

