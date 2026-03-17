"use client";

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Booking } from "@/lib/types";

const VENUE_ID = "venue_andrey_alt";
const LATE_NOTIFY_INTERVAL_MS = 15 * 60 * 1000; // 15 мин

function toStartAt(date: string, startTime: string): Date {
  const [h, m] = startTime.split(":").map(Number);
  const d = new Date(date);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}

/** Конец брони: если «Время По» < «Время С» — считаем следующий день. */
function toEndAt(date: string, startTime: string, endTime: string): Date {
  const [hS, mS] = startTime.split(":").map(Number);
  const [hE, mE] = endTime.split(":").map(Number);
  const startMins = (hS ?? 0) * 60 + (mS ?? 0);
  const endMins = (hE ?? 0) * 60 + (mE ?? 0);
  const endDate = new Date(date);
  endDate.setHours(hE ?? 0, mE ?? 0, 0, 0);
  if (endMins <= startMins) endDate.setDate(endDate.getDate() + 1);
  return endDate;
}

function isLate(b: Booking): boolean {
  const startAt = b.startAt ? (b.startAt as { toDate?: () => Date }).toDate?.() : toStartAt(b.date, b.startTime);
  return startAt ? startAt.getTime() < Date.now() : false;
}

const DISABLE_OPTIONS = [
  { value: 1, label: "1 день" },
  { value: 2, label: "2 дня" },
  { value: 3, label: "3 дня" },
  { value: 9999, label: "Бессрочно" },
];

export default function AdminBookingsPage() {
  const [bookings, setBookings] = useState<(Booking & { startAt?: unknown; endAt?: unknown; notifyWaiter?: boolean; flashDashboard?: boolean; isUrgent?: boolean })[]>([]);
  const [bookingSwitch, setBookingSwitch] = useState<{ enabled: boolean; until: string | null }>({ enabled: true, until: null });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Booking> & { id?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [notifyCooldown, setNotifyCooldown] = useState<Record<string, number>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [disableBookingModalOpen, setDisableBookingModalOpen] = useState(false);
  const [disableBookingDays, setDisableBookingDays] = useState<number>(1);

  useEffect(() => {
    const q = query(collection(db, "bookings"), where("venueId", "==", VENUE_ID));
    const unsub = onSnapshot(q, (snap) => {
      setBookings(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            venueId: data.venueId ?? VENUE_ID,
            tableId: data.tableId ?? "",
            guestName: data.guestName ?? "",
            guestContact: data.guestContact ?? "",
            guestId: data.guestId,
            guestExternalId: data.guestExternalId,
            seats: data.seats ?? 2,
            startTime: data.startTime ?? "12:00",
            endTime: data.endTime ?? "14:00",
            date: data.date ?? "",
            status: (data.status as Booking["status"]) ?? "pending",
            arrived: data.arrived ?? false,
            startAt: data.startAt,
            endAt: data.endAt,
            notifyWaiter: data.notifyWaiter ?? false,
            flashDashboard: data.flashDashboard ?? false,
            isUrgent: data.isUrgent ?? false,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          } as Booking & { startAt?: unknown; endAt?: unknown; notifyWaiter?: boolean; flashDashboard?: boolean; isUrgent?: boolean };
        })
      );
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    getDoc(doc(db, "venues", VENUE_ID)).then((snap) => {
      if (snap.exists()) {
        const c = snap.data()?.config as { bookingEnabled?: boolean; bookingEnabledUntil?: unknown } | undefined;
        const until = c?.bookingEnabledUntil;
        let untilStr: string | null = null;
        if (until && typeof until === "object" && "toDate" in (until as { toDate?: () => Date })) {
          untilStr = (until as { toDate: () => Date }).toDate().toISOString().slice(0, 16);
        } else if (until) untilStr = String(until).slice(0, 16);
        setBookingSwitch({
          enabled: c?.bookingEnabled !== false,
          until: untilStr,
        });
      }
    });
  }, []);

  const saveBooking = useCallback(
    async (payload: Partial<Booking> & { id?: string }) => {
      setSaving(true);
      try {
        const date = payload.date ?? editing?.date ?? "";
        const startTime = payload.startTime ?? editing?.startTime ?? "12:00";
        const endTime = payload.endTime ?? editing?.endTime ?? "14:00";
        const tableIdStr = String(payload.tableId ?? editing?.tableId ?? "").trim();
        const guestNameStr = String(payload.guestName ?? editing?.guestName ?? "");

        // Время: приклеиваем к дате; если «Время ПО» < «Время С» — конец на следующий день
        const startAtDate = toStartAt(date, startTime);
        const endAtDate = toEndAt(date, startTime, endTime);
        if (Number.isNaN(startAtDate.getTime()) || Number.isNaN(endAtDate.getTime())) {
          toast.error("Некорректная дата или время");
          return;
        }
        const startAt = Timestamp.fromDate(startAtDate);
        const endAt = Timestamp.fromDate(endAtDate);

        // Обязательные поля перед отправкой в Firestore (при мульти-заведениях брать venueId из контекста/URL)
        const venueId = VENUE_ID;
        if (!venueId || venueId === "undefined" || venueId === "null") {
          toast.error("Не указано заведение (venueId)");
          return;
        }
        if (!tableIdStr) {
          toast.error("Укажите стол (tableId)");
          return;
        }
        if (!guestNameStr || !guestNameStr.trim()) {
          toast.error("Укажите ФИО гостя");
          return;
        }
        if (!date || !startAt) {
          toast.error("Укажите дату и время брони");
          return;
        }

        const guestContactStr = String(payload.guestContact ?? editing?.guestContact ?? "");
        const seatsNum = Number(payload.seats ?? editing?.seats ?? 2) || 2;
        const nowMs = Date.now();
        const isUrgent = startAtDate.getTime() < nowMs;

        // Если гостя нет в базе — создаём запись в коллекции guests с type "regular" (Новый), чтобы не слать undefined в Firestore
        let guestIdResolved: string | null = payload.guestId != null && payload.guestId !== "" ? String(payload.guestId) : null;
        if (guestIdResolved == null) {
          const newGuestRef = await addDoc(collection(db, "guests"), {
            venueId,
            name: guestNameStr.trim() || null,
            phone: guestContactStr.trim() || null,
            type: "regular",
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
          });
          guestIdResolved = newGuestRef.id;
        }

        const body: Record<string, unknown> = {
          venueId,
          tableId: tableIdStr,
          guestName: guestNameStr.trim(),
          guestContact: guestContactStr,
          guestId: guestIdResolved,
          seats: seatsNum,
          startTime: payload.startTime ?? "12:00",
          endTime: payload.endTime ?? "14:00",
          date: payload.date ?? "",
          status: payload.status ?? "pending",
          startAt,
          endAt,
          notifyWaiter: payload.notifyWaiter ?? editing?.notifyWaiter ?? false,
          flashDashboard: payload.flashDashboard ?? editing?.flashDashboard ?? false,
          isUrgent,
          updatedAt: serverTimestamp(),
        };
        if (payload.guestExternalId != null && payload.guestExternalId !== "") body.guestExternalId = payload.guestExternalId;
        const newBooking = {
          venueId: body.venueId,
          tableId: body.tableId,
          guestId: body.guestId,
          guestName: body.guestName,
          guestContact: body.guestContact,
          guests: body.seats,
          seats: body.seats,
          date: body.date,
          startTime: body.startTime,
          endTime: body.endTime,
          startAt: startAtDate.toISOString(),
          endAt: endAtDate.toISOString(),
          status: body.status,
        };
        console.log("FULL PAYLOAD:", JSON.stringify(newBooking, null, 2));
        if (payload.id) {
          await updateDoc(doc(db, "bookings", payload.id), body);
          toast.success("Бронь обновлена");
        } else {
          await addDoc(collection(db, "bookings"), { ...body, createdAt: serverTimestamp() });
          toast.success("Бронь создана");
        }
        setEditing(null);
      } catch (e) {
        console.error("Booking save error:", e);
        const msg = e instanceof Error ? e.message : String(e);
        const code = e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
        toast.error(code ? `Ошибка сохранения: ${code} — ${msg}` : msg || "Ошибка сохранения");
      } finally {
        setSaving(false);
      }
    },
    [editing]
  );

  const deleteBooking = useCallback(async (id: string) => {
    try {
      await deleteDoc(doc(db, "bookings", id));
      toast.success("Бронь удалена");
      setEditing(null);
      setDeleteConfirmId(null);
    } catch {
      toast.error("Ошибка удаления");
    }
  }, []);

  const applyDisableBooking = useCallback(async () => {
    try {
      const snap = await getDoc(doc(db, "venues", VENUE_ID));
      const data = snap.exists() ? snap.data() : {};
      const config = { ...(data?.config ?? {}), bookingEnabled: false };
      const n = disableBookingDays;
      const until = n >= 9999 ? null : new Date(Date.now() + n * 24 * 60 * 60 * 1000);
      (config as Record<string, unknown>).bookingEnabledUntil = until;
      await updateDoc(doc(db, "venues", VENUE_ID), { config, updatedAt: serverTimestamp() });
      setBookingSwitch({
        enabled: false,
        until: until ? until.toISOString().slice(0, 16) : null,
      });
      setDisableBookingModalOpen(false);
      toast.success("Онлайн-бронирование отключено");
    } catch {
      toast.error("Ошибка переключателя");
    }
  }, [disableBookingDays]);

  const toggleBookingMaster = useCallback(async () => {
    try {
      if (bookingSwitch.enabled) {
        setDisableBookingModalOpen(true);
        return;
      }
      const snap = await getDoc(doc(db, "venues", VENUE_ID));
      const data = snap.exists() ? snap.data() : {};
      const config = { ...(data?.config ?? {}), bookingEnabled: true };
      delete (config as Record<string, unknown>).bookingEnabledUntil;
      await updateDoc(doc(db, "venues", VENUE_ID), { config, updatedAt: serverTimestamp() });
      setBookingSwitch({ enabled: true, until: null });
      toast.success("Онлайн-бронирование включено");
    } catch {
      toast.error("Ошибка переключателя");
    }
  }, [bookingSwitch.enabled]);

  const BOOKING_MAX_AGE_FOR_ALERT_MS = 12 * 60 * 60 * 1000; // 12 часов — старые брони не спамят в ленту

  const sendLateReminder = useCallback(async (bookingId: string) => {
    try {
      const bookingSnap = await getDoc(doc(db, "bookings", bookingId));
      if (!bookingSnap.exists()) {
        toast.error("Бронь не найдена");
        return;
      }
      const data = bookingSnap.data();
      if (data?.isAlerted === true) {
        toast("Уведомление по этой брони уже отправлялось", { id: "late-already" });
        return;
      }
      const startAtSource = data?.startAt as { toDate?: () => Date } | Date | undefined;
      const startAt =
        startAtSource && typeof (startAtSource as any).toDate === "function"
          ? (startAtSource as { toDate: () => Date }).toDate()
          : startAtSource instanceof Date
          ? startAtSource
          : null;
      if (startAt && Date.now() - startAt.getTime() > BOOKING_MAX_AGE_FOR_ALERT_MS) {
        toast.error("Бронь старше 12 часов. Уведомление не создаём.");
        return;
      }
      await addDoc(collection(db, "staffNotifications"), {
        venueId: VENUE_ID,
        tableId: "",
        type: "booking_late",
        message: "Гость не пришёл к времени брони. Ждать или отменить?",
        read: false,
        targetUids: [],
        payload: { bookingId },
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "bookings", bookingId), {
        isAlerted: true,
        updatedAt: serverTimestamp(),
      });
      setNotifyCooldown((prev) => ({ ...prev, [bookingId]: Date.now() }));
      toast.success("Напоминание ЛПР отправлено");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка отправки");
    }
  }, []);

  const lateBookings = bookings.filter((b) => (b.status === "pending" || b.status === "confirmed") && !b.arrived && isLate(b));

  // Auto-cleanup: удаление просроченных броней (конец + 15 минут, статус не 'seated')
  useEffect(() => {
    if (!bookings.length) return;
    const cleanup = async () => {
      const now = Date.now();
      const toDelete: string[] = [];
      for (const b of bookings) {
        if (!b.id) continue;
        if ((b as Booking).status === "seated") continue;
        const endDate =
          b.endAt && typeof (b.endAt as any)?.toDate === "function"
            ? (b.endAt as { toDate: () => Date }).toDate()
            : toEndAt(b.date, b.startTime, b.endTime);
        if (endDate.getTime() + 15 * 60 * 1000 < now) {
          toDelete.push(b.id as string);
        }
      }
      for (const id of toDelete) {
        try {
          await deleteDoc(doc(db, "bookings", id));
        } catch {
          // silent
        }
      }
    };
    void cleanup();
  }, [bookings]);

  return (
    <div style={{ zoom: 0.75 }}>
      <h2 className="text-lg font-semibold text-gray-900">Брони</h2>
      <p className="mt-2 text-sm text-gray-600">
        Создание, редактирование, удаление. Мастер-выключатель онлайн-бронирования. Контроль опозданий.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggleBookingMaster}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${bookingSwitch.enabled ? "bg-green-600 text-white" : "bg-gray-400 text-white"}`}
        >
          {bookingSwitch.enabled ? "Онлайн-бронирование вкл" : "Онлайн-бронирование выкл"}
        </button>
        {bookingSwitch.until && (
          <span className="text-sm text-gray-500">До: {bookingSwitch.until}</span>
        )}
        <button
          type="button"
          onClick={() => setEditing({ venueId: VENUE_ID, tableId: "", guestName: "", guestContact: "", seats: 2, startTime: "12:00", endTime: "14:00", date: new Date().toISOString().slice(0, 10), status: "pending" })}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          + Новая бронь
        </button>
      </div>

      {lateBookings.length > 0 && (
        <div className="mt-4 rounded-xl border-2 border-red-400 bg-red-50 p-4 animate-pulse">
          <h3 className="text-sm font-medium text-red-800">Опоздания (время наступило, скана нет)</h3>
          <ul className="mt-2 space-y-2">
            {lateBookings.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2">
                <span className="text-sm text-gray-800">{b.guestName} · {b.date} {b.startTime} · Стол {b.tableId}</span>
                <button
                  type="button"
                  onClick={() => b.id && sendLateReminder(b.id)}
                  disabled={notifyCooldown[b.id!] && Date.now() - notifyCooldown[b.id!] < LATE_NOTIFY_INTERVAL_MS}
                  className="rounded bg-amber-600 px-2 py-1 text-xs text-white disabled:opacity-50"
                >
                  Напомнить ЛПР
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-red-600">Уведомления каждые 15 мин до действия ЛПР («Ждать» или «Отменить»).</p>
        </div>
      )}

      {editing && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-medium text-gray-700">{editing.id ? "Редактирование брони" : "Новая бронь"}</h3>
          <form
            className="mt-3 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => { e.preventDefault(); saveBooking(editing); }}
          >
            <label className="block">
              <span className="block text-xs text-gray-600">ФИО</span>
              <input className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" value={editing.guestName ?? ""} onChange={(e) => setEditing((p) => ({ ...p, guestName: e.target.value }))} required />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600">Соцсеть / контакт</span>
              <input className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" value={editing.guestContact ?? ""} onChange={(e) => setEditing((p) => ({ ...p, guestContact: e.target.value }))} />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600">Стол (tableId)</span>
              <input className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" value={editing.tableId ?? ""} onChange={(e) => setEditing((p) => ({ ...p, tableId: e.target.value }))} />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600">Места</span>
              <input type="number" min={1} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" value={editing.seats ?? 2} onChange={(e) => setEditing((p) => ({ ...p, seats: Number(e.target.value) }))} />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600">Дата</span>
              <input type="date" className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" value={editing.date ?? ""} onChange={(e) => setEditing((p) => ({ ...p, date: e.target.value }))} required />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600">Время с</span>
              <input type="time" className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" value={editing.startTime ?? "12:00"} onChange={(e) => setEditing((p) => ({ ...p, startTime: e.target.value }))} />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600">Время по</span>
              <input type="time" className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" value={editing.endTime ?? "14:00"} onChange={(e) => setEditing((p) => ({ ...p, endTime: e.target.value }))} />
            </label>
            <label className="flex items-center gap-2 sm:col-span-2 text-xs text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300"
                checked={Boolean((editing as any).notifyWaiter)}
                onChange={(e) => setEditing((p) => ({ ...p, notifyWaiter: e.target.checked }))}
              />
              <span>Уведомить официанта о брони</span>
            </label>
            <label className="flex items-center gap-2 sm:col-span-2 text-xs text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300"
                checked={Boolean((editing as any).flashDashboard)}
                onChange={(e) => setEditing((p) => ({ ...p, flashDashboard: e.target.checked }))}
              />
              <span>Подсветить стол на дашборде (flashDashboard)</span>
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" disabled={saving} className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50">Сохранить</button>
              {editing.id && (
                <button type="button" onClick={() => editing.id && setDeleteConfirmId(editing.id)} className="rounded-lg border border-red-500 px-3 py-2 text-sm text-red-600">Удалить</button>
              )}
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600">Отмена</button>
            </div>
          </form>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        {loading ? (
          <p className="text-sm text-gray-500">Загрузка…</p>
        ) : (
          <table className="w-full border border-gray-200 text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="border-b p-2 text-left">ФИО</th>
                <th className="border-b p-2 text-left">Контакт</th>
                <th className="border-b p-2 text-left">Стол</th>
                <th className="border-b p-2 text-left">Дата</th>
                <th className="border-b p-2 text-left">Время С — ПО</th>
                <th className="border-b p-2 text-left">Статус</th>
                <th className="border-b p-2 text-left">Действия</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr
                  key={b.id}
                  className={isLate(b) && !b.arrived && (b.status === "pending" || b.status === "confirmed") ? "bg-red-50" : ""}
                >
                  <td className="border-b p-2">{b.guestName}</td>
                  <td className="border-b p-2">{b.guestContact}</td>
                  <td className="border-b p-2">{b.tableId}</td>
                  <td className="border-b p-2">{b.date}</td>
                  <td className="border-b p-2">{b.startTime} — {b.endTime}</td>
                  <td className="border-b p-2">{b.arrived ? "Пришёл" : b.status}</td>
                  <td className="border-b p-2">
                    <button type="button" onClick={() => setEditing({ ...b })} className="text-blue-600 underline">Изменить</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-booking-title">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h3 id="delete-booking-title" className="font-semibold text-gray-900">Удалить бронь?</h3>
            <p className="mt-2 text-sm text-gray-600">Действие нельзя отменить.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => deleteConfirmId && deleteBooking(deleteConfirmId)}
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {disableBookingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="disable-booking-title">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h3 id="disable-booking-title" className="font-semibold text-gray-900">Отключить онлайн-бронирование</h3>
            <p className="mt-2 text-sm text-gray-600">На сколько отключить приём заявок?</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {DISABLE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDisableBookingDays(opt.value)}
                  className={`rounded-lg border py-2.5 text-sm font-medium transition-colors ${
                    disableBookingDays === opt.value
                      ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                      : "border-gray-200 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setDisableBookingModalOpen(false)}
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={applyDisableBooking}
                className="flex-1 rounded-lg bg-gray-900 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                Отключить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
