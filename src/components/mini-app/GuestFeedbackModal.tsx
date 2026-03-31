"use client";

import { useState } from "react";

type GuestFeedbackModalProps = {
  open: boolean;
  onClose: () => void;
  onLeaveTip: (amount: number) => Promise<void>;
};

const TIP_PRESETS = [100, 200, 500] as const;

export function GuestFeedbackModal({ open, onClose, onLeaveTip }: GuestFeedbackModalProps) {
  const [stars, setStars] = useState(0);
  const [submittingTip, setSubmittingTip] = useState(false);
  const [amount, setAmount] = useState<number>(TIP_PRESETS[0]);

  if (!open) return null;

  const leaveTip = async () => {
    setSubmittingTip(true);
    try {
      await onLeaveTip(amount);
    } finally {
      setSubmittingTip(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/50">
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-8">
        <section className="w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
          <h3 className="text-center text-xl font-bold text-slate-900">Спасибо за визит!</h3>
          <p className="mt-2 text-center text-sm text-slate-600">Оцените обслуживание и при желании оставьте чаевые.</p>

          <div className="mt-4 flex items-center justify-center gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setStars(n)}
                className={`text-3xl leading-none ${n <= stars ? "text-amber-400" : "text-slate-300"}`}
                aria-label={`Поставить ${n} звезд`}
              >
                ★
              </button>
            ))}
          </div>

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
                {v} ₽
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void leaveTip()}
            disabled={submittingTip}
            className="mt-4 w-full rounded-xl bg-emerald-600 py-3 text-base font-bold text-white disabled:opacity-50"
          >
            {submittingTip ? "Отправка..." : "Оставить чаевые"}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-700"
          >
            Закрыть
          </button>
        </section>
      </div>
    </div>
  );
}
