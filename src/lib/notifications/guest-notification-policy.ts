/**
 * Политика каналов уведомлений гостю (без привязки к activeSessions в коде доставки).
 *
 * Операционные — только контекст живой сессии (activeSessions / staffNotifications в заведении):
 * отправлять немедленно; часовой пояс гостя не учитывать.
 *
 * Маркетинговые — вне сессии: планировать по `global_users.timezone` (IANA), чтобы не будить ночью;
 * при пустом timezone — fallback на UTC или политику продукта.
 */
export const GUEST_NOTIFICATION_OPERATIONAL = "operational_in_session" as const;
export const GUEST_NOTIFICATION_MARKETING = "marketing_out_of_session" as const;

export type GuestNotificationKind =
  | typeof GUEST_NOTIFICATION_OPERATIONAL
  | typeof GUEST_NOTIFICATION_MARKETING;
