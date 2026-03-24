"use client";

/**
 * Интерфейс гостя (Гостевой вход).
 * Выбор мессенджера для перехода в бота заведения. 8 каналов в едином пульте.
 */

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useMemo, Suspense, useState, useCallback } from "react";
import { MessageCircle } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { resolveVenueDisplayName, resolveTableNumberFromDoc } from "@/lib/venue-display";
import { getCheckInCopy } from "@/lib/i18n-checkin";
import { buildDeepLink, messengerLabels } from "@/lib/deep-links";
import { buildTelegramStartAppLinkResolved } from "@/lib/guest-telegram-link";
import { CALL_WAITER_COOLDOWN_MS } from "@/lib/constants";
import { DebugPanelTrigger } from "@/components/debug/DebugPanelTrigger";
import { useVisitor } from "@/components/providers/VisitorProvider";
import type { MessengerChannel } from "@/lib/types";
import { WEBHOOK_CHANNELS } from "@/lib/webhook/channels";
import { resolveUnifiedCustomerUid } from "@/lib/identity/customer-uid";

/** Фирменные цвета брендов мессенджеров для кнопок (строгий стиль) */
const MESSENGER_BRAND_COLORS: Record<MessengerChannel, string> = {
  telegram: "#0088cc",
  whatsapp: "#25D366",
  viber: "#7360f2",
  vk: "#0077FF",
  facebook: "#0084FF",
  instagram: "#E4405F",
  wechat: "#07C160",
  line: "#06C755",
};

function getBrowserLocale(): string {
  if (typeof navigator === "undefined") return "en";
  return (navigator.language || (navigator as unknown as { userLanguage?: string }).userLanguage || "en")
    .split("-")[0]
    .toLowerCase();
}

function CheckInContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tableId = (searchParams.get("t") ?? "").trim();
  const venueId = (searchParams.get("v") ?? "").trim();
  const { visitorId, recordVisitorSession } = useVisitor();

  const [locale, setLocale] = useState(getBrowserLocale());
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "conflict" | "private">("idle");
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [venueDisplayName, setVenueDisplayName] = useState<string>("");
  const [tableNumberResolved, setTableNumberResolved] = useState<number | null>(null);
  const [venueMetaLoaded, setVenueMetaLoaded] = useState(false);
  const telegramWebAppUserId = useMemo(() => {
    if (typeof window === "undefined") return null;
    const id = (
      window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { id?: number } } } } }
    ).Telegram?.WebApp?.initDataUnsafe?.user?.id;
    return id != null ? String(id) : null;
  }, []);
  const currentUid = resolveUnifiedCustomerUid({
    telegramUserId: telegramWebAppUserId,
    anonymousId: visitorId,
  });

  useEffect(() => {
    setLocale(getBrowserLocale());
  }, []);

  useEffect(() => {
    if (!venueId || !tableId) {
      setVenueDisplayName("");
      setTableNumberResolved(null);
      setVenueMetaLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const venueSnap = await getDoc(doc(db, "venues", venueId));
        if (!cancelled) {
          if (venueSnap.exists()) {
            setVenueDisplayName(resolveVenueDisplayName(venueSnap.data()?.name));
          } else {
            setVenueDisplayName(resolveVenueDisplayName(undefined));
          }
        }
        const tableSnap = await getDoc(doc(db, "venues", venueId, "tables", tableId));
        if (!cancelled && tableSnap.exists()) {
          setTableNumberResolved(resolveTableNumberFromDoc(tableSnap.data() as Record<string, unknown>));
        } else if (!cancelled) {
          setTableNumberResolved(null);
        }
      } finally {
        if (!cancelled) setVenueMetaLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venueId, tableId]);

  // При первом визите на /check-in с валидными v и t — записать сессию в Firestore
  useEffect(() => {
    if (venueId && tableId && visitorId) {
      recordVisitorSession(venueId, tableId);
    }
  }, [venueId, tableId, visitorId, recordVisitorSession]);

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

      // TODO: при необходимости фиксировать выбор мессенджера в Firestore:
      // например коллекция checkInChoices { venueId, tableId, channel, createdAt }
      // или поле guestChannel в документе activeSessions после создания сессии.

      try {
        const tableNum = Number.isNaN(Number(tableId)) ? 0 : Number(tableId);

        const res = await fetch("/api/check-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            venueId,
            tableId,
            tableNumber: tableNum,
            participantUid: currentUid || undefined,
            // На этом экране мы не знаем конкретный guestId/messenger identity,
            // поэтому оставляем guestIdentity undefined (API сможет только проверить reservation conflict).
            guestIdentity: undefined,
          }),
        });

        const data = (await res.json().catch(() => ({}))) as
          | { status?: string; error?: string }
          | Record<string, unknown>;

        if (!res.ok || (data as { error?: string }).error) {
          throw new Error((data as { error?: string }).error || "check-in failed");
        }

        const apiStatus = (data as { status?: "check_in_success" | "table_conflict" | "table_private" }).status;
        if (apiStatus === "table_conflict") setStatus("conflict");
        else if (apiStatus === "table_private") setStatus("private");
        else setStatus("success");

        if (apiStatus === "check_in_success") {
          if (channel === "telegram") {
            window.location.href = await buildTelegramStartAppLinkResolved(db, venueId, tableId);
          } else {
            window.location.href = buildDeepLink(
              channel,
              venueId,
              tableId,
              visitorId?.trim() || undefined
            );
          }
        }

        setCooldownLeft(Math.ceil(CALL_WAITER_COOLDOWN_MS / 1000));
      } catch (err) {
        console.error("check-in error:", err);
        setStatus("idle");
      }
    },
    [venueId, tableId, currentUid, visitorId]
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
              {venueMetaLoaded ? venueDisplayName : copy.title}
            </h1>
          )}
        </DebugPanelTrigger>
        <p className="mt-3 text-gray-600 text-sm">{copy.subtitle}</p>
        {status === "conflict" && (
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            Извините, стол забронирован. К вам уже идут.
          </p>
        )}
        {status === "private" && (
          <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
            Стол приватный. Подселение запрещено без разрешения хозяина.
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
        <p className="mt-4 text-sm text-gray-600">
          {venueMetaLoaded ? (
            <>
              Добро пожаловать в {venueDisplayName}!
              {tableNumberResolved != null ? <> Ваш стол №{tableNumberResolved}.</> : null}{" "}
              {copy.choose}
            </>
          ) : (
            <span className="text-gray-500">Загрузка…</span>
          )}
        </p>
        {/* Интерфейс гостя: 8 кнопок мессенджеров в сетке 2×4, фирменные цвета */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          {WEBHOOK_CHANNELS.map((channel) => {
            const label = messengerLabels[channel] ?? channel;
            const brandColor = MESSENGER_BRAND_COLORS[channel] ?? "#6b7280";
            return (
              <button
                key={channel}
                type="button"
                disabled={isBlocked}
                onClick={() => runCheckIn(channel)}
                className="flex items-center justify-center gap-2 rounded-xl border-2 py-4 px-4 font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400"
                style={{
                  backgroundColor: brandColor,
                  borderColor: brandColor,
                }}
              >
                <MessageCircle className="h-5 w-5 shrink-0 opacity-90" aria-hidden />
                <span className="text-sm truncate">
                  {status === "loading" ? "…" : label}
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
