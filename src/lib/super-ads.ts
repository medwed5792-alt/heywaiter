/**
 * Глобальные рекламные слоты Mini App — источник: Firestore `super_ads_catalog`.
 *
 * Структура документа (таргетинг + доставка):
 * - regions: string[] — города/субнациональные регионы (пусто = без фильтра по городу)
 * - countries: string[] — страны целиком (пусто = без фильтра по стране)
 * - venueLevels: number[] — уровни 1–5★ (пусто = любой)
 * - category: string — тип заведения: кафе, бар, ресторан (пусто = любой)
 * - schedule: { daysOfWeek?, startTime?, endTime?, timezone? } — окно показа
 * - isGlobalReserve: boolean — «железный» глобальный резерв, если таргет не дал кандидатов
 * - impressions, clicks — статистика (публичный track)
 */

import type { SuperAdSchedule } from "@/lib/ad-schedule";
import { matchesAdSchedule } from "@/lib/ad-schedule";

export type { SuperAdSchedule };

export const SUPER_ADS_COLLECTION = "super_ads_catalog";

/** Идентификаторы слотов размещения (привязка в AdSpace и в документах каталога). */
export const SUPER_AD_PLACEMENTS = [
  "main_ad",
  "main_gate",
  "mini_gateway",
  "guest_welcome",
  "guest_hub_between_history_promos",
  "guest_hub_between_promos_rating",
  "repeat_after_scan",
  "repeat_after_places",
  "repeat_after_promos",
  "repeat_after_rating",
] as const;

export type SuperAdPlacementId = (typeof SUPER_AD_PLACEMENTS)[number];

export const SUPER_AD_CATEGORY_PRESETS = [
  { value: "", label: "Любой тип" },
  { value: "кафе", label: "Кафе" },
  { value: "бар", label: "Бар" },
  { value: "ресторан", label: "Ресторан" },
] as const;

export interface SuperAdCatalogItem {
  id: string;
  /** SOTA-ID записи (A + подтип + 6 Base36). */
  sotaId?: string;
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
  /** Города / субрегионы; пусто = без ограничения по городу */
  regions?: string[];
  /** Страны (целиком); пусто = без ограничения по стране */
  countries?: string[];
  /** Уровни заведений 1–5; пусто = любой уровень */
  venueLevels?: number[];
  /** Тип заведения: кафе, бар, ресторан; пусто = любой */
  category?: string;
  /** Окна показа по дням/времени */
  schedule?: SuperAdSchedule;
  /**
   * Глобальный резерв сети: участвует только если нет подходящей не-резервной рекламы
   * (таргет + расписание + placement).
   */
  isGlobalReserve?: boolean;
  impressions?: number;
  clicks?: number;
}

/** Контекст для подбора рекламы (сервер собирает из venue + query). */
export interface AdDeliveryContext {
  /** Город/регион заведения (venues.adRegion) */
  region: string;
  /** Страна заведения (venues.adCountry), если задана */
  country?: string;
  venueLevel?: number;
  category?: string;
}

export function normalizeRegionKey(s: string | undefined | null): string {
  return (s ?? "").trim().toLowerCase();
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

function matchesTargeting(ad: SuperAdCatalogItem, ctx: AdDeliveryContext): boolean {
  const regions = ad.regions;
  if (regions && regions.length > 0) {
    const r = normalizeRegionKey(ctx.region);
    if (!r) return false;
    const ok = regions.some((x) => normalizeRegionKey(x) === r);
    if (!ok) return false;
  }

  const levels = ad.venueLevels;
  if (levels && levels.length > 0) {
    if (ctx.venueLevel == null || !levels.includes(ctx.venueLevel)) return false;
  }

  const cat = (ad.category ?? "").trim();
  if (cat) {
    if (normalizeRegionKey(ctx.category) !== normalizeRegionKey(cat)) return false;
  }

  return true;
}

export type SelectAdsForDeliveryResult = {
  ads: SuperAdCatalogItem[];
  /** true, если сработал пул isGlobalReserve (таргет не дал кандидатов) */
  usedGlobalReserve: boolean;
};

/**
 * Железный свай: сначала пул !isGlobalReserve с таргетингом и расписанием,
 * если пуст — пул isGlobalReserve с тем же placement и расписанием.
 */
export function selectAdsForDelivery(
  ads: SuperAdCatalogItem[],
  placement: string,
  ctx: AdDeliveryContext
): SelectAdsForDeliveryResult {
  const byPlace = filterAdsForPlacement(ads, placement);
  const active = byPlace.filter((a) => a.active !== false);
  const scheduled = active.filter((a) => matchesAdSchedule(a.schedule));

  const primary = scheduled.filter((a) => !a.isGlobalReserve && matchesTargeting(a, ctx));
  if (primary.length > 0) {
    primary.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return { ads: primary, usedGlobalReserve: false };
  }

  const fallback = scheduled.filter((a) => a.isGlobalReserve === true);
  fallback.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return { ads: fallback, usedGlobalReserve: fallback.length > 0 };
}

/**
 * Стабильный индекс для сессии браузера: при новом «входе» (новая вкладка/сессия) seed другой,
 * между слотами — разные объявления за счёт placement.
 */
/** Маппинг документа Firestore → элемент каталога (сервер и клиент). */
export function superAdFromFirestoreDoc(
  id: string,
  data: Record<string, unknown>
): SuperAdCatalogItem {
  const levelsRaw = Array.isArray(data.venueLevels) ? data.venueLevels : [];
  const venueLevels = levelsRaw
    .map((x) => Number(x))
    .filter((n) => !Number.isNaN(n) && n >= 1 && n <= 5);

  return {
    id,
    title: typeof data.title === "string" ? data.title : undefined,
    body: typeof data.body === "string" ? data.body : undefined,
    imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : undefined,
    href: typeof data.href === "string" ? data.href : undefined,
    active: data.active as boolean | undefined,
    placements: Array.isArray(data.placements) ? data.placements.map(String) : undefined,
    sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : undefined,
    regions: Array.isArray(data.regions) ? data.regions.map((x) => String(x).trim()).filter(Boolean) : undefined,
    countries: Array.isArray(data.countries)
      ? data.countries.map((x) => String(x).trim()).filter(Boolean)
      : undefined,
    venueLevels: venueLevels.length > 0 ? venueLevels : undefined,
    category: typeof data.category === "string" ? data.category.trim() : undefined,
    schedule:
      data.schedule && typeof data.schedule === "object" && data.schedule !== null
        ? (data.schedule as SuperAdSchedule)
        : undefined,
    isGlobalReserve: data.isGlobalReserve === true,
    impressions: typeof data.impressions === "number" ? data.impressions : undefined,
    clicks: typeof data.clicks === "number" ? data.clicks : undefined,
  };
}

/** Публичная выдача: без счётчиков. */
export function toPublicSuperAdItem(ad: SuperAdCatalogItem): SuperAdCatalogItem {
  const { impressions: _i, clicks: _c, ...rest } = ad;
  return rest;
}

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
