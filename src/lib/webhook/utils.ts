/**
 * Утилиты для webhook: публичный URL приложения.
 * Telegram API требует HTTPS для setWebhook; на Vercel используем VERCEL_URL.
 */

/**
 * Возвращает публичный URL приложения (без завершающего слэша).
 * - На Vercel: https://${VERCEL_URL} (HTTPS обязателен для Telegram webhook).
 * - В разработке: http://localhost:3000.
 * - Иначе: NEXT_PUBLIC_APP_URL или TUNNEL_URL с приведением к https при необходимости.
 */
export function getAppUrl(): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}`;
  }
  const fallback =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.TUNNEL_URL ||
    "http://localhost:3000";
  const url = fallback.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production" && url.startsWith("http://")) {
    return url.replace(/^http:\/\//, "https://");
  }
  return url;
}
