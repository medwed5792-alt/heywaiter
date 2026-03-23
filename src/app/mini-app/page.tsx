"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, Suspense, useMemo, useRef } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { resolveVenueDisplayName, resolveTableNumberFromDoc } from "@/lib/venue-display";
import { parseStartParamPayload } from "@/lib/parse-start-param";
import { useVisitor } from "@/components/providers/VisitorProvider";
import { createGuestEvent, getWaiterIdFromTableDoc } from "@/lib/guest-events";
import { CALL_WAITER_COOLDOWN_MS } from "@/lib/constants";
import { Bell, QrCode } from "lucide-react";
import toast from "react-hot-toast";

const STAFF_BOT_USERNAME = "waitertalk_bot";

type TelegramWebAppInit = {
  initData?: string;
  initDataUnsafe?: {
    start_param?: string;
    user?: { id?: number };
    receiver?: { username?: string };
  };
  ready?: () => void;
  showScanQrPopup?: (params: { text?: string }, callback: (text: string) => void) => void;
  close?: () => void;
};

function isTelegramContext(): boolean {
  if (typeof window === "undefined") return false;
  const tg = window.Telegram?.WebApp as TelegramWebAppInit | undefined;
  if (!tg) return false;
  const initData = typeof tg.initData === "string" ? tg.initData.trim() : "";
  return initData.length > 0;
}

function getStartParamFromTelegramWebApp(): string {
  if (typeof window === "undefined") return "";
  const WebApp = window.Telegram?.WebApp as TelegramWebAppInit | undefined;
  return WebApp?.initDataUnsafe?.start_param?.trim() ?? "";
}

function isStaffBotContext(): boolean {
  if (typeof window === "undefined") return false;
  const tg = window.Telegram?.WebApp as TelegramWebAppInit | undefined;
  const username = tg?.initDataUnsafe?.receiver?.username ?? "";
  return username === STAFF_BOT_USERNAME;
}

function MiniAppContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { visitorId } = useVisitor();
  const [venueId, setVenueId] = useState<string>("");
  const [tableId, setTableId] = useState<string>("");
  const [venueSettings, setVenueSettings] = useState<Record<string, unknown> | null>(null);
  const [tableSettings, setTableSettings] = useState<Record<string, unknown> | null>(null);
  const [staffName, setStaffName] = useState<string | null>(null);
  const [entryRouteResolved, setEntryRouteResolved] = useState(false);
  const [isSdkReady, setIsSdkReady] = useState(false);
  const [firestoreDone, setFirestoreDone] = useState(false);
  const [forceStaffByBot, setForceStaffByBot] = useState(false);
  const [callLoading, setCallLoading] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [sessionState, setSessionState] = useState<{
    sessionId: string;
    masterId: string;
    isPrivate: boolean;
    participants: { uid: string; status: "active" | "paid" | "exited" }[];
  } | null>(null);
  const [sessionUiError, setSessionUiError] = useState<string | null>(null);
  const [sessionActionLoading, setSessionActionLoading] = useState(false);
  const checkInSyncRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const tg = window.Telegram?.WebApp as TelegramWebAppInit | undefined;
    if (!tg) {
      setIsSdkReady(true);
      return;
    }
    tg.ready?.();
    queueMicrotask(() => setIsSdkReady(true));
  }, []);

  useEffect(() => {
    if (isStaffBotContext()) {
      setForceStaffByBot(true);
      router.replace("/mini-app/staff?v=current");
    }
  }, [router]);

  useEffect(() => {
    if (!isSdkReady) return;

    const role = searchParams.get("role") ?? "";
    const bot = searchParams.get("bot") ?? "";
    const fromQueryT = (searchParams.get("t") ?? "").trim();
    const isStaffByUrl = (bot === "staff" || role === "staff") && !fromQueryT;
    const isStaffEntry = isStaffByUrl || forceStaffByBot;

    if (isStaffEntry) {
      setFirestoreDone(true);
      setEntryRouteResolved(true);
      return;
    }

    const inTg = isTelegramContext();

    if (inTg) {
      const sp = getStartParamFromTelegramWebApp();
      if (sp) {
        const p = parseStartParamPayload(sp);
        if (p) {
          setVenueId(p.venueId);
          setTableId(p.tableId);
          setVenueSettings(null);
          setTableSettings(null);
          setStaffName(null);
          setFirestoreDone(false);
          setEntryRouteResolved(true);
          return;
        }
      }
      setVenueId("");
      setTableId("");
      setFirestoreDone(true);
      setEntryRouteResolved(true);
      return;
    }

    const fromQueryV = (searchParams.get("v") ?? "").trim();
    const fromQueryTNonTg = (searchParams.get("t") ?? "").trim();
    if (fromQueryV && fromQueryTNonTg) {
      setVenueId(fromQueryV);
      setTableId(fromQueryTNonTg);
      setVenueSettings(null);
      setTableSettings(null);
      setStaffName(null);
      setFirestoreDone(false);
      setEntryRouteResolved(true);
      return;
    }

    setVenueId("");
    setTableId("");
    setFirestoreDone(true);
    setEntryRouteResolved(true);
  }, [isSdkReady, searchParams, forceStaffByBot]);

  useEffect(() => {
    if (!venueId || !tableId) {
      setVenueSettings(null);
      setTableSettings(null);
      setStaffName(null);
      setFirestoreDone(true);
      return;
    }
    setVenueSettings(null);
    setTableSettings(null);
    setStaffName(null);
    let cancelled = false;
    (async () => {
      try {
        const venueSnap = await getDoc(doc(db, "venues", venueId));
        if (cancelled) return;
        if (venueSnap.exists()) {
          setVenueSettings(venueSnap.data() as Record<string, unknown>);
        }
        const nested = await getDoc(doc(db, "venues", venueId, "tables", tableId));
        if (cancelled) return;
        if (!nested.exists()) {
          setTableSettings(null);
          setStaffName(null);
          return;
        }
        const tableData = nested.data() as Record<string, unknown>;
        setTableSettings(tableData);
        const wid = getWaiterIdFromTableDoc(tableData);
        if (wid) {
          const staffSnap = await getDoc(doc(db, "staff", wid));
          if (!cancelled && staffSnap.exists()) {
            const sd = staffSnap.data() ?? {};
            const n =
              (typeof sd.displayName === "string" && sd.displayName.trim()) ||
              (typeof sd.name === "string" && sd.name.trim()) ||
              null;
            setStaffName(n);
          }
        }
      } catch (e) {
        console.warn("[mini-app] Firestore load:", e);
      } finally {
        if (!cancelled) setFirestoreDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venueId, tableId]);

  useEffect(() => {
    if (!entryRouteResolved) return;
    const role = searchParams.get("role") ?? "";
    const bot = searchParams.get("bot") ?? "";
    const urlT = (searchParams.get("t") ?? "").trim();
    const isStaffEntry = bot === "staff" || role === "staff" || forceStaffByBot;
    if (isStaffEntry && !urlT) {
      const v = (venueId || searchParams.get("v")) ?? "";
      router.replace(`/mini-app/staff?${new URLSearchParams({ v: v || "current" }).toString()}`);
    }
  }, [entryRouteResolved, searchParams, venueId, router, forceStaffByBot]);

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const t = setInterval(() => setCooldownLeft((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldownLeft]);

  const venueDisplayName = resolveVenueDisplayName(venueSettings?.name);
  const tableNumberResolved =
    tableSettings != null ? resolveTableNumberFromDoc(tableSettings as Record<string, unknown>) : null;

  const role = searchParams.get("role") ?? "";
  const bot = searchParams.get("bot") ?? "";
  const isStaffEntry = bot === "staff" || role === "staff" || forceStaffByBot;
  const telegramUserId = useMemo(() => {
    if (typeof window === "undefined") return "";
    const tg = window.Telegram?.WebApp as TelegramWebAppInit | undefined;
    const id = tg?.initDataUnsafe?.user?.id;
    return id != null ? `tg:${String(id)}` : "";
  }, []);
  const currentUid = (visitorId?.trim() || telegramUserId || "").trim();
  const isMaster = Boolean(sessionState?.masterId && currentUid && sessionState.masterId === currentUid);
  const myParticipant = sessionState?.participants?.find((p) => p.uid === currentUid) ?? null;
  const myStatus = myParticipant?.status ?? null;

  const sessionFirstVisit = Boolean(venueId && tableId) && !isStaffEntry;
  const isLoadingTable = Boolean(sessionFirstVisit && tableId && !firestoreDone);
  const tableRecognized = Boolean(sessionFirstVisit && firestoreDone && tableSettings !== null);
  const callDisabled =
    !tableRecognized || callLoading || cooldownLeft > 0 || isLoadingTable;

  const handleCallWaiter = useCallback(async () => {
    if (!venueId || !tableId || !tableRecognized) return;
    setCallLoading(true);
    try {
      await createGuestEvent({
        type: "call_waiter",
        venueId,
        tableId,
        tableNumber: tableNumberResolved ?? undefined,
        visitorId: visitorId ?? undefined,
      });
      toast.success("Официант уведомлён");
      setCooldownLeft(Math.ceil(CALL_WAITER_COOLDOWN_MS / 1000));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отправить");
    } finally {
      setCallLoading(false);
    }
  }, [venueId, tableId, tableRecognized, tableNumberResolved, visitorId]);

  const refreshSessionState = useCallback(async () => {
    if (!venueId || !tableId) {
      setSessionState(null);
      return;
    }
    const res = await fetch("/api/session/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ venueId, tableId }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      state?: {
        sessionId: string;
        masterId: string;
        isPrivate: boolean;
        participants: { uid: string; status: "active" | "paid" | "exited" }[];
      } | null;
    };
    if (!res.ok || !data.ok) return;
    setSessionState(data.state ?? null);
  }, [venueId, tableId]);

  useEffect(() => {
    if (!venueId || !tableId || isStaffEntry || !currentUid) return;
    const key = `${venueId}:${tableId}:${currentUid}`;
    if (checkInSyncRef.current === key) return;
    checkInSyncRef.current = key;
    (async () => {
      const res = await fetch("/api/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueId,
          tableId,
          participantUid: currentUid,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string; messageGuest?: string };
      if (data.status === "table_private") {
        setSessionUiError("Стол приватный. Подселение запрещено без разрешения хозяина.");
      } else {
        setSessionUiError(null);
      }
      await refreshSessionState();
    })();
  }, [venueId, tableId, currentUid, isStaffEntry, refreshSessionState]);

  useEffect(() => {
    if (!venueId || !tableId || isStaffEntry) return;
    void refreshSessionState();
  }, [venueId, tableId, isStaffEntry, refreshSessionState]);

  const onToggleAllowJoin = useCallback(async () => {
    if (!sessionState || !isMaster || !currentUid) return;
    setSessionActionLoading(true);
    try {
      const allowJoin = sessionState.isPrivate;
      const res = await fetch("/api/session/privacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId, tableId, actorUid: currentUid, allowJoin }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast.error(data.error || "Не удалось изменить приватность");
        return;
      }
      await refreshSessionState();
    } finally {
      setSessionActionLoading(false);
    }
  }, [sessionState, isMaster, currentUid, venueId, tableId, refreshSessionState]);

  const onPayMyBill = useCallback(async () => {
    if (!currentUid || !venueId || !tableId) return;
    setSessionActionLoading(true);
    try {
      const res = await fetch("/api/session/pay-my-bill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId, tableId, uid: currentUid }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; updatedOrders?: number };
      if (!res.ok || !data.ok) {
        toast.error(data.error || "Не удалось оплатить ваш счёт");
        return;
      }
      toast.success(`Оплачено позиций: ${data.updatedOrders ?? 0}`);
      await refreshSessionState();
    } finally {
      setSessionActionLoading(false);
    }
  }, [currentUid, venueId, tableId, refreshSessionState]);

  const onCloseWholeTable = useCallback(async () => {
    if (!currentUid || !venueId || !tableId || !isMaster) return;
    setSessionActionLoading(true);
    try {
      const res = await fetch("/api/session/close-table", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId, tableId, masterUid: currentUid }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; updatedOrders?: number };
      if (!res.ok || !data.ok) {
        toast.error(data.error || "Не удалось закрыть стол");
        return;
      }
      toast.success(`Стол закрыт, оплачено позиций: ${data.updatedOrders ?? 0}`);
      await refreshSessionState();
    } finally {
      setSessionActionLoading(false);
    }
  }, [currentUid, venueId, tableId, isMaster, refreshSessionState]);

  const onExitSession = useCallback(async () => {
    if (!currentUid || !venueId || !tableId) return;
    setSessionActionLoading(true);
    try {
      const res = await fetch("/api/session/exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId, tableId, uid: currentUid }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast.error(data.error || "Не удалось выйти из сессии");
        return;
      }
      toast.success("Вы вышли из сессии стола");
      await refreshSessionState();
    } finally {
      setSessionActionLoading(false);
    }
  }, [currentUid, venueId, tableId, refreshSessionState]);

  const openTableScanner = useCallback(() => {
    const inTg = isTelegramContext();
    const tg = window.Telegram?.WebApp as TelegramWebAppInit | undefined;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (inTg && tg?.showScanQrPopup) {
      tg.showScanQrPopup({ text: "Наведите на QR стола" }, (text) => {
        const parsed = parseStartParamPayload(text?.trim() ?? "");
        if (parsed) {
          setVenueId(parsed.venueId);
          setTableId(parsed.tableId);
          setVenueSettings(null);
          setTableSettings(null);
          setStaffName(null);
          setFirestoreDone(false);
          setEntryRouteResolved(true);
          tg.close?.();
        } else {
          toast.error("Неверный QR");
        }
      });
      return;
    }
    if (inTg) {
      toast.error("Сканер QR недоступен в этой версии клиента. Обновите Telegram до последней версии.");
      return;
    }
    toast("Откройте приложение в Telegram для сканера QR", { icon: "ℹ️" });
    router.push(`${origin}/check-in`);
  }, [router]);

  const urlTStaff = (searchParams.get("t") ?? "").trim();
  if (isStaffEntry && !urlTStaff) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <p className="text-slate-500 text-sm">Открытие кабинета персонала…</p>
      </main>
    );
  }

  if (!entryRouteResolved) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <p className="text-slate-500 text-sm">Загрузка…</p>
      </main>
    );
  }

  if (!sessionFirstVisit) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <div className="mx-auto max-w-sm text-center">
          <QrCode className="mx-auto mb-4 h-16 w-16 text-slate-400" aria-hidden />
          <h1 className="text-lg font-semibold text-slate-900">Откройте стол по QR</h1>
          <p className="mt-2 text-sm text-slate-600">
            Наведите камеру на QR-код на столе или отсканируйте его в Telegram, чтобы вызвать официанта.
          </p>
          <button
            type="button"
            onClick={openTableScanner}
            className="mt-6 w-full rounded-xl bg-slate-900 py-3.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Сканировать QR
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 pb-10 md:p-6" style={{ zoom: 0.75 }}>
      <div className="mx-auto flex max-w-md flex-col gap-5">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-center text-lg font-bold text-slate-900">
            {isLoadingTable ? "Загрузка…" : `Добро пожаловать в ${venueDisplayName}`}
          </p>
          {!isLoadingTable && (
            <p className="mt-2 text-center text-sm text-slate-600">
              {tableNumberResolved != null
                ? `Стол №${tableNumberResolved}`
                : tableId
                  ? `Стол ${tableId}`
                  : null}
            </p>
          )}
          {staffName ? (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-center text-sm font-medium text-emerald-900">
              Вас обслуживает {staffName}
            </p>
          ) : tableRecognized ? (
            <p className="mt-3 text-center text-xs text-slate-500">
              Официант закреплён за столом в панели заведения
            </p>
          ) : null}
          {!tableRecognized && firestoreDone && !isLoadingTable && (
            <p className="mt-2 text-center text-sm text-amber-700">
              Стол не найден в системе — вызов недоступен
            </p>
          )}
          {sessionUiError && (
            <p className="mt-2 text-center text-sm text-red-700">{sessionUiError}</p>
          )}
        </header>

        {sessionState && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">
              Режим стола: {isMaster ? "Master (хозяин)" : "Участник"}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Подселение: {sessionState.isPrivate ? "запрещено" : "разрешено"} · ваш статус: {myStatus ?? "unknown"}
            </p>
            {isMaster && (
              <button
                type="button"
                disabled={sessionActionLoading}
                onClick={() => void onToggleAllowJoin()}
                className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {sessionState.isPrivate ? "Разрешить подселение" : "Запретить подселение"}
              </button>
            )}
            <button
              type="button"
              disabled={sessionActionLoading || !currentUid}
              onClick={() => void onPayMyBill()}
              className="mt-2 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Оплатить мой счет
            </button>
            {isMaster && (
              <button
                type="button"
                disabled={sessionActionLoading}
                onClick={() => void onCloseWholeTable()}
                className="mt-2 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Закрыть весь стол
              </button>
            )}
            <button
              type="button"
              disabled={sessionActionLoading || !currentUid}
              onClick={() => void onExitSession()}
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Выйти из сессии
            </button>
            <p className="mt-2 text-[11px] text-slate-500">
              table closed, partial paid, already joined и table_private обрабатываются серверной сессией.
            </p>
          </section>
        )}

        <button
          type="button"
          disabled={callDisabled}
          onClick={() => void handleCallWaiter()}
          className="flex min-h-[180px] w-full flex-col items-center justify-center gap-4 rounded-3xl border-2 border-emerald-300 bg-gradient-to-b from-white to-emerald-50/80 py-10 shadow-lg transition-all hover:border-emerald-400 disabled:pointer-events-none disabled:opacity-45"
        >
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md">
            <Bell className="h-10 w-10" />
          </span>
          <span className="text-xl font-bold tracking-tight text-slate-900">
            {callLoading ? "Отправка…" : "Вызвать официанта"}
          </span>
          {cooldownLeft > 0 && (
            <span className="text-sm text-slate-500">Повтор через {cooldownLeft} с</span>
          )}
        </button>
      </div>
    </main>
  );
}

export default function MiniAppPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-50">
          <p className="text-gray-500">Загрузка…</p>
        </main>
      }
    >
      <MiniAppContent />
    </Suspense>
  );
}
