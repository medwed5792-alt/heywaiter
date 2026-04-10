/**
 * Обработчик Telegram Staff Bot (персонал).
 * Число = напоминание: завершение визита только в дашборде (бот не меняет сессию). SOS = ForceReply → веерная рассылка.
 * Callback offer_accept_<staffId> / offer_decline_<staffId> = цифровой контракт (принять/отклонить предложение).
 */
import { NextRequest } from "next/server";
import { collection, addDoc, query, where, getDocs, doc, getDoc, deleteDoc, serverTimestamp, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { sosFanOut } from "@/lib/bot-router";
import { getAppUrl } from "@/lib/webhook/utils";
import { answerCallbackQuery, sendMessage } from "@/adapters/telegram/telegramApi";
const todayISO = () => new Date().toISOString().slice(0, 10);

/** Определить venueId по Telegram ID сотрудника (global_users.identities.tg). */
async function getVenueIdByStaffTgId(tgId: string): Promise<string | null> {
  const row = await getStaffByTgId(tgId);
  return row?.venueId ?? null;
}

/** Данные сотрудника по tgId (для сети: venueIds и staffId) — только global_users. */
async function getStaffByTgId(tgId: string): Promise<{ staffId: string; venueId: string; venueIds?: string[] } | null> {
  const q = query(collection(db, "global_users"), where("identities.tg", "==", tgId), limit(1));
  const snap = await getDocs(q);
  const d = snap.docs[0];
  if (!d?.exists()) return null;
  const data = d.data();
  const uid = d.id;
  const fromDenorm: string[] = Array.isArray(data.staffVenueActive) ? data.staffVenueActive : [];
  const aff = Array.isArray(data.affiliations) ? data.affiliations : [];
  const fromAff = aff
    .filter((a: { status?: string; venueId?: string }) => a?.status !== "former" && a?.venueId)
    .map((a: { venueId: string }) => String(a.venueId));
  const merged = [...new Set([...fromDenorm, ...fromAff].map((x) => String(x).trim()).filter(Boolean))];
  if (merged.length === 0) return null;
  const venueId = merged[0]!;
  const staffId = `${venueId}_${uid}`;
  return {
    staffId,
    venueId,
    venueIds: merged.length > 1 ? merged : undefined,
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
        const { parseCanonicalStaffDocId } = await import("@/lib/identity/global-user-staff-bridge");
        const parsed = parseCanonicalStaffDocId(staffDocId);
        if (parsed) {
          const vref = adminDb.collection("venues").doc(parsed.venueId).collection("staff").doc(staffDocId);
          const vs = await vref.get();
          if (vs.exists) {
            await vref.update({
              status: "declined",
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
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

  // Число: подсказка — завершение визита только в дашборде (сессия не меняется из бота).
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
    await addDoc(collection(db, "staffActions"), {
      type: "table_number_hint",
      tableId: tableNum,
      venueId,
      staffChatId: chatId,
      createdAt: serverTimestamp(),
    });
    await sendMessage(token, {
      chat_id: chatId,
      text:
        `Стол №${tableNum}: завершение визита и экран отзыва для гостя выполняются в дашборде HeyWaiter ` +
        `(откройте стол в списке → «Завершить визит»). Бот не закрывает сессию.`,
    });
    return;
  }

  // Подсказка + кнопка SOS + вход в Staff Workspace (role=staff и bot=staff → кабинет, без t → «Начать смену»)
  const staffData = await getStaffByTgId(String(fromId));
  let replyText =
    "Завершение визита — в дашборде HeyWaiter. Здесь можно нажать SOS или открыть пульт.";
  const baseUrl = getAppUrl();
  const staffAppUrl = `${baseUrl}/mini-app?bot=staff&role=staff&v=1.1`;
  const inlineKeyboard: { text: string; callback_data?: string; web_app?: { url: string } }[][] = [
    [{ text: "🚨 SOS", callback_data: "sos" }, { text: "📱 Открыть пульт", web_app: { url: staffAppUrl } }],
  ];

  if (staffData?.venueIds?.length) {
    const todayShift = await getTodayShiftVenue(staffData.staffId);
    if (todayShift?.name) {
      replyText = `${todayISO()} | — | ${todayShift.name}\n\nЗавершение визита — в дашборде; здесь SOS или пульт.`;
    }
  }

  await sendMessage(token, {
    chat_id: chatId,
    text: replyText,
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
}
