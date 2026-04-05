export const IS_GEO_DEBUG = false;

/** Если у заведения в Firestore нет `geo.radius`, подставляем это значение (метры). */
export const DEFAULT_VENUE_GEO_RADIUS_METERS = 100;

/**
 * Верхняя граница радиуса «приёмной зоны» по умолчанию (метры).
 * Фактическое значение: `system_settings/global.geoRadiusLimit`; при отсутствии — эта константа.
 * Эффективный радиус для проверок = min(radius заведения, этот лимит).
 */
export const DEFAULT_GLOBAL_GEO_RADIUS_LIMIT_METERS = 500;

const R_EARTH_M = 6_371_000;

/**
 * Проверка: сотрудник/гость вне радиуса заведения.
 * Возвращает `true`, если точка находится за пределами зоны.
 */
export const isOutsideVenue = (
  lat: number,
  lng: number,
  venueLat: number,
  venueLng: number,
  radius: number
): boolean => {
  // В режиме debug гео-запретов нет.
  if (IS_GEO_DEBUG) return false;
  const distance = haversineDistanceM(lat, lng, venueLat, venueLng);
  return distance > radius;
};

/**
 * Сдвигает координаты на заданное число метров по север-юг и восток-запад.
 * Используется как простая аппроксимация (достаточно для "simulate out of zone").
 */
export const offsetLatLngByMeters = (
  lat: number,
  lng: number,
  offsetNorthMeters: number,
  offsetEastMeters: number
): { lat: number; lng: number } => {
  // 1 градус широты ~ 111_320 м
  const latDelta = offsetNorthMeters / 111_320;
  // 1 градус долготы меняется с широтой
  const lngDelta = offsetEastMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + latDelta, lng: lng + lngDelta };
};

/** Расстояние между двумя точками (lat/lng) в метрах по формуле Haversine. */
export function haversineDistanceM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_EARTH_M * c;
}

export function checkGeoPosition(
  userLat: number,
  userLng: number,
  venueLat: number,
  venueLng: number,
  radius: number
) {
  if (IS_GEO_DEBUG) {
    return { inZone: true, distance: 0 };
  }
  const distance = haversineDistanceM(userLat, userLng, venueLat, venueLng);
  return { inZone: distance <= radius, distance };
}
