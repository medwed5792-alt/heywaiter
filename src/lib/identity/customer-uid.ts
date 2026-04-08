/**
 * Unified customer UID (cartId / users/.../visits / CRM): один контракт для всех каналов.
 * Канонический формат: tg: | wa: | vk: | anon: (короткие префиксы, без привязки к конкретному мессенджеру в коде потребителя).
 * Legacy: telegram_user_id: и anonymous_id: — поддерживаются в Firestore rules и при миграции визитов.
 */

export type CustomerChannelPrefix = "tg" | "wa" | "vk" | "anon" | "gg";

/** Telegram user id → tg:<id> */
export function buildTgCustomerUid(telegramUserId: string | number | null | undefined): string {
  if (telegramUserId === null || telegramUserId === undefined) return "";
  const raw = String(telegramUserId).trim();
  if (!raw) return "";
  return `tg:${raw}`;
}

/** WhatsApp external id (телефон / wa id) → wa:<id> */
export function buildWaCustomerUid(whatsappExternalId: string | null | undefined): string {
  const raw = String(whatsappExternalId ?? "").trim();
  if (!raw) return "";
  return `wa:${raw}`;
}

/** VK external id → vk:<id> */
export function buildVkCustomerUid(vkExternalId: string | null | undefined): string {
  const raw = String(vkExternalId ?? "").trim();
  if (!raw) return "";
  return `vk:${raw}`;
}

/** Браузер / анонимный visitor id → anon:<uuid> */
export function buildAnonCustomerUid(anonymousId: string | null | undefined): string {
  const raw = String(anonymousId ?? "").trim();
  if (!raw) return "";
  return `anon:${raw}`;
}

/**
 * @deprecated Используйте buildTgCustomerUid; сохранено для совместимости импортов (возвращает tg:).
 */
export function buildTelegramCustomerUid(telegramUserId: string | number | null | undefined): string {
  return buildTgCustomerUid(telegramUserId);
}

/**
 * @deprecated Используйте buildAnonCustomerUid; сохранено для совместимости (возвращает anon:).
 */
export function buildAnonymousCustomerUid(anonymousId: string | null | undefined): string {
  return buildAnonCustomerUid(anonymousId);
}

/**
 * Приоритет: Telegram → WhatsApp → VK → браузер (anon).
 * Источники трафика подключаются по мере готовности Mini App / вебхуков — сигнатура уже агностична.
 */
export function resolveUnifiedCustomerUid(args: {
  telegramUserId?: string | number | null;
  whatsappId?: string | null;
  vkId?: string | null;
  anonymousId?: string | null;
}): string {
  const tg = buildTgCustomerUid(args.telegramUserId);
  if (tg) return tg;
  const wa = buildWaCustomerUid(args.whatsappId ?? null);
  if (wa) return wa;
  const vk = buildVkCustomerUid(args.vkId ?? null);
  if (vk) return vk;
  return buildAnonCustomerUid(args.anonymousId);
}

/**
 * Один и тот же гость в разных формах записи (tg: ↔ telegram_user_id:, anon: ↔ anonymous_id:).
 */
export function guestCustomerUidsMatch(a: string, b: string): boolean {
  const ta = String(a ?? "").trim();
  const tb = String(b ?? "").trim();
  if (!ta || !tb) return false;
  if (ta === tb) return true;
  const setB = new Set(visitHistoryUidCandidates(tb));
  for (const c of visitHistoryUidCandidates(ta)) {
    if (setB.has(c)) return true;
  }
  return false;
}

/** Кандидаты путей users/{uid}/visits при смене формата UID (tg: ↔ telegram_user_id:). */
export function visitHistoryUidCandidates(primaryUid: string): string[] {
  const u = primaryUid.trim();
  if (!u) return [];
  const set = new Set<string>([u]);
  if (u.startsWith("tg:")) {
    const id = u.slice(3).trim();
    if (id) set.add(`telegram_user_id:${id}`);
  }
  if (u.startsWith("anon:")) {
    const id = u.slice(5).trim();
    if (id) set.add(`anonymous_id:${id}`);
  }
  if (u.startsWith("telegram_user_id:")) {
    const id = u.slice("telegram_user_id:".length).trim();
    if (id) set.add(`tg:${id}`);
  }
  if (u.startsWith("anonymous_id:")) {
    const id = u.slice("anonymous_id:".length).trim();
    if (id) set.add(`anon:${id}`);
  }
  if (u.startsWith("gg:")) {
    const id = u.slice(3).trim();
    if (id) set.add(`gg:${id}`);
  }
  return [...set];
}

/** Извлечь платформенный id для legacy-полей (например guestChatId в orders). */
export function extractMessengerExternalIdFromCustomerUid(customerUid: string | null | undefined): string {
  const u = String(customerUid ?? "").trim();
  if (!u) return "";
  if (u.startsWith("tg:")) return u.slice(3).trim();
  if (u.startsWith("telegram_user_id:")) return u.slice("telegram_user_id:".length).trim();
  if (u.startsWith("wa:")) return u.slice(3).trim();
  if (u.startsWith("vk:")) return u.slice(3).trim();
  return "";
}
