"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useMemo, useState, useEffect, useRef } from "react";
import { collection, doc, getDoc, getDocs, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { GuestCallPanel } from "@/components/guest/GuestCallPanel";
import { GuestMainMenu } from "@/components/guest/GuestMainMenu";
import { DebugPanelTrigger } from "@/components/debug/DebugPanelTrigger";
import { useVisitor } from "@/components/providers/VisitorProvider";
import type { Order } from "@/lib/types";

/**
 * Mini App гостя.
 * Сценарий QR (v=ID, t=ID): сразу пульт вызова.
 * Сценарий «Из дома» (без v/t): главное меню — Сканер, Монитор, Бронирование, Акции, Рейтинг, Поиск, Связаться.
 * Fast Food: ?v=venueId&orderId=XXX — Статус заказа и Меню. Масштаб 75% в globals.css.
 */
function PanelContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const venueId = searchParams.get("v") ?? "";
  const tableId = searchParams.get("t") ?? "";
  const orderId = searchParams.get("orderId") ?? "";
  const chatId = searchParams.get("chatId") ?? "";
  const platform = searchParams.get("platform") ?? "telegram";
  const role = searchParams.get("role") ?? "guest";
  const isPro = role === "vip";

  const isFastFood = Boolean(venueId && (orderId || chatId));
  const isFullService = Boolean(venueId && tableId);
  const isValid = isFastFood || isFullService;
  const isDirectAccess = !venueId && !tableId && !orderId;

  const sessionId = useMemo(() => searchParams.get("sessionId") ?? undefined, [searchParams]);

  if (isDirectAccess) {
    return <GuestMainMenu chatId={chatId || undefined} platform={platform} />;
  }

  if (!isValid) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-slate-50">
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
          <p className="text-gray-600">Неверная ссылка. Откройте меню из чата бота.</p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white"
          >
            На главную
          </button>
        </div>
      </main>
    );
  }

  if (isFastFood) {
    if (orderId) {
      return <FastFoodOrderView venueId={venueId} orderId={orderId} chatId={chatId} platform={platform} />;
    }
    return (
      <FastFoodPrimitiveView venueId={venueId} chatId={chatId} platform={platform} />
    );
  }

  const vidFromUrl = searchParams.get("vid") ?? null;
  return (
    <FullServicePanel
      venueId={venueId}
      tableId={tableId}
      sessionId={sessionId}
      chatId={chatId}
      platform={platform}
      isPro={isPro}
      vidFromUrl={vidFromUrl}
    />
  );
}

function FullServicePanel({
  venueId,
  tableId,
  sessionId,
  chatId,
  platform,
  isPro,
  vidFromUrl,
}: {
  venueId: string;
  tableId: string;
  sessionId: string | undefined;
  chatId: string;
  platform: string;
  isPro: boolean;
  vidFromUrl?: string | null;
}) {
  const { visitorId } = useVisitor();
  const checkInDone = useRef(false);
  const effectiveVisitorId = visitorId || vidFromUrl || null;
  useEffect(() => {
    if (checkInDone.current || !venueId || !tableId) return;
    checkInDone.current = true;
    (async () => {
      const q = query(
        collection(db, "activeSessions"),
        where("venueId", "==", venueId),
        where("tableId", "==", tableId),
        where("status", "==", "check_in_success")
      );
      const snap = await getDocs(q);
      if (!snap.empty) return;
      const guestIdentity = chatId
        ? { channel: platform as "telegram", externalId: chatId, locale: "ru" as const }
        : undefined;
      await fetch("/api/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId, tableId, guestIdentity }),
      });
    })();
  }, [venueId, tableId, chatId, platform]);

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-md">
        <DebugPanelTrigger>
          {({ onClick }) => (
            <h1
              className="mb-4 text-lg font-bold text-gray-900 cursor-pointer select-none"
              onClick={onClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onClick()}
            >
              HeyWaiter
            </h1>
          )}
        </DebugPanelTrigger>
        <p className="mb-4 text-sm text-gray-500">
          Стол №{tableId}. Кнопки показываются только если сотрудник на смене.
        </p>
        <GuestCallPanel
          venueId={venueId}
          tableId={tableId}
          sessionId={sessionId}
          visitorId={effectiveVisitorId}
          isPro={isPro}
        />
        <VenueMenuBlock venueId={venueId} />
      </div>
    </main>
  );
}

function VenueMenuBlock({ venueId }: { venueId: string }) {
  const [config, setConfig] = useState<{ menuLink?: string; menuPdfUrl?: string; menuItems?: string[] } | null>(null);
  useEffect(() => {
    getDoc(doc(db, "venues", venueId)).then((snap) => {
      if (snap.exists()) setConfig(snap.data()?.config ?? null);
    });
  }, [venueId]);
  const hasMenu = config && (config.menuLink || config.menuPdfUrl || (config.menuItems?.length ?? 0) > 0);
  if (!hasMenu) return null;
  const menuUrl = config.menuLink || config.menuPdfUrl;
  return (
    <div className="mt-4">
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        {menuUrl ? (
          <a
            href={menuUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 underline"
          >
            📜 Меню
          </a>
        ) : null}
        {config.menuItems?.length && !menuUrl ? (
          <p className="text-sm font-medium text-gray-700">📜 Меню</p>
        ) : null}
        {config.menuItems?.length ? (
          <ul className="mt-1 list-inside list-disc text-sm text-gray-600">
            {config.menuItems.slice(0, 10).map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function FastFoodPrimitiveView({
  venueId,
  chatId,
  platform,
}: {
  venueId: string;
  chatId: string;
  platform: string;
}) {
  const [orderNumber, setOrderNumber] = useState("");
  const [submittedOrderId, setSubmittedOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleWait = async () => {
    const num = orderNumber.trim();
    const n = parseInt(num, 10);
    if (Number.isNaN(n) || n < 1) return;
    setLoading(true);
    try {
      const res = await fetch("/api/guest/wait-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueId,
          orderNumber: n,
          guestChatId: chatId,
          guestPlatform: platform,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; orderId?: string };
      if (data.ok && data.orderId) setSubmittedOrderId(data.orderId);
    } finally {
      setLoading(false);
    }
  };

  if (submittedOrderId) {
    return <FastFoodOrderView venueId={venueId} orderId={submittedOrderId} chatId={chatId} platform={platform} />;
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-md">
        <h1 className="mb-4 text-lg font-bold text-gray-900">HeyWaiter</h1>
        <p className="mb-2 text-sm text-gray-600">Введите номер заказа или чека</p>
        <input
          type="text"
          inputMode="numeric"
          placeholder="Например 45"
          className="w-full rounded-xl border border-gray-300 px-4 py-3 text-lg"
          value={orderNumber}
          onChange={(e) => setOrderNumber(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />
        <button
          type="button"
          disabled={loading || !orderNumber.trim()}
          onClick={handleWait}
          className="mt-3 w-full rounded-xl bg-gray-900 py-3 text-base font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? "…" : "Ждать"}
        </button>
        <VenueMenuBlock venueId={venueId} />
      </div>
    </main>
  );
}

function FastFoodOrderView({
  venueId,
  orderId,
  chatId,
  platform,
}: {
  venueId: string;
  orderId: string;
  chatId?: string;
  platform?: string;
}) {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = doc(db, "orders", orderId);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setOrder({
          id: snap.id,
          orderNumber: data?.orderNumber ?? 0,
          venueId: data?.venueId ?? "",
          guestChatId: data?.guestChatId ?? "",
          guestPlatform: data?.guestPlatform ?? "telegram",
          status: (data?.status as Order["status"]) ?? "pending",
          createdAt: data?.createdAt,
          updatedAt: data?.updatedAt,
        });
      } else {
        setOrder(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [orderId]);

  const statusText =
    order?.status === "ready" || order?.status === "completed"
      ? "Заказ готов! Заберите на выдаче."
      : order
        ? `Готовим ваш заказ №${order.orderNumber}…`
        : "";

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-md">
        <DebugPanelTrigger>
          {({ onClick }) => (
            <h1
              className="mb-4 text-lg font-bold text-gray-900 cursor-pointer select-none"
              onClick={onClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onClick()}
            >
              HeyWaiter
            </h1>
          )}
        </DebugPanelTrigger>
        <p className="mb-2 text-sm text-gray-600">Статус заказа</p>
        {loading ? (
          <p className="text-sm text-gray-500">Загрузка…</p>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-base font-semibold text-gray-900">
              {statusText || "Заказ не найден"}
            </p>
            {order && (
              <p className="mt-1 text-sm text-gray-500">
                Номер заказа: {order.orderNumber}
              </p>
            )}
          </div>
        )}
        <VenueMenuBlock venueId={venueId} />
      </div>
    </main>
  );
}

export default function GuestPanelPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-50">
          <p className="text-gray-500">Загрузка…</p>
        </main>
      }
    >
      <PanelContent />
    </Suspense>
  );
}
