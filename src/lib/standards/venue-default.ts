/**
 * Единая точка дефолтного venueId для сборок с одной «опорной» площадкой.
 * Переопределение: NEXT_PUBLIC_DEFAULT_VENUE_ID в .env (тот же id, что в Firestore venues/*).
 */
export const DEFAULT_VENUE_ID =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_DEFAULT_VENUE_ID?.trim()) ||
  "venue_andrey_alt";

/** Явный id или дефолт (пустые строки отбрасываются). */
export function resolveVenueId(override?: string | null): string {
  const v = override?.trim();
  return v || DEFAULT_VENUE_ID;
}
