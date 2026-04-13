"use client";

import { Suspense, useEffect, useMemo, useState, useCallback } from "react";
import { AdSpace } from "@/components/common/AdSpace";
import { MiniAppIdentifyingFallback } from "@/components/mini-app/MiniAppBotRoleDispatcher";
import { GuestMiniAppStateProvider, useGuestContext } from "@/components/mini-app/GuestMiniAppStateProvider";
import { GuestSessionGeoWatch } from "@/components/mini-app/GuestSessionGeoWatch";
import { SotaLocationProvider, useSotaLocation } from "@/components/providers/SotaLocationProvider";
import { resolveVenueDisplayName } from "@/lib/venue-display";
import { resolveGuestDisplayName } from "@/lib/identity/guest-display";
import { GuestCabinetPreOrderPanel } from "@/components/mini-app/GuestCabinetPreOrderPanel";
import { GuestTableMenuGateway } from "@/components/mini-app/GuestTableMenuGateway";
import { GuestFeedbackStars } from "@/components/mini-app/GuestFeedbackStars";
import { GuestProfileSettings } from "@/components/mini-app/GuestProfileSettings";
import { guestCustomerUidsMatch } from "@/lib/identity/customer-uid";

type GuestTab = "service" | "cabinet" | "profile";

function GuestLandingTabs({
  tab,
  onTab,
}: {
  tab: GuestTab;
  onTab: (t: GuestTab) => void;
}) {
  return (
    <nav className="rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
      <div className="grid grid-cols-3 gap-1">
        <button
          type="button"
          onClick={() => onTab("service")}
          className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-colors ${
            tab === "service" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          <span className={`inline-flex h-2 w-2 rounded-full ${tab === "service" ? "bg-emerald-400" : "bg-slate-300"}`} />
          Сервис
        </button>
        <button
          type="button"
          onClick={() => onTab("cabinet")}
          className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-colors ${
            tab === "cabinet" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          <span className={`inline-flex h-2 w-2 rounded-full ${tab === "cabinet" ? "bg-slate-200" : "bg-slate-300"}`} />
          Кабинет
        </button>
        <button
          type="button"
          onClick={() => onTab("profile")}
          className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-colors ${
            tab === "profile" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          <span className={`inline-flex h-2 w-2 rounded-full ${tab === "profile" ? "bg-blue-400" : "bg-slate-300"}`} />
          Профиль
        </button>
      </div>
    </nav>
  );
}

function GuestNearbyEstablishments() {
  const { visitHistory, openVenueMenu } = useGuestContext();
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
  );
}

function GuestServiceTabContent() {
  const { openTableScanner } = useGuestContext();

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={openTableScanner}
          className="w-full rounded-xl bg-slate-900 py-4 text-base font-semibold text-white hover:bg-slate-800"
        >
          Сканер QR
        </button>
        <p className="mt-2 text-center text-xs text-slate-500">
          Сканер открывает стол и переключает в режим управления. Если у заведения настроена геозона — нужны GPS и нахождение в радиусе (как у персонала).
        </p>
      </section>
    </div>
  );
}

function GuestSession() {
  const {
    currentLocation,
    guestIdentity,
    guestProfileUid,
    globalGuestUid,
    activeSession,
    participants,
    currentTableOrders,
    callWaiter,
    requestBill,
    setTablePrivacyAllowJoin,
    guestAwaitingTableFeedback,
  } = useGuestContext();
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [privacyBusy, setPrivacyBusy] = useState(false);

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

  const onPrivacyToggle = useCallback(
    async (allowJoin: boolean) => {
      setPrivacyBusy(true);
      try {
        await setTablePrivacyAllowJoin(allowJoin);
      } finally {
        setPrivacyBusy(false);
      }
    },
    [setTablePrivacyAllowJoin]
  );

  const canAct = Boolean(currentLocation.venueId && currentLocation.tableId);
  const sessionConfirmed = Boolean(activeSession?.id);
  const sessionActionsEnabled = canAct && sessionConfirmed && !guestAwaitingTableFeedback;
  const currentUid = guestIdentity.currentUid ?? "";
  const profileUid = (globalGuestUid?.trim() || guestProfileUid?.trim() || "") || "";
  const isMaster = Boolean(
    activeSession?.masterId &&
      profileUid &&
      guestCustomerUidsMatch(activeSession.masterId, profileUid)
  );
  const isPrivate = activeSession?.isPrivate === true;
  const ordersHidden = isPrivate && !isMaster;
  const venueIdForMenu = currentLocation.venueId?.trim() ?? "";

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-center text-lg font-bold text-slate-900">Гостевая сессия</p>
        <p className="mt-2 text-center text-sm text-slate-600">
          {currentLocation.venueId ? `Заведение: ${resolveVenueDisplayName(currentLocation.venueId)}` : "Загрузка заведения"}
        </p>
        <p className="mt-2 text-center text-sm text-slate-600">
          {activeSession && activeSession.tableNumber > 0
            ? `Стол №${activeSession.tableNumber}`
            : currentLocation.tableId
              ? `Стол: ${currentLocation.tableId}`
              : "Стол не определен"}
        </p>
        {!activeSession ? (
          <p className="mt-2 text-center text-xs text-amber-800">Подключение к сессии… если долго, откройте приложение по QR стола ещё раз.</p>
        ) : null}
        {guestAwaitingTableFeedback ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-sm text-amber-950">
            Заведение завершило визит. Откройте форму отзыва ниже — меню недоступно до завершения.
          </p>
        ) : null}
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Кто за столом</p>

        <div className="mt-3 flex max-w-full flex-nowrap gap-2 overflow-x-auto pb-1">
          {participants.map((p) => {
            const initial = p.uid.replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase() || "G";
            const displayName = resolveGuestDisplayName({
              uid: p.uid,
              currentUid: profileUid || currentUid || undefined,
            });
            const isMe = Boolean(
              profileUid && guestCustomerUidsMatch(p.uid, profileUid)
            );
            const isOwner = Boolean(
              activeSession?.masterId && guestCustomerUidsMatch(p.uid, activeSession.masterId)
            );

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

          {participants.length === 0 && <p className="mt-1 text-xs text-slate-500">Загрузка участников…</p>}
        </div>

        {isPrivate && !isMaster && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Приватный стол. Заказы скрыты Хозяином.
            </div>
          )}
        </section>

        {!guestAwaitingTableFeedback && venueIdForMenu ? (
          <GuestTableMenuGateway venueFirestoreId={venueIdForMenu} disabled={!canAct} />
        ) : null}

        {isMaster && activeSession && !guestAwaitingTableFeedback ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Мастер стола</p>
            <label className="mt-3 flex cursor-pointer items-center justify-between gap-3">
              <span className="text-sm text-slate-800">Разрешить подселение без QR</span>
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 accent-emerald-600"
                checked={activeSession.isPrivate === false}
                disabled={privacyBusy}
                onChange={(e) => void onPrivacyToggle(e.target.checked)}
              />
            </label>
            <p className="mt-2 text-[11px] text-slate-500">
              Выключено — к столу по QR не подсесть без вашего разрешения (приватный стол).
            </p>
          </section>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900">Заказы</p>
          <button
            type="button"
            disabled={!sessionActionsEnabled}
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
          <button
            type="button"
            disabled={!sessionActionsEnabled}
            onClick={() => void callWaiter()}
            className="w-full bg-yellow-500 py-4 rounded-xl font-bold text-lg text-black hover:bg-yellow-600 disabled:opacity-50 disabled:pointer-events-none"
          >
            Позвать официанта
          </button>

          <button
            type="button"
            disabled={!sessionActionsEnabled}
            onClick={() => void requestBill("split")}
            className="w-full bg-blue-600 py-4 rounded-xl font-bold text-lg text-white hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none"
          >
            Раздельный счет
          </button>

          <button
            type="button"
            disabled={!sessionActionsEnabled || !isMaster}
            title={isMaster ? "" : "Оплата доступна только Хозяину стола"}
            onClick={() => void requestBill("full")}
            className={`w-full py-4 rounded-xl font-bold text-lg text-white disabled:opacity-50 disabled:pointer-events-none ${
              !isMaster ? "bg-slate-300 text-slate-600 hover:bg-slate-300" : "bg-green-600 hover:bg-green-700"
            }`}
          >
            Оплатить всё
          </button>

          {!isMaster && (
            <p className="text-center text-[11px] text-slate-500">Оплата доступна только Хозяину стола</p>
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

/** Стабильный экран до прихода activeSessions — без переключения welcome/сервис. */
function GuestTableConnectingLoader() {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <div
        className="h-10 w-10 rounded-full border-2 border-slate-200 border-t-slate-800 motion-reduce:animate-none animate-spin"
        aria-hidden
      />
      <p className="text-center text-sm font-medium text-slate-800">Подключение к столу…</p>
      <p className="max-w-xs text-center text-xs text-slate-500">Сессия подтверждается системой. Экран обновится сам.</p>
    </div>
  );
}

/** Ступень 2: стол уже закрыт на сервере, активной сессии нет — только отзыв/чаевые по архиву. */
function GuestPostServicePlaceholder() {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/80 p-6 shadow-sm">
      <p className="text-center text-base font-semibold text-emerald-950">Визит завершён</p>
      <p className="max-w-sm text-center text-sm text-emerald-900">
        Заведение освободило стол. Оцените визит и при желании отправьте чаевые — форма открыта поверх экрана.
      </p>
    </div>
  );
}

function GuestCabinet() {
  const {
    guestIdentity,
    guestProfileUid,
    globalGuestUid,
    visitHistory,
    openVenueMenu,
    isVenuePreOrderEnabled,
    getVenueRegistrySotaId,
    getPreorderSubmissionGate,
    getPreorderMaxCartItems,
    getVenueTimeZone,
    getVenueMenuCatalog,
    getVenueMenuPdfUrl,
  } = useGuestContext();

  const preorderVenues = useMemo(
    () => visitHistory.filter((v) => isVenuePreOrderEnabled(v.venueId)),
    [visitHistory, isVenuePreOrderEnabled]
  );

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-center text-lg font-bold text-slate-900">Кабинет</p>
        <p className="mt-2 text-center text-sm text-slate-600">Профиль и история посещений</p>
      </header>

      {preorderVenues.length > 0 ? (
        <div className="space-y-4">
          <p className="text-center text-xs font-semibold uppercase tracking-wide text-slate-500">Предзаказ до визита</p>
          {preorderVenues.map((v) => {
            const gate = getPreorderSubmissionGate(v.venueId);
            return (
              <GuestCabinetPreOrderPanel
                key={v.venueId}
                venueFirestoreId={v.venueId}
                venueTitle={resolveVenueDisplayName(v.venueId)}
                registrySotaId={getVenueRegistrySotaId(v.venueId)}
                venueTimeZone={getVenueTimeZone(v.venueId)}
                customerUid={guestProfileUid ?? guestIdentity.currentUid}
                enabled
                maxCartItems={getPreorderMaxCartItems(v.venueId)}
                submissionAllowed={gate.ok}
                submissionBlockedReason={gate.reason}
                menuCatalog={getVenueMenuCatalog(v.venueId)}
                menuPdfUrl={getVenueMenuPdfUrl(v.venueId)}
              />
            );
          })}
        </div>
      ) : null}

      <GuestNearbyEstablishments />

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Профиль</p>
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-600">UID</span>
            <span className="text-sm font-mono text-slate-900">
              {globalGuestUid ?? guestIdentity.currentUid ?? "—"}
            </span>
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
  const {
    isInitializing,
    isGuestBlocked,
    guestBlockedReason,
    currentLocation,
    activeSession,
    systemConfig,
    guestAwaitingTableFeedback,
    postServiceVisit,
    completeTableFeedbackSession,
    feedbackTargetStaffId,
    guestIdentity,
    globalGuestUid,
    guestProfileUid,
    showLandingScanner,
  } = useGuestContext();
  const [tab, setTab] = useState<GuestTab>("service");

  useEffect(() => {
    if (guestAwaitingTableFeedback) setTab("cabinet");
  }, [guestAwaitingTableFeedback]);

  if (isInitializing) return <Loading />;

  if (systemConfig.globalMaintenanceMode) {
    return (
      <main className="min-h-screen bg-slate-950 p-4 pb-10 md:p-6">
        <div className="mx-auto mt-24 max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
          <p className="text-center text-lg font-semibold text-white">SOTA обновляется. Мы скоро вернемся!</p>
          <p className="mt-2 text-center text-sm text-slate-300">Идут технические работы. Спасибо за терпение.</p>
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

  /** Стол из QR/ссылки: показываем сценарий «за столом» даже пока Firestore ещё не отдал activeSessions. */
  const guestAtTable = Boolean(currentLocation.venueId?.trim() && currentLocation.tableId?.trim());
  const tableSessionLoading =
    guestAtTable && !activeSession && !guestAwaitingTableFeedback;
  const feedbackVisitId = postServiceVisit?.visitId ?? activeSession?.id ?? "";
  const feedbackVenueId = (postServiceVisit?.venueId ?? currentLocation.venueId ?? "").trim();
  const feedbackTableId = (postServiceVisit?.tableId ?? currentLocation.tableId ?? "").trim();
  /** Решение о fallback-сканере приходит только от server-bootstrap. */
  const showLandingQrScanner = !guestAtTable && showLandingScanner;
  const venueLabel = currentLocation.venueId ? resolveVenueDisplayName(currentLocation.venueId) : "";
  const tableLabel =
    activeSession && activeSession.tableNumber > 0
      ? String(activeSession.tableNumber)
      : (currentLocation.tableId ?? "");

  return (
    <>
      <div className="min-h-screen bg-slate-50 md:mx-auto md:max-w-2xl md:shadow-lg" style={{ zoom: 0.75 }}>
        <main className="flex-1 p-4 pb-10 md:p-6">
          {guestAtTable && activeSession && !guestAwaitingTableFeedback ? (
            <GuestSessionGeoWatch key={activeSession.id} />
          ) : null}
          <div className="space-y-5">
          {!guestAtTable ? (
            <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-center text-lg font-bold text-slate-900">Вас приветствует сервис HeyWaiter</p>
              <p className="mt-2 text-center text-sm text-slate-600">
                Откройте стол по QR‑коду или зайдите в кабинет и выберите заведение рядом.
              </p>
            </header>
          ) : (
            <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-center text-sm font-semibold text-slate-900">Вы за столом</p>
              <p className="mt-1 text-center text-xs text-slate-600">
                {venueLabel ? `${venueLabel}` : "Заведение"}
                {tableLabel ? ` · стол №${tableLabel}` : ""}
              </p>
            </header>
          )}

          <GuestLandingTabs tab={tab} onTab={setTab} />

          {guestAtTable ? (
            tab === "service" ? (
              guestAwaitingTableFeedback ? (
                <GuestPostServicePlaceholder />
              ) : tableSessionLoading ? (
                <GuestTableConnectingLoader />
              ) : (
                <GuestSession />
              )
            ) : tab === "profile" ? (
              <GuestProfileSettings />
            ) : (
              <GuestCabinet />
            )
          ) : tab === "service" ? (
            showLandingQrScanner ? (
              <GuestServiceTabContent />
            ) : (
              <GuestTableConnectingLoader />
            )
          ) : tab === "profile" ? (
            <GuestProfileSettings />
          ) : (
            <GuestCabinet />
          )}
          </div>
        </main>
      </div>

      {guestAwaitingTableFeedback &&
      feedbackVisitId &&
      feedbackVenueId &&
      feedbackTableId &&
      (globalGuestUid?.trim() || guestProfileUid?.trim()) ? (
        <GuestFeedbackStars
          walletStaffId={feedbackTargetStaffId}
          venueId={feedbackVenueId}
          tableId={feedbackTableId}
          customerUid={(globalGuestUid?.trim() || guestProfileUid!.trim())}
          activeSessionId={feedbackVisitId}
          tipsSessionId={postServiceVisit?.feedbackActSessionId}
          title="Отзыв и чаевые"
          subtitle="Спасибо за визит. Оценка и чаевые сохраняются в завершённом визите и не занимают стол."
          onFinalize={() => void completeTableFeedbackSession()}
        />
      ) : null}
    </>
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
