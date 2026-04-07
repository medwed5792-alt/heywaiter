export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { pushCallWaiterNotification } from "@/lib/notifications/push-call-waiter";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const venueId = (body.venueId as string)?.trim();
    const tableId = (body.tableId as string)?.trim();
    const customerUid =
      (body.customerUid as string)?.trim() ||
      (body.uid as string)?.trim() ||
      (body.visitorId as string)?.trim() ||
      undefined;
    if (!venueId || !tableId) {
      return NextResponse.json({ ok: false, error: "venueId и tableId обязательны" }, { status: 400 });
    }

    await pushCallWaiterNotification({
      venueId,
      tableId,
      customerUid,
    });

    return NextResponse.json({ ok: true, message: "Вызов отправлен" });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}

