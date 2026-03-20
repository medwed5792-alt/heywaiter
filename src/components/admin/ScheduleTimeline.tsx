"use client";

import { useCallback, useState } from "react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ScheduleEntry, ShiftSlot, ServiceRole, Staff } from "@/lib/types";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_WIDTH = 28;
const ROW_HEIGHT = 44;

interface ScheduleTimelineProps {
  entries: ScheduleEntry[];
  selectedDate: string;
  outOfZoneStaffIds?: Set<string>;
  venueId: string;
  staffList?: Staff[];
  onCloseShift?: (entryId: string) => void;
  onCellClick?: (date: string, hour: number) => void;
  onEntryClick?: (entry: ScheduleEntry) => void;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/** startTime/endTime (HH:mm) в доли суток 0..1. Защита от отсутствующего или неверного формата. */
function timeToFraction(t: string | undefined): number {
  const s = t ?? "10:00";
  const [h, m] = s.split(":").map(Number);
  const h0 = Number.isFinite(h) ? h : 10;
  const m0 = Number.isFinite(m) ? m : 0;
  return h0 / 24 + m0 / (24 * 60);
}

export function ScheduleTimeline({
  entries,
  selectedDate,
  outOfZoneStaffIds = new Set(),
  venueId,
  staffList = [],
  onCloseShift,
  onCellClick,
  onEntryClick,
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

  const entriesForDate = entries.filter((e) => {
    const slot = e.slot ?? { date: (e as unknown as { date?: string }).date ?? "", startTime: "10:00", endTime: "18:00", venueId: e.venueId };
    return slot.date === selectedDate;
  });

  /** Строки графика только по активному штату (staffList). Если сотрудника нет в staffList, его строка не появляется. */
  const staffRows = staffList
    .map((staff) => [staff.id, entriesForDate.filter((e) => e.staffId === staff.id)] as [string, ScheduleEntry[]])
    .filter(([, staffEntries]) => staffEntries.length > 0);

  const staffName = (staffId: string) => {
    const s = staffList.find((x) => x.id === staffId);
    if (!s) return "Сотрудник";
    const full =
      (s.firstName ?? s.lastName) ? [s.firstName, s.lastName].filter(Boolean).join(" ") : (s.identity?.displayName ?? s.identity?.name ?? "");
    const cleaned = String(full ?? "").trim();
    if (!cleaned) return "Сотрудник";
    return cleaned.split(' ')[0] || "Сотрудник";
  };

  return (
    <div className="overflow-x-auto overflow-y-auto rounded-xl border border-gray-200 bg-white">
      <div className="min-w-[800px]">
        <div className="sticky top-0 z-10 flex border-b border-gray-200 bg-gray-50">
          <div className="w-32 shrink-0 border-r border-gray-200 py-2 pl-3 text-xs font-medium text-gray-600">
            Сотрудник / Час
          </div>
          <div className="flex">
            {HOURS.map((h) => (
              <div
                key={h}
                role="button"
                tabIndex={0}
                onClick={() => onCellClick?.(selectedDate, h)}
                onKeyDown={(e) => e.key === "Enter" && onCellClick?.(selectedDate, h)}
                className="shrink-0 border-r border-gray-100 py-2 text-center text-xs text-gray-500 hover:bg-blue-50 cursor-pointer"
                style={{ width: HOUR_WIDTH }}
              >
                {h}
              </div>
            ))}
          </div>
        </div>

        {staffRows.map(([staffId, staffEntries]) => {
          return staffEntries.map((entry) => {
            const slot = entry.slot ?? {
              date: selectedDate,
              startTime: "10:00",
              endTime: "18:00",
              venueId: entry.venueId,
            } as ShiftSlot;
            const startTime = slot?.startTime ?? "10:00";
            const endTime = slot?.endTime ?? "18:00";
            const planStart = timeToFraction(startTime);
            const planEnd = timeToFraction(endTime);
            const planHours = entry.planHours ?? (planEnd - planStart) * 24;
            const factHours = entry.factHours ?? 0;
            const factExceedsPlan = factHours > planHours;
            const outOfZone = outOfZoneStaffIds.has(staffId);
            const showRed = factExceedsPlan || outOfZone;
            const name = staffName(staffId);

            return (
              <div
                key={entry.id}
                className="flex border-b border-gray-100"
                style={{ minHeight: ROW_HEIGHT }}
              >
                <div className="flex w-32 shrink-0 items-center justify-between gap-1 border-r border-gray-200 bg-gray-50/50 px-2 py-1">
                  <span className="truncate text-xs font-medium text-gray-800">{name}</span>
                  <span className="shrink-0 text-xs text-gray-500">{entry.role ?? "—"}</span>
                </div>
                <div className="relative flex flex-1" style={{ width: HOURS.length * HOUR_WIDTH }}>
                  {/* Слот: клик по смене — редактирование/удаление */}
                  <div
                    role="button"
                    tabIndex={0}
                    className="absolute inset-y-1 flex items-center justify-between rounded bg-blue-500/70 px-2 text-xs text-white cursor-pointer hover:bg-blue-600/80"
                    style={{
                      left: `${planStart * 100}%`,
                      width: `${(planEnd - planStart) * 100}%`,
                    }}
                    title={`План: ${round1(planHours)} ч | ${startTime}–${endTime}. Клик — редактировать`}
                    onClick={() => onEntryClick?.(entry)}
                    onKeyDown={(e) => e.key === "Enter" && onEntryClick?.(entry)}
                  >
                    <span>{startTime}</span>
                    <span className="font-medium truncate max-w-[120px]">{name}</span>
                    <span>{endTime}</span>
                  </div>
                  {factHours > 0 && (
                    <div
                      className="absolute inset-y-1 rounded bg-green-500/80"
                      style={{
                        left: `${planStart * 100}%`,
                        width: `${Math.min((factHours / 24) * 100 / (planEnd - planStart), 1) * (planEnd - planStart) * 100}%`,
                      }}
                      title={`Факт: ${round1(factHours)} ч`}
                    />
                  )}
                  {showRed && (
                    <div
                      className="absolute right-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-red-500"
                      title={outOfZone ? "Не в зоне GPS" : "Факт превышает план"}
                    />
                  )}
                  <div className="absolute right-2 top-1/2 -translate-y-1/2" onClick={(e) => e.stopPropagation()}>
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
          });
        })}

        {staffRows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-sm text-gray-500">
            <p>Нет данных за выбранную дату</p>
            {onCellClick && (
              <p className="mt-2 text-xs">Кликните по ячейке часа в заголовке, чтобы добавить смену</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
