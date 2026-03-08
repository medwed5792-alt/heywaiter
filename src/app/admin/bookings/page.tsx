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

const VENUE_ID = "current";
const LATE_NOTIFY_INTERVAL_MS = 15 * 60 * 1000; // 15 мин

function toStartAt(date: string, startTime: string): Date {
  const [h, m] = startTime.split(":").map(Number);
  const d = new Date(date);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}

function isLate(b: Booking): boolean {
  const startAt = b.startAt ? (b.startAt as { toDate?: () => Date }).toDate?.() : toStartAt(b.date, b.startTime);
  return startAt ? startAt.getTime() < Date.now() : false;
}

export default function AdminBookingsPage() {
  const [bookings, setBookings] = useState<(Booking & { startAt?: unknown })[]>([]);
  const [bookingSwitch, setBookingSwitch] = useState<{ enabled: boolean; until: string | null }>({ enabled: true, until: null });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Booking> & { id?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [notifyCooldown, setNotifyCooldown] = useState<Record<string, number>>({});

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
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          } as Booking & { startAt?: unknown };
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
        const startAt = Timestamp.fromDate(toStartAt(date, startTime));
        const body = {
          venueId: VENUE_ID,
          tableId: payload.tableId ?? "",
          guestName: payload.guestName ?? "",
          guestContact: payload.guestContact ?? "",
          guestId: payload.guestId,
          guestExternalId: payload.guestExternalId,
          seats: payload.seats ?? 2,
          startTime: payload.startTime ?? "12:00",
          endTime: payload.endTime ?? "14:00",
          date: payload.date ?? "",
          status: payload.status ?? "pending",
          startAt,
          updatedAt: serverTimestamp(),
        };
        if (payload.id) {
          await updateDoc(doc(db, "bookings", payload.id), body);
          toast.success("Бронь обновлена");
        } else {
          await addDoc(collection(db, "bookings"), { ...body, createdAt: serverTimestamp() });
          toast.success("Бронь создана");
        }
        setEditing(null);
      } catch (e) {
        toast.error("Ошибка сохранения");
      } finally {
        setSaving(false);
      }
    },
    [editing]
  );

  const deleteBooking = useCallback(async (id: string) => {
    if (!confirm("Удалить бронь?")) return;
    try {
      await deleteDoc(doc(db, "bookings", id));
      toast.success("Бронь удалена");
      setEditing(null);
    } catch {
      toast.error("Ошибка удаления");
    }
  }, []);

  const toggleBookingMaster = useCallback(async () => {
    try {
      const snap = await getDoc(doc(db, "venues", VENUE_ID));
      const data = snap.exists() ? snap.data() : {};
      const config = { ...(data?.config ?? {}), bookingEnabled: !bookingSwitch.enabled };
      if (config.bookingEnabled === false) {
        const days = prompt("Отключить онлайн-бронирование на сколько дней? (1, 2, 3 или пусто = бессрочно)", "1");
        if (days === null) return;
        const n = days.trim() === "" ? 9999 : parseInt(days, 10);
        const until = Number.isNaN(n) ? null : new Date(Date.now() + n * 24 * 60 * 60 * 1000);
        (config as Record<string, unknown>).bookingEnabledUntil = until;
      } else {
        delete (config as Record<string, unknown>).bookingEnabledUntil;
      }
      await updateDoc(doc(db, "venues", VENUE_ID), { config, updatedAt: serverTimestamp() });
      setBookingSwitch((prev) => ({
        enabled: !prev.enabled,
        until: (config as { bookingEnabledUntil?: Date }).bookingEnabledUntil
          ? (config as { bookingEnabledUntil: Date }).bookingEnabledUntil.toISOString().slice(0, 16)
          : null,
      }));
      toast.success(bookingSwitch.enabled ? "Онлайн-бронирование отключено" : "Онлайн-бронирование включено");
    } catch {
      toast.error("Ошибка переключателя");
    }
  }, [bookingSwitch.enabled]);

  const sendLateReminder = useCallback(async (bookingId: string) => {
    try {
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
      setNotifyCooldown((prev) => ({ ...prev, [bookingId]: Date.now() }));
      toast.success("Напоминание ЛПР отправлено");
    } catch {
      toast.error("Ошибка отправки");
    }
  }, []);

  const lateBookings = bookings.filter((b) => (b.status === "pending" || b.status === "confirmed") && !b.arrived && isLate(b));

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
            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" disabled={saving} className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50">Сохранить</button>
              {editing.id && (
                <button type="button" onClick={() => editing.id && deleteBooking(editing.id)} className="rounded-lg border border-red-500 px-3 py-2 text-sm text-red-600">Удалить</button>
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
    </div>
  );
}
