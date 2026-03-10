export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { WEBHOOK_CHANNELS } from "@/lib/webhook/channels";
import type { BotType } from "@/lib/webhook/channels";
import { getBotToken } from "@/lib/webhook/channels";
import { getBotsConfig, getBotTokenFromStore } from "@/lib/webhook/bots-store";

/**
 * GET /api/admin/bots/status
 * Возвращает для каждого канала и типа бота флаг active и для Telegram — username из Firestore.
 */
export async function GET() {
  const botsConfig = await getBotsConfig();
  const bots: { channel: string; botType: BotType; active: boolean; username?: string }[] = [];
  for (const channel of WEBHOOK_CHANNELS) {
    for (const botType of ["client", "staff"] as BotType[]) {
      let token: string | undefined;
      if (channel === "telegram") {
        token = await getBotTokenFromStore(channel, botType);
      }
      if (!token) token = getBotToken(channel, botType);
      const username =
        channel === "telegram" && botType === "client"
          ? botsConfig.tg_client_username ?? undefined
          : channel === "telegram" && botType === "staff"
            ? botsConfig.tg_staff_username ?? undefined
            : undefined;
      bots.push({ channel, botType, active: Boolean(token), username: username ?? undefined });
    }
  }
  return NextResponse.json({ bots });
}
