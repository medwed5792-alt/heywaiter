"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { getVenueIdFromSearchParams } from "@/lib/standards/venue-from-url";
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
import { generateSotaId } from "@/lib/sota-id";
import type { VenueType } from "@/lib/types";
import type { Guest } from "@/lib/types";
import type { GlobalUser } from "@/lib/types";
import { LPR_ROLES } from "@/lib/types";

const BOOKING_WINDOW_MS = 30 * 60 * 1000; // ближайшие 30 минут для статуса столов
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
  /** defaultTables — массив номеров столов (или их строковых представлений) из профиля сотрудника */
  defaultTables: string[];
  onShift: boolean;
  role?: string;
  position?: string;
  /** Глобальный userId (может отличаться от doc-id в коллекции venues/{venue}/staff) */
  userId?: string;
}

interface FeedEvent {
  id: string;
  type: string;
  message: string;
  tableId?: string;
  read: boolean;
  createdAt: unknown;
  venueId?: string;
  collectionName?: "staffNotifications" | "venue_events";
  /** Для guest_arrived: id сессии, чтобы подтянуть гостя из venues/.../guests */
  sessionId?: string;
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
  const normalized = String(time ?? "").trim();
  // HH:mm или HH:mm:ss
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(normalized)) return null;
  const [h, m] = normalized.split(":").slice(0, 2).map((v) => Number(v));
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

/** Иконки по типу гостя для ленты guest_arrived */
const GUEST_TYPE_ICON: Record<string, string> = {
  vip: "🌟",
  constant: "✅",
  blacklisted: "🚫",
};

/** Подпись типа гостя для ленты */
const GUEST_TYPE_LABEL: Record<string, string> = {
  regular: "Новый",
  constant: "Постоянный",
  favorite: "Любимый",
  vip: "VIP",
  blacklisted: "ЧС",
};

/** Сообщение «Гость пришел» с подтяжкой данных из venues/venueId/guests */
function GuestArrivedMessage({
  ev,
  venueId,
}: {
  ev: FeedEvent;
  venueId: string;
}) {
  const [guestData, setGuestData] = useState<{
    name: string;
    type: string;
    note?: string;
  } | null>(null);
  useEffect(() => {
    if (!ev.sessionId || !venueId) return;
    let cancelled = false;
    (async () => {
      try {
        const sessionSnap = await getDoc(doc(db, "activeSessions", ev.sessionId!));
        if (cancelled || !sessionSnap.exists()) return;
        const guestId = sessionSnap.data()?.guestId as string | undefined;
        if (!guestId) {
          setGuestData(null);
          return;
        }
        const guestSnap = await getDoc(doc(db, "venues", venueId, "guests", guestId));
        if (cancelled || !guestSnap.exists()) return;
        const d = guestSnap.data() ?? {};
        setGuestData({
          name: (d.name as string) || (d.phone as string) || "Гость",
          type: (d.type as string) ?? "regular",
          note: (d.note as string) ?? undefined,
        });
      } catch {
        if (!cancelled) setGuestData(null);
      }
    })();
    return () => { cancelled = true; };
  }, [ev.sessionId, venueId]);

  const tableNum = ev.tableId != null && !looksLikeTableIdError(ev.tableId) ? ev.tableId : "—";
  if (guestData) {
    const icon = GUEST_TYPE_ICON[guestData.type] ?? "";
    const typeLabel = GUEST_TYPE_LABEL[guestData.type] ?? guestData.type;
    return (
      <span>
        {icon} {typeLabel} {guestData.name} (Стол №{tableNum}) занял место.
        {guestData.note?.trim() ? ` Примечание: ${guestData.note.trim()}` : ""}
      </span>
    );
  }
  return <span>{ev.message}</span>;
}

function AdminDashboardContent() {
  const searchParams = useSearchParams();
  const venueId = getVenueIdFromSearchParams(searchParams);
  const [venueType, setVenueType] = useState<VenueType | null>(null);
  const [venueLoading, setVenueLoading] = useState(true);
  const [venueName, setVenueName] = useState<string>("");
  const [venueSotaId, setVenueSotaId] = useState<string>("");
  const [tables, setTables] = useState<TableRow[]>([]);
  // Lookup для быстрой валидации SOS (не даём фантомным столам открывать модалку).
  const knownTablesLookupRef = useRef<{ idSet: Set<string>; numberSet: Set<string> }>({
    idSet: new Set(),
    numberSet: new Set(),
  });
  const [occupiedCount, setOccupiedCount] = useState(0);
  const [bookingsTodayCount, setBookingsTodayCount] = useState(0);
  const [activeBookings, setActiveBookings] = useState<BookingOnTable[]>([]);
  const [onShiftCount, setOnShiftCount] = useState(0);
  const [staffList, setStaffList] = useState<StaffWithTables[]>([]);
  const [venueStaffOnShift, setVenueStaffOnShift] = useState<Record<string, boolean>>({});
  const [sessionsByTable, setSessionsByTable] = useState<Record<string, SessionOnTable>>({});
  const [bookingsByTable, setBookingsByTable] = useState<Record<string, BookingOnTable[]>>({});
  const [assignmentsByTable, setAssignmentsByTable] = useState<Record<string, string>>({});
  // Для отладки: что реально лежит в tables/{tableId}.assignments.waiter (до преобразований/нормализации)
  const [assignmentsWaiterRawByTable, setAssignmentsWaiterRawByTable] = useState<Record<string, unknown>>({});
  const [guestNames, setGuestNames] = useState<Record<string, string>>({});
  const [guestRatings, setGuestRatings] = useState<Record<string, number>>({});
  const [feedEvents, setFeedEvents] = useState<FeedEvent[]>([]);
  const [shiftEvents, setShiftEvents] = useState<FeedEvent[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [activeSos, setActiveSos] = useState<FeedEvent | null>(null);
  const [confirmEmergencyArchive, setConfirmEmergencyArchive] = useState<FeedEvent | null>(null);
  const emergencyPlayedRef = useRef<Set<string>>(new Set());
  const [unratedClosedSessions, setUnratedClosedSessions] = useState<ClosedSessionForRating[]>([]);
  const [dismissedBookings, setDismissedBookings] = useState<string[]>([]);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [guestModal, setGuestModal] = useState<Guest | null>(null);
  const [closeTableModal, setCloseTableModal] = useState<{ tableId: string; sessionId: string } | null>(null);
  const [closeTableLoading, setCloseTableLoading] = useState(false);
  const [operatingHours, setOperatingHours] = useState<OperatingHours | null>(null);
  const [manualStatus, setManualStatus] = useState<"open" | "closed" | null>(null);
  const [endOfDayLoading, setEndOfDayLoading] = useState(false);
  const [closeVenueConfirm, setCloseVenueConfirm] = useState<boolean | null>(null);
  const [toggleVenueLoading, setToggleVenueLoading] = useState(false);
  const activeSessionIdsRef = useRef<Set<string>>(new Set());
  const autoResetDoneRef = useRef(false);
  const lastClosingReminderAtRef = useRef<number>(0);
  const staffNameResolveSeqRef = useRef(0);
  const [staffInsideById, setStaffInsideById] = useState<Record<string, boolean>>({});

  const todayStr = new Date().toISOString().slice(0, 10);

  const isKnownTableFromNotification = useCallback((tableId?: string): boolean => {
    const raw = tableId == null ? "" : String(tableId).trim();
    if (!raw) return false;
    const { idSet, numberSet } = knownTablesLookupRef.current;
    if (idSet.has(raw)) return true;
    const num = Number(raw);
    if (!Number.isFinite(num)) return false;
    return numberSet.has(String(num));
  }, []);

  // Обновляем lookup, когда меняется справочник столов.
  useEffect(() => {
    const idSet = new Set<string>();
    const numberSet = new Set<string>();
    (tables ?? []).forEach((t) => {
      if (t?.id) idSet.add(String(t.id).trim());
      if (t?.number != null && Number.isFinite(Number(t.number))) numberSet.add(String(t.number));
    });
    knownTablesLookupRef.current = { idSet, numberSet };
  }, [tables]);

  // Стандартизируем отображение имени: только первое слово.
  const staffFirstName = useCallback((fullName: string | undefined | null): string => {
    const s = String(fullName ?? "").trim();
    if (!s) return "Сотрудник";
    return s.split(' ')[0] || "Сотрудник";
  }, []);

  const performEndOfDayReset = useCallback(
    async (reason: "auto" | "manual") => {
      setEndOfDayLoading(true);
      try {
        const batch = writeBatch(db);

        // onShift = false в venues/venue_andrey_alt/staff (единая точка с Mini App)
        // ВАЖНО: сначала отправляем финальное уведомление активным сотрудникам, потом сбрасываем onShift.
        const venueStaffSnap = await getDocs(collection(db, "venues", venueId, "staff"));
        const staffDocs = venueStaffSnap.docs;
        for (const d of staffDocs) {
          const data = d.data() as { onShift?: boolean; displayName?: string; name?: string };
          if (data?.onShift !== true) continue;
          const staffDisplayName = staffFirstName((data.displayName as string | undefined) ?? (data.name as string | undefined));
          await addDoc(collection(db, "venues", venueId, "staff", d.id, "notifications"), {
            type: "shift_end",
            message: `✨ Смена завершена! ${staffDisplayName}, спасибо за отличную работу! Заведение закрыто.`,
            read: false,
            createdAt: serverTimestamp(),
          });
        }
        staffDocs.forEach((d) => {
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
    [staffFirstName, venueId]
  );

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "venues", venueId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setVenueType((data?.venueType as VenueType) || "full_service");
        setVenueName((data?.name as string) ?? "");
        setVenueSotaId(typeof data?.sotaId === "string" ? data.sotaId : "");
        if (typeof data?.sotaId !== "string" || !String(data.sotaId).trim()) {
          updateDoc(doc(db, "venues", venueId), {
            sotaId: generateSotaId("V", "R"),
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
        setOperatingHours((data?.operatingHours ?? null) as OperatingHours | null);
        const ms = data?.manualStatus as unknown;
        // Если manualStatus не задан — строго следуем графику.
        if (ms === "closed") setManualStatus("closed");
        else if (ms === "open") setManualStatus("open");
        else setManualStatus(null);
      } else {
        setVenueType("full_service");
        setManualStatus(null);
      }
      setVenueLoading(false);
    });
    return () => unsub();
  }, [venueId]);

  useEffect(() => {
    if (!venueType || venueType !== "full_service") return;
    const unsub = onSnapshot(collection(db, "venues", venueId, "tables"), (snap) => {
      const list: TableRow[] = snap.docs
        .map((d) => {
          const data = d.data();
          const rawNumber = data.number as unknown;
          const rawStr = typeof rawNumber === "string" ? rawNumber.trim() : String(rawNumber ?? "");
          const num = typeof rawNumber === "string" ? Number(rawStr) : (rawNumber as number | undefined);

          // Зачистка «нулей»: если number не задан / 0 / '0' — полностью скрываем стол.
          if (!num || rawStr === "0") return null;

          return {
            id: d.id,
            number: num,
            hallId: data.hallId as string | undefined,
            name: data.name as string | undefined,
          };
        })
        .filter(Boolean) as TableRow[];

      setTables(list);
    });

    return () => unsub();
  }, [venueType, venueId]);

  useEffect(() => {
    if (!venueId || venueType !== "full_service") return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(collection(db, "venues", venueId, "tables"));
        const batch = writeBatch(db);
        let ops = 0;
        for (const d of snap.docs) {
          const data = d.data();
          if (data.sotaTableCode != null && String(data.sotaTableCode).trim() !== "") continue;
          const rawNumber = data.number as unknown;
          const num =
            typeof rawNumber === "string" ? Number(rawNumber.trim()) : (rawNumber as number | undefined);
          const code =
            num != null && Number.isFinite(num) && num !== 0 ? String(num) : d.id.replace(/[^0-9A-Z]/gi, "").slice(0, 4).toUpperCase() || "T";
          batch.update(d.ref, { sotaTableCode: code, updatedAt: serverTimestamp() });
          ops++;
          if (ops >= 450) break;
        }
        if (ops > 0 && !cancelled) await batch.commit();
      } catch {
        // ignore backfill errors (permissions)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venueId, venueType]);

  useEffect(() => {
    // Live-гео сотрудников: staffLiveGeos по venueId
    const q = query(
      collection(db, "staffLiveGeos"),
      where("venueId", "==", venueId)
    );
    const unsub = onSnapshot(q, (snap) => {
      const next: Record<string, boolean> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as { staffId?: string; isInside?: boolean };
        const id = data.staffId;
        if (id) {
          next[id] = data.isInside !== false;
        }
      });
      setStaffInsideById(next);
    });
    return () => unsub();
  }, [venueId]);

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
  }, [venueType, venueId]);

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
  }, [operatingHours, venueType, performEndOfDayReset, venueId]);

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
  }, [venueType, venueId]);

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
  }, [venueType, venueId]);

  // Список официантов на смене для селекта (имена из root staff, onShift из venue staff)
  const onShiftWaitersFromVenue = useMemo(() => {
    const byId = venueStaffOnShift ?? {};
    return staffList
      .filter((s) => byId[s.id] === true)
      .filter((s) => {
        const roleRaw = (s.role ?? s.position ?? "").trim();
        if (!roleRaw) return true; // backward-compat: если роль не указана в документе
        const role = roleRaw.toLowerCase();
        return role === "waiter" || LPR_ROLES.includes(role as any);
      })
      .map((s) => ({ id: s.id, displayName: s.displayName, position: "" }));
  }, [staffList, venueStaffOnShift]);

  useEffect(() => {
    if (!venueType) return;
    const unsub = onSnapshot(collection(db, "venues", venueId, "staff"), (snap) => {
      const activeStaffDocs = snap.docs.filter((d) => d.data().active !== false);
      const seq = ++staffNameResolveSeqRef.current;

      (async () => {
        const staffRows = activeStaffDocs.map((d) => ({
          docId: d.id,
          data: d.data(),
        }));

        // Пытаемся получить "связанный глобальный профиль" по userId.
        // Если в venues/.../staff нет userId, пробуем вывести его из doc-id по префиксу venueId_.
        const prefix = `${venueId}_`;
        const userIds = Array.from(
          new Set(
            staffRows
              .map(({ docId, data }) => {
                const explicitUserId = typeof (data as any)?.userId === "string" ? String((data as any).userId).trim() : "";
                if (explicitUserId) return explicitUserId;
                if (docId.startsWith(prefix)) return docId.slice(prefix.length);
                return "";
              })
              .filter(Boolean)
          )
        );

        const globalUsers = new Map<string, GlobalUser>();
        await Promise.all(
          userIds.map(async (uid) => {
            const globalSnap = await getDoc(doc(db, "global_users", uid));
            if (globalSnap.exists()) {
              globalUsers.set(uid, { id: globalSnap.id, ...(globalSnap.data() as Omit<GlobalUser, "id">) } as GlobalUser);
            }
          })
        );

        const resolveDisplayName = (docId: string, data: any): string => {
          // Шаг 1: name/displayName в локальном документе
          // Если именно `name` в локальном документе пустое — дальше обязательно идём в `global_users`.
          const localName = typeof data?.name === "string" ? data.name : "";
          const cleanedLocalName = String(localName ?? "").trim();
          if (cleanedLocalName) return cleanedLocalName;

          // Привязка к глобальному профилю
          const explicitUserId = typeof data?.userId === "string" ? data.userId.trim() : "";
          const derivedUserId = explicitUserId
            ? explicitUserId
            : docId.startsWith(prefix)
              ? docId.slice(prefix.length)
              : "";
          const globalUser = derivedUserId ? globalUsers.get(derivedUserId) : undefined;

          // Шаг 2 (критично): имя из глобального профиля
          const globalFullName = globalUser
            ? [globalUser.firstName, globalUser.lastName].filter(Boolean).join(" ").trim()
            : "";
          const globalIdentityName = globalUser?.identity?.displayName ?? (globalUser?.identity as any)?.name ?? "";
          const cleanedGlobalIdentityName = String(globalIdentityName ?? "").trim();
          if (globalFullName) return globalFullName;
          if (cleanedGlobalIdentityName) return cleanedGlobalIdentityName;

          return "Сотрудник";
        };

        if (seq !== staffNameResolveSeqRef.current) return; // snapshot устарел

        const list: StaffWithTables[] = staffRows.map(({ docId, data }) => {
          const assignedTableIds = (data.assignedTableIds as string[] | undefined) ?? [];
          const defaultTablesRaw = (data.defaultTables as Array<string | number> | undefined) ?? [];
          const defaultTables = (defaultTablesRaw.length ? defaultTablesRaw : (assignedTableIds as Array<string | number>)).map(String);

          const explicitUserId = typeof data?.userId === "string" ? data.userId.trim() : "";
          const derivedUserId = explicitUserId
            ? explicitUserId
            : docId.startsWith(prefix)
              ? docId.slice(prefix.length)
              : "";

          return {
            id: docId,
            displayName: resolveDisplayName(docId, data),
            assignedTableIds,
            defaultTables,
            onShift: data.onShift === true,
            role: (data.role as string | undefined) ?? (data.serviceRole as string | undefined),
            position: (data.position as string | undefined) ?? (data.serviceRole as string | undefined),
            userId: derivedUserId ? derivedUserId : undefined,
          };
        });

        setStaffList(list);
      })().catch((e) => {
        console.error("[admin/dashboard] staff displayName resolve error:", e);
      });
    });
    return () => unsub();
  }, [venueType, venueId]);

  // Cleanup: убираем «фантомные» номера столов из профиля сотрудника,
  // чтобы карточки/предвыбор не опирались на несуществующие таблицы.
  useEffect(() => {
    if (!tables.length || staffList.length === 0) return;
    const allowedTableNumbers = new Set(tables.map((t) => String(t.number)));

    const digits = (v: string) => String(v).replace(/\D/g, "");
    const clean = (arr: string[]) =>
      (arr ?? [])
        .map(String)
        .filter((x) => {
          const d = digits(x);
          return d && allowedTableNumbers.has(d);
        });

    setStaffList((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        const cleanedAssigned = clean(s.assignedTableIds ?? []);
        const cleanedDefault = clean(s.defaultTables ?? []);
        if (cleanedAssigned.join("|") === (s.assignedTableIds ?? []).join("|") && cleanedDefault.join("|") === (s.defaultTables ?? []).join("|")) return s;
        changed = true;
        return { ...s, assignedTableIds: cleanedAssigned, defaultTables: cleanedDefault };
      });
      return changed ? next : prev;
    });
  }, [tables, staffList]);

  useEffect(() => {
    if (!tables.length) return;
    const unsub = onSnapshot(collection(db, "venues", venueId, "tables"), (snap) => {
      const next: Record<string, string> = {};
      const nextRaw: Record<string, unknown> = {};
      snap.docs.forEach((d) => {
        const data = d.data();
        // Поддерживаем несколько исторических схем поля «закреплённый официант»:
        // 1) assignments.waiter
        // 2) waiterId (legacy/альтернатива)
        // 3) assignedStaffId (альтернатива)
        const assignments = data.assignments as { waiter?: unknown } | undefined;
        // Прямая отладочная переменная: именно tables/{tableId}.assignments?.waiter
        const rawFromAssignments = (data.assignments as { waiter?: unknown } | undefined)?.waiter;
        nextRaw[d.id] = rawFromAssignments;

        const waiterRaw =
          data.waiterId ??
          assignments?.waiter ??
          data.assignedStaffId ??
          undefined;
        const waiterId = waiterRaw == null ? "" : String(waiterRaw).trim();
        if (waiterId) next[d.id] = waiterId;
      });
      setAssignmentsByTable((prev) => ({ ...prev, ...next }));
      setAssignmentsWaiterRawByTable((prev) => ({ ...prev, ...nextRaw }));
    });
    return () => unsub();
  }, [tables.length, venueId]);

  const tableIds = tables.map((t) => t?.id).filter(Boolean).join(",");
  useEffect(() => {
    if (!tables.length) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      const nextRaw: Record<string, unknown> = {};
      for (const t of tables) {
        if (cancelled || !t?.id) return;
        const snap = await getDoc(doc(db, "venues", venueId, "tables", t.id));
        if (snap.exists()) {
          const data = snap.data() ?? {};
          const assignments = data.assignments as { waiter?: unknown } | undefined;
          const rawFromAssignments = (data.assignments as { waiter?: unknown } | undefined)?.waiter;
          nextRaw[t.id] = rawFromAssignments;
          const waiterRaw =
            data.waiterId ??
            assignments?.waiter ??
            data.assignedStaffId ??
            undefined;
          const waiterId = waiterRaw == null ? "" : String(waiterRaw).trim();
          if (waiterId) next[t.id] = waiterId;
        }
      }
      if (!cancelled) setAssignmentsByTable((prev) => ({ ...prev, ...next }));
      if (!cancelled) setAssignmentsWaiterRawByTable((prev) => ({ ...prev, ...nextRaw }));
    })();
    return () => {
      cancelled = true;
    };
  }, [tableIds, tables, venueId]);

  const guestIds = useMemo(
    () =>
      Object.values(sessionsByTable)
        .map((s) => s.guestId)
        .filter(Boolean) as string[],
    [sessionsByTable]
  );
  const [guestTypeByGuestId, setGuestTypeByGuestId] = useState<Record<string, string>>({});
  useEffect(() => {
    if (guestIds.length === 0) {
      setGuestNames({});
      setGuestRatings({});
      setGuestTypeByGuestId({});
      return;
    }
    let cancelled = false;
    (async () => {
      const names: Record<string, string> = {};
      const ratings: Record<string, number> = {};
      const types: Record<string, string> = {};
      await Promise.all(
        guestIds.map(async (id) => {
          if (cancelled) return;
          const snap = await getDoc(doc(db, "venues", venueId, "guests", id));
          if (snap.exists()) {
            const d = snap.data();
            names[id] = (d.name as string) || (d.phone as string) || id.slice(0, 8);
            const r = (d.globalGuestScore as number) ?? (d.rating as number);
            if (r != null) ratings[id] = r;
            const t = (d.type as string) ?? "regular";
            types[id] = t;
          }
        })
      );
      if (!cancelled) {
        setGuestNames(names);
        setGuestRatings(ratings);
        setGuestTypeByGuestId(types);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [guestIds, venueId]);

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
            collectionName: "staffNotifications" as const,
            sessionId: data.sessionId as string | undefined,
          };
        });
        setFeedEvents(list);
        // Игнорируем фантомные SOS: показывать модалку можно только для существующих столов.
        const sos = list.find((e) => e.type === "sos" && e.read === false && isKnownTableFromNotification(e.tableId));
        setActiveSos(sos ?? null);
        setFeedLoading(false);
      } catch (e) {
        console.error("[admin/dashboard] staffNotifications snapshot error:", e);
        setFeedLoading(false);
      }
    });
    return () => unsub();
  }, [venueId, isKnownTableFromNotification]);

  // На случай, если SOS пришёл раньше загрузки справочника столов — пересчитаем активную модалку после обновления `tables`.
  useEffect(() => {
    const sosValid = (feedEvents ?? []).find(
      (e) => e.type === "sos" && e.read === false && isKnownTableFromNotification(e.tableId)
    );
    setActiveSos(sosValid ?? null);
  }, [feedEvents, tables, isKnownTableFromNotification, venueId]);

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
            message: (data.message as string) ?? (data.text as string) ?? "",
            tableId: data.tableId as string | undefined,
            read: Boolean(data.read),
            createdAt: data.createdAt,
            venueId: (data.venueId as string) || venueId,
            sender: data.sender as string | undefined,
            collectionName: "venue_events" as const,
          } as FeedEvent & { sender?: string };
        });
        setShiftEvents(eventList);
        setFeedLoading(false);
      } catch (e) {
        console.error("[admin/dashboard] events snapshot error:", e);
        setFeedLoading(false);
      }
    });
    return () => unsub();
  }, [venueId]);

  const archiveEvent = useCallback(async (event: FeedEvent) => {
    const eventId = event?.id ?? "";
    if (!eventId) {
      toast.error("Ошибка: ID события не найден");
      return;
    }
    const isStaffNotif = event.collectionName === "staffNotifications";
    const ref = isStaffNotif
      ? doc(db, "staffNotifications", eventId)
      : doc(db, "venues", venueId, "events", eventId);
    try {
      await deleteDoc(ref);
      if (isStaffNotif) {
        setFeedEvents((prev) => prev.filter((e) => e.id !== eventId));
      } else {
        setShiftEvents((prev) => prev.filter((e) => e.id !== eventId));
      }
      toast.success("Событие удалено", { id: "archive-event" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка";
      console.error("[archiveEvent] удаление не прошло:", ref.path, e);
      toast.error(msg);
    }
  }, [venueId]);

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
    [venueId]
  );

  const closeTableConfirm = useCallback(async () => {
    const payload = closeTableModal;
    if (!payload) return;
    setCloseTableLoading(true);
    try {
      await updateDoc(doc(db, "activeSessions", payload.sessionId), {
        status: "closed",
        closedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const tableRef = doc(db, "venues", venueId, "tables", payload.tableId);
      const snap = await getDoc(tableRef);
      const existing = snap.exists() ? (snap.data() ?? {}) : {};
      const assignments = (existing.assignments as Record<string, string> | undefined) ?? {};
      await setDoc(
        tableRef,
        {
          status: "free",
          currentGuest: null,
          assignments,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setCloseTableModal(null);
      toast.success("Стол закрыт. Официант остаётся закреплённым.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка закрытия стола");
    } finally {
      setCloseTableLoading(false);
    }
  }, [closeTableModal, venueId]);

  const closeAllTablesAndVenue = useCallback(async () => {
    const sessions = Object.values(sessionsByTable ?? {});
    const tableData: { ref: ReturnType<typeof doc>; assignments: Record<string, string> }[] = [];
    for (const s of sessions) {
      const tableRef = doc(db, "venues", venueId, "tables", s.tableId);
      const snap = await getDoc(tableRef);
      const existing = snap.exists() ? (snap.data() ?? {}) : {};
      const assignments = (existing.assignments as Record<string, string> | undefined) ?? {};
      tableData.push({ ref: tableRef, assignments });
    }
    const batch = writeBatch(db);
    sessions.forEach((s, i) => {
      batch.update(doc(db, "activeSessions", s.sessionId), {
        status: "closed",
        closedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const { ref, assignments } = tableData[i];
      batch.set(ref, {
        status: "free",
        currentGuest: null,
        assignments,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    });
    await batch.commit();
  }, [sessionsByTable, venueId]);

  const confirmCloseVenueWithTables = useCallback(async () => {
    if (closeVenueConfirm !== true) return;
    setToggleVenueLoading(true);
    try {
      await closeAllTablesAndVenue();
      await updateDoc(doc(db, "venues", venueId), {
        manualStatus: "closed",
        updatedAt: serverTimestamp(),
      });
      const staffSnap = await getDocs(collection(db, "venues", venueId, "staff"));
      const staffDocs = staffSnap.docs;
      for (const d of staffDocs) {
        const data = d.data() as { onShift?: boolean; displayName?: string; name?: string };
        if (data?.onShift !== true) continue;
        const staffDisplayName = staffFirstName(
          (data.displayName as string | undefined) ?? (data.name as string | undefined)
        );
        await addDoc(collection(db, "venues", venueId, "staff", d.id, "notifications"), {
          type: "shift_end",
          message: `✨ Смена завершена! ${staffDisplayName}, спасибо за отличную работу! Заведение закрыто.`,
          read: false,
          createdAt: serverTimestamp(),
        });
      }

      const batch = writeBatch(db);
      staffDocs.forEach((d) => batch.update(d.ref, { onShift: false }));
      await batch.commit();

      setCloseVenueConfirm(null);
      toast.success("Все столы закрыты. Заведение закрыто.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setToggleVenueLoading(false);
    }
  }, [closeVenueConfirm, closeAllTablesAndVenue, staffFirstName, venueId]);

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
  }, [venueId]);

  const openGuestModal = useCallback(async (guestId: string) => {
    const snap = await getDoc(doc(db, "venues", venueId, "guests", guestId));
    if (snap.exists()) setGuestModal({ id: snap.id, ...snap.data() } as Guest);
    else toast.error("Гость не найден");
  }, [venueId]);

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

  // Звуковой сигнал при появлении нового emergency в ленте
  useEffect(() => {
    const emergencies = (shiftEvents ?? []).filter((e) => e.type === "emergency" && !e.read);
    for (const ev of emergencies) {
      if (!emergencyPlayedRef.current.has(ev.id)) {
        emergencyPlayedRef.current.add(ev.id);
        try {
          const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.setValueAtTime(880, ctx.currentTime);
          osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.3);
        } catch (_) {
          // ignore if AudioContext not supported
        }
        break;
      }
    }
  }, [shiftEvents]);

  const safeStaffList = staffList ?? [];
  const safeBookingsByTable = bookingsByTable ?? {};
  const safeTables = useMemo(() => tables ?? [], [tables]);
  const sortedTables = useMemo(() => {
    const list = [...safeTables];
    list.sort((a, b) => {
      const na = Number(a.number);
      const nb = Number(b.number);
      const aOk = Number.isFinite(na);
      const bOk = Number.isFinite(nb);
      if (!aOk && !bOk) return (a.id ?? "").localeCompare(b.id ?? "");
      if (!aOk) return 1;
      if (!bOk) return -1;
      return na - nb;
    });
    return list;
  }, [safeTables]);
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

  /** Заведение закрыто по графику: сейчас вне [openTime, closeTime) */
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

  /** Приоритет: manualStatus (если задан) > график */
  const isVenueClosed =
    manualStatus === "closed" ? true : manualStatus === "open" ? false : isVenueClosedBySchedule;

  const handleToggleVenue = useCallback(async () => {
    if (toggleVenueLoading) return;
    if (isVenueClosed) {
      // Открытие должно снять оверлей мгновенно (оптимистично).
      setManualStatus("open");
      setToggleVenueLoading(true);
      setCloseVenueConfirm(null);
      try {
        await updateDoc(doc(db, "venues", venueId), {
          manualStatus: "open",
          updatedAt: serverTimestamp(),
        });
        toast.success("Заведение открыто");
      } catch (e) {
        setManualStatus(null);
        toast.error(e instanceof Error ? e.message : "Ошибка");
      } finally {
        setToggleVenueLoading(false);
      }
      return;
    }

    // Закрытие
    setToggleVenueLoading(true);
    setCloseVenueConfirm(null);
    try {
      if (occupiedCount > 0) {
        setCloseVenueConfirm(true);
        return;
      }

      await updateDoc(doc(db, "venues", venueId), {
        manualStatus: "closed",
        updatedAt: serverTimestamp(),
      });

      // Финальное уведомление активным сотрудникам — в подколлекцию:
      // venues/venue_andrey_alt/staff/[STAFF_ID]/notifications
      const staffSnap = await getDocs(collection(db, "venues", venueId, "staff"));
      const staffDocs = staffSnap.docs;
      for (const d of staffDocs) {
        const data = d.data() as { onShift?: boolean; displayName?: string; name?: string };
        if (data?.onShift !== true) continue;
        const staffDisplayName = staffFirstName((data.displayName as string | undefined) ?? (data.name as string | undefined));
        await addDoc(collection(db, "venues", venueId, "staff", d.id, "notifications"), {
          type: "shift_end",
          message: `✨ Смена завершена! ${staffDisplayName}, спасибо за отличную работу! Заведение закрыто.`,
          read: false,
          createdAt: serverTimestamp(),
        });
      }

      // Заканчиваем смену: сбрасываем onShift у всех сотрудников
      const batch = writeBatch(db);
      staffDocs.forEach((d) => batch.update(d.ref, { onShift: false }));
      await batch.commit();

      toast.success("Заведение закрыто. Смена завершена.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setToggleVenueLoading(false);
    }
  }, [toggleVenueLoading, isVenueClosed, occupiedCount, staffFirstName, venueId]);

  /** Время закрытия по графику сегодня и минут до закрытия (null если нет графика или уже после закрытия) */
  const scheduleCloseTimeAndMins = useMemo(() => {
    const now = new Date();
    const dayKey = getTodayKey(now);
    if (!operatingHours) return null;
    const today = operatingHours[dayKey];
    if (!today || !today.working) return null;
    const close = parseTimeToToday(now, today.closeTime);
    if (!close) return null;
    let closeMs = close.getTime();
    if (closeMs <= now.getTime()) {
      const nextClose = new Date(close);
      nextClose.setDate(nextClose.getDate() + 1);
      closeMs = nextClose.getTime();
    }
    const mins = (closeMs - now.getTime()) / (60 * 1000);
    return { closeTime: new Date(closeMs), minutesLeft: mins };
  }, [operatingHours]);

  /** Цикл 15 мин: если до закрытия по графику <= 15 мин и заведение не закрыто вручную — создаём событие в events для ЛПР */
  useEffect(() => {
    if (manualStatus === "closed" || !scheduleCloseTimeAndMins) return;
    const { minutesLeft, closeTime } = scheduleCloseTimeAndMins;
    if (minutesLeft > 15 || minutesLeft <= 0) return;

    const maybeCreateReminder = () => {
      const now = Date.now();
      if (now - lastClosingReminderAtRef.current < 14 * 60 * 1000) return;
      lastClosingReminderAtRef.current = now;
      const timeStr = formatTimeSafe(closeTime);
      addDoc(collection(db, "venues", venueId, "events"), {
        type: "closing_reminder",
        message: `⚠️ Пора закрываться (График: ${timeStr})`,
        text: `⚠️ Пора закрываться (График: ${timeStr})`,
        read: false,
        venueId,
        createdAt: serverTimestamp(),
      }).catch(() => {});
    };

    maybeCreateReminder();
    const interval = setInterval(maybeCreateReminder, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [manualStatus, scheduleCloseTimeAndMins, venueId]);

  if (venueLoading) {
    return (
      <div className="p-20 text-center text-gray-600">
        Инициализация заведения...
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="fixed right-4 top-4 z-[9999] pointer-events-auto">
        <button
          type="button"
          disabled={toggleVenueLoading}
          onClick={handleToggleVenue}
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition-colors disabled:opacity-50 ${
            isVenueClosed
              ? "bg-emerald-600 text-white hover:bg-emerald-700"
              : "bg-slate-800 text-white hover:bg-slate-700"
          }`}
        >
          {toggleVenueLoading ? "…" : isVenueClosed ? "ОТКРЫТЬ ЗАВЕДЕНИЕ" : "ЗАКРЫТЬ ЗАВЕДЕНИЕ"}
        </button>
      </div>
      {isVenueClosed && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 backdrop-blur-[2px] rounded-xl">
          <p className="text-lg font-medium text-white">Заведение закрыто</p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Центр управления полётами</h2>
          <p className="mt-1 text-sm text-gray-700">
            Заведение: {venueName.trim() ? venueName : venueId}
            {venueSotaId ? (
              <span className="ml-2 font-mono text-xs text-violet-700" title="SOTA-ID">
                {venueSotaId}
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-sm text-gray-600">Живой зал, брони, смена и события в реальном времени.</p>
        </div>
      </div>

      {closeVenueConfirm === true && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h3 className="font-semibold text-gray-900">Есть активные столы!</h3>
            <p className="mt-2 text-sm text-gray-600">
              Закрыть все столы сразу?
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setCloseVenueConfirm(null)}
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                НЕТ
              </button>
              <button
                type="button"
                disabled={toggleVenueLoading}
                onClick={() => confirmCloseVenueWithTables()}
                className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                ДА
              </button>
            </div>
          </div>
        </div>
      )}

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
            <div className="rounded-xl border-2 border-violet-300 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-medium text-black">Живой зал</h3>
              <p className="mt-1 text-2xl font-bold text-black">
                {occupiedCount} <span className="text-gray-400 font-normal">/ {totalTables || "—"}</span>
              </p>
              <p className="mt-0.5 text-xs text-slate-700">занято / всего столов</p>
            </div>
            <Link
              href="/admin/bookings"
              className="rounded-xl border-2 border-violet-300 bg-white p-4 shadow-sm hover:bg-violet-50 transition-colors block"
            >
              <h3 className="text-sm font-medium text-black">Брони сегодня</h3>
              <p className="mt-1 text-2xl font-bold text-black">{bookingsTodayCount}</p>
              <p className="mt-0.5 text-xs text-slate-700">{todayStr}</p>
              {nextBookingInMinutes != null && nextBookingInMinutes > 0 && (
                <p className="mt-1 text-xs font-medium text-slate-700">
                  Следующая бронь через {Math.round(nextBookingInMinutes)} мин.
                </p>
              )}
            </Link>
            <Link
              href="/admin/team"
              className="rounded-xl border-2 border-violet-300 bg-white p-4 shadow-sm hover:bg-violet-50 transition-colors block"
            >
              <h3 className="text-sm font-medium text-black">На смене</h3>
              <p className="mt-1 text-2xl font-bold text-black">{onShiftCount}</p>
              <p className="mt-0.5 text-xs text-slate-700">сотрудников</p>
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
          <p className="mt-1 text-sm text-gray-500">Новые события сверху. Кнопка «ОК» — подтверждение.</p>
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
                const isClosingReminder = ev.type === "closing_reminder";
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
                const isEmergency = ev.type === "emergency";

                return (
                  <li
                    key={ev.id}
                    className={
                      isBookingReminder
                        ? "text-sm bg-orange-100 border-l-4 border-orange-500 text-orange-700 p-4 shadow-md flex justify-between items-center rounded-md"
                        : isClosingReminder
                        ? "flex items-center justify-between gap-3 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900"
                        : isEmergency
                        ? `flex items-center justify-between gap-3 rounded-lg border-4 border-red-600 bg-red-200 p-4 text-sm font-bold text-red-900 ${ev.read ? "opacity-90" : "animate-pulse shadow-lg shadow-red-400/50"}`
                        : `flex items-center justify-between gap-3 rounded-lg border p-3 text-sm ${
                            ev.read
                              ? "border-gray-100 bg-gray-50/50 text-gray-500"
                              : isStartedShift
                              ? "border-green-200 bg-[#e6fffa] text-emerald-900"
                              : isOrphan
                              ? "border-red-400 bg-red-50/80 text-red-900 animate-pulse"
                              : ev.type === "sos"
                              ? "border-red-400 bg-red-50/80 text-red-900"
                              : "border-amber-200 bg-amber-50/80 text-amber-900"
                          }`
                    }
                  >
                    <span>
                      {isBookingReminder
                        ? "⚠️ "
                        : isClosingReminder
                        ? "⚠️ "
                        : isEmergency
                        ? "🚨 КРИТИЧЕСКИЙ ВЫЗОВ "
                        : ev.type === "sos"
                        ? "🚨 SOS"
                        : isOrphan
                        ? "⚠️ Стол без ответственного"
                        : ev.type === "role_call" || ev.type === "call_waiter"
                        ? "📞 Вызов"
                        : ev.type === "request_bill"
                        ? "🧾 Счёт"
                        : ev.type === "guest_arrived"
                        ? "👤"
                        : ""}{" "}
                      {ev.type === "guest_arrived" ? (
                        (ev as FeedEvent).collectionName === "venue_events" && ev.message ? (
                          ev.message
                        ) : (
                          <GuestArrivedMessage ev={ev as FeedEvent} venueId={venueId} />
                        )
                      ) : ev.type === "sos" ? (
                        <>
                          Внимание! Вызов со стола №
                          {looksLikeTableIdError(ev.tableId) ? "—" : String(ev.tableId).trim()}
                        </>
                      ) : (
                        ev.message
                      )}
                      {(ev as FeedEvent & { sender?: string }).sender && ev.type !== "guest_arrived" && (
                        <span className="ml-1 text-xs opacity-90">
                          ({(ev as FeedEvent & { sender?: string }).sender})
                        </span>
                      )}
                      {createdAtLabel && (
                        <span className="ml-1 text-xs text-gray-500">· {createdAtLabel}</span>
                      )}
                      {ev.tableId != null && !isBookingReminder && ev.type !== "sos" && (
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
                        } else if (isEmergency) {
                          setConfirmEmergencyArchive(ev);
                        } else {
                          archiveEvent(ev);
                        }
                      }}
                      className={
                        isBookingReminder
                          ? "ml-4 shrink-0 px-3 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors text-xs font-semibold"
                          : isEmergency
                          ? "shrink-0 rounded-lg border-2 border-red-600 bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                          : "shrink-0 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      }
                    >
                      {isEmergency ? "Принято" : "ОК"}
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
              Внимание! Вызов со стола №
              {activeSos.tableId && !looksLikeTableIdError(activeSos.tableId) ? String(activeSos.tableId).trim() : "—"}.
              Требуется внимание!
              {(() => {
                const m = String(activeSos.message ?? "").match(/\(Вызвал:\s*([^)]+)\)/i);
                const staff = m?.[1]?.trim();
                return staff ? ` (Вызвал: ${staff})` : "";
              })()}
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

      {confirmEmergencyArchive && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-emergency-title"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg border-2 border-red-200">
            <h3 id="confirm-emergency-title" className="text-base font-semibold text-red-800">
              Подтвердить принятие вызова?
            </h3>
            <p className="mt-2 text-sm text-gray-700">
              Вы подтверждаете, что приняли критический вызов (SOS) и событие можно снять с ленты?
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                onClick={() => setConfirmEmergencyArchive(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700"
                onClick={() => {
                  if (confirmEmergencyArchive) {
                    archiveEvent(confirmEmergencyArchive);
                    setConfirmEmergencyArchive(null);
                    toast.success("Вызов принят");
                  }
                }}
              >
                Подтвердить
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
              {sortedTables.map((table) => {
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
                    diffInMinutes >= 0 &&
                    diffInMinutes <= 30;
                  // TargetWaiterId — что именно пришло из tables/{tableId}.assignments.* (может быть doc-id или userId)
                  const targetWaiterId = safeAssignmentsByTable[table.id] ?? "";
                  // Разрешаем ID к staff-doc-id (d.id), чтобы правильно сопоставить onShift из venues/{venue}/staff
                  const staffMember =
                    targetWaiterId === ""
                      ? undefined
                      : safeStaffList.find((s) => s.id === targetWaiterId || s.userId === targetWaiterId);
                  const resolvedStaffId = staffMember?.id ?? "";
                  // Проверяем onShift по нескольким кандидатам на doc-id: иногда tables.assignments.waiter содержит userId без префикса venue
                  const staffDocCandidates = new Set<string>();
                  if (resolvedStaffId) staffDocCandidates.add(resolvedStaffId);
                  if (targetWaiterId) {
                    staffDocCandidates.add(String(targetWaiterId).trim());
                    const prefixed = targetWaiterId.startsWith(`${venueId}_`) ? targetWaiterId : `${venueId}_${targetWaiterId}`;
                    staffDocCandidates.add(prefixed);
                  }
                  const isOnShift = Array.from(staffDocCandidates).some((sid) => venueStaffOnShift[sid] === true);
                  // Временная диагностика (важно для “почему имя не подтягивается”)
                  console.log(
                    "Table:",
                    table.id,
                    "Target Waiter:",
                    targetWaiterId,
                    "Resolved staffId:",
                    resolvedStaffId,
                    "Is He On Shift?:",
                    staffMember?.onShift,
                    "IsOnShiftComputed:",
                    isOnShift
                  );
                  // Сопоставление defaultTables: сравниваем ТОЛЬКО цифры из номера стола.
                  const tableNumberDigits = String(table?.number ?? "").replace(/\D/g, "");
                  // assignedWaiter: берём waiterId из таблицы, если пусто — ищем среди onShift staff по defaultTables
                  const defaultFromTeam = safeStaffList.find((s) => {
                    if (venueStaffOnShift[s.id] !== true) return false;
                    const dt = s.defaultTables ?? [];
                    const dtDigits = dt.map((x) => String(x).replace(/\D/g, ""));
                    return tableNumberDigits ? dtDigits.includes(tableNumberDigits) : false;
                  });
                  // Для «светофора» (рамка + имя) учитываем ТОЛЬКО реальный waiterId со стола.
                  // defaultFromTeam оставляем только для select/подсказки.
                  const waiterOnShift = Boolean(staffMember && staffMember.onShift === true && isOnShift);
                  const waiterDisplayName = staffMember?.displayName;
                  // Зеленое свечение селектора включаем только когда имя найдено и onShift=true
                  const isGreenSelect = waiterOnShift;
                  const uniqueStaffBase = Array.from(
                    new Map(safeOnShiftWaiters.map((w) => [w.id, w])).values()
                  );
                  // Если закреплённый официант найден в staffList и он на смене,
                  // гарантируем, что его option есть в списке — даже если он был отфильтрован по роли выше.
                  const uniqueStaff =
                    staffMember && waiterOnShift
                      ? Array.from(
                          new Map(
                            [...uniqueStaffBase, staffMember].map((w) => [w.id, w])
                          ).values()
                        )
                      : uniqueStaffBase;
                  const defaultSelectValue =
                    defaultFromTeam && uniqueStaff.some((s) => s.id === defaultFromTeam.id) ? defaultFromTeam.id : "";
                  // Если закреплённый официант НЕ на смене — показываем прочерк и убираем подсветку.
                  const selectValue = resolvedStaffId
                    ? waiterOnShift
                      ? resolvedStaffId
                      : ""
                    : defaultSelectValue || "";
                  const isPlanSelection = Boolean(defaultSelectValue && !resolvedStaffId);
                  const hasEmergency = emergencyTableIds.has(table.id);
                  const isBookingSoon = isUrgent;
                  // Физическая доступность стола: зелёная рамка зависит только от времени до брони.
                  const shouldShowGreenReady = !isOccupied && !isBookingSoon;
                  const cardBorder = hasEmergency
                    ? "border-red-600 border-4 animate-pulse"
                    : isOccupied
                      ? "border-4 border-blue-600"
                      : isBookingSoon
                        ? "border-orange-500 border-4 animate-pulse"
                        : shouldShowGreenReady
                          ? "border-2 border-emerald-500"
                          : "border-slate-200";
                  const cardBg = isOccupied
                    ? "bg-blue-600"
                    : "bg-white";
                  const cardText = isOccupied ? "text-white" : "text-slate-900";

                  return (
                    <div
                      key={table.id}
                      className={`rounded-xl border p-4 shadow-sm ${cardBorder} ${cardBg} ${cardText}`}
                    >
                      <div className={`text-2xl font-bold ${cardText}`}>
                        {table?.number ?? table.id ?? "—"}
                      </div>
                      {isOccupied && (
                        <>
                          {waiterOnShift ? (
                            <p className="mt-1 text-xs font-medium text-white/90">{staffFirstName(waiterDisplayName)}</p>
                          ) : (
                            <p className="mt-1 text-xs font-medium text-white/70">Ожидает официанта</p>
                          )}
                          <div className="mt-2">
                            <label className="block text-xs text-white/90">Официант</label>
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
                                  ? "bg-emerald-50 border-emerald-300 ring-2 ring-emerald-400 text-black"
                                  : "bg-white/10 border-blue-400 text-white"
                              }`}
                            >
                              <option value="">—</option>
                              {uniqueStaff.map((w) => (
                                <option
                                  key={w.id}
                                  value={w.id}
                                  className={isGreenSelect && resolvedStaffId && w.id === resolvedStaffId ? "text-black font-semibold" : ""}
                                >
                                  {staffFirstName(w.displayName)}
                                </option>
                              ))}
                            </select>
                          </div>
                          {session?.guestId && (
                            <button
                              type="button"
                              onClick={() => openGuestModal(session.guestId!)}
                              className="mt-2 w-full text-left rounded-lg border border-blue-400/50 bg-white/10 px-2 py-1.5 text-sm text-white hover:bg-white/20"
                            >
                              <span className="font-medium">{guestNames[session.guestId] ?? "Гость"}</span>
                              <span className="ml-1.5 text-white/90">
                                Статус: {GUEST_TYPE_LABEL[guestTypeByGuestId[session.guestId] ?? "regular"] ?? "Новый"}
                              </span>
                              {guestRatings[session.guestId] != null && (
                                <span className="ml-1.5 text-white/90">⭐ {guestRatings[session.guestId]}</span>
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => session && setCloseTableModal({ tableId: table.id, sessionId: session.sessionId })}
                            className="mt-2 w-full rounded-lg border border-blue-400/70 bg-white/10 py-1.5 text-xs font-medium text-white hover:bg-white/20"
                          >
                            Закрыть стол
                          </button>
                        </>
                      )}
                      {!isOccupied && (
                        <>
                          {waiterOnShift ? (
                            <p className="mt-1 text-xs font-medium text-slate-900/90">{staffFirstName(waiterDisplayName)}</p>
                          ) : (
                            <p className="mt-1 text-xs font-medium text-slate-900/70">Ожидает официанта</p>
                          )}
                          <div className="mt-2">
                            <label className="block text-xs text-slate-900/90">Официант</label>
                            <select
                              value={selectValue ?? ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                const tid = table?.id;
                                if (tid) setAssignmentsByTable((prev) => ({ ...prev, [tid]: v }));
                                if (v && tid) saveTableWaiter(tid, v);
                              }}
                              className={`mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm text-slate-900 ${
                                isGreenSelect
                                  ? "border-emerald-300 bg-emerald-50 ring-2 ring-emerald-400 text-black font-semibold"
                                  : "border-gray-300 bg-white"
                              }`}
                            >
                              <option value="">—</option>
                              {uniqueStaff.map((w) => (
                                <option
                                  key={w.id}
                                  value={w.id}
                                  className={isGreenSelect && resolvedStaffId && w.id === resolvedStaffId ? "text-black font-semibold" : ""}
                                >
                                  {staffFirstName(w.displayName)}
                                </option>
                              ))}
                            </select>
                          </div>
                          {isPlanSelection && (
                            <p className="mt-1 text-xs italic text-slate-700/70">
                              По плану из Команды
                            </p>
                          )}
                          {activeBooking && startTimeDate && (
                            <div className="mt-2 text-xs">
                              <span
                                className={
                                  isUrgent
                                    ? "font-extrabold text-slate-900 animate-pulse"
                                    : "text-slate-900/70"
                                }
                              >
                                🕒 {formatTimeSafe(startTimeDate)}
                              </span>
                              {activeBooking.guestName ? (
                                <span className="text-slate-900/80">
                                  {` · ${activeBooking.guestName}`}
                                </span>
                              ) : null}
                            </div>
                          )}
                          <div className="mt-2 text-xs text-slate-900/90 font-medium">Свободен</div>
                        </>
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

      {closeTableModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h3 className="font-semibold text-gray-900">Закрыть стол?</h3>
            <p className="mt-2 text-sm text-gray-600">
              Сессия будет завершена. Официант останется закреплённым за столом.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setCloseTableModal(null)}
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={closeTableLoading}
                onClick={closeTableConfirm}
                className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {closeTableLoading ? "…" : "Закрыть стол"}
              </button>
            </div>
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