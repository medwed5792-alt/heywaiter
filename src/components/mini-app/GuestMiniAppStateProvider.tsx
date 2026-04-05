"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import {
  mergePreOrderSystemFields,
  resolvePreOrderEnabled,
  readVenueSotaId,
  resolvePreorderMaxCartItems,
  resolvePreorderSubmissionGate,
} from "@/lib/pre-order";
import { readVenueTimezone } from "@/lib/venue-timezone";
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
import { getWaiterIdFromTablePayload } from "@/lib/standards/table-waiter";
import toast from "react-hot-toast";
import { db } from "@/lib/firebase";
import { parseStartParamPayload } from "@/lib/parse-start-param";
import { parseSotaStartappPayload } from "@/lib/sota-id";
import { resolveSotaStartappToVenueTable } from "@/lib/sota-resolve";
import { useVisitor } from "@/components/providers/VisitorProvider";
import { resolveUnifiedCustomerUid, visitHistoryUidCandidates } from "@/lib/identity/customer-uid";
import { getTelegramUserIdFromWebApp } from "@/lib/telegram-webapp-user";
import { DEFAULT_GLOBAL_GEO_RADIUS_LIMIT_METERS } from "@/lib/geo";
import type { ActiveSession, ActiveSessionParticipant, ActiveSessionParticipantStatus } from "@/lib/types";
import type { OrderStatus } from "@/lib/types";

type TelegramWebAppInit = {
  initData?: string;
  initDataUnsafe?: {
    start_param?: string;
    user?: { id?: number; first_name?: string; last_name?: string };
    receiver?: { username?: string };
  };
  ready?: () => void;
  addToAttachmentMenu?: () => Promise<boolean> | boolean;
  showScanQrPopup?: (params: { text?: string }, callback: (text: string) => void) => void;
  /** Закрывает только оверлей сканера QR (не путать с close — закрытием всего Mini App). */
  closeScanQrPopup?: () => void;
  close?: () => void;
};

function normalizeBotUsername(raw: string | undefined | null): string {
  return (raw ?? "").trim().replace(/^@/, "").toLowerCase();
}

function getTelegramWebApp(): TelegramWebAppInit | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebAppInit } }).Telegram?.WebApp;
}

function isTelegramContext(): boolean {
  if (typeof window === "undefined") return false;
  const tg = getTelegramWebApp();
  if (!tg) return false;
  const initData = typeof tg.initData === "string" ? tg.initData.trim() : "";
  return initData.length > 0;
}

function getStartParamFromTelegramWebApp(): string {
  const webApp = getTelegramWebApp();
  return webApp?.initDataUnsafe?.start_param?.trim() ?? "";
}

type GuestVisitEntry = {
  venueId: string;
  lastVisitAt?: unknown;
  totalVisits?: number;
};

type GuestOrderLine = {
  name: string;
  qty: number;
  unitPrice: number;
  totalAmount: number;
};

type GuestTableOrder = {
  id: string;
  orderNumber: number;
  status: OrderStatus | string;
  customerUid?: string;
  items: GuestOrderLine[];
};

export type SotaSystemConfig = {
  adsNetworkEnabled: boolean;
  geoRadiusLimit: number;
  globalMaintenanceMode: boolean;
  /** ЦУП: ключ VR… → включить предзаказ для заведения с таким sotaId. */
  preOrderBySotaVenueId: Record<string, boolean>;
  /** ЦУП: ключ = Firestore id документа venues/{id}. */
  preOrderByVenueDocId: Record<string, boolean>;
  [key: string]: unknown;
};

const DEFAULT_SYSTEM_CONFIG: SotaSystemConfig = {
  adsNetworkEnabled: true,
  geoRadiusLimit: DEFAULT_GLOBAL_GEO_RADIUS_LIMIT_METERS,
  globalMaintenanceMode: false,
  preOrderBySotaVenueId: {},
  preOrderByVenueDocId: {},
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
      String(x.name ?? x.title ?? x.dishName ?? x.itemName ?? "").trim() ||
      "Позиция";
    const qty = Math.max(parseNumber(x.qty ?? x.quantity), 1);
    const unitPriceRaw = parseNumber(x.price ?? x.unitPrice);
    const totalRaw = parseNumber(x.amount ?? x.total);

    const totalAmount = totalRaw > 0 ? totalRaw : unitPriceRaw > 0 ? unitPriceRaw * qty : 0;
    const unitPrice = unitPriceRaw > 0 ? unitPriceRaw : qty > 0 ? totalAmount / qty : 0;

    items.push({ name, qty, unitPrice, totalAmount });
  }

  if (items.length > 0) return items;

  // Fallback: order without `items` array — try numeric fields.
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

function visitTimestampMillis(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  if (v && typeof v === "object" && "seconds" in v && typeof (v as { seconds: number }).seconds === "number") {
    return (v as { seconds: number }).seconds * 1000;
  }
  return 0;
}

function parseGuestTableOrder(docId: string, data: Record<string, unknown>): GuestTableOrder {
  const orderNumber = Math.max(1, Math.floor(parseNumber(data.orderNumber)));
  const status = typeof data.status === "string" ? data.status : "pending";
  const customerUid = typeof data.customerUid === "string" ? data.customerUid.trim() : undefined;
  const items = extractOrderItemsForUI(data);

  return {
    id: docId,
    orderNumber,
    status,
    customerUid,
    items,
  };
}

type GuestMiniAppContextValue = {
  guestIdentity: { sotaId: string | null; telegramUid: string | null; currentUid: string | null };
  currentLocation: { venueId: string | null; tableId: string | null };
  visitHistory: GuestVisitEntry[];
  activeSession: ActiveSession | null;
  participants: ActiveSessionParticipant[];
  currentTableOrders: GuestTableOrder[];
  systemConfig: SotaSystemConfig;
  isInitializing: boolean;
  isGuestBlocked: boolean;
  guestBlockedReason: string | null;
  /** false на экране посадки, пока гость не подтвердил приветствие; сервисные кнопки неактивны. */
  isSessionActive: boolean;
  /** Закреплённый за столом staff id — совпадает с тем, что бэкенд использует для вызова. */
  assignedStaffId: string | null;
  /** Имя для строки «Вас обслуживает …». */
  assignedStaffDisplayName: string | null;
  completeWelcomeSequence: () => void;
  switchLocation: (venueId: string | null, tableId: string | null) => Promise<void>;
  openTableScanner: () => void;
  openVenueMenu: (venueId: string) => void;
  refreshVisitHistory: () => Promise<void>;
  callWaiter: (reason: "menu" | "bill" | "help") => Promise<void>;
  requestBill: (type: "full" | "split") => Promise<void>;
  isVenuePreOrderEnabled: (venueFirestoreId: string) => boolean;
  getVenueRegistrySotaId: (venueFirestoreId: string) => string | null;
  preorderModuleConfig: PreorderModuleConfig;
  getPreorderSubmissionGate: (venueFirestoreId: string) => { ok: boolean; reason: string | null };
  getPreorderMaxCartItems: (venueFirestoreId: string) => number;
  /** IANA TZ заведения для расписания меню и предзаказа. */
  getVenueTimeZone: (venueFirestoreId: string) => string;
  /** Каталог предзаказа из venues/{id}/configs/menu (только isActive === true). */
  getVenueMenuCatalog: (venueFirestoreId: string) => VenueMenuVenueBlock | null;
  /** Ссылка на PDF/внешнее меню из venues.config (независимо от каталога). */
  getVenueMenuPdfUrl: (venueFirestoreId: string) => string | null;
};

const GuestMiniAppContext = createContext<GuestMiniAppContextValue | null>(null);

export function GuestMiniAppStateProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { visitorId } = useVisitor();

  const [currentLocation, setCurrentLocation] = useState<{ venueId: string | null; tableId: string | null }>({
    venueId: null,
    tableId: null,
  });
  const [visitHistory, setVisitHistory] = useState<GuestVisitEntry[]>([]);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [participants, setParticipants] = useState<ActiveSessionParticipant[]>([]);
  const [currentTableOrders, setCurrentTableOrders] = useState<GuestTableOrder[]>([]);
  const [systemConfig, setSystemConfig] = useState<SotaSystemConfig>(DEFAULT_SYSTEM_CONFIG);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSdkReady, setIsSdkReady] = useState(false);
  const [isGuestBlocked, setIsGuestBlocked] = useState(false);
  const [guestBlockedReason, setGuestBlockedReason] = useState<string | null>(null);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [telegramUid, setTelegramUid] = useState<string | null>(null);
  const [assignedStaffId, setAssignedStaffId] = useState<string | null>(null);
  const [assignedStaffDisplayName, setAssignedStaffDisplayName] = useState<string | null>(null);
  const [venueDocById, setVenueDocById] = useState<Record<string, Record<string, unknown>>>({});
  const [preorderModuleConfig, setPreorderModuleConfig] = useState<PreorderModuleConfig>({});
  /** Снимки витрины по venueId (после фильтра стоп-листа). */
  const [guestVenueMenuShowcaseByVenueId, setGuestVenueMenuShowcaseByVenueId] = useState<
    Record<string, VenueMenuVenueBlock | null>
  >({});
  const checkInSyncRef = useRef<string | null>(null);
  /** Актуальные id на момент клика — для запросов без гонок со снимком замыкания. */
  const serviceHandshakeRef = useRef<{
    venueId: string | null;
    tableId: string | null;
    assignedStaffId: string | null;
  }>({ venueId: null, tableId: null, assignedStaffId: null });
  const attachmentMenuInitRef = useRef(false);
  const rootOrdersLoadedRef = useRef(false);

  const guestIdentity = useMemo(() => {
    const currentUid = resolveUnifiedCustomerUid({
      telegramUserId: telegramUid,
      anonymousId: visitorId?.trim() || null,
    });
    const webApp = getTelegramWebApp();
    const startParam = webApp?.initDataUnsafe?.start_param?.trim() ?? "";
    const sota = startParam ? parseSotaStartappPayload(startParam) : null;
    return {
      sotaId: sota?.venueSotaId ?? null,
      telegramUid,
      currentUid,
    };
  }, [telegramUid, visitorId]);

  // До isSdkReady initData может быть пустым; после ready() и при поздней подгрузке — опрос как в StaffProvider.
  useEffect(() => {
    if (!isSdkReady || typeof window === "undefined") return;
    const read = () => getTelegramUserIdFromWebApp(getTelegramWebApp());
    const apply = () => {
      const id = read();
      if (id) setTelegramUid(id);
      return Boolean(id);
    };
    if (apply()) return;
    let n = 0;
    const timer = window.setInterval(() => {
      n += 1;
      if (apply() || n >= 17) window.clearInterval(timer);
    }, 300);
    return () => window.clearInterval(timer);
  }, [isSdkReady]);

  const refreshVisitHistory = useCallback(async () => {
    const currentUid = guestIdentity.currentUid;
    if (!currentUid || currentLocation.venueId || currentLocation.tableId) {
      setVisitHistory([]);
      return;
    }
    const candidates = visitHistoryUidCandidates(currentUid);
    try {
      const byVenue = new Map<string, GuestVisitEntry>();
      for (const uid of candidates) {
        const q = query(
          collection(db, "users", uid, "visits"),
          orderBy("lastVisitAt", "desc"),
          limit(5)
        );
        const snap = await getDocs(q);
        for (const d of snap.docs) {
          const x = d.data() as Record<string, unknown>;
          const next: GuestVisitEntry = {
            venueId: d.id,
            lastVisitAt: x.lastVisitAt,
            totalVisits: typeof x.totalVisits === "number" ? x.totalVisits : undefined,
          };
          const prev = byVenue.get(d.id);
          if (!prev) {
            byVenue.set(d.id, next);
          } else {
            const prevMs = visitTimestampMillis(prev.lastVisitAt);
            const nextMs = visitTimestampMillis(next.lastVisitAt);
            if (nextMs >= prevMs) {
              byVenue.set(d.id, {
                ...next,
                totalVisits: next.totalVisits ?? prev.totalVisits,
              });
            }
          }
        }
      }
      const entries = [...byVenue.values()]
        .sort((a, b) => visitTimestampMillis(b.lastVisitAt) - visitTimestampMillis(a.lastVisitAt))
        .slice(0, 5);
      setVisitHistory(entries);
    } catch {
      setVisitHistory([]);
    }
  }, [guestIdentity.currentUid, currentLocation.venueId, currentLocation.tableId]);

  const switchLocation = useCallback(
    async (venueId: string | null, tableId: string | null) => {
      const nextVenueId = venueId?.trim() || null;
      const nextTableId = tableId?.trim() || null;
      setCurrentLocation({ venueId: nextVenueId, tableId: nextTableId });
      setActiveSession(null);
      setParticipants([]);
      setCurrentTableOrders([]);
      if (nextVenueId && !nextTableId) {
        setVisitHistory((prev) => {
          const deduped = prev.filter((v) => v.venueId !== nextVenueId);
          return [{ venueId: nextVenueId }, ...deduped].slice(0, 5);
        });
      }
      if (!nextVenueId && !nextTableId) {
        await refreshVisitHistory();
      }
    },
    [refreshVisitHistory]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const tg = getTelegramWebApp();
    if (!tg) {
      setIsSdkReady(true);
      return;
    }
    tg.ready?.();
    queueMicrotask(() => setIsSdkReady(true));
  }, []);

  // Telegram Mini App UX: suggest pinning app in attachment menu once per device.
  useEffect(() => {
    if (!isSdkReady || typeof window === "undefined") return;
    if (attachmentMenuInitRef.current) return;
    const tg = getTelegramWebApp();
    const inTg = isTelegramContext();
    if (!tg || !inTg || typeof tg.addToAttachmentMenu !== "function") return;
    attachmentMenuInitRef.current = true;

    let alreadyDone = false;
    try {
      alreadyDone = localStorage.getItem("sota_guest_attachment_menu_added") === "1";
    } catch {
      // ignore storage errors
    }
    if (alreadyDone) return;

    Promise.resolve(tg.addToAttachmentMenu())
      .then(() => {
        try {
          localStorage.setItem("sota_guest_attachment_menu_added", "1");
        } catch {
          // ignore
        }
      })
      .catch(() => {
        // optional API; ignore unsupported clients
      });
  }, [isSdkReady]);

  // Global runtime config from system_settings/global with safe defaults.
  useEffect(() => {
    const ref = doc(db, "system_settings", "global");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const raw = (snap.data() ?? {}) as Record<string, unknown>;
        const preOrderFields = mergePreOrderSystemFields(raw);
        const next: SotaSystemConfig = {
          ...DEFAULT_SYSTEM_CONFIG,
          ...raw,
          ...preOrderFields,
          adsNetworkEnabled:
            typeof raw.adsNetworkEnabled === "boolean"
              ? raw.adsNetworkEnabled
              : DEFAULT_SYSTEM_CONFIG.adsNetworkEnabled,
          geoRadiusLimit:
            typeof raw.geoRadiusLimit === "number" && Number.isFinite(raw.geoRadiusLimit)
              ? raw.geoRadiusLimit
              : DEFAULT_SYSTEM_CONFIG.geoRadiusLimit,
          globalMaintenanceMode:
            typeof raw.globalMaintenanceMode === "boolean"
              ? raw.globalMaintenanceMode
              : DEFAULT_SYSTEM_CONFIG.globalMaintenanceMode,
        };
        setSystemConfig(next);
        console.log("SOTA Global Config Updated:", next);
      },
      () => {
        setSystemConfig(DEFAULT_SYSTEM_CONFIG);
      }
    );
    return () => unsub();
  }, []);

  // ЦУП: system_configs/preorder — VR, окна времени, лимиты корзины.
  useEffect(() => {
    const ref = doc(db, "system_configs", PREORDER_SYSTEM_CONFIG_DOC_ID);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const raw = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
        setPreorderModuleConfig(parsePreorderModuleConfig(raw));
      },
      () => setPreorderModuleConfig({})
    );
    return () => unsub();
  }, []);

  // Экран посадки: на каждом столе — отдельный флаг в sessionStorage.
  useEffect(() => {
    const v = currentLocation.venueId?.trim();
    const t = currentLocation.tableId?.trim();
    if (!v || !t) {
      setIsSessionActive(true);
      return;
    }
    try {
      const done = sessionStorage.getItem(`sota_welcome_${v}_${t}`) === "1";
      setIsSessionActive(done);
    } catch {
      setIsSessionActive(false);
    }
  }, [currentLocation.venueId, currentLocation.tableId]);

  // Тот же currentWaiterId, что и на бэкенде при pushCallWaiterNotification.
  useEffect(() => {
    if (!isSdkReady || !currentLocation.venueId || !currentLocation.tableId) {
      setAssignedStaffId(null);
      return;
    }
    const venueId = currentLocation.venueId;
    const tableId = currentLocation.tableId;
    const tableRef = doc(db, "venues", venueId, "tables", tableId);
    const unsub = onSnapshot(tableRef, (snap) => {
      if (!snap.exists()) {
        setAssignedStaffId(null);
        return;
      }
      const data = (snap.data() ?? {}) as Record<string, unknown>;
      setAssignedStaffId(getWaiterIdFromTablePayload(data));
    });
    return () => unsub();
  }, [isSdkReady, currentLocation.venueId, currentLocation.tableId]);

  useEffect(() => {
    if (!assignedStaffId) {
      setAssignedStaffDisplayName(null);
      return;
    }
    const staffRef = doc(db, "staff", assignedStaffId);
    const unsub = onSnapshot(staffRef, (snap) => {
      if (!snap.exists()) {
        setAssignedStaffDisplayName(null);
        return;
      }
      const data = (snap.data() ?? {}) as Record<string, unknown>;
      const dn =
        typeof data.displayName === "string" && data.displayName.trim()
          ? data.displayName.trim()
          : typeof data.name === "string" && data.name.trim()
            ? data.name.trim()
            : null;
      setAssignedStaffDisplayName(dn);
    });
    return () => unsub();
  }, [assignedStaffId]);

  useEffect(() => {
    serviceHandshakeRef.current = {
      venueId: currentLocation.venueId?.trim() || null,
      tableId: currentLocation.tableId?.trim() || null,
      assignedStaffId,
    };
  }, [currentLocation.venueId, currentLocation.tableId, assignedStaffId]);

  useEffect(() => {
    if (!isSdkReady) return;
    const tg = getTelegramWebApp();
    const receiver = normalizeBotUsername(tg?.initDataUnsafe?.receiver?.username);
    const staffBot = normalizeBotUsername(process.env.NEXT_PUBLIC_STAFF_BOT_USERNAME);
    if (receiver && staffBot && receiver === staffBot) {
      setIsGuestBlocked(true);
      setGuestBlockedReason("Откройте гостевое приложение из меню бота заведения");
      setIsInitializing(false);
      return;
    }

    const resolveRoute = async () => {
      const inTg = isTelegramContext();
      if (inTg) {
        const sp = getStartParamFromTelegramWebApp();
        if (sp) {
          const decoded = (() => {
            try {
              return decodeURIComponent(sp.trim());
            } catch {
              return sp.trim();
            }
          })();

          const sota = parseSotaStartappPayload(decoded);
          if (sota) {
            try {
              const resolved = await resolveSotaStartappToVenueTable(db, sota.venueSotaId, sota.tableRef);
              if (resolved) {
                await switchLocation(resolved.venueId, resolved.tableId || null);
                setIsInitializing(false);
                return;
              }
            } catch {
              // fallback to legacy parser below
            }
          }

          const payload = parseStartParamPayload(decoded);
          if (payload) {
            await switchLocation(payload.venueId, payload.tableId || null);
            setIsInitializing(false);
            return;
          }
        }
        await switchLocation(null, null);
        setIsInitializing(false);
        return;
      }

      const v = (searchParams.get("v") ?? "").trim();
      const t = (searchParams.get("t") ?? "").trim();
      if (v && t) {
        await switchLocation(v, t);
      } else {
        await switchLocation(null, null);
      }
      setIsInitializing(false);
    };

    void resolveRoute();
  }, [isSdkReady, searchParams, switchLocation]);

  // Poll table status. When the backend marks it as "closed" we return the guest to dashboard.
  useEffect(() => {
    if (!isSdkReady || !currentLocation.venueId || !currentLocation.tableId) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const q = query(
          collection(db, "activeSessions"),
          where("venueId", "==", currentLocation.venueId),
          where("tableId", "==", currentLocation.tableId),
          where("status", "==", "closed"),
          limit(1)
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        if (!snap.empty) {
          await switchLocation(currentLocation.venueId, null);
        }
      } catch {
        // best-effort polling
      }
    };

    void poll();
    const id = window.setInterval(() => {
      void poll();
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [currentLocation.venueId, currentLocation.tableId, isSdkReady, switchLocation]);

  useEffect(() => {
    if (!isSdkReady || !currentLocation.venueId || !currentLocation.tableId || !guestIdentity.currentUid) return;
    const key = `${currentLocation.venueId}:${currentLocation.tableId}:${guestIdentity.currentUid}`;
    if (checkInSyncRef.current === key) return;
    checkInSyncRef.current = key;
    (async () => {
      try {
        const res = await fetch("/api/check-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            venueId: currentLocation.venueId,
            tableId: currentLocation.tableId,
            participantUid: guestIdentity.currentUid,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { onboardingHint?: string };
        if (typeof data.onboardingHint === "string" && data.onboardingHint.trim()) {
          toast(data.onboardingHint.trim(), { icon: "📌" });
        }
      } catch {
        // session data will be updated by activeSessions snapshot
      }
    })();
  }, [currentLocation.venueId, currentLocation.tableId, guestIdentity.currentUid, isSdkReady]);

  // Live session data: masterId, isPrivate and participants.
  useEffect(() => {
    if (!isSdkReady || !currentLocation.venueId || !currentLocation.tableId) return;
    const venueId = currentLocation.venueId;
    const tableId = currentLocation.tableId;

    const q = query(
      collection(db, "activeSessions"),
      where("venueId", "==", venueId),
      where("tableId", "==", tableId),
      where("status", "==", "check_in_success"),
      limit(1)
    );

    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) {
        setActiveSession(null);
        setParticipants([]);
        return;
      }

      const d = (snap.docs[0]!.data() ?? {}) as Record<string, unknown>;
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
          return {
            uid,
            status,
            joinedAt: x.joinedAt ?? null,
            updatedAt: x.updatedAt ?? null,
          };
        })
        .filter(Boolean) as ActiveSessionParticipant[];

      const tableNumber = typeof d.tableNumber === "number" ? d.tableNumber : 0;
      const status = typeof d.status === "string" ? d.status : "check_in_success";

      const session: ActiveSession = {
        id: snap.docs[0]!.id,
        venueId,
        tableId,
        tableNumber,
        masterId: masterId || undefined,
        isPrivate,
        participants: parsedParticipants,
        status: status === "check_in_success" ? "check_in_success" : "check_in_success",
        createdAt: d.createdAt ?? null,
        updatedAt: d.updatedAt ?? null,
      };

      setActiveSession(session);
      setParticipants(parsedParticipants);
    });

    return () => unsub();
  }, [isSdkReady, currentLocation.venueId, currentLocation.tableId]);

  // Live orders data for the table.
  useEffect(() => {
    if (!isSdkReady || !currentLocation.venueId || !currentLocation.tableId) return;

    const venueId = currentLocation.venueId;
    const tableId = currentLocation.tableId;

    let rootOrders: GuestTableOrder[] = [];

    rootOrdersLoadedRef.current = false;

    const parseOrdersSnap = (snap: any): GuestTableOrder[] => {
      return snap.docs.map((d: any) => parseGuestTableOrder(d.id, d.data() as Record<string, unknown>));
    };

    // Root orders (current schema in this repo)
    const qRoot = query(
      collection(db, "orders"),
      where("venueId", "==", venueId),
      where("tableId", "==", tableId),
      where("status", "in", ["pending", "ready"])
    );
    const unsubRoot = onSnapshot(qRoot, (snap) => {
      rootOrders = parseOrdersSnap(snap);
      rootOrdersLoadedRef.current = true;
      setCurrentTableOrders(rootOrders);
    });

    return () => {
      unsubRoot();
    };
  }, [isSdkReady, currentLocation.venueId, currentLocation.tableId]);

  useEffect(() => {
    if (!isSdkReady || isInitializing || currentLocation.venueId || currentLocation.tableId) return;
    void refreshVisitHistory();
  }, [isSdkReady, isInitializing, currentLocation.venueId, currentLocation.tableId, refreshVisitHistory]);

  const visitVenueIdsKey = useMemo(() => {
    const s = new Set<string>();
    for (const v of visitHistory) {
      const id = v.venueId?.trim();
      if (id) s.add(id);
    }
    const cur = currentLocation.venueId?.trim();
    if (cur) s.add(cur);
    return [...s].sort().join("|");
  }, [visitHistory, currentLocation.venueId]);

  useEffect(() => {
    if (!isSdkReady) return;
    const ids = visitVenueIdsKey ? visitVenueIdsKey.split("|").filter(Boolean) : [];
    const unsubs: Array<() => void> = [];
    for (const id of ids) {
      const ref = doc(db, "venues", id);
      const unsub = onSnapshot(
        ref,
        (snap) => {
          setVenueDocById((prev) => ({
            ...prev,
            [id]: snap.exists() ? { ...(snap.data() as Record<string, unknown>) } : {},
          }));
        },
        () => {
          setVenueDocById((prev) => ({ ...prev, [id]: {} }));
        }
      );
      unsubs.push(unsub);
    }
    return () => unsubs.forEach((u) => u());
  }, [isSdkReady, visitVenueIdsKey]);

  /** Локальный каталог заведения для витрины предзаказа (Live). */
  useEffect(() => {
    if (!isSdkReady) return;
    const ids = visitVenueIdsKey ? visitVenueIdsKey.split("|").filter(Boolean) : [];
    const unsubs: Array<() => void> = [];
    for (const id of ids) {
      const menuRef = doc(db, "venues", id, "configs", "menu");
      const unsub = onSnapshot(
        menuRef,
        (snap) => {
          if (!snap.exists()) {
            setGuestVenueMenuShowcaseByVenueId((prev) => ({ ...prev, [id]: null }));
            return;
          }
          const block = parseVenueMenuVenueBlock(snap.data() as Record<string, unknown>);
          const showcase = buildGuestPreorderShowcase(block);
          setGuestVenueMenuShowcaseByVenueId((prev) => ({ ...prev, [id]: showcase }));
        },
        () => {
          setGuestVenueMenuShowcaseByVenueId((prev) => ({ ...prev, [id]: null }));
        }
      );
      unsubs.push(unsub);
    }
    return () => unsubs.forEach((u) => u());
  }, [isSdkReady, visitVenueIdsKey]);

  const isVenuePreOrderEnabled = useCallback(
    (venueFirestoreId: string) => {
      const id = venueFirestoreId.trim();
      if (!id) return false;
      return resolvePreOrderEnabled(id, venueDocById[id], systemConfig, preorderModuleConfig);
    },
    [venueDocById, systemConfig, preorderModuleConfig]
  );

  const getVenueRegistrySotaId = useCallback(
    (venueFirestoreId: string) => readVenueSotaId(venueDocById[venueFirestoreId.trim()]),
    [venueDocById]
  );

  const getVenueTimeZone = useCallback(
    (venueFirestoreId: string) => readVenueTimezone(venueDocById[venueFirestoreId.trim()]),
    [venueDocById]
  );

  const getPreorderSubmissionGate = useCallback(
    (venueFirestoreId: string) => {
      const id = venueFirestoreId.trim();
      const vr = readVenueSotaId(venueDocById[id]);
      const vtz = readVenueTimezone(venueDocById[id]);
      const r = resolvePreorderSubmissionGate({
        registrySotaId: vr,
        preorderModule: preorderModuleConfig,
        venueTimeZone: vtz,
      });
      return r.ok ? { ok: true as const, reason: null } : { ok: false as const, reason: r.reason };
    },
    [venueDocById, preorderModuleConfig]
  );

  const getPreorderMaxCartItems = useCallback(
    (venueFirestoreId: string) => {
      const vr = readVenueSotaId(venueDocById[venueFirestoreId.trim()]);
      return resolvePreorderMaxCartItems(vr, preorderModuleConfig, 100);
    },
    [venueDocById, preorderModuleConfig]
  );

  const getVenueMenuCatalog = useCallback((venueFirestoreId: string) => {
    const id = venueFirestoreId.trim();
    if (!id) return null;
    return guestVenueMenuShowcaseByVenueId[id] ?? null;
  }, [guestVenueMenuShowcaseByVenueId]);

  const getVenueMenuPdfUrl = useCallback(
    (venueFirestoreId: string) => {
      const d = venueDocById[venueFirestoreId.trim()] as Record<string, unknown> | undefined;
      const cfg = (d?.config ?? {}) as Record<string, unknown>;
      const pdf = typeof cfg.menuPdfUrl === "string" ? cfg.menuPdfUrl.trim() : "";
      const link = typeof cfg.menuLink === "string" ? cfg.menuLink.trim() : "";
      const u = pdf || link;
      return u || null;
    },
    [venueDocById]
  );

  const openVenueMenu = useCallback(
    (venueId: string) => {
      void switchLocation(venueId, null);
    },
    [switchLocation]
  );

  const openTableScanner = useCallback(() => {
    const inTg = isTelegramContext();
    const tg = getTelegramWebApp();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (inTg && tg?.showScanQrPopup) {
      tg.showScanQrPopup({ text: "Наведите на QR стола" }, (qrText) => {
        void (async () => {
          const raw = String(qrText ?? "").trim();
          if (!raw) {
            toast.error("Неверный QR");
            return;
          }

          const resolveFromUrl = async (u: URL) => {
            const path = u.pathname || "";
            if (path.includes("/check-in") || path.includes("/mini-app")) {
              const v = u.searchParams.get("v") || u.searchParams.get("venueId");
              const t = u.searchParams.get("t") || u.searchParams.get("tableId") || u.searchParams.get("tableRef") || "";
              if (v && v.trim()) return { venueId: v.trim(), tableId: t.trim() };
            }
            const startapp = u.searchParams.get("startapp");
            if (startapp) {
              const decoded = (() => {
                try {
                  return decodeURIComponent(startapp.trim());
                } catch {
                  return startapp.trim();
                }
              })();
              const sota = parseSotaStartappPayload(decoded);
              if (sota) {
                const resolved = await resolveSotaStartappToVenueTable(db, sota.venueSotaId, sota.tableRef);
                if (resolved) return { venueId: resolved.venueId, tableId: resolved.tableId || "" };
              }
              const legacy = parseStartParamPayload(decoded);
              if (legacy) return { venueId: legacy.venueId, tableId: legacy.tableId };
            }
            return null;
          };

          const resolveFromText = async (text: string) => {
            try {
              if (/^https?:\/\//i.test(text)) return await resolveFromUrl(new URL(text));
              if (text.includes("heywaiter.vercel.app")) {
                const normalized = text.startsWith("heywaiter.vercel.app")
                  ? `https://${text}`
                  : `https://${text.replace(/^\/+/, "")}`;
                return await resolveFromUrl(new URL(normalized));
              }
            } catch {
              // ignore
            }

            const startappMatch = text.match(/startapp=([^&\s]+)/i);
            if (startappMatch?.[1]) {
              const rawToken = startappMatch[1];
              const decoded = (() => {
                try {
                  return decodeURIComponent(rawToken.trim());
                } catch {
                  return rawToken.trim();
                }
              })();
              const sota = parseSotaStartappPayload(decoded);
              if (sota) {
                const resolved = await resolveSotaStartappToVenueTable(db, sota.venueSotaId, sota.tableRef);
                if (resolved) return { venueId: resolved.venueId, tableId: resolved.tableId || "" };
              }
              const legacy = parseStartParamPayload(decoded);
              if (legacy) return { venueId: legacy.venueId, tableId: legacy.tableId };
            }

            const legacy = parseStartParamPayload(text);
            if (legacy) return { venueId: legacy.venueId, tableId: legacy.tableId };
            const sota = parseSotaStartappPayload(text);
            if (sota) {
              const resolved = await resolveSotaStartappToVenueTable(db, sota.venueSotaId, sota.tableRef);
              if (resolved) return { venueId: resolved.venueId, tableId: resolved.tableId || "" };
            }
            return null;
          };

          const resolved = await resolveFromText(raw);
          if (!resolved) {
            toast.error("Неверный QR");
            return;
          }
          await switchLocation(resolved.venueId, resolved.tableId || null);
          tg.closeScanQrPopup?.();
        })();
      });
      return;
    }
    if (inTg) {
      toast.error("Сканер QR недоступен в этой версии клиента. Обновите Telegram до последней версии.");
      return;
    }
    toast("Откройте приложение в Telegram для сканера QR", { icon: "ℹ️" });
    router.push(`${origin}/check-in`);
  }, [router, switchLocation]);

  const completeWelcomeSequence = useCallback(() => {
    const v = currentLocation.venueId?.trim();
    const t = currentLocation.tableId?.trim();
    if (v && t) {
      try {
        sessionStorage.setItem(`sota_welcome_${v}_${t}`, "1");
      } catch {
        // ignore
      }
    }
    setIsSessionActive(true);
  }, [currentLocation.venueId, currentLocation.tableId]);

  const callWaiter = useCallback(
    async (reason: "menu" | "bill" | "help") => {
      if (isGuestBlocked) {
        toast.error(guestBlockedReason ?? "Гостевой режим заблокирован");
        return;
      }
      if (!isSessionActive) {
        toast.error("Сначала подтвердите приветствие на столе");
        return;
      }

      const snap = serviceHandshakeRef.current;
      const venueId = snap.venueId?.trim();
      const tableId = snap.tableId?.trim();
      if (!venueId || !tableId) {
        toast.error("Стол не определен");
        return;
      }

      const type = reason === "bill" ? "request_bill" : "call_waiter";

      try {
        const res = await fetch("/api/call-waiter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            venueId,
            tableId,
            type,
            customerUid: guestIdentity.currentUid ?? undefined,
            assignedStaffId: snap.assignedStaffId ?? undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || data.ok === false) throw new Error(data.error ?? "call-waiter failed");
        toast.success("Запрос отправлен персоналу");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось отправить запрос");
      }
    },
    [
      guestBlockedReason,
      isGuestBlocked,
      isSessionActive,
      guestIdentity.currentUid,
    ]
  );

  const requestBill = useCallback(
    async (type: "full" | "split") => {
      if (isGuestBlocked) {
        toast.error(guestBlockedReason ?? "Гостевой режим заблокирован");
        return;
      }

      const snap = serviceHandshakeRef.current;
      const venueId = snap.venueId?.trim();
      const tableId = snap.tableId?.trim();
      const uid = guestIdentity.currentUid?.trim();
      if (!venueId || !tableId || !uid) {
        toast.error("Не удалось определить гостя или стол");
        return;
      }

      try {
        const res = await fetch("/api/request-bill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            venueId,
            tableId,
            uid,
            type,
            assignedStaffId: snap.assignedStaffId ?? undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || data.ok === false) throw new Error(data.error ?? "request-bill failed");
        toast.success("Запрос счета отправлен");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось отправить запрос счета");
      }
    },
    [
      guestIdentity.currentUid,
      guestBlockedReason,
      isGuestBlocked,
    ]
  );

  const value = useMemo<GuestMiniAppContextValue>(
    () => ({
      guestIdentity,
      currentLocation,
      visitHistory,
      activeSession,
      participants,
      currentTableOrders,
      systemConfig,
      isInitializing,
      isGuestBlocked,
      guestBlockedReason,
      isSessionActive,
      assignedStaffId,
      assignedStaffDisplayName,
      completeWelcomeSequence,
      switchLocation,
      openTableScanner,
      openVenueMenu,
      refreshVisitHistory,
      callWaiter,
      requestBill,
      isVenuePreOrderEnabled,
      getVenueRegistrySotaId,
      preorderModuleConfig,
      getPreorderSubmissionGate,
      getPreorderMaxCartItems,
      getVenueTimeZone,
      getVenueMenuCatalog,
      getVenueMenuPdfUrl,
    }),
    [
      guestIdentity,
      currentLocation,
      visitHistory,
      activeSession,
      participants,
      currentTableOrders,
      systemConfig,
      isInitializing,
      isGuestBlocked,
      guestBlockedReason,
      isSessionActive,
      assignedStaffId,
      assignedStaffDisplayName,
      completeWelcomeSequence,
      switchLocation,
      openTableScanner,
      openVenueMenu,
      refreshVisitHistory,
      callWaiter,
      requestBill,
      isVenuePreOrderEnabled,
      getVenueRegistrySotaId,
      preorderModuleConfig,
      getPreorderSubmissionGate,
      getPreorderMaxCartItems,
      getVenueTimeZone,
      getVenueMenuCatalog,
      getVenueMenuPdfUrl,
    ]
  );

  return <GuestMiniAppContext.Provider value={value}>{children}</GuestMiniAppContext.Provider>;
}

export function useGuestContext(): GuestMiniAppContextValue {
  const ctx = useContext(GuestMiniAppContext);
  if (!ctx) {
    throw new Error("useGuestContext must be used within GuestMiniAppStateProvider");
  }
  return ctx;
}

export function useOptionalGuestContext(): GuestMiniAppContextValue | null {
  return useContext(GuestMiniAppContext);
}
