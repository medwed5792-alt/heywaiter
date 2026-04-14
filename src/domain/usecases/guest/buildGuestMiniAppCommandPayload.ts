/**
 * Единый «телевизор» для Mini App: всё, что нужно для UI Акта 1, собирается на сервере одним запросом.
 */
import type { Firestore } from "firebase-admin/firestore";
import {
  normalizeActiveSessionStatus,
  resolveWaiterStaffIdFromSessionDoc,
} from "@/lib/active-session-waiter";
import { isActiveSessionWithinMaxAge } from "@/lib/session-freshness";
import type { ActiveSession, ActiveSessionParticipant, ActiveSessionParticipantStatus } from "@/lib/types";
import type { OrderStatus } from "@/lib/types";
import { mergePreOrderSystemFields } from "@/lib/pre-order";
import {
  GLOBAL_SETTINGS_DOC_ID,
  SYSTEM_CONFIGS_COLLECTION,
} from "@/lib/system-configs/collection";
import {
  parsePreorderModuleConfig,
  PREORDER_SYSTEM_CONFIG_DOC_ID,
  type PreorderModuleConfig,
} from "@/lib/system-configs/preorder-module-config";
import {
  buildGuestPreorderShowcase,
  parseVenueMenuVenueBlock,
  type VenueMenuVenueBlock,
} from "@/lib/system-configs/venue-menu-config";
import { DEFAULT_GLOBAL_GEO_RADIUS_LIMIT_METERS } from "@/lib/geo";
import type { ResolveGuestCurrentStatusResult } from "@/domain/usecases/guest/resolveGuestCurrentStatus";

export type SotaSystemConfigPayload = {
  adsNetworkEnabled: boolean;
  geoRadiusLimit: number;
  globalMaintenanceMode: boolean;
  preOrderBySotaVenueId: Record<string, boolean>;
  preOrderByVenueDocId: Record<string, boolean>;
  [key: string]: unknown;
};

const DEFAULT_SYSTEM_CONFIG: SotaSystemConfigPayload = {
  adsNetworkEnabled: true,
  geoRadiusLimit: DEFAULT_GLOBAL_GEO_RADIUS_LIMIT_METERS,
  globalMaintenanceMode: false,
  preOrderBySotaVenueId: {},
  preOrderByVenueDocId: {},
};

type GuestOrderLine = {
  name: string;
  qty: number;
  unitPrice: number;
  totalAmount: number;
};

export type GuestTableOrderPayload = {
  id: string;
  orderNumber: number;
  status: OrderStatus | string;
  customerUid?: string;
  items: GuestOrderLine[];
};

function parseNumber(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function extractOrderItemsForUI(data: Record<string, unknown>): GuestOrderLine[] {
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items: GuestOrderLine[] = [];
  for (const i of rawItems) {
    const x = (i ?? {}) as Record<string, unknown>;
    const name =
      String(x.name ?? x.title ?? x.dishName ?? x.itemName ?? "").trim() || "Позиция";
    const qty = Math.max(parseNumber(x.qty ?? x.quantity), 1);
    const unitPriceRaw = parseNumber(x.price ?? x.unitPrice);
    const totalRaw = parseNumber(x.amount ?? x.total);
    const totalAmount = totalRaw > 0 ? totalRaw : unitPriceRaw > 0 ? unitPriceRaw * qty : 0;
    const unitPrice = unitPriceRaw > 0 ? unitPriceRaw : qty > 0 ? totalAmount / qty : 0;
    items.push({ name, qty, unitPrice, totalAmount });
  }
  if (items.length > 0) return items;
  const total =
    parseNumber(data.amount) ||
    parseNumber(data.total) ||
    parseNumber(data.sum) ||
    parseNumber(data.price);
  if (total > 0) {
    items.push({ name: "Заказ", qty: 1, unitPrice: total, totalAmount: total });
  }
  return items;
}

function mapOrderDoc(docId: string, data: Record<string, unknown>): GuestTableOrderPayload {
  const orderNumber = Math.max(1, Math.floor(parseNumber(data.orderNumber)));
  const status = typeof data.status === "string" ? data.status : "pending";
  const customerUid = typeof data.customerUid === "string" ? data.customerUid.trim() : undefined;
  return {
    id: docId,
    orderNumber,
    status,
    customerUid,
    items: extractOrderItemsForUI(data),
  };
}

function mapBattleDataToActiveSession(
  docId: string,
  d: Record<string, unknown>,
  venueId: string,
  tableId: string
): ActiveSession | null {
  const rawStatus = typeof d.status === "string" ? d.status.trim() : "";
  const sessionStatus = normalizeActiveSessionStatus(rawStatus);
  if (sessionStatus === "closed") return null;
  if (!isActiveSessionWithinMaxAge(d, Date.now())) return null;

  const masterId = typeof d.masterId === "string" ? d.masterId.trim() : "";
  const isPrivate = typeof d.isPrivate === "boolean" ? d.isPrivate : true;
  const participantsRaw = Array.isArray(d.participants) ? d.participants : [];
  const parsedParticipants: ActiveSessionParticipant[] = participantsRaw
    .map((p) => {
      const x = (p ?? {}) as Record<string, unknown>;
      const uid = typeof x.uid === "string" ? x.uid.trim() : "";
      const statusRaw = x.status;
      const status: ActiveSessionParticipantStatus =
        statusRaw === "paid" || statusRaw === "exited" ? (statusRaw as ActiveSessionParticipantStatus) : "active";
      if (!uid) return null;
      return { uid, status, joinedAt: x.joinedAt ?? null, updatedAt: x.updatedAt ?? null };
    })
    .filter(Boolean) as ActiveSessionParticipant[];

  const tableNumber = typeof d.tableNumber === "number" ? d.tableNumber : 0;
  const sessionAssigned =
    typeof d.assignedStaffId === "string" && d.assignedStaffId.trim() ? d.assignedStaffId.trim() : undefined;
  const resolvedWaiter = resolveWaiterStaffIdFromSessionDoc(d) ?? undefined;
  const sessionTableId = typeof d.tableId === "string" ? d.tableId.trim() : tableId;

  return {
    id: docId,
    venueId,
    tableId: sessionTableId,
    tableNumber,
    masterId: masterId || undefined,
    isPrivate,
    participants: parsedParticipants,
    status: sessionStatus,
    assignedStaffId: sessionAssigned,
    resolvedWaiterStaffId: resolvedWaiter,
    waiterId: typeof d.waiterId === "string" && d.waiterId.trim() ? d.waiterId.trim() : undefined,
    createdAt: d.createdAt ?? null,
    updatedAt: d.updatedAt ?? null,
  };
}

async function loadStaffDisplayName(fs: Firestore, staffId: string | null | undefined): Promise<string | null> {
  const id = String(staffId ?? "").trim();
  if (!id) return null;
  try {
    const snap = await fs.collection("staff").doc(id).get();
    if (!snap.exists) return null;
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const dn =
      typeof data.displayName === "string" && data.displayName.trim()
        ? data.displayName.trim()
        : typeof data.name === "string" && data.name.trim()
          ? data.name.trim()
          : null;
    return dn;
  } catch {
    return null;
  }
}

export async function loadGuestMiniAppSystemBundle(fs: Firestore): Promise<{
  systemConfig: SotaSystemConfigPayload;
  preorderModuleConfig: PreorderModuleConfig;
}> {
  const [gSnap, pSnap] = await Promise.all([
    fs.doc(`${SYSTEM_CONFIGS_COLLECTION}/${GLOBAL_SETTINGS_DOC_ID}`).get(),
    fs.doc(`${SYSTEM_CONFIGS_COLLECTION}/${PREORDER_SYSTEM_CONFIG_DOC_ID}`).get(),
  ]);
  const raw = (gSnap.data() ?? {}) as Record<string, unknown>;
  const preOrderFields = mergePreOrderSystemFields(raw);
  const systemConfig: SotaSystemConfigPayload = {
    ...DEFAULT_SYSTEM_CONFIG,
    ...raw,
    ...preOrderFields,
    adsNetworkEnabled:
      typeof raw.adsNetworkEnabled === "boolean" ? raw.adsNetworkEnabled : DEFAULT_SYSTEM_CONFIG.adsNetworkEnabled,
    geoRadiusLimit:
      typeof raw.geoRadiusLimit === "number" && Number.isFinite(raw.geoRadiusLimit)
        ? raw.geoRadiusLimit
        : DEFAULT_SYSTEM_CONFIG.geoRadiusLimit,
    globalMaintenanceMode:
      typeof raw.globalMaintenanceMode === "boolean"
        ? raw.globalMaintenanceMode
        : DEFAULT_SYSTEM_CONFIG.globalMaintenanceMode,
  };
  const preorderModuleConfig = parsePreorderModuleConfig(
    pSnap.exists ? (pSnap.data() as Record<string, unknown>) : {}
  );
  return { systemConfig, preorderModuleConfig };
}

export type GuestMiniAppCommandExtras = {
  systemConfig: SotaSystemConfigPayload;
  preorderModuleConfig: PreorderModuleConfig;
  activeSession: ActiveSession | null;
  tableOrders: GuestTableOrderPayload[];
  venueDoc: Record<string, unknown> | null;
  venueMenuShowcase: VenueMenuVenueBlock | null;
  assignedStaffDisplayName: string | null;
};

const ACTIVE_ORDER_STATUSES = ["pending", "ready"] as const;

export async function buildGuestMiniAppCommandPayload(
  fs: Firestore,
  resolved: ResolveGuestCurrentStatusResult
): Promise<GuestMiniAppCommandExtras> {
  const { systemConfig, preorderModuleConfig } = await loadGuestMiniAppSystemBundle(fs);

  let activeSession: ActiveSession | null = null;
  let tableOrders: GuestTableOrderPayload[] = [];
  let venueDoc: Record<string, unknown> | null = null;
  let venueMenuShowcase: VenueMenuVenueBlock | null = null;
  let assignedStaffDisplayName: string | null = null;

  if (resolved.status === "WORKING") {
    const { venueId, tableId, sessionId } = resolved.act1;
    const sessionSnap = await fs.collection("activeSessions").doc(sessionId).get();
    if (sessionSnap.exists) {
      const d = (sessionSnap.data() ?? {}) as Record<string, unknown>;
      activeSession = mapBattleDataToActiveSession(sessionSnap.id, d, venueId, tableId);
      const sw = activeSession?.resolvedWaiterStaffId?.trim() || activeSession?.assignedStaffId?.trim() || null;
      assignedStaffDisplayName = await loadStaffDisplayName(fs, sw);
    }

    try {
      const ordersSnap = await fs
        .collection("orders")
        .where("venueId", "==", venueId)
        .where("tableId", "==", tableId)
        .where("status", "in", [...ACTIVE_ORDER_STATUSES])
        .limit(200)
        .get();
      tableOrders = ordersSnap.docs.map((doc) => mapOrderDoc(doc.id, doc.data() as Record<string, unknown>));
    } catch {
      tableOrders = [];
    }

    try {
      const vSnap = await fs.doc(`venues/${venueId}`).get();
      venueDoc = vSnap.exists ? { ...(vSnap.data() as Record<string, unknown>) } : {};
    } catch {
      venueDoc = {};
    }

    try {
      const menuSnap = await fs.doc(`venues/${venueId}/configs/menu`).get();
      if (menuSnap.exists) {
        const block = parseVenueMenuVenueBlock(menuSnap.data() as Record<string, unknown>);
        venueMenuShowcase = buildGuestPreorderShowcase(block);
      }
    } catch {
      venueMenuShowcase = null;
    }
  } else if (resolved.status === "FEEDBACK") {
    assignedStaffDisplayName = await loadStaffDisplayName(fs, resolved.act2.feedbackStaffId);
  }

  return {
    systemConfig,
    preorderModuleConfig,
    activeSession,
    tableOrders,
    venueDoc,
    venueMenuShowcase,
    assignedStaffDisplayName,
  };
}
