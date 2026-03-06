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
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { VenueType } from "@/lib/types";

const VENUE_ID = "current";
const EMERGENCY_LIMIT = 10;
const RESERVATION_WINDOW_MS = 30 * 60 * 1000;

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
    });
    return () => unsub();
  }, [venueType]);

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
    </div>
  );
}
