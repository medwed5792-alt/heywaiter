import { NextRequest, NextResponse } from "next/server";
import { registerWebhook } from "@/lib/webhook/auto-webhooks";

/**
 * POST /api/bots/set-webhook
 * Тело: { channel: 'telegram' | 'vk', botType: 'client' | 'staff', token: string, baseUrl?: string }
 * При сохранении токенов в админке вызывайте этот endpoint для авто-регистрации вебхука.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { channel, botType, token, baseUrl } = body as {
      channel?: string;
      botType?: string;
      token?: string;
      baseUrl?: string;
    };

    if (!channel || !botType || !token) {
      return NextResponse.json(
        { error: "channel, botType and token required" },
        { status: 400 }
      );
    }
    if (channel !== "telegram" && channel !== "vk") {
      return NextResponse.json(
        { error: "channel must be telegram or vk" },
        { status: 400 }
      );
    }
    if (botType !== "client" && botType !== "staff") {
      return NextResponse.json(
        { error: "botType must be client or staff" },
        { status: 400 }
      );
    }

    const base =
      baseUrl ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.TUNNEL_URL ||
      "https://your-domain.com";

    const result = await registerWebhook(
      channel,
      botType,
      token,
      base
    );

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[set-webhook] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
