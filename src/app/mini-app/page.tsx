"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";

/** Тип для Telegram WebApp в мини-приложении (start_param, user.id есть только здесь). */
type TelegramWebAppInit = {
  initDataUnsafe?: { start_param?: string; user?: { id?: number } };
};

/** Парсинг start_param: "test_1" → { venueId: "test", tableId: "1" }; также "v_venueId_t_tableId" */
function parseStartParam(startParam: string): { venueId: string; tableId: string } | null {
  const s = startParam?.trim();
  if (!s) return null;
  const vT = s.match(/^v_([^_]+)_t_(.+)$/);
  if (vT) return { venueId: vT[1], tableId: vT[2] };
  const parts = s.split("_");
  if (parts.length >= 2) return { venueId: parts[0], tableId: parts.slice(1).join("_") };
  return null;
}

function MiniAppContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [venueId, setVenueId] = useState<string>("");
  const [tableId, setTableId] = useState<string>("");
  const [venueSettings, setVenueSettings] = useState<Record<string, unknown> | null>(null);
  const [tableSettings, setTableSettings] = useState<Record<string, unknown> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [firestoreDone, setFirestoreDone] = useState(false);
  const [fromTelegram, setFromTelegram] = useState(false);

  useEffect(() => {
    const tg = typeof window !== "undefined" ? (window.Telegram?.WebApp as TelegramWebAppInit | undefined) : undefined;
    const startParam = tg?.initDataUnsafe?.start_param;
    const fromQueryV = searchParams.get("v") ?? "";
    const fromQueryT = searchParams.get("t") ?? "";

    if (startParam) {
      const parsed = parseStartParam(startParam);
      if (parsed) {
        setVenueId(parsed.venueId);
        setTableId(parsed.tableId);
        setFromTelegram(true);
      } else {
        setLoaded(true);
        setFirestoreDone(true);
      }
    }
    if (fromQueryV && fromQueryT && !startParam) {
      setVenueId(fromQueryV);
      setTableId(fromQueryT);
    }
    if (!startParam && !fromQueryV) {
      setLoaded(true);
      setFirestoreDone(true);
    }
    setLoaded(true);
  }, [searchParams]);

  useEffect(() => {
    if (!venueId) {
      setFirestoreDone(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const venueSnap = await getDoc(doc(db, "venues", venueId));
        if (cancelled) return;
        if (venueSnap.exists()) {
          setVenueSettings(venueSnap.data() as Record<string, unknown>);
        }
        if (tableId) {
          const tablesSnap = await getDocs(
            query(
              collection(db, "tables"),
              where("venueId", "==", venueId),
              where("tableId", "==", tableId)
            )
          );
          if (cancelled) return;
          const first = tablesSnap.docs[0];
          if (first?.exists()) {
            setTableSettings(first.data() as Record<string, unknown>);
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
    const chatId = typeof window !== "undefined" ? (window.Telegram?.WebApp as TelegramWebAppInit | undefined)?.initDataUnsafe?.user?.id : undefined;
    const params = new URLSearchParams(searchParams.toString());
    if (v) params.set("v", v);
    if (t) params.set("t", t);
    if (chatId) params.set("chatId", String(chatId));
    if (!params.has("platform")) params.set("platform", "telegram");
    router.replace(`/check-in/panel?${params.toString()}`);
  }, [loaded, firestoreDone, venueId, tableId, searchParams, router]);

  const venueName = (venueSettings?.name as string) ?? venueId;
  const tableNumber = (tableSettings?.tableNumber as number) ?? tableId;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6" style={{ zoom: 0.75 }}>
      <p className="text-gray-500">
        {fromTelegram && venueId ? (
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
