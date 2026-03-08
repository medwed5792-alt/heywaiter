"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, doc, query, where, getDocs, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ScheduleTimeline } from "@/components/admin/ScheduleTimeline";
import type { ScheduleEntry, ShiftSlot, Staff, Venue, ServiceRole } from "@/lib/types";

const VENUE_ID = "current";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** План часов из startTime/endTime (HH:mm) */
function planHoursFromSlot(slot: ShiftSlot): number {
  const [sh, sm] = slot.startTime.split(":").map(Number);
  const [eh, em] = slot.endTime.split(":").map(Number);
  return (eh - sh) + (em - sm) / 60;
}

/** Факт часов из checkIn/checkOut (HH:mm) */
function factHoursFromCheckInOut(checkIn?: string, checkOut?: string): number | undefined {
  if (!checkIn || !checkOut) return undefined;
  const [sh, sm] = checkIn.split(":").map(Number);
  const [eh, em] = checkOut.split(":").map(Number);
  const m = (eh * 60 + em) - (sh * 60 + sm);
  return m <= 0 ? 0 : m / 60;
}

/** Нормализация старых записей без slot */
function normalizeEntry(d: { id: string; data: () => Record<string, unknown> }): ScheduleEntry {
  const data = d.data() ?? {};
  const id = d.id;
  const venueId = (data?.venueId as string) ?? "";
  const staffId = (data?.staffId as string) ?? "";
  const date = (data?.date as string) ?? todayISO();
  const planHours = (data?.planHours as number) ?? 0;
  const slot: ShiftSlot = data?.slot
    ? { ...(data.slot as ShiftSlot) }
    : {
        date,
        startTime: "10:00",
        endTime: `${10 + Math.max(0, Math.floor(planHours))}:00`,
        venueId,
      };
  return {
    id,
    venueId,
    staffId,
    slot,
    planHours: data?.planHours ?? planHoursFromSlot(slot),
    factHours: data?.factHours,
    checkIn: data?.checkIn,
    checkOut: data?.checkOut,
    lateMinutes: data?.lateMinutes,
    earlyLeaveMinutes: data?.earlyLeaveMinutes,
    role: data?.role as ServiceRole | undefined,
    createdAt: data?.createdAt,
    updatedAt: data?.updatedAt,
  };
}

export default function AdminSchedulePage() {
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState(todayISO());
  const [filterMonth, setFilterMonth] = useState(todayISO().slice(0, 7));
  const [filterRole, setFilterRole] = useState<ServiceRole | "">("");
  const [staffOutOfZoneIdSet, setStaffOutOfZoneIdSet] = useState<Set<string>>(new Set());
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [addShiftModal, setAddShiftModal] = useState<{ dates: string[]; defaultStartHour: number } | null>(null);
  const [editShiftEntry, setEditShiftEntry] = useState<ScheduleEntry | null>(null);
  const [dragStart, setDragStart] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [staffSnap, venuesSnap] = await Promise.all([
        getDocs(query(collection(db, "staff"), where("venueId", "==", VENUE_ID))),
        getDocs(collection(db, "venues")),
      ]);
      if (cancelled) return;
      setStaffList(staffSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Staff)));
      const venueList = venuesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Venue));
      setVenues(venueList);
      const venueIds = venueList.length ? venueList.map((v) => v.id).slice(0, 10) : [VENUE_ID];
      const entriesSnap = venueIds.length <= 1
        ? await getDocs(query(collection(db, "scheduleEntries"), where("venueId", "==", venueIds[0] ?? VENUE_ID)))
        : await getDocs(query(collection(db, "scheduleEntries"), where("venueId", "in", venueIds)));
      if (cancelled) return;
      setEntries(entriesSnap.docs.map(normalizeEntry));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, "scheduleEntries"),
      where("venueId", "==", VENUE_ID)
    );
    const unsub = onSnapshot(q, (snap) => {
      setEntries(snap.docs.map(normalizeEntry));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, "staffLiveGeos"),
      where("venueId", "==", VENUE_ID)
    );
    const unsub = onSnapshot(q, (snap) => {
      const ids = new Set<string>();
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data.isInside === false && data.staffId) ids.add(data.staffId);
      });
      setStaffOutOfZoneIdSet(ids);
    });
    return () => unsub();
  }, []);

  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        const slot = e.slot ?? { date: (e as unknown as { date?: string }).date ?? "", startTime: "10:00", endTime: "18:00", venueId: e.venueId };
        if (filterDate && slot.date !== filterDate) return false;
        if (filterRole && e.role !== filterRole) return false;
        return true;
      }),
    [entries, filterDate, filterRole]
  );

  const managedVenues = useMemo(() => (venues.length > 0 ? venues : [{ id: VENUE_ID, name: "Текущая точка", address: "" } as Venue]), [venues, VENUE_ID]);

  const monthDays = useMemo(() => {
    const [y, m] = filterMonth.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const last = new Date(y, m, 0);
    const days: string[] = [];
    for (let d = 1; d <= last.getDate(); d++) {
      days.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    return days;
  }, [filterMonth]);

  const toggleDate = (date: string) => {
    setSelectedDates((prev) => (prev.includes(date) ? prev.filter((x) => x !== date) : [...prev, date].sort()));
  };

  const selectRange = (date: string) => {
    if (!dragStart) return;
    const a = monthDays.indexOf(dragStart);
    const b = monthDays.indexOf(date);
    if (a === -1 || b === -1) return;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    setSelectedDates(monthDays.slice(lo, hi + 1));
  };

  const openAddShiftForSelection = () => {
    const dates = selectedDates.length > 0 ? selectedDates : [filterDate];
    setAddShiftModal({ dates, defaultStartHour: 10 });
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">График</h2>
      <p className="mt-1 text-sm text-gray-600">
        Выберите дни (клик или протягивание), затем «+ Назначить смену» — смены создадутся для всех выделенных дней. Таймлайн по выбранной дате.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Месяц</span>
          <input
            type="month"
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            value={filterMonth}
            onChange={(e) => {
              setFilterMonth(e.target.value);
              setSelectedDates([]);
            }}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Дата (таймлайн)</span>
          <input
            type="date"
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Роль</span>
          <select
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value as ServiceRole | "")}
          >
            <option value="">Все</option>
            <option value="waiter">Официант</option>
            <option value="sommelier">Сомелье</option>
            <option value="manager">Менеджер</option>
            <option value="security">Охрана</option>
          </select>
        </label>
        <button
          type="button"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          onClick={openAddShiftForSelection}
        >
          + Назначить смену
        </button>
      </div>

      <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3">
        <p className="mb-2 text-xs font-medium text-gray-600">Выбор дней (клик — один день, зажатие и протягивание — диапазон)</p>
        <div className="flex flex-wrap gap-1">
          {monthDays.map((d) => {
            const selected = selectedDates.includes(d);
            return (
              <button
                key={d}
                type="button"
                className="h-8 min-w-[2rem] rounded px-2 text-xs font-medium transition-colors hover:opacity-90"
                style={{ backgroundColor: selected ? "#E0F2FE" : undefined, color: selected ? "#0C4A6E" : "#374151" }}
                onClick={() => toggleDate(d)}
                onMouseDown={() => setDragStart(d)}
                onMouseEnter={() => dragStart && selectRange(d)}
                onMouseUp={() => setDragStart(null)}
                onMouseLeave={() => setDragStart(null)}
              >
                {d.slice(8)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 max-h-[50vh] min-h-[200px]">
        {loading ? (
          <p className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">Загрузка…</p>
        ) : (
          <ScheduleTimeline
            entries={filtered}
            selectedDate={filterDate}
            outOfZoneStaffIds={staffOutOfZoneIdSet}
            venueId={VENUE_ID}
            staffList={staffList}
            onCellClick={(date, hour) => setAddShiftModal({ dates: [date], defaultStartHour: hour })}
            onEntryClick={setEditShiftEntry}
          />
        )}
      </div>

      {addShiftModal && (
        <AddShiftModal
          dates={addShiftModal.dates}
          defaultStartHour={addShiftModal.defaultStartHour}
          staffList={staffList}
          managedVenues={managedVenues}
          onClose={() => setAddShiftModal(null)}
          onSaved={() => setAddShiftModal(null)}
        />
      )}

      {editShiftEntry && (
        <EditShiftModal
          entry={editShiftEntry}
          staffList={staffList}
          managedVenues={managedVenues}
          onClose={() => setEditShiftEntry(null)}
          onSaved={() => setEditShiftEntry(null)}
        />
      )}

      <FOTReport
        entries={entries}
        staffList={staffList}
        venues={venues}
        filterMonth={filterMonth}
        onFilterMonthChange={setFilterMonth}
      />
    </div>
  );
}

function EditShiftModal({
  entry,
  staffList,
  managedVenues,
  onClose,
  onSaved,
}: {
  entry: ScheduleEntry;
  staffList: Staff[];
  managedVenues: Venue[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const slot = entry.slot ?? { date: todayISO(), startTime: "10:00", endTime: "18:00", venueId: entry.venueId };
  const [staffId, setStaffId] = useState(entry.staffId);
  const [venueId, setVenueId] = useState(slot.venueId ?? entry.venueId ?? VENUE_ID);
  const [date, setDate] = useState(slot.date);
  const [startTime, setStartTime] = useState(slot.startTime);
  const [endTime, setEndTime] = useState(slot.endTime);
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const newSlot = { date, startTime, endTime, venueId };
      const planH = planHoursFromSlot(newSlot);
      await updateDoc(doc(db, "scheduleEntries", entry.id), {
        staffId,
        venueId: venueId || VENUE_ID,
        slot: newSlot,
        planHours: Math.round(planH * 10) / 10,
        role: staffList.find((s) => s.id === staffId)?.position ?? entry.role ?? "waiter",
        updatedAt: serverTimestamp(),
      });
      onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Удалить эту смену?")) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, "scheduleEntries", entry.id));
      onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <h3 className="font-semibold text-gray-900">Редактировать смену</h3>
        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <label className="block">
            <span className="block text-xs font-medium text-gray-600">Сотрудник</span>
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" required>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>{(s.firstName ?? s.lastName) ? [s.firstName, s.lastName].filter(Boolean).join(" ") : (s.identity?.displayName ?? s.id)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-600">Объект</span>
            <select value={venueId} onChange={(e) => setVenueId(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm">
              {managedVenues.map((v) => (
                <option key={v.id} value={v.id}>{v.name ?? v.id}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-600">Дата</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" required />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label><span className="block text-xs font-medium text-gray-600">С</span><input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" /></label>
            <label><span className="block text-xs font-medium text-gray-600">До</span><input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" /></label>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={handleDelete} disabled={saving} className="rounded-lg border border-red-200 bg-white py-2 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">Удалить смену</button>
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Отмена</button>
            <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-gray-900 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">{saving ? "Сохранение…" : "Сохранить"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddShiftModal({
  dates,
  defaultStartHour,
  staffList,
  managedVenues,
  onClose,
  onSaved,
}: {
  dates: string[];
  defaultStartHour: number;
  staffList: Staff[];
  managedVenues: Venue[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [staffId, setStaffId] = useState("");
  const [venueId, setVenueId] = useState(managedVenues[0]?.id ?? VENUE_ID);
  const [startTime, setStartTime] = useState(`${String(defaultStartHour).padStart(2, "0")}:00`);
  const [endTime, setEndTime] = useState(`${String(defaultStartHour + 6).padStart(2, "0")}:00`);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffId.trim()) return;
    const toCreate = dates.length > 0 ? dates : [todayISO()];
    setSaving(true);
    try {
      const role = staffList.find((s) => s.id === staffId)?.position ?? "waiter";
      for (const date of toCreate) {
        const slot = { date, startTime, endTime, venueId };
        const planH = planHoursFromSlot(slot);
        await addDoc(collection(db, "scheduleEntries"), {
          venueId: venueId || VENUE_ID,
          staffId,
          slot,
          planHours: Math.round(planH * 10) / 10,
          role,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <h3 className="font-semibold text-gray-900">Добавить смену</h3>
        <p className="mt-1 text-sm text-gray-500">{dates.length > 1 ? `Дни: ${dates.length} (${dates[0]} … ${dates[dates.length - 1]})` : `Дата: ${dates[0] ?? todayISO()}`}</p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <label className="block">
            <span className="block text-xs font-medium text-gray-600">Сотрудник (Команда)</span>
            <select
              required
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Выберите</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {(s.firstName ?? s.lastName) ? [s.firstName, s.lastName].filter(Boolean).join(" ") : (s.identity?.displayName ?? s.id)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-600">Объект (точка)</span>
            <select
              value={venueId}
              onChange={(e) => setVenueId(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              {managedVenues.map((v) => (
                <option key={v.id} value={v.id}>{v.name ?? v.id}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="block text-xs font-medium text-gray-600">С</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label>
              <span className="block text-xs font-medium text-gray-600">До</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Отмена
            </button>
            <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-gray-900 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FOTReport({
  entries,
  staffList,
  venues,
  filterMonth,
  onFilterMonthChange,
}: {
  entries: ScheduleEntry[];
  staffList: Staff[];
  venues: Venue[];
  filterMonth: string;
  onFilterMonthChange: (v: string) => void;
}) {
  const rows = useMemo(() => {
    const byEntry = entries.filter((e) => {
      const slot = e.slot;
      if (!slot) return false;
      return slot.date.startsWith(filterMonth);
    });
    return byEntry.map((e) => {
      const staff = staffList.find((s) => s.id === e.staffId);
      const venue = venues.find((v) => v.id === (e.slot?.venueId ?? e.venueId));
      const plan = e.planHours ?? 0;
      const fact = e.factHours ?? 0;
      const late = e.lateMinutes ?? 0;
      const early = e.earlyLeaveMinutes ?? 0;
      const name = (staff?.firstName ?? staff?.lastName) ? [staff.firstName, staff.lastName].filter(Boolean).join(" ") : (staff?.identity?.displayName ?? e.staffId);
      return {
        name,
        venueName: venue?.name ?? (e.slot?.venueId ?? e.venueId),
        plan: Math.round(plan * 10) / 10,
        fact: Math.round(fact * 10) / 10,
        late,
        early,
      };
    });
  }, [entries, staffList, venues, filterMonth]);

  const exportCSV = () => {
    const header = "Сотрудник;Точка;План (ч);Факт (ч);Опоздание (мин);Ранний уход (мин)\n";
    const body = rows.map((r) => `${r.name};${r.venueName};${r.plan};${r.fact};${r.late};${r.early}`).join("\n");
    const blob = new Blob(["\uFEFF" + header + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fot_${filterMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="mt-8">
      <h3 className="text-base font-semibold text-gray-900">Сводка по ФОТ</h3>
      <p className="mt-1 text-sm text-gray-500">План/Факт часов, опоздания и ранний уход. Экспорт в CSV для расчёта зарплаты.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Месяц / Дата</span>
          <input
            type="month"
            value={filterMonth}
            onChange={(e) => onFilterMonthChange(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={exportCSV}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Экспорт в CSV
        </button>
      </div>
      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="p-3 text-left font-medium text-gray-600">Сотрудник</th>
              <th className="p-3 text-left font-medium text-gray-600">Точка</th>
              <th className="p-3 text-right font-medium text-gray-600">План (ч)</th>
              <th className="p-3 text-right font-medium text-gray-600">Факт (ч)</th>
              <th className="p-3 text-right font-medium text-gray-600">Опоздание (мин)</th>
              <th className="p-3 text-right font-medium text-gray-600">Ранний уход (мин)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4 text-center text-gray-500">Нет данных за выбранный период</td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="p-3">{r.name}</td>
                  <td className="p-3">{r.venueName}</td>
                  <td className="p-3 text-right">{r.plan}</td>
                  <td className="p-3 text-right">{r.fact}</td>
                  <td className="p-3 text-right">{r.late}</td>
                  <td className="p-3 text-right">{r.early}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
