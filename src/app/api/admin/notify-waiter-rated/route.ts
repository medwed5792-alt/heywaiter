import { NextRequest } from "next/server";
import { getBotToken } from "@/lib/webhook/channels";

const TELEGRAM_API = "https://api.telegram.org/bot";

async function sendTelegram(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(`${TELEGRAM_API}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
  if (!res.ok || !data.ok) throw new Error("Telegram API error");
  return data;
}

/**
 * POST /api/admin/notify-waiter-rated
 * Body: { notificationId: string, waiterId: string, stars: number }
 * После оценки гостя ЛПР: отправить официанту в Staff Bot сообщение с кнопкой OK (при нажатии уведомление удаляется).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { notificationId, waiterId, stars } = body as { notificationId?: string; waiterId?: string; stars?: number };
    if (!notificationId || !waiterId || typeof stars !== "number") {
      return Response.json({ ok: false, error: "notificationId, waiterId, stars required" }, { status: 400 });
    }
    const { doc, getDoc } = await import("firebase/firestore");
    const { db } = await import("@/lib/firebase");
    const staffSnap = await getDoc(doc(db, "staff", waiterId));
    if (!staffSnap.exists()) {
      return Response.json({ ok: false, error: "Staff not found" }, { status: 404 });
    }
    const tgId = staffSnap.data()?.tgId ?? staffSnap.data()?.identity?.externalId;
    if (!tgId) {
      return Response.json({ ok: false, error: "Staff has no Telegram ID" }, { status: 400 });
    }
    const token = getBotToken("telegram", "staff") || process.env.TELEGRAM_STAFF_TOKEN;
    if (!token) {
      return Response.json({ ok: false, error: "Staff bot token not configured" }, { status: 500 });
    }
    const text = `Ваш гость оценён на ${stars} ${stars === 1 ? "звезду" : stars < 5 ? "звезды" : "звёзд"}. Отличная работа!`;
    await sendTelegram(token, "sendMessage", {
      chat_id: String(tgId),
      text,
      reply_markup: {
        inline_keyboard: [[{ text: "OK", callback_data: `gr_${notificationId}` }]],
      },
    });
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[notify-waiter-rated]", e);
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
