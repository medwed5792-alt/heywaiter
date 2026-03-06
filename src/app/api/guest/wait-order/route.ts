import { NextRequest } from "next/server";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

const VENUE_ID = "current";

/**
 * POST /api/guest/wait-order
 * Тело: { venueId?: string, orderNumber: number, guestChatId: string, guestPlatform: string }
 * Примитив Fast Food: гость ввёл номер заказа/чека и жмёт «Ждать готовности». Создаём/обновляем запись для пульта выдачи.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const venueId = (body.venueId as string) || VENUE_ID;
    const orderNumber = Number(body.orderNumber);
    const guestChatId = body.guestChatId as string;
    const guestPlatform = (body.guestPlatform as string) || "telegram";
    if (!Number.isFinite(orderNumber) || orderNumber < 1 || !guestChatId) {
      return Response.json(
        { ok: false, error: "orderNumber (число) и guestChatId обязательны" },
        { status: 400 }
      );
    }
    const orderId = `${venueId}_${orderNumber}`;
    await setDoc(doc(db, "orders", orderId), {
      orderNumber,
      venueId,
      guestChatId,
      guestPlatform,
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
