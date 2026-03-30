/**
 * Документ Firestore: system_configs/venue_menu
 * Каталог блюд для Mini App (ЦУП): VR-ID → категории и позиции (SOTA standard).
 */

import { wallClockMinutesSinceMidnight } from "@/lib/iana-wall-clock";

export type VenueMenuCategory = {
  id: string;
  name: string;
  imageUrl?: string;
  /** false — скрыть из витрины и предзаказа. */
  isActive?: boolean;
  /** "HH:mm" */
  availableFrom?: string;
  /** "HH:mm" */
  availableTo?: string;
  sortOrder?: number;
};

export type VenueMenuItem = {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string;
  sortOrder?: number;
  /** false — скрыть из витрины (конструктор админки). */
  active?: boolean;
  /**
   * В продаже на витрине гостя. Жёсткое правило витрины: только `isActive === true`.
   * Заполняется из Firestore `isActive` или зеркалится с `active`.
   */
  isActive?: boolean;
};

export type VenueMenuVenueBlock = {
  categories: VenueMenuCategory[];
  items: VenueMenuItem[];
};

export type VenueMenuModuleConfig = {
  version?: number;
  /** Ключ: VR… (SOTA-ID, нормализуется к верхнему регистру). */
  venuesBySotaId?: Record<string, VenueMenuVenueBlock>;
};

export const VENUE_MENU_SYSTEM_CONFIG_DOC_ID = "venue_menu";

function parseCategory(x: Record<string, unknown>): VenueMenuCategory | null {
  const id = typeof x.id === "string" && x.id.trim() ? x.id.trim() : "";
  const name = typeof x.name === "string" ? x.name.trim() : "";
  if (!id || !name) return null;
  const imageUrl = typeof x.imageUrl === "string" ? x.imageUrl.trim() : undefined;
  const sortOrder = typeof x.sortOrder === "number" && Number.isFinite(x.sortOrder) ? x.sortOrder : undefined;
  const explicitOff = x.isActive === false || x.active === false;
  const isActive = !explicitOff;
  const availableFrom = typeof x.availableFrom === "string" ? x.availableFrom.trim() : undefined;
  const availableTo = typeof x.availableTo === "string" ? x.availableTo.trim() : undefined;
  return {
    id,
    name,
    ...(imageUrl ? { imageUrl } : {}),
    isActive,
    ...(availableFrom ? { availableFrom } : {}),
    ...(availableTo ? { availableTo } : {}),
    ...(sortOrder != null ? { sortOrder } : {}),
  };
}

function parseHHMM(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Проверка интервала "availableFrom / availableTo" в часах заведения (IANA), учёт перехода через полночь. */
export function isNowInMenuGroupInterval(args: {
  /** UTC-инстант «сейчас» (обычно `new Date()`). */
  now: Date;
  /** IANA, например Europe/Moscow. */
  timeZone: string;
  availableFrom?: string | null;
  availableTo?: string | null;
}): boolean {
  const fromM = parseHHMM(args.availableFrom);
  const toM = parseHHMM(args.availableTo);
  if (fromM == null && toM == null) return true;
  if (fromM == null || toM == null) return true;
  const tz = args.timeZone.trim() || "Europe/Moscow";
  const cur = wallClockMinutesSinceMidnight(args.now, tz);
  if (fromM <= toM) return cur >= fromM && cur <= toM;
  return cur >= fromM || cur <= toM;
}

function parseMenuItem(x: Record<string, unknown>): VenueMenuItem | null {
  const id = typeof x.id === "string" && x.id.trim() ? x.id.trim() : "";
  const categoryId = typeof x.categoryId === "string" && x.categoryId.trim() ? x.categoryId.trim() : "";
  const name = typeof x.name === "string" ? x.name.trim() : "";
  if (!id || !categoryId || !name) return null;
  const rawPrice = x.price;
  const price =
    typeof rawPrice === "number" && Number.isFinite(rawPrice)
      ? Math.max(0, rawPrice)
      : typeof rawPrice === "string"
        ? Math.max(0, Number(rawPrice.replace(",", ".")) || 0)
        : 0;
  const description = typeof x.description === "string" ? x.description.trim() : undefined;
  const imageUrl = typeof x.imageUrl === "string" ? x.imageUrl.trim() : undefined;
  const sortOrder = typeof x.sortOrder === "number" && Number.isFinite(x.sortOrder) ? x.sortOrder : undefined;
  const active = typeof x.active === "boolean" ? x.active : undefined;
  const explicitOff = x.isActive === false || x.active === false;
  const isActive = !explicitOff;
  return {
    id,
    categoryId,
    name,
    price,
    isActive,
    ...(description ? { description } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(sortOrder != null ? { sortOrder } : {}),
    ...(active != null ? { active } : {}),
  };
}

/**
 * Блок для витрины предзаказа гостя: только позиции с isActive === true и категории, где они есть.
 */
export function buildGuestPreorderShowcase(raw: VenueMenuVenueBlock | null): VenueMenuVenueBlock | null {
  if (!raw || !raw.categories.length || !raw.items.length) return null;
  const items = raw.items.filter((item) => item.isActive === true);
  if (!items.length) return null;
  const catIds = new Set(raw.categories.map((c) => c.id));
  const filteredItems = items.filter((i) => catIds.has(i.categoryId));
  if (!filteredItems.length) return null;
  return {
    categories: raw.categories.filter((c) => filteredItems.some((i) => i.categoryId === c.id)),
    items: filteredItems,
  };
}

/** Документ venues/{venueId}/configs/menu — тот же каркас, что блок VR в ЦУП. */
export function parseVenueMenuVenueBlock(raw: Record<string, unknown> | null | undefined): VenueMenuVenueBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const catsRaw = Array.isArray(raw.categories) ? raw.categories : [];
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
  const categories: VenueMenuCategory[] = [];
  for (const c of catsRaw) {
    const p = parseCategory((c ?? {}) as Record<string, unknown>);
    if (p) categories.push(p);
  }
  const items: VenueMenuItem[] = [];
  for (const it of itemsRaw) {
    const p = parseMenuItem((it ?? {}) as Record<string, unknown>);
    if (p) items.push(p);
  }
  categories.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return { categories, items };
}

export function parseVenueMenuModuleConfig(raw: Record<string, unknown> | null | undefined): VenueMenuModuleConfig {
  if (!raw || typeof raw !== "object") return {};
  const venuesRaw = raw.venuesBySotaId;
  const venuesBySotaId: Record<string, VenueMenuVenueBlock> = {};
  if (venuesRaw && typeof venuesRaw === "object") {
    for (const [k, v] of Object.entries(venuesRaw as Record<string, unknown>)) {
      if (!k.trim() || !v || typeof v !== "object") continue;
      const block = v as Record<string, unknown>;
      const catsRaw = Array.isArray(block.categories) ? block.categories : [];
      const itemsRaw = Array.isArray(block.items) ? block.items : [];
      const categories: VenueMenuCategory[] = [];
      for (const c of catsRaw) {
        const p = parseCategory((c ?? {}) as Record<string, unknown>);
        if (p) categories.push(p);
      }
      const items: VenueMenuItem[] = [];
      for (const it of itemsRaw) {
        const p = parseMenuItem((it ?? {}) as Record<string, unknown>);
        if (p) items.push(p);
      }
      categories.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      venuesBySotaId[k.trim().toUpperCase()] = { categories, items };
    }
  }
  return {
    version: typeof raw.version === "number" ? raw.version : undefined,
    venuesBySotaId: Object.keys(venuesBySotaId).length ? venuesBySotaId : undefined,
  };
}

/** Активные позиции и блок каталога для VR. */
export function pickVenueMenuCatalog(
  registrySotaId: string | null | undefined,
  module: VenueMenuModuleConfig
): VenueMenuVenueBlock | null {
  const sid = registrySotaId?.trim().toUpperCase();
  if (!sid || !module.venuesBySotaId) return null;
  const block = module.venuesBySotaId[sid];
  if (!block || !block.categories?.length || !block.items?.length) return null;
  const items = block.items.filter((i) => i.isActive === true);
  if (!items.length) return null;
  const catIds = new Set(block.categories.map((c) => c.id));
  const filteredItems = items.filter((i) => catIds.has(i.categoryId));
  if (!filteredItems.length) return null;
  return {
    categories: block.categories.filter((c) => filteredItems.some((i) => i.categoryId === c.id)),
    items: filteredItems,
  };
}

/** Пример для Firebase / ЦУП. */
export const VENUE_MENU_SYSTEM_CONFIG_JSON_EXAMPLE = JSON.stringify(
  {
    version: 1,
    venuesBySotaId: {
      VR000000: {
        categories: [
          { id: "cat_breakfast", name: "Завтраки", imageUrl: "", sortOrder: 0 },
          { id: "cat_drinks", name: "Напитки", sortOrder: 1 },
        ],
        items: [
          {
            id: "item_omelette",
            categoryId: "cat_breakfast",
            name: "Омлет",
            description: "С сыром",
            price: 250,
            imageUrl: "",
            sortOrder: 0,
            active: true,
          },
          {
            id: "item_coffee",
            categoryId: "cat_drinks",
            name: "Кофе",
            description: "Американо",
            price: 150,
            sortOrder: 0,
            active: true,
          },
        ],
      },
    },
  },
  null,
  2
);
