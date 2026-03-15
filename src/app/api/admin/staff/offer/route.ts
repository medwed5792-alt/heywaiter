export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { getBotToken } from "@/lib/webhook/channels";
import { getBotTokenFromStore } from "@/lib/webhook/bots-store";

const TELEGRAM_API = "https://api.telegram.org/bot";

async function sendTelegram(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(`${TELEGRAM_API}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
  if (!res.ok || !data.ok) throw new Error("Telegram API error");
  return data;
}

/**
 * POST /api/admin/staff/offer
 * Отправить предложение о работе: создаётся запись staff со статусом pending_offer,
 * сотруднику в Telegram уходит сообщение с кнопками [Принять] [Отклонить].
 * Body: { userId: string, venueId: string, tgId: string, firstName?: string, lastName?: string, venueName?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const venueId = typeof body.venueId === "string" ? body.venueId.trim() : "current";
    const tgId = typeof body.tgId === "string" ? body.tgId.trim() : "";
    const firstName = typeof body.firstName === "string" ? body.firstName.trim() : null;
    const lastName = typeof body.lastName === "string" ? body.lastName.trim() : null;
    const venueName = typeof body.venueName === "string" ? body.venueName.trim() : venueId;

    if (!userId || !tgId) {
      return NextResponse.json(
        { error: "userId и tgId обязательны" },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();
    const staffDocId = `${venueId}_${userId}`;
    const staffRef = firestore.collection("staff").doc(staffDocId);
    const existing = await staffRef.get();

    if (existing.exists) {
      const d = existing.data() ?? {};
      if (d.active === true) {
        return NextResponse.json(
          { error: "Сотрудник уже в штате этого заведения" },
          { status: 409 }
        );
      }
      if (d.status === "pending_offer") {
        return NextResponse.json(
          { error: "Предложение уже отправлено, ожидайте ответа" },
          { status: 409 }
        );
      }
    }

    await staffRef.set({
      venueId,
      userId,
      role: "waiter",
      primaryChannel: "telegram",
      identity: { channel: "telegram", externalId: tgId, locale: "ru", displayName: [firstName, lastName].filter(Boolean).join(" ") },
      onShift: false,
      active: false,
      status: "pending_offer",
      tgId,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    let token = await getBotTokenFromStore("telegram", "staff");
    if (!token) token = getBotToken("telegram", "staff") || process.env.TELEGRAM_STAFF_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "Staff bot token не настроен" },
        { status: 500 }
      );
    }

    const displayName = [firstName, lastName].filter(Boolean).join(" ") || "Сотрудник";
    const text = `Вам направлено предложение о работе в заведении «${venueName}».\n\nНажмите «Принять», чтобы присоединиться к команде и получить доступ к сменам в приложении.`;
    await sendTelegram(token, "sendMessage", {
      chat_id: String(tgId),
      text,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Принять", callback_data: `offer_accept_${staffDocId}` },
            { text: "Отклонить", callback_data: `offer_decline_${staffDocId}` },
          ],
        ],
      },
    });

    return NextResponse.json({ ok: true, staffId: staffDocId });
  } catch (err) {
    console.error("[admin/staff/offer]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
