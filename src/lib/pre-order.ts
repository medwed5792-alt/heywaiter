/**
 * Pre-Order (предзаказ): корзина до прихода, флаги из ЦУП (system_settings/global) и venue.moduleConfig.
 * Firestore: venues/{venueId}/preorder_carts/{customerUid}
 */

import { normalizeSotaId } from "@/lib/sota-id";
import type { PreorderModuleConfig } from "@/lib/system-configs/preorder-module-config";
import {
  isNowWithinServiceWindow,
  pickPreorderVenuePolicy,
} from "@/lib/system-configs/preorder-module-config";

/** Фрагмент system_settings/global для предзаказа (задаётся в ЦУП /super/system). */
export type PreOrderGlobalConfigSlice = {
  preOrderBySotaVenueId?: Record<string, boolean>;
  preOrderByVenueDocId?: Record<string, boolean>;
};

export const PREORDER_CARTS_SUBCOLLECTION = "preorder_carts";

export type PreOrderCartStatus = "draft" | "sent" | "received" | "cancelled";

export type PreOrderLineItem = {
  id: string;
  name: string;
  qty: number;
  unitPrice: number;
  note?: string;
};

export type PreOrderCartPayload = {
  items: PreOrderLineItem[];
  status: PreOrderCartStatus;
  updatedAtMs: number;
};

const LS_PREFIX = "heywaiter_preorder_v1:";

export function newPreorderLineId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `ln_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function preorderLocalStorageKey(venueFirestoreId: string): string {
  return `${LS_PREFIX}${venueFirestoreId.trim()}`;
}

function parseBoolRecord(raw: unknown, normalizeKey: (k: string) => string): Record<string, boolean> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizeKey(k.trim());
    if (!key) continue;
    if (typeof v === "boolean") out[key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Из system_settings/global: ключи VR… (нормализуются). */
export function parsePreOrderBySotaVenueId(raw: unknown): Record<string, boolean> | undefined {
  return parseBoolRecord(raw, (k) => normalizeSotaId(k));
}

/** Из system_settings/global: ключи = Firestore doc id заведения. */
export function parsePreOrderByVenueDocId(raw: unknown): Record<string, boolean> | undefined {
  return parseBoolRecord(raw, (k) => k);
}

export function mergePreOrderSystemFields(raw: Record<string, unknown>): Required<PreOrderGlobalConfigSlice> {
  return {
    preOrderBySotaVenueId: parsePreOrderBySotaVenueId(raw.preOrderBySotaVenueId) ?? {},
    preOrderByVenueDocId: parsePreOrderByVenueDocId(raw.preOrderByVenueDocId) ?? {},
  };
}

function readModulePreOrderEnabled(venueData: Record<string, unknown> | null | undefined): boolean | undefined {
  if (!venueData) return undefined;
  const mc = venueData.moduleConfig as Record<string, unknown> | undefined;
  if (!mc || typeof mc !== "object") return undefined;
  const po = mc.preOrder as Record<string, unknown> | undefined;
  if (!po || typeof po !== "object") return undefined;
  if (typeof po.enabled === "boolean") return po.enabled;
  return undefined;
}

/**
 * Приоритет: venues.moduleConfig.preOrder.enabled → system_configs/preorder venuesBySotaId[VR] →
 * preOrderByVenueDocId → preOrderBySotaVenueId[VR] → false.
 */
export function resolvePreOrderEnabled(
  venueFirestoreId: string,
  venueData: Record<string, unknown> | null | undefined,
  systemConfig: PreOrderGlobalConfigSlice,
  preorderModule?: PreorderModuleConfig | null
): boolean {
  const mod = readModulePreOrderEnabled(venueData);
  if (typeof mod === "boolean") return mod;

  const sid = readVenueSotaId(venueData);
  const cupPolicy = pickPreorderVenuePolicy(sid, preorderModule ?? {});
  if (cupPolicy && typeof cupPolicy.enabled === "boolean") return cupPolicy.enabled;

  const byDoc = systemConfig.preOrderByVenueDocId;
  if (byDoc && typeof byDoc[venueFirestoreId] === "boolean") return byDoc[venueFirestoreId]!;

  if (sid) {
    const bySota = systemConfig.preOrderBySotaVenueId;
    if (bySota && typeof bySota[sid] === "boolean") return bySota[sid]!;
  }

  return false;
}

export function resolvePreorderMaxCartItems(
  registrySotaId: string | null,
  preorderModule: PreorderModuleConfig | null | undefined,
  fallback: number = 100
): number {
  const policy = pickPreorderVenuePolicy(registrySotaId, preorderModule ?? {});
  if (policy?.maxCartItems != null && policy.maxCartItems > 0) return Math.min(500, policy.maxCartItems);
  const d = preorderModule?.defaults?.defaultMaxCartItems;
  if (typeof d === "number" && d > 0) return Math.min(500, Math.floor(d));
  return fallback;
}

export function resolvePreorderSubmissionGate(args: {
  registrySotaId: string | null;
  preorderModule: PreorderModuleConfig | null | undefined;
  now?: Date;
}): { ok: true } | { ok: false; reason: string } {
  const now = args.now ?? new Date();
  const policy = pickPreorderVenuePolicy(args.registrySotaId, args.preorderModule ?? {});
  if (!policy?.serviceHoursLocal) return { ok: true };
  const tz =
    (policy.timeZone?.trim() || args.preorderModule?.defaults?.timeZone?.trim() || "Europe/Moscow").trim();
  const { start, end } = policy.serviceHoursLocal;
  if (!isNowWithinServiceWindow(now, tz, start, end)) {
    return {
      ok: false,
      reason: `Приём предзаказов с ${start} до ${end} (${tz})`,
    };
  }
  return { ok: true };
}

export function readVenueSotaId(venueData: Record<string, unknown> | null | undefined): string | null {
  const sid = typeof venueData?.sotaId === "string" ? venueData.sotaId.trim() : "";
  if (!sid) return null;
  return normalizeSotaId(sid);
}

export function loadPreorderDraftFromLocal(venueFirestoreId: string): PreOrderLineItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(preorderLocalStorageKey(venueFirestoreId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { items?: unknown };
    if (!Array.isArray(parsed.items)) return [];
    return parsed.items
      .map((row) => {
        const x = (row ?? {}) as Record<string, unknown>;
        const id = typeof x.id === "string" && x.id.trim() ? x.id.trim() : newPreorderLineId();
        const name = typeof x.name === "string" ? x.name.trim() : "";
        const qty = typeof x.qty === "number" && Number.isFinite(x.qty) ? Math.max(1, Math.floor(x.qty)) : 1;
        const unitPrice =
          typeof x.unitPrice === "number" && Number.isFinite(x.unitPrice) ? Math.max(0, x.unitPrice) : 0;
        const note = typeof x.note === "string" ? x.note.trim() : undefined;
        if (!name) return null;
        return { id, name, qty, unitPrice, ...(note ? { note } : {}) } satisfies PreOrderLineItem;
      })
      .filter(Boolean) as PreOrderLineItem[];
  } catch {
    return [];
  }
}

export function savePreorderDraftToLocal(venueFirestoreId: string, items: PreOrderLineItem[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(preorderLocalStorageKey(venueFirestoreId), JSON.stringify({ items, savedAt: Date.now() }));
  } catch {
    // ignore
  }
}

export function parsePreorderCartDoc(data: Record<string, unknown> | null | undefined): PreOrderCartPayload | null {
  if (!data) return null;
  const statusRaw = typeof data.status === "string" ? data.status.trim() : "draft";
  const status =
    statusRaw === "sent" || statusRaw === "received" || statusRaw === "cancelled" || statusRaw === "draft"
      ? (statusRaw as PreOrderCartStatus)
      : "draft";
  const itemsRaw = Array.isArray(data.items) ? data.items : [];
  const items: PreOrderLineItem[] = [];
  for (const row of itemsRaw) {
    const x = (row ?? {}) as Record<string, unknown>;
    const id = typeof x.id === "string" && x.id.trim() ? x.id.trim() : newPreorderLineId();
    const name = typeof x.name === "string" ? x.name.trim() : "";
    const qty = typeof x.qty === "number" && Number.isFinite(x.qty) ? Math.max(1, Math.floor(x.qty)) : 1;
    const unitPrice =
      typeof x.unitPrice === "number" && Number.isFinite(x.unitPrice) ? Math.max(0, x.unitPrice) : 0;
    const note = typeof x.note === "string" ? x.note.trim() : undefined;
    if (!name) continue;
    items.push({ id, name, qty, unitPrice, ...(note ? { note } : {}) });
  }
  const updatedAt =
    data.updatedAt && typeof (data.updatedAt as { toMillis?: () => number }).toMillis === "function"
      ? (data.updatedAt as { toMillis: () => number }).toMillis()
      : typeof data.updatedAtMs === "number"
        ? data.updatedAtMs
        : 0;
  return { items, status, updatedAtMs: updatedAt };
}
