import { NextRequest, NextResponse } from "next/server";

/**
 * Единая точка входа для вебхуков не используется: каждая платформа вызывает
 * свой URL. Используйте:
 *
 *   POST /api/webhook/{channel}/{botType}
 *
 * где channel: telegram | whatsapp | vk | viber | wechat | instagram | facebook | line
 *       botType: client | staff
 *
 * Обратная совместимость: POST /api/webhook/telegram → Telegram Client Bot
 * (см. src/app/api/webhook/telegram/route.ts).
 *
 * Завершение визита — в дашборде / единый use-case closeTableSession; Staff-бот не меняет сессию.
 */
export async function POST(request: NextRequest) {
  return NextResponse.json(
    {
      error: "Use POST /api/webhook/{channel}/{botType}",
      channels: ["telegram", "whatsapp", "vk", "viber", "wechat", "instagram", "facebook", "line"],
      botTypes: ["client", "staff"],
    },
    { status: 400 }
  );
}
