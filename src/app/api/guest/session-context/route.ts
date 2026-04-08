import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getEffectiveBotToken } from "@/lib/webhook/bots-store";
import { verifyTelegramWebAppInitData } from "@/lib/telegram-webapp-init-data";

export const runtime = "nodejs";

/** Служебная склейка мессенджер→стол (не доменная activeSessions). */
const IDX = "active_sessions";

function idxDocId(telegramUserId: string): string {
  const id = telegramUserId.trim();
  return id ? `tg_${id}` : "";
}

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
      initData?: string;
    };
    const initData = typeof body.initData === "string" ? body.initData.trim() : "";
    if (!initData) {
      return NextResponse.json({ error: "initData required" }, { status: 400 });
    }

    const verified = await resolveVerifiedUser(initData);
    if ("error" in verified) return verified.error;
    const { userId } = verified;

    const fs = getAdminFirestore();
    const docId = idxDocId(userId);
    const ref = fs.collection(IDX).doc(docId);
    await ref.delete().catch(() => undefined);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/guest/session-context]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server_error" },
      { status: 500 }
    );
  }
}
