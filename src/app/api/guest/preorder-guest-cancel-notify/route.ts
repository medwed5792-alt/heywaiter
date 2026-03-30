export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { PREORDER_CARTS_SUBCOLLECTION } from "@/lib/pre-order";
import { PREORDER_GUEST_CANCEL_REASON } from "@/lib/preorder-cancel-presets";
import {
  NOTIFICATIONS_SYSTEM_CONFIG_DOC_ID,
  isNotificationsGloballyEnabled,
  parseNotificationsSystemConfig,
  resolvePreorderNotificationText,
} from "@/lib/system-configs/notifications-config";
import { notifyStaffPreorderGuestCancelled } from "@/lib/notifications/preorder-guest-cancel-staff-alert";

type Body = {
  venueId?: string;
  cartDocId?: string;
};

/**
 * POST /api/guest/preorder-guest-cancel-notify
 * После того как гость перевёл корзину в cancelled (Firestore), дергается этот endpoint —
 * алерт персоналу (staffNotifications + Telegram Staff-бот при наличии токена).
 * Authorization: Bearer <Firebase ID token> — должен совпадать с authUid документа корзины.
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
    const cartDocId = body.cartDocId?.trim() ?? "";

    if (!venueId || !cartDocId) {
      return NextResponse.json({ error: "venueId и cartDocId обязательны" }, { status: 400 });
    }

    const adminAuth = getAdminAuth();
    const decoded = await adminAuth.verifyIdToken(idToken);
    const uid = decoded.uid;

    const firestore = getAdminFirestore();
    const ref = firestore
      .collection("venues")
      .doc(venueId)
      .collection(PREORDER_CARTS_SUBCOLLECTION)
      .doc(cartDocId);

    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Корзина не найдена" }, { status: 404 });
    }

    const data = snap.data() ?? {};
    if (data.authUid !== uid) {
      return NextResponse.json({ error: "Нет доступа к этой корзине" }, { status: 403 });
    }
    if (data.status !== "cancelled") {
      return NextResponse.json({ error: "Корзина не в статусе cancelled" }, { status: 400 });
    }
    if (data.cancelledBy !== "guest") {
      return NextResponse.json({ error: "Отмена не инициирована гостем" }, { status: 400 });
    }
    const cr = typeof data.cancelReason === "string" ? data.cancelReason.trim() : "";
    if (cr !== PREORDER_GUEST_CANCEL_REASON) {
      return NextResponse.json({ error: "Некорректная причина отмены" }, { status: 400 });
    }

    const customerUid =
      typeof data.customerUid === "string" && data.customerUid.trim() ? data.customerUid.trim() : cartDocId;

    let cfg = parseNotificationsSystemConfig(undefined);
    try {
      const cfgSnap = await firestore.collection("system_configs").doc(NOTIFICATIONS_SYSTEM_CONFIG_DOC_ID).get();
      cfg = parseNotificationsSystemConfig(
        cfgSnap.exists ? (cfgSnap.data() as Record<string, unknown>) : undefined
      );
    } catch (e) {
      console.warn("[guest/preorder-guest-cancel-notify] fallback notifications config", e);
      cfg = {};
    }

    if (!isNotificationsGloballyEnabled(cfg)) {
      return NextResponse.json({ ok: true, skipped: "notifications_disabled" });
    }

    const orderDisplayId = cartDocId.length > 8 ? cartDocId.slice(-8) : cartDocId;
    const message = resolvePreorderNotificationText(cfg, "preorder_guest_cancelled_staff", orderDisplayId);

    await notifyStaffPreorderGuestCancelled({
      firestore,
      venueId,
      customerUid,
      orderDisplayId,
      message,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[guest/preorder-guest-cancel-notify]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}
