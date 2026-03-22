"use client";

import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Order } from "@/lib/types";

import { DEFAULT_VENUE_ID as VENUE_ID } from "@/lib/standards/venue-default";

/** Проигрывает короткий звуковой сигнал при появлении нового заказа */
function useNewOrderSound(pendingCount: number) {
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (pendingCount > prevCountRef.current && prevCountRef.current > 0) {
      try {
        if (typeof window !== "undefined" && window.AudioContext) {
          const ctx = new window.AudioContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.15, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.2);
        }
      } catch {
        // ignore
      }
    }
    prevCountRef.current = pendingCount;
  }, [pendingCount]);
}

export default function AdminKitchenPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingId, setMarkingId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "orders"),
      where("venueId", "==", VENUE_ID),
      where("status", "==", "pending")
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: Order[] = snap.docs
        .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          orderNumber: data.orderNumber ?? 0,
          venueId: data.venueId ?? "",
          guestChatId: data.guestChatId ?? "",
          guestPlatform: data.guestPlatform ?? "telegram",
          status: data.status ?? "pending",
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
      })
        .sort((a, b) => {
          const ta = (a.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
          const tb = (b.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
          return ta - tb;
        });
      setOrders(list);
      setLoading(false);
    }, (err) => {
      console.error("[kitchen] onSnapshot error:", err);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useNewOrderSound(orders.length);

  const handleReady = async (orderId: string) => {
    setMarkingId(orderId);
    try {
      const res = await fetch("/api/admin/kitchen/order-ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error || "Ошибка");
      } else {
        toast.success("Заказ отмечен готовым");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setMarkingId(null);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">Кухня</h2>
      <p className="mt-1 text-sm text-gray-600">
        Список заказов в очереди. Нажмите «ГОТОВО» — гостю уйдёт уведомление в тот мессенджер, через который он оформил заказ.
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-gray-500">Загрузка…</p>
      ) : orders.length === 0 ? (
        <p className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
          Нет заказов в очереди
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {orders.map((order) => (
            <li
              key={order.id}
              className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <span className="text-lg font-bold text-gray-900">
                Заказ №{order.orderNumber}
              </span>
              <button
                type="button"
                disabled={markingId === order.id}
                onClick={() => handleReady(order.id)}
                className="rounded-xl bg-green-600 px-6 py-3 text-base font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {markingId === order.id ? "…" : "ГОТОВО"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
