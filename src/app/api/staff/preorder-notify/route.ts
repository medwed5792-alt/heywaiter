export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyPreorderStaffForVenue } from "@/lib/staff/verify-preorder-staff-gate";
import {
  dispatchPreorderStatusNotification,
  type PreorderGuestOutboundTemplateKey,
} from "@/lib/notifications/preorder-notification-trigger";
import { isPreorderStaffCancelPreset } from "@/lib/preorder-cancel-presets";

type Body = {
  venueId?: string;
  cartDocId?: string;
  customerUid?: string;
  event?: string;
  orderDisplayId?: string;
  cancelReason?: string;
};

const ALLOWED_EVENTS: PreorderGuestOutboundTemplateKey[] = [
  "status_confirmed",
  "status_ready",
  "status_completed",
  "status_cancelled_by_staff",
];

/**
 * POST /api/staff/preorder-notify
 * Body: { venueId, cartDocId, customerUid, event: status_confirmed | status_ready | status_completed, orderDisplayId? }
 * Authorization: Bearer <Firebase ID token> — uid должен иметь preorder_staff_gate для venueId.
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
    const customerUid = body.customerUid?.trim() ?? "";
    const event = body.event?.trim() ?? "";
    const orderDisplayId = body.orderDisplayId?.trim() || cartDocId;

    if (!venueId || !cartDocId || !customerUid) {
      return NextResponse.json({ error: "venueId, cartDocId и customerUid обязательны" }, { status: 400 });
    }

    if (!ALLOWED_EVENTS.includes(event as PreorderGuestOutboundTemplateKey)) {
      return NextResponse.json(
        { error: `event должен быть одним из: ${ALLOWED_EVENTS.join(", ")}` },
        { status: 400 }
      );
    }

    if (event === "status_cancelled_by_staff") {
      const cr = body.cancelReason?.trim() ?? "";
      if (!isPreorderStaffCancelPreset(cr)) {
        return NextResponse.json(
          { error: "cancelReason должна быть одной из пресетов персонала" },
          { status: 400 }
        );
      }
    }

    const adminAuth = getAdminAuth();
    const decoded = await adminAuth.verifyIdToken(idToken);
    const uid = decoded.uid;

    const firestore = getAdminFirestore();
    const allowed = await verifyPreorderStaffForVenue(firestore, uid, venueId);
    if (!allowed) {
      return NextResponse.json({ error: "Нет доступа к предзаказам этой площадки" }, { status: 403 });
    }

    await dispatchPreorderStatusNotification({
      firestore,
      venueId,
      cartDocId,
      customerUid,
      templateKey: event as PreorderGuestOutboundTemplateKey,
      orderDisplayId,
      cancelReason: event === "status_cancelled_by_staff" ? body.cancelReason?.trim() : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[staff/preorder-notify]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}
