import { NextRequest } from "next/server";
import { notifyOrderReady } from "@/lib/bot-router";

const VENUE_ID = "current";

/**
 * POST /api/admin/delivery/notify
 * Тело: { orderNumber: number }
 * Пульт выдачи: ввели номер → гостю уходит пуш в его соцсеть (зеркало канала).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const orderNumber = Number(body.orderNumber);
    if (!Number.isFinite(orderNumber) || orderNumber < 1) {
      return Response.json({ ok: false, error: "Введите номер заказа" }, { status: 400 });
    }
    const orderId = `${VENUE_ID}_${orderNumber}`;
    const result = await notifyOrderReady(orderId);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[delivery notify]", e);
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
