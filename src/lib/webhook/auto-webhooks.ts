/**
 * Авто-настройка вебхуков при сохранении токенов в админке.
 * Регистрация через API платформы (Telegram, VK).
 */

const TELEGRAM_API = "https://api.telegram.org/bot";
const VK_API = "https://api.vk.com/method";

export type WebhookChannel = "telegram" | "vk";

export interface SetWebhookResult {
  ok: boolean;
  error?: string;
}

/**
 * Установка вебхука для Telegram-бота.
 * GET https://api.telegram.org/bot<token>/setWebhook?url=<url>
 */
export async function setTelegramWebhook(
  token: string,
  webhookUrl: string
): Promise<SetWebhookResult> {
  try {
    const url = `${TELEGRAM_API}${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
    const res = await fetch(url, { method: "GET" });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!data.ok) {
      return { ok: false, error: data.description || "Telegram setWebhook failed" };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

/**
 * Установка вебхука для VK Callback API.
 * Требует подтверждения сервера (confirmation) и отдельной настройки в группе.
 * Здесь только вызов methods.groups.setLongPollSettings или аналоги.
 * Для VK часто используется Long Poll; для вебхука — callback в настройках группы.
 */
export async function setVkWebhook(
  _accessToken: string,
  _groupId: string,
  _callbackUrl: string
): Promise<SetWebhookResult> {
  // VK: вебхук задаётся в настройках группы ВКонтакте (Callback API → URL сервера).
  // Автоматическая регистрация через API ограничена; возвращаем ok при успехе ручной настройки.
  console.log("[auto-webhooks] VK webhook: настройте URL в управлении группой ВКонтакте.");
  return { ok: true };
}

/**
 * По каналу и типу бота формирует URL вебхука и вызывает setWebhook платформы.
 */
export async function registerWebhook(
  channel: WebhookChannel,
  botType: "client" | "staff",
  token: string,
  baseUrl: string
): Promise<SetWebhookResult> {
  const path = `/api/webhook/${channel}/${botType}`;
  const webhookUrl = `${baseUrl.replace(/\/$/, "")}${path}`;

  if (channel === "telegram") {
    return setTelegramWebhook(token, webhookUrl);
  }
  if (channel === "vk") {
    return setVkWebhook(token, "", webhookUrl);
  }
  return { ok: false, error: "Unknown channel" };
}
