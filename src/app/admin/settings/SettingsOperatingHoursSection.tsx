import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import toast from "react-hot-toast";
import { DEFAULT_VENUE_ID as venueId } from "@/lib/standards/venue-default";

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

interface OperatingDay {
  working: boolean;
  openTime: string;
  closeTime: string;
}

type OperatingHours = Record<DayKey, OperatingDay>;

const DAY_LABELS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "Понедельник" },
  { key: "tue", label: "Вторник" },
  { key: "wed", label: "Среда" },
  { key: "thu", label: "Четверг" },
  { key: "fri", label: "Пятница" },
  { key: "sat", label: "Суббота" },
  { key: "sun", label: "Воскресенье" },
];

const defaultDay: OperatingDay = {
  working: true,
  openTime: "09:00",
  closeTime: "23:00",
};

const defaultHours: OperatingHours = {
  mon: { ...defaultDay },
  tue: { ...defaultDay },
  wed: { ...defaultDay },
  thu: { ...defaultDay },
  fri: { ...defaultDay },
  sat: { ...defaultDay },
  sun: { ...defaultDay, working: false },
};

export function SettingsOperatingHoursSection() {
  const [hours, setHours] = useState<OperatingHours>(defaultHours);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "venues", venueId));
        if (!snap.exists() || cancelled) return;
        const data = snap.data() as any;
        const stored = (data?.operatingHours ?? {}) as Partial<OperatingHours>;
        const next: OperatingHours = { ...defaultHours };
        (Object.keys(next) as DayKey[]).forEach((key) => {
          const fromDb = stored[key];
          if (fromDb && typeof fromDb === "object") {
            next[key] = {
              working: fromDb.working ?? defaultDay.working,
              openTime: fromDb.openTime || defaultDay.openTime,
              closeTime: fromDb.closeTime || defaultDay.closeTime,
            };
          }
        });
        if (!cancelled) setHours(next);
      } catch {
        // ignore, оставляем дефолт
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChangeDay = (day: DayKey, patch: Partial<OperatingDay>) => {
    setHours((prev) => ({
      ...prev,
      [day]: { ...prev[day], ...patch },
    }));
  };

  const handleSaveOperatingHours = async () => {
    setSaving(true);
    try {
      const ref = doc(db, "venues", venueId);
      await setDoc(
        ref,
        {
          operatingHours: hours,
          updatedAt: new Date(),
        },
        { merge: true }
      );
      toast.success("График работы обновлён");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить режим работы");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-900">Режим работы</h4>
        <button
          type="button"
          onClick={handleSaveOperatingHours}
          disabled={saving}
          className="inline-flex items-center rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-gray-800 disabled:opacity-60"
        >
          {saving ? "Сохранение..." : "Сохранить"}
        </button>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Укажите рабочие дни и часы открытия / закрытия. Используется для авто-сброса смен и подсказок на дашборде.
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-gray-500">Загрузка текущих настроек...</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {DAY_LABELS.map(({ key, label }) => {
            const day = hours[key];
            return (
              <div
                key={key}
                className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs sm:text-sm flex flex-col gap-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-800">{label}</span>
                  <label className="inline-flex items-center gap-1 text-[11px] sm:text-xs text-gray-700">
                    <input
                      type="checkbox"
                      className="h-3 w-3 rounded border-gray-300 text-gray-900 focus:ring-gray-500"
                      checked={day.working}
                      onChange={(e) => handleChangeDay(key, { working: e.target.checked })}
                    />
                    <span>{day.working ? "Рабочий день" : "Выходной"}</span>
                  </label>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-2 items-center">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] text-gray-500">Открытие</span>
                    <input
                      type="time"
                      className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs sm:text-sm"
                      value={day.openTime}
                      onChange={(e) => handleChangeDay(key, { openTime: e.target.value })}
                      disabled={!day.working}
                    />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] text-gray-500">Закрытие</span>
                    <input
                      type="time"
                      className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs sm:text-sm"
                      value={day.closeTime}
                      onChange={(e) => handleChangeDay(key, { closeTime: e.target.value })}
                      disabled={!day.working}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

