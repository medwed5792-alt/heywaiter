export const IS_GEO_DEBUG = true;

export function checkGeoPosition(
  userLat: number,
  userLng: number,
  venueLat: number,
  venueLng: number,
  radius: number
) {
  // В режиме Debug всегда возвращаем успех
  if (IS_GEO_DEBUG) {
    return { inZone: true, distance: 0 };
  }

  // Заглушка для будущей логики Haversine
  return { inZone: true, distance: 0 };
}
