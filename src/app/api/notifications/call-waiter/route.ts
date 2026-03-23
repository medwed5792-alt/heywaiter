export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { pushCallWaiterNotification } from "@/lib/notifications/push-call-waiter";

/**
 * POST /api/notifications/call-waiter
 * Тело: venueId, tableId, type?: "call_waiter" | "request_bill" | "sos", customerUid?
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const venueId = (body.venueId as string)?.trim();
    const tableId = (body.tableId as string)?.trim();
    const customerUid =
      (body.customerUid as string)?.trim() || (body.visitorId as string)?.trim() || undefined;
    const type = (body.type as string) || "call_waiter";

    if (!venueId || !tableId) {
      return NextResponse.json(
        { ok: false, error: "venueId и tableId обязательны" },
        { status: 400 }
      );
    }

    await pushCallWaiterNotification({
      venueId,
      tableId,
      customerUid,
      type: type === "request_bill" ? "request_bill" : type === "sos" ? "sos" : "call_waiter",
    });

    return NextResponse.json({ ok: true, message: "Вызов отправлен" });
  } catch (err) {
    console.error("[call-waiter]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}
