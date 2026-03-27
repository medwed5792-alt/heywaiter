"use client";

import { useState } from "react";

type GuestWelcomeScreenProps = {
  staffDisplayName: string | null;
  onComplete: () => void;
};

/**
 * Экран посадки: после приветствия гость подтверждает готовность — затем оживают кнопки сервиса.
 */
export function GuestWelcomeScreen({ staffDisplayName, onComplete }: GuestWelcomeScreenProps) {
  const [leaving, setLeaving] = useState(false);

  const handleProceed = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => onComplete(), 450);
  };

  return (
    <main className="min-h-[60vh] flex flex-col items-center justify-center px-4 py-8">
      <div
        className={`w-full max-w-md rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-8 text-center shadow-lg ${
          leaving ? "sota-welcome-leave" : "transition-opacity duration-300"
        }`}
      >
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Добро пожаловать</p>
        <p className="mt-4 text-lg font-semibold text-slate-900">
          Вас обслуживает{" "}
          {staffDisplayName ? (
            <span className="text-emerald-800">{staffDisplayName}</span>
          ) : (
            <span className="text-slate-600">персонал зала</span>
          )}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Когда будете готовы вызывать персонал или смотреть счёт — нажмите ниже.
        </p>
        <button
          type="button"
          onClick={handleProceed}
          disabled={leaving}
          className="mt-8 w-full rounded-xl bg-emerald-600 py-4 text-base font-bold text-white shadow-md transition hover:bg-emerald-700 disabled:opacity-60"
        >
          Приступить к обслуживанию
        </button>
        <p className="mt-3 text-xs text-slate-500">Меню и вызов персонала</p>
      </div>
    </main>
  );
}
