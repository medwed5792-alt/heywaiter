"use client";

import { useState, useEffect } from "react";
import { collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Review } from "@/lib/types";

const VENUE_ID = "current";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [avgStars, setAvgStars] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ref = collection(db, "reviews");
      const q = query(
        ref,
        where("venueId", "==", VENUE_ID),
        orderBy("createdAt", "desc"),
        limit(100)
      );
      const snap = await getDocs(q);
      if (cancelled) return;
      const list: Review[] = [];
      let sum = 0;
      let count = 0;
      snap.docs.forEach((d) => {
        const data = d.data();
        const r: Review = {
          id: d.id,
          venueId: data.venueId ?? "",
          tableId: data.tableId ?? "",
          stars: data.stars ?? 0,
          starsCategories: data.starsCategories,
          text: data.text,
          staffIds: data.staffIds ?? [],
          sessionId: data.sessionId,
          createdAt: data.createdAt,
        };
        list.push(r);
        sum += r.stars;
        count += 1;
      });
      setReviews(list);
      setAvgStars(count > 0 ? round1(sum / count) : null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">Отзывы</h2>
      <p className="mt-1 text-sm text-gray-600">
        Список отзывов: stars (4 категории), text, tableId, staffIds. Средний балл заведения.
      </p>

      {avgStars !== null && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-medium text-gray-700">Средний балл заведения</h3>
          <p className="mt-1 text-2xl font-bold text-gray-900">{avgStars}</p>
          <p className="text-xs text-gray-500">из 5</p>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-hidden">
        {loading ? (
          <p className="p-4 text-sm text-gray-500">Загрузка…</p>
        ) : reviews.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">Нет отзывов.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {reviews.map((r) => (
              <li key={r.id} className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900">★ {r.stars}</span>
                  <span className="text-xs text-gray-500">Стол {r.tableId}</span>
                </div>
                {r.starsCategories && (
                  <p className="mt-1 text-xs text-gray-600">
                    Кухня: {r.starsCategories.kitchen ?? "—"} · Сервис: {r.starsCategories.service ?? "—"} · Чистота: {r.starsCategories.cleanliness ?? "—"} · Атмосфера: {r.starsCategories.atmosphere ?? "—"}
                  </p>
                )}
                {r.text && <p className="mt-2 text-sm text-gray-700">{r.text}</p>}
                {r.staffIds?.length ? (
                  <p className="mt-1 text-xs text-gray-500">Обслуживали: {r.staffIds.join(", ")}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
