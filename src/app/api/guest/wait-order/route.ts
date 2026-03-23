import { NextRequest } from "next/server";
import { DEFAULT_VENUE_ID } from "@/lib/standards/venue-default";

const VENUE_ID = DEFAULT_VENUE_ID;

/**
 * POST /api/guest/wait-order
 * Тело: {
 *   venueId?: string,
 *   orderNumber: number,
 *   guestChatId: string,
 *   guestPlatform: string,
 *   customerUid?: string,
 *   tableId?: string
 * }
 * Примитив Fast Food: гость ввёл номер заказа/чека и жмёт «Ждать готовности». Создаём/обновляем запись для пульта выдачи.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const venueId = (body.venueId as string) || VENUE_ID;
    const orderNumber = Number(body.orderNumber);
    const guestChatId = body.guestChatId as string;
    const guestPlatform = (body.guestPlatform as string) || "telegram";
    const customerUid = (body.customerUid as string | undefined)?.trim();
    const tableId = (body.tableId as string | undefined)?.trim();
    if (!Number.isFinite(orderNumber) || orderNumber < 1 || !guestChatId) {
      return Response.json(
        { ok: false, error: "orderNumber (число) и guestChatId обязательны" },
        { status: 400 }
      );
    }
    const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");
    const { db } = await import("@/lib/firebase");
    const orderId = `${venueId}_${orderNumber}`;
    await setDoc(doc(db, "orders", orderId), {
      orderNumber,
      venueId,
      guestChatId,
      guestPlatform,
      customerUid: customerUid || guestChatId,
      ...(tableId ? { tableId } : {}),
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return Response.json({ ok: true, orderId });
  } catch (e) {
    console.error("[wait-order]", e);
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
