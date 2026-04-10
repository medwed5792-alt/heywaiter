import { NextRequest, NextResponse } from "next/server";
import { getEffectiveBotToken } from "@/lib/webhook/bots-store";
import { verifyTelegramWebAppInitData } from "@/lib/telegram-webapp-init-data";
import {
  findGuestByExternalIdentity,
  linkIdentityToGlobalGuestUid,
  type GuestIdentityInput,
} from "@/lib/identity/global-guest-hub";

export const runtime = "nodejs";

const ALLOWED_KEYS = new Set<GuestIdentityInput["key"]>(["tg", "wa", "vk", "phone", "email", "anon"]);

/**
 * POST /api/guest/link-identity
 * Привязка дополнительного ключа к текущему globalUid (после проверки Telegram initData).
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      initData?: string;
      key?: string;
      value?: string;
    };
    const initData = typeof body.initData === "string" ? body.initData.trim() : "";
    const keyRaw = typeof body.key === "string" ? body.key.trim().toLowerCase() : "";
    const valueRaw = typeof body.value === "string" ? body.value.trim() : "";

    if (!initData) {
      return NextResponse.json({ error: "initData required" }, { status: 400 });
    }
    const token = await getEffectiveBotToken("telegram", "client");
    if (!token) {
      return NextResponse.json({ error: "guest_bot_token_unconfigured" }, { status: 503 });
    }
    const v = verifyTelegramWebAppInitData(initData, token);
    if (!v.ok) {
      return NextResponse.json({ error: v.reason }, { status: 401 });
    }

    if (!ALLOWED_KEYS.has(keyRaw as GuestIdentityInput["key"])) {
      return NextResponse.json({ error: "unsupported_identity_key" }, { status: 400 });
    }
    const key = keyRaw as GuestIdentityInput["key"];
    if (!valueRaw) {
      return NextResponse.json({ error: "value required" }, { status: 400 });
    }

    const anchorUid = await findGuestByExternalIdentity("tg", v.userId);
    if (!anchorUid) {
      return NextResponse.json(
        { error: "Сначала отсканируйте QR стола или откройте приложение из гостевого бота." },
        { status: 404 }
      );
    }

    const occupied = await findGuestByExternalIdentity(key, key === "phone" ? valueRaw.replace(/\D/g, "") : valueRaw);
    if (occupied && occupied !== anchorUid) {
      return NextResponse.json(
        { error: "Этот контакт уже привязан к другому профилю. Обратитесь в поддержку." },
        { status: 409 }
      );
    }

    const ok = await linkIdentityToGlobalGuestUid(anchorUid, { key, value: valueRaw });
    if (!ok) {
      return NextResponse.json({ error: "link_failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, globalGuestUid: anchorUid });
  } catch (e) {
    console.error("[api/guest/link-identity]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server_error" },
      { status: 500 }
    );
  }
}
