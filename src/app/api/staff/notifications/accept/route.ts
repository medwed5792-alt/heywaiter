export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const notificationId = (body.notificationId as string | undefined)?.trim();
    const staffId = (body.staffId as string | undefined)?.trim();

    if (!notificationId || !staffId) {
      return NextResponse.json({ ok: false, error: "notificationId и staffId обязательны" }, { status: 400 });
    }

    const firestore = getAdminFirestore();
    const ref = firestore.collection("staffNotifications").doc(notificationId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: "Уведомление не найдено" }, { status: 404 });
    }

    const d = (snap.data() ?? {}) as Record<string, unknown>;
    const targetUids = Array.isArray(d.targetUids) ? d.targetUids.map((x) => String(x)) : [];
    if (targetUids.length > 0 && !targetUids.includes(staffId)) {
      return NextResponse.json({ ok: false, error: "Нет доступа к уведомлению" }, { status: 403 });
    }

    await ref.update({
      status: "processing",
      read: true,
      acceptedBy: staffId,
      acceptedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[staff/notifications/accept]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}

