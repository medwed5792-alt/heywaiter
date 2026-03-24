/**
 * SOTA-ID: [Type][Subtype][6 × Base36] — ровно 8 символов (A–Z, 0–9).
 * Типы: V Venue, G Guest, S Staff, A Advertiser.
 */

const BASE36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export type SotaEntityType = "V" | "G" | "S" | "A";

/** Маркеры подтипа по домену (одна буква/цифра — в коде используем буквы). */
export const VENUE_SUBTYPES = ["R", "C", "B"] as const;
export type VenueSubtype = (typeof VENUE_SUBTYPES)[number];

export const GUEST_SUBTYPES = ["N", "V", "P"] as const;
export type GuestSubtype = (typeof GUEST_SUBTYPES)[number];

export const STAFF_SUBTYPES = ["W", "M", "K"] as const;
export type StaffSubtype = (typeof STAFF_SUBTYPES)[number];

export const ADVERTISER_SUBTYPES = ["D", "B", "C"] as const;
export type AdvertiserSubtype = (typeof ADVERTISER_SUBTYPES)[number];

function assertSubtypeForType(type: SotaEntityType, subtype: string): void {
  const s = subtype.trim().toUpperCase();
  if (s.length !== 1 || !/^[A-Z0-9]$/.test(s)) {
    throw new Error(`SOTA subtype must be a single A-Z/0-9 character, got: ${subtype}`);
  }
  const ok =
    (type === "V" && (VENUE_SUBTYPES as readonly string[]).includes(s)) ||
    (type === "G" && (GUEST_SUBTYPES as readonly string[]).includes(s)) ||
    (type === "S" && (STAFF_SUBTYPES as readonly string[]).includes(s)) ||
    (type === "A" && (ADVERTISER_SUBTYPES as readonly string[]).includes(s));
  if (!ok) {
    throw new Error(`SOTA subtype "${s}" is not allowed for type ${type}`);
  }
}

function randomBase36(length: number): string {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < length; i++) {
    out += BASE36[bytes[i]! % 36];
  }
  return out;
}

/**
 * Генерирует SOTA-ID: тип + подтип + 6 случайных символов Base36.
 */
export function generateSotaId(type: SotaEntityType, subtype: string): string {
  const t = type.toUpperCase() as SotaEntityType;
  if (t !== "V" && t !== "G" && t !== "S" && t !== "A") {
    throw new Error(`Invalid SOTA type: ${type}`);
  }
  assertSubtypeForType(t, subtype);
  const sub = subtype.trim().toUpperCase().slice(0, 1);
  return `${t}${sub}${randomBase36(6)}`;
}

/** Нормализация для сравнения и хранения в Firestore. */
export function normalizeSotaId(id: string): string {
  return id.trim().toUpperCase();
}

const SOTA_STARTAPP = /^([VGSA])([A-Z0-9])([0-9A-Z]{6})(t([0-9A-Z]{1,16}))?$/i;

/**
 * Разбор компактного startapp: `VR123A45` или `VR123A45t5` (заведение + опционально стол после `t`).
 */
export function parseSotaStartappPayload(raw: string): { venueSotaId: string; tableRef: string | null } | null {
  const s = raw.trim();
  const m = s.match(SOTA_STARTAPP);
  if (!m) return null;
  const venueSotaId = normalizeSotaId(m[1]! + m[2]! + m[3]!);
  if (venueSotaId[0] !== "V") {
    return null;
  }
  const tableRef = m[5] != null && m[5] !== "" ? normalizeSotaId(m[5]!) : null;
  return { venueSotaId, tableRef };
}

export function buildSotaStartappToken(venueSotaId: string, tableRef: string | null | undefined): string {
  const v = normalizeSotaId(venueSotaId);
  if (v.length !== 8) {
    throw new Error(`Venue SOTA id must be 8 chars, got ${v.length}`);
  }
  if (!tableRef || !String(tableRef).trim()) {
    return v;
  }
  const t = String(tableRef).trim().toUpperCase();
  if (!/^[0-9A-Z]{1,16}$/.test(t)) {
    throw new Error(`Invalid table ref for startapp: ${tableRef}`);
  }
  return `${v}t${t}`;
}
