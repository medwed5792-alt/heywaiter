/**
 * Документ Firestore: system_configs/preorder
 * No-code модуль предзаказа для ЦУП: VR-ID, окна времени, лимиты.
 * Дополняет legacy-ключи в system_settings/global (preOrderBySotaVenueId и т.д.).
 */

export type PreorderVenuePolicy = {
  /** Включить предзаказ для этого VR (SOTA-ID заведения, 8 символов, нормализуется). */
  enabled?: boolean;
  /** IANA TZ для serviceHoursLocal (например Europe/Moscow). */
  timeZone?: string;
  /** Локальное окно приёма предзаказов (часы заведения), формат HH:mm. */
  serviceHoursLocal?: { start: string; end: string };
  /**
   * Не раньше чем за N часов до «условного прихода» — резерв под будущую привязку к брони/визиту.
   * Пока не используется в UI; зафиксировано в схеме для ЦУП.
   */
  minLeadTimeHoursBeforeArrival?: number;
  /**
   * Не позже чем за N часов до прихода — резерв под бронь.
   */
  maxLeadTimeHoursBeforeArrival?: number;
  /** Макс. позиций в корзине для этого VR (перекрывает defaultMaxCartItems). */
  maxCartItems?: number;
};

export type PreorderModuleConfig = {
  version?: number;
  /** Политика по ключу VR… (после normalizeSotaId). */
  venuesBySotaId?: Record<string, PreorderVenuePolicy>;
  defaults?: {
    timeZone?: string;
    defaultMaxCartItems?: number;
  };
};

export const PREORDER_SYSTEM_CONFIG_DOC_ID = "preorder";

/** Пример тела документа system_configs/preorder — скопируйте в Firebase Console или Admin. */
export const PREORDER_SYSTEM_CONFIG_JSON_EXAMPLE = JSON.stringify(
  {
    version: 1,
    venuesBySotaId: {
      VR000000: {
        enabled: true,
        timeZone: "Europe/Moscow",
        serviceHoursLocal: { start: "09:00", end: "23:30" },
        minLeadTimeHoursBeforeArrival: 0,
        maxLeadTimeHoursBeforeArrival: 168,
        maxCartItems: 50,
      },
    },
    defaults: {
      timeZone: "Europe/Moscow",
      defaultMaxCartItems: 100,
    },
  },
  null,
  2
);

function parseHM(raw: string): [number, number] | null {
  const s = raw.trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return [h, min];
}

function localHourMinute(now: Date, timeZone: string): { h: number; m: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === "hour") h = Number(p.value);
    if (p.type === "minute") m = Number(p.value);
  }
  return { h, m };
}

/** Текущее локальное время в зоне — минуты от полуночи. */
function localMinutesFromMidnight(now: Date, timeZone: string): number {
  const { h, m } = localHourMinute(now, timeZone);
  return h * 60 + m;
}

/**
 * Окно [start,end] в минутах от полуночи; если start > end — интервал через полночь.
 */
export function isNowWithinServiceWindow(
  now: Date,
  timeZone: string,
  startHM: string,
  endHM: string
): boolean {
  const start = parseHM(startHM);
  const end = parseHM(endHM);
  if (!start || !end) return true;
  const cur = localMinutesFromMidnight(now, timeZone);
  const a = start[0] * 60 + start[1];
  const b = end[0] * 60 + end[1];
  if (a <= b) return cur >= a && cur <= b;
  return cur >= a || cur <= b;
}

export function parsePreorderModuleConfig(raw: Record<string, unknown> | null | undefined): PreorderModuleConfig {
  if (!raw || typeof raw !== "object") return {};
  const venuesRaw = raw.venuesBySotaId;
  const venuesBySotaId: Record<string, PreorderVenuePolicy> = {};
  if (venuesRaw && typeof venuesRaw === "object") {
    for (const [k, v] of Object.entries(venuesRaw as Record<string, unknown>)) {
      if (!k.trim() || !v || typeof v !== "object") continue;
      const x = v as Record<string, unknown>;
      const sh = x.serviceHoursLocal as Record<string, unknown> | undefined;
      venuesBySotaId[k.trim().toUpperCase()] = {
        enabled: typeof x.enabled === "boolean" ? x.enabled : undefined,
        timeZone: typeof x.timeZone === "string" ? x.timeZone.trim() : undefined,
        serviceHoursLocal:
          sh && typeof sh.start === "string" && typeof sh.end === "string"
            ? { start: sh.start.trim(), end: sh.end.trim() }
            : undefined,
        minLeadTimeHoursBeforeArrival:
          typeof x.minLeadTimeHoursBeforeArrival === "number" && Number.isFinite(x.minLeadTimeHoursBeforeArrival)
            ? x.minLeadTimeHoursBeforeArrival
            : undefined,
        maxLeadTimeHoursBeforeArrival:
          typeof x.maxLeadTimeHoursBeforeArrival === "number" && Number.isFinite(x.maxLeadTimeHoursBeforeArrival)
            ? x.maxLeadTimeHoursBeforeArrival
            : undefined,
        maxCartItems:
          typeof x.maxCartItems === "number" && Number.isFinite(x.maxCartItems) ? Math.floor(x.maxCartItems) : undefined,
      };
    }
  }
  const d = raw.defaults as Record<string, unknown> | undefined;
  const defaults =
    d && typeof d === "object"
      ? {
          timeZone: typeof d.timeZone === "string" ? d.timeZone.trim() : undefined,
          defaultMaxCartItems:
            typeof d.defaultMaxCartItems === "number" && Number.isFinite(d.defaultMaxCartItems)
              ? Math.floor(d.defaultMaxCartItems)
              : undefined,
        }
      : undefined;
  return {
    version: typeof raw.version === "number" ? raw.version : undefined,
    venuesBySotaId: Object.keys(venuesBySotaId).length ? venuesBySotaId : undefined,
    defaults,
  };
}

export function pickPreorderVenuePolicy(
  registrySotaId: string | null | undefined,
  module: PreorderModuleConfig
): PreorderVenuePolicy | undefined {
  const sid = registrySotaId?.trim().toUpperCase();
  if (!sid || !module.venuesBySotaId) return undefined;
  return module.venuesBySotaId[sid];
}
