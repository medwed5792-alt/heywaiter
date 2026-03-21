/**
 * Глобальные рекламные слоты Mini App — источник: Firestore `super_ads_catalog`.
 * Управление только из кабинета Супер-Админа; локальные админы заведений не редактируют эти слоты.
 */

export const SUPER_ADS_COLLECTION = "super_ads_catalog";

/** Идентификаторы слотов размещения (привязка в AdSpace и в документах каталога). */
export const SUPER_AD_PLACEMENTS = [
  "mini_gateway",
  "guest_welcome",
  "guest_hub_between_history_promos",
  "guest_hub_between_promos_rating",
] as const;

export type SuperAdPlacementId = (typeof SUPER_AD_PLACEMENTS)[number];

export interface SuperAdCatalogItem {
  id: string;
  title?: string;
  body?: string;
  imageUrl?: string;
  href?: string;
  /** false — скрыто из ротации */
  active?: boolean;
  /**
   * Пустой массив / отсутствует — объявление участвует во всех слотах (после фильтра по active).
   * Иначе — только в перечисленных placement.
   */
  placements?: string[];
  sortOrder?: number;
}

export function filterAdsForPlacement(
  ads: SuperAdCatalogItem[],
  placement: string
): SuperAdCatalogItem[] {
  return ads.filter((ad) => {
    const p = ad.placements;
    if (!p || p.length === 0) return true;
    return p.includes(placement);
  });
}

/**
 * Стабильный индекс для сессии браузера: при новом «входе» (новая вкладка/сессия) seed другой,
 * между слотами — разные объявления за счёт placement.
 */
export function pickRotatedAdIndex(placement: string, adCount: number): number {
  if (adCount <= 0) return 0;
  if (typeof window === "undefined") return 0;
  const SK = "heywaiter_super_ads_seed";
  let seed = sessionStorage.getItem(SK);
  if (!seed) {
    seed = String(Math.random());
    sessionStorage.setItem(SK, seed);
  }
  let h = 0;
  for (let i = 0; i < placement.length; i++) {
    h = (h * 31 + placement.charCodeAt(i)) | 0;
  }
  const mix = Math.abs(h) + Math.floor(parseFloat(seed) * 1e9);
  return mix % adCount;
}
