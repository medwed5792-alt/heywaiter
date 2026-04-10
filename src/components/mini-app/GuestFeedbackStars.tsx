"use client";

import { useCallback, useState } from "react";
import { getIdToken } from "firebase/auth";
import toast from "react-hot-toast";
import { auth } from "@/lib/firebase";

const TIP_PRESETS = [100, 200, 500] as const;

type TelegramWebAppInit = {
  initData?: string;
};

function getTelegramWebApp(): TelegramWebAppInit | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebAppInit } }).Telegram?.WebApp;
}

type GuestFeedbackStarsProps = {
  /** swid — id документа staff для staff_wallets */
  walletStaffId: string | null;
  venueId: string;
  tableId: string;
  customerUid: string;
  activeSessionId: string;
  title?: string;
  subtitle?: string;
  /** Завершить визит без чаевых */
  onFinalize: () => void | Promise<void>;
};

/**
 * Экран звёзд + «Спасибо» с привязкой к кошельку официанта (real-time swid из сессии).
 * Отзыв пишется в `reviews` (sessionId + venueId) при выборе звёзд и перед финализацией визита.
 */
export function GuestFeedbackStars({
  walletStaffId,
  venueId,
  tableId,
  customerUid,
  activeSessionId,
  title = "Спасибо за визит!",
  subtitle = "Оцените обслуживание. Кнопка «Спасибо» отправит чаевые выбранному официанту.",
  onFinalize,
}: GuestFeedbackStarsProps) {
  const [stars, setStars] = useState(0);
  const [amount, setAmount] = useState<number>(TIP_PRESETS[0]);
  const [busy, setBusy] = useState(false);

  const persistReview = useCallback(
    async (starCount: number) => {
      const tg = getTelegramWebApp();
      const initData = typeof tg?.initData === "string" ? tg.initData.trim() : "";
      if (!initData) return;
      const v = venueId.trim();
      const t = tableId.trim();
      const sid = activeSessionId.trim();
      const uid = customerUid.trim();
      if (!v || !t || !sid || !uid) return;
      try {
        const res = await fetch("/api/guest/session-review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            initData,
            venueId: v,
            tableId: t,
            sessionId: sid,
            customerUid: uid,
            stars: starCount,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          console.warn("[GuestFeedbackStars] session-review", data.error ?? res.status);
        }
      } catch (e) {
        console.warn("[GuestFeedbackStars] session-review", e);
      }
    },
    [venueId, tableId, activeSessionId, customerUid]
  );

  const runThankYou = async () => {
    if (!walletStaffId?.trim()) {
      toast.error("Не удалось определить официанта для чаевых");
      return;
    }
    const user = auth.currentUser;
    if (!user) {
      toast.error("Нет сессии Firebase для оплаты чаевых");
      return;
    }
    setBusy(true);
    try {
      await persistReview(stars);
      const token = await getIdToken(user);
      const res = await fetch("/api/guest/tips", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          venueId: venueId.trim(),
          customerUid: customerUid.trim(),
          amount,
          staffId: walletStaffId.trim(),
          sessionTip: true,
          activeSessionId: activeSessionId.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Не удалось отправить чаевые");
      }
      toast.success("Спасибо! Чаевые отправлены.");
      await onFinalize();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  const skipTips = async () => {
    setBusy(true);
    try {
      await persistReview(stars);
      await onFinalize();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/50">
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-8">
        <section className="w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
          <h3 className="text-center text-xl font-bold text-slate-900">{title}</h3>
          <p className="mt-2 text-center text-sm text-slate-600">{subtitle}</p>

          <div className="mt-4 flex items-center justify-center gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setStars(n);
                  void persistReview(n);
                }}
                className={`text-3xl leading-none ${n <= stars ? "text-amber-400" : "text-slate-300"}`}
                aria-label={`Поставить ${n} звезд`}
              >
                {"\u2605"}
              </button>
            ))}
          </div>

          {walletStaffId?.trim() ? (
            <>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {TIP_PRESETS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAmount(v)}
                    className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
                      amount === v ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    {v} {"\u20BD"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void runThankYou()}
                disabled={busy}
                className="mt-4 w-full rounded-xl bg-emerald-600 py-3 text-base font-bold text-white disabled:opacity-50"
              >
                {busy ? "Отправка…" : "Спасибо"}
              </button>
            </>
          ) : (
            <p className="mt-3 text-center text-xs text-amber-800">
              Официант не указан в сессии — чаевые недоступны. Нажмите «Готово», чтобы завершить визит.
            </p>
          )}

          <button
            type="button"
            onClick={() => void skipTips()}
            disabled={busy}
            className="mt-3 w-full rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            {walletStaffId?.trim() ? "Без чаевых, готово" : "Готово"}
          </button>
        </section>
      </div>
    </div>
  );
}
