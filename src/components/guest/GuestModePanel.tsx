"use client";

import { useState, useCallback, useEffect } from "react";
import { Bell, Receipt } from "lucide-react";
import { IS_GEO_DEBUG } from "@/lib/geo";
import { useGeoFencing } from "@/hooks/useGeoFencing";
import { createGuestEvent } from "@/lib/guest-events";

const COOLDOWN_SEC = 30;

interface GuestModePanelProps {
  venueId: string;
  tableId: string;
  visitorId?: string | null;
  tableNumber?: number;
}

/**
 * Гостевой режим: строго 2 кнопки — «Вызвать официанта» и «Запросить счёт».
 * Перед любым уведомлением проверяем геозону заведения venue_andrey_alt.
 */
export function GuestModePanel({ venueId, tableId, visitorId, tableNumber }: GuestModePanelProps) {
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [lastAction, setLastAction] = useState<"call_waiter" | "request_bill" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoBlocked, setGeoBlocked] = useState(false);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);

  const { ensureInsideVenue } = useGeoFencing({
    mode: "guest",
    venueId,
    tableId,
    sessionOpen: true,
    startAfterUserAction: true,
  });

  // Гео-проверка при загрузке: запрашиваем координаты и блокируем кнопки, если гость вне радиуса
  const [geoChecked, setGeoChecked] = useState(false);
  useEffect(() => {
    if (IS_GEO_DEBUG) {
      setGeoChecked(true);
      return;
    }
    let cancelled = false;
    ensureInsideVenue().then((check) => {
      if (cancelled) return;
      setGeoChecked(true);
      if (!check.allowed) {
        setGeoBlocked(true);
        setGeoMessage("❌ Вы слишком далеко от ресторана");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ensureInsideVenue]);

  const disabled = !geoChecked || geoBlocked || cooldownLeft > 0 || loading;

  const runRequest = useCallback(
    async (type: "call_waiter" | "request_bill") => {
      if (disabled) return;
      setLoading(true);
      setError(null);
      setGeoMessage(null);
      try {
        if (!IS_GEO_DEBUG) {
          const check = await ensureInsideVenue();
          if (!check.allowed) {
            setGeoBlocked(true);
            setGeoMessage("Функции доступны только в ресторане");
            return;
          }
        }

        await createGuestEvent({
          type,
          tableId,
          tableNumber,
          visitorId: visitorId ?? undefined,
        });
        setLastAction(type);
        setCooldownLeft(COOLDOWN_SEC);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка");
      } finally {
        setLoading(false);
      }
    },
    [venueId, tableId, tableNumber, visitorId, disabled]
  );

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const t = setInterval(() => setCooldownLeft((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldownLeft]);

  return (
    <div className="flex min-h-[50vh] flex-col gap-0 sm:min-h-[60vh] md:grid md:grid-cols-1 md:grid-rows-2 md:min-h-[70vh]">
      {/* Кнопка 1: Вызвать официанта */}
      <div className="flex flex-1 flex-col items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => runRequest("call_waiter")}
          className="flex flex-1 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 disabled:pointer-events-none disabled:opacity-60 disabled:bg-slate-100 disabled:border-slate-200 md:rounded-3xl md:p-8"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 md:h-20 md:w-20">
            <Bell className="h-8 w-8 md:h-10 md:w-10" />
          </span>
          <span className="text-lg font-semibold text-slate-800 md:text-xl">Вызвать официанта</span>
          {loading && lastAction === "call_waiter" && (
            <span className="text-sm text-slate-500">Отправка…</span>
          )}
        </button>
        {geoBlocked && geoMessage && (
          <p className="text-center text-sm font-medium text-red-600">
            {geoMessage}
          </p>
        )}
      </div>

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
        {!error && cooldownLeft === 0 && !loading && !geoMessage && (
          <p className="text-sm text-slate-500">
            Стол №{tableNumber != null ? tableNumber : tableId}
          </p>
        )}
        {geoBlocked && geoMessage && (
          <p className="text-sm text-red-600">{geoMessage}</p>
        )}
        {IS_GEO_DEBUG && (
          <p className="mt-2 text-xs text-slate-400">🛠 Debug: GPS-проверка отключена</p>
        )}
      </div>
    </div>
  );
}
