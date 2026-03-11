"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useVisitor } from "@/components/providers/VisitorProvider";

const VISITOR_STORAGE_KEY = "heywaiter_visitor_id";
const MINIAPP_CACHE_VENUE = "heywaiter_miniapp_venue_id";
const MINIAPP_CACHE_TABLE = "heywaiter_miniapp_table_id";

/** Очистка закэшированных venue/table из localStorage при новом start_param */
function clearMiniappCache(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(MINIAPP_CACHE_VENUE);
    localStorage.removeItem(MINIAPP_CACHE_TABLE);
  } catch (_) {}
}

/** Тип для Telegram WebApp в мини-приложении (start_param, user.id есть только здесь). */
type TelegramWebAppInit = {
  initDataUnsafe?: { start_param?: string; user?: { id?: number } };
  ready?: () => void;
};

/** Парсинг start_param: "v_venueId_t_tableId" или "v_venueId_t_tableId_vid_visitorId" */
function parseStartParam(startParam: string): { venueId: string; tableId: string; visitorId?: string } | null {
  const s = startParam?.trim();
  if (!s) return null;
  const withVid = s.match(/^v_([^_]+)_t_([^_]+)_vid_(.+)$/);
  if (withVid) return { venueId: withVid[1], tableId: withVid[2], visitorId: withVid[3] };
  const vT = s.match(/^v_([^_]+)_t_(.+)$/);
  if (vT) return { venueId: vT[1], tableId: vT[2] };
  const parts = s.split("_");
  if (parts.length >= 2) return { venueId: parts[0], tableId: parts.slice(1).join("_") };
  return null;
}

function getStartParam(): string {
  if (typeof window === "undefined") return "";
  const tg = window.Telegram?.WebApp as TelegramWebAppInit | undefined;
  return tg?.initDataUnsafe?.start_param ?? "";
}

function MiniAppContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { setVisitorId } = useVisitor();
  const [venueId, setVenueId] = useState<string>("");
  const [tableId, setTableId] = useState<string>("");
  const [venueSettings, setVenueSettings] = useState<Record<string, unknown> | null>(null);
  const [tableSettings, setTableSettings] = useState<Record<string, unknown> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [firestoreDone, setFirestoreDone] = useState(false);
  const [fromTelegram, setFromTelegram] = useState(false);
  const lastAppliedStartParam = useRef<string>("");

  const forceResetTableAndLoad = useCallback((newVenueId: string, newTableId: string) => {
    lastAppliedStartParam.current = "";
    setVenueId(newVenueId);
    setTableId(newTableId);
    setVenueSettings(null);
    setTableSettings(null);
    setFirestoreDone(false);
    setFromTelegram(true);
  }, []);

  const applyStartParam = useCallback((startParam: string) => {
    if (!startParam.trim()) return false;
    const parsed = parseStartParam(startParam);
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
    setFromTelegram(true);
    return true;
  }, [setVisitorId]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.Telegram?.WebApp) {
      (window.Telegram.WebApp as TelegramWebAppInit).ready?.();
    }
  }, []);

  useEffect(() => {
    const startParam = getStartParam();
    const fromQueryV = (searchParams.get("v") ?? "").trim();
    const fromQueryT = (searchParams.get("t") ?? "").trim();

    if (typeof window !== "undefined" && startParam) {
      clearMiniappCache();
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
  }, [searchParams, applyStartParam, forceResetTableAndLoad, venueId, tableId]);

  useEffect(() => {
    const t = setTimeout(() => {
      const startParam = getStartParam();
      if (startParam && startParam !== lastAppliedStartParam.current) {
        applyStartParam(startParam);
      }
    }, 150);
    return () => clearTimeout(t);
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
          const byDocId = await getDoc(doc(db, "tables", tableId));
          if (cancelled) return;
          if (byDocId.exists()) {
            tableData = byDocId.data() as Record<string, unknown>;
            const docVenueId = tableData?.venueId as string | undefined;
            if (docVenueId && !resolvedVenueId) {
              resolvedVenueId = docVenueId;
              setVenueId(docVenueId);
              const venueSnap = await getDoc(doc(db, "venues", docVenueId));
              if (!cancelled && venueSnap.exists()) {
                setVenueSettings(venueSnap.data() as Record<string, unknown>);
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
    return () => { cancelled = true; };
  }, [venueId, tableId]);

  useEffect(() => {
    if (!loaded || !firestoreDone) return;
    const v = (venueId || searchParams.get("v")) ?? "";
    const t = (tableId || searchParams.get("t")) ?? "";
    const role = searchParams.get("role") ?? "";

    // Жёсткое разделение: при наличии t — всегда гость; иначе при role=staff — кабинет персонала
    if (role === "staff" && !t && !tableId) {
      router.replace(`/mini-app/staff?${new URLSearchParams({ v: v || "current" }).toString()}`);
      return;
    }

    if (!v || !t) return;

    const chatId = typeof window !== "undefined" ? (window.Telegram?.WebApp as TelegramWebAppInit | undefined)?.initDataUnsafe?.user?.id : undefined;
    const params = new URLSearchParams();
    params.set("v", v);
    params.set("t", t);
    try {
      const vid = typeof localStorage !== "undefined" ? localStorage.getItem(VISITOR_STORAGE_KEY) : null;
      if (vid) params.set("vid", vid);
    } catch (_) {}
    if (chatId) params.set("chatId", String(chatId));
    params.set("platform", searchParams.get("platform") || "telegram");
    router.replace(`/check-in/panel?${params.toString()}`);
  }, [loaded, firestoreDone, venueId, tableId, searchParams, router]);

  const venueName = (venueSettings?.name as string) ?? venueId;
  const tableNumber = (tableSettings?.tableNumber as number) ?? tableId;

  const isLoadingTable = Boolean(tableId && !firestoreDone);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6" style={{ zoom: 0.75 }}>
      <p className="text-gray-500">
        {isLoadingTable ? (
          "Загрузка стола…"
        ) : fromTelegram && venueId ? (
          <>Загрузка {venueName}{tableId ? ` · Стол ${tableNumber || tableId}` : ""}…</>
        ) : (
          "Открытие пульта…"
        )}
      </p>
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
