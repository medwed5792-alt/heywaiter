"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Briefcase, User, Bell, Calendar, Coins } from "lucide-react";
import { addDoc, collection, doc, getDoc, getDocs, limit, query, serverTimestamp, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { haversineDistanceM, IS_GEO_DEBUG } from "@/lib/geo";
import { StaffProvider, useStaff } from "@/components/providers/StaffProvider";
import { StaffCabinetProfile } from "@/components/mini-app/StaffCabinetProfile";

const NOTIFICATIONS_POLL_MS = 5000;
const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 30_000,
  timeout: 10_000,
};

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
  read: boolean;
  createdAt: string | null;
}

interface VenueGeo {
  lat: number;
  lng: number;
  radius: number;
  configured: boolean;
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
  const id = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { id?: number } } } } })
    .Telegram?.WebApp?.initDataUnsafe?.user?.id;
  return id != null ? String(id) : null;
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

const STAFF_VENUE_ID = "venue_andrey_alt";

function StaffContentInner() {
  const venueId = STAFF_VENUE_ID;
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    staffData,
    venuesList,
    loading,
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
  const [venueGeo, setVenueGeo] = useState<VenueGeo | null>(null);
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

  const safeStaffData = staffData ?? { userId: null, staffId: null, onShift: false };
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

  // Гео-валидация: загрузка настроек заведения и проверка дистанции (haversineDistanceM из geo.ts)
  useEffect(() => {
    if (onShift) {
      setVenueGeo(null);
      setGeoBlocked(false);
      setGeoMessage(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setGeoLoading(true);
      try {
        const res = await fetch(`/api/venues/${encodeURIComponent(venueId)}/geo`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data?.configured) {
          setVenueGeo(null);
          setGeoBlocked(false);
          setGeoMessage(null);
          setGeoLoading(false);
          return;
        }
        setVenueGeo({
          lat: data.lat,
          lng: data.lng,
          radius: data.radius ?? 100,
          configured: true,
        });
        if (typeof navigator === "undefined" || !navigator.geolocation) {
          setGeoBlocked(false);
          setGeoMessage(null);
          setGeoLoading(false);
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (cancelled) return;
            const dist = haversineDistanceM(
              pos.coords.latitude,
              pos.coords.longitude,
              data.lat,
              data.lng
            );
            const radius = data.radius ?? 100;
            if (dist > radius) {
              setGeoBlocked(true);
              setGeoMessage(
                `Вы вне зоны заведения. Подойдите ближе (радиус ${radius} м), чтобы выйти на смену.`
              );
            } else {
              setGeoBlocked(false);
              setGeoMessage(null);
            }
            setGeoLoading(false);
          },
          () => {
            if (!cancelled) {
              setGeoBlocked(false);
              setGeoMessage(null);
              setGeoLoading(false);
            }
          },
          GEO_OPTIONS
        );
      } catch {
        if (!cancelled) setGeoLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [venueId, onShift]);

  // Верхние кнопки SOS (без ввода номера стола) удалены, оставляем только «SOS по столу».

  // Подгружаем актуальный справочник столов для валидации номера перед отправкой SOS.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSosTablesLoading(true);
      setSosTablesLoadError(null);
      try {
        const tablesSnap = await getDocs(collection(db, "venues", STAFF_VENUE_ID, "tables"));
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
  }, []);

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
        venueId: STAFF_VENUE_ID,
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

      // Жёсткий поиск root staff doc по tgId/phone, чтобы не плодить новые IDs.
      let resolvedStaffId: string | null = staffId;

      // Если staffId уже получен через StaffProvider — используем его как основной.
      // Иначе делаем поиск по tgId/phone (fallback совместимости).
      if (!resolvedStaffId) {

        // 1) По tgId
        if (platformKey === "tg") {
          const snap = await getDocs(
            query(
              collection(db, "staff"),
              where("venueId", "==", STAFF_VENUE_ID),
              where("tgId", "==", platformIdForDetect),
              limit(1)
            )
          );
          if (!snap.empty) resolvedStaffId = snap.docs[0].id;
        }

        // 2) По phone (если удалось достать phone из global_users)
        if (!resolvedStaffId && userId) {
          const globalSnap = await getDoc(doc(db, "global_users", userId));
          const phoneClean = String(globalSnap.data()?.phone ?? "").replace(/\D/g, "");
          if (phoneClean) {
            const snap = await getDocs(
              query(
                collection(db, "staff"),
                where("venueId", "==", STAFF_VENUE_ID),
                where("phone", "==", phoneClean),
                limit(1)
              )
            );
            if (!snap.empty) resolvedStaffId = snap.docs[0].id;
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
    if (loading || venuesList.length > 0) return;
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
  }, [loading, venuesList.length, router, isIdNotBound, platformIdForDetect, platformKey, userId, staffId, profileCheckRetryNonce]);

  // Таймаут, чтобы не держать пользователя бесконечно на "Проверка профиля…"
  useEffect(() => {
    const shouldWait =
      venuesList.length === 0 &&
      !freeAgentProfileChecked &&
      !loading &&
      !userId &&
      !staffId &&
      !isIdNotBound;

    if (!shouldWait) return;

    setProfileCheckTimedOut(false);
    const t = setTimeout(() => setProfileCheckTimedOut(true), 5000);
    return () => clearTimeout(t);
  }, [venuesList.length, freeAgentProfileChecked, loading, userId, staffId, isIdNotBound]);

  // Пока проверяем профиль при отсутствии заведений — показываем ожидание
  if (
    venuesList.length === 0 &&
    !freeAgentProfileChecked &&
    !loading &&
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

  if (!staffData || loading) {
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
                  `/api/staff/me?venueId=${encodeURIComponent(STAFF_VENUE_ID)}&channel=${encodeURIComponent(platformKey)}&platformId=${encodeURIComponent(platformIdForDetect)}&phone=${encodeURIComponent(
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
              {shiftError && (
                <p className="mt-2 text-sm text-red-600">{shiftError}</p>
              )}
              {!onShift && geoMessage && (
                <p className="mt-2 text-sm text-amber-700">{geoMessage}</p>
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
                        <p className="text-sm font-medium text-slate-800">{n.message}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {n.tableId ? `Стол №${n.tableId}` : ""} · {formatTime(n.createdAt)}
                        </p>
                      </li>
                    ))}
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

function MiniAppStaffContent() {
  return (
    <StaffProvider initialVenueFromUrl={STAFF_VENUE_ID}>
      <StaffContentInner />
    </StaffProvider>
  );
}

export default function MiniAppStaffPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <MiniAppStaffContent />
    </Suspense>
  );
}
