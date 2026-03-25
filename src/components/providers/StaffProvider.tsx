"use client";

/**
 * StaffProvider — централизованное состояние сотрудника (Unified ID V.2.0).
 * Хранит текущее заведение, данные из /api/staff/me и список заведений из /api/staff/venues.
 * Восстановление currentVenueId из sessionStorage; при v=... — загрузка списка и выбор.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DEFAULT_VENUE_ID } from "@/lib/standards/venue-default";

const STAFF_VENUE_SESSION_KEY = "heywaiter_staff_venue_id";

/** Кэш последнего Telegram user id (платформенный id) для Mini App staff, когда initDataUnsafe ещё пустой. */
export const HEYWAITER_STAFF_LS_TG_PLATFORM_ID = "heywaiter_staff_tg_platform_id";
/** Кэш SOTA-ID сотрудника — якорь входа, если Telegram временно не отдаёт initData. */
export const HEYWAITER_STAFF_LS_SOTA_ID = "heywaiter_staff_sota_id";

function platformKeyFromUrl(raw: string | null): string | null {
  const v = raw?.trim().toLowerCase();
  if (!v) return null;
  switch (v) {
    case "tg":
    case "telegram":
      return "tg";
    case "wa":
    case "whatsapp":
      return "wa";
    case "vk":
    case "vkontakte":
      return "vk";
    case "viber":
      return "viber";
    case "wechat":
      return "wechat";
    case "inst":
    case "instagram":
      return "inst";
    case "fb":
    case "facebook":
      return "fb";
    case "line":
      return "line";
    default:
      return v;
  }
}

function parseTelegramUserIdFromInitData(initData: string): string | null {
  const raw = initData.trim();
  if (!raw) return null;
  try {
    const params = new URLSearchParams(raw);
    const userJson = params.get("user");
    if (!userJson) return null;
    const u = JSON.parse(userJson) as { id?: number | string };
    if (u?.id != null) return String(u.id);
  } catch {
    // ignore
  }
  return null;
}

function getTelegramUserId(): string | null {
  if (typeof window === "undefined") return null;
  const tg = (window as unknown as {
    Telegram?: { WebApp?: { initData?: string; initDataUnsafe?: { user?: { id?: number } } } };
  }).Telegram?.WebApp;
  if (!tg) return null;
  const unsafeId = tg.initDataUnsafe?.user?.id;
  if (unsafeId != null) return String(unsafeId);
  const initData = typeof tg.initData === "string" ? tg.initData.trim() : "";
  return parseTelegramUserIdFromInitData(initData);
}

function readStaffLocalStorage(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const v = localStorage.getItem(key);
    return v?.trim() || null;
  } catch {
    return null;
  }
}

function persistStaffAnchors(platformId: string | null, sotaId: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (platformId?.trim()) localStorage.setItem(HEYWAITER_STAFF_LS_TG_PLATFORM_ID, platformId.trim());
    if (sotaId?.trim()) localStorage.setItem(HEYWAITER_STAFF_LS_SOTA_ID, sotaId.trim());
  } catch {
    // ignore
  }
}

function getPlatformIdentity(): {
  platformKey: string;
  platformId: string | null;
  sotaAnchor: string | null;
} {
  if (typeof window === "undefined") {
    return { platformKey: "tg", platformId: null, sotaAnchor: null };
  }
  const telegramId = getTelegramUserId();
  const cachedTg = readStaffLocalStorage(HEYWAITER_STAFF_LS_TG_PLATFORM_ID);
  const sotaAnchor = readStaffLocalStorage(HEYWAITER_STAFF_LS_SOTA_ID);

  const params = new URLSearchParams(window.location.search);
  const urlPlatformKey = platformKeyFromUrl(params.get("platform") ?? params.get("channel")) ?? null;
  const urlPlatformId = params.get("platformId") ?? params.get("chatId") ?? params.get("telegramId");

  const platformKey = urlPlatformKey ?? "tg";
  const platformId = (urlPlatformId ?? telegramId ?? cachedTg ?? null)?.trim() || null;

  return { platformKey, platformId, sotaAnchor };
}

function getStaffVenueFromSession(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return sessionStorage.getItem(STAFF_VENUE_SESSION_KEY);
  } catch {
    return null;
  }
}

function setStaffVenueInSession(venueId: string): void {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(STAFF_VENUE_SESSION_KEY, venueId);
    }
  } catch (_) {}
}

export interface StaffData {
  userId: string | null;
  staffId: string | null;
  onShift: boolean;
  sotaId: string | null;
}

export interface VenueOption {
  venueId: string;
  name: string;
}

export interface StaffContextValue {
  currentVenueId: string | null;
  staffData: StaffData;
  venuesList: VenueOption[];
  /** @deprecated Используйте isInitialLoading; для совместимости = isInitialLoading */
  loading: boolean;
  /** Первая загрузка при входе — блокирует полноэкранный лоадер */
  isInitialLoading: boolean;
  error: string | null;
  setCurrentVenue: (venueId: string) => void;
  refreshStaffData: () => void;
}

const defaultStaffData: StaffData = {
  userId: null,
  staffId: null,
  onShift: false,
  sotaId: null,
};

const StaffContext = createContext<StaffContextValue>({
  currentVenueId: null,
  staffData: defaultStaffData,
  venuesList: [],
  loading: true,
  isInitialLoading: true,
  error: null,
  setCurrentVenue: () => {},
  refreshStaffData: () => {},
});

export function useStaff(): StaffContextValue {
  const ctx = useContext(StaffContext);
  if (!ctx) {
    throw new Error("useStaff must be used within StaffProvider");
  }
  return ctx;
}

interface StaffProviderProps {
  children: ReactNode;
  /** Значение v из URL (mini-app/staff?v=...). По умолчанию venue_andrey_alt. */
  initialVenueFromUrl?: string | null;
}

export function StaffProvider({ children, initialVenueFromUrl = null }: StaffProviderProps) {
  const [currentVenueId, setCurrentVenueIdState] = useState<string | null>(null);
  const [staffData, setStaffData] = useState<StaffData>(defaultStaffData);
  const [venuesList, setVenuesList] = useState<VenueOption[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const venuesFetched = useRef(false);

  const fetchVenues = useCallback(async (): Promise<VenueOption[]> => {
    const { platformKey, platformId } = getPlatformIdentity();
    // /api/staff/venues сейчас завязан на identities.tg.
    // Для не-TG каналов возвращаем пустой список, но дальше всё равно делаем fetchMe с универсальными данными.
    if (platformKey !== "tg" || !platformId) return [];
    const res = await fetch(`/api/staff/venues?telegramId=${encodeURIComponent(platformId)}`);
    const data = await res.json().catch(() => ({}));
    return (data.venues ?? []) as VenueOption[];
  }, []);

  const fetchMe = useCallback(async (venueId: string): Promise<StaffData | null> => {
    const { platformKey, platformId, sotaAnchor } = getPlatformIdentity();
    if (!platformId && !sotaAnchor) return null;

    const qs = new URLSearchParams();
    qs.set("venueId", venueId);
    qs.set("channel", platformKey);
    if (platformId) {
      qs.set("platformId", platformId);
      if (platformKey === "tg") qs.set("telegramId", platformId);
    }
    if (!platformId && sotaAnchor) qs.set("sotaId", sotaAnchor);

    const res = await fetch(`/api/staff/me?${qs.toString()}`);
    let data: any;
    try {
      data = await res.json();
    } catch {
      setError("Некорректный ответ сервера");
      return null;
    }
    if (!res.ok) {
      setError(data?.error || "Не удалось загрузить данные");
      return null;
    }
    setError(null);
    const sotaId = typeof data?.sotaId === "string" && data.sotaId.trim() ? data.sotaId.trim() : null;
    const next: StaffData = {
      userId: data?.userId ?? null,
      staffId: data?.staffId ?? null,
      onShift: data.onShift === true,
      sotaId,
    };
    setStaffData(next);
    const identAfter = getPlatformIdentity();
    persistStaffAnchors(identAfter.platformId, sotaId);
    return next;
  }, []);

  const refreshStaffData = useCallback(() => {
    const vid = currentVenueId;
    if (!vid) return;
    void fetchMe(vid);
  }, [currentVenueId, fetchMe]);

  const setCurrentVenue = useCallback(
    (venueId: string) => {
      setStaffVenueInSession(venueId);
      setCurrentVenueIdState(venueId);
      void fetchMe(venueId);
    },
    [fetchMe]
  );

  // Инициализация: загрузка venues, затем выбор заведения и fetchMe
  useEffect(() => {
    const { platformId, sotaAnchor } = getPlatformIdentity();
    if (!platformId && !sotaAnchor) {
      setError("Откройте приложение из нужного мессенджера");
      setIsInitialLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      if (!venuesFetched.current) {
        const list = await fetchVenues();
        if (cancelled) return;
        venuesFetched.current = true;
        setVenuesList(list);

        // Для синхронизации смены с админкой всегда выбираем DEFAULT_VENUE_ID,
        // чтобы UI не зависел от currentVenueId/сессионного выбора.
        const preferredVenueId = DEFAULT_VENUE_ID;
        const urlVenue = (initialVenueFromUrl ?? "").trim();
        let chosen: string | null = null;

        if (list.some((v) => v.venueId === preferredVenueId)) {
          chosen = preferredVenueId;
        } else if (urlVenue && list.some((v) => v.venueId === urlVenue)) {
          chosen = urlVenue;
        } else {
          const fromSession = getStaffVenueFromSession();
          if (fromSession && list.some((v) => v.venueId === fromSession)) {
            chosen = fromSession;
          } else if (list.length === 1) {
            chosen = list[0].venueId;
            setStaffVenueInSession(chosen);
          }
        }

        // Если заведений в списке нет, но Telegram ID есть, всё равно пытаемся загрузить staff/me
        // для диагностики (и показа "ID не найден в SaaS" при отсутствии глобального профиля).
        const venueToUse = chosen ?? preferredVenueId;
        setStaffVenueInSession(venueToUse);
        setCurrentVenueIdState(venueToUse);
        await fetchMe(venueToUse);
      }
      if (!cancelled) setIsInitialLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [initialVenueFromUrl, fetchVenues, fetchMe]);

  // Железная свая: onShift из venues/{venueId}/staff/{staffId} (как в /api/staff/me)
  useEffect(() => {
    if (!currentVenueId || !staffData.staffId) return;
    const ref = doc(db, "venues", currentVenueId, "staff", staffData.staffId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        setStaffData((prev) => ({
          ...prev,
          onShift: d?.onShift === true,
        }));
      },
      (err) => {
        console.warn("[StaffProvider] venue staff snapshot:", err);
      }
    );
    return () => unsub();
  }, [currentVenueId, staffData.staffId]);

  const value: StaffContextValue = {
    currentVenueId,
    staffData,
    venuesList,
    loading: isInitialLoading,
    isInitialLoading,
    error,
    setCurrentVenue,
    refreshStaffData,
  };

  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>;
}
