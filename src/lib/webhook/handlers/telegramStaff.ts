/**
 * Обработчик Telegram Staff Bot (персонал).
 * Число = закрытие стола → гостю thankYou + реклама/опрос по tier. SOS = ForceReply → веерная рассылка.
 * Callback offer_accept_<staffId> / offer_decline_<staffId> = цифровой контракт (принять/отклонить предложение).
 */
import { NextRequest } from "next/server";
import { collection, addDoc, query, where, getDocs, doc, getDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { closeTableAndNotifyGuest, sosFanOut } from "@/lib/bot-router";
import { getAppUrl } from "@/lib/webhook/utils";
import { answerCallbackQuery, sendMessage } from "@/adapters/telegram/telegramApi";
const todayISO = () => new Date().toISOString().slice(0, 10);

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
      await sendMessage(token, {
        chat_id: chatId,
        text: `🚨 SOS по столу №${text} отправлен. Охрана и менеджер уведомлены.`,
      });
    } else {
      await sendMessage(token, { chat_id: chatId, text: "Ошибка: не удалось определить заведение." });
    }
    return;
  }

  // Callback: кнопка "🚨 SOS" или "OK" по уведомлению "гость оценен"
  if (update.callback_query) {
    const { id: callbackId, data } = update.callback_query;
    if (data === "sos") {
      await answerCallbackQuery(token, { callback_query_id: callbackId });
      await sendMessage(token, {
        chat_id: update.callback_query.message?.chat?.id,
        text: "Укажите номер стола для вызова охраны.",
        reply_markup: { force_reply: true },
      });
      return;
    }
    if (typeof data === "string" && data.startsWith("gr_")) {
      const notificationId = data.slice(3);
      if (notificationId) {
        try {
          await deleteDoc(doc(db, "staffNotifications", notificationId));
        } catch (_) {}
      }
      await answerCallbackQuery(token, { callback_query_id: callbackId, text: "OK" });
      return;
    }
    // Цифровой контракт: Принять — СРАЗУ answerCallbackQuery (кнопка не висит), затем единая логика acceptOffer().
    if (typeof data === "string" && data.startsWith("offer_accept_")) {
      const staffDocId = data.slice("offer_accept_".length);
      const chatId = update.callback_query.message?.chat?.id;
      console.log("ACCEPT OFFER: staffId:", staffDocId, "chatId:", chatId);
      try {
        await answerCallbackQuery(token, { callback_query_id: callbackId, text: "Ожидайте…" });
      } catch (e) {
        console.error("[telegramStaff] answerCallbackQuery failed:", e);
      }
      const { acceptOffer: doAcceptOffer } = await import("@/lib/accept-offer");
      const result = await doAcceptOffer(staffDocId);
      const successText = "✅ Поздравляем! Вы приняты в штат. Теперь вам доступен рабочий пульт в Mini App.";
      const errorText = "⚠️ Ошибка при зачислении в штат. Попробуйте еще раз или обратитесь к админу.";
      if (chatId) {
        try {
          await sendMessage(token, {
            chat_id: chatId,
            text: result.ok ? successText : errorText,
          });
        } catch (e) {
          console.error("[telegramStaff] sendMessage after accept failed:", e);
        }
      }
      if (!result.ok) {
        console.error("[telegramStaff] acceptOffer failed:", result.error);
      }
      return;
    }
    if (typeof data === "string" && data.startsWith("offer_decline_")) {
      const staffDocId = data.slice("offer_decline_".length);
      const chatId = update.callback_query.message?.chat?.id;
      console.log("DECLINE OFFER: staffId:", staffDocId, "chatId:", chatId);
      let answered = false;
      const answerOnce = async (text: string) => {
        if (answered) return;
        answered = true;
        try {
          await answerCallbackQuery(token, { callback_query_id: callbackId, text });
        } catch (e) {
          console.error("[telegramStaff] answerCallbackQuery decline failed:", e);
        }
      };
      try {
        if (!staffDocId || !chatId) {
          await answerOnce("Ошибка данных");
          return;
        }
        const adminDb = getAdminFirestore();
        const staffRef = adminDb.collection("staff").doc(staffDocId);
        const staffSnap = await staffRef.get();
        if (staffSnap.exists) {
          await staffRef.update({
            status: "declined",
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        await answerOnce("Предложение отклонено");
        await sendMessage(token, {
          chat_id: chatId,
          text: "Вы отклонили предложение. Если передумаете — обратитесь к администратору заведения.",
        });
      } catch (err) {
        console.error("[telegramStaff] offer_decline Firestore/Telegram error:", err);
        await answerOnce("Ошибка");
      } finally {
        if (!answered) {
          try {
            await answerCallbackQuery(token, { callback_query_id: callbackId, text: "Ошибка" });
          } catch (e) {
            console.error("[telegramStaff] answerCallbackQuery decline finally failed:", e);
          }
        }
      }
      return;
    }
    return;
  }

  // Число = закрытие стола (механика: официант ввёл цифру → гостю thankYou в Client-бот)
  const tableNum = /^\d+$/.test(text) ? text : null;
  if (tableNum) {
    const venueId = await getVenueIdByStaffTgId(String(fromId));
    if (!venueId) {
      await sendMessage(token, {
        chat_id: chatId,
        text: "Ошибка: вы не привязаны к заведению. Обратитесь к администратору.",
      });
      return;
    }
    const result = await closeTableAndNotifyGuest(venueId, tableNum, "telegram");
    if (result.ok) {
      const staffData = await getStaffByTgId(String(fromId));
      if (result.sessionId && staffData?.staffId) {
        await updateDoc(doc(db, "activeSessions", result.sessionId), {
          waiterId: staffData.staffId,
          updatedAt: serverTimestamp(),
        });
      }
      await addDoc(collection(db, "staffActions"), {
        type: "close_table",
        tableId: tableNum,
        venueId,
        staffChatId: chatId,
        createdAt: serverTimestamp(),
      });
      await sendMessage(token, {
        chat_id: chatId,
        text: `Стол №${tableNum} закрыт. Гостю отправлено благодарствие.`,
      });
    } else {
      await sendMessage(token, {
        chat_id: chatId,
        text: result.error || "Не удалось закрыть стол.",
      });
    }
    return;
  }

  // Подсказка + кнопка SOS + вход в Staff Workspace (role=staff и bot=staff → кабинет, без t → «Начать смену»)
  const staffData = await getStaffByTgId(String(fromId));
  let replyText = "Отправьте номер стола для закрытия сессии. Либо нажмите кнопку SOS.";
  const baseUrl = getAppUrl();
  const staffAppUrl = `${baseUrl}/mini-app?bot=staff&role=staff&v=1.1`;
  const inlineKeyboard: { text: string; callback_data?: string; web_app?: { url: string } }[][] = [
    [{ text: "🚨 SOS", callback_data: "sos" }, { text: "📱 Открыть пульт", web_app: { url: staffAppUrl } }],
  ];

  if (staffData?.venueIds?.length) {
    const todayShift = await getTodayShiftVenue(staffData.staffId);
    if (todayShift?.name) {
      replyText = `${todayISO()} | — | ${todayShift.name}\n\nОтправьте номер стола для закрытия сессии или нажмите SOS.`;
    }
  }

  await sendMessage(token, {
    chat_id: chatId,
    text: replyText,
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
}
