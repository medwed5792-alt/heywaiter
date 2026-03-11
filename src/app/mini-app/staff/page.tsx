"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Briefcase, User, Bell, Calendar, Coins } from "lucide-react";

const DEFAULT_VENUE_ID = "current";
const POLL_MS = 8000;
const NOTIFICATIONS_POLL_MS = 5000;

type Tab = "work" | "cabinet";

type TelegramWebApp = {
  initDataUnsafe?: { user?: { id?: number } };
  ready?: () => void;
};

function getTelegramUserId(): string | null {
  if (typeof window === "undefined") return null;
  const tg = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  const id = tg?.initDataUnsafe?.user?.id;
  return id != null ? String(id) : null;
}

interface NotificationItem {
  id: string;
  message: string;
  tableId: string | null;
  venueId: string | null;
  type: string | null;
  read: boolean;
  createdAt: string | null;
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

export default function MiniAppStaffPage() {
  const searchParams = useSearchParams();
  const venueId = (searchParams.get("v")?.trim() || searchParams.get("venueId")?.trim() || DEFAULT_VENUE_ID);
  const [tab, setTab] = useState<Tab>("work");
  const [userId, setUserId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [onShift, setOnShift] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const fetchMe = useCallback(async () => {
    const telegramId = getTelegramUserId();
    if (!telegramId) {
      setError("Откройте приложение из Telegram");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/staff/me?venueId=${encodeURIComponent(venueId)}&telegramId=${encodeURIComponent(telegramId)}`
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Не удалось загрузить данные");
        setLoading(false);
        return;
      }
      setUserId(data.userId);
      setStaffId(data.staffId);
      setOnShift(data.onShift === true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      setLoading(false);
    }
  }, [venueId]);

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
    fetchMe();
  }, [fetchMe]);

  useEffect(() => {
    if (!userId || loading) return;
    const t = setInterval(fetchMe, POLL_MS);
    return () => clearInterval(t);
  }, [userId, loading, fetchMe]);

  useEffect(() => {
    fetchNotifications();
    if (!staffId) return;
    const t = setInterval(fetchNotifications, NOTIFICATIONS_POLL_MS);
    return () => clearInterval(t);
  }, [staffId, fetchNotifications]);

  const handleShiftAction = async () => {
    if (actionLoading) return;
    if (!staffId && !userId) return;
    setActionLoading(true);
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
      setOnShift(data.onShift === true);
      setError(null);
      fetchMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка смены");
    } finally {
      setActionLoading(false);
    }
  };

  if (typeof window !== "undefined" && (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp) {
    (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp?.ready?.();
  }

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <p className="text-slate-500">Загрузка…</p>
      </main>
    );
  }

  if (error && !userId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <p className="text-center text-red-600">{error}</p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 md:flex md:max-w-2xl md:mx-auto md:shadow-lg">
      {/* Переключатель Работа / Кабинет */}
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
            {/* Кнопка смены */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-medium text-slate-500">Смена</h2>
              <p className="mt-0.5 text-slate-700">
                {onShift ? "Вы на смене" : "Вы не на смене"}
              </p>
              {error && (
                <p className="mt-2 text-sm text-red-600">{error}</p>
              )}
              <button
                type="button"
                onClick={handleShiftAction}
                disabled={actionLoading}
                className={`mt-4 w-full rounded-xl py-4 text-base font-semibold text-white transition-opacity disabled:opacity-50 ${
                  onShift ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {actionLoading
                  ? "…"
                  : onShift
                    ? "Завершить смену"
                    : "Начать смену"}
              </button>
            </section>

            {/* Лог вызовов */}
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
          </div>
        )}

        {tab === "cabinet" && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">Только просмотр. Редактирование недоступно.</p>

            {/* Мой График */}
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-700">
                <Calendar className="h-5 w-5 text-slate-500" />
                <h3 className="font-medium">Мой график</h3>
              </div>
              <p className="mt-2 text-sm text-slate-500">Здесь отображается ваше расписание. Редактирование в админ-панели заведения.</p>
            </section>

            {/* Биржа смен */}
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-700">
                <Briefcase className="h-5 w-5 text-slate-500" />
                <h3 className="font-medium">Биржа смен</h3>
              </div>
              <p className="mt-2 text-sm text-slate-500">Обмен сменами с коллегами. Доступ только для просмотра в приложении.</p>
            </section>

            {/* Мои чаевые */}
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
