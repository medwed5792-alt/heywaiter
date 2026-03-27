"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AdSpace } from "@/components/common/AdSpace";
import { MiniAppIdentifyingFallback } from "@/components/mini-app/MiniAppBotRoleDispatcher";
import { GuestMiniAppStateProvider, useGuestContext } from "@/components/mini-app/GuestMiniAppStateProvider";
import { SotaLocationProvider, useSotaLocation } from "@/components/providers/SotaLocationProvider";
import { resolveVenueDisplayName } from "@/lib/venue-display";
import { resolveGuestDisplayName } from "@/lib/identity/guest-display";

type GuestTab = "service" | "cabinet";

function BottomTabs({
  tab,
  onTab,
}: {
  tab: GuestTab;
  onTab: (t: GuestTab) => void;
}) {
  return (
    <nav className="sticky bottom-0 z-10 border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-md">
        <button
          type="button"
          onClick={() => onTab("service")}
          className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors ${
            tab === "service"
              ? "text-emerald-700 bg-emerald-50/50"
              : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          <span className={`inline-flex h-2 w-2 rounded-full ${tab === "service" ? "bg-emerald-600" : "bg-slate-300"}`} />
          Сервис
        </button>
        <button
          type="button"
          onClick={() => onTab("cabinet")}
          className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors ${
            tab === "cabinet"
              ? "text-slate-900 bg-slate-50"
              : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          <span className={`inline-flex h-2 w-2 rounded-full ${tab === "cabinet" ? "bg-slate-800" : "bg-slate-300"}`} />
          Кабинет
        </button>
      </div>
    </nav>
  );
}

function GuestServiceSearchMode() {
  const { visitHistory, openVenueMenu, openTableScanner } = useGuestContext();
  const { requestLocation, getVenueDistance } = useSotaLocation();
  const [distanceByVenue, setDistanceByVenue] = useState<
    Record<string, { distanceMeters: number | null; isNear: boolean }>
  >({});

  useEffect(() => {
    void requestLocation();
  }, [requestLocation]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, { distanceMeters: number | null; isNear: boolean }> = {};
      for (const v of visitHistory) {
        const dist = await getVenueDistance(v.venueId);
        next[v.venueId] = { distanceMeters: dist.distanceMeters, isNear: dist.isNear };
      }
      if (!cancelled) setDistanceByVenue(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [visitHistory, getVenueDistance]);

  const rankedVisits = useMemo(() => {
    return [...visitHistory].sort((a, b) => {
      const da = distanceByVenue[a.venueId];
      const db = distanceByVenue[b.venueId];
      const aNear = da?.isNear ? 1 : 0;
      const bNear = db?.isNear ? 1 : 0;
      if (aNear !== bNear) return bNear - aNear;
      const aDist = da?.distanceMeters;
      const bDist = db?.distanceMeters;
      if (aDist != null && bDist != null) return aDist - bDist;
      if (aDist != null) return -1;
      if (bDist != null) return 1;
      return 0;
    });
  }, [visitHistory, distanceByVenue]);

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-center text-lg font-bold text-slate-900">Сервис</p>
        <p className="mt-2 text-center text-sm text-slate-600">Откройте стол по QR‑коду или выберите заведение рядом.</p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={openTableScanner}
          className="w-full rounded-xl bg-slate-900 py-4 text-base font-semibold text-white hover:bg-slate-800"
        >
          Сканер QR
        </button>
        <p className="mt-2 text-center text-xs text-slate-500">Сканер открывает стол и переключает в режим управления.</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Ближайшие заведения</p>
        <p className="mt-1 text-xs text-slate-600">Из ваших мест, отсортировано по расстоянию</p>

        <div className="mt-3 flex flex-col gap-2">
          {rankedVisits.map((v) => (
            <button
              key={v.venueId}
              type="button"
              onClick={() => openVenueMenu(v.venueId)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-white"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate">{resolveVenueDisplayName(v.venueId)}</span>
                {distanceByVenue[v.venueId]?.isNear ? (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                    Рядом с вами
                  </span>
                ) : null}
              </span>
            </button>
          ))}
          {visitHistory.length === 0 && <p className="mt-2 text-xs text-slate-500">Пока нет истории мест.</p>}
        </div>
      </section>
    </div>
  );
}

function GuestSession() {
  const { currentLocation, guestIdentity, activeSession, participants, currentTableOrders, callWaiter, requestBill } =
    useGuestContext();
  const reasonRef = useRef<"menu" | "bill" | "help">("help");
  const [ordersOpen, setOrdersOpen] = useState(false);

  const canAct = Boolean(currentLocation.venueId && currentLocation.tableId);
  const currentUid = guestIdentity.currentUid ?? "";
  const isMaster = Boolean(activeSession?.masterId && currentUid && activeSession.masterId === currentUid);
  const isPrivate = activeSession?.isPrivate === true;
  const ordersHidden = isPrivate && !isMaster;

  const orderLines = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; totalAmount: number }>();

    for (const o of currentTableOrders) {
      for (const it of o.items) {
        const key = it.name;
        const prev = map.get(key);
        const next = prev
          ? { name: it.name, qty: prev.qty + it.qty, totalAmount: prev.totalAmount + it.totalAmount }
          : { name: it.name, qty: it.qty, totalAmount: it.totalAmount };
        map.set(key, next);
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [currentTableOrders]);

  const grandTotal = useMemo(() => {
    return orderLines.reduce((acc, l) => acc + l.totalAmount, 0);
  }, [orderLines]);

  return (
    <div className="space-y-5">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-center text-lg font-bold text-slate-900">Гостевая сессия</p>
          <p className="mt-2 text-center text-sm text-slate-600">
            {currentLocation.venueId ? `Заведение: ${resolveVenueDisplayName(currentLocation.venueId)}` : "Загрузка заведения"}
          </p>
          <p className="mt-2 text-center text-sm text-slate-600">
            {currentLocation.tableId ? `Стол: ${currentLocation.tableId}` : "Стол не определен"}
          </p>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Кто за столом</p>

          <div className="mt-3 flex max-w-full flex-nowrap gap-2 overflow-x-auto pb-1">
            {participants.map((p) => {
              const initial =
                p.uid.replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase() || "G";
              const displayName = resolveGuestDisplayName({
                uid: p.uid,
                currentUid: currentUid || undefined,
              });
              const isMe = Boolean(currentUid && p.uid === currentUid);
              const isOwner = Boolean(activeSession?.masterId && p.uid === activeSession.masterId);

              return (
                <div
                  key={p.uid}
                  className="flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700">
                    {initial}
                  </span>

                  <div className="flex items-center gap-1">
                    <span
                      className={`max-w-[130px] truncate text-xs font-medium text-slate-700 ${
                        p.status === "exited" ? "text-slate-400 line-through" : ""
                      }`}
                    >
                      {displayName}
                    </span>
                    {isOwner && <span title="Хозяин">👑</span>}
                    {isMe && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                        Вы
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {participants.length === 0 && (
              <p className="text-xs text-slate-500 mt-1">Загрузка участников…</p>
            )}
          </div>

          {isPrivate && !isMaster && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Приватный стол. Заказы скрыты Хозяином.
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900">Заказы</p>
            <button
              type="button"
              disabled={!canAct}
              onClick={() => setOrdersOpen((v) => !v)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white disabled:opacity-50"
            >
              {ordersOpen ? "Скрыть" : "Показать"}
            </button>
          </div>

          {ordersOpen && (
            <>
              {ordersHidden ? (
                <p className="mt-3 text-sm text-amber-900">Заказы скрыты Хозяином.</p>
              ) : (
                <>
                  {orderLines.length === 0 ? (
                    <p className="mt-3 text-xs text-slate-500">Пока нет заказов.</p>
                  ) : (
                    <div className="mt-3 flex flex-col gap-2">
                      {orderLines.map((l) => (
                        <div key={l.name} className="flex items-center justify-between gap-3 text-sm">
                          <span className="truncate text-slate-700">{l.name}</span>
                          <span className="shrink-0 text-slate-500">{l.qty} шт.</span>
                          <span className="shrink-0 font-bold text-slate-900">{Math.round(l.totalAmount)} руб.</span>
                        </div>
                      ))}
                      <p className="mt-2 text-right text-base font-bold text-slate-900">
                        Итого: {Math.round(grandTotal)} руб.
                      </p>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Причина вызова</label>
              <select
                defaultValue="help"
                onChange={(e) => {
                  reasonRef.current = e.target.value as "menu" | "bill" | "help";
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium text-slate-800"
                disabled={!canAct}
              >
                <option value="help">Помощь</option>
                <option value="menu">Меню</option>
                <option value="bill">Счёт</option>
              </select>
            </div>

            <button
              type="button"
              disabled={!canAct}
              onClick={() => void callWaiter(reasonRef.current)}
              className="w-full bg-yellow-500 py-4 rounded-xl font-bold text-lg text-black hover:bg-yellow-600 disabled:opacity-50 disabled:pointer-events-none"
            >
              Вызвать официанта
            </button>

            <button
              type="button"
              disabled={!canAct}
              onClick={() => void requestBill("split")}
              className="w-full bg-blue-600 py-4 rounded-xl font-bold text-lg text-white hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none"
            >
              Раздельный счет
            </button>

            <button
              type="button"
              disabled={!canAct || !isMaster}
              title={isMaster ? "" : "Оплата доступна только Хозяину стола"}
              onClick={() => void requestBill("full")}
              className={`w-full py-4 rounded-xl font-bold text-lg text-white disabled:opacity-50 disabled:pointer-events-none ${
                !isMaster ? "bg-slate-300 text-slate-600 hover:bg-slate-300" : "bg-green-600 hover:bg-green-700"
              }`}
            >
              Оплатить всё
            </button>

            {!isMaster && (
              <p className="text-center text-[11px] text-slate-500">
                Оплата доступна только Хозяину стола
              </p>
            )}
          </div>
        </section>

        <div className="mt-3">
          <AdSpace placementId="guest_session_footer" />
        </div>
    </div>
  );
}

function Loading() {
  return <MiniAppIdentifyingFallback />;
}

function GuestCabinet() {
  const { guestIdentity, visitHistory, openVenueMenu } = useGuestContext();

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-center text-lg font-bold text-slate-900">Кабинет</p>
        <p className="mt-2 text-center text-sm text-slate-600">Профиль и история посещений</p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Профиль</p>
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-600">UID</span>
            <span className="text-sm font-mono text-slate-900">{guestIdentity.currentUid ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-600">Telegram</span>
            <span className="text-sm font-mono text-slate-900">{guestIdentity.telegramUid ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-600">SOTA</span>
            <span className="text-sm font-mono text-slate-900">{guestIdentity.sotaId ?? "—"}</span>
          </div>
        </div>
      </section>

      <div className="mt-1">
        <AdSpace placementId="guest_dashboard_top" />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Мои места</p>
        <p className="mt-1 text-xs text-slate-600">Топ-5 последних заведений</p>
        <div className="mt-3 flex flex-col gap-2">
          {visitHistory.map((v) => (
            <button
              key={v.venueId}
              type="button"
              onClick={() => openVenueMenu(v.venueId)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-white"
            >
              {resolveVenueDisplayName(v.venueId)}
            </button>
          ))}
          {visitHistory.length === 0 && <p className="mt-2 text-xs text-slate-500">Пока нет визитов.</p>}
        </div>
      </section>
    </div>
  );
}

function MiniAppScreenRouter() {
  const { isInitializing, isGuestBlocked, guestBlockedReason, currentLocation, activeSession, systemConfig } = useGuestContext();
  const [tab, setTab] = useState<GuestTab>("service");

  // Force "Service" tab when app is opened by QR / session exists.
  useEffect(() => {
    if (currentLocation?.tableId || activeSession) {
      setTab("service");
    }
  }, [currentLocation?.tableId, activeSession]);

  if (isInitializing) return <Loading />;

  if (systemConfig.globalMaintenanceMode) {
    return (
      <main className="min-h-screen bg-slate-950 p-4 pb-10 md:p-6">
        <div className="mx-auto mt-24 max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
          <p className="text-center text-lg font-semibold text-white">SOTA обновляется. Мы скоро вернемся!</p>
          <p className="mt-2 text-center text-sm text-slate-300">
            Идут технические работы. Спасибо за терпение.
          </p>
        </div>
      </main>
    );
  }

  if (isGuestBlocked) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 pb-10 md:p-6">
        <div className="mx-auto max-w-md rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
          <p className="text-base font-semibold text-red-700">Гостевой режим заблокирован</p>
          <p className="mt-2 text-sm text-slate-700">{guestBlockedReason ?? "Недоступно в текущем боте."}</p>
        </div>
      </main>
    );
  }

  const inSession = Boolean(currentLocation.venueId && currentLocation.tableId && activeSession);

  return (
    <div className="min-h-screen bg-slate-50 md:flex md:max-w-2xl md:mx-auto md:shadow-lg" style={{ zoom: 0.75 }}>
      <main className="flex-1 p-4 pb-24 md:p-6">
        {tab === "service" ? (inSession ? <GuestSession /> : <GuestServiceSearchMode />) : <GuestCabinet />}
      </main>
      <BottomTabs tab={tab} onTab={setTab} />
    </div>
  );
}

export default function MiniAppGuestPageClient() {
  return (
    <Suspense fallback={<MiniAppIdentifyingFallback />}>
      <SotaLocationProvider>
        <GuestMiniAppStateProvider>
          <MiniAppScreenRouter />
        </GuestMiniAppStateProvider>
      </SotaLocationProvider>
    </Suspense>
  );
}
