import { createHmac, timingSafeEqual } from "crypto";

export const TELEGRAM_WEBAPP_INIT_MAX_AGE_SEC = 24 * 60 * 60;

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/** Проверка подписи Telegram WebApp initData (сервер). */
export function verifyTelegramWebAppInitData(
  initData: string,
  botToken: string
): { ok: true; userId: string } | { ok: false; reason: string } {
  const raw = initData.trim();
  if (!raw) return { ok: false, reason: "empty_init_data" };
  const token = botToken.trim();
  if (!token) return { ok: false, reason: "missing_bot_token" };

  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing_hash" };
  params.delete("hash");
  const dataCheckString = [...params.keys()]
    .sort()
    .map((k) => `${k}=${params.get(k) ?? ""}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
  const calculated = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (!safeEqualHex(calculated, hash.trim().toLowerCase())) return { ok: false, reason: "bad_hash" };

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) return { ok: false, reason: "bad_auth_date" };
  if (Math.floor(Date.now() / 1000) - authDate > TELEGRAM_WEBAPP_INIT_MAX_AGE_SEC) {
    return { ok: false, reason: "init_data_expired" };
  }

  let user: { id?: number };
  try {
    user = JSON.parse(params.get("user") ?? "null") as { id?: number };
  } catch {
    return { ok: false, reason: "bad_user_json" };
  }
  if (user?.id == null || !Number.isFinite(Number(user.id))) return { ok: false, reason: "missing_user_id" };
  return { ok: true, userId: String(user.id) };
}
