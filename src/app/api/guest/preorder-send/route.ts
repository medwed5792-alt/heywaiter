export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { validateGuestPreorderSend } from "@/lib/guest-preorder-send-validation";
import type { PreOrderLineItem } from "@/lib/pre-order";

type Body = {
  venueId?: string;
  customerUid?: string;
  items?: unknown[];
};

function parseQty(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(1, Math.floor(v));
  return 1;
}

function parsePrice(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
  if (typeof v === "string") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  return 0;
}

function sanitizeLineItems(raw: unknown[]): PreOrderLineItem[] {
  const out: PreOrderLineItem[] = [];
  for (const row of raw) {
    const x = (row ?? {}) as Record<string, unknown>;
    const id = typeof x.id === "string" && x.id.trim() ? x.id.trim() : "";
    const name = typeof x.name === "string" ? x.name.trim() : "";
    if (!id || !name) continue;
    const catalogItemId =
      typeof x.catalogItemId === "string" && x.catalogItemId.trim() ? x.catalogItemId.trim() : undefined;
    const note = typeof x.note === "string" && x.note.trim() ? x.note.trim() : undefined;
    out.push({
      id,
      name,
      qty: parseQty(x.qty),
      unitPrice: parsePrice(x.unitPrice),
      ...(note ? { note } : {}),
      ...(catalogItemId ? { catalogItemId } : {}),
    });
  }
  return out;
}

/**
 * POST /api/guest/preorder-send
 * Отправка предзаказа с серверной проверкой окна приёма и расписания групп меню по часам заведения.
 * Authorization: Bearer &lt;Firebase ID token&gt;
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
    const customerUid = body.customerUid?.trim() ?? "";
    const items = sanitizeLineItems(Array.isArray(body.items) ? body.items : []);

    if (!venueId || !customerUid) {
      return NextResponse.json({ error: "venueId и customerUid обязательны" }, { status: 400 });
    }

    const adminAuth = getAdminAuth();
    const decoded = await adminAuth.verifyIdToken(idToken);
    const uid = decoded.uid;

    const firestore = getAdminFirestore();
    const cartRef = firestore.collection("venues").doc(venueId).collection("preorder_carts").doc(customerUid);
    const cartSnap = await cartRef.get();
    if (!cartSnap.exists) {
      return NextResponse.json({ error: "Корзина не найдена" }, { status: 404 });
    }
    const cart = cartSnap.data() as Record<string, unknown>;
    if (cart.authUid !== uid) {
      return NextResponse.json({ error: "Нет доступа к этой корзине" }, { status: 403 });
    }
    if (cart.status !== "draft") {
      return NextResponse.json({ error: "Заказ уже отправлен или недоступен для отправки" }, { status: 409 });
    }

    const validated = await validateGuestPreorderSend({ firestore, venueId, items });
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error.message }, { status: validated.error.status });
    }

    await cartRef.set(
      {
        items,
        status: "sent",
        sentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: Date.now(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[guest/preorder-send]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
