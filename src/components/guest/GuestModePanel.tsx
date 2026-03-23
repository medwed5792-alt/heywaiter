"use client";

import { useState, useCallback, useEffect } from "react";
import { Bell, Receipt } from "lucide-react";
import { createGuestEvent } from "@/lib/guest-events";

const COOLDOWN_SEC = 30;

interface GuestModePanelProps {
  venueId: string;
  tableId: string;
  customerUid?: string | null;
  /** @deprecated use customerUid */
  visitorId?: string | null;
  tableNumber?: number;
}

/**
 * Гостевой режим: «Вызвать официанта» и «Запросить счёт».
 */
export function GuestModePanel({ venueId, tableId, customerUid, visitorId, tableNumber }: GuestModePanelProps) {
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [lastAction, setLastAction] = useState<"call_waiter" | "request_bill" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = cooldownLeft > 0 || loading;

  const runRequest = useCallback(
    async (type: "call_waiter" | "request_bill") => {
      if (disabled) return;
      setLoading(true);
      setError(null);
      try {
        await createGuestEvent({
          type,
          venueId,
          tableId,
          tableNumber,
          customerUid: customerUid ?? visitorId ?? undefined,
        });
        setLastAction(type);
        setCooldownLeft(COOLDOWN_SEC);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка");
      } finally {
        setLoading(false);
      }
    },
    [venueId, tableId, tableNumber, customerUid, visitorId, disabled]
  );

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const t = setInterval(() => setCooldownLeft((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldownLeft]);

  return (
    <div className="flex min-h-[50vh] flex-col gap-0 sm:min-h-[60vh] md:grid md:grid-cols-1 md:grid-rows-2 md:min-h-[70vh]">
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
      </div>

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
        {!error && cooldownLeft === 0 && !loading && tableNumber != null && (
          <p className="text-sm text-slate-500">
            Стол №{tableNumber}
          </p>
        )}
      </div>
    </div>
  );
}
