"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Briefcase, User, Bell, Calendar, Coins } from "lucide-react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { haversineDistanceM, IS_GEO_DEBUG } from "@/lib/geo";
import { StaffProvider, useStaff } from "@/components/providers/StaffProvider";
import { StaffVenuePicker } from "@/components/staff/StaffVenuePicker";

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

/** Первая регистрация: только Имя и Фамилия → создаётся global_user, редирект в Личный кабинет. */
function StaffOnboardingScreen({ onSuccess }: { onSuccess: () => void }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platformId = getTelegramUserIdFromWindow();
  const platform = "tg";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!platformId) {
      setError("Откройте приложение из Telegram");
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
      router.replace("/mini-app/staff/cabinet");
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
  const router = useRouter();
  const venueId = STAFF_VENUE_ID;
  const {
    currentVenueId,
    staffData,
    venuesList,
    loading,
    error: staffError,
    setCurrentVenue,
    refreshStaffData,
  } = useStaff();

  const [tab, setTab] = useState<Tab>("work");
  const [actionLoading, setActionLoading] = useState(false);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [venueGeo, setVenueGeo] = useState<VenueGeo | null>(null);
  const [geoBlocked, setGeoBlocked] = useState(false);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [scheduleEntries, setScheduleEntries] = useState<ScheduleEntryItem[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [freeAgentProfileChecked, setFreeAgentProfileChecked] = useState(false);
  const [sosTableNumber, setSosTableNumber] = useState<string>("");
  const [availableTableNumbers, setAvailableTableNumbers] = useState<number[]>([]);
  const [sosLoading, setSosLoading] = useState(false);
  const [sosError, setSosError] = useState<string | null>(null);
  const [sosEmergencyLoading, setSosEmergencyLoading] = useState(false);
  const [sosEmergencyHoldProgress, setSosEmergencyHoldProgress] = useState(0);
  const sosHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sosHoldProgressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sosCpLoading, setSosCpLoading] = useState(false);
  const [sosCpHoldProgress, setSosCpHoldProgress] = useState(0);
  const sosCpHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sosCpHoldProgressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { userId, staffId, onShift } = staffData;

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
                `Вы вне зоны заведения (радиус: ${radius} м). Подойдите ближе, чтобы начать смену.`
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

  const handleVenueSelect = useCallback(
    (selectedId: string) => {
      setCurrentVenue(selectedId);
      router.replace(`/mini-app/staff?${new URLSearchParams({ v: selectedId }).toString()}`);
    },
    [setCurrentVenue, router]
  );

  // Загрузка номеров столов для текущего заведения (валидация SOS)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const q = query(
          collection(db, "venues", venueId, "tables")
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        const nums: number[] = [];
        snap.docs.forEach((d) => {
          const n = d.data()?.number as number | undefined;
          if (typeof n === "number" && Number.isFinite(n)) {
            nums.push(n);
          }
        });
        setAvailableTableNumbers(nums);
      } catch (_e) {
        if (!cancelled) {
          setAvailableTableNumbers([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venueId]);

  const SOS_HOLD_MS = 1500;
  const SOS_CP_HOLD_MS = 3000;

  const cancelSosHold = useCallback(() => {
    if (sosHoldTimerRef.current) {
      clearTimeout(sosHoldTimerRef.current);
      sosHoldTimerRef.current = null;
    }
    if (sosHoldProgressRef.current) {
      clearInterval(sosHoldProgressRef.current);
      sosHoldProgressRef.current = null;
    }
    setSosEmergencyHoldProgress(0);
  }, []);

  const handleSosEmergencyStart = useCallback(() => {
    if (sosEmergencyLoading) return;
    cancelSosHold();
    setSosEmergencyHoldProgress(0);
    const start = Date.now();
    sosHoldProgressRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const p = Math.min(100, (elapsed / SOS_HOLD_MS) * 100);
      setSosEmergencyHoldProgress(p);
      if (p >= 100 && sosHoldTimerRef.current === null) {
        if (sosHoldProgressRef.current) {
          clearInterval(sosHoldProgressRef.current);
          sosHoldProgressRef.current = null;
        }
      }
    }, 50);
    sosHoldTimerRef.current = setTimeout(() => {
      sosHoldTimerRef.current = null;
      if (sosHoldProgressRef.current) {
        clearInterval(sosHoldProgressRef.current);
        sosHoldProgressRef.current = null;
      }
      setSosEmergencyHoldProgress(100);
      (async () => {
        setSosEmergencyLoading(true);
        setSosError(null);
        try {
          const res = await fetch("/api/notify/emergency-call", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ staffId: staffId ?? undefined }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.ok === false) {
            throw new Error(data.error || "Ошибка отправки SOS");
          }
          alert("Критический вызов (SOS) отправлен. ЛПР уведомлены.");
        } catch (e) {
          setSosError(e instanceof Error ? e.message : "Ошибка отправки SOS");
        } finally {
          setSosEmergencyLoading(false);
          setSosEmergencyHoldProgress(0);
        }
      })();
    }, SOS_HOLD_MS);
  }, [sosEmergencyLoading, staffId, cancelSosHold]);

  const handleSosEmergencyEnd = useCallback(() => {
    if (sosHoldTimerRef.current) {
      clearTimeout(sosHoldTimerRef.current);
      sosHoldTimerRef.current = null;
    }
    if (sosHoldProgressRef.current) {
      clearInterval(sosHoldProgressRef.current);
      sosHoldProgressRef.current = null;
    }
    setSosEmergencyHoldProgress(0);
  }, []);

  const cancelSosCpHold = useCallback(() => {
    if (sosCpHoldTimerRef.current) {
      clearTimeout(sosCpHoldTimerRef.current);
      sosCpHoldTimerRef.current = null;
    }
    if (sosCpHoldProgressRef.current) {
      clearInterval(sosCpHoldProgressRef.current);
      sosCpHoldProgressRef.current = null;
    }
    setSosCpHoldProgress(0);
  }, []);

  const handleSosCpStart = useCallback(() => {
    if (sosCpLoading) return;
    cancelSosCpHold();
    setSosCpHoldProgress(0);
    const start = Date.now();
    sosCpHoldProgressRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const p = Math.min(100, (elapsed / SOS_CP_HOLD_MS) * 100);
      setSosCpHoldProgress(p);
    }, 50);
    sosCpHoldTimerRef.current = setTimeout(() => {
      sosCpHoldTimerRef.current = null;
      if (sosCpHoldProgressRef.current) {
        clearInterval(sosCpHoldProgressRef.current);
        sosCpHoldProgressRef.current = null;
      }
      setSosCpHoldProgress(100);
      (async () => {
        setSosCpLoading(true);
        setSosError(null);
        try {
          const res = await fetch("/api/notify/emergency-call", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ staffId: staffId ?? undefined }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.ok === false) {
            throw new Error(data.error || "Ошибка отправки");
          }
          alert("Критический вызов (ЧП) отправлен. ЛПР уведомлены.");
        } catch (e) {
          setSosError(e instanceof Error ? e.message : "Ошибка отправки");
        } finally {
          setSosCpLoading(false);
          setSosCpHoldProgress(0);
        }
      })();
    }, SOS_CP_HOLD_MS);
  }, [sosCpLoading, staffId, cancelSosCpHold]);

  const handleSosCpEnd = useCallback(() => {
    if (sosCpHoldTimerRef.current) {
      clearTimeout(sosCpHoldTimerRef.current);
      sosCpHoldTimerRef.current = null;
    }
    if (sosCpHoldProgressRef.current) {
      clearInterval(sosCpHoldProgressRef.current);
      sosCpHoldProgressRef.current = null;
    }
    setSosCpHoldProgress(0);
  }, []);

  useEffect(() => {
    return () => {
      if (sosHoldTimerRef.current) clearTimeout(sosHoldTimerRef.current);
      if (sosHoldProgressRef.current) clearInterval(sosHoldProgressRef.current);
      if (sosCpHoldTimerRef.current) clearTimeout(sosCpHoldTimerRef.current);
      if (sosCpHoldProgressRef.current) clearInterval(sosCpHoldProgressRef.current);
    };
  }, []);

  const handleSendSos = async () => {
    if (!staffId) return;
    const num = Number(sosTableNumber);
    if (!Number.isFinite(num) || num < 1) return;
    if (!availableTableNumbers.includes(num)) return;
    setSosLoading(true);
    setSosError(null);
    try {
      const res = await fetch("/api/notify/emergency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueId,
          tableNumber: num,
          staffId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "Ошибка отправки SOS");
      }
      alert("Сигнал отправлен охране");
      setSosTableNumber("");
    } catch (e) {
      setSosError(e instanceof Error ? e.message : "Ошибка отправки SOS");
    } finally {
      setSosLoading(false);
    }
  };

  const handleShiftAction = async () => {
    if (actionLoading) return;
    if (!staffId && !userId) return;
    if (!onShift && !IS_GEO_DEBUG && geoBlocked) return;
    setActionLoading(true);
    setShiftError(null);
    try {
      const res = await fetch("/api/staff/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(staffId && { staffId }),
          ...(userId && !staffId && { userId, venueId }),
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

  if (typeof window !== "undefined" && (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp) {
    (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp?.ready?.();
  }

  // Нет заведений: проверяем профиль → редирект в кабинет или онбординг
  useEffect(() => {
    if (loading || venuesList.length > 0) return;
    const tgId = getTelegramUserIdFromWindow();
    if (!tgId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/staff/profile?telegramId=${encodeURIComponent(tgId)}`);
      if (cancelled) return;
      if (res.ok) {
        router.replace("/mini-app/staff/cabinet");
      } else {
        setFreeAgentProfileChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [loading, venuesList.length, router]);

  // Пока проверяем профиль при отсутствии заведений — показываем ожидание
  if (venuesList.length === 0 && !freeAgentProfileChecked && !loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <p className="text-slate-500">Проверка профиля…</p>
      </main>
    );
  }

  // Экран выбора заведения при нескольких привязках
  if (venuesList.length > 1 && !currentVenueId && !loading) {
    return (
      <StaffVenuePicker
        venues={venuesList}
        onSelect={handleVenueSelect}
      />
    );
  }

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <p className="text-slate-500">Загрузка…</p>
      </main>
    );
  }

  // Нет заведений и профиль не найден (или ещё не проверен) → онбординг
  if (venuesList.length === 0 && (freeAgentProfileChecked || !staffError)) {
    return (
      <StaffOnboardingScreen
        onSuccess={() => {
          setFreeAgentProfileChecked(false);
          refreshStaffData();
        }}
      />
    );
  }

  if (staffError && !userId && !staffId) {
    return (
      <StaffOnboardingScreen
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

            <section className="rounded-2xl border-2 border-red-400 bg-red-100/90 p-5 shadow-md">
              <h2 className="text-sm font-semibold text-red-800">🚨 SOS (ТОЛЬКО ЧП)</h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Долгое нажатие 3 сек — защита от случайного вызова.
              </p>
              <div className="mt-4">
                <button
                  type="button"
                  disabled={sosCpLoading}
                  onMouseDown={handleSosCpStart}
                  onMouseUp={handleSosCpEnd}
                  onMouseLeave={handleSosCpEnd}
                  onTouchStart={(e) => { e.preventDefault(); handleSosCpStart(); }}
                  onTouchEnd={(e) => { e.preventDefault(); handleSosCpEnd(); }}
                  onTouchCancel={handleSosCpEnd}
                  className={`w-full rounded-2xl py-5 text-lg font-bold text-white shadow-lg transition select-none touch-none ${
                    sosCpLoading ? "bg-red-400" : sosCpHoldProgress > 0 ? "bg-red-700" : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  {sosCpLoading ? "Отправка…" : sosCpHoldProgress > 0 && sosCpHoldProgress < 100 ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block h-5 w-40 rounded-full bg-red-400 overflow-hidden">
                        <span className="block h-full bg-white/90 transition-all duration-75" style={{ width: `${sosCpHoldProgress}%` }} />
                      </span>
                      Удерживайте 3 сек…
                    </span>
                  ) : "🚨 SOS (ТОЛЬКО ЧП)"}
                </button>
              </div>
            </section>

            <section className="rounded-2xl border-2 border-red-300 bg-red-50 p-5 shadow-sm">
              <h2 className="text-sm font-medium text-red-700">Вызов охраны / ЛПР</h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Удерживайте кнопку 1,5 сек — защита от случайного нажатия.
              </p>
              <div className="mt-4">
                <button
                  type="button"
                  disabled={sosEmergencyLoading}
                  onMouseDown={handleSosEmergencyStart}
                  onMouseUp={handleSosEmergencyEnd}
                  onMouseLeave={handleSosEmergencyEnd}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    handleSosEmergencyStart();
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    handleSosEmergencyEnd();
                  }}
                  onTouchCancel={handleSosEmergencyEnd}
                  className={`w-full rounded-2xl py-6 text-lg font-bold text-white shadow-lg transition select-none touch-none ${
                    sosEmergencyLoading
                      ? "bg-red-400"
                      : sosEmergencyHoldProgress > 0
                        ? "bg-red-600"
                        : "bg-red-600 hover:bg-red-700 active:bg-red-700"
                  }`}
                >
                  {sosEmergencyLoading ? (
                    "Отправка…"
                  ) : sosEmergencyHoldProgress > 0 && sosEmergencyHoldProgress < 100 ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block h-5 w-32 rounded-full bg-red-400 overflow-hidden">
                        <span
                          className="block h-full bg-white/90 transition-all duration-75"
                          style={{ width: `${sosEmergencyHoldProgress}%` }}
                        />
                      </span>
                      Удерживайте…
                    </span>
                  ) : (
                    "🚨 SOS / ВЫЗОВ ОХРАНЫ"
                  )}
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-medium text-red-600">SOS по столу</h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Введите номер стола и нажмите SOS. Кнопка активируется только для существующих столов.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={sosTableNumber}
                  onChange={(e) => {
                    setSosTableNumber(e.target.value);
                    setSosError(null);
                  }}
                  className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="№ стола"
                />
                <button
                  type="button"
                  onClick={handleSendSos}
                  disabled={
                    sosLoading ||
                    !sosTableNumber.trim() ||
                    !availableTableNumbers.includes(Number(sosTableNumber))
                  }
                  className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 ${
                    sosLoading
                      ? "bg-red-500"
                      : availableTableNumbers.includes(Number(sosTableNumber || ""))
                        ? "bg-red-600 animate-pulse"
                        : "bg-red-300"
                  }`}
                >
                  {sosLoading ? "Отправка…" : "SOS"}
                </button>
              </div>
              {sosError && (
                <p className="mt-2 text-xs text-red-600">{sosError}</p>
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
            <p className="text-xs text-slate-500">Только просмотр. Редактирование недоступно.</p>
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
  const searchParams = useSearchParams();
  const rawVenue = searchParams.get("v")?.trim() || searchParams.get("venueId")?.trim() || "current";

  return (
    <StaffProvider initialVenueFromUrl={rawVenue}>
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
