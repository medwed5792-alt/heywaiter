"use client";

import { useEffect, useState, useCallback, useRef, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getVenueIdFromSearchParams } from "@/lib/standards/venue-from-url";
import { Briefcase, User, Bell, Calendar, Coins } from "lucide-react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DEFAULT_VENUE_GEO_RADIUS_METERS, IS_GEO_DEBUG } from "@/lib/geo";
import {
  StaffProvider,
  useStaff,
  HEYWAITER_STAFF_LS_TG_PLATFORM_ID,
  HEYWAITER_STAFF_LS_SOTA_ID,
} from "@/components/providers/StaffProvider";
import { useMiniAppBotRole, MiniAppIdentifyingFallback } from "@/components/mini-app/MiniAppBotRoleDispatcher";
import { StaffCabinetProfile } from "@/components/mini-app/StaffCabinetProfile";
import { StaffPreOrderInbox } from "@/components/mini-app/StaffPreOrderInbox";
import { resolveGuestDisplayName } from "@/lib/identity/guest-display";
import { SotaLocationProvider, useSotaLocation } from "@/components/providers/SotaLocationProvider";

const NOTIFICATIONS_POLL_MS = 5000;
type Tab = "work" | "cabinet";

type TelegramWebApp = {
  initDataUnsafe?: { user?: { id?: number } };
  ready?: () => void;
};

interface NotificationItem {
  id: string;
  message: string;
  tableId: string | null;
  venueId: string | null;
  type: string | null;
  status?: "pending" | "processing" | "completed" | null;
  title?: string | null;
  guestName?: string | null;
  amount?: number | null;
  items?: string[] | null;
  read: boolean;
  createdAt: string | null;
}

interface ScheduleEntryItem {
  id: string;
  slot: { date: string; startTime: string; endTime: string };
  planHours?: number;
  factHours?: number | null;
  checkIn?: string | null;
  checkOut?: string | null;
  role?: string;
}

interface ActiveTableGuest {
  uid: string;
  name: string;
  isMaster: boolean;
}

interface ActiveTableItem {
  sessionId: string;
  tableId: string;
  tableNumber?: number | null;
  masterName: string;
  participants: ActiveTableGuest[];
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function getTelegramUserIdFromWindow(): string | null {
  if (typeof window === "undefined") return null;
  const WebApp = (window as unknown as {
    Telegram?: { WebApp?: { initData?: string; initDataUnsafe?: { user?: { id?: number } } } };
  }).Telegram?.WebApp;
  const unsafe = WebApp?.initDataUnsafe?.user?.id;
  if (unsafe != null) return String(unsafe);
  const initData = typeof WebApp?.initData === "string" ? WebApp.initData.trim() : "";
  if (!initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const userJson = params.get("user");
    if (!userJson) return null;
    const u = JSON.parse(userJson) as { id?: number | string };
    if (u?.id != null) return String(u.id);
  } catch {
    // ignore
  }
  return null;
}

function platformKeyToLabel(platformKey: string): string {
  const k = platformKey.toLowerCase();
  switch (k) {
    case "tg":
      return "Telegram";
    case "wa":
      return "WhatsApp";
    case "vk":
      return "VKontakte";
    case "viber":
      return "Viber";
    case "wechat":
      return "WeChat";
    case "inst":
      return "Instagram";
    case "fb":
      return "Facebook";
    case "line":
      return "Line";
    default:
      return platformKey;
  }
}

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
    case "vkontacte":
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

/** Первая регистрация: только Имя и Фамилия → создаётся global_user, редирект в Личный кабинет. */
function StaffOnboardingScreen({
  onSuccess,
  platformKey,
  platformId,
}: {
  onSuccess: () => void;
  platformKey: string;
  platformId: string | null;
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platform = platformKey;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!platformId) {
      setError("Откройте приложение из нужного мессенджера");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/staff/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          platform,
          platformId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка регистрации");
      onSuccess();
      router.replace(
        `/mini-app/staff/cabinet?platform=${encodeURIComponent(platformKey)}&platformId=${encodeURIComponent(
          platformId ?? ""
        )}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Добро пожаловать</h1>
        <p className="mt-1 text-sm text-slate-500">Укажите имя и фамилию. После этого откроется Личный кабинет.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="block text-xs font-medium text-slate-600">Имя</span>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Имя"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-600">Фамилия</span>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Фамилия"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? "…" : "Готово"}
          </button>
        </form>

        {error && (
          <p className="mt-4 text-center text-sm text-red-600">{error}</p>
        )}
      </div>
    </main>
  );
}

function StaffContentInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { checkInsideVenue, requestLocation, status: geoStatus, source: geoSource, error: geoError } = useSotaLocation();
  const venueId = getVenueIdFromSearchParams(searchParams);
  const {
    staffData,
    venuesList,
    isInitialLoading,
    error: staffError,
    refreshStaffData,
  } = useStaff();

  const [tab, setTab] = useState<Tab>("work");
  const [actionLoading, setActionLoading] = useState(false);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const playedShiftEndIdsRef = useRef<Set<string>>(new Set());
  const prevNotificationIdsRef = useRef<Set<string>>(new Set());
  const didInitNotificationsRef = useRef(false);
  const [geoBlocked, setGeoBlocked] = useState(false);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [scheduleEntries, setScheduleEntries] = useState<ScheduleEntryItem[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [freeAgentProfileChecked, setFreeAgentProfileChecked] = useState(false);
  const [profileCheckTimedOut, setProfileCheckTimedOut] = useState(false);
  const [profileCheckRetryNonce, setProfileCheckRetryNonce] = useState(0);
  const [sosTableNumber, setSosTableNumber] = useState<string>("");
  const [sosLoading, setSosLoading] = useState(false);
  const [sosSubmitError, setSosSubmitError] = useState<string | null>(null);
  const [sosValidationError, setSosValidationError] = useState<string | null>(null);
  const [sosTablesLoading, setSosTablesLoading] = useState(false);
  const [sosTablesLoadError, setSosTablesLoadError] = useState<string | null>(null);
  const [allowedTableDocIds, setAllowedTableDocIds] = useState<Set<string>>(new Set());
  const [allowedTableNumbers, setAllowedTableNumbers] = useState<Set<number>>(new Set());
  const [activeTables, setActiveTables] = useState<ActiveTableItem[]>([]);
  const [notificationActionLoading, setNotificationActionLoading] = useState<string | null>(null);
  const [geoHintOpen, setGeoHintOpen] = useState(false);

  const safeStaffData = staffData ?? { userId: null, staffId: null, onShift: false, sotaId: null };
  const { userId, staffId, onShift } = safeStaffData;
  const tgIdForDetect = getTelegramUserIdFromWindow();
  const urlPlatformRaw = searchParams.get("platform") ?? searchParams.get("channel");
  const urlPlatformId = searchParams.get("platformId") ?? searchParams.get("chatId") ?? searchParams.get("telegramId");
  const platformKey = platformKeyFromUrl(urlPlatformRaw) ?? (tgIdForDetect ? "tg" : "tg");
  const platformIdForDetect = (urlPlatformId ?? tgIdForDetect ?? null)?.trim() || null;
  const platformLabelForRender = platformKeyToLabel(platformKey);

  const isIdNotBound = staffError === "ID_NOT_BOUND";

  const [bindPhone, setBindPhone] = useState("");
  const [bindPhoneSaving, setBindPhoneSaving] = useState(false);
  const [bindPhoneError, setBindPhoneError] = useState<string | null>(null);

  const geoBadge = useMemo(() => {
    if (geoSource === "gps") {
      return {
        label: "GPS",
        className: "bg-emerald-100 text-emerald-800",
        hint: "Высокая точность. Используется спутниковое позиционирование.",
      };
    }
    if (geoSource === "network") {
      return {
        label: "Wi-Fi/Сеть",
        className: "bg-blue-100 text-blue-800",
        hint: "Средняя точность. Включите Wi-Fi для более точного определения.",
      };
    }
    if (geoSource === "ip") {
      return {
        label: "IP-Адрес",
        className: "bg-amber-100 text-amber-800",
        hint: "Низкая точность. Разрешите геолокацию в браузере для GPS/Wi-Fi.",
      };
    }
    return {
      label: "Не определено",
      className: "bg-slate-100 text-slate-700",
      hint: "Источник не определен. Нажмите «Попробовать снова».",
    };
  }, [geoSource]);

  const rerunGeoCheck = useCallback(async () => {
    if (onShift) return;
    setGeoLoading(true);
    setGeoMessage(null);
    try {
      await requestLocation(true);
      const check = await checkInsideVenue(venueId);
      if (!check.configured) {
        setGeoBlocked(false);
        setGeoMessage(null);
      } else if (!check.allowed) {
        const radius = check.effectiveRadius ?? DEFAULT_VENUE_GEO_RADIUS_METERS;
        setGeoBlocked(true);
        setGeoMessage(`Вы вне зоны заведения. Подойдите ближе (радиус ${radius} м), чтобы выйти на смену.`);
      } else {
        setGeoBlocked(false);
        setGeoMessage(null);
      }
    } catch {
      // keep message from geoStatus/geoError
    } finally {
      setGeoLoading(false);
    }
  }, [checkInsideVenue, onShift, requestLocation, venueId]);

  const fetchNotifications = useCallback(async () => {
    if (!staffId) return;
    try {
      const res = await fetch(
        `/api/staff/notifications?staffId=${encodeURIComponent(staffId)}&venueId=${encodeURIComponent(venueId)}&limit=30`
      );
      const data = await res.json();
      if (res.ok && Array.isArray(data.notifications)) {
        setNotifications(data.notifications);
      }
    } catch (_e) {
      // ignore
    }
  }, [staffId, venueId]);

  const acceptNotification = useCallback(
    async (notificationId: string) => {
      if (!staffId) return;
      setNotificationActionLoading(notificationId);
      try {
        const res = await fetch("/api/staff/notifications/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notificationId, staffId }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Не удалось принять уведомление");
        }
        await fetchNotifications();
      } catch (e) {
        console.warn("[staff] accept notification:", e);
      } finally {
        setNotificationActionLoading(null);
      }
    },
    [staffId, fetchNotifications]
  );

  useEffect(() => {
    if (!venueId) {
      setActiveTables([]);
      return;
    }
    const q = query(
      collection(db, "activeSessions"),
      where("venueId", "==", venueId),
      where("status", "==", "check_in_success")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: ActiveTableItem[] = snap.docs.map((d) => {
          const x = (d.data() ?? {}) as Record<string, unknown>;
          const tableId = String(x.tableId ?? "").trim();
          const tableNumberRaw = x.tableNumber;
          const tableNumber =
            typeof tableNumberRaw === "number"
              ? tableNumberRaw
              : typeof tableNumberRaw === "string"
                ? Number(tableNumberRaw)
                : null;
          const masterId = String(x.masterId ?? "").trim();
          const participantsRaw = Array.isArray(x.participants) ? x.participants : [];
          const knownNamesByUid: Record<string, string | undefined> = {};
          const legacyName =
            ((x.guestIdentity as { displayName?: string } | undefined)?.displayName ?? "").trim() || undefined;
          if (legacyName && masterId) knownNamesByUid[masterId] = legacyName;
          const participants: ActiveTableGuest[] = participantsRaw
            .map((p) => {
              const k = (p ?? {}) as Record<string, unknown>;
              const uid = String(k.uid ?? "").trim();
              if (!uid) return null;
              const name = resolveGuestDisplayName({ uid, knownNamesByUid });
              return { uid, name, isMaster: Boolean(masterId && uid === masterId) };
            })
            .filter(Boolean) as ActiveTableGuest[];
          const masterName = resolveGuestDisplayName({
            uid: masterId,
            knownNamesByUid,
          });
          return {
            sessionId: d.id,
            tableId,
            tableNumber: Number.isFinite(tableNumber as number) ? (tableNumber as number) : null,
            masterName,
            participants,
          };
        });
        rows.sort((a, b) => (a.tableNumber ?? Number.MAX_SAFE_INTEGER) - (b.tableNumber ?? Number.MAX_SAFE_INTEGER));
        setActiveTables(rows);
      },
      (err) => {
        console.warn("[mini-app/staff] activeSessions snapshot error:", err);
      }
    );
    return () => unsub();
  }, [venueId]);

  useEffect(() => {
    fetchNotifications();
    if (!staffId) return;
    const t = setInterval(fetchNotifications, NOTIFICATIONS_POLL_MS);
    return () => clearInterval(t);
  }, [staffId, fetchNotifications]);

  // Звуковой сигнал на финальное уведомление смены
  useEffect(() => {
    const prev = prevNotificationIdsRef.current;
    const next = new Set(notifications.map((n) => n.id));

    if (!didInitNotificationsRef.current) {
      prevNotificationIdsRef.current = next;
      didInitNotificationsRef.current = true;
      return;
    }

    const newlyReceived = notifications.filter((n) => !prev.has(n.id));
    const shiftEnd = newlyReceived.find((n) => n.type === "shift_end");

    if (shiftEnd && !playedShiftEndIdsRef.current.has(shiftEnd.id)) {
      playedShiftEndIdsRef.current.add(shiftEnd.id);
      try {
        const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        ctx.resume?.().catch(() => {});
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        const now = ctx.currentTime;
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.2);
        setTimeout(() => ctx.close?.().catch(() => {}), 400);
      } catch {
        // ignore (audio may be blocked)
      }
    }

    prevNotificationIdsRef.current = next;
  }, [notifications]);

  const fetchSchedule = useCallback(async () => {
    if (!staffId) return;
    setScheduleLoading(true);
    try {
      const res = await fetch(
        `/api/staff/schedule?staffId=${encodeURIComponent(staffId)}&venueId=${encodeURIComponent(venueId)}`
      );
      const data = await res.json();
      if (res.ok && Array.isArray(data.entries)) {
        setScheduleEntries(data.entries);
      } else {
        setScheduleEntries([]);
      }
    } catch {
      setScheduleEntries([]);
    } finally {
      setScheduleLoading(false);
    }
  }, [staffId, venueId]);

  useEffect(() => {
    if (tab === "cabinet" && staffId) {
      fetchSchedule();
    }
  }, [tab, staffId, fetchSchedule]);

  // Гео-валидация через универсальный SotaLocationProvider.
  useEffect(() => {
    if (onShift) {
      setGeoBlocked(false);
      setGeoMessage(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setGeoLoading(true);
      try {
        await requestLocation(false);
        const check = await checkInsideVenue(venueId);
        if (cancelled) return;
        if (!check.configured) {
          setGeoBlocked(false);
          setGeoMessage(null);
          setGeoLoading(false);
          return;
        }
        if (!check.allowed) {
          const radius = check.effectiveRadius ?? DEFAULT_VENUE_GEO_RADIUS_METERS;
          setGeoBlocked(true);
          setGeoMessage(`Вы вне зоны заведения. Подойдите ближе (радиус ${radius} м), чтобы выйти на смену.`);
        } else {
          setGeoBlocked(false);
          setGeoMessage(null);
        }
        setGeoLoading(false);
      } catch {
        if (!cancelled) setGeoLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [venueId, onShift, checkInsideVenue, requestLocation]);

  useEffect(() => {
    if (onShift) return;
    if (geoStatus === "requesting") {
      setGeoMessage("Определение координат...");
      return;
    }
    if (geoStatus === "denied") {
      setGeoMessage("Не удалось определить местоположение, включите геолокацию в браузере.");
      return;
    }
    if (geoStatus === "error" || geoStatus === "unavailable") {
      setGeoMessage(geoError ?? "Не удалось определить местоположение, включите Wi-Fi/GPS.");
      return;
    }
    if (geoSource === "ip") {
      setGeoMessage("Низкая точность координат (IP). Разрешен вход на смену с предупреждением.");
      setGeoBlocked(false);
    }
  }, [geoError, geoSource, geoStatus, onShift]);

  // Верхние кнопки SOS (без ввода номера стола) удалены, оставляем только «SOS по столу».

  // Подгружаем актуальный справочник столов для валидации номера перед отправкой SOS.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSosTablesLoading(true);
      setSosTablesLoadError(null);
      try {
        const tablesSnap = await getDocs(collection(db, "venues", venueId, "tables"));
        if (cancelled) return;
        const docIds = new Set<string>();
        const numbers = new Set<number>();
        tablesSnap.docs.forEach((d) => {
          docIds.add(d.id);
          const rawNumber = d.data()?.number as unknown;
          const parsed =
            typeof rawNumber === "number"
              ? rawNumber
              : typeof rawNumber === "string"
                ? Number(rawNumber.trim())
                : NaN;
          if (Number.isFinite(parsed) && parsed >= 1) numbers.add(parsed);
        });
        setAllowedTableDocIds(docIds);
        setAllowedTableNumbers(numbers);
      } catch (e) {
        if (cancelled) return;
        setSosTablesLoadError(e instanceof Error ? e.message : "Ошибка загрузки столов");
        setAllowedTableDocIds(new Set());
        setAllowedTableNumbers(new Set());
      } finally {
        if (!cancelled) setSosTablesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venueId]);

  // Валидация введённого номера столов по загруженному справочнику.
  useEffect(() => {
    const raw = sosTableNumber.trim();
    if (!raw) {
      setSosValidationError(null);
      return;
    }
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 1) {
      setSosValidationError("Введите корректный номер стола");
      return;
    }
    if (sosTablesLoading) {
      setSosValidationError(null);
      return;
    }
    if (sosTablesLoadError) {
      setSosValidationError(null);
      return;
    }
    const tableExists = allowedTableDocIds.has(raw) || allowedTableNumbers.has(num);
    setSosValidationError(tableExists ? null : `Стол №${raw} не найден в зале. Проверьте ввод`);
  }, [sosTableNumber, sosTablesLoading, sosTablesLoadError, allowedTableDocIds, allowedTableNumbers]);

  const handleSendSos = async () => {
    const raw = sosTableNumber.trim();
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 1) return;
    const tableId = raw;
    if (sosTablesLoading) return;
    if (sosTablesLoadError) {
      setSosSubmitError(sosTablesLoadError);
      return;
    }

    const tableExists = allowedTableDocIds.has(tableId) || allowedTableNumbers.has(num);
    if (!tableExists) {
      setSosSubmitError(`Стол №${tableId} не найден в зале. Проверьте ввод`);
      return;
    }

    setSosLoading(true);
    setSosSubmitError(null);
    try {
      let staffName = "Сотрудник";
      if (userId) {
        const globalSnap = await getDoc(doc(db, "global_users", userId));
        if (globalSnap.exists()) {
          const d = globalSnap.data() ?? {};
          const first = (d.firstName as string | null | undefined) ?? "";
          const last = (d.lastName as string | null | undefined) ?? "";
          const identityName = (d?.identity as { displayName?: string } | undefined)?.displayName ?? "";
          const resolved = [first, last].filter(Boolean).join(" ").trim() || identityName.trim() || staffName;
          staffName = resolved.trim().split(' ')[0] || "Сотрудник";
        }
      }

      const msg = `🚨 SOS: Стол №${tableId}. Требуется внимание! (Вызвал: ${staffName})`;
      await addDoc(collection(db, "staffNotifications"), {
        type: "sos",
        venueId: venueId,
        tableId,
        read: false,
        message: msg,
        createdAt: serverTimestamp(),
      });

      setSosTableNumber("");
      setSosValidationError(null);
    } catch (e) {
      setSosSubmitError(e instanceof Error ? e.message : "Ошибка отправки SOS");
    } finally {
      setSosLoading(false);
    }
  };

  const handleShiftAction = async () => {
    if (actionLoading) return;
    if (!onShift && !IS_GEO_DEBUG && geoBlocked) return;
    setActionLoading(true);
    setShiftError(null);
    try {
      if (!platformIdForDetect) throw new Error("Не удалось определить ID платформы");

      // Канонический staffId: `${venueId}_${globalUserId}` (global_users — единый источник).
      let resolvedStaffId: string | null = staffId;

      if (!resolvedStaffId && userId) {
        resolvedStaffId = `${venueId}_${userId}`;
      }

      if (!resolvedStaffId && platformKey === "tg") {
        const snap = await getDocs(
          query(
            collection(db, "global_users"),
            where("identities.tg", "==", platformIdForDetect),
            limit(1)
          )
        );
        if (!snap.empty) {
          resolvedStaffId = `${venueId}_${snap.docs[0].id}`;
        }
      }

      if (!resolvedStaffId && userId) {
        const globalSnap = await getDoc(doc(db, "global_users", userId));
        const phoneClean = String(globalSnap.data()?.phone ?? "").replace(/\D/g, "");
        if (phoneClean) {
          const snap = await getDocs(
            query(
              collection(db, "global_users"),
              where("identities.phone", "==", phoneClean),
              limit(1)
            )
          );
          if (!snap.empty) {
            resolvedStaffId = `${venueId}_${snap.docs[0].id}`;
          }
        }
      }

      if (!resolvedStaffId) throw new Error("Сотрудник не найден. Обратитесь к администратору.");
      const res = await fetch("/api/staff/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: resolvedStaffId,
          action: onShift ? "stop" : "start",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      refreshStaffData();
    } catch (e) {
      setShiftError(e instanceof Error ? e.message : "Ошибка смены");
    } finally {
      setActionLoading(false);
    }
  };

  // Telegram SDK иногда может "глюкануть" на старте; не допускаем падение компонента.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const tg = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
    if (!tg) return;
    try {
      tg.ready?.();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[mini-app/staff] WebApp.ready error:", e);
    }
  }, []);

  // Нет заведений: проверяем профиль → редирект в кабинет или онбординг
  useEffect(() => {
    if (isInitialLoading || venuesList.length > 0) return;
    // Если staff найден (даже при пустом venuesList из-за ограничений эндпойнта),
    // не уводим в кабинет/онбординг.
    if (userId || staffId) return;
    if (isIdNotBound) return;
    if (!platformIdForDetect) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/staff/profile?channel=${encodeURIComponent(platformKey)}&platformId=${encodeURIComponent(platformIdForDetect)}`
      );
      if (cancelled) return;
      if (res.ok) {
        router.replace(
          `/mini-app/staff/cabinet?platform=${encodeURIComponent(platformKey)}&platformId=${encodeURIComponent(
            platformIdForDetect ?? ""
          )}`
        );
      } else {
        setFreeAgentProfileChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [isInitialLoading, venuesList.length, router, isIdNotBound, platformIdForDetect, platformKey, userId, staffId, profileCheckRetryNonce]);

  // Таймаут, чтобы не держать пользователя бесконечно на "Проверка профиля…"
  useEffect(() => {
    const shouldWait =
      venuesList.length === 0 &&
      !freeAgentProfileChecked &&
      !isInitialLoading &&
      !userId &&
      !staffId &&
      !isIdNotBound;

    if (!shouldWait) return;

    setProfileCheckTimedOut(false);
    const t = setTimeout(() => setProfileCheckTimedOut(true), 5000);
    return () => clearTimeout(t);
  }, [venuesList.length, freeAgentProfileChecked, isInitialLoading, userId, staffId, isIdNotBound]);

  // Пока проверяем профиль при отсутствии заведений — показываем ожидание
  if (
    venuesList.length === 0 &&
    !freeAgentProfileChecked &&
    !isInitialLoading &&
    !userId &&
    !staffId &&
    !isIdNotBound
  ) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        {!profileCheckTimedOut ? (
          <p className="text-slate-500">Проверка профиля…</p>
        ) : (
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Не удалось проверить профиль</h2>
            <p className="mt-2 text-sm text-slate-600">Попробуйте ещё раз через 5 секунд или откройте приложение заново.</p>
            <button
              type="button"
              onClick={() => {
                setProfileCheckTimedOut(false);
                setProfileCheckRetryNonce((n) => n + 1);
              }}
              className="mt-4 w-full rounded-xl bg-emerald-600 py-3 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Попробовать снова
            </button>
          </div>
        )}
      </main>
    );
  }

  if (isInitialLoading) {
    return <div className="p-8 text-center">Загрузка данных...</div>;
  }

  // Survival Mode: платформенный ID не привязан — показываем форму привязки, а не Application Error.
  if (isIdNotBound) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Нужна привязка</h1>
          <p className="mt-2 text-sm text-slate-700">
            Ваш {platformLabelForRender} ID: <span className="font-mono">{platformIdForDetect ?? "—"}</span> не привязан.
            Введите номер телефона для авторизации или свяжитесь с админом.
          </p>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBindPhoneError(null);
              if (!platformIdForDetect) {
                setBindPhoneError("Не удалось определить ID платформы");
                return;
              }
              if (!bindPhone.trim()) {
                setBindPhoneError("Введите номер телефона");
                return;
              }
              setBindPhoneSaving(true);
              try {
                const res = await fetch(
                  `/api/staff/me?venueId=${encodeURIComponent(venueId)}&channel=${encodeURIComponent(platformKey)}&platformId=${encodeURIComponent(platformIdForDetect)}&phone=${encodeURIComponent(
                    bindPhone.trim()
                  )}`
                );
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || "Ошибка привязки");
                await refreshStaffData();
              } catch (err) {
                setBindPhoneError(err instanceof Error ? err.message : "Ошибка привязки");
              } finally {
                setBindPhoneSaving(false);
              }
            }}
            className="mt-5 space-y-4"
          >
            <label className="block">
              <span className="block text-xs font-medium text-slate-600">Телефон</span>
              <input
                type="tel"
                value={bindPhone}
                onChange={(e) => setBindPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="+7 900 123-45-67"
              />
            </label>

            {bindPhoneError && <p className="text-sm text-red-600">{bindPhoneError}</p>}

            <button
              type="submit"
              disabled={bindPhoneSaving}
              className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {bindPhoneSaving ? "Привязка…" : "Авторизоваться"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  // Нет заведений и профиль не найден (или ещё не проверен) → онбординг
  if (venuesList.length === 0 && !userId && !staffId && (freeAgentProfileChecked || !staffError)) {
    return (
      <StaffOnboardingScreen
        platformKey={platformKey}
        platformId={platformIdForDetect}
        onSuccess={() => {
          setFreeAgentProfileChecked(false);
          refreshStaffData();
        }}
      />
    );
  }

  if (staffError && !userId && !staffId && !isIdNotBound) {
    return (
      <StaffOnboardingScreen
        platformKey={platformKey}
        platformId={platformIdForDetect}
        onSuccess={() => {
          setFreeAgentProfileChecked(false);
          refreshStaffData();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 md:flex md:max-w-2xl md:mx-auto md:shadow-lg">
      <header className="sticky top-0 z-10 flex border-b border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setTab("work")}
          className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors ${
            tab === "work"
              ? "border-b-2 border-emerald-600 text-emerald-700 bg-emerald-50/50"
              : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          <Briefcase className="h-4 w-4" />
          Работа
        </button>
        <button
          type="button"
          onClick={() => setTab("cabinet")}
          className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors ${
            tab === "cabinet"
              ? "border-b-2 border-slate-800 text-slate-900 bg-slate-50"
              : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          <User className="h-4 w-4" />
          Кабинет
        </button>
      </header>

      <main className="flex-1 p-4 pb-8 md:p-6">
        {tab === "work" && (
          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-medium text-slate-500">Смена</h2>
              <p className="mt-0.5 text-slate-700">
                {onShift ? "Вы на смене" : "Вы не на смене"}
              </p>
              {!onShift && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">
                    {geoLoading || geoStatus === "requesting" ? "Определение координат..." : "Источник геоданных"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setGeoHintOpen((v) => !v)}
                    className={`px-2 py-1 rounded text-xs font-bold ${geoBadge.className}`}
                  >
                    {geoBadge.label}
                  </button>
                </div>
              )}
              {!onShift && geoHintOpen && (
                <p className="mt-1 text-xs text-slate-500">{geoBadge.hint}</p>
              )}
              {shiftError && (
                <p className="mt-2 text-sm text-red-600">{shiftError}</p>
              )}
              {!onShift && geoMessage && (
                <p className="mt-2 text-sm text-amber-700">{geoMessage}</p>
              )}
              {!onShift && geoSource === "ip" && (
                <p className="mt-1 text-xs text-amber-700">
                  Используется примерное местоположение по сети. Доступ разрешен с предупреждением.
                </p>
              )}
              {!onShift && geoStatus === "denied" && (
                <p className="mt-1 text-xs text-red-600">
                  Доступ к геопозиции запрещен в браузере. Разрешите доступ и нажмите &quot;Попробовать снова&quot;.
                </p>
              )}
              {!onShift && geoStatus === "denied" && (
                <button
                  type="button"
                  onClick={() => void rerunGeoCheck()}
                  className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Попробовать снова
                </button>
              )}
              <button
                type="button"
                onClick={handleShiftAction}
                disabled={actionLoading || (!onShift && !IS_GEO_DEBUG && (geoBlocked || geoLoading))}
                className={`mt-4 w-full rounded-xl py-4 text-base font-semibold text-white transition-opacity disabled:opacity-50 ${
                  onShift ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {actionLoading
                  ? "…"
                  : !IS_GEO_DEBUG && geoLoading && !onShift
                    ? "Проверка геолокации…"
                    : onShift
                      ? "Завершить смену"
                      : "Начать смену"}
              </button>
            </section>

            <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-medium text-red-600">SOS по столу</h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Введите номер стола и нажмите SOS.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={sosTableNumber}
                  onChange={(e) => {
                    setSosTableNumber(e.target.value);
                    setSosSubmitError(null);
                  }}
                  className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="№ стола"
                />
                <button
                  type="button"
                  onClick={handleSendSos}
                  disabled={
                    sosLoading ||
                    sosTablesLoading ||
                    !!sosTablesLoadError ||
                    !sosTableNumber.trim()
                    || !!sosValidationError
                  }
                  className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 ${
                    sosLoading
                      ? "bg-red-500"
                      : sosTableNumber.trim() && !sosValidationError
                        ? "bg-red-600 animate-pulse"
                        : "bg-red-300"
                  }`}
                >
                  {sosLoading ? "Отправка…" : "SOS"}
                </button>
              </div>
              {(sosSubmitError || sosValidationError) && (
                <p className="mt-2 text-xs text-red-600">{sosSubmitError ?? sosValidationError}</p>
              )}
            </section>

            <StaffPreOrderInbox venueId={venueId} staffId={staffId} />

            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
                <Bell className="h-4 w-4 text-slate-500" />
                <h2 className="text-sm font-medium text-slate-700">Входящие вызовы</h2>
              </div>
              <div className="max-h-[50vh] overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="p-4 text-sm text-slate-500 text-center">Пока нет вызовов</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {notifications.map((n) => (
                      <li key={n.id} className="px-4 py-3">
                        {(n.type === "split_bill_request" || n.type === "full_bill_request") ? (
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                            <p className="text-sm font-semibold text-emerald-900">
                              {n.type === "split_bill_request" ? "💰 Запрос раздельного счета" : "👑 Закрытие всего стола"}
                            </p>
                            <p className="mt-1 text-sm text-emerald-900">{n.message}</p>
                            {Array.isArray(n.items) && n.items.length > 0 && (
                              <ul className="mt-2 list-inside list-disc text-xs text-emerald-800">
                                {n.items.slice(0, 5).map((item, idx) => (
                                  <li key={`${n.id}-${idx}`}>{item}</li>
                                ))}
                              </ul>
                            )}
                            <div className="mt-2 flex items-center justify-between">
                              <span className="text-xs text-emerald-800">
                                Статус: {n.status === "processing" ? "processing" : n.status === "completed" ? "completed" : "pending"}
                              </span>
                              {n.status !== "processing" && n.status !== "completed" && (
                                <button
                                  type="button"
                                  onClick={() => void acceptNotification(n.id)}
                                  disabled={notificationActionLoading === n.id}
                                  className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  {notificationActionLoading === n.id ? "..." : "Принять"}
                                </button>
                              )}
                            </div>
                            <p className="mt-1 text-[11px] text-emerald-800/80">
                              {n.tableId ? `Стол №${n.tableId}` : ""} · {formatTime(n.createdAt)}
                            </p>
                          </div>
                        ) : (
                          <>
                            <p className="text-sm font-medium text-slate-800">{n.message}</p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {n.tableId ? `Стол №${n.tableId}` : ""} · {formatTime(n.createdAt)}
                            </p>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
                <User className="h-4 w-4 text-slate-500" />
                <h2 className="text-sm font-medium text-slate-700">Активные столы</h2>
              </div>
              <div className="max-h-[48vh] overflow-y-auto">
                {activeTables.length === 0 ? (
                  <p className="p-4 text-sm text-slate-500 text-center">Сейчас нет активных столов</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {activeTables.map((s) => {
                      const extra = Math.max(s.participants.length - 1, 0);
                      return (
                        <li key={s.sessionId} className="px-4 py-3">
                          <p className="text-sm font-semibold text-slate-800">
                            Стол №{s.tableNumber ?? s.tableId}
                          </p>
                          <p className="mt-0.5 text-sm text-slate-700">
                            {s.masterName} 👑{extra > 0 ? ` + ${extra} гостя` : ""}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {s.participants.map((p) => (
                              <span
                                key={p.uid}
                                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
                              >
                                {p.name}
                                {p.isMaster ? " 👑" : ""}
                              </span>
                            ))}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
            {IS_GEO_DEBUG && (
              <p className="text-xs text-slate-400 text-center">🛠 Debug: GPS-проверка отключена</p>
            )}
          </div>
        )}

        {tab === "cabinet" && (
          <div className="space-y-4">
            <StaffCabinetProfile platformKey={platformKey} platformId={platformIdForDetect} />
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-700">
                <Calendar className="h-5 w-5 text-slate-500" />
                <h3 className="font-medium">Мой график</h3>
              </div>
              <p className="mt-2 text-sm text-slate-500">Только ваши смены по текущему заведению. Редактирование и удаление недоступны.</p>
              {scheduleLoading ? (
                <p className="mt-3 text-sm text-slate-500">Загрузка…</p>
              ) : scheduleEntries.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">Нет запланированных смен.</p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100">
                  {scheduleEntries.map((entry) => (
                    <li key={entry.id} className="py-3 first:pt-0">
                      <p className="font-medium text-slate-800">
                        {entry.slot.date} · {entry.slot.startTime} – {entry.slot.endTime}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        План: {entry.planHours ?? 0} ч
                        {entry.checkIn != null && entry.checkOut != null && (
                          <> · Факт: {entry.factHours ?? 0} ч</>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-700">
                <Briefcase className="h-5 w-5 text-slate-500" />
                <h3 className="font-medium">Биржа смен</h3>
              </div>
              <p className="mt-2 text-sm text-slate-500">Обмен сменами с коллегами. Доступ только для просмотра в приложении.</p>
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-700">
                <Coins className="h-5 w-5 text-slate-500" />
                <h3 className="font-medium">Мои чаевые</h3>
              </div>
              <p className="mt-2 text-sm text-slate-500">Статистика чаевых. Только просмотр.</p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

const STAFF_BOOT_POLL_MS = 300;
const STAFF_BOOT_TOTAL_MS = 5000;

function MiniAppStaffContent() {
  const searchParams = useSearchParams();
  const { role: miniAppBotRole } = useMiniAppBotRole();
  const initialVenueId = getVenueIdFromSearchParams(searchParams);
  const [staffBootstrapReady, setStaffBootstrapReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const urlPid = (
      searchParams.get("platformId") ??
      searchParams.get("chatId") ??
      searchParams.get("telegramId") ??
      ""
    ).trim();
    if (urlPid) {
      setStaffBootstrapReady(true);
      return;
    }

    let cachedSota = false;
    let cachedTg = false;
    try {
      cachedSota = Boolean(localStorage.getItem(HEYWAITER_STAFF_LS_SOTA_ID)?.trim());
      cachedTg = Boolean(localStorage.getItem(HEYWAITER_STAFF_LS_TG_PLATFORM_ID)?.trim());
    } catch {
      // ignore
    }
    if (cachedSota || cachedTg) {
      setStaffBootstrapReady(true);
      return;
    }

    const startedAt = Date.now();
    const id = window.setInterval(() => {
      const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp;
      const init = typeof tg?.initData === "string" ? tg.initData.trim() : "";
      if (init.length > 0) {
        setStaffBootstrapReady(true);
        window.clearInterval(id);
        return;
      }
      if (Date.now() - startedAt >= STAFF_BOOT_TOTAL_MS) {
        setStaffBootstrapReady(true);
        window.clearInterval(id);
      }
    }, STAFF_BOOT_POLL_MS);

    return () => window.clearInterval(id);
  }, [searchParams]);

  if (miniAppBotRole !== "staff") {
    return null;
  }

  if (!staffBootstrapReady) {
    return <MiniAppIdentifyingFallback />;
  }

  return (
    <SotaLocationProvider>
      <StaffProvider initialVenueFromUrl={initialVenueId}>
        <StaffContentInner />
      </StaffProvider>
    </SotaLocationProvider>
  );
}

export default function MiniAppStaffPage() {
  return (
    <Suspense fallback={<MiniAppIdentifyingFallback />}>
      <MiniAppStaffContent />
    </Suspense>
  );
}
