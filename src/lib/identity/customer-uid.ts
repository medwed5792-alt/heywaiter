/**
 * Unified customer UID contract for guest flows:
 * 1) telegram_user_id:<id> (priority)
 * 2) anonymous_id:<id> (fallback)
 */

export function buildTelegramCustomerUid(telegramUserId: string | number | null | undefined): string {
  if (telegramUserId === null || telegramUserId === undefined) return "";
  const raw = String(telegramUserId).trim();
  if (!raw) return "";
  return `telegram_user_id:${raw}`;
}

export function buildAnonymousCustomerUid(anonymousId: string | null | undefined): string {
  const raw = String(anonymousId ?? "").trim();
  if (!raw) return "";
  return `anonymous_id:${raw}`;
}

export function resolveUnifiedCustomerUid(args: {
  telegramUserId?: string | number | null;
  anonymousId?: string | null;
}): string {
  const tg = buildTelegramCustomerUid(args.telegramUserId);
  if (tg) return tg;
  return buildAnonymousCustomerUid(args.anonymousId);
}

