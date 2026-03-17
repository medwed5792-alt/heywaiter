"use client";

import { useState, useEffect, useMemo } from "react";
import {
  collection,
  doc,
  query,
  where,
  getDocs,
  getDoc,
  orderBy,
  limit,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { GuestType } from "@/lib/types";

const VENUE_ID = "venue_andrey_alt";
const SCALE = 0.75;

function toMillis(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "object" && "toMillis" in v && typeof (v as { toMillis: () => number }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === "number") return v;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export default function AdminAnalyticsPage() {
  const [serviceSpeedSec, setServiceSpeedSec] = useState<number | null>(null);
  const [traffic, setTraffic] = useState<{ date: string; new: number; regular: number }[]>([]);
  const [leaderboard, setLeaderboard] = useState<{ staffId: string; name: string; rating: number; closedTables: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const ts = Timestamp.fromDate(sevenDaysAgo);

        const [callsSnap, sessionsSnap, reviewsSnap, closedSnap, staffSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, "serviceCalls"),
              where("venueId", "==", VENUE_ID),
              where("createdAt", ">=", ts),
              orderBy("createdAt", "asc"),
              limit(200)
            )
          ).catch(() => ({ docs: [] })),
          getDocs(
            query(
              collection(db, "activeSessions"),
              where("venueId", "==", VENUE_ID),
              where("createdAt", ">=", ts),
              orderBy("createdAt", "asc"),
              limit(500)
            )
          ).catch(() => ({ docs: [] })),
          getDocs(query(collection(db, "reviews"), where("venueId", "==", VENUE_ID), limit(300))).catch(() => ({ docs: [] })),
          getDocs(
            query(
              collection(db, "activeSessions"),
              where("venueId", "==", VENUE_ID),
              where("status", "==", "closed"),
              limit(500)
            )
          ).catch(() => ({ docs: [] })),
          getDocs(query(collection(db, "staff"), where("venueId", "==", VENUE_ID))).catch(() => ({ docs: [] })),
        ]);

        if (cancelled) return;

        const staffMap = new Map<string, { name: string; venueRating?: number }>();
        staffSnap?.docs?.forEach((d) => {
          const data = d?.data?.() ?? {};
          const name =
            [data?.firstName, data?.lastName].filter(Boolean).join(" ") ||
            (data?.identity?.displayName as string) ||
            d?.id;
          const venueRating = typeof data?.venueRating === "number" ? data.venueRating : undefined;
          staffMap.set(d.id, { name, venueRating });
        });

        const calls =
          callsSnap?.docs
            ?.map((d) => d?.data?.())
            ?.filter(
              (d) =>
                d &&
                (d.status === "accepted" || d.status === "completed") &&
                d.createdAt != null &&
                d.acceptedAt != null
            ) ?? [];
        const created = calls.map((c) => toMillis(c?.createdAt));
        const accepted = calls.map((c) => toMillis(c?.acceptedAt));
        let sumMs = 0;
        let count = 0;
        for (let i = 0; i < calls.length; i++) {
          const c = created[i];
          const a = accepted[i];
          if (c != null && a != null && a >= c) {
            sumMs += a - c;
            count++;
          }
        }
        setServiceSpeedSec(count > 0 ? Math.round(sumMs / 1000 / count) : null);

        const guestIds = new Set<string>();
        sessionsSnap?.docs?.forEach((d) => {
          const g = d?.data?.()?.guestId;
          if (g) guestIds.add(g);
        });
        const guestTypeMap = new Map<string, GuestType>();
        if (guestIds.size > 0) {
          const guestSnaps = await Promise.all(
            Array.from(guestIds).map((id) => getDoc(doc(db, "guests", id)))
          );
          Array.from(guestIds).forEach((id, i) => {
            const d = guestSnaps[i];
            const t = (d?.exists() ? (d.data()?.type as GuestType) : null) || "regular";
            guestTypeMap.set(id, t);
          });
        }

        const byDay: Record<string, { new: number; regular: number }> = {};
        const ownTypes: GuestType[] = ["constant", "favorite", "vip"];
        sessionsSnap?.docs?.forEach((d) => {
          const data = d?.data?.() ?? {};
          const createdVal = data?.createdAt;
          const ms = toMillis(createdVal);
          if (ms == null) return;
          const date = new Date(ms).toISOString().slice(0, 10);
          if (!byDay[date]) byDay[date] = { new: 0, regular: 0 };
          const guestId = data?.guestId;
          const type = guestId ? guestTypeMap.get(guestId) ?? "regular" : "regular";
          if (ownTypes.includes(type)) byDay[date].regular += 1;
          else byDay[date].new += 1;
        });
        const sortedDays = Object.keys(byDay).sort();
        setTraffic(sortedDays.map((date) => ({ date, ...byDay[date] })));

        const staffStars: Record<string, { sum: number; count: number }> = {};
        reviewsSnap?.docs?.forEach((d) => {
          const data = d?.data?.() ?? {};
          const stars = Number(data?.stars) || 0;
          const ids = (data?.staffIds as string[]) || [];
          ids.forEach((id) => {
            if (!staffStars[id]) staffStars[id] = { sum: 0, count: 0 };
            staffStars[id].sum += stars;
            staffStars[id].count += 1;
          });
        });
        const staffClosed: Record<string, number> = {};
        closedSnap?.docs?.forEach((d) => {
          const waiterId = d?.data?.()?.waiterId as string | undefined;
          if (waiterId) staffClosed[waiterId] = (staffClosed[waiterId] || 0) + 1;
        });
        const combined = Array.from(staffMap.entries()).map(([staffId, { name, venueRating }]) => {
          const s = staffStars[staffId];
          const guestRating = s?.count ? Math.round((s.sum / s.count) * 10) / 10 : 0;
          const lprRating = venueRating ?? guestRating;
          const rating =
            guestRating > 0 && lprRating > 0
              ? Math.round(((guestRating + lprRating) / 2) * 10) / 10
              : guestRating || lprRating;
          const closedTables = staffClosed[staffId] || 0;
          return { staffId, name, rating, closedTables };
        });
        combined.sort((a, b) => {
          if (b.rating !== a.rating) return b.rating - a.rating;
          return b.closedTables - a.closedTables;
        });
        setLeaderboard(combined.slice(0, 10));
      } catch (_) {
        setServiceSpeedSec(null);
        setTraffic([]);
        setLeaderboard([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const scaleStyle = useMemo(
    () => ({ transform: `scale(${SCALE})`, transformOrigin: "top left", width: `${100 / SCALE}%`, minHeight: `${100 / SCALE}%` } as React.CSSProperties),
    []
  );

  return (
    <div style={scaleStyle}>
      <h2 className="text-lg font-semibold text-gray-900">Аналитика</h2>
      <p className="mt-2 text-sm text-gray-600">
        Service Speed, трафик гостей за 7 дней, рейтинг сотрудников.
      </p>

      {loading ? (
        <p className="mt-6 text-sm text-gray-500">Загрузка…</p>
      ) : (
        <div className="mt-6 grid gap-6 sm:grid-cols-1 lg:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-medium text-gray-600">Service Speed</h3>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {serviceSpeedSec != null ? (
                <>
                  {serviceSpeedSec >= 60 ? `${Math.floor(serviceSpeedSec / 60)} мин ` : ""}
                  {serviceSpeedSec % 60} с
                </>
              ) : (
                <span className="text-gray-500 font-normal">Данных пока нет</span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              Среднее время между created и accepted за 7 дней
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm lg:col-span-2">
            <h3 className="text-sm font-medium text-gray-600">Guest Traffic (7 дней)</h3>
            <p className="mt-0.5 text-xs text-gray-500 mb-3">Соотношение «Новый» / «Постоянный»</p>
            {!traffic?.length ? (
              <p className="text-sm text-gray-500">Данных пока нет</p>
            ) : (
              <div className="space-y-2">
                {traffic.map(({ date, new: newCount, regular }) => (
                  <div key={date} className="flex items-center gap-4 text-sm">
                    <span className="w-24 text-gray-600">{date}</span>
                    <span className="text-blue-600">Новые: {newCount}</span>
                    <span className="text-green-600">Постоянные: {regular}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm lg:col-span-3">
            <h3 className="text-sm font-medium text-gray-600">Performance</h3>
            <p className="mt-0.5 text-xs text-gray-500 mb-3">
              Рейтинг сотрудников на основе оценок ЛПР и гостей
            </p>
            {!leaderboard?.length ? (
              <p className="text-sm text-gray-500">Данных пока нет</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-600">
                    <th className="pb-2 pr-4">Сотрудник</th>
                    <th className="pb-2 pr-4">Рейтинг</th>
                    <th className="pb-2">Закрыто столов</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row) => (
                    <tr key={row.staffId} className="border-b border-gray-100">
                      <td className="py-2 pr-4 font-medium">{row.name}</td>
                      <td className="py-2 pr-4">{row.rating}</td>
                      <td className="py-2">{row.closedTables}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
