export const DEFAULT_VENUE_TIMEZONE = "Europe/Moscow";

/**
 * Часовой пояс заведения для расписания меню и предзаказа.
 * Поле `venues.timezone` (приоритет) или `venues.config.timezone`.
 */
export function readVenueTimezone(venueData: Record<string, unknown> | null | undefined): string {
  if (!venueData) return DEFAULT_VENUE_TIMEZONE;
  const root = typeof venueData.timezone === "string" ? venueData.timezone.trim() : "";
  if (root) return root;
  const cfg = venueData.config as Record<string, unknown> | undefined;
  const fromConfig = cfg && typeof cfg.timezone === "string" ? cfg.timezone.trim() : "";
  return fromConfig || DEFAULT_VENUE_TIMEZONE;
}
