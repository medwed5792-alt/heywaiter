import { NextResponse } from "next/server";
import { WEBHOOK_CHANNELS } from "@/lib/webhook/channels";
import type { BotType } from "@/lib/webhook/channels";
import { getBotToken } from "@/lib/webhook/channels";

/**
 * GET /api/admin/bots/status
 * Возвращает для каждого канала и типа бота флаг active (токен настроен).
 */
export async function GET() {
  const bots: { channel: string; botType: BotType; active: boolean }[] = [];
  for (const channel of WEBHOOK_CHANNELS) {
    for (const botType of ["client", "staff"] as BotType[]) {
      const token = getBotToken(channel, botType);
      bots.push({ channel, botType, active: Boolean(token) });
    }
  }
  return NextResponse.json({ bots });
}
