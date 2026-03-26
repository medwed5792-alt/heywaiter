 "use client";

import { Suspense, useRef } from "react";
import { AdSpace } from "@/components/ads/AdSpace";
import { MiniAppIdentifyingFallback } from "@/components/mini-app/MiniAppBotRoleDispatcher";
import { GuestMiniAppStateProvider, useGuestContext } from "@/components/mini-app/GuestMiniAppStateProvider";
import { resolveVenueDisplayName } from "@/lib/venue-display";

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
          <div className="mt-3">
            <AdSpace placement="dashboard_top" />
          </div>
        </header>

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
  const { currentLocation, callWaiter, requestBill } = useGuestContext();
  const reasonRef = useRef<"menu" | "bill" | "help">("help");
  const canAct = Boolean(currentLocation.venueId && currentLocation.tableId);

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
              disabled={!canAct}
              onClick={() => void requestBill("full")}
              className="w-full bg-green-600 py-4 rounded-xl font-bold text-lg text-white hover:bg-green-700 disabled:opacity-50 disabled:pointer-events-none"
            >
              Оплатить всё
            </button>
          </div>
        </section>
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
