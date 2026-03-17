"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  limit,
  orderBy,
  updateDoc,
  addDoc,
  setDoc,
  serverTimestamp,
  deleteDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { VenueType } from "@/lib/types";
import type { Guest } from "@/lib/types";
import { LPR_ROLES } from "@/lib/types";

const BOOKING_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 часа для "ближайшие 2 часа"
const BLINK_IF_LESS_MS = 30 * 60 * 1000; // мерцание если до брони < 30 мин
const BOOKING_REMINDER_MINS = 15; // уведомление в ленту за 15 мин до брони

interface ClosedSessionForRating {
  id: string;
  guestId?: string;
  guestName: string;
  waiterId?: string;
  closedAt: unknown;
}

interface TableRow {
  id: string;
  number: number;
  hallId?: string;
  name?: string;
}

interface SessionOnTable {
  sessionId: string;
  tableId: string;
  tableNumber: number;
  guestId?: string;
}

interface BookingOnTable {
  id: string;
  date: string;
  startTime: string;
  startAt: Date;
  guestName?: string;
  isUrgent?: boolean;
  status?: string;
  tableNumber?: string | number;
  /** true = напоминание уже показали, по «ОК» пишем в Firestore */
  isAlerted?: boolean;
}

interface ShiftStaff {
  id: string;
  displayName: string;
  position?: string;
}

/** Сотрудник с закреплёнными столами (из Команды) для отображения «по умолчанию» на Дашборде */
interface StaffWithTables {
  id: string;
  displayName: string;
  assignedTableIds: string[];
  onShift: boolean;
}

interface FeedEvent {
  id: string;
  type: string;
  message: string;
  tableId?: string;
  read: boolean;
  createdAt: unknown;
  /** venueId из документа, если есть — для точного пути удаления */
  venueId?: string;
}

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

interface OperatingDay {
  working: boolean;
  openTime: string;
  closeTime: string;
}

type OperatingHours = Record<DayKey, OperatingDay>;

function toStartAt(date: string, startTime: string): Date {
  const [h, m] = startTime.split(":").map(Number);
  const d = new Date(date);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}

function formatTimeSafe(date: Date): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getTodayKey(date: Date): DayKey {
  const day = date.getDay(); // 0-6, 0=Sunday
  switch (day) {
    case 0:
      return "sun";
    case 1:
      return "mon";
    case 2:
      return "tue";
    case 3:
      return "wed";
    case 4:
      return "thu";
    case 5:
      return "fri";
    case 6:
    default:
      return "sat";
  }
}

function parseTimeToToday(date: Date, time: string): Date | null {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(":").map((v) => Number(v));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

/** Событие с техническим мусором в message (NUID, длинные ID) не показываем в ленте */
function isInvalidEventMessage(message: string | undefined): boolean {
  if (!message || typeof message !== "string") return false;
  if (/NUID/i.test(message)) return true;
  if (/^[a-zA-Z0-9_-]{20,}$/.test(message.trim())) return true;
  if (/[a-zA-Z0-9_-]{25,}/.test(message)) return true;
  return false;
}

/** tableId/tableNumber в виде длинного ID — показываем «Ошибка данных стола» */
function looksLikeTableIdError(tableId: string | number | undefined): boolean {
  if (tableId == null) return false;
  const s = String(tableId).trim();
  return s.length > 15 || /NUID/i.test(s) || /^[a-zA-Z0-9_-]{20,}$/.test(s);
}

function TableSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="h-5 w-24 rounded bg-gray-200" />
      <div className="mt-2 h-8 w-32 rounded bg-gray-200" />
    </div>
  );
}

function EventSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-gray-100 bg-gray-50 p-3">
      <div className="h-4 w-full rounded bg-gray-200" />
      <div className="mt-1 h-3 w-2/3 rounded bg-gray-200" />
    </div>
  );
}

const venueId = "venue_andrey_alt";

function AdminDashboardContent() {
  const [venueType, setVenueType] = useState<VenueType | null>(null);
  const [venueLoading, setVenueLoading] = useState(true);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [occupiedCount, setOccupiedCount] = useState(0);
  const [bookingsTodayCount, setBookingsTodayCount] = useState(0);
  const [activeBookings, setActiveBookings] = useState<BookingOnTable[]>([]);
  const [onShiftCount, setOnShiftCount] = useState(0);
  const [staffList, setStaffList] = useState<StaffWithTables[]>([]);
  const [venueStaffOnShift, setVenueStaffOnShift] = useState<Record<string, boolean>>({});
  const [sessionsByTable, setSessionsByTable] = useState<Record<string, SessionOnTable>>({});
  const [bookingsByTable, setBookingsByTable] = useState<Record<string, BookingOnTable[]>>({});
  const [assignmentsByTable, setAssignmentsByTable] = useState<Record<string, string>>({});
  const [guestNames, setGuestNames] = useState<Record<string, string>>({});
  const [guestRatings, setGuestRatings] = useState<Record<string, number>>({});
  const [feedEvents, setFeedEvents] = useState<FeedEvent[]>([]);
  const [shiftEvents, setShiftEvents] = useState<FeedEvent[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [activeSos, setActiveSos] = useState<FeedEvent | null>(null);
  const [unratedClosedSessions, setUnratedClosedSessions] = useState<ClosedSessionForRating[]>([]);
  const [dismissedBookings, setDismissedBookings] = useState<string[]>([]);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [guestModal, setGuestModal] = useState<Guest | null>(null);
  const [operatingHours, setOperatingHours] = useState<OperatingHours | null>(null);
  const [endOfDayLoading, setEndOfDayLoading] = useState(false);
  const activeSessionIdsRef = useRef<Set<string>>(new Set());
  const autoResetDoneRef = useRef(false);

  const todayStr = new Date().toISOString().slice(0, 10);

  const performEndOfDayReset = useCallback(
    async (reason: "auto" | "manual") => {
      setEndOfDayLoading(true);
      try {
        const batch = writeBatch(db);

        // onShift = false в venues/venue_andrey_alt/staff (единая точка с Mini App)
        const venueStaffSnap = await getDocs(collection(db, "venues", venueId, "staff"));
        venueStaffSnap.docs.forEach((d) => {
          batch.update(d.ref, { onShift: false });
        });

        // tables: remove assignments.waiter
        const tablesSnap = await getDocs(collection(db, "venues", venueId, "tables"));
        tablesSnap.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const assignments = (data.assignments as Record<string, unknown> | undefined) ?? {};
          if (assignments && Object.prototype.hasOwnProperty.call(assignments, "waiter")) {
            const updated = { ...assignments };
            delete (updated as any).waiter;
            const ref = doc(db, "venues", venueId, "tables", docSnap.id);
            batch.update(ref, {
              assignments: updated,
            });
          }
        });

        await batch.commit();
        await addDoc(collection(db, "venues", venueId, "events"), {
          type: "system",
          message: "Система: Смена завершена автоматически по графику",
          createdAt: serverTimestamp(),
        });
        toast.success(reason === "manual" ? "День завершён. Смена сброшена." : "Авто-сброс смены выполнен.");
      } catch (e) {
        console.error(e);
        toast.error(e instanceof Error ? e.message : "Не удалось выполнить сброс смены");
      } finally {
        setEndOfDayLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "venues", venueId));
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data();
          setVenueType((data?.venueType as VenueType) || "full_service");
          const oh = (data?.operatingHours ?? null) as OperatingHours | null;
          if (oh) setOperatingHours(oh);
        } else {
          setVenueType("full_service");
        }
      } catch {
        if (!cancelled) setVenueType("full_service");
      } finally {
        if (!cancelled) setVenueLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!venueType || venueType !== "full_service") return;
    let cancelled = false;
    getDocs(collection(db, "venues", venueId, "tables"))
      .then((snap) => {
        if (cancelled) return;
        const list = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            number: (data.number as number) ?? 0,
            hallId: data.hallId as string | undefined,
            name: data.name as string | undefined,
          };
        });
        setTables(list);
      })
      .catch((e) => console.error("[admin/dashboard] tables load error:", e));
    return () => {
      cancelled = true;
    };
  }, [venueType]);

  useEffect(() => {
    if (!venueType || venueType !== "full_service") return;
    const unsub = onSnapshot(
      query(collection(db, "activeSessions"), where("venueId", "==", venueId), where("status", "==", "check_in_success")),
      (snap) => {
        const nextIds = new Set(snap.docs.map((d) => d.id));
        activeSessionIdsRef.current = new Set([...activeSessionIdsRef.current, ...nextIds]);
        setOccupiedCount(snap.size);
        const byTable: Record<string, SessionOnTable> = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          const tableId = data.tableId ?? d.id;
          byTable[tableId] = {
            sessionId: d.id,
            tableId,
            tableNumber: data.tableNumber ?? 0,
            guestId: data.guestId,
          };
        });
        setSessionsByTable(byTable);
      }
    );
    return () => unsub();
  }, [venueType]);

  // Авто-сброс «забытых» смен: сотрудники с onShift из venues/.../staff, смена с вчера — сбросить
  useEffect(() => {
    if (autoResetDoneRef.current || !operatingHours || venueType !== "full_service") return;
    const now = new Date();
    const dayKey = getTodayKey(now);
    const today = operatingHours[dayKey];
    if (!today || !today.working) return;
    const open = parseTimeToToday(now, today.openTime);
    if (!open || now.getTime() < open.getTime()) return;
    let cancelled = false;
    getDocs(collection(db, "venues", venueId, "staff"))
      .then((snap) => {
        if (cancelled) return;
        const todayStart = startOfDay(now).getTime();
        for (const d of snap.docs) {
          const data = d.data();
          if (data.onShift !== true) continue;
          const start = data.shiftStartTime as { toDate?: () => Date } | undefined;
          const startDate = start && typeof (start as any).toDate === "function" ? (start as { toDate: () => Date }).toDate() : null;
          if (startDate && startDate.getTime() < todayStart) {
            autoResetDoneRef.current = true;
            performEndOfDayReset("auto");
            return;
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [operatingHours, venueType, performEndOfDayReset]);

  useEffect(() => {
    if (!venueType || venueType !== "full_service") return;
    const today = new Date();
    const dayStart = startOfDay(today);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const q = query(
      collection(db, "bookings"),
      where("venueId", "==", venueId),
      where("status", "==", "pending"),
      orderBy("startAt", "asc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        try {
          const now = Date.now();
          const windowEnd = now + BOOKING_WINDOW_MS;
          const byTable: Record<string, BookingOnTable[]> = {};
          const activeForToday: BookingOnTable[] = [];

          snap.docs.forEach((d) => {
            const data = d.data();
            const status = (data.status as string) ?? "pending";
            if (status === "cancelled") return;

            const startAtSource =
              (data.toStartAt as { toDate?: () => Date } | Date | undefined) ??
              (data.startAt as { toDate?: () => Date } | Date | undefined);
            const startAt =
              startAtSource && typeof (startAtSource as any).toDate === "function"
                ? (startAtSource as { toDate: () => Date }).toDate()
                : startAtSource instanceof Date
                ? startAtSource
                : null;
            if (!startAt) return;
            const startMs = startAt.getTime();
            if (Number.isNaN(startMs)) return;

            const dateStr = startAt.toISOString().slice(0, 10);

            if (startAt >= dayStart && startAt < dayEnd) {
              const tableNumberToday = (data.tableNumber as number | string | undefined) ?? undefined;
              const tableIdToday = String(data.tableId ?? (tableNumberToday != null ? tableNumberToday : "")).trim();
              const bookingToday: BookingOnTable = {
                id: d.id,
                date: dateStr,
                startTime:
                  (data.startTime as string) ??
                  `${String(startAt.getHours()).padStart(2, "0")}:${String(startAt.getMinutes()).padStart(2, "0")}`,
                startAt,
                guestName: data.guestName as string | undefined,
                isUrgent: data.isUrgent === true,
                status,
                tableNumber: tableNumberToday ?? tableIdToday,
                isAlerted: data.isAlerted === true,
              };
              activeForToday.push(bookingToday);
            }

            if (startMs < now || startMs > windowEnd) return;

            const tableNumber = (data.tableNumber as number | string | undefined) ?? undefined;
            const tableId = String(data.tableId ?? (tableNumber != null ? tableNumber : "")).trim();
            if (!tableId) return;

            const b: BookingOnTable = {
              id: d.id,
              date: dateStr,
              startTime:
                (data.startTime as string) ??
                `${String(startAt.getHours()).padStart(2, "0")}:${String(startAt.getMinutes()).padStart(2, "0")}`,
              startAt,
              guestName: data.guestName as string | undefined,
              isUrgent: data.isUrgent === true,
              status,
              tableNumber: tableNumber ?? tableId,
              isAlerted: data.isAlerted === true,
            };
            if (!byTable[tableId]) byTable[tableId] = [];
            byTable[tableId].push(b);
          });

          setActiveBookings(activeForToday);
          setBookingsTodayCount(activeForToday.length);
          setBookingsByTable(byTable);
        } catch (e) {
          console.error("[admin/dashboard] bookings snapshot error:", e);
        }
      }
    );
    return () => unsub();
  }, [venueType]);

  // onShift только из venues/venue_andrey_alt/staff (единая точка с Mini App)
  useEffect(() => {
    if (!venueType) return;
    const unsub = onSnapshot(collection(db, "venues", venueId, "staff"), (snap) => {
      const next: Record<string, boolean> = {};
      let count = 0;
      snap.docs.forEach((d) => {
        const onShift = d.data().onShift === true;
        next[d.id] = onShift;
        if (onShift) count++;
      });
      setVenueStaffOnShift(next);
      setOnShiftCount(count);
    });
    return () => unsub();
  }, [venueType]);

  // Список официантов на смене для селекта (имена из root staff, onShift из venue staff)
  const onShiftWaitersFromVenue = useMemo(() => {
    const byId = venueStaffOnShift ?? {};
    return staffList
      .filter((s) => byId[s.id] === true)
      .map((s) => ({ id: s.id, displayName: s.displayName, position: "" }));
  }, [staffList, venueStaffOnShift]);

  useEffect(() => {
    if (!venueType) return;
    const unsub = onSnapshot(
      query(collection(db, "staff"), where("venueId", "==", venueId), where("active", "==", true)),
      (snap) => {
        const list: StaffWithTables[] = snap.docs.map((d) => {
          const data = d.data();
          const firstName = (data.firstName as string) ?? "";
          const lastName = (data.lastName as string) ?? "";
          const displayName = [firstName, lastName].filter(Boolean).join(" ") || d.id.slice(-8);
          const assignedTableIds = (data.assignedTableIds as string[] | undefined) ?? [];
          return {
            id: d.id,
            displayName,
            assignedTableIds,
            onShift: data.onShift === true,
          };
        });
        setStaffList(list);
      }
    );
    return () => unsub();
  }, [venueType]);

  useEffect(() => {
    if (!tables.length) return;
    const unsub = onSnapshot(collection(db, "venues", venueId, "tables"), (snap) => {
      const next: Record<string, string> = {};
      snap.docs.forEach((d) => {
        const data = d.data();
        const a = data.assignments as Record<string, string> | undefined;
        const staffId = a?.waiter ?? (data.assignedStaffId as string | undefined);
        if (staffId) next[d.id] = staffId;
      });
      setAssignmentsByTable((prev) => ({ ...prev, ...next }));
    });
    return () => unsub();
  }, [tables.length]);

  const tableIds = tables.map((t) => t?.id).filter(Boolean).join(",");
  useEffect(() => {
    if (!tables.length) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const t of tables) {
        if (cancelled || !t?.id) return;
        const snap = await getDoc(doc(db, "venues", venueId, "tables", t.id));
        if (snap.exists()) {
          const data = snap.data() ?? {};
          const a = data.assignments as Record<string, string> | undefined;
          const staffId = a?.waiter ?? (data.assignedStaffId as string | undefined);
          if (staffId) next[t.id] = staffId;
        }
      }
      if (!cancelled) setAssignmentsByTable((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
  }, [tableIds, tables]);

  const guestIds = Object.values(sessionsByTable)
    .map((s) => s.guestId)
    .filter(Boolean) as string[];
  useEffect(() => {
    if (guestIds.length === 0) {
      setGuestNames({});
      setGuestRatings({});
      return;
    }
    let cancelled = false;
    (async () => {
      const names: Record<string, string> = {};
      const ratings: Record<string, number> = {};
      await Promise.all(
        guestIds.map(async (id) => {
          if (cancelled) return;
          const snap = await getDoc(doc(db, "guests", id));
          if (snap.exists()) {
            const d = snap.data();
            names[id] = (d.name as string) || (d.nickname as string) || (d.phone as string) || id.slice(0, 8);
            const r = (d.globalGuestScore as number) ?? (d.rating as number);
            if (r != null) ratings[id] = r;
          }
        })
      );
      if (!cancelled) {
        setGuestNames(names);
        setGuestRatings(ratings);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [guestIds.join(",")]);

  useEffect(() => {
    const q = query(
      collection(db, "staffNotifications"),
      where("venueId", "==", venueId),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const unsub = onSnapshot(q, (snap) => {
      try {
        const list = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            type: data.type ?? "",
            message: data.message ?? "",
            tableId: data.tableId,
            read: data.read === true,
            createdAt: data.createdAt,
          };
        });
        setFeedEvents(list);
        const sos = list.find((e) => e.type === "sos" && e.read === false);
        setActiveSos(sos ?? null);
        setFeedLoading(false);
      } catch (e) {
        console.error("[admin/dashboard] staffNotifications snapshot error:", e);
        setFeedLoading(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, "venues", venueId, "events"),
      where("venueId", "==", venueId),
      orderBy("createdAt", "desc"),
      limit(10)
    );
    const unsub = onSnapshot(q, (snap) => {
      try {
        const eventList: FeedEvent[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            type: (data.type as string) ?? "shift",
            message: (data.message as string) ?? "",
            tableId: data.tableId as string | undefined,
            read: Boolean(data.read),
            createdAt: data.createdAt,
            venueId: (data.venueId as string) || venueId,
          } as FeedEvent;
        });
        setShiftEvents(eventList);
        setFeedLoading(false);
      } catch (e) {
        console.error("[admin/dashboard] events snapshot error:", e);
        setFeedLoading(false);
      }
    });
    return () => unsub();
  }, []);

  const archiveEvent = useCallback(async (event: FeedEvent) => {
    const eventId = event?.id ?? "";
    if (!eventId) {
      toast.error("Ошибка: ID события не найден");
      return;
    }
    const venuePath = doc(db, "venues", venueId, "events", eventId);
    try {
      await deleteDoc(venuePath);
      setShiftEvents((prev) => prev.filter((e) => e.id !== eventId));
      setFeedEvents((prev) => prev.filter((e) => e.id !== eventId));
      toast.success("Событие удалено", { id: "archive-event" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка";
      console.error("[archiveEvent] удаление не прошло:", venuePath, e);
      toast.error(msg);
    }
  }, []);

  const saveTableWaiter = useCallback(
    async (tableId: string, staffId: string) => {
      try {
        const ref = doc(db, "venues", venueId, "tables", tableId);
        const snap = await getDoc(ref);
        const existing = snap.exists() ? ((snap.data()?.assignments as Record<string, string> | undefined) ?? {}) : {};
        await setDoc(
          ref,
          {
            assignments: { ...existing, waiter: staffId },
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Ошибка сохранения");
      }
    },
    []
  );

  useEffect(() => {
    const q = query(
      collection(db, "activeSessions"),
      where("venueId", "==", venueId),
      where("status", "==", "closed"),
      orderBy("closedAt", "desc"),
      limit(30)
    );
    const unsubClosed = onSnapshot(q, async (snap) => {
      const closed = snap.docs
        .map((d) => {
          const data = d.data();
          if (data.ratedAt != null) return null;
          return { id: d.id, ...data };
        })
        .filter(Boolean) as { id: string; guestId?: string; waiterId?: string; closedAt: unknown }[];
      const wasOccupied = new Set(activeSessionIdsRef.current);
      const closedThatWereOccupied = closed.filter((c) => wasOccupied.has(c.id));
      const gids = [...new Set(closedThatWereOccupied.map((c) => c.guestId).filter(Boolean))] as string[];
      const names: Record<string, string> = {};
      for (const gid of gids) {
        const s = await getDoc(doc(db, "guests", gid));
        if (s.exists()) {
          const d = s.data();
          names[gid] = (d.name as string) || (d.nickname as string) || (d.phone as string) || gid.slice(0, 8);
        }
      }
      setUnratedClosedSessions(
        closedThatWereOccupied.map((c) => ({
          id: c.id,
          guestId: c.guestId,
          guestName: c.guestId ? (names[c.guestId] ?? "Гость") : "Гость",
          waiterId: c.waiterId,
          closedAt: c.closedAt,
        }))
      );
    });
    return () => unsubClosed();
  }, []);

  const openGuestModal = useCallback(async (guestId: string) => {
    const snap = await getDoc(doc(db, "guests", guestId));
    if (snap.exists()) setGuestModal({ id: snap.id, ...snap.data() } as Guest);
    else toast.error("Гость не найден");
  }, []);

  const nextBookingInMinutes = useMemo(() => {
    const bookings = bookingsByTable ?? {};
    const now = Date.now();
    let nearest: number | null = null;
    try {
      Object.values(bookings)
        .flat()
        .forEach((b) => {
          if (!b?.startAt) return;
          const ms = b.startAt.getTime?.() - now;
          if (Number.isFinite(ms) && ms > 0 && (nearest == null || ms < nearest * 60000)) nearest = ms / 60000;
        });
    } catch {
      // ignore
    }
    return nearest;
  }, [bookingsByTable]);

  const bookingReminderEvents = useMemo(() => {
    const bookings = bookingsByTable ?? {};
    const tbls = tables ?? [];
    const now = Date.now();
    const list: { id: string; type: string; message: string; tableId?: string; read: boolean }[] = [];
    try {
      Object.entries(bookings).forEach(([tableId, listForTable]) => {
        const table = tbls.find((t) => t?.id === tableId);
        const num = table?.number ?? tableId;
        (listForTable ?? [])
          .filter((b) => !b.isAlerted)
          .forEach((b) => {
            if (!b?.startAt) return;
            const mins = (b.startAt.getTime?.() - now) / 60000;
            if (Number.isFinite(mins) && mins > 0 && mins < 30) {
              const rounded = Math.round(mins);
              list.push({
                id: b.id,
                type: "booking_reminder",
                message: `Гость для Стола ${num} придет через ${rounded} минут`,
                tableId,
                read: false,
              });
            }
          });
      });
    } catch {
      // ignore
    }
    return list.filter((ev) => !dismissedBookings.includes(ev.id));
  }, [bookingsByTable, tables, dismissedBookings]);

  const feedWithReminders = useMemo(() => {
    const feed = feedEvents ?? [];
    const shifts = shiftEvents ?? [];
    return [...bookingReminderEvents.map((e) => ({ ...e, createdAt: null as unknown })), ...shifts, ...feed];
  }, [bookingReminderEvents, feedEvents, shiftEvents]);

  const safeStaffList = staffList ?? [];
  const safeBookingsByTable = bookingsByTable ?? {};
  const safeTables = tables ?? [];
  const safeSessionsByTable = sessionsByTable ?? {};
  const safeAssignmentsByTable = assignmentsByTable ?? {};
  const safeOnShiftWaiters = onShiftWaitersFromVenue;
  const totalTables = safeTables.length || 0;
  const emergencyTableIds = useMemo(() => {
    const ids = new Set<string>();
    (feedEvents ?? []).forEach((e) => {
      if (e.type === "sos" && !e.read && e.tableId) {
        ids.add(String(e.tableId));
      }
    });
    return ids;
  }, [feedEvents]);

  const allBookings = useMemo(() => {
    const byTable = bookingsByTable ?? {};
    return Object.values(byTable).flat();
  }, [bookingsByTable]);

  /** Заведение закрыто, если по графику сейчас вне [openTime, closeTime) */
  const isVenueClosedBySchedule = useMemo(() => {
    const now = new Date();
    const dayKey = getTodayKey(now);
    if (!operatingHours) return false;
    const today = operatingHours[dayKey];
    if (!today || !today.working) return true;
    const open = parseTimeToToday(now, today.openTime);
    const close = parseTimeToToday(now, today.closeTime);
    if (!open || !close) return false;
    const t = now.getTime();
    const openMs = open.getTime();
    const closeMs = close.getTime();
    if (closeMs <= openMs) {
      const nextClose = new Date(close);
      nextClose.setDate(nextClose.getDate() + 1);
      return t < openMs || t >= nextClose.getTime();
    }
    return t < openMs || t >= closeMs;
  }, [operatingHours]);

  if (venueLoading) {
    return (
      <div className="p-20 text-center text-gray-600">
        Инициализация заведения...
      </div>
    );
  }

  return (
    <div className="relative">
      {isVenueClosedBySchedule && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-900/60 rounded-xl">
          <p className="text-lg font-medium text-white">Заведение закрыто</p>
        </div>
      )}
      <h2 className="text-lg font-semibold text-gray-900">Центр управления полётами</h2>
      <p className="mt-2 text-sm text-gray-600">Живой зал, брони, смена и события в реальном времени.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {venueLoading ? (
          <>
            <TableSkeleton />
            <TableSkeleton />
            <TableSkeleton />
          </>
        ) : venueType === "full_service" && tables.length === 0 ? (
          <div className="col-span-full rounded-xl border border-gray-200 bg-gray-50 p-8 text-center text-gray-600">
            Заведение пустое. Создайте столы и добавьте команду.
          </div>
        ) : venueType === "full_service" ? (
          <>
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-medium text-gray-600">Живой зал</h3>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {occupiedCount} <span className="text-gray-400 font-normal">/ {totalTables || "—"}</span>
              </p>
              <p className="mt-0.5 text-xs text-gray-500">занято / всего столов</p>
            </div>
            <Link
              href="/admin/bookings"
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:bg-gray-50 transition-colors block"
            >
              <h3 className="text-sm font-medium text-gray-600">Брони сегодня</h3>
              <p className="mt-1 text-2xl font-bold text-blue-700">{bookingsTodayCount}</p>
              <p className="mt-0.5 text-xs text-gray-500">{todayStr}</p>
              {nextBookingInMinutes != null && nextBookingInMinutes > 0 && (
                <p className="mt-1 text-xs font-medium text-blue-600">
                  Следующая бронь через {Math.round(nextBookingInMinutes)} мин.
                </p>
              )}
            </Link>
            <Link
              href="/admin/team"
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:bg-gray-50 transition-colors block"
            >
              <h3 className="text-sm font-medium text-gray-600">На смене</h3>
              <p className="mt-1 text-2xl font-bold text-emerald-700">{onShiftCount}</p>
              <p className="mt-0.5 text-xs text-gray-500">сотрудников</p>
            </Link>
          </>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:col-span-3">
            <h3 className="text-sm font-medium text-gray-600">Режим фастфуд</h3>
            <p className="mt-1 text-sm text-gray-500">Дашборд столов доступен для полного сервиса.</p>
          </div>
        )}
      </div>

      {venueType === "full_service" && (
        <section className="mt-8 w-full">
          <h3 className="text-base font-semibold text-gray-900">События на смене</h3>
          <p className="mt-1 text-sm text-gray-500">Новые события сверху. Кнопка «ОК» — архивировать.</p>
          {feedLoading ? (
            <div className="mt-3 space-y-2">
              <EventSkeleton />
              <EventSkeleton />
            </div>
          ) : feedWithReminders.length === 0 ? (
            <p className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">Нет событий</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {feedWithReminders.map((ev) => {
                const isOrphan = ev.type === "orphan_call";
                const isBookingReminder = ev.type === "booking_reminder";
                let createdAtLabel = "";
                try {
                  const raw = ev.createdAt as { toDate?: () => Date } | Date | null | undefined;
                  const d =
                    raw && typeof (raw as any).toDate === "function"
                      ? (raw as { toDate: () => Date }).toDate()
                      : raw instanceof Date
                      ? raw
                      : null;
                  if (d) {
                    createdAtLabel = formatTimeSafe(d);
                  }
                } catch {
                  createdAtLabel = "";
                }
                const isShift = ev.type === "shift";
                const isStartedShift = isShift && ev.message.includes("заступил");
                const isStoppedShift = isShift && ev.message.includes("ушел");

                return (
                  <li
                    key={ev.id}
                    className={
                      isBookingReminder
                        ? "text-sm bg-orange-100 border-l-4 border-orange-500 text-orange-700 p-4 shadow-md flex justify-between items-center rounded-md"
                        : `flex items-center justify-between gap-3 rounded-lg border p-3 text-sm ${
                            ev.read
                              ? "border-gray-100 bg-gray-50/50 text-gray-500"
                              : isStartedShift
                              ? "border-green-200 bg-[#e6fffa] text-emerald-900"
                              : isOrphan
                              ? "border-red-400 bg-red-50/80 text-red-900 animate-pulse"
                              : "border-amber-200 bg-amber-50/80 text-amber-900"
                          }`
                    }
                  >
                    <span>
                      {isBookingReminder
                        ? "⚠️ "
                        : ev.type === "sos"
                        ? "🚨 SOS"
                        : isOrphan
                        ? "⚠️ Стол без ответственного"
                        : ev.type === "role_call" || ev.type === "call_waiter"
                        ? "📞 Вызов"
                        : ev.type === "request_bill"
                        ? "🧾 Счёт"
                        : ""}{" "}
                      {ev.message}
                      {createdAtLabel && (
                        <span className="ml-1 text-xs text-gray-500">· {createdAtLabel}</span>
                      )}
                      {ev.tableId != null && !isBookingReminder && (
                        <span className="ml-1 text-gray-500">
                          {looksLikeTableIdError(ev.tableId) ? "Ошибка данных стола" : `Стол №${ev.tableId}`}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        if (isBookingReminder) {
                          try {
                            await updateDoc(doc(db, "bookings", ev.id), {
                              isAlerted: true,
                              updatedAt: serverTimestamp(),
                            });
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Ошибка");
                          }
                        } else {
                          archiveEvent(ev);
                        }
                      }}
                      className={
                        isBookingReminder
                          ? "ml-4 shrink-0 px-3 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors text-xs font-semibold"
                          : "shrink-0 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      }
                    >
                      ОК
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {activeSos && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h3 className="text-base font-semibold text-red-700 flex items-center gap-2">
              <span>🚨 SOS сигнал</span>
            </h3>
            <p className="mt-2 text-sm text-gray-800">
              {activeSos.tableId
                ? looksLikeTableIdError(activeSos.tableId)
                  ? "Ошибка данных стола"
                  : `Стол №${activeSos.tableId}`
                : "Стол не указан"}. {activeSos.message}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                onClick={() => setActiveSos(null)}
              >
                Позже
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700"
                onClick={() => {
                  if (activeSos) {
                    archiveEvent(activeSos);
                    setActiveSos(null);
                  }
                }}
              >
                Принято
              </button>
            </div>
          </div>
        </div>
      )}

      {venueType === "full_service" && (
        <section className="mt-8">
          <h3 className="text-base font-semibold text-gray-900">Планшетка столов</h3>
          <p className="mt-1 text-sm text-gray-500">
            Назначьте официанта — уведомления с стола пойдут ему в Telegram.
          </p>
          {!safeTables || safeTables.length === 0 ? (
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
              Столы не найдены.
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {safeTables.map((table) => {
                if (!table?.id) return null;
                try {
                  const session = safeSessionsByTable[table.id];
                  const isOccupied = Boolean(session);
                  const tableBooking = allBookings.find(
                    (b) =>
                      String(b.tableNumber ?? "") === String(table.id) ||
                      String(b.tableNumber ?? "") === String(table.number)
                  );
                  const activeBooking =
                    tableBooking && (tableBooking.status ?? "pending") === "pending"
                      ? tableBooking
                      : undefined;
                  const hasTodayBookingForTable = activeBookings.some(
                    (b) =>
                      String(b.tableNumber ?? "") === String(table.id) ||
                      String(b.tableNumber ?? "") === String(table.number)
                  );
                  const now = new Date();
                  const startTimeDate = activeBooking?.startAt ?? null;
                  const diffInMinutes =
                    startTimeDate != null
                      ? (startTimeDate.getTime() - now.getTime()) / 60000
                      : null;
                  const isUrgent =
                    diffInMinutes != null &&
                    Number.isFinite(diffInMinutes) &&
                    diffInMinutes <= 30 &&
                    diffInMinutes > -15;
                  const assignedStaffId = safeAssignmentsByTable[table.id] ?? "";
                  const defaultFromTeam = safeStaffList.find((s) =>
                    s?.assignedTableIds?.includes(table.id)
                  );
                  const assignedStaff = assignedStaffId
                    ? safeStaffList.find((s) => s?.id === assignedStaffId)
                    : null;
                  const isGreenSelect =
                    assignedStaffId !== "" && venueStaffOnShift[assignedStaffId] === true;
                  const effectiveWaiterId = assignedStaffId || defaultFromTeam?.id;
                  const isWaiterOffShift =
                    effectiveWaiterId && venueStaffOnShift[effectiveWaiterId] !== true;
                  const uniqueStaff = Array.from(
                    new Map(safeOnShiftWaiters.map((w) => [w.id, w])).values()
                  );
                  const selectValue =
                    assignedStaffId ||
                    (defaultFromTeam && uniqueStaff.some((s) => s.id === defaultFromTeam.id)
                      ? defaultFromTeam.id
                      : "");
                  const isPlanSelection = Boolean(selectValue && !assignedStaffId);
                  const hasEmergency = emergencyTableIds.has(table.id);
                  const cardBorder = hasEmergency
                    ? "border-red-600 border-8 animate-bounce"
                    : hasTodayBookingForTable
                    ? "border-orange-500 border-4 animate-pulse"
                    : isUrgent
                    ? "border-orange-500 border-4 animate-pulse"
                    : isOccupied
                    ? "border-sky-300"
                    : "border-emerald-400";
                  const cardBg = isOccupied ? "bg-sky-50/90" : "bg-white";

                  return (
                    <div
                      key={table.id}
                      className={`rounded-xl border-2 p-4 shadow-sm ${cardBorder} ${cardBg}`}
                    >
                      <div className="text-2xl font-bold text-gray-900">
                        {table?.number ?? table.id ?? "—"}
                      </div>
                      {isWaiterOffShift && (
                        <p className="mt-1 text-xs font-medium text-amber-700">
                          Официант не на смене
                        </p>
                      )}
                      <div className="mt-2">
                        <label className="block text-xs text-gray-500">Официант</label>
                        <select
                          value={selectValue ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            const tid = table?.id;
                            if (tid) setAssignmentsByTable((prev) => ({ ...prev, [tid]: v }));
                            if (v && tid) saveTableWaiter(tid, v);
                          }}
                          className={`mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm ${
                            isGreenSelect
                              ? "border-emerald-400 bg-emerald-50"
                              : "border-gray-300 bg-white"
                          }`}
                        >
                          <option value="">—</option>
                          {uniqueStaff.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.displayName}
                            </option>
                          ))}
                        </select>
                      </div>
                      {isPlanSelection && (
                        <p className="mt-1 text-xs italic text-gray-500">
                          По плану из Команды
                        </p>
                      )}
                      {activeBooking && startTimeDate && (
                        <div className="mt-2 text-xs">
                          <span
                            className={
                              isUrgent
                                ? "font-extrabold text-orange-600 animate-pulse"
                                : "text-blue-700"
                            }
                          >
                            🕒 {formatTimeSafe(startTimeDate)}
                          </span>
                          {activeBooking.guestName ? (
                            <span className="text-blue-700">
                              {` · ${activeBooking.guestName}`}
                            </span>
                          ) : null}
                        </div>
                      )}
                      {session?.guestId ? (
                        <button
                          type="button"
                          onClick={() => openGuestModal(session.guestId!)}
                          className="mt-2 w-full text-left rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm hover:bg-gray-100"
                        >
                          {guestNames[session.guestId] ?? "Гость"}
                          {guestRatings[session.guestId] != null && (
                            <span className="ml-1 text-amber-600">
                              ★ {guestRatings[session.guestId]}
                            </span>
                          )}
                        </button>
                      ) : (
                        <div className="mt-2 text-xs text-gray-400">Свободен</div>
                      )}
                    </div>
                  );
                } catch {
                  return null;
                }
              })}
            </div>
          )}
        </section>
      )}

      {unratedClosedSessions.length > 0 && (
        <RateGuestVisitModal
          session={unratedClosedSessions[0]}
          onRated={() => {
            const id = unratedClosedSessions[0]?.id;
            if (id) activeSessionIdsRef.current.delete(id);
            setUnratedClosedSessions((prev) => prev.slice(1));
          }}
          onDismiss={() => {
            const id = unratedClosedSessions[0]?.id;
            if (id) activeSessionIdsRef.current.delete(id);
            setUnratedClosedSessions((prev) => prev.slice(1));
          }}
          submitting={ratingSubmitting}
          setSubmitting={setRatingSubmitting}
          venueId={venueId}
        />
      )}

      {guestModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h3 className="font-semibold text-gray-900">Карточка гостя</h3>
            <div className="mt-3 space-y-1 text-sm">
              <p>
                <span className="text-gray-500">Имя:</span>{" "}
                {guestModal.name ?? guestModal.nickname ?? "—"}
              </p>
              <p>
                <span className="text-gray-500">Телефон:</span>{" "}
                {guestModal.phone ?? "—"}
              </p>
              <p>
                <span className="text-gray-500">TG:</span>{" "}
                {guestModal.tgId ?? "—"}
              </p>
              <p>
                <span className="text-gray-500">Тип:</span>{" "}
                {guestModal.type ?? "—"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setGuestModal(null)}
              className="mt-4 w-full rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center">Загрузка интерфейса...</div>}>
      <AdminDashboardContent />
    </Suspense>
  );
}

function RateGuestVisitModal({
  session,
  onRated,
  onDismiss,
  submitting,
  setSubmitting,
  venueId,
}: {
  session: ClosedSessionForRating;
  onRated: () => void;
  onDismiss: () => void;
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
  venueId: string;
}) {
  const [stars, setStars] = useState<number | null>(null);

  const handleSubmit = async () => {
    if (stars == null) return;
    setSubmitting(true);
    try {
      const guestId = session.guestId;
      if (guestId) {
        const ref = doc(db, "global_guests", guestId);
        const snap = await getDoc(ref);
        const data = snap.exists() ? snap.data() : {};
        const ratings: number[] = Array.isArray(data?.ratings) ? data.ratings : [];
        const newRatings = [...ratings, stars];
        const avg =
          Math.round((newRatings.reduce((a, b) => a + b, 0) / newRatings.length) * 10) /
          10;
        await setDoc(ref, { ratings: newRatings, globalGuestScore: avg }, { merge: true });
      }
      await updateDoc(doc(db, "activeSessions", session.id), {
        ratedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const notifRef = await addDoc(collection(db, "staffNotifications"), {
        venueId,
        tableId: "",
        type: "guest_rated",
        message: `Ваш гость оценён на ${stars} звёзд. Отличная работа!`,
        read: false,
        targetUids: session.waiterId ? [session.waiterId] : [],
        createdAt: serverTimestamp(),
      });
      if (session.waiterId) {
        await fetch("/api/admin/notify-waiter-rated", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notificationId: notifRef.id,
            waiterId: session.waiterId,
            stars,
          }),
        });
      }
      onRated();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDismiss = () => {
    setStars(null);
    onDismiss();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
        <h3 className="font-semibold text-gray-900">Оцените визит гостя</h3>
        <p className="mt-2 text-sm text-gray-600">
          {session.guestName} (1–5 звёзд)
        </p>
        <div className="mt-4 flex gap-2">
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <button
              key={n}
              type="button"
              className={`rounded border px-3 py-2 text-sm font-medium ${
                stars === n
                  ? "border-amber-500 bg-amber-50 text-amber-700"
                  : "border-gray-300 hover:bg-gray-50"
              }`}
              onClick={() => setStars(n)}
            >
              {n} ★
            </button>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            onClick={handleDismiss}
          >
            Позже
          </button>
          <button
            type="button"
            disabled={stars == null || submitting}
            className="flex-1 rounded-lg bg-gray-900 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            onClick={handleSubmit}
          >
            {submitting ? "…" : "Отправить"}
          </button>
        </div>
      </div>
    </div>
  );
}