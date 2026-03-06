import { NextRequest, NextResponse } from "next/server";
import {
  getBotToken,
  isKnownChannel,
  isKnownBotType,
} from "@/lib/webhook/channels";
import { handleTelegramClient } from "@/lib/webhook/handlers/telegramClient";
import { handleTelegramStaff } from "@/lib/webhook/handlers/telegramStaff";

/**
 * Универсальный роутер для 14 ботов: 7 каналов × 2 типа (Client + Staff).
 * POST /api/webhook/telegram/client, /api/webhook/telegram/staff, ...
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ channel: string; botType: string }> }
) {
  const { channel, botType } = await context.params;

  if (!isKnownChannel(channel)) {
    console.warn("[webhook] Unknown channel:", channel);
    return NextResponse.json(
      { error: "Unknown channel" },
      { status: 400 }
    );
  }
  if (!isKnownBotType(botType)) {
    console.warn("[webhook] Unknown botType:", botType);
    return NextResponse.json(
      { error: "Unknown bot type (use client or staff)" },
      { status: 400 }
    );
  }

  const token = getBotToken(channel, botType);
  if (!token) {
    console.warn("[webhook] No token for", channel, botType);
    return NextResponse.json(
      { error: "Bot not configured" },
      { status: 503 }
    );
  }

  try {
    if (channel === "telegram" && botType === "client") {
      await handleTelegramClient(request, token);
      return NextResponse.json({ ok: true });
    }
    if (channel === "telegram" && botType === "staff") {
      await handleTelegramStaff(request, token);
      return NextResponse.json({ ok: true });
    }

    // Остальные каналы: заглушка (логируем, возвращаем 200)
    const body = await request.clone().json().catch(() => ({}));
    console.log(`[webhook ${channel}/${botType}] Not implemented:`, JSON.stringify(body).slice(0, 200));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[webhook ${channel}/${botType}] Error:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Webhook error" },
      { status: 500 }
    );
  }
}
