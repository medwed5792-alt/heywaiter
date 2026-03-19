"use client";

/**
 * StaffProvider — централизованное состояние сотрудника (Unified ID V.2.0).
 * Хранит текущее заведение, данные из /api/staff/me и список заведений из /api/staff/venues.
 * Восстановление currentVenueId из sessionStorage; при v=venue_andrey_alt — загрузка списка и выбор.
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

const STAFF_VENUE_SESSION_KEY = "heywaiter_staff_venue_id";
const DEFAULT_VENUE_ID = "venue_andrey_alt";

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

function getTelegramUserId(): string | null {
  if (typeof window === "undefined") return null;
  const tg = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { id?: number } } } } })
    .Telegram?.WebApp;
  const id = tg?.initDataUnsafe?.user?.id;
  return id != null ? String(id) : null;
}

function getPlatformIdentity(): { platformKey: string; platformId: string | null } {
  if (typeof window === "undefined") return { platformKey: "tg", platformId: null };
  const telegramId = getTelegramUserId();

  const params = new URLSearchParams(window.location.search);
  const urlPlatformKey = platformKeyFromUrl(params.get("platform") ?? params.get("channel")) ?? null;
  const urlPlatformId = params.get("platformId") ?? params.get("chatId") ?? params.get("telegramId");

  const platformKey = urlPlatformKey ?? (telegramId ? "tg" : "tg");
  const platformId = (urlPlatformId ?? telegramId ?? null)?.trim() || null;

  return { platformKey, platformId };
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
}

export interface VenueOption {
  venueId: string;
  name: string;
}

export interface StaffContextValue {
  currentVenueId: string | null;
  staffData: StaffData;
  venuesList: VenueOption[];
  loading: boolean;
  error: string | null;
  setCurrentVenue: (venueId: string) => void;
  refreshStaffData: () => void;
}

const defaultStaffData: StaffData = {
  userId: null,
  staffId: null,
  onShift: false,
};

const StaffContext = createContext<StaffContextValue>({
  currentVenueId: null,
  staffData: defaultStaffData,
  venuesList: [],
  loading: true,
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
  const [loading, setLoading] = useState(true);
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
    const { platformKey, platformId } = getPlatformIdentity();
    if (!platformId) return null;
    const res = await fetch(
      `/api/staff/me?venueId=${encodeURIComponent(venueId)}&channel=${encodeURIComponent(
        platformKey
      )}&platformId=${encodeURIComponent(platformId)}${platformKey === "tg" ? `&telegramId=${encodeURIComponent(platformId)}` : ""}`
    );
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Не удалось загрузить данные");
      return null;
    }
    setError(null);
    const next: StaffData = {
      userId: data.userId ?? null,
      staffId: data.staffId ?? null,
      onShift: data.onShift === true,
    };
    setStaffData(next);
    return next;
  }, []);

  const refreshStaffData = useCallback(() => {
    const vid = currentVenueId;
    if (!vid) return;
    setLoading(true);
    fetchMe(vid).finally(() => setLoading(false));
  }, [currentVenueId, fetchMe]);

  const setCurrentVenue = useCallback(
    (venueId: string) => {
      setStaffVenueInSession(venueId);
      setCurrentVenueIdState(venueId);
      setLoading(true);
      fetchMe(venueId).finally(() => setLoading(false));
    },
    [fetchMe]
  );

  // Инициализация: загрузка venues, затем выбор заведения и fetchMe
  useEffect(() => {
    const { platformId } = getPlatformIdentity();
    if (!platformId) {
      setError("Откройте приложение из нужного мессенджера");
      setLoading(false);
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
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [initialVenueFromUrl, fetchVenues, fetchMe]);

  const value: StaffContextValue = {
    currentVenueId,
    staffData,
    venuesList,
    loading,
    error,
    setCurrentVenue,
    refreshStaffData,
  };

  // Периодическое обновление данных смены (onShift и т.д.)
  useEffect(() => {
    if (!currentVenueId || loading) return;
    const POLL_MS = 8000;
    const t = setInterval(refreshStaffData, POLL_MS);
    return () => clearInterval(t);
  }, [currentVenueId, loading, refreshStaffData]);

  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>;
}
