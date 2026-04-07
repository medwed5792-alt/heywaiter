/**
 * Золотой стандарт HeyWaiter: роутер логики ботов (уведомления гостю/персоналу).
 * Завершение визита и смена статуса сессии — только через дашборд / единый use-case, не через бота.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  updateDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getBotToken } from "@/lib/webhook/channels";
import type { MessengerChannel } from "@/lib/types";
import { sendMessage } from "@/adapters/telegram/telegramApi";

/** Отправка сообщения гостю в Client-бот по каналу (сейчас реализован только Telegram) */
async function sendToGuestInChannel(
  channel: MessengerChannel,
  chatId: string,
  text: string,
  venueId: string
): Promise<void> {
  const token =
    channel === "telegram"
      ? getBotToken("telegram", "client") || process.env.TELEGRAM_BOT_TOKEN
      : channel === "vk"
        ? getBotToken("vk", "client")
        : null;
  if (!token && channel === "telegram") {
    console.warn("[bot-router] No Telegram client token");
    return;
  }
  if (channel === "telegram") {
    await sendMessage(token as string, { chat_id: chatId, text });
    return;
  }
  if (channel === "vk") {
    // VK: messages.send (требует access_token и peer_id)
    console.log("[bot-router] VK send to guest not implemented, venueId:", venueId);
    return;
  }
  console.log("[bot-router] Channel not implemented:", channel);
}

/**
 * Fast Food: зеркальное уведомление гостю в тот канал, через который он авторизовался.
 * bot-router берёт guestPlatform и guestChatId из документа заказа и вызывает getBotToken(guestPlatform, "client") —
 * так выбирается токен именно того Client-бота (TG, VK, WA и т.д.), через который гость открыл заказ.
 */
export async function notifyOrderReady(orderId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const orderSnap = await getDoc(doc(db, "orders", orderId));
    if (!orderSnap.exists()) {
      return { ok: false, error: "Заказ не найден" };
    }
    const order = orderSnap.data() as {
      orderNumber: number;
      venueId: string;
      guestChatId?: string;
      guestPlatform?: string;
      status: string;
    };
    if (order.status !== "pending") {
      return { ok: false, error: "Заказ уже обработан" };
    }
    const guestChatId = order.guestChatId;
    const guestPlatform = (order.guestPlatform || "telegram") as MessengerChannel;
    if (!guestChatId) {
      return { ok: false, error: "Нет guestChatId в заказе" };
    }
    const text = `🍔 Заказ №${order.orderNumber} готов! Заберите на выдаче!`;
    await sendToGuestInChannel(
      guestPlatform,
      guestChatId,
      text,
      order.venueId
    );
    await updateDoc(doc(db, "orders", orderId), {
      status: "ready",
      updatedAt: serverTimestamp(),
    });
    return { ok: true };
  } catch (e) {
    console.error("[bot-router] notifyOrderReady error:", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

/**
 * SOS: веерная рассылка (Owner, Manager, Security, Staff) во все рабочие каналы.
 * tableId — номер стола, переданный официантом после нажатия "🚨 SOS".
 */
export async function sosFanOut(
  venueId: string,
  tableId: string,
  staffChannel: MessengerChannel = "telegram"
): Promise<{ ok: boolean }> {
  const staffRef = collection(db, "staff");
  const q = query(
    staffRef,
    where("venueId", "==", venueId),
    where("active", "==", true)
  );
  const snap = await getDocs(q);
  const message = `🚨 SOS: Стол №${tableId}. Требуется внимание охраны/менеджера.`;

  const staffToken = getBotToken("telegram", "staff") || process.env.TELEGRAM_STAFF_TOKEN;
  if (!staffToken) {
    console.warn("[bot-router] No staff token for SOS");
    return { ok: false };
  }

  for (const d of snap.docs) {
    const s = d.data();
    const tgId = s.tgId || s.identity?.externalId;
    if (tgId) {
      try {
        await sendMessage(staffToken as string, { chat_id: tgId, text: message });
      } catch (err) {
        console.error("[bot-router] SOS send to staff error:", err);
      }
    }
  }

  await addDoc(collection(db, "staffNotifications"), {
    venueId,
    type: "sos",
    tableId,
    message,
    read: false,
    createdAt: serverTimestamp(),
  });

  return { ok: true };
}
