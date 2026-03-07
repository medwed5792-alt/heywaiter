"use client";

import { useState, useEffect } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ExitReason, Staff } from "@/lib/types";

const VENUE_ID = "current";

const EXIT_REASONS: { value: ExitReason; label: string }[] = [
  { value: "own_wish", label: "Собственное желание" },
  { value: "professionalism", label: "Профессионализм" },
  { value: "discipline", label: "Нарушение дисциплины" },
  { value: "conflict", label: "Конфликтность" },
  { value: "other", label: "Другое" },
];

function StaffRow({
  staff,
  onDismiss,
}: {
  staff: Staff;
  onDismiss: (staff: Staff) => void;
}) {
  const name = staff.identity?.name ?? staff.identity?.username ?? staff.id;
  const isActive = staff.active !== false;

  return (
    <tr className="border-b border-gray-100">
      <td className="p-3 text-sm">{name}</td>
      <td className="p-3 text-sm text-gray-600">{staff.position ?? staff.role ?? "—"}</td>
      <td className="p-3 text-sm">{staff.globalScore != null ? `${staff.globalScore}` : "—"}</td>
      <td className="p-3 text-sm">{isActive ? "Активен" : "Уволен"}</td>
      <td className="p-3">
        {isActive && (
          <button
            type="button"
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
            onClick={() => onDismiss(staff)}
          >
            Уволить
          </button>
        )}
      </td>
    </tr>
  );
}

export default function StaffPage() {
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dismissModal, setDismissModal] = useState<Staff | null>(null);
  const [exitReason, setExitReason] = useState<ExitReason>("own_wish");
  const [rating, setRating] = useState(3);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const q = query(collection(db, "staff"), where("venueId", "==", VENUE_ID));
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Staff));
      setStaffList(list);
      setLoaded(true);
    })();
  }, []);

  const handleDismiss = (staff: Staff) => {
    setDismissModal(staff);
    setExitReason("own_wish");
    setRating(3);
  };

  const handleDismissSubmit = async () => {
    if (!dismissModal) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/staff/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: dismissModal.id,
          exitReason,
          rating,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      setStaffList((prev) =>
        prev.map((s) => (s.id === dismissModal.id ? { ...s, active: false } : s))
      );
      setDismissModal(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка увольнения");
    } finally {
      setLoading(false);
    }
  };

  const dismissName = dismissModal?.identity?.name ?? dismissModal?.identity?.username ?? dismissModal?.id ?? "";

  return (
    <div>
      <div className="w-full max-w-2xl">
        <h2 className="text-lg font-semibold text-gray-900">Сотрудники (Биржа труда)</h2>
        <p className="mt-2 text-sm text-gray-600">
          Цифровой паспорт: careerHistory, globalScore, skills. При увольнении ЛПР обязан выбрать причину и оценку — данные не удаляются.
        </p>

        {!loaded ? (
          <p className="mt-4 text-sm text-gray-500">Загрузка…</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[400px]">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="p-3 text-left text-xs font-medium text-gray-600">Имя</th>
                  <th className="p-3 text-left text-xs font-medium text-gray-600">Должность</th>
                  <th className="p-3 text-left text-xs font-medium text-gray-600">Рейтинг</th>
                  <th className="p-3 text-left text-xs font-medium text-gray-600">Статус</th>
                  <th className="p-3 text-left text-xs font-medium text-gray-600">Действие</th>
                </tr>
              </thead>
              <tbody>
                {staffList.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-sm text-gray-500">
                      Нет сотрудников по этому заведению.
                    </td>
                  </tr>
                ) : (
                  staffList.map((s) => (
                    <StaffRow key={s.id} staff={s} onDismiss={handleDismiss} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dismissModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="font-semibold text-gray-900">Увольнение: {dismissName}</h3>
            <p className="mt-1 text-sm text-gray-600">
              Причина и оценка обязательны для записи в паспорт (Биржа труда).
            </p>
            <label className="mt-3 block text-sm font-medium text-gray-700">Причина</label>
            <select
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={exitReason}
              onChange={(e) => setExitReason(e.target.value as ExitReason)}
            >
              {EXIT_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <label className="mt-3 block text-sm font-medium text-gray-700">Оценка сотрудника (1–5)</label>
            <div className="mt-1 flex gap-1" role="group" aria-label="Оценка 1-5 звёзд">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className="rounded p-1 text-lg focus:outline-none focus:ring-2 focus:ring-gray-400"
                  aria-pressed={rating === star}
                >
                  <span className={rating >= star ? "text-amber-500" : "text-gray-300"}>★</span>
                </button>
              ))}
            </div>
            <p className="mt-0.5 text-xs text-gray-500">{rating} из 5</p>
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

