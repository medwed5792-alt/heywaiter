/**
 * Обработчик Telegram Staff Bot (персонал).
 * Число = закрытие стола → гостю thankYou + реклама/опрос по tier. SOS = ForceReply → веерная рассылка.
 */
import { NextRequest } from "next/server";
import { collection, addDoc, query, where, getDocs, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { closeTableAndNotifyGuest, sosFanOut } from "@/lib/bot-router";

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

/** Определить venueId по Telegram ID сотрудника */
async function getVenueIdByStaffTgId(tgId: string): Promise<string | null> {
  const staffRef = collection(db, "staff");
  const q = query(staffRef, where("tgId", "==", tgId), where("active", "==", true));
  const snap = await getDocs(q);
  const doc = snap.docs[0];
  return doc?.exists() ? (doc.data().venueId as string) ?? null : null;
}

export async function handleTelegramStaff(request: NextRequest, token: string): Promise<void> {
  const update = await request.json();
  console.log("[webhook telegram/staff] Incoming update:", JSON.stringify(update, null, 2));

  const message = update.message;
  const chatId = message?.chat?.id;
  const fromId = message?.from?.id;
  if (!chatId) return;

  const text = (message?.text ?? "").trim();
  const replyTo = message?.reply_to_message;

  // SOS: ответ на запрос "Укажите номер стола для вызова охраны"
  if (replyTo?.text?.includes("номер стола") && /^\d+$/.test(text)) {
    const venueId = await getVenueIdByStaffTgId(String(fromId));
    if (venueId) {
      await sosFanOut(venueId, text, "telegram");
      await sendTelegram(token, "sendMessage", {
        chat_id: chatId,
        text: `🚨 SOS по столу №${text} отправлен. Охрана и менеджер уведомлены.`,
      });
    } else {
      await sendTelegram(token, "sendMessage", {
        chat_id: chatId,
        text: "Ошибка: не удалось определить заведение.",
      });
    }
    return;
  }

  // Callback: кнопка "🚨 SOS" — включаем ForceReply
  if (update.callback_query) {
    const { id: callbackId, data } = update.callback_query;
    if (data === "sos") {
      await sendTelegram(token, "answerCallbackQuery", { callback_query_id: callbackId });
      await sendTelegram(token, "sendMessage", {
        chat_id: update.callback_query.message?.chat?.id,
        text: "Укажите номер стола для вызова охраны.",
        reply_markup: { force_reply: true },
      });
    }
    return;
  }

  // Число = закрытие стола (механика: официант ввёл цифру → гостю thankYou в Client-бот)
  const tableNum = /^\d+$/.test(text) ? text : null;
  if (tableNum) {
    const venueId = await getVenueIdByStaffTgId(String(fromId));
    if (!venueId) {
      await sendTelegram(token, "sendMessage", {
        chat_id: chatId,
        text: "Ошибка: вы не привязаны к заведению. Обратитесь к администратору.",
      });
      return;
    }
    const result = await closeTableAndNotifyGuest(venueId, tableNum, "telegram");
    if (result.ok) {
      await addDoc(collection(db, "staffActions"), {
        type: "close_table",
        tableId: tableNum,
        venueId,
        staffChatId: chatId,
        createdAt: serverTimestamp(),
      });
      await sendTelegram(token, "sendMessage", {
        chat_id: chatId,
        text: `Стол №${tableNum} закрыт. Гостю отправлено благодарствие.`,
      });
    } else {
      await sendTelegram(token, "sendMessage", {
        chat_id: chatId,
        text: result.error || "Не удалось закрыть стол.",
      });
    }
    return;
  }

  // Подсказка + кнопка SOS
  await sendTelegram(token, "sendMessage", {
    chat_id: chatId,
    text: "Отправьте номер стола для закрытия сессии. Либо нажмите кнопку SOS.",
    reply_markup: {
      inline_keyboard: [[{ text: "🚨 SOS", callback_data: "sos" }]],
    },
  });
}
