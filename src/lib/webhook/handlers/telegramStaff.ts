/**
 * Обработчик Telegram Staff Bot (персонал).
 * Число = закрытие стола → гостю thankYou + реклама/опрос по tier. SOS = ForceReply → веерная рассылка.
 * Сотрудники сети (venueIds): в ответе только [Дата] | [Время смены: От - До] | [Название заведения].
 */
import { NextRequest } from "next/server";
import { collection, addDoc, query, where, getDocs, doc, getDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { closeTableAndNotifyGuest, sosFanOut } from "@/lib/bot-router";

const TELEGRAM_API = "https://api.telegram.org/bot";
const todayISO = () => new Date().toISOString().slice(0, 10);

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
  const d = snap.docs[0];
  return d?.exists() ? (d.data().venueId as string) ?? null : null;
}

/** Данные сотрудника по tgId (для сети: venueIds и staffId) */
async function getStaffByTgId(tgId: string): Promise<{ staffId: string; venueId: string; venueIds?: string[] } | null> {
  const q = query(collection(db, "staff"), where("tgId", "==", tgId), where("active", "==", true));
  const snap = await getDocs(q);
  const d = snap.docs[0];
  if (!d?.exists()) return null;
  const data = d.data();
  return {
    staffId: d.id,
    venueId: (data.venueId as string) ?? "",
    venueIds: data.venueIds as string[] | undefined,
  };
}

/** Смена на сегодня для сотрудника (из scheduleEntries по slot.date и staffId) */
async function getTodayShiftVenue(staffId: string): Promise<{ venueId: string; name: string; address: string } | null> {
  const today = todayISO();
  const q = query(
    collection(db, "scheduleEntries"),
    where("staffId", "==", staffId),
    where("slot.date", "==", today)
  );
  const snap = await getDocs(q);
  const entry = snap.docs[0];
  if (!entry?.exists()) return null;
  const slot = entry.data().slot as { venueId?: string } | undefined;
  const venueId = slot?.venueId ?? entry.data().venueId;
  if (!venueId) return null;
  const venueSnap = await getDoc(doc(db, "venues", venueId));
  if (!venueSnap.exists()) return null;
  const v = venueSnap.data();
  const address = (v.address as string) ?? "";
  const name = (v.name as string) ?? venueId;
  return { venueId, name, address };
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

  // Подсказка + кнопка SOS. Для сети (venueIds) — только [Дата] | [Время смены: От - До] | [Название заведения]
  const staffData = await getStaffByTgId(String(fromId));
  let replyText = "Отправьте номер стола для закрытия сессии. Либо нажмите кнопку SOS.";
  const inlineKeyboard: { text: string; callback_data?: string }[][] = [[{ text: "🚨 SOS", callback_data: "sos" }]];

  if (staffData?.venueIds?.length) {
    const todayShift = await getTodayShiftVenue(staffData.staffId);
    if (todayShift?.name) {
      const timePart = todayShift.startTime && todayShift.endTime
        ? `${todayShift.startTime} – ${todayShift.endTime}`
        : "—";
      replyText = `${todayShift.date} | ${timePart} | ${todayShift.name}\n\nОтправьте номер стола для закрытия сессии или нажмите SOS.`;
    }
  }

  await sendTelegram(token, "sendMessage", {
    chat_id: chatId,
    text: replyText,
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
}
