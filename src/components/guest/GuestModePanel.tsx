"use client";

import { useState, useCallback, useEffect } from "react";
import { Bell, Receipt } from "lucide-react";
import { IS_GEO_DEBUG } from "@/lib/geo";

const COOLDOWN_SEC = 30;

interface GuestModePanelProps {
  venueId: string;
  tableId: string;
  visitorId?: string | null;
}

/**
 * Гостевой режим: строго 2 кнопки — «Вызвать официанта» и «Запросить счёт».
 * При IS_GEO_DEBUG кнопки активны везде (GPS-проверка не блокирует).
 */
export function GuestModePanel({ venueId, tableId, visitorId }: GuestModePanelProps) {
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [lastAction, setLastAction] = useState<"call_waiter" | "request_bill" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // В Debug-режиме кнопки не блокируются геозоной; иначе можно добавить проверку checkGeoPosition
  const disabled = cooldownLeft > 0 || loading;

  const runRequest = useCallback(
    async (type: "call_waiter" | "request_bill") => {
      if (disabled) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/notifications/call-waiter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            venueId,
            tableId,
            type,
            visitorId: visitorId ?? undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error((data as { error?: string }).error ?? "Ошибка вызова");
        setLastAction(type);
        setCooldownLeft(COOLDOWN_SEC);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка");
      } finally {
        setLoading(false);
      }
    },
    [venueId, tableId, visitorId, disabled]
  );

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const t = setInterval(() => setCooldownLeft((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldownLeft]);

  return (
    <div className="flex min-h-[50vh] flex-col gap-0 sm:min-h-[60vh] md:grid md:grid-cols-1 md:grid-rows-2 md:min-h-[70vh]">
      {/* Кнопка 1: Вызвать официанта */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => runRequest("call_waiter")}
        className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 disabled:pointer-events-none disabled:opacity-60 md:rounded-3xl md:p-8"
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 md:h-20 md:w-20">
          <Bell className="h-8 w-8 md:h-10 md:w-10" />
        </span>
        <span className="text-lg font-semibold text-slate-800 md:text-xl">Вызвать официанта</span>
        {loading && lastAction === "call_waiter" && (
          <span className="text-sm text-slate-500">Отправка…</span>
        )}
      </button>

      {/* Кнопка 2: Запросить счёт */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => runRequest("request_bill")}
        className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm transition-colors hover:border-amber-200 hover:bg-amber-50/50 disabled:pointer-events-none disabled:opacity-60 md:rounded-3xl md:p-8"
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600 md:h-20 md:w-20">
          <Receipt className="h-8 w-8 md:h-10 md:w-10" />
        </span>
        <span className="text-lg font-semibold text-slate-800 md:text-xl">Запросить счёт</span>
        {loading && lastAction === "request_bill" && (
          <span className="text-sm text-slate-500">Отправка…</span>
        )}
      </button>

      {/* Обратная связь и таймер */}
      <div className="col-span-full mt-4 rounded-xl border border-slate-200 bg-white p-4 text-center">
        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}
        {cooldownLeft > 0 && (
          <>
            <p className="text-base font-medium text-emerald-700">
              Официант уведомлён, уже бежим к вам!
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Следующий вызов через {cooldownLeft} сек
            </p>
          </>
        )}
        {!error && cooldownLeft === 0 && !loading && (
          <p className="text-sm text-slate-500">Стол №{tableId}</p>
        )}
        {IS_GEO_DEBUG && (
          <p className="mt-2 text-xs text-slate-400">🛠 Debug: GPS-проверка отключена</p>
        )}
      </div>
    </div>
  );
}
