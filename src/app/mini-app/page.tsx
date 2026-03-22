"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { resolveVenueDisplayName, resolveTableNumberFromDoc } from "@/lib/venue-display";
import { parseStartParamPayload } from "@/lib/parse-start-param";
import { AdSpace } from "@/components/ads/AdSpace";
import { useVisitor } from "@/components/providers/VisitorProvider";
import { createGuestEvent } from "@/lib/guest-events";
import { useGeoFencing } from "@/hooks/useGeoFencing";
import { IS_GEO_DEBUG } from "@/lib/geo";
import { CALL_WAITER_COOLDOWN_MS } from "@/lib/constants";
import { Bell, QrCode, MapPin } from "lucide-react";
import toast from "react-hot-toast";

const VISITOR_STORAGE_KEY = "heywaiter_visitor_id";
const MINIAPP_CACHE_VENUE = "heywaiter_miniapp_venue_id";
const MINIAPP_CACHE_TABLE = "heywaiter_miniapp_table_id";

function clearMiniappCache(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(MINIAPP_CACHE_VENUE);
    localStorage.removeItem(MINIAPP_CACHE_TABLE);
  } catch (_) {}
}

const STAFF_BOT_USERNAME = "waitertalk_bot";

type TelegramWebAppInit = {
  initDataUnsafe?: {
    start_param?: string;
    user?: { id?: number };
    receiver?: { username?: string };
  };
  ready?: () => void;
  showScanQrPopup?: (params: { text?: string }, callback: (text: string) => void) => void;
  close?: () => void;
};

function isStaffBotContext(): boolean {
  if (typeof window === "undefined") return false;
  const tg = window.Telegram?.WebApp as TelegramWebAppInit | undefined;
  const username = tg?.initDataUnsafe?.receiver?.username ?? "";
  return username === STAFF_BOT_USERNAME;
}

/**
 * Deep Link: start из Telegram WebApp (initDataUnsafe), из query tgWebAppStartParam или из hash #tgWebAppStartParam=…
 */
function getTelegramStartParam(): string {
  if (typeof window === "undefined") return "";
  const WebApp = window.Telegram?.WebApp as TelegramWebAppInit | undefined;
  const fromUnsafe = WebApp?.initDataUnsafe?.start_param?.trim() ?? "";
  if (fromUnsafe) return fromUnsafe;

  try {
    const q = new URLSearchParams(window.location.search);
    const qp = q.get("tgWebAppStartParam")?.trim() ?? "";
    if (qp) return qp;
  } catch (_) {}

  try {
    const rawHash = window.location.hash?.replace(/^#/, "") ?? "";
    if (rawHash) {
      const hq = new URLSearchParams(rawHash);
      const h = hq.get("tgWebAppStartParam")?.trim() ?? "";
      if (h) return h;
    }
  } catch (_) {}

  return "";
}

function MiniAppContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { visitorId, setVisitorId } = useVisitor();
  const [venueId, setVenueId] = useState<string>("");
  const [tableId, setTableId] = useState<string>("");
  const [venueSettings, setVenueSettings] = useState<Record<string, unknown> | null>(null);
  const [tableSettings, setTableSettings] = useState<Record<string, unknown> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [firestoreDone, setFirestoreDone] = useState(false);
  const [forceStaffByBot, setForceStaffByBot] = useState(false);
  const lastAppliedStartParam = useRef<string>("");
  const [callLoading, setCallLoading] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);

  const { ensureInsideVenue } = useGeoFencing({
    mode: "guest",
    venueId: venueId || "_",
    tableId: tableId || "_",
    sessionOpen: true,
    startAfterUserAction: true,
  });

  const forceResetTableAndLoad = useCallback((newVenueId: string, newTableId: string) => {
    lastAppliedStartParam.current = "";
    setVenueId(newVenueId);
    setTableId(newTableId);
    setVenueSettings(null);
    setTableSettings(null);
    setFirestoreDone(false);
  }, []);

  const applyStartParam = useCallback(
    (startParam: string) => {
      if (!startParam.trim()) return false;
      const parsed = parseStartParamPayload(startParam);
      if (!parsed) return false;
      lastAppliedStartParam.current = startParam;
      clearMiniappCache();
      setVenueId(parsed.venueId);
      setTableId(parsed.tableId);
      setVenueSettings(null);
      setTableSettings(null);
      setFirestoreDone(false);
      if (parsed.visitorId) {
        try {
          if (typeof localStorage !== "undefined") {
            localStorage.setItem(VISITOR_STORAGE_KEY, parsed.visitorId);
          }
          setVisitorId(parsed.visitorId);
        } catch (_) {}
      }
      return true;
    },
    [setVisitorId]
  );

  useEffect(() => {
    if (typeof window !== "undefined" && window.Telegram?.WebApp) {
      (window.Telegram.WebApp as TelegramWebAppInit).ready?.();
    }
  }, []);

  useEffect(() => {
    if (isStaffBotContext()) {
      setForceStaffByBot(true);
      router.replace("/mini-app/staff?v=current");
    }
  }, [router]);

  useEffect(() => {
    const startParam = getTelegramStartParam();
    const fromQueryV = (searchParams.get("v") ?? "").trim();
    const fromQueryT = (searchParams.get("t") ?? "").trim();
    const role = searchParams.get("role") ?? "";
    const bot = searchParams.get("bot") ?? "";
    const isStaffByUrl = (bot === "staff" || role === "staff") && !fromQueryT;
    const isStaffEntry = isStaffByUrl || forceStaffByBot;

    if (typeof window !== "undefined" && startParam) {
      clearMiniappCache();
    }

    if (isStaffEntry) {
      setLoaded(true);
      setFirestoreDone(true);
      return;
    }

    if (startParam) {
      const applied = applyStartParam(startParam);
      if (!applied) {
        setLoaded(true);
        setFirestoreDone(true);
      }
    } else if (fromQueryV || fromQueryT) {
      const newV = fromQueryV || venueId;
      const newT = fromQueryT || tableId;
      if (newV !== venueId || newT !== tableId) {
        forceResetTableAndLoad(newV, newT);
      }
    } else {
      setLoaded(true);
      setFirestoreDone(true);
    }
    setLoaded(true);
  }, [searchParams, applyStartParam, forceResetTableAndLoad, venueId, tableId, forceStaffByBot]);

  useEffect(() => {
    const delays = [0, 150, 400, 900];
    const timers = delays.map((ms) =>
      setTimeout(() => {
        const sp = getTelegramStartParam();
        if (sp && sp !== lastAppliedStartParam.current) {
          applyStartParam(sp);
        }
      }, ms)
    );
    return () => timers.forEach(clearTimeout);
  }, [applyStartParam]);

  useEffect(() => {
    if (!venueId && !tableId) {
      setFirestoreDone(true);
      return;
    }
    setVenueSettings(null);
    setTableSettings(null);
    let cancelled = false;
    (async () => {
      try {
        let resolvedVenueId = venueId;
        if (venueId) {
          const venueSnap = await getDoc(doc(db, "venues", venueId));
          if (cancelled) return;
          if (venueSnap.exists()) {
            setVenueSettings(venueSnap.data() as Record<string, unknown>);
          }
        }
        if (tableId) {
          let tableData: Record<string, unknown> | null = null;
          if (resolvedVenueId) {
            const nested = await getDoc(doc(db, "venues", resolvedVenueId, "tables", tableId));
            if (cancelled) return;
            if (nested.exists()) {
              tableData = nested.data() as Record<string, unknown>;
            }
          }
          const byDocId = await getDoc(doc(db, "tables", tableId));
          if (cancelled) return;
          if (!tableData && byDocId.exists()) {
            tableData = byDocId.data() as Record<string, unknown>;
            const docVenueId = tableData?.venueId as string | undefined;
            if (docVenueId && !resolvedVenueId) {
              resolvedVenueId = docVenueId;
              setVenueId(docVenueId);
              const venueSnap = await getDoc(doc(db, "venues", docVenueId));
              if (!cancelled && venueSnap.exists()) {
                setVenueSettings(venueSnap.data() as Record<string, unknown>);
              }
              const nestedAfter = await getDoc(doc(db, "venues", docVenueId, "tables", tableId));
              if (!cancelled && nestedAfter.exists()) {
                tableData = nestedAfter.data() as Record<string, unknown>;
              }
            }
          }
          if (!tableData && resolvedVenueId) {
            const tablesSnap = await getDocs(
              query(
                collection(db, "tables"),
                where("venueId", "==", resolvedVenueId),
                where("tableId", "==", tableId)
              )
            );
            if (cancelled) return;
            const first = tablesSnap.docs[0];
            if (first?.exists()) {
              tableData = first.data() as Record<string, unknown>;
            }
          }
          if (tableData) {
            setTableSettings(tableData);
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
    if (!loaded) return;
    const role = searchParams.get("role") ?? "";
    const bot = searchParams.get("bot") ?? "";
    const urlT = (searchParams.get("t") ?? "").trim();
    const isStaffEntry = bot === "staff" || role === "staff" || forceStaffByBot;
    if (isStaffEntry && !urlT) {
      const v = (venueId || searchParams.get("v")) ?? "";
      router.replace(`/mini-app/staff?${new URLSearchParams({ v: v || "current" }).toString()}`);
    }
  }, [loaded, searchParams, venueId, router, forceStaffByBot]);

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

  const isTableMode = Boolean(venueId && tableId) && !isStaffEntry;
  const isLoadingTable = Boolean(isTableMode && tableId && !firestoreDone);

  /** Кнопка вызова: стол найден в Firestore */
  const tableRecognized = Boolean(isTableMode && firestoreDone && tableSettings !== null);
  const callDisabled =
    !tableRecognized || callLoading || cooldownLeft > 0 || isLoadingTable;

  const handleCallWaiter = useCallback(async () => {
    if (!venueId || !tableId || !tableRecognized) return;
    if (!IS_GEO_DEBUG) {
      const check = await ensureInsideVenue();
      if (!check.allowed) {
        toast.error("Вызов доступен только в заведении");
        return;
      }
    }
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
  }, [
    venueId,
    tableId,
    tableRecognized,
    tableNumberResolved,
    visitorId,
    ensureInsideVenue,
  ]);

  const openTableScanner = useCallback(() => {
    const tg = window.Telegram?.WebApp as TelegramWebAppInit | undefined;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (tg?.showScanQrPopup) {
      tg.showScanQrPopup({ text: "Наведите на QR стола" }, (text) => {
        const parsed = parseStartParamPayload(text?.trim() ?? "");
        if (parsed) {
          router.push(`/mini-app?v=${encodeURIComponent(parsed.venueId)}&t=${encodeURIComponent(parsed.tableId)}`);
          tg.close?.();
        } else {
          toast.error("Неверный QR");
        }
      });
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

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-6" style={{ zoom: 0.75 }}>
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <header className="text-center">
          <h1 className="text-xl font-bold text-slate-900">
            {isTableMode ? "За столом" : "Личный кабинет"}
          </h1>
          <p className="mt-1 text-xs text-slate-500">HeyWaiter</p>
        </header>

        <AdSpace
          id="main-gate"
          placement="main_gate"
          venueId={venueId || undefined}
          className="w-full"
        />

        {isTableMode ? (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
              {isLoadingTable ? (
                <p className="text-slate-600">Загрузка стола…</p>
              ) : (
                <>
                  <p className="text-slate-800">
                    Добро пожаловать в {venueDisplayName}!
                    {tableNumberResolved != null ? (
                      <> Ваш стол №{tableNumberResolved}.</>
                    ) : tableId ? (
                      <> Стол {tableId}.</>
                    ) : null}
                  </p>
                  {!tableRecognized && firestoreDone && (
                    <p className="mt-2 text-sm text-amber-700">
                      Стол не найден в системе — кнопка вызова недоступна.
                    </p>
                  )}
                </>
              )}
            </div>

            <button
              type="button"
              disabled={callDisabled}
              onClick={() => void handleCallWaiter()}
              className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-emerald-200 bg-white py-8 shadow-sm transition-colors hover:border-emerald-400 hover:bg-emerald-50/50 disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <Bell className="h-8 w-8" />
              </span>
              <span className="text-lg font-semibold text-slate-800">
                {callLoading ? "Отправка…" : "Вызвать официанта"}
              </span>
              {cooldownLeft > 0 && (
                <span className="text-sm text-slate-500">Повтор через {cooldownLeft} с</span>
              )}
            </button>
          </>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-600 text-center">
                Отсканируйте QR стола или откройте ссылку из бота, чтобы сесть за стол.
              </p>
            </div>

            <button
              type="button"
              onClick={openTableScanner}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-200 bg-white py-4 font-medium text-slate-800 shadow-sm hover:bg-slate-50"
            >
              <QrCode className="h-5 w-5" />
              Сканировать QR стола
            </button>

            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <MapPin className="h-4 w-4 shrink-0" />
                Мои места
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Сохранённые заведения и история визитов появятся здесь в следующих версиях.
              </p>
            </div>
          </>
        )}
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
