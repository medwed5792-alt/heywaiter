/**
 * Обработчик Telegram Client Bot (гости).
 * Вызывается из универсального роутера api/webhook/[channel]/[botType].
 */
import { NextRequest } from "next/server";
import { collection, doc, getDoc, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { identifyGuest, getReservationForTable } from "@/lib/guest-recognition";

const TELEGRAM_API = "https://api.telegram.org/bot";

function getWebAppBaseUrl(): string {
  return (
    (process.env.NEXT_PUBLIC_APP_URL || process.env.TUNNEL_URL || "http://localhost:3000") as string
  ).replace(/\/$/, "");
}

function parseStartPayload(text: string): { venueId: string; tableId: string } | null {
  const match =
    text?.trim().match(/\/start\s+(v_([^_]+)_t_(\d+))/i) ||
    text?.trim().match(/\/start\s+(v_([^_]+)_t_([^_\s]+))/i);
  if (!match) return null;
  return { venueId: match[2], tableId: match[3] };
}

function parseCallbackData(data: string): { venueId: string; tableId: string } | null {
  const match = data?.match(/v_([^_]+)_t_([^_\s]+)/);
  if (!match) return null;
  return { venueId: match[1], tableId: match[2] };
}

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
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!res.ok || !data.ok) {
    console.error("[webhook telegram/client] API error:", method, res.status, data);
    throw new Error(data.description || "Telegram API error");
  }
  return data;
}

export async function handleTelegramClient(request: NextRequest, token: string): Promise<void> {
  const update = await request.json();
  console.log("[webhook telegram/client] Incoming update:", JSON.stringify(update, null, 2));

  const baseUrl = getWebAppBaseUrl();

  if (update.callback_query) {
    const { id: callbackId, data, message, from } = update.callback_query;
    const parsed = parseCallbackData(data || "");
    if (!parsed) {
      await sendTelegram(token, "answerCallbackQuery", {
        callback_query_id: callbackId,
        text: "Ошибка: неверные данные.",
      });
      return;
    }
    const { venueId, tableId } = parsed;
    const tableIdNum = parseInt(tableId, 10) || 0;
    await addDoc(collection(db, "serviceCalls"), {
      venueId,
      tableId: !Number.isNaN(tableIdNum) ? tableIdNum : tableId,
      status: "pending",
      guestTelegramId: from?.id,
      createdAt: serverTimestamp(),
    });
    await sendTelegram(token, "answerCallbackQuery", {
      callback_query_id: callbackId,
      text: "Официант уведомлён! Скоро подойдёт.",
    });
    const chatId = message?.chat?.id;
    if (chatId) {
      await sendTelegram(token, "sendMessage", {
        chat_id: chatId,
        text: "✅ Официант вызван. Ожидайте.",
      });
    }
    return;
  }

  const message = update.message;
  if (!message?.text) return;

  const chatId = message.chat?.id;
  const tgId = String(message.from?.id ?? "");
  if (!chatId) return;

  await sendTelegram(token, "sendMessage", {
    chat_id: chatId,
    text: "\u200b",
    reply_markup: { remove_keyboard: true },
  });

  const parsed = parseStartPayload(message.text);
  if (!parsed) {
    await sendTelegram(token, "sendMessage", {
      chat_id: chatId,
      text: "Добро пожаловать в HeyWaiter! Отсканируйте QR-код стола, чтобы начать.",
    });
    return;
  }

  const { venueId, tableId } = parsed;
  const tableNum = tableId;
  const { guest, kind } = await identifyGuest(tgId, "tg");

  if (guest?.type === "blacklisted") {
    await sendTelegram(token, "sendMessage", {
      chat_id: chatId,
      text: "Доступ ограничен. Обратитесь к администрации.",
    });
    return;
  }

  const venueSnap = await getDoc(doc(db, "venues", venueId));
  const venueData = venueSnap.exists() ? venueSnap.data() : {};
  const venueType = venueData.venueType as string | undefined;

  if (venueType === "fast_food") {
    const webAppUrl = `${baseUrl}/check-in/panel?v=${venueId}&chatId=${chatId}&platform=telegram`;
    await sendTelegram(token, "sendMessage", {
      chat_id: chatId,
      text: "Введите номер вашего заказа/чека в приложении и нажмите «Ждать готовности» — мы оповестим вас в этот чат.",
      reply_markup: {
        inline_keyboard: [[{ text: "📋 Открыть приложение", web_app: { url: webAppUrl } }]],
      },
    });
    return;
  }

  const { reserved, isOwner } = await getReservationForTable(venueId, tableId, guest?.tgId ?? tgId);
  if (reserved && !isOwner) {
    await sendTelegram(token, "sendMessage", {
      chat_id: chatId,
      text: "Стол забронирован. Обратитесь к хостес.",
    });
    return;
  }

  const role = kind === "OWN" ? "vip" : "guest";
  const webAppUrl = `${baseUrl}/check-in?v=${venueId}&t=${tableId}&role=${role}`;

  if (kind === "OWN" && guest) {
    await addDoc(collection(db, "activeSessions"), {
      venueId,
      tableId,
      tableNumber: tableNum,
      guestId: guest.id,
      guestTgId: tgId,
      guestChannel: "telegram",
      guestChatId: chatId,
      status: "check_in_success",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await addDoc(collection(db, "staffNotifications"), {
      venueId,
      tableId,
      type: "new_guest",
      message: `Новый гость за столом №${tableNum}${guest.name ? ` — ${guest.name}` : ""}`,
      read: false,
      guestId: guest.id,
      preferences: guest.preferences ?? {},
      favDish: guest.preferences?.favDish,
      favDrink: guest.preferences?.favDrink,
      notes: guest.preferences?.notes,
      createdAt: serverTimestamp(),
    });
  } else {
    await addDoc(collection(db, "activeSessions"), {
      venueId,
      tableId,
      tableNumber: tableNum,
      guestTgId: tgId,
      guestChannel: "telegram",
      guestChatId: chatId,
      status: "check_in_success",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const welcomeText =
    kind === "OWN"
      ? `Добро пожаловать в HeyWaiter! 🥂 Вы за столом №${tableNum}. Откройте меню по кнопке ниже.`
      : `Добро пожаловать в HeyWaiter! 🥂 Вы за столом №${tableNum}. Нажмите кнопку ниже, чтобы открыть меню или вызвать официанта.`;

  await sendTelegram(token, "sendMessage", {
    chat_id: chatId,
    text: welcomeText,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: kind === "OWN" ? "💎 Открыть меню" : "🚀 Открыть меню",
            web_app: { url: webAppUrl },
          },
        ],
        [
          {
            text: "🔔 ВЫЗВАТЬ ОФИЦИАНТА",
            callback_data: `v_${venueId}_t_${tableId}`,
          },
        ],
      },
    },
  });
}
