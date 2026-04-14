"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import { getWaiterIdFromTablePayload } from "@/lib/standards/table-waiter";
import toast from "react-hot-toast";
import { db } from "@/lib/firebase";
import { parseStartParamPayload } from "@/lib/parse-start-param";
import { parseSotaStartappPayload } from "@/lib/sota-id";
import { resolveGuestTableFromQrText } from "@/lib/guest-qr-table-resolve";
import { useVisitor } from "@/components/providers/VisitorProvider";
import { useSotaLocation } from "@/components/providers/SotaLocationProvider";
import { resolveUnifiedCustomerUid, visitHistoryUidCandidates } from "@/lib/identity/customer-uid";
import { getTelegramUserIdFromWebApp } from "@/lib/telegram-webapp-user";
import { DEFAULT_GLOBAL_GEO_RADIUS_LIMIT_METERS } from "@/lib/geo";
import { clearPersistedGuestSeat } from "@/lib/guest-table-persistence";
import { buildFeedbackActSessionId } from "@/lib/feedback-act-session";
import { guestSessionClear } from "@/lib/guest-session-bridge";
import { getOrCreateGuestDeviceId } from "@/lib/guest-device-anchor";
import {
  normalizeActiveSessionStatus,
  resolveWaiterStaffIdFromSessionDoc,
} from "@/lib/active-session-waiter";
import { isActiveSessionWithinMaxAge, pickNewestFreshActiveSessionDoc } from "@/lib/session-freshness";
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

/**
 * Только «боевая» фаза (Акт 1). Акт 2 — archived_visits + activeSessions `feedback_*` (см. Дашборд).
 */
const ACTIVE_SESSION_STATUS_FILTER = ["check_in_success", "payment_confirmed"] as const;

export type PostServiceVisitState = {
  /** id archived_visits (= исходная боевая сессия). */
  visitId: string;
  /** id activeSessions второго акта — чаевые и учёт. */
  feedbackActSessionId: string;
  venueId: string;
  tableId: string;
  tableNumber: number;
  feedbackStaffId: string | null;
};

/**
 * Шлюз / QR: v|venueId, t|tableId — единая схема для провайдера.
 */
function readVenueTableFromSearchParams(searchParams: {
  get: (key: string) => string | null;
}): { venueId: string; tableId: string } | null {
  const venueId = (searchParams.get("v") ?? searchParams.get("venueId") ?? "").trim();
  const tableId = (searchParams.get("t") ?? searchParams.get("tableId") ?? "").trim();
  if (!venueId || !tableId) return null;
  return { venueId, tableId };
}

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

type PoliteStateResponse = {
  ok?: boolean;
  phase?: "working" | "thank_you" | "free";
  globalGuestUid?: string;
  working?: { venueId: string; tableId: string; sessionId: string };
  thankYou?: {
    visitId: string;
    feedbackActSessionId?: string;
    venueId: string;
    tableId: string;
    tableNumber: number;
    feedbackStaffId: string | null;
  };
};

type GuestMiniAppContextValue = {
  guestIdentity: { sotaId: string | null; telegramUid: string | null; currentUid: string | null };
  /** Документ global_users после успешного check-in. */
  globalGuestUid: string | null;
  /** Приоритетный UID для API и сессии: global, иначе канальный. */
  guestProfileUid: string | null;
  currentLocation: { venueId: string | null; tableId: string | null };
  visitHistory: GuestVisitEntry[];
  activeSession: ActiveSession | null;
  participants: ActiveSessionParticipant[];
  currentTableOrders: GuestTableOrder[];
  systemConfig: SotaSystemConfig;
  isInitializing: boolean;
  isGuestBlocked: boolean;
  guestBlockedReason: string | null;
  /** Закреплённый за столом staff id — совпадает с тем, что бэкенд использует для вызова. */
  assignedStaffId: string | null;
  /** Имя официанта по документу стола (для подсказок / чаевых). */
  assignedStaffDisplayName: string | null;
  switchLocation: (
    venueId: string | null,
    tableId: string | null,
    opts?: { preservePostServiceVisit?: boolean }
  ) => Promise<void>;
  openTableScanner: () => void;
  openVenueMenu: (venueId: string) => void;
  refreshVisitHistory: () => Promise<void>;
  callWaiter: () => Promise<void>;
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
  /** Только хозяин стола: разрешить/запретить подселение (isPrivate). */
  setTablePrivacyAllowJoin: (allowJoin: boolean) => Promise<{ ok: boolean; error?: string }>;
  /** Акт 2: отзыв/чаевые (archived_visits + id `feedback_*` для чаевых и Дашборда). */
  guestAwaitingTableFeedback: boolean;
  /** Архивный визит с guestFeedbackPending — источник для экрана отзыва. */
  postServiceVisit: PostServiceVisitState | null;
  /** После отзыва: закрыть сессию на сервере и выйти со стола в UI. */
  completeTableFeedbackSession: () => Promise<void>;
  /**
   * swid для чаевых в фазе отзыва: из последнего снимка activeSessions (onSnapshot),
   * иначе fallback — currentWaiterId с документа стола.
   */
  feedbackTargetStaffId: string | null;
  /** Разрешён ли fallback-экран со сканером после server-bootstrap. */
  showLandingScanner: boolean;
};

const GuestMiniAppContext = createContext<GuestMiniAppContextValue | null>(null);

export function GuestMiniAppStateProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { visitorId } = useVisitor();
  const { checkGuestQrVenueAccess } = useSotaLocation();

  const urlTableFromParams = useMemo(
    () => readVenueTableFromSearchParams(searchParams),
    [searchParams]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const href = window.location.href;
    const v = (searchParams.get("v") ?? searchParams.get("venueId") ?? "").trim();
    const t = (searchParams.get("t") ?? searchParams.get("tableId") ?? "").trim();
    console.info("[guest-entry] incoming-url", { href, v, t, hasTableParams: Boolean(v && t) });
  }, [searchParams]);

  const [currentLocation, setCurrentLocation] = useState<{ venueId: string | null; tableId: string | null }>({
    venueId: null,
    tableId: null,
  });
  const currentLocationRef = useRef(currentLocation);
  useEffect(() => {
    currentLocationRef.current = currentLocation;
  }, [currentLocation]);

  const [visitHistory, setVisitHistory] = useState<GuestVisitEntry[]>([]);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [participants, setParticipants] = useState<ActiveSessionParticipant[]>([]);
  const [currentTableOrders, setCurrentTableOrders] = useState<GuestTableOrder[]>([]);
  const [systemConfig, setSystemConfig] = useState<SotaSystemConfig>(DEFAULT_SYSTEM_CONFIG);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSdkReady, setIsSdkReady] = useState(false);
  /** В Telegram ждём user id (или таймаут опроса), если нет сохранённого globalGuestUid. */
  const [telegramIdentityReady, setTelegramIdentityReady] = useState(false);
  const [isGuestBlocked, setIsGuestBlocked] = useState(false);
  const [guestBlockedReason, setGuestBlockedReason] = useState<string | null>(null);
  const [telegramUid, setTelegramUid] = useState<string | null>(null);
  const [assignedStaffId, setAssignedStaffId] = useState<string | null>(null);
  const [assignedStaffDisplayName, setAssignedStaffDisplayName] = useState<string | null>(null);
  const [venueDocById, setVenueDocById] = useState<Record<string, Record<string, unknown>>>({});
  const [preorderModuleConfig, setPreorderModuleConfig] = useState<PreorderModuleConfig>({});
  /** Снимки витрины по venueId (после фильтра стоп-листа). */
  const [guestVenueMenuShowcaseByVenueId, setGuestVenueMenuShowcaseByVenueId] = useState<
    Record<string, VenueMenuVenueBlock | null>
  >({});
  const [showLandingScanner, setShowLandingScanner] = useState(false);
  /** Акт 2: экран отзыва после переноса в архив. */
  const [postServiceVisit, setPostServiceVisit] = useState<PostServiceVisitState | null>(null);
  /** Счётчик для принудительного пересоздания подписки activeSessions (встроенный сканер = тот же check-in, что и deep link). */
  const [tableListenerEpoch, setTableListenerEpoch] = useState(0);
  const [globalGuestUid, setGlobalGuestUid] = useState<string | null>(null);
  const globalGuestUidRef = useRef<string | null>(globalGuestUid);
  useEffect(() => {
    globalGuestUidRef.current = globalGuestUid;
  }, [globalGuestUid]);
  /** Актуальные id на момент клика — для запросов без гонок со снимком замыкания. */
  const serviceHandshakeRef = useRef<{
    venueId: string | null;
    tableId: string | null;
    assignedStaffId: string | null;
  }>({ venueId: null, tableId: null, assignedStaffId: null });
  const attachmentMenuInitRef = useRef(false);
  const rootOrdersLoadedRef = useRef(false);
  /** Один POST /api/check-in на пару venue|table из URL/start_param — без повторов при смене identity. */
  const urlCheckInGateKeyRef = useRef<string | null>(null);

  const guestIdentity = useMemo(() => {
    const anonId = visitorId?.trim() || getOrCreateGuestDeviceId() || null;
    const currentUid = resolveUnifiedCustomerUid({
      telegramUserId: telegramUid,
      anonymousId: anonId,
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

  useEffect(() => {
    const uid = guestIdentity.currentUid?.trim() || null;
    setGlobalGuestUid(uid);
  }, [guestIdentity.currentUid]);

  const guestProfileUid = useMemo(
    () => globalGuestUid?.trim() || guestIdentity.currentUid?.trim() || null,
    [globalGuestUid, guestIdentity.currentUid]
  );

  /** Bootstrap only after identity channel is resolved (or timed out). */
  const bootstrapIdentityReady = useMemo(() => telegramIdentityReady, [telegramIdentityReady]);

  // До isSdkReady initData может быть пустым; после ready() — опрос user id; затем один конвейер bootstrap.
  useEffect(() => {
    if (!isSdkReady || typeof window === "undefined") return;
    const tg = getTelegramWebApp();
    if (!tg || !isTelegramContext()) {
      setTelegramIdentityReady(true);
      return;
    }
    const read = () => getTelegramUserIdFromWebApp(getTelegramWebApp());
    const apply = () => {
      const id = read();
      if (id) setTelegramUid(id);
      return Boolean(id);
    };
    if (apply()) {
      setTelegramIdentityReady(true);
      return;
    }
    /** Ожидание user id из Telegram WebApp — без setInterval; сессия стола только через onSnapshot ниже. */
    let cancelled = false;
    void (async () => {
      for (let n = 0; n < 17 && !cancelled; n++) {
        if (apply()) break;
        await new Promise<void>((r) => setTimeout(r, 300));
      }
      if (!cancelled) setTelegramIdentityReady(true);
    })();
    return () => {
      cancelled = true;
      setTelegramIdentityReady(true);
    };
  }, [isSdkReady]);

  const refreshVisitHistory = useCallback(async () => {
    if (currentLocation.venueId || currentLocation.tableId) {
      setVisitHistory([]);
      return;
    }
    const gg = globalGuestUid?.trim() || "";
    const channelUid = guestIdentity.currentUid?.trim() || "";
    const uidSet = new Set<string>();
    if (gg) uidSet.add(gg);
    if (channelUid) {
      for (const c of visitHistoryUidCandidates(channelUid)) {
        if (c.trim()) uidSet.add(c.trim());
      }
    }
    if (uidSet.size === 0) {
      setVisitHistory([]);
      return;
    }
    try {
      const byVenue = new Map<string, GuestVisitEntry>();
      for (const uid of uidSet) {
        const q = query(
          collection(db, "global_users", uid, "visits"),
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
  }, [globalGuestUid, guestIdentity.currentUid, currentLocation.venueId, currentLocation.tableId]);

  const switchLocation = useCallback(
    async (
      venueId: string | null,
      tableId: string | null,
      opts?: { preservePostServiceVisit?: boolean }
    ) => {
      const prev = currentLocationRef.current;
      const hadTable = Boolean(prev.venueId?.trim() && prev.tableId?.trim());
      const nextVenueId = venueId?.trim() || null;
      const nextTableId = tableId?.trim() || null;
      const nextFullTable = Boolean(nextVenueId && nextTableId);
      /** Повторный вызов с тем же столом не должен сбрасывать activeSessions-снимок — иначе мерцание UI. */
      if (
        nextFullTable &&
        prev.venueId?.trim() === nextVenueId &&
        prev.tableId?.trim() === nextTableId
      ) {
        return;
      }
      if (hadTable && !nextFullTable) {
        const tg = getTelegramWebApp();
        const init = typeof tg?.initData === "string" ? tg.initData.trim() : "";
        if (init) void guestSessionClear(init);
      }
      if (!nextFullTable && !opts?.preservePostServiceVisit) {
        setPostServiceVisit(null);
      }
      setCurrentLocation({ venueId: nextVenueId, tableId: nextTableId });
      setActiveSession(null);
      setParticipants([]);
      setCurrentTableOrders([]);
      if (nextVenueId && !nextTableId) {
        clearPersistedGuestSeat();
        setVisitHistory((prev) => {
          const deduped = prev.filter((v) => v.venueId !== nextVenueId);
          return [{ venueId: nextVenueId }, ...deduped].slice(0, 5);
        });
      }
      if (!nextVenueId && !nextTableId) {
        if (hadTable) clearPersistedGuestSeat();
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

  // Неверный бот — сразу после SDK, без ожидания опроса Telegram user id.
  useEffect(() => {
    if (!isSdkReady) return;
    const tg = getTelegramWebApp();
    const receiver = normalizeBotUsername(tg?.initDataUnsafe?.receiver?.username);
    const staffBot = normalizeBotUsername(process.env.NEXT_PUBLIC_STAFF_BOT_USERNAME);
    if (receiver && staffBot && receiver === staffBot) {
      setIsGuestBlocked(true);
      setGuestBlockedReason("Откройте гостевое приложение из меню бота заведения");
      setIsInitializing(false);
    }
  }, [isSdkReady]);

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

  // Global runtime config from system_configs/global_settings with safe defaults.
  useEffect(() => {
    const ref = doc(db, SYSTEM_CONFIGS_COLLECTION, GLOBAL_SETTINGS_DOC_ID);
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

  const applySuccessfulTableBootstrap = useCallback(
    async (data: {
      venueId: string;
      tableId: string;
      onboardingHint?: string | null;
    }) => {
      setPostServiceVisit(null);
      setShowLandingScanner(false);
      await switchLocation(data.venueId.trim(), data.tableId.trim());
      if (typeof data.onboardingHint === "string" && data.onboardingHint.trim()) {
        toast(data.onboardingHint.trim(), { icon: "📌" });
      }
    },
    [switchLocation]
  );

  /**
   * polite-state без QR в URL: только thank_you / free.
   * «working» без явного check-in не обрабатываем — не вызываем POST /api/check-in и не сажаем за стол сами.
   */
  const applyPoliteStatePayload = useCallback(
    async (data: PoliteStateResponse) => {
      if (data.ok !== true || !data.phase) return false;

      if (data.phase === "working") {
        clearPersistedGuestSeat();
        setPostServiceVisit(null);
        setShowLandingScanner(true);
        await switchLocation(null, null);
        return true;
      }

      if (data.phase === "thank_you" && data.thankYou?.visitId?.trim()) {
        clearPersistedGuestSeat();
        const t = data.thankYou;
        const vid = t.visitId.trim();
        const fid =
          typeof t.feedbackActSessionId === "string" && t.feedbackActSessionId.trim()
            ? t.feedbackActSessionId.trim()
            : buildFeedbackActSessionId(vid);
        setShowLandingScanner(false);
        await switchLocation(null, null, { preservePostServiceVisit: true });
        setPostServiceVisit({
          visitId: vid,
          feedbackActSessionId: fid,
          venueId: String(t.venueId ?? "").trim(),
          tableId: String(t.tableId ?? "").trim(),
          tableNumber: typeof t.tableNumber === "number" ? t.tableNumber : 0,
          feedbackStaffId:
            typeof t.feedbackStaffId === "string" && t.feedbackStaffId.trim()
              ? t.feedbackStaffId.trim()
              : null,
        });
        return true;
      }

      if (data.phase === "free") {
        clearPersistedGuestSeat();
        setPostServiceVisit(null);
        setShowLandingScanner(true);
        await switchLocation(null, null);
        return true;
      }

      return false;
    },
    [switchLocation]
  );

  /**
   * После исчезновения activeSessions в снимке: один ответ сервера — только отзыв или сканер.
   * Никакого «working» / повторной посадки.
   */
  const applyFinalPoliteThankYouOrScanner = useCallback(
    async (data: PoliteStateResponse) => {
      if (data.ok === true && data.phase === "thank_you" && data.thankYou?.visitId?.trim()) {
        clearPersistedGuestSeat();
        const t = data.thankYou;
        const vid = t.visitId.trim();
        const fid =
          typeof t.feedbackActSessionId === "string" && t.feedbackActSessionId.trim()
            ? t.feedbackActSessionId.trim()
            : buildFeedbackActSessionId(vid);
        setShowLandingScanner(false);
        await switchLocation(null, null, { preservePostServiceVisit: true });
        setPostServiceVisit({
          visitId: vid,
          feedbackActSessionId: fid,
          venueId: String(t.venueId ?? "").trim(),
          tableId: String(t.tableId ?? "").trim(),
          tableNumber: typeof t.tableNumber === "number" ? t.tableNumber : 0,
          feedbackStaffId:
            typeof t.feedbackStaffId === "string" && t.feedbackStaffId.trim()
              ? t.feedbackStaffId.trim()
              : null,
        });
        return;
      }
      clearPersistedGuestSeat();
      setPostServiceVisit(null);
      setShowLandingScanner(true);
      await switchLocation(null, null);
    },
    [switchLocation]
  );

  const waitForActiveSessionConfirmation = useCallback(
    async (venueId: string, tableId: string, timeoutMs = 8000): Promise<boolean> => {
      const v = venueId.trim();
      const t = tableId.trim();
      if (!v || !t) return false;
      return await new Promise<boolean>((resolve) => {
        let done = false;
        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          unsub();
          resolve(ok);
        };
        const q = query(
          collection(db, "activeSessions"),
          where("venueId", "==", v),
          where("tableId", "==", t),
          where("status", "in", [...ACTIVE_SESSION_STATUS_FILTER]),
          limit(25)
        );
        const unsub = onSnapshot(
          q,
          (snap) => {
            const picked = pickNewestFreshActiveSessionDoc(snap.docs);
            finish(Boolean(picked));
          },
          () => finish(false)
        );
        const timer = setTimeout(() => finish(false), timeoutMs);
      });
    },
    []
  );

  const resolveCheckInFailureMessage = useCallback((status: string | undefined, apiMessage?: string): string => {
    if (typeof apiMessage === "string" && apiMessage.trim()) return apiMessage.trim();
    if (status === "table_private") return "Стол занят другим гостем. Подселение запрещено хозяином.";
    if (status === "table_conflict") return "Стол занят или забронирован. Отсканируйте другой QR.";
    return "Сессия недоступна. Отсканируйте QR стола снова.";
  }, []);

  /** Диктатура сервера: единая точка входа (QR/URL) + geo-check + подтверждение через onSnapshot. */
  const processEntry = useCallback(
    async (
      venueId: string,
      tableId: string,
      options?: { forceTableListenerResubscribe?: boolean }
    ): Promise<boolean> => {
      const v = venueId.trim();
      const t = tableId.trim();
      if (!v || !t) return false;

      const access = await checkGuestQrVenueAccess(v);
      if (!access.ok) {
        toast.error(access.message);
        setShowLandingScanner(true);
        await switchLocation(null, null);
        return false;
      }

      setShowLandingScanner(false);
      await switchLocation(null, null);
      try {
        const deviceAnchor = getOrCreateGuestDeviceId();
        const participantUid = guestIdentity.currentUid?.trim() || undefined;
        const res = await fetch("/api/check-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            venueId: v,
            tableId: t,
            participantUid,
            deviceAnchor: deviceAnchor || undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          mode?: "table" | "scanner";
          venueId?: string;
          tableId?: string;
          onboardingHint?: string | null;
          messageGuest?: string;
          sessionStatus?: string;
        };
        if (res.ok && data.ok === true && data.mode === "table" && data.venueId && data.tableId) {
          const confirmed = await waitForActiveSessionConfirmation(data.venueId, data.tableId);
          if (!confirmed) {
            setShowLandingScanner(true);
            await switchLocation(null, null);
            toast.error("Сервер не подтвердил активную сессию. Отсканируйте QR повторно.");
            return false;
          }
          await applySuccessfulTableBootstrap({
            venueId: data.venueId,
            tableId: data.tableId,
            onboardingHint: data.onboardingHint ?? null,
          });
          if (options?.forceTableListenerResubscribe) {
            setTableListenerEpoch((n) => n + 1);
          }
          return true;
        }

        setShowLandingScanner(true);
        await switchLocation(null, null);
        toast.error(resolveCheckInFailureMessage(data.sessionStatus, data.messageGuest));
        return false;
      } catch {
        setShowLandingScanner(true);
        await switchLocation(null, null);
        toast.error("Ошибка check-in. Повторите сканирование.");
        return false;
      }
    },
    [applySuccessfulTableBootstrap, checkGuestQrVenueAccess, guestIdentity.currentUid, resolveCheckInFailureMessage, switchLocation, waitForActiveSessionConfirmation]
  );

  // Единый server-side bootstrap: один запрос за итоговым состоянием.
  useEffect(() => {
    if (!isSdkReady || !bootstrapIdentityReady) return;
    const tgGate = getTelegramWebApp();
    const recvGate = normalizeBotUsername(tgGate?.initDataUnsafe?.receiver?.username);
    const staffGate = normalizeBotUsername(process.env.NEXT_PUBLIC_STAFF_BOT_USERNAME);
    if (recvGate && staffGate && recvGate === staffGate) {
      setIsGuestBlocked(true);
      setGuestBlockedReason("Откройте гостевое приложение из меню бота заведения");
      setIsInitializing(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      const fromUrl = readVenueTableFromSearchParams(searchParams);
      const startParamRaw = getTelegramWebApp()?.initDataUnsafe?.start_param?.trim() ?? "";
      const fromStartParam = startParamRaw ? parseStartParamPayload(startParamRaw) : null;
      const entryTable = fromUrl ?? (fromStartParam ? { venueId: fromStartParam.venueId, tableId: fromStartParam.tableId } : null);

      if (!entryTable) {
        urlCheckInGateKeyRef.current = null;
        const uid = globalGuestUidRef.current?.trim() || "";
        if (!uid) {
          clearPersistedGuestSeat();
          if (!cancelled) {
            setShowLandingScanner(true);
            await switchLocation(null, null);
            await refreshVisitHistory();
          }
        } else {
          try {
            const res = await fetch("/api/guest/polite-state", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ globalGuestUid: uid }),
            });
            const data = (await res.json().catch(() => ({}))) as PoliteStateResponse;
            if (cancelled) return;
            if (!res.ok || data.ok !== true) {
              clearPersistedGuestSeat();
              setShowLandingScanner(true);
              await switchLocation(null, null);
              await refreshVisitHistory();
            } else {
              await applyPoliteStatePayload(data);
              if (data.phase === "free" || data.phase === "working") {
                await refreshVisitHistory();
              }
            }
          } catch {
            clearPersistedGuestSeat();
            if (!cancelled) {
              setShowLandingScanner(true);
              await switchLocation(null, null);
              await refreshVisitHistory();
            }
          }
        }
        if (!cancelled) setIsInitializing(false);
        return;
      }

      try {
        const gateKey = `${entryTable.venueId.trim()}|${entryTable.tableId.trim()}`;
        if (urlCheckInGateKeyRef.current === gateKey) {
          if (!cancelled) setIsInitializing(false);
          return;
        }
        const ok = await processEntry(entryTable.venueId, entryTable.tableId);
        if (ok) urlCheckInGateKeyRef.current = gateKey;
        if (cancelled) return;
      } finally {
        if (!cancelled) setIsInitializing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isSdkReady,
    bootstrapIdentityReady,
    searchParams,
    switchLocation,
    refreshVisitHistory,
    processEntry,
    applyPoliteStatePayload,
  ]);

  // Live session data: masterId, isPrivate and participants. Закрытие стола — только из снимка (без polling getDocs).
  useEffect(() => {
    if (!isSdkReady || !currentLocation.venueId || !currentLocation.tableId) return;
    const venueId = currentLocation.venueId.trim();
    const tableId = currentLocation.tableId.trim();

    let sawSessionDoc = false;
    let cancelled = false;
    let unsub: (() => void) | undefined;

    const applySessionDoc = (docId: string, d: Record<string, unknown>) => {
      const rawStatus = typeof d.status === "string" ? d.status.trim() : "";
      const sessionStatus = normalizeActiveSessionStatus(rawStatus);

      if (sessionStatus === "closed") {
        setActiveSession(null);
        setParticipants([]);
        sawSessionDoc = false;
        setShowLandingScanner(true);
        void switchLocation(null, null);
        return;
      }

      if (!isActiveSessionWithinMaxAge(d, Date.now())) {
        setActiveSession(null);
        setParticipants([]);
        sawSessionDoc = false;
        setShowLandingScanner(true);
        void switchLocation(null, null);
        return;
      }

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
      const sessionAssigned =
        typeof d.assignedStaffId === "string" && d.assignedStaffId.trim() ? d.assignedStaffId.trim() : undefined;
      const resolvedWaiter = resolveWaiterStaffIdFromSessionDoc(d) ?? undefined;
      const sessionTableId = typeof d.tableId === "string" ? d.tableId.trim() : tableId;

      const session: ActiveSession = {
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

      sawSessionDoc = true;
      setActiveSession(session);
      setParticipants(parsedParticipants);
    };

    /** Без orderBy по createdAt: иначе нужен отдельный составной индекс; при его отсутствии onSnapshot падает и UI «вечно грузится». Свежесть — через pickNewestFreshActiveSessionDoc. */
    const q = query(
      collection(db, "activeSessions"),
      where("venueId", "==", venueId),
      where("tableId", "==", tableId),
      where("status", "in", [...ACTIVE_SESSION_STATUS_FILTER]),
      limit(25)
    );

    const finalizeAfterActiveSessionVanished = () => {
      void (async () => {
        const uid = globalGuestUidRef.current?.trim() || "";
        if (!uid) {
          await applyFinalPoliteThankYouOrScanner({ ok: true, phase: "free", globalGuestUid: "" });
          return;
        }
        try {
          const res = await fetch("/api/guest/polite-state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ globalGuestUid: uid }),
          });
          const data = (await res.json().catch(() => ({}))) as PoliteStateResponse;
          if (cancelled) return;
          if (!res.ok || data.ok !== true) {
            await applyFinalPoliteThankYouOrScanner({ ok: true, phase: "free", globalGuestUid: uid });
            return;
          }
          if (data.phase === "working") {
            await applyFinalPoliteThankYouOrScanner({ ok: true, phase: "free", globalGuestUid: uid });
            return;
          }
          await applyFinalPoliteThankYouOrScanner(data);
        } catch {
          if (cancelled) return;
          await applyFinalPoliteThankYouOrScanner({ ok: true, phase: "free", globalGuestUid: uid });
        }
      })();
    };

    unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setActiveSession(null);
          setParticipants([]);
          if (sawSessionDoc) {
            sawSessionDoc = false;
            finalizeAfterActiveSessionVanished();
          }
          return;
        }

        const picked = pickNewestFreshActiveSessionDoc(snap.docs);
        if (!picked) {
          setActiveSession(null);
          setParticipants([]);
          if (sawSessionDoc) {
            sawSessionDoc = false;
            finalizeAfterActiveSessionVanished();
          }
          return;
        }

        applySessionDoc(picked.id, (picked.data() ?? {}) as Record<string, unknown>);
      },
      (err) => {
        console.error("[guest] activeSessions listener failed (проверьте индексы Firestore и правила):", err);
      }
    );

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [
    isSdkReady,
    currentLocation.venueId,
    currentLocation.tableId,
    switchLocation,
    tableListenerEpoch,
    applyFinalPoliteThankYouOrScanner,
  ]);

  // Live orders data for the table.
  useEffect(() => {
    if (postServiceVisit) {
      setCurrentTableOrders([]);
      return;
    }
    if (!isSdkReady || !currentLocation.venueId || !currentLocation.tableId) return;

    const venueId = currentLocation.venueId;
    const tableId = currentLocation.tableId;
    const sessionId = activeSession?.id?.trim() ?? "";
    let cancelled = false;

    let rootOrders: GuestTableOrder[] = [];

    rootOrdersLoadedRef.current = false;

    const parseOrdersSnap = (snap: any): GuestTableOrder[] => {
      return snap.docs.map((d: any) => parseGuestTableOrder(d.id, d.data() as Record<string, unknown>));
    };
    const applyOrdersSnap = (snap: any) => {
      rootOrders = parseOrdersSnap(snap);
      rootOrdersLoadedRef.current = true;
      setCurrentTableOrders(rootOrders);
    };

    // Холодный старт заказов: один снимок по sessionId до live-listener.
    if (sessionId) {
      void (async () => {
        try {
          const qBoot = query(
            collection(db, "orders"),
            where("sessionId", "==", sessionId),
            where("status", "in", ["pending", "ready"]),
            limit(200)
          );
          const bootSnap = await getDocs(qBoot);
          if (cancelled || rootOrdersLoadedRef.current) return;
          applyOrdersSnap(bootSnap);
        } catch {
          // best-effort: fallback остаётся за onSnapshot по столу
        }
      })();
    }

    // Root orders (current schema in this repo)
    const qRoot = query(
      collection(db, "orders"),
      where("venueId", "==", venueId),
      where("tableId", "==", tableId),
      where("status", "in", ["pending", "ready"])
    );
    const unsubRoot = onSnapshot(qRoot, (snap) => {
      applyOrdersSnap(snap);
    });

    return () => {
      cancelled = true;
      unsubRoot();
    };
  }, [isSdkReady, currentLocation.venueId, currentLocation.tableId, activeSession?.id, postServiceVisit]);

  useEffect(() => {
    if (!isSdkReady || isInitializing || !guestIdentity.currentUid) return;
    void refreshVisitHistory();
  }, [isSdkReady, isInitializing, guestIdentity.currentUid, refreshVisitHistory]);

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
    if (inTg && tg?.showScanQrPopup) {
      tg.showScanQrPopup({ text: "Наведите на QR стола" }, (qrText) => {
        void (async () => {
          const raw = String(qrText ?? "").trim();
          if (!raw) {
            toast.error("Неверный QR");
            return;
          }

          const resolved = await resolveGuestTableFromQrText(raw, db);
          if (!resolved?.venueId?.trim()) {
            toast.error("Неверный QR");
            return;
          }
          const venueId = resolved.venueId.trim();
          const tableId = (resolved.tableId || "").trim();
          if (!tableId) {
            toast.error("В QR не указан стол");
            return;
          }

          const entered = await processEntry(venueId, tableId, {
            forceTableListenerResubscribe: true,
          });
          if (entered) urlCheckInGateKeyRef.current = `${venueId}|${tableId}`;
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
    router.push("/");
  }, [router, processEntry]);

  const callWaiter = useCallback(async () => {
      if (isGuestBlocked) {
        toast.error(guestBlockedReason ?? "Гостевой режим заблокирован");
        return;
      }

      const snap = serviceHandshakeRef.current;
      const venueId = snap.venueId?.trim();
      const tableId = snap.tableId?.trim();
      if (!venueId || !tableId) {
        toast.error("Стол не определен");
        return;
      }

      try {
        const res = await fetch("/api/call-waiter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            venueId,
            tableId,
            customerUid: globalGuestUid?.trim() || guestProfileUid?.trim() || undefined,
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
    [guestBlockedReason, isGuestBlocked, globalGuestUid, guestProfileUid]
  );

  const setTablePrivacyAllowJoin = useCallback(
    async (allowJoin: boolean) => {
      const v = currentLocation.venueId?.trim();
      const t = currentLocation.tableId?.trim();
      const uid = globalGuestUid?.trim() || guestProfileUid?.trim();
      if (!v || !t || !uid) {
        return { ok: false, error: "Не удалось определить стол или гостя" };
      }
      try {
        const res = await fetch("/api/session/privacy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ venueId: v, tableId: t, actorUid: uid, allowJoin }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || data.ok === false) {
          toast.error(typeof data.error === "string" ? data.error : "Не удалось изменить настройки стола");
          return { ok: false, error: typeof data.error === "string" ? data.error : "Ошибка" };
        }
        toast.success(allowJoin ? "Подселение без кода разрешено" : "Стол закрыт для подселения");
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Ошибка сети";
        toast.error(msg);
        return { ok: false, error: msg };
      }
    },
    [currentLocation.venueId, currentLocation.tableId, globalGuestUid, guestProfileUid]
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
      const uid = globalGuestUid?.trim() || guestProfileUid?.trim();
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
    [globalGuestUid, guestProfileUid, guestBlockedReason, isGuestBlocked]
  );

  const guestAwaitingTableFeedback = useMemo(() => Boolean(postServiceVisit), [postServiceVisit]);

  const feedbackTargetStaffId = useMemo(() => {
    if (!postServiceVisit) return null;
    return postServiceVisit.feedbackStaffId?.trim() || assignedStaffId?.trim() || null;
  }, [postServiceVisit, assignedStaffId]);

  const completeTableFeedbackSession = useCallback(async () => {
    if (typeof window === "undefined") return;
    setPostServiceVisit(null);
    setShowLandingScanner(true);
    const tg = getTelegramWebApp();
    const init = typeof tg?.initData === "string" ? tg.initData.trim() : "";
    if (init) {
      try {
        await fetch("/api/guest/feedback-session-done", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData: init }),
        });
      } catch {
        // best-effort
      }
    }
    await switchLocation(null, null);
  }, [switchLocation]);

  const value = useMemo<GuestMiniAppContextValue>(
    () => ({
      guestIdentity,
      globalGuestUid,
      guestProfileUid,
      currentLocation,
      visitHistory,
      activeSession,
      participants,
      currentTableOrders,
      systemConfig,
      isInitializing,
      isGuestBlocked,
      guestBlockedReason,
      assignedStaffId,
      assignedStaffDisplayName,
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
      setTablePrivacyAllowJoin,
      guestAwaitingTableFeedback,
      postServiceVisit,
      completeTableFeedbackSession,
      feedbackTargetStaffId,
      showLandingScanner,
    }),
    [
      guestIdentity,
      globalGuestUid,
      guestProfileUid,
      currentLocation,
      visitHistory,
      activeSession,
      postServiceVisit,
      participants,
      currentTableOrders,
      systemConfig,
      isInitializing,
      isGuestBlocked,
      guestBlockedReason,
      assignedStaffId,
      assignedStaffDisplayName,
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
      setTablePrivacyAllowJoin,
      guestAwaitingTableFeedback,
      completeTableFeedbackSession,
      feedbackTargetStaffId,
      showLandingScanner,
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
