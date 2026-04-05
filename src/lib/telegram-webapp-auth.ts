/**
 * Проверка подписи Telegram Mini App initData (сервер).
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

import { createHmac, timingSafeEqual } from "crypto";

export type TelegramInitDataUser = { id?: number };

export type VerifyTelegramInitDataResult =
  | { ok: true; userId: string; authDate: number }
  | { ok: false; reason: string };

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * @param maxAgeSec — отсечь устаревшие пакеты (рекомендация Telegram ~86400).
 */
export function verifyTelegramWebAppInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number
): VerifyTelegramInitDataResult {
  const raw = initData?.trim() ?? "";
  if (!raw) return { ok: false, reason: "empty_init_data" };
  const token = botToken?.trim() ?? "";
  if (!token) return { ok: false, reason: "missing_bot_token" };

  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing_hash" };

  params.delete("hash");
  const keys = [...params.keys()].sort();
  const dataCheckString = keys.map((k) => `${k}=${params.get(k) ?? ""}`).join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
  const calculated = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const hashNorm = hash.trim().toLowerCase();
  if (!safeEqualHex(calculated, hashNorm)) {
    return { ok: false, reason: "bad_hash" };
  }

  const authDateRaw = params.get("auth_date");
  const authDate = authDateRaw ? Number(authDateRaw) : NaN;
  if (!Number.isFinite(authDate)) return { ok: false, reason: "bad_auth_date" };
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > maxAgeSec) return { ok: false, reason: "init_data_expired" };

  const userJson = params.get("user");
  if (!userJson) return { ok: false, reason: "missing_user" };
  let user: TelegramInitDataUser;
  try {
    user = JSON.parse(userJson) as TelegramInitDataUser;
  } catch {
    return { ok: false, reason: "bad_user_json" };
  }
  if (user?.id == null || !Number.isFinite(Number(user.id))) {
    return { ok: false, reason: "missing_user_id" };
  }
  return { ok: true, userId: String(user.id), authDate };
}
