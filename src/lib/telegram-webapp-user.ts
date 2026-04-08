/**
 * Единое чтение Telegram user id из Mini App (initDataUnsafe и подписанный initData).
 * Дублирующая логика StaffProvider / dispatcher сведена сюда, чтобы гость и персонал
 * не расходились при поздней подгрузке WebApp.
 */

export type TelegramWebAppLike = {
  initData?: string;
  initDataUnsafe?: { user?: { id?: number | string } };
};

/**
 * Настоящий Telegram Mini App: есть непустой подписанный initData.
 * Шлюзы и /check-in без v/t должны уводить сюда, чтобы сработал start_param в провайдере.
 */
export function hasTelegramWebAppInitData(): boolean {
  if (typeof window === "undefined") return false;
  const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp;
  const initData = typeof tg?.initData === "string" ? tg.initData.trim() : "";
  return initData.length > 0;
}

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
