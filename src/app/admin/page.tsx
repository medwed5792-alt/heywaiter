"use client";

import { useState, useEffect } from "react";
import {
  collection,
  doc,
  getDoc,
  query,
  where,
  onSnapshot,
  limit,
  orderBy,
  Timestamp,
  updateDoc,
  addDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { VenueType } from "@/lib/types";

const VENUE_ID = "current";
const EMERGENCY_LIMIT = 10;
const RESERVATION_WINDOW_MS = 30 * 60 * 1000;

interface ClosedSessionForRating {
  id: string;
  guestId?: string;
  guestName: string;
  waiterId?: string;
  closedAt: unknown;
}

interface EmergencyEvent {
  id: string;
  type: string;
  message: string;
  venueId: string;
  tableId?: string;
  createdAt: unknown;
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

export default function AdminDashboardPage() {
  const [venueType, setVenueType] = useState<VenueType | null>(null);
  const [venueLoading, setVenueLoading] = useState(true);
  const [occupiedCount, setOccupiedCount] = useState(0);
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);
  const [reservedCount, setReservedCount] = useState(0);
  const [tablesCount, setTablesCount] = useState(0);
  const [emergencies, setEmergencies] = useState<EmergencyEvent[]>([]);
  const [emergenciesLoading, setEmergenciesLoading] = useState(true);
  const [occupiedTables, setOccupiedTables] = useState<{ tableId: string; tableNumber: number; guestId?: string }[]>([]);
  const [guestNames, setGuestNames] = useState<Record<string, string>>({});
  const [unratedClosedSessions, setUnratedClosedSessions] = useState<ClosedSessionForRating[]>([]);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, "venues", VENUE_ID));
      if (snap.exists()) {
        const data = snap.data();
        setVenueType((data.venueType as VenueType) || "full_service");
        setTablesCount(data.tablesCount ?? 0);
      } else {
        setVenueType("full_service");
      }
      setVenueLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (venueType !== "full_service") return;
    const q = query(
      collection(db, "activeSessions"),
      where("venueId", "==", VENUE_ID),
      where("status", "==", "check_in_success")
    );
    const unsub = onSnapshot(q, (snap) => {
      setOccupiedCount(snap.size);
      const list = snap.docs.map((d) => {
        const data = d.data();
        return { tableId: data.tableId ?? "", tableNumber: data.tableNumber ?? 0, guestId: data.guestId };
      });
      setOccupiedTables(list);
    });
    return () => unsub();
  }, [venueType]);

  useEffect(() => {
    const ids = [...new Set(occupiedTables.map((t) => t.guestId).filter(Boolean))] as string[];
    if (ids.length === 0) {
      setGuestNames({});
      return;
    }
    let cancelled = false;
    (async () => {
      const names: Record<string, string> = {};
      await Promise.all(
        ids.map(async (id) => {
          if (cancelled) return;
          const snap = await getDoc(doc(db, "guests", id));
          if (snap.exists()) {
            const d = snap.data();
            names[id] = (d.name as string) || (d.nickname as string) || (d.phone as string) || id.slice(0, 8);
          }
        })
      );
      if (!cancelled) setGuestNames(names);
    })();
    return () => { cancelled = true; };
  }, [occupiedTables]);

  useEffect(() => {
    const now = new Date();
    const windowStart = Timestamp.fromDate(new Date(now.getTime() - RESERVATION_WINDOW_MS));
    const windowEnd = Timestamp.fromDate(new Date(now.getTime() + RESERVATION_WINDOW_MS));
    if (venueType !== "full_service") return;
    const q = query(
      collection(db, "reservations"),
      where("venueId", "==", VENUE_ID),
      where("reservedAt", ">=", windowStart),
      where("reservedAt", "<=", windowEnd)
    );
    const unsub = onSnapshot(q, (snap) => {
      setReservedCount(snap.size);
    });
    return () => unsub();
  }, [venueType]);

  useEffect(() => {
    if (venueType !== "fast_food") return;
    const q = query(
      collection(db, "orders"),
      where("venueId", "==", VENUE_ID),
      where("status", "==", "pending")
    );
    const unsub = onSnapshot(q, (snap) => {
      setPendingOrdersCount(snap.size);
    });
    return () => unsub();
  }, [venueType]);

  useEffect(() => {
    const q = query(
      collection(db, "activeSessions"),
      where("venueId", "==", VENUE_ID),
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
      const guestIds = [...new Set(closed.map((c) => c.guestId).filter(Boolean))] as string[];
      const names: Record<string, string> = {};
      for (const gid of guestIds) {
        const s = await getDoc(doc(db, "guests", gid));
        if (s.exists()) {
          const d = s.data();
          names[gid] = (d.name as string) || (d.nickname as string) || (d.phone as string) || gid.slice(0, 8);
        }
      }
      setUnratedClosedSessions(
        closed.map((c) => ({
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

  useEffect(() => {
    const q = query(
      collection(db, "staffNotifications"),
      where("venueId", "==", VENUE_ID),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs
        .filter((d) => {
          const t = d.data().type;
          return t === "sos" || t === "geo_escape";
        })
        .slice(0, EMERGENCY_LIMIT)
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            type: data.type ?? "",
            message: data.message ?? "",
            venueId: data.venueId ?? "",
            tableId: data.tableId,
            createdAt: data.createdAt,
          };
        });
      setEmergencies(list);
      setEmergenciesLoading(false);
    });
    return () => unsub();
  }, []);

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">Пульт управления</h2>
      <p className="mt-2 text-sm text-gray-600">
        Сводка по залу, кухне и экстренным событиям в реальном времени.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {venueLoading ? (
          <>
            <TableSkeleton />
            <TableSkeleton />
          </>
        ) : venueType === "fast_food" ? (
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-medium text-gray-600">Нагрузка кухни</h3>
            <p className="mt-1 text-2xl font-bold text-gray-900">{pendingOrdersCount}</p>
            <p className="mt-0.5 text-xs text-gray-500">заказов в очереди (pending)</p>
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-medium text-gray-600">Живой зал — занято</h3>
              <p className="mt-1 text-2xl font-bold text-amber-700">{occupiedCount}</p>
              <p className="mt-0.5 text-xs text-gray-500">столов с гостями</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-medium text-gray-600">Бронь</h3>
              <p className="mt-1 text-2xl font-bold text-blue-700">{reservedCount}</p>
              <p className="mt-0.5 text-xs text-gray-500">в окне ±30 мин</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-medium text-gray-600">Всего столов</h3>
              <p className="mt-1 text-2xl font-bold text-gray-900">{tablesCount}</p>
              <p className="mt-0.5 text-xs text-gray-500">свободно: {Math.max(0, tablesCount - occupiedCount)}</p>
            </div>
            {occupiedTables.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:col-span-2 lg:col-span-3">
                <h3 className="text-sm font-medium text-gray-600">Занятые столы</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {occupiedTables.map((t, i) => (
                    <li key={t.tableId + i} className="flex justify-between gap-2">
                      <span className="text-gray-700">Стол {t.tableNumber || t.tableId || "—"}</span>
                      <span className="font-medium text-gray-900">{t.guestId ? (guestNames[t.guestId] ?? "…") : "—"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      <section className="mt-8">
        <h3 className="text-base font-semibold text-gray-900">Экстренные события</h3>
        <p className="mt-1 text-sm text-gray-500">Последние SOS и Escape-алерты</p>
        {emergenciesLoading ? (
          <div className="mt-3 space-y-2">
            <EventSkeleton />
            <EventSkeleton />
            <EventSkeleton />
          </div>
        ) : emergencies.length === 0 ? (
          <p className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
            Нет экстренных событий
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {emergencies.map((ev) => (
              <li
                key={ev.id}
                className={`rounded-lg border p-3 text-sm ${
                  ev.type === "sos"
                    ? "border-red-200 bg-red-50 text-red-900"
                    : "border-amber-200 bg-amber-50 text-amber-900"
                }`}
              >
                <span className="font-medium">
                  {ev.type === "sos" ? "🚨 SOS" : "📍 Escape"}
                </span>{" "}
                {ev.message}
                {ev.tableId != null && (
                  <span className="ml-1 text-gray-600">Стол №{ev.tableId}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {unratedClosedSessions.length > 0 && (
        <RateGuestVisitModal
          session={unratedClosedSessions[0]}
          onRated={() => setUnratedClosedSessions((prev) => prev.slice(1))}
          onDismiss={() => setUnratedClosedSessions((prev) => prev.slice(1))}
          submitting={ratingSubmitting}
          setSubmitting={setRatingSubmitting}
        />
      )}
    </div>
  );
}

function RateGuestVisitModal({
  session,
  onRated,
  onDismiss,
  submitting,
  setSubmitting,
}: {
  session: ClosedSessionForRating;
  onRated: () => void;
  onDismiss: () => void;
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
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
        const avg = Math.round((newRatings.reduce((a, b) => a + b, 0) / newRatings.length) * 10) / 10;
        await setDoc(ref, { ratings: newRatings, globalGuestScore: avg }, { merge: true });
      }
      await updateDoc(doc(db, "activeSessions", session.id), {
        ratedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const notifRef = await addDoc(collection(db, "staffNotifications"), {
        venueId: "current",
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
          body: JSON.stringify({ notificationId: notifRef.id, waiterId: session.waiterId, stars }),
        });
      }
      onRated();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
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
                stars === n ? "border-amber-500 bg-amber-50 text-amber-700" : "border-gray-300 hover:bg-gray-50"
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
            onClick={onDismiss}
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
