"use client";

import { useState } from "react";
import type { ExitReason } from "@/lib/types";

const EXIT_REASONS: { value: ExitReason; label: string }[] = [
  { value: "own_wish", label: "Собственное желание" },
  { value: "discipline", label: "Нарушение дисциплины" },
  { value: "professionalism", label: "Профессионализм" },
  { value: "other", label: "Другое" },
];

export default function StaffPage() {
  const [dismissModal, setDismissModal] = useState<{ staffId: string; name: string } | null>(null);
  const [exitReason, setExitReason] = useState<ExitReason>("own_wish");
  const [loading, setLoading] = useState(false);

  const handleDismissSubmit = async () => {
    if (!dismissModal) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/staff/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: dismissModal.staffId,
          exitReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      setDismissModal(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка увольнения");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">Сотрудники (Биржа труда)</h2>
      <p className="mt-2 text-sm text-gray-600">
        Цифровой паспорт: careerHistory, globalScore, skills. При увольнении ЛПР обязан выбрать
        причину — данные сотрудника перманентны и не удаляются из глобальной базы.
      </p>
      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-500">
          Список сотрудников загружается из Firestore (коллекция staff). Кнопка «Уволить» открывает
          модальное окно с выбором причины.
        </p>
        <button
          type="button"
          className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          onClick={() => setDismissModal({ staffId: "demo-staff-1", name: "Иван Петров" })}
        >
          Пример: Уволить сотрудника
        </button>
      </div>

      {dismissModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="font-semibold text-gray-900">Увольнение: {dismissModal.name}</h3>
            <p className="mt-1 text-sm text-gray-600">
              Выберите причину увольнения (обязательно для записи в паспорт).
            </p>
            <select
              className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={exitReason}
              onChange={(e) => setExitReason(e.target.value as ExitReason)}
            >
              {EXIT_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                onClick={() => setDismissModal(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                onClick={handleDismissSubmit}
                disabled={loading}
              >
                {loading ? "Сохранение…" : "Уволить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
