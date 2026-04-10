import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getEffectiveBotToken } from "@/lib/webhook/bots-store";
import { verifyTelegramWebAppInitData } from "@/lib/telegram-webapp-init-data";
import { findGuestByExternalIdentity } from "@/lib/identity/global-guest-hub";

export const runtime = "nodejs";

/**
 * POST /api/guest/hub-profile
 * Снимок привязок Identity Hub для экрана «Профиль» (без секретов).
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      initData?: string;
      globalGuestUid?: string;
      deviceAnchor?: string;
    };
    const initData = typeof body.initData === "string" ? body.initData.trim() : "";
    const known = typeof body.globalGuestUid === "string" ? body.globalGuestUid.trim() : "";
    const deviceAnchor = typeof body.deviceAnchor === "string" ? body.deviceAnchor.trim() : "";

    let tgId: string | null = null;
    const token = await getEffectiveBotToken("telegram", "client");
    if (initData && token) {
      const v = verifyTelegramWebAppInitData(initData, token);
      if (v.ok) tgId = v.userId;
    }

    const fs = getAdminFirestore();
    let docId: string | null = null;
    if (known) {
      const s = await fs.collection("global_users").doc(known).get();
      if (s.exists) docId = known;
    }
    if (!docId && tgId) {
      docId = await findGuestByExternalIdentity("tg", tgId);
    }
    if (!docId && deviceAnchor) {
      docId = await findGuestByExternalIdentity("anon", deviceAnchor);
    }

    if (!docId) {
      return NextResponse.json({
        ok: true,
        globalGuestUid: null,
        channels: null,
      });
    }

    const snap = await fs.collection("global_users").doc(docId).get();
    const identities = (snap.data()?.identities ?? {}) as Record<string, string>;
    const mask = (v: string | undefined, head = 3) => {
      const s = (v ?? "").trim();
      if (!s) return "";
      if (s.length <= head + 2) return "•••";
      return `${s.slice(0, head)}…`;
    };

    const channels: Record<string, { linked: boolean; hint?: string }> = {
      telegram: {
        linked: Boolean(identities.tg),
        hint: identities.tg ? `id ${mask(identities.tg, 4)}` : undefined,
      },
      vk: { linked: Boolean(identities.vk), hint: identities.vk ? mask(identities.vk) : undefined },
      whatsapp: { linked: Boolean(identities.wa), hint: identities.wa ? mask(identities.wa) : undefined },
      phone: { linked: Boolean(identities.phone), hint: identities.phone ? mask(identities.phone.replace(/\D/g, ""), 3) : undefined },
      email: { linked: Boolean(identities.email), hint: identities.email ? mask(identities.email, 2) : undefined },
      device: { linked: Boolean(identities.anon), hint: identities.anon ? "устройство привязано" : undefined },
    };

    return NextResponse.json({
      ok: true,
      globalGuestUid: docId,
      channels,
    });
  } catch (e) {
    console.error("[api/guest/hub-profile]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server_error" },
      { status: 500 }
    );
  }
}
