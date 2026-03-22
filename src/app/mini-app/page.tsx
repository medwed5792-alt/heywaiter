"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, Suspense } from "react";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { resolveVenueDisplayName, resolveTableNumberFromDoc } from "@/lib/venue-display";
import { AdSpace } from "@/components/ads/AdSpace";
import { useVisitor } from "@/components/providers/VisitorProvider";
import { createGuestEvent, getWaiterIdFromTableDoc } from "@/lib/guest-events";
import { CALL_WAITER_COOLDOWN_MS } from "@/lib/constants";
import { AD_CITY_HINTS } from "@/lib/ad-geo-hints";
import {
  Bell,
  QrCode,
  MapPin,
  ChevronDown,
  ChevronRight,
  Calendar,
  ShoppingBag,
  MessageSquare,
  Star,
  Tag,
} from "lucide-react";
import toast from "react-hot-toast";

const VISITOR_STORAGE_KEY = "heywaiter_visitor_id";
const MINIAPP_CACHE_VENUE = "heywaiter_miniapp_venue_id";
const MINIAPP_CACHE_TABLE = "heywaiter_miniapp_table_id";
const VISIT_HISTORY_KEY = "heywaiter_mini_visit_history";
const GUEST_CITY_KEY = "heywaiter_guest_city";

type VisitEntry = {
  venueId: string;
  venueName: string;
  tableId: string;
  tableLabel: string;
  visitedAt: number;
};

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
  const [staffName, setStaffName] = useState<string | null>(null);
  /** false — пока не определили: есть ли start_param / v+t (не показываем «Личный кабинет»). */
  const [entryRouteResolved, setEntryRouteResolved] = useState(false);
  const [firestoreDone, setFirestoreDone] = useState(false);
  const [forceStaffByBot, setForceStaffByBot] = useState(false);
  const [callLoading, setCallLoading] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [visitHistory, setVisitHistory] = useState<VisitEntry[]>([]);
  const [expandedPlaceKey, setExpandedPlaceKey] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string>("Москва");
  const [promoRows, setPromoRows] = useState<Array<{ id: string; name: string; promo?: string }>>([]);
  const [ratingRows, setRatingRows] = useState<
    Array<{ id: string; name: string; avg: number; count: number }>
  >([]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.Telegram?.WebApp) {
      (window.Telegram.WebApp as TelegramWebAppInit).ready?.();
    }
  }, []);

  useEffect(() => {
    try {
      const c = typeof localStorage !== "undefined" ? localStorage.getItem(GUEST_CITY_KEY) : null;
      if (c && c.trim()) setSelectedCity(c.trim());
    } catch (_) {}
  }, []);

  useEffect(() => {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(VISIT_HISTORY_KEY) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as VisitEntry[];
        if (Array.isArray(parsed)) setVisitHistory(parsed);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (isStaffBotContext()) {
      setForceStaffByBot(true);
      router.replace("/mini-app/staff?v=current");
    }
  }, [router]);

  useEffect(() => {
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

    let cancelled = false;
    const delays = [0, 40, 120, 300, 700, 2000];

    const tryBindSession = (): boolean => {
      const sp = getTelegramStartParam();
      const fromQueryV = (searchParams.get("v") ?? "").trim();
      const fromQueryT = (searchParams.get("t") ?? "").trim();

      if (sp) {
        const p = parseMiniAppStartParam(sp);
        if (p) {
          setVenueId(p.venueId);
          setTableId(p.tableId);
          setVenueSettings(null);
          setTableSettings(null);
          setStaffName(null);
          setFirestoreDone(false);
          return true;
        }
      }
      if (fromQueryV && fromQueryT) {
        lastAppliedStartParam.current = "";
        setVenueId(fromQueryV);
        setTableId(fromQueryT);
        setVenueSettings(null);
        setTableSettings(null);
        setStaffName(null);
        setFirestoreDone(false);
        return true;
      }
      return false;
    };

    let i = 0;
    const step = () => {
      if (cancelled) return;
      if (tryBindSession()) {
        setEntryRouteResolved(true);
        return;
      }
      i += 1;
      if (i < delays.length) {
        window.setTimeout(step, delays[i] - delays[i - 1]);
      } else {
        setFirestoreDone(true);
        setEntryRouteResolved(true);
      }
    };
    step();
    return () => {
      cancelled = true;
    };
  }, [searchParams, forceStaffByBot]);

  useEffect(() => {
    if (!venueId && !tableId) {
      setFirestoreDone(true);
      return;
    }
    setVenueSettings(null);
    setTableSettings(null);
    setStaffName(null);
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

  const sessionFirstVisit = Boolean(venueId && tableId) && !isStaffEntry;
  const isLoadingTable = Boolean(sessionFirstVisit && tableId && !firestoreDone);
  const tableRecognized = Boolean(sessionFirstVisit && firestoreDone && tableSettings !== null);
  const callDisabled =
    !tableRecognized || callLoading || cooldownLeft > 0 || isLoadingTable;

  /** История посещений при успешном «Первом визите» */
  useEffect(() => {
    if (!sessionFirstVisit || !tableRecognized || !venueId || !tableId) return;
    try {
      const entry: VisitEntry = {
        venueId,
        venueName: venueDisplayName,
        tableId,
        tableLabel: tableNumberResolved != null ? String(tableNumberResolved) : tableId,
        visitedAt: Date.now(),
      };
      const raw = localStorage.getItem(VISIT_HISTORY_KEY);
      const list: VisitEntry[] = raw ? JSON.parse(raw) : [];
      const next = [
        entry,
        ...list.filter((x) => !(x.venueId === venueId && x.tableId === tableId)),
      ].slice(0, 12);
      localStorage.setItem(VISIT_HISTORY_KEY, JSON.stringify(next));
      setVisitHistory(next);
    } catch (_) {}
  }, [sessionFirstVisit, tableRecognized, venueId, tableId, venueDisplayName, tableNumberResolved]);

  /** Лента: акции по населённому пункту */
  useEffect(() => {
    if (sessionFirstVisit || isStaffEntry) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "venues"), limit(40)));
        if (cancelled) return;
        const rows: Array<{ id: string; name: string; promo?: string }> = [];
        snap.docs.forEach((d) => {
          const data = d.data();
          const region = typeof data.adRegion === "string" ? data.adRegion.trim() : "";
          if (selectedCity && region && region !== selectedCity) return;
          const name = resolveVenueDisplayName(data.name);
          const cfg = data.config as { promos?: { text?: string } } | undefined;
          const promo = cfg?.promos?.text?.trim();
          rows.push({ id: d.id, name, promo });
        });
        setPromoRows(rows.slice(0, 16));
      } catch (e) {
        console.warn("[mini-app] promos:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionFirstVisit, isStaffEntry, selectedCity]);

  /** Лента: рейтинг заведений */
  useEffect(() => {
    if (sessionFirstVisit || isStaffEntry) return;
    let cancelled = false;
    (async () => {
      try {
        const vs = await getDocs(query(collection(db, "venues"), limit(12)));
        if (cancelled) return;
        const out: Array<{ id: string; name: string; avg: number; count: number }> = [];
        for (const vd of vs.docs) {
          if (cancelled) return;
          const vid = vd.id;
          const rs = await getDocs(query(collection(db, "reviews"), where("venueId", "==", vid)));
          const name = resolveVenueDisplayName(vd.data().name);
          if (rs.empty) {
            out.push({ id: vid, name, avg: 0, count: 0 });
          } else {
            let sum = 0;
            rs.docs.forEach((r) => {
              sum += Number(r.data().stars) || 0;
            });
            out.push({ id: vid, name, avg: sum / rs.size, count: rs.size });
          }
        }
        out.sort((a, b) => {
          if (a.count === 0 && b.count === 0) return a.name.localeCompare(b.name);
          if (a.count === 0) return 1;
          if (b.count === 0) return -1;
          return b.avg - a.avg;
        });
        setRatingRows(out.slice(0, 10));
      } catch (e) {
        console.warn("[mini-app] rating:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionFirstVisit, isStaffEntry]);

  const persistCity = (city: string) => {
    setSelectedCity(city);
    try {
      localStorage.setItem(GUEST_CITY_KEY, city);
    } catch (_) {}
  };

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
  }, [
    venueId,
    tableId,
    tableRecognized,
    tableNumberResolved,
    visitorId,
  ]);

  const openTableScanner = useCallback(() => {
    const tg = window.Telegram?.WebApp as TelegramWebAppInit | undefined;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (tg?.showScanQrPopup) {
      tg.showScanQrPopup({ text: "Наведите на QR стола" }, (text) => {
        const parsed = parseStartParamPayload(text?.trim() ?? "");
        if (parsed) {
          router.push(
            `/mini-app?v=${encodeURIComponent(parsed.venueId)}&t=${encodeURIComponent(parsed.tableId)}`
          );
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

  const placeKey = (v: VisitEntry) => `${v.venueId}:${v.tableId}`;

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

  return (
    <main className="min-h-screen bg-slate-50 p-4 pb-10 md:p-6" style={{ zoom: 0.75 }}>
      <div className="mx-auto flex max-w-md flex-col gap-5">
        {/* ——— Первый визит (есть venue + table) ——— */}
        {sessionFirstVisit ? (
          <>
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
                  Закреплённый официант появится, когда смена назначена на стол
                </p>
              ) : null}
              {!tableRecognized && firestoreDone && !isLoadingTable && (
                <p className="mt-2 text-center text-sm text-amber-700">
                  Стол не найден в системе — вызов недоступен
                </p>
              )}
            </header>

            {tableRecognized ? (
              <AdSpace
                id="main-gate"
                placement="main_gate"
                venueId={venueId || undefined}
                className="w-full"
              />
            ) : null}

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
          </>
        ) : (
          <>
            {/* ——— Повторное использование: лента ——— */}
            <header className="text-center">
              <h1 className="text-xl font-bold text-slate-900">Личный кабинет</h1>
              <p className="mt-1 text-xs text-slate-500">HeyWaiter</p>
            </header>

            {/* Блок 1: сканер */}
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                <QrCode className="h-4 w-4" />
                Сканер
              </h2>
              <p className="mb-3 text-sm text-slate-600">
                Отсканируйте QR на столе, чтобы перейти в режим «Первый визит»
              </p>
              <button
                type="button"
                onClick={openTableScanner}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <QrCode className="h-5 w-5" />
                Сканировать код
              </button>
            </section>

            <AdSpace placement="repeat_after_scan" className="w-full" />

            {/* Блок 2: Мои места */}
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                <MapPin className="h-4 w-4" />
                Мои места
              </h2>
              {visitHistory.length === 0 ? (
                <p className="text-sm text-slate-500">История посещений появится после первого визита за стол</p>
              ) : (
                <ul className="space-y-1">
                  {visitHistory.map((pl) => {
                    const key = placeKey(pl);
                    const open = expandedPlaceKey === key;
                    return (
                      <li key={key} className="rounded-xl border border-slate-100 bg-slate-50/80">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left text-sm"
                          onClick={() => setExpandedPlaceKey(open ? null : key)}
                        >
                          <span>
                            <span className="font-medium text-slate-900">{pl.venueName}</span>
                            <span className="text-slate-500"> · стол {pl.tableLabel}</span>
                          </span>
                          {open ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                          )}
                        </button>
                        {open && (
                          <div className="border-t border-slate-200 px-3 pb-3 pt-1">
                            <div className="grid gap-2 sm:grid-cols-3">
                              <button
                                type="button"
                                className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                onClick={() => toast("Бронь: скоро в приложении")}
                              >
                                <Calendar className="h-3.5 w-3.5" />
                                Бронь
                              </button>
                              <button
                                type="button"
                                className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                onClick={() => toast("Предзаказ: скоро")}
                              >
                                <ShoppingBag className="h-3.5 w-3.5" />
                                Предзаказ
                              </button>
                              <button
                                type="button"
                                className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                onClick={() => toast("Обратная связь: скоро")}
                              >
                                <MessageSquare className="h-3.5 w-3.5" />
                                Обратная связь
                              </button>
                            </div>
                            <button
                              type="button"
                              className="mt-2 w-full rounded-lg py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                              onClick={() =>
                                router.push(
                                  `/mini-app?v=${encodeURIComponent(pl.venueId)}&t=${encodeURIComponent(pl.tableId)}`
                                )
                              }
                            >
                              Открыть стол
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <AdSpace placement="repeat_after_places" className="w-full" />

            {/* Блок 3: Акции по населённому пункту */}
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                <Tag className="h-4 w-4" />
                Акции
              </h2>
              <label className="mb-3 block text-xs text-slate-500">
                Населённый пункт
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900"
                  list="mini-app-city-hints"
                  value={selectedCity}
                  onChange={(e) => persistCity(e.target.value)}
                  placeholder="Любой город мира"
                />
                <datalist id="mini-app-city-hints">
                  {AD_CITY_HINTS.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <ul className="max-h-56 space-y-2 overflow-y-auto text-sm">
                {promoRows.length === 0 ? (
                  <li className="text-slate-500">Нет данных по выбранному городу</li>
                ) : (
                  promoRows.map((row) => (
                    <li
                      key={row.id}
                      className="rounded-lg border border-slate-100 bg-slate-50/90 px-3 py-2"
                    >
                      <span className="font-medium text-slate-800">{row.name}</span>
                      {row.promo ? (
                        <p className="mt-1 text-xs text-slate-600">{row.promo}</p>
                      ) : (
                        <p className="mt-1 text-xs text-slate-400">Акции заведения — у персонала</p>
                      )}
                    </li>
                  ))
                )}
              </ul>
            </section>

            <AdSpace placement="repeat_after_promos" className="w-full" />

            {/* Блок 4: Рейтинг */}
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                <Star className="h-4 w-4 text-amber-500" />
                Рейтинг заведений
              </h2>
              <ul className="space-y-2 text-sm">
                {ratingRows.length === 0 ? (
                  <li className="text-slate-500">Загрузка…</li>
                ) : (
                  ratingRows.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2"
                    >
                      <span className="font-medium text-slate-800">{r.name}</span>
                      <span className="shrink-0 text-amber-700">
                        {r.count > 0 ? (
                          <>
                            ★ {r.avg.toFixed(1)} <span className="text-xs text-slate-400">({r.count})</span>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">нет отзывов</span>
                        )}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </section>

            <AdSpace placement="repeat_after_rating" className="w-full" />
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
