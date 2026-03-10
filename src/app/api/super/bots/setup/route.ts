/**
 * POST /api/super/bots/setup
 * Инициализация бота: проверка токена (getMe), установка webhook, сохранение в Firestore (system_settings/bots).
 * Тело: { token: string, botType: "client" | "staff" }
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { setTelegramWebhook } from "@/lib/webhook/auto-webhooks";
import { updateBotsConfig } from "@/lib/webhook/bots-store";
import { getAppUrl } from "@/lib/webhook/utils";

const TELEGRAM_API = "https://api.telegram.org/bot";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = (body.token as string)?.trim();
    const botType = body.botType as string;

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Токен обязателен" },
        { status: 400 }
      );
    }
    if (botType !== "client" && botType !== "staff") {
      return NextResponse.json(
        { ok: false, error: "botType должен быть client или staff" },
        { status: 400 }
      );
    }

    const getMeRes = await fetch(`${TELEGRAM_API}${token}/getMe`);
    const getMeData = (await getMeRes.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { username?: string };
      description?: string;
    };

    if (!getMeRes.ok || !getMeData.ok || !getMeData.result) {
      return NextResponse.json(
        {
          ok: false,
          error:
            getMeData.description || "Telegram API: неверный токен или сеть",
        },
        { status: 400 }
      );
    }

    const username = getMeData.result.username;
    const usernameWithAt = username ? `@${username}` : "";

    const baseUrl = getAppUrl();
    const webhookPath =
      botType === "client"
        ? "/api/webhook/telegram/client"
        : "/api/webhook/telegram/staff";
    const webhookUrl = `${baseUrl.replace(/\/$/, "")}${webhookPath}`;

    const setWebhookResult = await setTelegramWebhook(token, webhookUrl);
    if (!setWebhookResult.ok) {
      return NextResponse.json(
        { ok: false, error: setWebhookResult.error || "Ошибка setWebhook" },
        { status: 400 }
      );
    }

    const updates: Record<string, string> = {};
    if (botType === "client") {
      updates.tg_client_token = token;
      updates.tg_client_username = usernameWithAt;
    } else {
      updates.tg_staff_token = token;
      updates.tg_staff_username = usernameWithAt;
    }

    await updateBotsConfig(updates);

    return NextResponse.json({
      ok: true,
      message: "Бот инициализирован. Связь установлена успешно.",
      username: usernameWithAt,
    });
  } catch (err) {
    console.error("[super/bots/setup]", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Внутренняя ошибка",
      },
      { status: 500 }
    );
  }
}
