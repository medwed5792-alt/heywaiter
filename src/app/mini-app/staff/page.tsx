"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";

const DEFAULT_VENUE_ID = "current";
const POLL_MS = 8000;

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

export default function MiniAppStaffPage() {
  const searchParams = useSearchParams();
  const venueId = searchParams.get("venueId")?.trim() || DEFAULT_VENUE_ID;
  const [userId, setUserId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [onShift, setOnShift] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  useEffect(() => {
    if (!userId || loading) return;
    const t = setInterval(fetchMe, POLL_MS);
    return () => clearInterval(t);
  }, [userId, loading, fetchMe]);

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
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6" style={{ zoom: 0.9 }}>
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-center text-lg font-semibold text-slate-900">Смена</h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          {onShift ? "Вы на смене" : "Вы не на смене"}
        </p>
        {error && (
          <p className="mt-2 text-center text-sm text-red-600">{error}</p>
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
      </div>
    </main>
  );
}
