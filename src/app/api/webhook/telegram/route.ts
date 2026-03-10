import { NextRequest, NextResponse } from "next/server";
import { getBotToken } from "@/lib/webhook/channels";
import { getBotTokenFromStore } from "@/lib/webhook/bots-store";

/**
 * Обратная совместимость: POST /api/webhook/telegram → обрабатывается как Telegram Client Bot.
 * Токен из Firestore (system_settings/bots) или env.
 */
export async function POST(request: NextRequest) {
  let token = await getBotTokenFromStore("telegram", "client");
  if (!token) token = getBotToken("telegram", "client") || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CLIENT_TOKEN not set" },
      { status: 503 }
    );
  }
  try {
    const { handleTelegramClient } = await import("@/lib/webhook/handlers/telegramClient");
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
