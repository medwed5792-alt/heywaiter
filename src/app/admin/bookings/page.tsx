"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Booking } from "@/lib/types";
import type { GuestType } from "@/lib/types";

type BookingWithMeta = Booking & {
  startAt?: unknown;
  endAt?: unknown;
  notifyWaiter?: boolean;
  flashDashboard?: boolean;
  isUrgent?: boolean;
  bookingNote?: string;
  tableNumber?: number | string;
};

interface TableRow {
  id: string;
  number: number;
}

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

/** Проверка пересечения двух броней по времени (одна дата, один стол). */
function bookingsOverlap(
  date: string,
  startTime: string,
  endTime: string,
  other: BookingWithMeta,
  excludeId?: string
): boolean {
  if (other.id === excludeId) return false;
  if (normalizeDate(other.date) !== normalizeDate(date)) return false;
  const startA = toStartAt(date, startTime).getTime();
  const endA = toEndAt(date, startTime, endTime).getTime();
  const startB = toStartAt(other.date, other.startTime).getTime();
  const endB = toEndAt(other.date, other.startTime, other.endTime).getTime();
  return startA < endB && startB < endA;
}

const DISABLE_OPTIONS = [
  { value: 1, label: "1 день" },
  { value: 2, label: "2 дня" },
  { value: 3, label: "3 дня" },
  { value: 9999, label: "Бессрочно" },
];

const GUEST_TYPE_LABELS: Record<GuestType, string> = {
  regular: "Новый",
  constant: "Постоянный",
  favorite: "Любимый",
  vip: "VIP",
  blacklisted: "ЧС",
};

function phoneDigits(value: string): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** Только цифры номера стола для сравнения. */
function tableDigits(value: string | number | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** Нормализация даты в YYYY-MM-DD для сохранения и сравнения. */
function normalizeDate(dateStr: string): string {
  const s = String(dateStr ?? "").trim();
  if (!s) return "";
  const iso = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const ddmmyy = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (ddmmyy) {
    const [, day, month, year] = ddmmyy;
    return `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
  }
  try {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {
    // ignore
  }
  return s.slice(0, 10);
}

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
interface DayHours {
  openTime: string;
  closeTime: string;
  working?: boolean;
}
type OperatingHours = Partial<Record<DayKey, DayHours>>;

function getDayKeyFromDate(dateStr: string): DayKey {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const keys: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return keys[day] ?? "mon";
}

const DEFAULT_SLOT_START = "10:00";
const DEFAULT_SLOT_END = "23:00";
const SLOT_STEP_MINUTES = 60;

function addMinutesToTime(time: string, addMin: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + addMin;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

function getTimeSlotsForDate(dateStr: string, operatingHours: OperatingHours | null): string[] {
  const dayKey = getDayKeyFromDate(dateStr);
  const day = operatingHours?.[dayKey];
  const open = day?.working !== false && day?.openTime ? day.openTime : DEFAULT_SLOT_START;
  const close = day?.working !== false && day?.closeTime ? day.closeTime : DEFAULT_SLOT_END;
  const [oh, om] = open.split(":").map(Number);
  const [ch, cm] = close.split(":").map(Number);
  let startMins = (oh ?? 0) * 60 + (om ?? 0);
  let endMins = (ch ?? 0) * 60 + (cm ?? 0);
  if (endMins <= startMins) endMins += 24 * 60;
  const slots: string[] = [];
  for (let m = startMins; m < endMins; m += SLOT_STEP_MINUTES) {
    const h = Math.floor(m / 60) % 24;
    const min = m % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return slots;
}

function bookingCoversSlot(b: BookingWithMeta, slotTime: string, dateStr: string): boolean {
  const slotAt = toStartAt(dateStr, slotTime).getTime();
  const startAt = toStartAt(b.date, b.startTime ?? "00:00").getTime();
  const endAt = toEndAt(b.date, b.startTime ?? "00:00", b.endTime ?? "00:00").getTime();
  return slotAt >= startAt && slotAt < endAt;
}

/** Длительность в минутах между двумя временами на одну дату (end может быть на след. день). */
function durationMinutes(dateStr: string, startTime: string, endTime: string): number {
  const start = toStartAt(dateStr, startTime).getTime();
  const end = toEndAt(dateStr, startTime, endTime).getTime();
  return Math.round((end - start) / 60000);
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

type TimelineSegment =
  | { type: "free"; startTime: string; endTime: string; durationMinutes: number }
  | { type: "booking"; booking: BookingWithMeta };

/** Строит таймлайн: чередование «дырок» (свободно) и броней. Использует YYYY-MM-DD для дат. */
function buildTimelineSegments(
  tableBookings: BookingWithMeta[],
  dateStr: string,
  dayStart: string,
  dayEnd: string
): TimelineSegment[] {
  const normDate = normalizeDate(dateStr);
  const sorted = [...tableBookings].sort((a, b) => {
    const ta = toStartAt(normalizeDate(a.date), a.startTime ?? "00:00").getTime();
    const tb = toStartAt(normalizeDate(b.date), b.startTime ?? "00:00").getTime();
    return ta - tb;
  });
  const segments: TimelineSegment[] = [];
  const dayStartMs = toStartAt(normDate, dayStart).getTime();
  const dayEndMs = toEndAt(normDate, dayStart, dayEnd).getTime();

  if (sorted.length === 0) {
    const dur = durationMinutes(normDate, dayStart, dayEnd);
    segments.push({ type: "free", startTime: dayStart, endTime: dayEnd, durationMinutes: dur });
    return segments;
  }

  let prevEndMs = dayStartMs;
  for (const b of sorted) {
    const bDate = normalizeDate(b.date);
    const startMs = toStartAt(bDate, b.startTime ?? "00:00").getTime();
    const endMs = toEndAt(bDate, b.startTime ?? "00:00", b.endTime ?? "00:00").getTime();
    if (startMs > prevEndMs) {
      const gapStart = new Date(prevEndMs);
      const gapEnd = new Date(startMs);
      const gapStartStr = `${String(gapStart.getHours()).padStart(2, "0")}:${String(gapStart.getMinutes()).padStart(2, "0")}`;
      const gapEndStr = `${String(gapEnd.getHours()).padStart(2, "0")}:${String(gapEnd.getMinutes()).padStart(2, "0")}`;
      const dur = Math.round((startMs - prevEndMs) / 60000);
      segments.push({ type: "free", startTime: gapStartStr, endTime: gapEndStr, durationMinutes: dur });
    }
    segments.push({ type: "booking", booking: b });
    prevEndMs = Math.max(prevEndMs, endMs);
  }
  if (prevEndMs < dayEndMs) {
    const tailStart = new Date(prevEndMs);
    const tailStartStr = `${String(tailStart.getHours()).padStart(2, "0")}:${String(tailStart.getMinutes()).padStart(2, "0")}`;
    const dur = Math.round((dayEndMs - prevEndMs) / 60000);
    segments.push({ type: "free", startTime: tailStartStr, endTime: dayEnd, durationMinutes: dur });
  }
  return segments;
}

export default function AdminBookingsPage() {
  const [bookings, setBookings] = useState<BookingWithMeta[]>([]);
  const [bookingSwitch, setBookingSwitch] = useState<{ enabled: boolean; until: string | null }>({ enabled: true, until: null });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Booking> & { id?: string; bookingNote?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [notifyCooldown, setNotifyCooldown] = useState<Record<string, number>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [disableBookingModalOpen, setDisableBookingModalOpen] = useState(false);
  const [disableBookingDays, setDisableBookingDays] = useState<number>(1);
  const [venueGuests, setVenueGuests] = useState<{ id: string; name?: string; phone?: string; type: GuestType; note?: string }[]>([]);
  const [venueTables, setVenueTables] = useState<TableRow[]>([]);
  const [gridDate, setGridDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterTableId, setFilterTableId] = useState<string>("");
  const [filterPhone, setFilterPhone] = useState("");
  const [filterName, setFilterName] = useState("");
  const [filterTimeFrom, setFilterTimeFrom] = useState("");
  const [filterTimeTo, setFilterTimeTo] = useState("");
  const [operatingHours, setOperatingHours] = useState<OperatingHours | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [phoneDropdownOpen, setPhoneDropdownOpen] = useState(false);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const [venueEvents, setVenueEvents] = useState<{ id: string; type?: string; message?: string; createdAt?: unknown; collectionName?: "venue_events" }[]>([]);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);

  const selectedDate = gridDate;

  useEffect(() => {
    setRiskAcknowledged(false);
  }, [editing?.id, editing?.guestId]);

  const dismissVenueEvent = useCallback(async (eventId: string, collectionName?: string) => {
    const ref =
      collectionName === "staffNotifications"
        ? doc(db, "staffNotifications", eventId)
        : doc(db, "venues", VENUE_ID, "events", eventId);
    try {
      await deleteDoc(ref);
      setVenueEvents((prev) => prev.filter((e) => e.id !== eventId));
      toast.success("Уведомление удалено");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка удаления уведомления");
    }
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "venues", VENUE_ID, "guests"), (snap) => {
      setVenueGuests(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: (data.name as string) ?? "",
            phone: (data.phone as string) ?? "",
            type: (data.type as GuestType) ?? "regular",
            note: data.note as string | undefined,
          };
        })
      );
    });
    return () => unsub();
  }, []);

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
            tableNumber: data.tableNumber as number | string | undefined,
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
            bookingNote: data.bookingNote as string | undefined,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          } as BookingWithMeta;
        })
      );
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "venues", VENUE_ID, "tables"), (snap) => {
      setVenueTables(
        snap.docs
          .map((d) => {
            const data = d.data() as { number?: unknown };
            const raw = data?.number;

            // Важно: без любых fallback'ов. Если `number` отсутствует/невалиден — стол НЕ попадает в шахматку.
            let parsed: number | null = null;
            if (typeof raw === "number" && Number.isFinite(raw)) parsed = raw;
            else if (typeof raw === "string") {
              const s = raw.trim();
              if (s) {
                const n = Number(s);
                if (Number.isFinite(n)) parsed = n;
              }
            }

            // Редактор залов отфильтровывает `0` (и строку "0") как невалидный номер.
            if (parsed == null || parsed === 0) return null;
            return { id: d.id, number: parsed } satisfies TableRow;
          })
          .filter((t): t is TableRow => Boolean(t))
      );
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    getDoc(doc(db, "venues", VENUE_ID)).then((snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const oh = (data?.operatingHours ?? null) as OperatingHours | null;
        if (oh) setOperatingHours(oh);
      }
    });
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, "venues", VENUE_ID, "events"),
      orderBy("createdAt", "desc"),
      limit(30)
    );
    const unsub = onSnapshot(q, (snap) => {
      setVenueEvents(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            type: data.type as string,
            message: data.message as string,
            createdAt: data.createdAt,
            collectionName: "venue_events" as const,
          };
        })
      );
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
    async (payload: Partial<Booking> & { id?: string; bookingNote?: string }) => {
      setConflictError(null);
      setSaving(true);
      try {
        const dateRaw = payload.date ?? editing?.date ?? "";
        const date = normalizeDate(dateRaw);
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

        const excludeId = payload.id ?? undefined;
        const conflict = bookings.find(
          (b) => b.tableId === tableIdStr && bookingsOverlap(date, startTime, endTime, b, excludeId)
        );
        if (conflict) {
          setConflictError("Ошибка: стол занят на это время!");
          toast.error("Ошибка: стол занят на это время!");
          return;
        }

        const guestContactStr = String(payload.guestContact ?? editing?.guestContact ?? "");
        const seatsNum = Number(payload.seats ?? editing?.seats ?? 2) || 2;
        const nowMs = Date.now();
        const isUrgent = startAtDate.getTime() < nowMs;

        // Если гостя нет в базе — создаём запись в коллекции guests с type "regular" (Новый), чтобы не слать undefined в Firestore
        let guestIdResolved: string | null = payload.guestId != null && payload.guestId !== "" ? String(payload.guestId) : null;
        if (guestIdResolved == null) {
          const newGuestRef = await addDoc(collection(db, "venues", venueId, "guests"), {
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
          date,
          status: payload.status ?? "pending",
          startAt,
          endAt,
          notifyWaiter: payload.notifyWaiter ?? editing?.notifyWaiter ?? false,
          flashDashboard: payload.flashDashboard ?? editing?.flashDashboard ?? false,
          isUrgent,
          updatedAt: serverTimestamp(),
        };
        if (payload.guestExternalId != null && payload.guestExternalId !== "") body.guestExternalId = payload.guestExternalId;
        if (payload.bookingNote != null || (editing as { bookingNote?: string })?.bookingNote != null) {
          body.bookingNote = (payload.bookingNote ?? (editing as { bookingNote?: string })?.bookingNote ?? "").trim() || null;
        }
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
    [editing, bookings]
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

  /** Брони по venue_andrey_alt и выбранной дате. Дата и стол — нормализованные (YYYY-MM-DD, только цифры). */
  const filteredBookingsForGrid = useMemo(() => {
    const normSelected = normalizeDate(selectedDate);
    let list = bookings.filter(
      (b) => b.venueId === VENUE_ID && normalizeDate(b.date) === normSelected && b.status !== "cancelled"
    );
    if (filterTableId) {
      const selTid = tableDigits(filterTableId);
      const selTable = venueTables.find((t) => t.id === filterTableId);
      const selNum = selTable ? tableDigits(selTable.number) : "";
      list = list.filter((b) => {
        const bTid = tableDigits(b.tableId);
        const bNum = tableDigits((b as BookingWithMeta).tableNumber);
        return (selTid && (bTid === selTid || bNum === selTid)) || (selNum && (bTid === selNum || bNum === selNum));
      });
    }
    if (filterPhone.trim()) {
      const digits = phoneDigits(filterPhone);
      list = list.filter((b) => phoneDigits(b.guestContact ?? "").includes(digits));
    }
    if (filterName.trim()) {
      const q = filterName.trim().toLowerCase();
      list = list.filter((b) => (b.guestName ?? "").toLowerCase().includes(q));
    }
    if (filterTimeFrom) {
      list = list.filter((b) => (b.startTime ?? "") >= filterTimeFrom);
    }
    if (filterTimeTo) {
      list = list.filter((b) => (b.endTime ?? "") <= filterTimeTo || (b.startTime ?? "") <= filterTimeTo);
    }
    return list;
  }, [bookings, selectedDate, filterTableId, filterPhone, filterName, filterTimeFrom, filterTimeTo, venueTables]);

  const timeSlots = useMemo(() => getTimeSlotsForDate(selectedDate, operatingHours), [selectedDate, operatingHours]);
  const dayStart = timeSlots[0] ?? DEFAULT_SLOT_START;
  const dayEnd = timeSlots.length > 0 ? addMinutesToTime(timeSlots[timeSlots.length - 1], SLOT_STEP_MINUTES) : DEFAULT_SLOT_END;

  const hasSearchFilter = Boolean(filterPhone.trim() || filterName.trim());

  /** «Горячая» бронь: до прихода < 20 минут (и время ещё не прошло). */
  const isBookingUrgent = useCallback((b: BookingWithMeta): boolean => {
    const startAt = b.startAt && typeof (b.startAt as { toDate?: () => Date }).toDate === "function"
      ? (b.startAt as { toDate: () => Date }).toDate()
      : toStartAt(b.date, b.startTime ?? "00:00");
    const now = Date.now();
    const startMs = startAt.getTime();
    const minsToStart = (startMs - now) / 60000;
    return Number.isFinite(minsToStart) && minsToStart >= 0 && minsToStart < 20;
  }, []);

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
    <div className="bg-white text-black font-sans">
      <h2 className="text-lg font-semibold">Брони</h2>
      <p className="mt-2 text-sm">
        Создание, редактирование, удаление. Мастер-выключатель онлайн-бронирования. Контроль опозданий.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggleBookingMaster}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${bookingSwitch.enabled ? "bg-green-600 text-white" : "bg-neutral-300 text-white"}`}
        >
          {bookingSwitch.enabled ? "Онлайн-бронирование вкл" : "Онлайн-бронирование выкл"}
        </button>
        {bookingSwitch.until && (
          <span className="text-sm">До: {bookingSwitch.until}</span>
        )}
        <button
          type="button"
          onClick={() => {
            setConflictError(null);
            setEditing({
              venueId: VENUE_ID,
              tableId: "",
              guestName: "",
              guestContact: "",
              seats: 2,
              startTime: "12:00",
              endTime: "14:00",
              date: gridDate || new Date().toISOString().slice(0, 10),
              status: "pending",
            });
          }}
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/80"
        >
          + Новая бронь
        </button>
      </div>

      {(lateBookings.length > 0 || venueEvents.length > 0) && (
        <div className="mt-4 rounded-xl border-2 border-red-400 bg-red-50 p-4">
          {lateBookings.length > 0 && (
            <>
              <h3 className="text-sm font-medium text-red-800">Опоздания (время наступило, скана нет)</h3>
              <ul className="mt-2 space-y-2">
                {lateBookings.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2">
                    <span className="text-sm">{b.guestName} · {b.date} {b.startTime} · Стол {b.tableId}</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => b.id && sendLateReminder(b.id)}
                        disabled={notifyCooldown[b.id!] && Date.now() - notifyCooldown[b.id!] < LATE_NOTIFY_INTERVAL_MS}
                        className="rounded bg-amber-600 px-2 py-1 text-xs text-white disabled:opacity-50"
                      >
                        Напомнить ЛПР
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-red-600">Уведомления каждые 15 мин до действия ЛПР («Ждать» или «Отменить»).</p>
            </>
          )}
          {venueEvents.length > 0 && (
            <div className={lateBookings.length > 0 ? "mt-4 pt-4 border-t border-red-200" : ""}>
              <h3 className="text-sm font-medium text-red-800">Уведомления (события)</h3>
              <ul className="mt-2 space-y-2">
                {venueEvents.map((ev) => (
                  <li key={ev.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2">
                    <span className="text-sm">{ev.message ?? ev.type ?? ev.id}</span>
                    <button
                      type="button"
                      onClick={() => dismissVenueEvent(ev.id, ev.collectionName)}
                      className="rounded border border-red-400 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                      title="Удалить событие из Firestore"
                    >
                      ОТМЕНИТЬ ЛПР
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {editing && (() => {
        const selectedGuest = editing.guestId ? venueGuests.find((g) => g.id === editing.guestId) : null;
        const isBlacklisted = selectedGuest?.type === "blacklisted";
        const noteText = selectedGuest?.note ?? "";
        const hasRiskNote = /конфликт|не пришел|инцидент/i.test(noteText);
        const hasRisk = isBlacklisted || hasRiskNote;
        const phoneDigitsTyped = phoneDigits(editing.guestContact ?? "");
        const phoneSuggestions =
          phoneDigitsTyped.length >= 2
            ? venueGuests
                .filter((g) => {
                  const p = phoneDigits(g.phone ?? "");
                  return p && p.includes(phoneDigitsTyped);
                })
                .slice(0, 8)
            : [];
        const hasConflict = Boolean(conflictError);
        return (
        <div className={`mt-4 rounded-xl border p-4 ${hasRisk || hasConflict ? "border-red-500 bg-red-50/80" : "border-neutral-200 bg-white"}`}>
          {hasRisk && (
            <div className="mb-3 rounded-lg border-2 border-red-500 bg-red-100 p-3">
              <p className="text-sm font-bold text-red-800">
                ⚠️ ВНИМАНИЕ! У гостя были инциденты в прошлом. Бронировать с осторожностью!
              </p>
              <label className="mt-2 flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-red-500"
                  checked={riskAcknowledged}
                  onChange={(e) => setRiskAcknowledged(e.target.checked)}
                />
                <span className="text-sm font-medium text-red-800">Я ознакомлен с риском и подтверждаю бронирование</span>
              </label>
            </div>
          )}
          {hasConflict && (
            <p className="mb-3 text-sm font-medium text-red-800">{conflictError}</p>
          )}
          <h3 className="text-sm font-medium">{editing.id ? "Редактирование брони" : "Новая бронь"}</h3>
          <form
            className="mt-3 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => { e.preventDefault(); saveBooking(editing); }}
          >
            <label className="block sm:col-span-2 relative">
              <span className="block text-xs">Телефон (поиск гостя)</span>
              <input
                ref={phoneInputRef}
                type="tel"
                className={`mt-1 w-full rounded border px-2 py-1.5 text-sm ${hasConflict ? "border-red-500" : "border-neutral-300"}`}
                value={editing.guestContact ?? ""}
                onChange={(e) => {
                  setEditing((p) => ({ ...p, guestContact: e.target.value }));
                  setPhoneDropdownOpen(true);
                }}
                onFocus={() => phoneDigitsTyped.length >= 2 && setPhoneDropdownOpen(true)}
                onBlur={() => setTimeout(() => setPhoneDropdownOpen(false), 200)}
                placeholder="Введите цифры телефона"
              />
              {phoneDropdownOpen && phoneSuggestions.length > 0 && (
                <ul className="absolute z-10 mt-0.5 w-full rounded border border-neutral-200 bg-white shadow-lg py-1 max-h-48 overflow-auto">
                  {phoneSuggestions.map((g) => (
                    <li key={g.id}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-100"
                        onClick={() => {
                          setEditing((p) => ({ ...p, guestId: g.id, guestName: g.name ?? "", guestContact: g.phone ?? "" }));
                          setPhoneDropdownOpen(false);
                        }}
                      >
                        {g.phone ?? ""} — {g.name || "Без имени"} {g.type !== "regular" ? `(${GUEST_TYPE_LABELS[g.type]})` : ""}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </label>
            <label className="block sm:col-span-2">
              <span className="block text-xs">Гость из базы</span>
              <select
                className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
                value={editing.guestId ?? ""}
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) {
                    setEditing((p) => ({ ...p, guestId: undefined, guestName: p.guestName ?? "", guestContact: p.guestContact ?? "" }));
                    return;
                  }
                  const g = venueGuests.find((x) => x.id === id);
                  if (g) setEditing((p) => ({ ...p, guestId: g.id, guestName: g.name ?? "", guestContact: g.phone ?? "" }));
                }}
              >
                <option value="">— Ввести вручную —</option>
                {venueGuests.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name || g.phone || g.id.slice(0, 8)} {g.type !== "regular" ? `(${GUEST_TYPE_LABELS[g.type]})` : ""}
                  </option>
                ))}
              </select>
            </label>
            {selectedGuest && (
              <div className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-sm">
                <p className="font-medium text-amber-900">Тип гостя: {GUEST_TYPE_LABELS[selectedGuest.type]}</p>
                {selectedGuest.note?.trim() ? <p className="mt-1 text-amber-800 whitespace-pre-wrap">{selectedGuest.note}</p> : null}
              </div>
            )}
            <label className="block">
              <span className="block text-xs">ФИО</span>
              <input className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm" value={editing.guestName ?? ""} onChange={(e) => setEditing((p) => ({ ...p, guestName: e.target.value }))} required />
            </label>
            <label className="block sm:col-span-2">
              <span className="block text-xs">Примечание к данной брони</span>
              <textarea className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm min-h-[60px]" value={(editing as { bookingNote?: string }).bookingNote ?? ""} onChange={(e) => setEditing((p) => ({ ...p, bookingNote: e.target.value }))} placeholder="Например: свой торт" />
            </label>
            <label className="block">
              <span className="block text-xs">Стол (tableId)</span>
              <input className={`mt-1 w-full rounded border px-2 py-1.5 text-sm ${hasConflict ? "border-red-500 bg-red-50" : "border-neutral-300"}`} value={editing.tableId ?? ""} onChange={(e) => setEditing((p) => ({ ...p, tableId: e.target.value }))} />
            </label>
            <label className="block">
              <span className="block text-xs">Места</span>
              <input type="number" min={1} className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm" value={editing.seats ?? 2} onChange={(e) => setEditing((p) => ({ ...p, seats: Number(e.target.value) }))} />
            </label>
            <label className="block">
              <span className="block text-xs">Дата</span>
              <input type="date" className={`mt-1 w-full rounded border px-2 py-1.5 text-sm ${hasConflict ? "border-red-500 bg-red-50" : "border-neutral-300"}`} value={editing.date ?? ""} onChange={(e) => setEditing((p) => ({ ...p, date: e.target.value }))} required />
            </label>
            <label className="block">
              <span className="block text-xs">Время с</span>
              <input type="time" className={`mt-1 w-full rounded border px-2 py-1.5 text-sm ${hasConflict ? "border-red-500 bg-red-50" : "border-neutral-300"}`} value={editing.startTime ?? "12:00"} onChange={(e) => setEditing((p) => ({ ...p, startTime: e.target.value }))} />
            </label>
            <label className="block">
              <span className="block text-xs">Время по</span>
              <input type="time" className={`mt-1 w-full rounded border px-2 py-1.5 text-sm ${hasConflict ? "border-red-500 bg-red-50" : "border-neutral-300"}`} value={editing.endTime ?? "14:00"} onChange={(e) => setEditing((p) => ({ ...p, endTime: e.target.value }))} />
            </label>
            <label className="flex items-center gap-2 sm:col-span-2 text-xs">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-neutral-300"
                checked={Boolean((editing as any).notifyWaiter)}
                onChange={(e) => setEditing((p) => ({ ...p, notifyWaiter: e.target.checked }))}
              />
              <span>Уведомить официанта о брони</span>
            </label>
            <label className="flex items-center gap-2 sm:col-span-2 text-xs">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-neutral-300"
                checked={Boolean((editing as any).flashDashboard)}
                onChange={(e) => setEditing((p) => ({ ...p, flashDashboard: e.target.checked }))}
              />
              <span>Подсветить стол на дашборде (flashDashboard)</span>
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" disabled={saving || hasConflict || (hasRisk && !riskAcknowledged)} className="rounded-lg bg-black px-3 py-2 text-sm text-white disabled:opacity-50">Сохранить</button>
              {editing.id && (
                <button type="button" onClick={() => editing.id && setDeleteConfirmId(editing.id)} className="rounded-lg border border-red-500 px-3 py-2 text-sm text-red-600">Удалить</button>
              )}
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-black/70">Отмена</button>
            </div>
          </form>
        </div>
        );
      })()}

      <div className="mt-4">
        <h3 className="text-base font-semibold">Шахматка по столам</h3>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span>Дата</span>
            <input type="date" className="rounded border border-neutral-300 px-2 py-1.5 text-sm" value={gridDate} onChange={(e) => setGridDate(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span>Время с</span>
            <input type="time" className="rounded border border-neutral-300 px-2 py-1.5 text-sm w-28" value={filterTimeFrom} onChange={(e) => setFilterTimeFrom(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span>по</span>
            <input type="time" className="rounded border border-neutral-300 px-2 py-1.5 text-sm w-28" value={filterTimeTo} onChange={(e) => setFilterTimeTo(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span>Стол</span>
            <select className="rounded border border-neutral-300 px-2 py-1.5 text-sm" value={filterTableId} onChange={(e) => setFilterTableId(e.target.value)}>
              <option value="">Все</option>
              {venueTables.map((t) => (
                <option key={t.id} value={t.id}>№{t.number}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span>Телефон</span>
            <input type="text" className="rounded border border-neutral-300 px-2 py-1.5 text-sm w-36" value={filterPhone} onChange={(e) => setFilterPhone(e.target.value)} placeholder="Поиск" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span>Имя</span>
            <input type="text" className="rounded border border-neutral-300 px-2 py-1.5 text-sm w-36" value={filterName} onChange={(e) => setFilterName(e.target.value)} placeholder="Поиск" />
          </label>
        </div>
        {loading ? (
          <p className="mt-4 text-sm">Загрузка…</p>
        ) : venueTables.length === 0 ? (
          <p className="mt-4 rounded-xl border border-neutral-200 bg-white p-6 text-center text-sm text-black/60">Нет столов. Добавьте столы в Зал & QR.</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {venueTables.map((table) => {
              const tId = tableDigits(table.id);
              const tNum = tableDigits(table.number);
              const tableBookings = filteredBookingsForGrid.filter((b) => {
                const bTid = tableDigits(b.tableId);
                const bNum = tableDigits((b as BookingWithMeta).tableNumber);
                return (tId && (bTid === tId || bNum === tId)) || (tNum && (bTid === tNum || bNum === tNum));
              });
              const tableHasSearchMatch = !hasSearchFilter || tableBookings.length > 0;
              return (
                <div
                  key={table.id}
                  className={`rounded-xl border-2 border-neutral-200 bg-white p-4 shadow-sm transition-opacity ${!tableHasSearchMatch ? "opacity-50" : ""}`}
                >
                  <div className="text-xl font-bold">Стол №{table.number}</div>
                  <div className="mt-2 space-y-1.5">
                    {buildTimelineSegments(tableBookings, selectedDate, dayStart, dayEnd).map((seg, idx) => {
                      if (seg.type === "free") {
                        const isFirstSlot = seg.startTime === dayStart;
                        const label = isFirstSlot ? "До" : "После";
                        return (
                          <button
                            key={`free-${idx}-${seg.startTime}`}
                            type="button"
                            onClick={() => {
                              setConflictError(null);
                              setEditing({
                                venueId: VENUE_ID,
                                tableId: table.id,
                                guestName: "",
                                guestContact: "",
                                seats: 2,
                                startTime: seg.startTime,
                                endTime: seg.endTime,
                                date: selectedDate,
                                status: "pending",
                              });
                            }}
                            className="w-full rounded-lg border border-dashed border-neutral-300 bg-neutral-100 px-2 py-2 text-sm text-black/60 hover:border-neutral-400 hover:bg-neutral-200"
                          >
                            <span className="font-medium">{label}</span>
                            <span className="ml-1 text-xs">{seg.startTime} – {seg.endTime}</span>
                          </button>
                        );
                      }
                      const b = seg.booking;
                      const urgent = isBookingUrgent(b);
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setEditing({ ...b, bookingNote: (b as BookingWithMeta).bookingNote })}
                          className={`w-full rounded-lg border px-2 py-2 text-sm font-medium hover:border-orange-400 ${
                            urgent
                              ? "border-orange-400 bg-orange-100 text-orange-800 animate-pulse"
                              : "border-orange-300 bg-orange-50 text-orange-900 hover:bg-orange-100"
                          }`}
                        >
                          {b.startTime ?? ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-booking-title">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h3 id="delete-booking-title" className="font-semibold">Удалить бронь?</h3>
            <p className="mt-2 text-sm text-black/70">Действие нельзя отменить.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium hover:bg-neutral-50"
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
            <h3 id="disable-booking-title" className="font-semibold">Отключить онлайн-бронирование</h3>
            <p className="mt-2 text-sm text-black/70">На сколько отключить приём заявок?</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {DISABLE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDisableBookingDays(opt.value)}
                  className={`rounded-lg border py-2.5 text-sm font-medium transition-colors ${
                    disableBookingDays === opt.value
                      ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                      : "border-neutral-200 text-black/70 hover:bg-neutral-50"
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
                className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium hover:bg-neutral-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={applyDisableBooking}
                className="flex-1 rounded-lg bg-black py-2 text-sm font-medium text-white hover:bg-black/80"
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
