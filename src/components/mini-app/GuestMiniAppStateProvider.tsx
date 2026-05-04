"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  mergePreOrderSystemFields,
  resolvePreOrderEnabled,
  readVenueSotaId,
  resolvePreorderMaxCartItems,
  resolvePreorderSubmissionGate,
} from "@/lib/pre-order";
import { readVenueTimezone } from "@/lib/venue-timezone";
import type { PreorderModuleConfig } from "@/lib/system-configs/preorder-module-config";
import type { VenueMenuVenueBlock } from "@/lib/system-configs/venue-menu-config";
import toast from "react-hot-toast";
import { parseStartParamPayload } from "@/lib/parse-start-param";
import { parseSotaStartappPayload } from "@/lib/sota-id";
import { useSotaLocation } from "@/components/providers/SotaLocationProvider";
import { getTelegramUserIdFromWebApp } from "@/lib/telegram-webapp-user";
import { DEFAULT_GLOBAL_GEO_RADIUS_LIMIT_METERS } from "@/lib/geo";
import { guestSessionClear } from "@/lib/guest-session-bridge";
import { resolveWaiterStaffIdFromSessionDoc } from "@/lib/active-session-waiter";
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

type GuestTableOrder = {
  id: string;
  orderNumber: number;
  status: OrderStatus | string;
  customerUid?: string;
  items: Array<{ name: string; qty: number; unitPrice: number; totalAmount: number }>;
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

function mergeServerSystemConfig(raw: unknown): SotaSystemConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SYSTEM_CONFIG };
  const r = raw as Record<string, unknown>;
  const preOrderFields = mergePreOrderSystemFields(r);
  return {
    ...DEFAULT_SYSTEM_CONFIG,
    ...r,
    ...preOrderFields,
    adsNetworkEnabled:
      typeof r.adsNetworkEnabled === "boolean" ? r.adsNetworkEnabled : DEFAULT_SYSTEM_CONFIG.adsNetworkEnabled,
    geoRadiusLimit:
      typeof r.geoRadiusLimit === "number" && Number.isFinite(r.geoRadiusLimit)
        ? r.geoRadiusLimit
        : DEFAULT_SYSTEM_CONFIG.geoRadiusLimit,
    globalMaintenanceMode:
      typeof r.globalMaintenanceMode === "boolean"
        ? r.globalMaintenanceMode
        : DEFAULT_SYSTEM_CONFIG.globalMaintenanceMode,
  };
}

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

/** Стол из Telegram Mini App: initDataUnsafe.start_param (часто без v/t в location.search). */
function readVenueTableFromTelegramWebAppStartParam(): { venueId: string; tableId: string } | null {
  if (typeof window === "undefined") return null;
  const sp = String(
    (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { start_param?: unknown } } } })
      .Telegram?.WebApp?.initDataUnsafe?.start_param ?? ""
  ).trim();
  if (!sp) return null;
  const parsed = parseStartParamPayload(sp);
  if (parsed?.venueId?.trim() && parsed?.tableId?.trim()) {
    return { venueId: parsed.venueId.trim(), tableId: parsed.tableId.trim() };
  }
  return null;
}

function readVenueTableFromUrlRuntime(searchParams: {
  get: (key: string) => string | null;
}): { venueId: string; tableId: string } | null {
  const direct = readVenueTableFromSearchParams(searchParams);
  if (direct) return direct;
  if (typeof window === "undefined") return null;

  const fromQuery = (qs: URLSearchParams): { venueId: string; tableId: string } | null => {
    const venueId = (qs.get("v") ?? qs.get("venueId") ?? "").trim();
    const tableId = (qs.get("t") ?? qs.get("tableId") ?? "").trim();
    if (!venueId || !tableId) return null;
    return { venueId, tableId };
  };

  const fromWindowQuery = fromQuery(new URLSearchParams(window.location.search));
  if (fromWindowQuery) return fromWindowQuery;

  const hash = window.location.hash ?? "";
  const hashQueryRaw = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  if (hashQueryRaw) {
    const fromHash = fromQuery(new URLSearchParams(hashQueryRaw));
    if (fromHash) return fromHash;
  }

  const tgStartApp = new URLSearchParams(window.location.search).get("tgWebAppStartParam")?.trim() ?? "";
  if (tgStartApp) {
    const parsed = parseStartParamPayload(tgStartApp);
    if (parsed?.venueId?.trim() && parsed?.tableId?.trim()) {
      return { venueId: parsed.venueId.trim(), tableId: parsed.tableId.trim() };
    }
  }

  const fromTgUnsafeRuntime = readVenueTableFromTelegramWebAppStartParam();
  if (fromTgUnsafeRuntime) return fromTgUnsafeRuntime;

  return null;
}

/**
 * Только window.location / hash / tgWebAppStartParam / initDataUnsafe.start_param — без useSearchParams.
 * Для «прямого пуска» check-in сразу после открытия Mini-App.
 */
function readVenueTableFromWindowOnly(): { venueId: string; tableId: string } | null {
  if (typeof window === "undefined") return null;

  const fromQuery = (qs: URLSearchParams): { venueId: string; tableId: string } | null => {
    const venueId = (qs.get("v") ?? qs.get("venueId") ?? "").trim();
    const tableId = (qs.get("t") ?? qs.get("tableId") ?? "").trim();
    if (!venueId || !tableId) return null;
    return { venueId, tableId };
  };

  const fromWindowQuery = fromQuery(new URLSearchParams(window.location.search));
  if (fromWindowQuery) return fromWindowQuery;

  const hash = window.location.hash ?? "";
  const hashQueryRaw = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  if (hashQueryRaw) {
    const fromHash = fromQuery(new URLSearchParams(hashQueryRaw));
    if (fromHash) return fromHash;
  }

  const tgStartApp = new URLSearchParams(window.location.search).get("tgWebAppStartParam")?.trim() ?? "";
  if (tgStartApp) {
    const parsed = parseStartParamPayload(tgStartApp);
    if (parsed?.venueId?.trim() && parsed?.tableId?.trim()) {
      return { venueId: parsed.venueId.trim(), tableId: parsed.tableId.trim() };
    }
  }

  const fromTgUnsafe = readVenueTableFromTelegramWebAppStartParam();
  if (fromTgUnsafe) return fromTgUnsafe;

  return null;
}

type GuestMiniAppContextValue = {
  /** Канал (SDK): только отображение и initData, не id сессии. */
  guestChannel: { sotaId: string | null; telegramUid: string | null };
  /** Единственный id документа global_users. */
  canonicalGuestUid: string | null;
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
  openVenueMenu: (venueId: string) => void;
  refreshVisitHistory: () => Promise<void>;
  /** Опрос сервера: /api/get-current-status (команда для UI). */
  refreshGuestStatus: () => Promise<void>;
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
  /** swid для чаевых в фазе отзыва: с серверной команды FEEDBACK (act2). */
  feedbackTargetStaffId: string | null;
  /** Разрешён ли fallback-экран со сканером после server-bootstrap. */
  showLandingScanner: boolean;
};

const GuestMiniAppContext = createContext<GuestMiniAppContextValue | null>(null);

export function GuestMiniAppStateProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const { checkGuestQrVenueAccess } = useSotaLocation();

  const urlTableFromParams = useMemo(
    () => readVenueTableFromUrlRuntime(searchParams),
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
  /** В Telegram ждём user id из WebApp (или таймаут опроса) — только для UX, не для id сессии. */
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
  const postServiceVisitRef = useRef<PostServiceVisitState | null>(null);
  useEffect(() => {
    postServiceVisitRef.current = postServiceVisit;
  }, [postServiceVisit]);
  /** После команды сервера со столом: не даём bootstrap сбросить стол в «сканер». */
  const guestAppServerRestoreRef = useRef(false);
  /** Единственный id global_users (только с сервера / ответа check-in). */
  const [canonicalGuestUid, setCanonicalGuestUid] = useState<string | null>(null);
  /** В Telegram — после первого get-current-status; вне TG — сразу. */
  const [guestUniversalStatusGateOpen, setGuestUniversalStatusGateOpen] = useState(false);
  const canonicalGuestUidRef = useRef<string | null>(null);
  useEffect(() => {
    canonicalGuestUidRef.current = canonicalGuestUid;
  }, [canonicalGuestUid]);
  const fetchAndApplyGuestStatusRef = useRef<() => Promise<void>>(async () => {
    /* заполняется после объявления fetchAndApplyGuestStatus */
  });
  /** Актуальные id на момент клика — для запросов без гонок со снимком замыкания. */
  const serviceHandshakeRef = useRef<{
    venueId: string | null;
    tableId: string | null;
    assignedStaffId: string | null;
  }>({ venueId: null, tableId: null, assignedStaffId: null });
  const attachmentMenuInitRef = useRef(false);
  /** Успешный check-in для пары venue|table — чтобы основной bootstrap не вызывал processEntry повторно. */
  const tableDirectCheckInSucceededKeyRef = useRef<string | null>(null);
  const tableDirectLaunchInFlightRef = useRef(false);
  const processEntryRef = useRef<(venueId: string, tableId: string) => Promise<boolean>>(async () => false);
  const guestChannel = useMemo(() => {
    const webApp = getTelegramWebApp();
    const startParam = webApp?.initDataUnsafe?.start_param?.trim() ?? "";
    const sota = startParam ? parseSotaStartappPayload(startParam) : null;
    return {
      sotaId: sota?.venueSotaId ?? null,
      telegramUid,
    };
  }, [telegramUid]);

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
    /** Ожидание user id из Telegram WebApp — без setInterval. */
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
    },
    []
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

  // Optional Telegram UX: try pinning app in attachment menu without storage dependencies.
  useEffect(() => {
    if (!isSdkReady || typeof window === "undefined") return;
    if (attachmentMenuInitRef.current) return;
    const tg = getTelegramWebApp();
    const inTg = isTelegramContext();
    if (!tg || !inTg || typeof tg.addToAttachmentMenu !== "function") return;
    attachmentMenuInitRef.current = true;
    Promise.resolve(tg.addToAttachmentMenu()).catch(() => {
      // optional API; ignore unsupported clients
    });
  }, [isSdkReady]);

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
      guestAppServerRestoreRef.current = false;
      setPostServiceVisit(null);
      setShowLandingScanner(false);
      await switchLocation(data.venueId.trim(), data.tableId.trim());
      if (typeof data.onboardingHint === "string" && data.onboardingHint.trim()) {
        toast(data.onboardingHint.trim(), { icon: "📌" });
      }
    },
    [switchLocation]
  );

  const switchToFeedbackVisit = useCallback(
    async (visit: PostServiceVisitState) => {
      setShowLandingScanner(false);
      await switchLocation(null, null, { preservePostServiceVisit: true });
      setPostServiceVisit(visit);
    },
    [switchLocation]
  );

  const switchToScanQrScreen = useCallback(async () => {
    guestAppServerRestoreRef.current = false;
    setPostServiceVisit(null);
    setShowLandingScanner(true);
    await switchLocation(null, null);
  }, [switchLocation]);

  type GuestCurrentStatusPayload = {
    ok?: boolean;
    recognized?: boolean;
    staffProfile?: boolean;
    status?: "WORKING" | "FEEDBACK" | "WELCOME";
    globalUserFirestoreId?: string | null;
    act1?: { venueId: string; tableId: string; sessionId: string };
    act2?: {
      visitId: string;
      feedbackActSessionId: string;
      venueId: string;
      tableId: string;
      tableNumber: number;
      feedbackStaffId: string | null;
    };
    systemConfig?: unknown;
    preorderModuleConfig?: PreorderModuleConfig;
    activeSession?: ActiveSession | null;
    tableOrders?: GuestTableOrder[];
    venueDoc?: Record<string, unknown> | null;
    venueMenuShowcase?: VenueMenuVenueBlock | null;
    assignedStaffDisplayName?: string | null;
    visitHistory?: GuestVisitEntry[];
  };

  const pullGuestCommandPayload = useCallback(async (): Promise<GuestCurrentStatusPayload | null> => {
    if (typeof window === "undefined") return null;
    const tg = getTelegramWebApp();
    if (!tg || !isTelegramContext()) return null;
    const initData = typeof tg.initData === "string" ? tg.initData.trim() : "";
    if (!initData) return null;
    const res = await fetch("/api/get-current-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "telegram",
        credentials: { initData },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as GuestCurrentStatusPayload;
    if (!res.ok || !data.ok) return null;
    return data;
  }, []);

  const applyGuestCommandPayload = useCallback(
    async (data: GuestCurrentStatusPayload) => {
      if (data.systemConfig !== undefined) {
        setSystemConfig(mergeServerSystemConfig(data.systemConfig));
      }
      if (data.preorderModuleConfig !== undefined) {
        setPreorderModuleConfig(data.preorderModuleConfig ?? {});
      }

      if (Array.isArray(data.visitHistory)) {
        setVisitHistory(
          data.visitHistory
            .map((row) => {
              const venueId = typeof row?.venueId === "string" ? row.venueId.trim() : "";
              if (!venueId) return null;
              return {
                venueId,
                lastVisitAt: row.lastVisitAt,
                totalVisits: typeof row.totalVisits === "number" ? row.totalVisits : undefined,
              } satisfies GuestVisitEntry;
            })
            .filter(Boolean) as GuestVisitEntry[]
        );
      }

      if (data.staffProfile) return;

      const gid = typeof data.globalUserFirestoreId === "string" ? data.globalUserFirestoreId.trim() : "";
      if (data.recognized && gid) {
        setCanonicalGuestUid(gid);
      } else {
        setCanonicalGuestUid(null);
      }

      if (data.recognized && data.status === "WORKING" && data.act1?.venueId && data.act1?.tableId) {
        guestAppServerRestoreRef.current = true;
        const v = data.act1.venueId.trim();
        const t = data.act1.tableId.trim();
        const prev = currentLocationRef.current;
        const sameTable = prev.venueId?.trim() === v && prev.tableId?.trim() === t;
        setPostServiceVisit(null);
        setShowLandingScanner(false);
        if (!sameTable) {
          await switchLocation(v, t);
        }
        const sess = data.activeSession ?? null;
        setActiveSession(sess);
        setParticipants(sess?.participants ?? []);
        setCurrentTableOrders(Array.isArray(data.tableOrders) ? data.tableOrders : []);
        if (data.venueDoc && typeof data.venueDoc === "object") {
          setVenueDocById((p) => ({ ...p, [v]: { ...data.venueDoc } as Record<string, unknown> }));
        }
        setGuestVenueMenuShowcaseByVenueId((p) => ({
          ...p,
          [v]: data.venueMenuShowcase ?? null,
        }));
        const docForWaiter = sess ? ({ ...sess } as unknown as Record<string, unknown>) : {};
        const sw =
          (sess ? resolveWaiterStaffIdFromSessionDoc(docForWaiter) : null)?.trim() ||
          sess?.assignedStaffId?.trim() ||
          null;
        setAssignedStaffId(sw);
        setAssignedStaffDisplayName(
          typeof data.assignedStaffDisplayName === "string" ? data.assignedStaffDisplayName : null
        );
        return;
      }

      if (
        data.recognized &&
        data.status === "FEEDBACK" &&
        data.act2?.visitId &&
        data.act2.venueId &&
        data.act2.tableId
      ) {
        guestAppServerRestoreRef.current = true;
        setActiveSession(null);
        setParticipants([]);
        setCurrentTableOrders([]);
        const a = data.act2;
        await switchToFeedbackVisit({
          visitId: a.visitId,
          feedbackActSessionId: a.feedbackActSessionId,
          venueId: a.venueId,
          tableId: a.tableId,
          tableNumber: typeof a.tableNumber === "number" ? a.tableNumber : 0,
          feedbackStaffId:
            typeof a.feedbackStaffId === "string" && a.feedbackStaffId.trim()
              ? a.feedbackStaffId.trim()
              : null,
        });
        const fsid =
          typeof a.feedbackStaffId === "string" && a.feedbackStaffId.trim() ? a.feedbackStaffId.trim() : null;
        setAssignedStaffId(fsid);
        setAssignedStaffDisplayName(
          typeof data.assignedStaffDisplayName === "string" ? data.assignedStaffDisplayName : null
        );
        return;
      }

      guestAppServerRestoreRef.current = false;
      setPostServiceVisit(null);
      setShowLandingScanner(true);
      setActiveSession(null);
      setParticipants([]);
      setCurrentTableOrders([]);
      setAssignedStaffId(null);
      setAssignedStaffDisplayName(null);
      await switchLocation(null, null);
    },
    [switchLocation, switchToFeedbackVisit]
  );

  /** Единственный источник команд UI: POST /api/get-current-status (алиас /api/get-current-status). */
  const fetchAndApplyGuestStatus = useCallback(async () => {
    const data = await pullGuestCommandPayload();
    if (!data) return;
    await applyGuestCommandPayload(data);
  }, [pullGuestCommandPayload, applyGuestCommandPayload]);

  const refreshGuestStatus = useCallback(async () => {
    await fetchAndApplyGuestStatus();
  }, [fetchAndApplyGuestStatus]);

  /** @deprecated Используйте refreshGuestStatus; оставлено для совместимости API контекста. */
  const refreshVisitHistory = refreshGuestStatus;

  /**
   * Холодный старт: один запрос статуса до bootstrap (WORKING → стол, FEEDBACK → звёзды, WELCOME → сканер).
   */
  useEffect(() => {
    if (!isSdkReady || typeof window === "undefined") return;
    const tg = getTelegramWebApp();
    if (!tg || !isTelegramContext()) {
      setGuestUniversalStatusGateOpen(true);
      return;
    }
    const initData = typeof tg.initData === "string" ? tg.initData.trim() : "";
    if (!initData) {
      setGuestUniversalStatusGateOpen(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await fetchAndApplyGuestStatus();
      } catch {
        /* сеть */
      } finally {
        if (!cancelled) setGuestUniversalStatusGateOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSdkReady, fetchAndApplyGuestStatus]);

  /** Опрос сервера каждые ~4 с + при возврате на вкладку. */
  useEffect(() => {
    if (!isSdkReady || typeof window === "undefined") return;
    if (!isTelegramContext()) return;
    const id = window.setInterval(() => {
      void fetchAndApplyGuestStatus();
    }, 4000);
    const onVis = () => {
      if (document.visibilityState === "visible") void fetchAndApplyGuestStatus();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [isSdkReady, fetchAndApplyGuestStatus]);

  const waitForActiveSessionConfirmation = useCallback(
    async (venueId: string, tableId: string, timeoutMs = 12000): Promise<boolean> => {
      const v = String(venueId ?? "").trim();
      const t = String(tableId ?? "").trim();
      if (!v || !t) return false;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const data = await pullGuestCommandPayload();
        if (
          data &&
          !data.staffProfile &&
          data.recognized &&
          data.status === "WORKING" &&
          data.act1?.venueId?.trim() === v &&
          data.act1?.tableId?.trim() === t &&
          data.activeSession
        ) {
          await applyGuestCommandPayload(data);
          return true;
        }
        await new Promise<void>((r) => setTimeout(r, 400));
      }
      return false;
    },
    [pullGuestCommandPayload, applyGuestCommandPayload]
  );

  const resolveCheckInFailureMessage = useCallback((status: string | undefined, apiMessage?: string): string => {
    if (typeof apiMessage === "string" && apiMessage.trim()) return apiMessage.trim();
    if (status === "table_private") return "Стол занят другим гостем. Подселение запрещено хозяином.";
    if (status === "table_conflict") return "Стол занят или забронирован. Отсканируйте другой QR.";
    if (status === "guest_already_seated_elsewhere") {
      return "У вас есть открытый заказ за другим столом. Завершите его, затем отсканируйте новый QR.";
    }
    if (status === "check_in_timeout") {
      return "Сервер не успел ответить. Повторите сканирование QR.";
    }
    return "Сессия недоступна. Отсканируйте QR стола снова.";
  }, []);

  /** Диктатура сервера: check-in уходит сразу; геозона догоняет параллельно. */
  const processEntry = useCallback(
    async (venueId: string, tableId: string): Promise<boolean> => {
      const v = venueId.trim();
      const t = tableId.trim();
      if (!v || !t) return false;

      setShowLandingScanner(false);
      await switchLocation(null, null);

      const geoPromise = checkGuestQrVenueAccess(v);

      try {
        const controller = new AbortController();
        const abortTimer = window.setTimeout(() => controller.abort(), 35_000);
        let res: Response;
        try {
          res = await fetch("/api/check-in", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              venueId: v,
              tableId: t,
              globalGuestUid: canonicalGuestUidRef.current?.trim() || undefined,
            }),
            signal: controller.signal,
          });
        } finally {
          window.clearTimeout(abortTimer);
        }
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          mode?: "table" | "scanner";
          venueId?: string;
          tableId?: string;
          tableNumber?: number;
          onboardingHint?: string | null;
          messageGuest?: string;
          sessionStatus?: string;
          globalGuestUid?: string | null;
        };

        const access = await geoPromise;
        if (!access.ok) {
          toast.error(access.message);
          setShowLandingScanner(true);
          await switchLocation(null, null);
          return false;
        }

        if (!res.ok || data.ok === false) {
          setShowLandingScanner(true);
          await switchLocation(null, null);
          toast.error(resolveCheckInFailureMessage(data.sessionStatus, data.messageGuest));
          return false;
        }
        const respVenue = String(data.venueId ?? "").trim();
        const respTable = String(data.tableId ?? "").trim();
        if (res.ok && data.ok === true && data.mode === "table" && respVenue && respTable) {
          const gg = typeof data.globalGuestUid === "string" ? data.globalGuestUid.trim() : "";
          if (gg) setCanonicalGuestUid(gg);
          const confirmed = await waitForActiveSessionConfirmation(respVenue, respTable);
          if (!confirmed) {
            setShowLandingScanner(true);
            await switchLocation(null, null);
            toast.error("Сервер не подтвердил активную сессию. Отсканируйте QR повторно.");
            return false;
          }
          await applySuccessfulTableBootstrap({
            venueId: respVenue,
            tableId: respTable,
            onboardingHint: data.onboardingHint ?? null,
          });
          void refreshGuestStatus();
          if (data.sessionStatus === "guest_already_seated_elsewhere" && data.messageGuest?.trim()) {
            toast(data.messageGuest.trim());
          }
          return true;
        }

        setShowLandingScanner(true);
        await switchLocation(null, null);
        toast.error(resolveCheckInFailureMessage(data.sessionStatus, data.messageGuest));
        return false;
      } catch (e) {
        setShowLandingScanner(true);
        await switchLocation(null, null);
        const aborted = e instanceof Error && e.name === "AbortError";
        toast.error(aborted ? "Превышено время ожидания сервера. Повторите сканирование." : "Ошибка check-in. Повторите сканирование.");
        return false;
      }
    },
    [
      applySuccessfulTableBootstrap,
      checkGuestQrVenueAccess,
      resolveCheckInFailureMessage,
      switchLocation,
      waitForActiveSessionConfirmation,
      refreshGuestStatus,
    ]
  );

  processEntryRef.current = processEntry;

  /**
   * Прямой пуск: window.location + initDataUnsafe.start_param, без searchParams и без ожидания Telegram identity.
   * Короткий poll ловит позднюю подстановку URL в WebView.
   */
  const tryDirectWindowTableLaunch = useCallback(async () => {
    if (typeof window === "undefined") return;
    const tg = getTelegramWebApp();
    const recvGate = normalizeBotUsername(tg?.initDataUnsafe?.receiver?.username);
    const staffGate = normalizeBotUsername(process.env.NEXT_PUBLIC_STAFF_BOT_USERNAME);
    if (recvGate && staffGate && recvGate === staffGate) {
      setIsGuestBlocked(true);
      setGuestBlockedReason("Откройте гостевое приложение из меню бота заведения");
      setIsInitializing(false);
      return;
    }

    const entry = readVenueTableFromWindowOnly();
    if (!entry) return;

    const gateKey = `${entry.venueId.trim()}|${entry.tableId.trim()}`;
    if (tableDirectCheckInSucceededKeyRef.current === gateKey) return;
    if (tableDirectLaunchInFlightRef.current) return;

    tableDirectLaunchInFlightRef.current = true;
    try {
      const ok = await processEntryRef.current(entry.venueId, entry.tableId);
      if (ok) tableDirectCheckInSucceededKeyRef.current = gateKey;
    } finally {
      tableDirectLaunchInFlightRef.current = false;
      setIsInitializing(false);
    }
  }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    void tryDirectWindowTableLaunch();
  }, [tryDirectWindowTableLaunch]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const delays = [0, 50, 150, 400];
    const ids = delays.map((ms) =>
      window.setTimeout(() => {
        void tryDirectWindowTableLaunch();
      }, ms)
    );
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [tryDirectWindowTableLaunch]);

  // Единый bootstrap: при наличии v/t стартуем table flow сразу, без ожидания identity.
  useEffect(() => {
    if (!isSdkReady) return;
    if (!guestUniversalStatusGateOpen) return;
    const entryTableNow = readVenueTableFromUrlRuntime(searchParams);
    if (!entryTableNow && !bootstrapIdentityReady) return;
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
      const entryTable = readVenueTableFromUrlRuntime(searchParams);

      if (!entryTable) {
        if (guestAppServerRestoreRef.current) {
          if (!cancelled) setIsInitializing(false);
          return;
        }
        if (!cancelled) {
          await switchToScanQrScreen();
          await refreshGuestStatus();
        }
        if (!cancelled) setIsInitializing(false);
        return;
      }

      if (guestAppServerRestoreRef.current) {
        if (!cancelled) setIsInitializing(false);
        return;
      }

      const entryKey = `${entryTable.venueId.trim()}|${entryTable.tableId.trim()}`;
      if (tableDirectCheckInSucceededKeyRef.current === entryKey) {
        if (!cancelled) setIsInitializing(false);
        return;
      }

      try {
        const ok = await processEntry(entryTable.venueId, entryTable.tableId);
        if (ok) tableDirectCheckInSucceededKeyRef.current = entryKey;
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
    guestUniversalStatusGateOpen,
    bootstrapIdentityReady,
    searchParams,
    urlTableFromParams,
    switchLocation,
    refreshGuestStatus,
    processEntry,
    switchToScanQrScreen,
  ]);

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
            customerUid: canonicalGuestUid?.trim() || undefined,
            assignedStaffId: snap.assignedStaffId ?? undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || data.ok === false) throw new Error(data.error ?? "call-waiter failed");
        toast.success("Запрос отправлен персоналу");
        void refreshGuestStatus();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось отправить запрос");
      }
    },
    [guestBlockedReason, isGuestBlocked, canonicalGuestUid, refreshGuestStatus]
  );

  const setTablePrivacyAllowJoin = useCallback(
    async (allowJoin: boolean) => {
      const v = currentLocation.venueId?.trim();
      const t = currentLocation.tableId?.trim();
      const uid = canonicalGuestUid?.trim();
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
        void refreshGuestStatus();
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Ошибка сети";
        toast.error(msg);
        return { ok: false, error: msg };
      }
    },
    [currentLocation.venueId, currentLocation.tableId, canonicalGuestUid, refreshGuestStatus]
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
      const uid = canonicalGuestUid?.trim();
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
        void refreshGuestStatus();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось отправить запрос счета");
      }
    },
    [canonicalGuestUid, guestBlockedReason, isGuestBlocked, refreshGuestStatus]
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
    void refreshGuestStatus();
  }, [switchLocation, refreshGuestStatus]);

  const value = useMemo<GuestMiniAppContextValue>(
    () => ({
      guestChannel,
      canonicalGuestUid,
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
      openVenueMenu,
      refreshVisitHistory,
      refreshGuestStatus,
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
      guestChannel,
      canonicalGuestUid,
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
      openVenueMenu,
      refreshVisitHistory,
      refreshGuestStatus,
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
