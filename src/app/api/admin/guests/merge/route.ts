export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import type { RecognitionPlatform } from "@/lib/guest-recognition";

const PLATFORMS: RecognitionPlatform[] = [
  "tg", "wa", "vk", "viber", "wechat", "instagram", "facebook", "line",
];

/**
 * POST /api/admin/guests/merge
 * Тело: { primaryGuestId: string, platformId: string, platform: RecognitionPlatform }
 * Склеивает профиль: добавляет platformId к гостю primaryGuestId (для Identity Stitching).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const primaryGuestId = body.primaryGuestId as string | undefined;
    const platformId = body.platformId as string | undefined;
    const platform = body.platform as string | undefined;
    if (!primaryGuestId || !platformId || !platform) {
      return Response.json(
        { ok: false, error: "primaryGuestId, platformId, platform required" },
        { status: 400 }
      );
    }
    if (!PLATFORMS.includes(platform as RecognitionPlatform)) {
      return Response.json(
        { ok: false, error: "platform must be one of: " + PLATFORMS.join(", ") },
        { status: 400 }
      );
    }
    const { mergeGuestProfiles } = await import("@/lib/guest-recognition");
    const result = await mergeGuestProfiles(
      primaryGuestId,
      platformId,
      platform as RecognitionPlatform
    );
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[guests merge]", e);
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
