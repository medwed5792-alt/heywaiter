/**
 * Единое чтение Telegram user id из Mini App (initDataUnsafe и подписанный initData).
 * Дублирующая логика StaffProvider / dispatcher сведена сюда, чтобы гость и персонал
 * не расходились при поздней подгрузке WebApp.
 */

export type TelegramWebAppLike = {
  initData?: string;
  initDataUnsafe?: { user?: { id?: number | string } };
};

export function parseTelegramUserIdFromInitData(initData: string): string | null {
  const raw = initData.trim();
  if (!raw) return null;
  try {
    const params = new URLSearchParams(raw);
    const userJson = params.get("user");
    if (!userJson) return null;
    const u = JSON.parse(userJson) as { id?: number | string };
    if (u?.id != null) return String(u.id);
  } catch {
    // ignore
  }
  return null;
}

export function getTelegramUserIdFromWebApp(webApp: TelegramWebAppLike | undefined): string | null {
  if (!webApp) return null;
  const unsafeId = webApp.initDataUnsafe?.user?.id;
  if (unsafeId != null) return String(unsafeId);
  const initData = typeof webApp.initData === "string" ? webApp.initData.trim() : "";
  return parseTelegramUserIdFromInitData(initData);
}
