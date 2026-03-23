/**
 * Telegram API adapter (server-side).
 * Consolidates Telegram "sendMessage/answerCallbackQuery/setChatMenuButton"
 * so webhook handlers and background scripts share the same error handling.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org/bot";

type TelegramOkResponse<T = unknown> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

async function telegramRequest<T = unknown>(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<TelegramOkResponse<T>> {
  const res = await fetch(`${TELEGRAM_API_BASE}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as TelegramOkResponse<T>;
  if (!res.ok || !data.ok) {
    throw new Error(
      data.description
        ? `Telegram API error: ${data.description}`
        : `Telegram API error: ${res.status}`
    );
  }
  return data;
}

export async function sendMessage(
  token: string,
  params: {
    chat_id: number | string;
    text: string;
    reply_markup?: Record<string, unknown>;
  }
): Promise<unknown> {
  await telegramRequest(token, "sendMessage", {
    chat_id: params.chat_id,
    text: params.text,
    ...(params.reply_markup ? { reply_markup: params.reply_markup } : {}),
  });
  return { ok: true };
}

export async function answerCallbackQuery(
  token: string,
  params: { callback_query_id: string; text?: string }
): Promise<unknown> {
  await telegramRequest(token, "answerCallbackQuery", {
    callback_query_id: params.callback_query_id,
    ...(params.text ? { text: params.text } : {}),
  });
  return { ok: true };
}

export async function setChatMenuButton(
  token: string,
  params: { chat_id: number; webAppUrl: string; buttonText?: string }
): Promise<unknown> {
  const buttonText = params.buttonText ?? "Пульт";
  await telegramRequest(token, "setChatMenuButton", {
    chat_id: params.chat_id,
    menu_button: {
      type: "web_app",
      text: buttonText,
      web_app: { url: params.webAppUrl },
    },
  });
  return { ok: true };
}

