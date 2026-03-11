/**
 * Geo-Fencing: Haversine, проверка выхода из зоны, Escape Alert.
 * Debug: при IS_GEO_DEBUG === true проверка дистанции считается «в зоне» (байпас для тестов).
 */
const EARTH_RADIUS_M = 6371000;

/** Временный debug: true = всегда считать «в зоне». NEXT_PUBLIC_GEO_DEBUG=false отключает. */
export const IS_GEO_DEBUG =
  typeof process === "undefined" || process.env.NEXT_PUBLIC_GEO_DEBUG !== "false";

/**
 * Расстояние между двумя точками (м) по формуле Haversine.
 */
export function haversineDistanceM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Смещение точки на метры (приближённо: 1° lat ≈ 111 км, 1° lng ≈ 111*cos(lat) км).
 * Для теста "имитация выхода из зоны" (+500 м на север).
 */
export function offsetLatLngByMeters(
  lat: number,
  lng: number,
  metersNorth: number,
  metersEast: number = 0
): { lat: number; lng: number } {
  const toDeg = (m: number, scale: number) => m / (scale * 1000);
  const latScale = 111;
  const lngScale = 111 * Math.cos((lat * Math.PI) / 180);
  return {
    lat: lat + toDeg(metersNorth, latScale),
    lng: lng + toDeg(metersEast, lngScale),
  };
}

/**
 * Проверка: пользователь вне геозоны заведения?
 * При IS_GEO_DEBUG === true всегда возвращает false (в зоне); логика Haversine и данные не меняются.
 */
export function isOutsideVenue(
  userLat: number,
  userLng: number,
  venueLat: number,
  venueLng: number,
  radiusM: number
): boolean {
  if (IS_GEO_DEBUG) return false;
  const dist = haversineDistanceM(userLat, userLng, venueLat, venueLng);
  return dist > radiusM;
}
