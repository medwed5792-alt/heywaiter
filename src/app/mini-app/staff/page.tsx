"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Briefcase, User, Bell, Calendar, Coins } from "lucide-react";
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

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function StaffContentInner() {
  const router = useRouter();
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

  const { userId, staffId, onShift } = staffData;

  const fetchNotifications = useCallback(async () => {
    if (!staffId || !currentVenueId) return;
    try {
      const res = await fetch(
        `/api/staff/notifications?staffId=${encodeURIComponent(staffId)}&venueId=${encodeURIComponent(currentVenueId)}&limit=30`
      );
      const data = await res.json();
      if (res.ok && Array.isArray(data.notifications)) {
        setNotifications(data.notifications);
      }
    } catch (_e) {
      // ignore
    }
  }, [staffId, currentVenueId]);

  useEffect(() => {
    fetchNotifications();
    if (!staffId) return;
    const t = setInterval(fetchNotifications, NOTIFICATIONS_POLL_MS);
    return () => clearInterval(t);
  }, [staffId, fetchNotifications]);

  // Гео-валидация: загрузка настроек заведения и проверка дистанции (haversineDistanceM из geo.ts)
  useEffect(() => {
    if (!currentVenueId || onShift) {
      setVenueGeo(null);
      setGeoBlocked(false);
      setGeoMessage(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setGeoLoading(true);
      try {
        const res = await fetch(`/api/venues/${encodeURIComponent(currentVenueId)}/geo`);
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
  }, [currentVenueId, onShift]);

  const handleVenueSelect = useCallback(
    (selectedId: string) => {
      setCurrentVenue(selectedId);
      router.replace(`/mini-app/staff?${new URLSearchParams({ v: selectedId }).toString()}`);
    },
    [setCurrentVenue, router]
  );

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
          ...(userId && !staffId && { userId, venueId: currentVenueId }),
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

  if (staffError && !userId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <p className="text-center text-red-600">{staffError}</p>
      </main>
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
              <p className="mt-2 text-sm text-slate-500">Здесь отображается ваше расписание. Редактирование в админ-панели заведения.</p>
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
