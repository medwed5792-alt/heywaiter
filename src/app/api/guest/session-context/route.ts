import { NextRequest, NextResponse } from "next/server";
import { getEffectiveBotToken } from "@/lib/webhook/bots-store";
import { verifyTelegramWebAppInitData } from "@/lib/telegram-webapp-init-data";
import { linkIdentityToGlobalGuestUid } from "@/lib/identity/global-guest-hub";

export const runtime = "nodejs";

async function resolveVerifiedUser(initData: string) {
  const token = await getEffectiveBotToken("telegram", "client");
  if (!token) {
    return { error: NextResponse.json({ error: "guest_bot_token_unconfigured" }, { status: 503 }) };
  }
  const v = verifyTelegramWebAppInitData(initData, token);
  if (!v.ok) return { error: NextResponse.json({ error: v.reason }, { status: 401 }) };
  return { userId: v.userId };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      initData?: string;
      globalGuestUid?: string;
    };
    const action = String(body.action ?? "clear").trim().toLowerCase();
    const initData = typeof body.initData === "string" ? body.initData.trim() : "";
    if (!initData) {
      return NextResponse.json({ error: "initData required" }, { status: 400 });
    }

    const verified = await resolveVerifiedUser(initData);
    if ("error" in verified) return verified.error;
    const { userId } = verified;

    if (action === "link_identity") {
      const globalGuestUid = String(body.globalGuestUid ?? "").trim();
      if (!globalGuestUid) {
        return NextResponse.json({ error: "globalGuestUid required" }, { status: 400 });
      }
      const ok = await linkIdentityToGlobalGuestUid(globalGuestUid, { key: "tg", value: userId });
      return NextResponse.json({ ok });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/guest/session-context]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server_error" },
      { status: 500 }
    );
  }
}
