import { NextRequest, NextResponse } from "next/server";
import { getBotToken } from "@/lib/webhook/channels";
import { handleTelegramClient } from "@/lib/webhook/handlers/telegramClient";

/**
 * Обратная совместимость: POST /api/webhook/telegram → обрабатывается как Telegram Client Bot.
 * Для новой схемы используйте POST /api/webhook/telegram/client.
 */
export async function POST(request: NextRequest) {
  const token =
    getBotToken("telegram", "client") ||
    (process.env.TELEGRAM_BOT_TOKEN as string);
  if (!token) {
    return NextResponse.json(
      { error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CLIENT_TOKEN not set" },
      { status: 503 }
    );
  }
  try {
    await handleTelegramClient(request, token);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhook/telegram] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Webhook error" },
      { status: 500 }
    );
  }
}
