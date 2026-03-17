export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { getBotToken } from "@/lib/webhook/channels";
import { getBotTokenFromStore } from "@/lib/webhook/bots-store";

const TELEGRAM_API = "https://api.telegram.org/bot";
const TELEGRAM_TIMEOUT_MS = 2000;

async function sendTelegram(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
  try {
    const res = await fetch(`${TELEGRAM_API}${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
    if (!res.ok || !data.ok) throw new Error("Telegram API error");
    return data;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

/**
 * POST /api/admin/staff/offer
 * 1) Создаёт запись в venues/[venueId]/staff и в корне staff со статусом pending_offer.
 * 2) Потом пробует отправить уведомление в Telegram. При ошибке Telegram — не блокируем, возвращаем success с пометкой.
 * Body: { userId, venueId, tgId, firstName?, lastName?, venueName? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    console.log("SENDING OFFER TO:", body);
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const venueId = typeof body.venueId === "string" ? body.venueId.trim() : "venue_andrey_alt";
    const tgId = typeof body.tgId === "string" ? body.tgId.trim() : "";
    const firstName = typeof body.firstName === "string" ? body.firstName.trim() : null;
    const lastName = typeof body.lastName === "string" ? body.lastName.trim() : null;
    const venueName = typeof body.venueName === "string" ? body.venueName.trim() : venueId;

    console.log("[offer] Start", { userId, venueId, tgId: tgId ? `${tgId.slice(0, 4)}***` : "" });

    if (!userId || !tgId) {
      console.log("[offer] Validation failed: userId or tgId missing");
      return NextResponse.json(
        { error: "userId и tgId обязательны" },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();
    const staffDocId = `${venueId}_${userId}`;

    // Проверка существующей записи в корне staff
    const rootStaffRef = firestore.collection("staff").doc(staffDocId);
    const existing = await rootStaffRef.get();
    console.log("[offer] Root staff exists:", existing.exists);

    if (existing.exists) {
      const d = existing.data() ?? {};
      if (d.active === true) {
        console.log("[offer] Already active");
        return NextResponse.json(
          { error: "Сотрудник уже в штате этого заведения" },
          { status: 409 }
        );
      }
      if (d.status === "pending_offer") {
        console.log("[offer] Offer already sent");
        return NextResponse.json(
          { error: "Предложение уже отправлено, ожидайте ответа" },
          { status: 409 }
        );
      }
    }

    const staffPayload = {
      venueId,
      userId,
      role: "waiter",
      primaryChannel: "telegram" as const,
      identity: { channel: "telegram" as const, externalId: tgId, locale: "ru", displayName: [firstName, lastName].filter(Boolean).join(" ") },
      onShift: false,
      active: false,
      status: "pending_offer" as const,
      tgId,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    };

    // 1) Сначала запись в venues/[venueId]/staff
    const venueStaffRef = firestore.collection("venues").doc(venueId).collection("staff").doc(staffDocId);
    await venueStaffRef.set(staffPayload);
    console.log("[offer] Written to venues/%s/staff/%s", venueId, staffDocId);

    // 2) Запись в корень staff (для callback бота и списков)
    await rootStaffRef.set(staffPayload);
    console.log("[offer] Written to staff/%s", staffDocId);

    // 3) Отправка в Telegram — таймаут 2 с; при ошибке/таймауте не блокируем ответ
    let telegramSent = false;
    try {
      let token = await getBotTokenFromStore("telegram", "staff");
      if (!token) token = getBotToken("telegram", "staff") || process.env.TELEGRAM_STAFF_TOKEN;
      if (!token) {
        console.log("[offer] No staff bot token configured");
      } else {
        const chatId = String(tgId);
        console.log("[offer] Sending Telegram to chat_id:", chatId);
        const text = `Вам направлено предложение о работе в заведении «${venueName}».\n\nНажмите «Принять», чтобы присоединиться к команде и получить доступ к сменам в приложении.`;
        await sendTelegram(token, "sendMessage", {
          chat_id: chatId,
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
        telegramSent = true;
        console.log("[offer] Telegram sent OK");
      }
    } catch (tgErr) {
      console.error("[offer] Telegram send failed (timeout or error):", tgErr);
    }

    if (telegramSent) {
      return NextResponse.json({ ok: true, success: true, staffId: staffDocId });
    }
    return NextResponse.json({
      ok: true,
      success: true,
      staffId: staffDocId,
      notificationSent: false,
      message: "Оффер создан, уведомление в бот отправится позже. Сотрудник увидит оффер при входе в Личный кабинет.",
    });
  } catch (err) {
    console.error("[admin/staff/offer]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
