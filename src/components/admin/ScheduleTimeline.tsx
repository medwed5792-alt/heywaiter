"use client";

import { useCallback, useState } from "react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ScheduleEntry, ServiceRole } from "@/lib/types";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_WIDTH = 28;
const ROW_HEIGHT = 44;

interface ScheduleTimelineProps {
  entries: ScheduleEntry[];
  selectedDate: string;
  /** staffId -> true если сотрудник на смене, но не в зоне GPS */
  outOfZoneStaffIds?: Set<string>;
  venueId: string;
  onCloseShift?: (entryId: string) => void;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/** Преобразуем planHours в диапазон часов (например 8 ч с 10:00 = 10–18) */
function planToRange(planHours: number, startHour: number = 10): [number, number] {
  const end = startHour + planHours;
  return [Math.max(0, startHour), Math.min(24, end)];
}

export function ScheduleTimeline({
  entries,
  selectedDate,
  outOfZoneStaffIds = new Set(),
  venueId,
  onCloseShift,
}: ScheduleTimelineProps) {
  const [closingId, setClosingId] = useState<string | null>(null);

  const handleCloseShift = useCallback(
    async (entry: ScheduleEntry) => {
      setClosingId(entry.id);
      try {
        await updateDoc(doc(db, "staff", entry.staffId), {
          onShift: false,
          updatedAt: serverTimestamp(),
        });
        onCloseShift?.(entry.id);
      } catch (e) {
        console.error(e);
      } finally {
        setClosingId(null);
      }
    },
    [onCloseShift]
  );

  const byStaff = entries.reduce(
    (acc, e) => {
      const key = e.staffId;
      if (!acc[key]) acc[key] = [];
      acc[key].push(e);
      return acc;
    },
    {} as Record<string, ScheduleEntry[]>
  );
  const staffRows = Object.entries(byStaff);

  return (
    <div className="overflow-x-auto overflow-y-auto rounded-xl border border-gray-200 bg-white">
      <div className="min-w-[800px]">
        {/* Заголовок часов */}
        <div className="sticky top-0 z-10 flex border-b border-gray-200 bg-gray-50">
          <div className="w-32 shrink-0 border-r border-gray-200 py-2 pl-3 text-xs font-medium text-gray-600">
            Сотрудник / Час
          </div>
          <div className="flex">
            {HOURS.map((h) => (
              <div
                key={h}
                className="shrink-0 border-r border-gray-100 py-2 text-center text-xs text-gray-500"
                style={{ width: HOUR_WIDTH }}
              >
                {h}
              </div>
            ))}
          </div>
        </div>

        {staffRows.map(([staffId, staffEntries]) => {
          const entry = staffEntries[0];
          const planHours = entry.planHours ?? 0;
          const factHours = entry.factHours ?? 0;
          const [planStart, planEnd] = planToRange(planHours);
          const factExceedsPlan = factHours > planHours;
          const outOfZone = outOfZoneStaffIds.has(staffId);
          const showRed = factExceedsPlan || outOfZone;

          return (
            <div
              key={staffId}
              className="flex border-b border-gray-100"
              style={{ minHeight: ROW_HEIGHT }}
            >
              <div className="flex w-32 shrink-0 items-center justify-between gap-1 border-r border-gray-200 bg-gray-50/50 px-2 py-1">
                <span className="truncate text-xs font-medium text-gray-800">
                  {staffId.slice(0, 8)}…
                </span>
                <span className="shrink-0 text-xs text-gray-500">{entry.role ?? "—"}</span>
              </div>
              <div className="relative flex flex-1" style={{ width: HOURS.length * HOUR_WIDTH }}>
                {/* Синий блок — план */}
                <div
                  className="absolute inset-y-1 rounded bg-blue-500/70"
                  style={{
                    left: `${(planStart / 24) * 100}%`,
                    width: `${((planEnd - planStart) / 24) * 100}%`,
                  }}
                  title={`План: ${planHours} ч`}
                />
                {/* Зелёный нахлёст — факт */}
                {factHours > 0 && (
                  <div
                    className="absolute inset-y-1 rounded bg-green-500/80"
                    style={{
                      left: `${(planStart / 24) * 100}%`,
                      width: `${Math.min((factHours / 24) * 100, 100 - (planStart / 24) * 100)}%`,
                    }}
                    title={`Факт: ${round1(factHours)} ч`}
                  />
                )}
                {/* Красный индикатор: факт > план или не в зоне GPS */}
                {showRed && (
                  <div
                    className="absolute right-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-red-500"
                    title={outOfZone ? "Не в зоне GPS" : "Факт превышает план"}
                  />
                )}
                {/* Кнопка "Закрыть смену" для ЛПР */}
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  <button
                    type="button"
                    onClick={() => handleCloseShift(entry)}
                    disabled={!!closingId}
                    className="rounded bg-gray-800 px-2 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                  >
                    {closingId === entry.id ? "…" : "Закрыть смену"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {staffRows.length === 0 && (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500">
            Нет данных за выбранную дату
          </div>
        )}
      </div>
    </div>
  );
}
