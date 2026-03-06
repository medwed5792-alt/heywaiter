"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, where, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ScheduleTimeline } from "@/components/admin/ScheduleTimeline";
import type { ScheduleEntry, ServiceRole } from "@/lib/types";

const VENUE_ID = "current";

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export default function AdminSchedulePage() {
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState(todayISO);
  const [filterRole, setFilterRole] = useState<ServiceRole | "">("");
  const [staffOutOfZoneIdSet, setStaffOutOfZoneIdSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ref = collection(db, "scheduleEntries");
      const q = query(ref, where("venueId", "==", VENUE_ID));
      const snap = await getDocs(q);
      if (cancelled) return;
      const list: ScheduleEntry[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          venueId: data.venueId ?? "",
          staffId: data.staffId ?? "",
          date: data.date ?? "",
          planHours: data.planHours ?? 0,
          factHours: data.factHours,
          role: data.role,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
      });
      setEntries(list);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
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
        if (filterDate && e.date !== filterDate) return false;
        if (filterRole && e.role !== filterRole) return false;
        return true;
      }),
    [entries, filterDate, filterRole]
  );

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">График</h2>
      <p className="mt-1 text-sm text-gray-600">
        Таймлайн: строки — сотрудники, колонки — часы. Синий — план, зелёный — факт. Красная точка — превышение или вне зоны GPS.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Дата</span>
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
      </div>

      <div className="mt-4 max-h-[70vh] min-h-[200px]">
        {loading ? (
          <p className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            Загрузка…
          </p>
        ) : (
          <ScheduleTimeline
            entries={filtered}
            selectedDate={filterDate}
            outOfZoneStaffIds={staffOutOfZoneIdSet}
            venueId={VENUE_ID}
          />
        )}
      </div>
    </div>
  );
}
// TEST SAVE
