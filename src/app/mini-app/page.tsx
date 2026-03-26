 "use client";

import { Suspense, useMemo, useRef, useState } from "react";
import { AdSpace } from "@/components/common/AdSpace";
import { MiniAppIdentifyingFallback } from "@/components/mini-app/MiniAppBotRoleDispatcher";
import { GuestMiniAppStateProvider, useGuestContext } from "@/components/mini-app/GuestMiniAppStateProvider";
import { resolveVenueDisplayName } from "@/lib/venue-display";
import { resolveGuestDisplayName } from "@/lib/identity/guest-display";

function GuestDashboard() {
  const { visitHistory, openVenueMenu, openTableScanner } = useGuestContext();
  return (
    <main className="min-h-screen bg-slate-50 p-4 pb-10 md:p-6" style={{ zoom: 0.75 }}>
      <div className="mx-auto flex max-w-md flex-col gap-5">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-center text-lg font-bold text-slate-900">Добро пожаловать</p>
          <p className="mt-2 text-center text-sm text-slate-600">
            Вы в режиме без стола. Последние визиты помогут быстро открыть заведение.
          </p>
        </header>

        <div className="mt-3">
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
            {visitHistory.length === 0 && (
              <p className="text-xs text-slate-500 mt-2">Пока нет визитов. Откройте сканер.</p>
            )}
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={openTableScanner}
              className="w-full rounded-xl bg-slate-900 py-3.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Сканер
            </button>
          </div>
        </section>
      </div>
    </main>
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
    <main className="min-h-screen bg-slate-50 p-4 pb-10 md:p-6" style={{ zoom: 0.75 }}>
      <div className="mx-auto flex max-w-md flex-col gap-5">
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
    </main>
  );
}

function Loading() {
  return <MiniAppIdentifyingFallback />;
}

function MiniAppScreenRouter() {
  const { isInitializing, isGuestBlocked, guestBlockedReason, currentLocation } = useGuestContext();

  if (isInitializing) return <Loading />;

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

  if (currentLocation.venueId && currentLocation.tableId) return <GuestSession />;
  return <GuestDashboard />;
}

export default function MiniAppPage() {
  return (
    <Suspense fallback={<MiniAppIdentifyingFallback />}>
      <GuestMiniAppStateProvider>
        <MiniAppScreenRouter />
      </GuestMiniAppStateProvider>
    </Suspense>
  );
}
