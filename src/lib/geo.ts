export const IS_GEO_DEBUG = false;

const R_EARTH_M = 6_371_000;

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
