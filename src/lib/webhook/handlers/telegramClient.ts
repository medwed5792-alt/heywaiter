/**
 * Обработчик Telegram Client Bot (гости).
 * Вызывается из универсального роутера api/webhook/[channel]/[botType].
 *
 * Mini App Launch: при /start с Deep Link бот сразу отправляет приветствие и Inline Keyboard
 * с кнопкой «🚀 Открыть пульт» (web_app → /mini-app с параметрами v, t, vid).
 * setChatMenuButton задаёт постоянную кнопку «Пульт»/«Меню» слева от поля ввода.
 *
 * Авто-открытие: если в BotFather создано расширение "Mini App", можно использовать
 * ссылку вида t.me/BotUsername/app_name?startapp=v_venueId_t_tableId для быстрого запуска.
 */
import { NextRequest } from "next/server";
import { collection, doc, getDoc, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { identifyGuest, getReservationForTable } from "@/lib/guest-recognition";
import { getAppUrl } from "@/lib/webhook/utils";

const TELEGRAM_API = "https://api.telegram.org/bot";

/** Минимальные типы для входящего Update от Telegram Bot API */
interface TelegramChat {
  id: number;
}
interface TelegramUser {
  id: number;
}
interface TelegramMessage {
  text?: string;
  chat?: TelegramChat;
  from?: TelegramUser;
}
interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: { chat?: { id: number } };
  from?: TelegramUser;
}
interface TelegramUpdate {
  callback_query?: TelegramCallbackQuery;
  message?: TelegramMessage;
}

function getWebAppBaseUrl(): string {
  return getAppUrl();
}

/**
 * Парсинг Deep Link из /start.
 * Поддерживаемые форматы:
 * - /start v_venueId_t_tableId (контракт с QR, например v_current_t_5)
 * - /start venueId_tableId (короткий формат, например test_1 → venueId: test, tableId: 1)
 */
function parseStartPayload(text: string): { venueId: string; tableId: string } | null {
  const raw = text?.trim() ?? "";
  const vT = raw.match(/\/start\s+(v_([^_]+)_t_(\d+))/i) ?? raw.match(/\/start\s+(v_([^_]+)_t_([^_\s]+))/i);
  if (vT) return { venueId: vT[2], tableId: vT[3] };
  const short = raw.match(/\/start\s+([^_\s]+)_(\d+)/);
  if (short) return { venueId: short[1], tableId: short[2] };
  return null;
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

/** Устанавливает кнопку «Меню» слева от поля ввода — открывает Mini App по URL */
async function setMenuButton(
  token: string,
  chatId: number,
  webAppUrl: string,
  buttonText: string = "Пульт"
): Promise<void> {
  try {
    await sendTelegram(token, "setChatMenuButton", {
      chat_id: chatId,
      menu_button: {
        type: "web_app",
        text: buttonText,
        web_app: { url: webAppUrl },
      },
    });
  } catch (e) {
    console.warn("[webhook telegram/client] setChatMenuButton failed (optional):", e);
  }
}

export async function handleTelegramClient(request: NextRequest, token: string): Promise<void> {
  const update = (await request.json()) as TelegramUpdate;
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
    const webAppUrl = `${baseUrl}/mini-app?chatId=${chatId}&platform=telegram`;
    await sendTelegram(token, "sendMessage", {
      chat_id: chatId,
      text: "Добро пожаловать в HeyWaiter! Нажмите кнопку ниже, чтобы открыть меню и вызвать официанта.",
      reply_markup: {
        inline_keyboard: [[{ text: "🚀 Открыть пульт", web_app: { url: webAppUrl } }]],
      },
    });
    await setMenuButton(token, chatId, webAppUrl, "Меню");
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
    const webAppUrl = `${baseUrl}/mini-app?v=${venueId}&chatId=${chatId}&platform=telegram`;
    await sendTelegram(token, "sendMessage", {
      chat_id: chatId,
      text: "Добро пожаловать в HeyWaiter! Нажмите кнопку ниже, чтобы открыть меню и вызвать официанта.",
      reply_markup: {
        inline_keyboard: [[{ text: "🚀 Открыть пульт", web_app: { url: webAppUrl } }]],
      },
    });
    await setMenuButton(token, chatId, webAppUrl, "Пульт");
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
  const webAppUrl = `${baseUrl}/mini-app?v=${venueId}&t=${tableId}&chatId=${chatId}&platform=telegram&role=${role}`;

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
    "Добро пожаловать в HeyWaiter! Нажмите кнопку ниже, чтобы открыть меню и вызвать официанта.";

  await sendTelegram(token, "sendMessage", {
    chat_id: chatId,
    text: welcomeText,
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 Открыть пульт", web_app: { url: webAppUrl } }],
        [{ text: "🔔 ВЫЗВАТЬ ОФИЦИАНТА", callback_data: `v_${venueId}_t_${tableId}` }],
      ],
    },
  });
  await setMenuButton(token, chatId, webAppUrl, "Пульт");
}

