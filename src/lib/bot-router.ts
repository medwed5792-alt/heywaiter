/**
 * Золотой стандарт HeyWaiter: роутер логики ботов.
 * Связка: Официант ввёл число → Гость получает messages.thankYou в Client-бот → по tier: реклама или опрос.
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
    await sendTelegram(token as string, "sendMessage", {
      chat_id: chatId,
      text,
    });
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
 * Закрытие стола по цифре от официанта.
 * 1) Найти activeSession по venueId + tableId.
 * 2) Взять venue.messages.thankYou (или дефолт).
 * 3) Отправить thankYou гостю в его канал (guestChannel, guestChatId).
 * 4) По guest.tier: free → рекламный блок, pro → опрос (Кухня, Сервис, Чистота, Атмосфера).
 * 5) Пометить сессию закрытой / удалить из активных; записать в лог.
 */
export async function closeTableAndNotifyGuest(
  venueId: string,
  tableId: string,
  staffChannel: MessengerChannel = "telegram"
): Promise<{ ok: boolean; error?: string }> {
  try {
    const sessionsRef = collection(db, "activeSessions");
    const q = query(
      sessionsRef,
      where("venueId", "==", venueId),
      where("tableId", "==", tableId),
      where("status", "==", "check_in_success")
    );
    const snap = await getDocs(q);
    const sessionDoc = snap.docs[0];
    if (!sessionDoc?.exists()) {
      return { ok: false, error: "Сессия не найдена" };
    }
    const session = { id: sessionDoc.id, ...sessionDoc.data() } as {
      id: string;
      guestChannel?: string;
      guestChatId?: string;
      guestId?: string;
    };
    const guestChannel = (session.guestChannel || "telegram") as MessengerChannel;
    const guestChatId = session.guestChatId;
    const guestId = session.guestId;

    if (!guestChatId) {
      return { ok: false, error: "Нет guestChatId в сессии" };
    }

    const venueSnap = await getDoc(doc(db, "venues", venueId));
    const venue = venueSnap.exists() ? venueSnap.data() : {};
    const messages = (venue?.messages || {}) as { thankYou?: string };
    const thankYouText =
      messages.thankYou ||
      "🙏 Спасибо за визит! Будем рады видеть вас снова.";

    await sendToGuestInChannel(
      guestChannel,
      guestChatId,
      thankYouText,
      venueId
    );

    let guestTier: "free" | "pro" | undefined = "free";
    if (guestId) {
      const guestSnap = await getDoc(doc(db, "guests", guestId));
      if (guestSnap.exists()) {
        guestTier = (guestSnap.data()?.tier as "free" | "pro") || "free";
      }
    }

    if (guestTier === "free") {
      const adText =
        "📢 Спецпредложения и новости заведения — подпишитесь на наш канал!";
      await sendToGuestInChannel(
        guestChannel,
        guestChatId,
        adText,
        venueId
      );
    } else {
      const surveyText =
        "Оцените, пожалуйста (1–5):\n• Кухня\n• Сервис\n• Чистота\n• Атмосфера\nНапишите 4 цифры через пробел, например: 5 5 4 5";
      await sendToGuestInChannel(
        guestChannel,
        guestChatId,
        surveyText,
        venueId
      );
    }

    await updateDoc(doc(db, "activeSessions", sessionDoc.id), {
      status: "closed",
      closedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await addDoc(collection(db, "logEntries"), {
      venueId,
      tableId,
      type: "check_out",
      payload: { sessionId: session.id, guestId, guestTier },
      createdAt: serverTimestamp(),
    });

    return { ok: true };
  } catch (e) {
    console.error("[bot-router] closeTableAndNotifyGuest error:", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
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
        await sendTelegram(staffToken as string, "sendMessage", {
          chat_id: tgId,
          text: message,
        });
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
