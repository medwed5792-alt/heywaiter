"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useMemo, Suspense, useState, useCallback } from "react";
import { MessageCircle } from "lucide-react";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
  limit,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getCheckInCopy } from "@/lib/i18n-checkin";
import { buildDeepLink, messengerLabels } from "@/lib/deep-links";
import { CALL_WAITER_COOLDOWN_MS } from "@/lib/constants";
import { DebugPanelTrigger } from "@/components/debug/DebugPanelTrigger";
import type { MessengerChannel } from "@/lib/types";

const RESERVATION_WINDOW_MS = 30 * 60 * 1000; // ±30 мин

const MESSENGER_CHANNELS: MessengerChannel[] = [
  "telegram",
  "whatsapp",
  "viber",
];

function getBrowserLocale(): string {
  if (typeof navigator === "undefined") return "en";
  return (navigator.language || (navigator as unknown as { userLanguage?: string }).userLanguage || "en")
    .split("-")[0]
    .toLowerCase();
}

function CheckInContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tableId = searchParams.get("t") ?? "";
  const venueId = searchParams.get("v") ?? "";

  const [locale, setLocale] = useState(getBrowserLocale());
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "conflict">("idle");
  const [cooldownLeft, setCooldownLeft] = useState(0);

  useEffect(() => {
    setLocale(getBrowserLocale());
  }, []);

  // Таймер 120 сек после нажатия (Golden Standard)
  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const t = setInterval(() => {
      setCooldownLeft((s) => {
        if (s <= 1) {
          clearInterval(t);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [cooldownLeft]);

  const runCheckIn = useCallback(
    async (channel: MessengerChannel) => {
      if (!venueId || !tableId) return;
      setStatus("loading");
      const now = new Date();
      const windowStart = new Date(now.getTime() - RESERVATION_WINDOW_MS);
      const windowEnd = new Date(now.getTime() + RESERVATION_WINDOW_MS);

      try {
        const reservationsRef = collection(db, "reservations");
        const q = query(
          reservationsRef,
          where("venueId", "==", venueId),
          where("tableId", "==", tableId),
          where("reservedAt", ">=", Timestamp.fromDate(windowStart)),
          where("reservedAt", "<=", Timestamp.fromDate(windowEnd)),
          limit(1)
        );
        const snap = await getDocs(q);
        const hasReservation = !snap.empty;

        const tableNum = Number.isNaN(Number(tableId)) ? 0 : Number(tableId);

        if (hasReservation) {
          const conflictRef = await addDoc(collection(db, "activeSessions"), {
            venueId,
            tableId,
            tableNumber: tableNum,
            guestIdentity: null,
            status: "table_conflict",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await addDoc(collection(db, "staffNotifications"), {
            venueId,
            tableId,
            type: "table_conflict",
            sessionId: conflictRef.id,
            message: `Конфликт брони: стол ${tableId}. К вам уже идут.`,
            read: false,
            createdAt: serverTimestamp(),
          });
          setStatus("conflict");
        } else {
          const sessionRef = await addDoc(collection(db, "activeSessions"), {
            venueId,
            tableId,
            tableNumber: tableNum,
            guestIdentity: null,
            waiterId: null,
            waiterDisplayName: null,
            status: "check_in_success",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await addDoc(collection(db, "staffNotifications"), {
            venueId,
            tableId,
            sessionId: sessionRef.id,
            type: "new_guest",
            message: `Новый гость, Стол №${tableNum || tableId}`,
            read: false,
            createdAt: serverTimestamp(),
          });
          setStatus("success");
          window.location.href = buildDeepLink(channel, venueId, tableId);
        }
        setCooldownLeft(Math.ceil(CALL_WAITER_COOLDOWN_MS / 1000));
      } catch (err) {
        console.error("check-in error:", err);
        setStatus("idle");
      }
    },
    [venueId, tableId]
  );

  const copy = useMemo(() => getCheckInCopy(locale), [locale]);
  const isValid = Boolean(tableId && venueId);
  const isBlocked = status === "loading" || cooldownLeft > 0;

  if (!isValid) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-slate-50">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg border border-gray-200 text-center">
          <h1 className="text-xl font-bold text-gray-800">{copy.title}</h1>
          <p className="mt-4 text-gray-600">
            Неверная ссылка. Отсканируйте QR-код стола.
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mt-6 rounded-xl bg-gray-900 px-6 py-3 text-sm font-medium text-white hover:bg-gray-800"
          >
            На главную
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg border border-gray-200 text-center">
        <DebugPanelTrigger>
          {({ onClick }) => (
            <h1
              className="text-2xl font-black text-gray-900 tracking-tight cursor-pointer select-none"
              onClick={onClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onClick()}
            >
              {copy.title}
            </h1>
          )}
        </DebugPanelTrigger>
        <p className="mt-3 text-gray-600 text-sm">{copy.subtitle}</p>
        {status === "conflict" && (
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            Извините, стол забронирован. К вам уже идут.
          </p>
        )}
        {status === "success" && (
          <p className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">
            Посадка подтверждена. Открываем мессенджер…
          </p>
        )}
        {cooldownLeft > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            Следующий вызов через {cooldownLeft} сек
          </p>
        )}
        <p className="mt-4 text-xs text-gray-500 uppercase tracking-wider">
          Стол · {tableId} · {copy.choose}
        </p>
        <div className="mt-6 flex flex-col gap-3">
          {MESSENGER_CHANNELS.map((channel) => {
            const label = messengerLabels[channel] ?? channel;
            return (
              <button
                key={channel}
                type="button"
                disabled={isBlocked}
                onClick={() => runCheckIn(channel)}
                className="flex items-center justify-center gap-3 rounded-xl border-2 border-gray-200 bg-gray-50 py-4 px-6 font-semibold text-gray-800 transition-colors disabled:cursor-not-allowed disabled:opacity-50 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-700 disabled:hover:border-gray-200 disabled:hover:bg-gray-50 disabled:hover:text-gray-800"
              >
                <MessageCircle className="h-5 w-5 shrink-0" aria-hidden />
                <span className="inline-flex items-center rounded-full bg-gray-200 px-3 py-0.5 text-xs font-medium text-gray-700">
                  {label}
                </span>
                <span className="text-sm">
                  {status === "loading" ? "…" : `${copy.openIn} ${label}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </main>
  );
}

export default function CheckInPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-50">
          <p className="text-gray-500">Загрузка...</p>
        </main>
      }
    >
      <CheckInContent />
    </Suspense>
  );
}
