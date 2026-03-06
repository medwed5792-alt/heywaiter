import { NextRequest } from "next/server";
import { notifyOrderReady } from "@/lib/bot-router";

/**
 * POST /api/admin/kitchen/order-ready
 * Тело: { orderId: string }
 * Обновляет заказ на status: 'ready' и отправляет гостю зеркальное уведомление в его канал (TG/VK/WA).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const orderId = body.orderId as string | undefined;
    if (!orderId) {
      return Response.json({ ok: false, error: "orderId required" }, { status: 400 });
    }
    const result = await notifyOrderReady(orderId);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[kitchen order-ready]", e);
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
