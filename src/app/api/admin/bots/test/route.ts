export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { getBotToken } from "@/lib/webhook/channels";
import { isKnownChannel } from "@/lib/webhook/channels";
import { isKnownBotType } from "@/lib/webhook/channels";
import { getBotTokenFromStore } from "@/lib/webhook/bots-store";

const TELEGRAM_API = "https://api.telegram.org/bot";

/**
 * POST /api/admin/bots/test
 * Тело: { channel: string, botType: "client" | "staff" }
 * Проверяет связь с ботом: для Telegram — getMe; при успехе возвращает ok.
 * Токен берётся из Firestore (system_settings/bots) или env.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const channel = (body.channel as string) ?? "";
    const botType = (body.botType as string) ?? "client";
    if (!isKnownChannel(channel) || !isKnownBotType(botType)) {
      return Response.json(
        { ok: false, error: "channel and botType required (e.g. telegram, client)" },
        { status: 400 }
      );
    }
    let token: string | undefined;
    if (channel === "telegram") {
      token = await getBotTokenFromStore(channel, botType as "client" | "staff");
    }
    if (!token) token = getBotToken(channel, botType as "client" | "staff");
    if (!token) {
      return Response.json(
        { ok: false, error: "Токен не настроен для этого канала и типа бота" },
        { status: 400 }
      );
    }
    if (channel === "telegram") {
      const res = await fetch(`${TELEGRAM_API}${token}/getMe`);
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (!res.ok || !data.ok) {
        return Response.json(
          { ok: false, error: "Telegram API: неверный токен или сеть" },
          { status: 400 }
        );
      }
      return Response.json({ ok: true, message: "HeyWaiter: Связь установлена успешно!" });
    }
    return Response.json(
      { ok: false, error: "Тест связи реализован только для Telegram" },
      { status: 400 }
    );
  } catch (e) {
    console.error("[bots test]", e);
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
