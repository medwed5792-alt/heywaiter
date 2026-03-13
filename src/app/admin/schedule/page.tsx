"use client";

import { useState, useEffect, useMemo } from "react";
import { Trash2, Pencil } from "lucide-react";
import toast from "react-hot-toast";
import { collection, doc, query, where, getDocs, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ScheduleTimeline } from "@/components/admin/ScheduleTimeline";
import type { ScheduleEntry, ShiftSlot, Staff, Venue, ServiceRole } from "@/lib/types";

const VENUE_ID = "current";

/** Подписи ролей для UI (расширяемый список) */
const ROLE_LABELS: Partial<Record<string, string>> = {
  waiter: "Официант",
  sommelier: "Сомелье",
  manager: "Менеджер",
  security: "Охрана",
  chef: "Повар",
  cook: "Повар",
  sous_chef: "Су-шеф",
  pastry_chef: "Кондитер",
  bartender: "Бармен",
  hostess: "Хостес",
  administrator: "Администратор",
  director: "Директор",
  owner: "Владелец",
  cleaner: "Уборщик",
  runner: "Раннер",
};

function roleLabel(key: string): string {
  return ROLE_LABELS[key] ?? key;
}

/** HARD: в графиках только сотрудники со статусом 'active'. При отсутствии поля status — legacy: active !== false */
function isActiveStaff(s: Staff): boolean {
  const status = (s as { status?: string }).status;
  if (status != null) return status === "active";
  return s.active !== false;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** План часов из startTime/endTime (HH:mm). Защита от отсутствующих полей. */
function planHoursFromSlot(slot: ShiftSlot): number {
  const start = slot?.startTime || "10:00";
  const end = slot?.endTime || "18:00";
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const sh0 = Number.isFinite(sh) ? sh : 10;
  const sm0 = Number.isFinite(sm) ? sm : 0;
  const eh0 = Number.isFinite(eh) ? eh : 18;
  const em0 = Number.isFinite(em) ? em : 0;
  return eh0 - sh0 + (em0 - sm0) / 60;
}

/** Факт часов из логов смен (checkIn/checkOut в scheduleEntry, заполняются при «Начать/Завершить смену» в Mini App) */
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
  const rawSlot = data?.slot as ShiftSlot | undefined;
  const slot: ShiftSlot = rawSlot
    ? {
        date: rawSlot.date ?? date,
        startTime: rawSlot.startTime ?? "10:00",
        endTime: rawSlot.endTime ?? "18:00",
        venueId: rawSlot.venueId ?? venueId,
      }
    : {
        date,
        startTime: "10:00",
        endTime: `${10 + Math.max(0, Math.floor(planHours))}:00`,
        venueId,
      };
  const planH = data?.planHours ?? planHoursFromSlot(slot);
  const checkIn = data?.checkIn as string | undefined;
  const checkOut = data?.checkOut as string | undefined;
  const factFromLogs = factHoursFromCheckInOut(checkIn, checkOut);
  return {
    id,
    venueId,
    staffId,
    slot,
    planHours: planH,
    factHours: (data?.factHours as number | undefined) ?? factFromLogs,
    checkIn,
    checkOut,
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

  const handleDeleteEntry = (entry: ScheduleEntry, onSuccess?: () => void) => {
    if (!window.confirm("Удалить эту смену из графика?")) return;
    (async () => {
      try {
        await deleteDoc(doc(db, "scheduleEntries", entry.id));
        setEntries((prev) => prev.filter((e) => e.id !== entry.id));
        onSuccess?.();
        toast.success("Смена удалена");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка удаления");
      }
    })();
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const venuesSnap = await getDocs(collection(db, "venues"));
      if (cancelled) return;
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
      collection(db, "staff"),
      where("venueId", "==", VENUE_ID)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Staff));
      setStaffList(list.filter(isActiveStaff));
    });
    return () => unsub();
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

  const activeStaffIds = useMemo(() => new Set(staffList.map((s) => s.id)), [staffList]);

  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (!activeStaffIds.has(e.staffId)) return false;
        const slot = e.slot ?? { date: (e as unknown as { date?: string }).date ?? "", startTime: "10:00", endTime: "18:00", venueId: e.venueId };
        if (filterDate && slot.date !== filterDate) return false;
        if (filterRole && e.role !== filterRole) return false;
        return true;
      }),
    [entries, filterDate, filterRole, activeStaffIds]
  );

  const managedVenues = useMemo(() => (venues.length > 0 ? venues : [{ id: VENUE_ID, name: "Текущая точка", address: "" } as Venue]), [venues, VENUE_ID]);

  /** Роли, которые реально есть среди активных сотрудников — только их показываем во вкладках фильтра */
  const rolesPresent = useMemo(() => {
    const set = new Set<string>();
    staffList.forEach((s) => {
      const r = s.position ?? (s as { role?: string }).role;
      if (r && typeof r === "string") set.add(r);
    });
    return Array.from(set).sort();
  }, [staffList]);

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
            {rolesPresent.map((r) => (
              <option key={r} value={r}>{roleLabel(r)}</option>
            ))}
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
          onRequestDelete={() => handleDeleteEntry(editShiftEntry, () => setEditShiftEntry(null))}
        />
      )}

      <FOTReport
        entries={entries}
        staffList={staffList}
        venues={venues}
        filterMonth={filterMonth}
        onFilterMonthChange={setFilterMonth}
        onEditEntry={setEditShiftEntry}
        onDeleteEntry={(entry) => handleDeleteEntry(entry)}
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
  onRequestDelete,
}: {
  entry: ScheduleEntry;
  staffList: Staff[];
  managedVenues: Venue[];
  onClose: () => void;
  onSaved: () => void;
  onRequestDelete?: () => void;
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
      toast.success("Изменения сохранены");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
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
            <span className="block text-xs font-medium text-gray-600">Должность</span>
            <p className="mt-1 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700" aria-readonly>
              {roleLabel(staffList.find((s) => s.id === staffId)?.position ?? (staffList.find((s) => s.id === staffId) as { role?: string } | undefined)?.role ?? entry.role ?? "waiter")}
            </p>
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
            <button type="button" onClick={onRequestDelete} disabled={saving} className="flex items-center gap-1.5 rounded-lg border border-red-200 py-2 px-3 text-sm font-medium text-red-500 hover:text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors">
              <Trash2 className="h-4 w-4" />
              Удалить смену
            </button>
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Отмена</button>
            <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-gray-900 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">{saving ? "Сохранение…" : "Сохранить изменения"}</button>
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

  const selectedStaff = useMemo(() => staffList.find((s) => s.id === staffId), [staffList, staffId]);
  const roleFromStaff = selectedStaff?.position ?? (selectedStaff as { role?: string })?.role ?? "waiter";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffId.trim()) return;
    const toCreate = dates.length > 0 ? dates : [todayISO()];
    setSaving(true);
    try {
      const role = roleFromStaff;
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
      toast.success("Смена добавлена");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
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
            <span className="block text-xs font-medium text-gray-600">Должность</span>
            <p className="mt-1 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700" aria-readonly>
              {staffId ? roleLabel(roleFromStaff) : "—"}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">Заполняется автоматически при выборе сотрудника (из Команды)</p>
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

/** Сводка по ФОТ: staffList должен содержать только активных (status === 'active'). Строки по уволенным не показываются. */
function FOTReport({
  entries,
  staffList,
  venues,
  filterMonth,
  onFilterMonthChange,
  onEditEntry,
  onDeleteEntry,
}: {
  entries: ScheduleEntry[];
  staffList: Staff[];
  venues: Venue[];
  filterMonth: string;
  onFilterMonthChange: (v: string) => void;
  onEditEntry?: (entry: ScheduleEntry) => void;
  onDeleteEntry?: (entry: ScheduleEntry) => void;
}) {
  const activeStaffIds = useMemo(() => new Set(staffList.map((s) => s.id)), [staffList]);

  const rows = useMemo(() => {
    const byEntry = entries.filter((e) => {
      const slot = e.slot;
      if (!slot) return false;
      const date = slot?.date;
      if (!date || !String(date).startsWith(filterMonth)) return false;
      if (!activeStaffIds.has(e.staffId)) return false;
      return true;
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
        entry: e,
        name,
        venueName: venue?.name ?? (e.slot?.venueId ?? e.venueId),
        plan: Math.round(plan * 10) / 10,
        fact: Math.round(fact * 10) / 10,
        late,
        early,
        startTime: e.slot?.startTime ?? "--:--",
        endTime: e.slot?.endTime ?? "--:--",
      };
    });
  }, [entries, staffList, venues, filterMonth, activeStaffIds]);

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
      <p className="mt-1 text-sm text-gray-500">План — из расписания; Факт — из логов смен (checkIn/checkOut при «Начать/Завершить смену»). Экспорт в CSV.</p>
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
              <th className="p-3 text-right font-medium text-gray-600 w-24">Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-4 text-center text-gray-500">Нет данных за выбранный период</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.entry.id}
                  className="border-b border-gray-100 cursor-pointer hover:bg-gray-50/80"
                  onClick={() => onEditEntry?.(r.entry)}
                >
                  <td className="p-3">{r.name}</td>
                  <td className="p-3">{r.venueName}</td>
                  <td className="p-3 text-right">{r.plan}</td>
                  <td className="p-3 text-right">{r.fact}</td>
                  <td className="p-3 text-right">{r.late}</td>
                  <td className="p-3 text-right">{r.early}</td>
                  <td className="p-3 text-right" onClick={(ev) => ev.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        className="rounded p-1.5 text-gray-600 hover:bg-gray-200"
                        title="Редактировать"
                        onClick={() => onEditEntry?.(r.entry)}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 transition-colors"
                        title="Удалить"
                        onClick={() => onDeleteEntry?.(r.entry)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
