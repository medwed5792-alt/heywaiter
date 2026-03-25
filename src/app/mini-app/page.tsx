"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, Suspense, useMemo, useRef } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { resolveVenueDisplayName, resolveTableNumberFromDoc } from "@/lib/venue-display";
import { parseStartParamPayload } from "@/lib/parse-start-param";
import { parseSotaStartappPayload } from "@/lib/sota-id";
import { resolveSotaStartappToVenueTable } from "@/lib/sota-resolve";
import { useVisitor } from "@/components/providers/VisitorProvider";
import { createGuestEvent, getWaiterIdFromTableDoc } from "@/lib/guest-events";
import { CALL_WAITER_COOLDOWN_MS } from "@/lib/constants";
import { resolveUnifiedCustomerUid } from "@/lib/identity/customer-uid";
import { resolveGuestDisplayName } from "@/lib/identity/guest-display";
import { Bell, QrCode } from "lucide-react";
import toast from "react-hot-toast";
import { useMiniAppBotRole, MiniAppIdentifyingFallback } from "@/components/mini-app/MiniAppBotRoleDispatcher";

/** Разделение staff/guest — только в `MiniAppBotRoleDispatcher` (root layout). Эта страница — гостевой сценарий. */

type TelegramWebAppInit = {
  initData?: string;
  initDataUnsafe?: {
    start_param?: string;
    user?: { id?: number; first_name?: string; last_name?: string };
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

type BillItemInfo = { label: string; amount: number };

function parseNumber(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function extractOrderBillInfo(data: Record<string, unknown>): { amount: number; items: BillItemInfo[] } {
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items: BillItemInfo[] = [];
  for (const i of rawItems) {
    const x = (i ?? {}) as Record<string, unknown>;
    const label =
      String(x.name ?? x.title ?? x.dishName ?? x.itemName ?? "").trim() || "Позиция";
    const qty = Math.max(parseNumber(x.qty ?? x.quantity), 1);
    const unit = parseNumber(x.price ?? x.unitPrice);
    const row = parseNumber(x.amount ?? x.total);
    const amount = row > 0 ? row : unit > 0 ? unit * qty : 0;
    items.push({ label: qty > 1 ? `${label} x${qty}` : label, amount });
  }

  if (items.length === 0) {
    const single =
      parseNumber(data.amount) ||
      parseNumber(data.total) ||
      parseNumber(data.sum) ||
      parseNumber(data.price);
    if (single > 0) items.push({ label: `Заказ #${String(data.orderNumber ?? "").trim() || "—"}`, amount: single });
  }

  const amount = items.reduce((acc, i) => acc + i.amount, 0);
  return { amount, items };
}

function MiniAppContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { role: miniAppBotRole } = useMiniAppBotRole();
  const { visitorId } = useVisitor();
  const [venueId, setVenueId] = useState<string>("");
  const [tableId, setTableId] = useState<string>("");
  const [venueSettings, setVenueSettings] = useState<Record<string, unknown> | null>(null);
  const [tableSettings, setTableSettings] = useState<Record<string, unknown> | null>(null);
  const [staffName, setStaffName] = useState<string | null>(null);
  const [entryRouteResolved, setEntryRouteResolved] = useState(false);
  const [isSdkReady, setIsSdkReady] = useState(false);
  const [firestoreDone, setFirestoreDone] = useState(false);
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
  const [billRequestStatus, setBillRequestStatus] = useState<"pending" | "processing" | "completed" | null>(null);
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
    if (!isSdkReady) return;

    const inTg = isTelegramContext();

    if (inTg) {
      const sp = getStartParamFromTelegramWebApp();
      if (sp) {
        let decoded = sp;
        try {
          decoded = decodeURIComponent(sp.trim());
        } catch {
          decoded = sp.trim();
        }
        const sota = parseSotaStartappPayload(decoded);
        if (sota) {
          let cancelled = false;
          (async () => {
            try {
              const resolved = await resolveSotaStartappToVenueTable(db, sota.venueSotaId, sota.tableRef);
              if (cancelled) return;
              if (resolved) {
                setVenueId(resolved.venueId);
                setTableId(resolved.tableId);
                setVenueSettings(null);
                setTableSettings(null);
                setStaffName(null);
                setFirestoreDone(false);
                setEntryRouteResolved(true);
                return;
              }
            } catch (e) {
              console.warn("[mini-app] SOTA resolve error:", e);
            }
            const p = parseStartParamPayload(decoded);
            if (!cancelled && p) {
              setVenueId(p.venueId);
              setTableId(p.tableId);
              setVenueSettings(null);
              setTableSettings(null);
              setStaffName(null);
              setFirestoreDone(false);
              setEntryRouteResolved(true);
              return;
            }
            if (!cancelled) {
              console.warn("[mini-app] start_param parse failed:", decoded);
              setVenueId("");
              setTableId("");
              setFirestoreDone(true);
              setEntryRouteResolved(true);
            }
          })();
          return () => {
            cancelled = true;
          };
        }
        const p = parseStartParamPayload(decoded);
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
        console.warn("[mini-app] start_param parse failed:", decoded);
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
  }, [isSdkReady, searchParams]);

  useEffect(() => {
    if (!isSdkReady) return;
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
  }, [venueId, tableId, isSdkReady]);

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const t = setInterval(() => setCooldownLeft((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldownLeft]);

  const venueDisplayName = resolveVenueDisplayName(venueSettings?.name);
  const tableNumberResolved =
    tableSettings != null ? resolveTableNumberFromDoc(tableSettings as Record<string, unknown>) : null;

  const telegramUserId = useMemo(() => {
    if (typeof window === "undefined") return "";
    const tg = window.Telegram?.WebApp as TelegramWebAppInit | undefined;
    const id = tg?.initDataUnsafe?.user?.id;
    return id != null ? String(id) : "";
  }, []);
  const telegramUserName = useMemo(() => {
    if (typeof window === "undefined") return "";
    const tg = window.Telegram?.WebApp as TelegramWebAppInit | undefined;
    const first = tg?.initDataUnsafe?.user?.first_name?.trim() ?? "";
    const last = tg?.initDataUnsafe?.user?.last_name?.trim() ?? "";
    return [first, last].filter(Boolean).join(" ").trim();
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isTelegramContext()) return;
    const tg = window.Telegram?.WebApp as TelegramWebAppInit | undefined;
    if (!tg?.initDataUnsafe?.user) {
      console.warn("[mini-app] Telegram user отсутствует в initDataUnsafe.user", tg?.initDataUnsafe);
    }
  }, []);
  const currentUid = resolveUnifiedCustomerUid({
    telegramUserId: telegramUserId || null,
    anonymousId: visitorId?.trim() || null,
  });
  const isMaster = Boolean(sessionState?.masterId && currentUid && sessionState.masterId === currentUid);
  const myParticipant = sessionState?.participants?.find((p) => p.uid === currentUid) ?? null;
  const myStatus = myParticipant?.status ?? null;
  const isParticipant = Boolean(myParticipant);
  const allowJoin = Boolean(sessionState && !sessionState.isPrivate);

  const sessionFirstVisit = Boolean(venueId && tableId);
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
        customerUid: currentUid || undefined,
      });
      toast.success("Официант уведомлён");
      setCooldownLeft(Math.ceil(CALL_WAITER_COOLDOWN_MS / 1000));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отправить");
    } finally {
      setCallLoading(false);
    }
  }, [venueId, tableId, tableRecognized, tableNumberResolved, currentUid]);

  useEffect(() => {
    if (!isSdkReady || !venueId || !tableId || !currentUid) return;
    const key = `${venueId}:${tableId}:${currentUid}`;
    if (checkInSyncRef.current === key) return;
    checkInSyncRef.current = key;
    (async () => {
      try {
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
      } catch (e) {
        console.error("[mini-app] check-in request failed:", e);
      }
    })();
  }, [venueId, tableId, currentUid, isSdkReady]);

  useEffect(() => {
    if (!isSdkReady || !venueId || !tableId) {
      setSessionState(null);
      return;
    }
    const q = query(
      collection(db, "activeSessions"),
      where("venueId", "==", venueId),
      where("tableId", "==", tableId),
      where("status", "==", "check_in_success"),
      limit(1)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setSessionState(null);
          return;
        }
        const d = (snap.docs[0].data() ?? {}) as Record<string, unknown>;
        const participantsRaw = Array.isArray(d.participants) ? d.participants : [];
        const participants = participantsRaw
          .map((p) => {
            const x = (p ?? {}) as Record<string, unknown>;
            const uid = typeof x.uid === "string" ? x.uid.trim() : "";
            const status = x.status === "paid" || x.status === "exited" ? x.status : "active";
            return uid ? { uid, status: status as "active" | "paid" | "exited" } : null;
          })
          .filter(Boolean) as { uid: string; status: "active" | "paid" | "exited" }[];
        setSessionState({
          sessionId: snap.docs[0].id,
          masterId: typeof d.masterId === "string" ? d.masterId.trim() : "",
          isPrivate: typeof d.isPrivate === "boolean" ? d.isPrivate : true,
          participants,
        });
      },
      (err) => {
        console.warn("[mini-app] session snapshot error:", err);
      }
    );
    return () => unsub();
  }, [venueId, tableId, isSdkReady]);

  useEffect(() => {
    if (!isSdkReady || !sessionState?.sessionId || !currentUid || !venueId) {
      setBillRequestStatus(null);
      return;
    }
    const q = query(
      collection(db, "staffNotifications"),
      where("venueId", "==", venueId),
      where("sessionId", "==", sessionState.sessionId),
      where("requesterUid", "==", currentUid),
      limit(20)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs
        .map((d) => {
          const x = (d.data() ?? {}) as Record<string, unknown>;
          const type = String(x.type ?? "");
          const status = String(x.status ?? "");
          const createdAt = (x.createdAt as { toDate?: () => Date } | undefined)?.toDate?.()?.getTime?.() ?? 0;
          return { type, status, createdAt };
        })
        .filter((x) => x.type === "split_bill_request" || x.type === "full_bill_request")
        .sort((a, b) => b.createdAt - a.createdAt);
      const latest = list[0];
      if (latest?.status === "pending" || latest?.status === "processing" || latest?.status === "completed") {
        setBillRequestStatus(latest.status);
      } else {
        setBillRequestStatus(null);
      }
    });
    return () => unsub();
  }, [sessionState?.sessionId, currentUid, venueId, isSdkReady]);

  const isAccessDenied = Boolean(
    sessionState &&
      sessionState.isPrivate &&
      currentUid &&
      !isMaster &&
      !isParticipant
  );

  const onToggleAllowJoin = useCallback(async () => {
    if (!isSdkReady || !sessionState || !isMaster) return;
    setSessionActionLoading(true);
    try {
      await updateDoc(doc(db, "activeSessions", sessionState.sessionId), {
        isPrivate: !sessionState.isPrivate,
        updatedAt: serverTimestamp(),
      });
    } finally {
      setSessionActionLoading(false);
    }
  }, [sessionState, isMaster, isSdkReady]);

  const onPayMyBill = useCallback(async () => {
    if (!isSdkReady || !currentUid || !venueId || !tableId) return;
    setSessionActionLoading(true);
    try {
      const ordersSnap = await getDocs(
        query(
          collection(db, "orders"),
          where("venueId", "==", venueId),
          where("tableId", "==", tableId),
          where("customerUid", "==", currentUid),
          where("status", "in", ["pending", "ready"])
        )
      );
      const billItems: BillItemInfo[] = [];
      for (const d of ordersSnap.docs) {
        const info = extractOrderBillInfo((d.data() ?? {}) as Record<string, unknown>);
        billItems.push(...info.items);
      }
      const amount = billItems.reduce((acc, i) => acc + i.amount, 0);
      const guestName = resolveGuestDisplayName({
        uid: currentUid,
        currentUid,
        currentUserName: telegramUserName || undefined,
      });
      await addDoc(collection(db, "staffNotifications"), {
        type: "split_bill_request",
        title: "💰 Запрос раздельного счета",
        message: `Стол №${tableNumberResolved ?? tableId}: ${guestName} хочет оплатить свою часть (${Math.round(amount)} руб.).`,
        venueId,
        tableId,
        tableNumber: tableNumberResolved ?? null,
        sessionId: sessionState?.sessionId ?? null,
        requesterUid: currentUid,
        guestName,
        amount: Math.round(amount),
        items: billItems.map((i) => `${i.label}${i.amount > 0 ? ` — ${Math.round(i.amount)} руб.` : ""}`),
        status: "pending",
        read: false,
        targetUids:
          tableSettings && typeof tableSettings.currentWaiterId === "string" && tableSettings.currentWaiterId.trim()
            ? [tableSettings.currentWaiterId.trim()]
            : [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast.success(`Запрос отправлен официанту: ${Math.round(amount)} руб.`);
    } finally {
      setSessionActionLoading(false);
    }
  }, [currentUid, venueId, tableId, tableNumberResolved, sessionState?.sessionId, telegramUserName, tableSettings, isSdkReady]);

  const onCloseWholeTable = useCallback(async () => {
    if (!isSdkReady || !currentUid || !venueId || !tableId || !isMaster) return;
    setSessionActionLoading(true);
    try {
      const allOrdersSnap = await getDocs(
        query(
          collection(db, "orders"),
          where("venueId", "==", venueId),
          where("tableId", "==", tableId),
          where("status", "in", ["pending", "ready"])
        )
      );
      const items: BillItemInfo[] = [];
      for (const d of allOrdersSnap.docs) {
        const info = extractOrderBillInfo((d.data() ?? {}) as Record<string, unknown>);
        items.push(...info.items);
      }
      const total = items.reduce((acc, i) => acc + i.amount, 0);
      const masterName = resolveGuestDisplayName({
        uid: currentUid,
        currentUid,
        currentUserName: telegramUserName || undefined,
      });
      await addDoc(collection(db, "staffNotifications"), {
        type: "full_bill_request",
        title: "👑 Закрытие всего стола",
        message: `👑 Мастер стола ${masterName} закрывает весь стол №${tableNumberResolved ?? tableId}. Сумма: ${Math.round(total)} руб.`,
        venueId,
        tableId,
        tableNumber: tableNumberResolved ?? null,
        sessionId: sessionState?.sessionId ?? null,
        requesterUid: currentUid,
        guestName: masterName,
        amount: Math.round(total),
        items: items.map((i) => `${i.label}${i.amount > 0 ? ` — ${Math.round(i.amount)} руб.` : ""}`),
        status: "pending",
        read: false,
        targetUids:
          tableSettings && typeof tableSettings.currentWaiterId === "string" && tableSettings.currentWaiterId.trim()
            ? [tableSettings.currentWaiterId.trim()]
            : [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast.success(`Запрос на закрытие стола отправлен: ${Math.round(total)} руб.`);
    } finally {
      setSessionActionLoading(false);
    }
  }, [currentUid, venueId, tableId, isMaster, tableNumberResolved, sessionState?.sessionId, telegramUserName, tableSettings, isSdkReady]);

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
    } finally {
      setSessionActionLoading(false);
    }
  }, [currentUid, venueId, tableId]);

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

  if (miniAppBotRole !== "guest") {
    return null;
  }

  if (!isSdkReady) {
    return <MiniAppIdentifyingFallback />;
  }

  if (!entryRouteResolved) {
    return <MiniAppIdentifyingFallback />;
  }

  if (!sessionFirstVisit) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <div className="mx-auto max-w-sm text-center">
          <QrCode className="mx-auto mb-4 h-16 w-16 text-slate-400" aria-hidden />
          <h1 className="text-lg font-semibold text-slate-900">Личный кабинет</h1>
          <p className="mt-2 text-sm text-slate-600">
            Режим без стола: откройте стол по QR, чтобы включить вызов официанта.
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
            <p className="mt-1 text-xs text-slate-600">Ваш статус: {myStatus ?? "unknown"}</p>
            {billRequestStatus === "pending" && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Запрос отправлен. Ожидайте подтверждение официанта.
              </p>
            )}
            {billRequestStatus === "processing" && (
              <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Официант в пути со счетом.
              </p>
            )}
            {billRequestStatus === "completed" && (
              <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">
                Запрос обработан.
              </p>
            )}

            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Кто за столом</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {sessionState.participants.map((p) => {
                  const displayName = resolveGuestDisplayName({
                    uid: p.uid,
                    currentUid,
                    currentUserName: telegramUserName || undefined,
                  });
                  const isOwner = Boolean(sessionState.masterId && p.uid === sessionState.masterId);
                  const isMe = Boolean(currentUid && p.uid === currentUid);
                  return (
                    <div
                      key={p.uid}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700"
                    >
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 font-semibold text-slate-700">
                        {displayName[0]?.toUpperCase() ?? "G"}
                      </span>
                      <span className="max-w-[150px] truncate">
                        {displayName}
                        {isMe ? " (Вы)" : ""}
                      </span>
                      {isOwner && <span title="Хозяин">👑</span>}
                    </div>
                  );
                })}
                {sessionState.participants.length === 0 && (
                  <p className="text-xs text-slate-500">Пока только вы за столом.</p>
                )}
              </div>
            </div>

            {isMaster && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <label className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-800">Разрешить подселение</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={allowJoin}
                    disabled={sessionActionLoading}
                    onClick={() => void onToggleAllowJoin()}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                      allowJoin ? "bg-emerald-500" : "bg-slate-300"
                    } disabled:opacity-50`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                        allowJoin ? "translate-x-5" : "translate-x-1"
                      }`}
                    />
                  </button>
                </label>
                <p className="mt-2 text-xs text-slate-600">
                  Сейчас другие гости {allowJoin ? "могут" : "не могут"} подсесть к вам по QR-коду.
                </p>
              </div>
            )}

            {isAccessDenied && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-900">
                  Стол №{tableNumberResolved ?? tableId} сейчас в приватном режиме.
                </p>
                <p className="mt-1 text-xs text-amber-800">
                  Попросите Мастера открыть доступ или выберите другой стол.
                </p>
              </div>
            )}

            {!isAccessDenied && (
              <>
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
                Оплатить всё
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
              </>
            )}
          </section>
        )}

        {!isAccessDenied && (
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
        )}
      </div>
    </main>
  );
}

export default function MiniAppPage() {
  return (
    <Suspense fallback={<MiniAppIdentifyingFallback />}>
      <MiniAppContent />
    </Suspense>
  );
}
