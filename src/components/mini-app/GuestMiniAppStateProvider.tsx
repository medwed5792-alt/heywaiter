"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import toast from "react-hot-toast";
import { db } from "@/lib/firebase";
import { parseStartParamPayload } from "@/lib/parse-start-param";
import { parseSotaStartappPayload } from "@/lib/sota-id";
import { resolveSotaStartappToVenueTable } from "@/lib/sota-resolve";
import { useVisitor } from "@/components/providers/VisitorProvider";
import { resolveUnifiedCustomerUid } from "@/lib/identity/customer-uid";
import type { ActiveSession, ActiveSessionParticipant, ActiveSessionParticipantStatus } from "@/lib/types";
import type { OrderStatus } from "@/lib/types";

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

function getTelegramWebApp(): TelegramWebAppInit | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebAppInit } }).Telegram?.WebApp;
}

function isTelegramContext(): boolean {
  if (typeof window === "undefined") return false;
  const tg = getTelegramWebApp();
  if (!tg) return false;
  const initData = typeof tg.initData === "string" ? tg.initData.trim() : "";
  return initData.length > 0;
}

function getStartParamFromTelegramWebApp(): string {
  const webApp = getTelegramWebApp();
  return webApp?.initDataUnsafe?.start_param?.trim() ?? "";
}

type GuestVisitEntry = {
  venueId: string;
  lastVisitAt?: unknown;
  totalVisits?: number;
};

type GuestOrderLine = {
  name: string;
  qty: number;
  unitPrice: number;
  totalAmount: number;
};

type GuestTableOrder = {
  id: string;
  orderNumber: number;
  status: OrderStatus | string;
  customerUid?: string;
  items: GuestOrderLine[];
};

function parseNumber(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function extractOrderItemsForUI(data: Record<string, unknown>): GuestOrderLine[] {
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items: GuestOrderLine[] = [];

  for (const i of rawItems) {
    const x = (i ?? {}) as Record<string, unknown>;
    const name =
      String(x.name ?? x.title ?? x.dishName ?? x.itemName ?? "").trim() ||
      "Позиция";
    const qty = Math.max(parseNumber(x.qty ?? x.quantity), 1);
    const unitPriceRaw = parseNumber(x.price ?? x.unitPrice);
    const totalRaw = parseNumber(x.amount ?? x.total);

    const totalAmount = totalRaw > 0 ? totalRaw : unitPriceRaw > 0 ? unitPriceRaw * qty : 0;
    const unitPrice = unitPriceRaw > 0 ? unitPriceRaw : qty > 0 ? totalAmount / qty : 0;

    items.push({ name, qty, unitPrice, totalAmount });
  }

  if (items.length > 0) return items;

  // Fallback: order without `items` array — try numeric fields.
  const total =
    parseNumber(data.amount) ||
    parseNumber(data.total) ||
    parseNumber(data.sum) ||
    parseNumber(data.price);

  if (total > 0) {
    items.push({ name: "Заказ", qty: 1, unitPrice: total, totalAmount: total });
  }

  return items;
}

function parseGuestTableOrder(docId: string, data: Record<string, unknown>): GuestTableOrder {
  const orderNumber = Math.max(1, Math.floor(parseNumber(data.orderNumber)));
  const status = typeof data.status === "string" ? data.status : "pending";
  const customerUid = typeof data.customerUid === "string" ? data.customerUid.trim() : undefined;
  const items = extractOrderItemsForUI(data);

  return {
    id: docId,
    orderNumber,
    status,
    customerUid,
    items,
  };
}

type GuestMiniAppContextValue = {
  guestIdentity: { sotaId: string | null; telegramUid: string | null; currentUid: string | null };
  currentLocation: { venueId: string | null; tableId: string | null };
  visitHistory: GuestVisitEntry[];
  activeSession: ActiveSession | null;
  participants: ActiveSessionParticipant[];
  currentTableOrders: GuestTableOrder[];
  isInitializing: boolean;
  isGuestBlocked: boolean;
  guestBlockedReason: string | null;
  switchLocation: (venueId: string | null, tableId: string | null) => Promise<void>;
  openTableScanner: () => void;
  openVenueMenu: (venueId: string) => void;
  refreshVisitHistory: () => Promise<void>;
  callWaiter: (reason: "menu" | "bill" | "help") => Promise<void>;
  requestBill: (type: "full" | "split") => Promise<void>;
};

const GuestMiniAppContext = createContext<GuestMiniAppContextValue | null>(null);

export function GuestMiniAppStateProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { visitorId } = useVisitor();

  const [currentLocation, setCurrentLocation] = useState<{ venueId: string | null; tableId: string | null }>({
    venueId: null,
    tableId: null,
  });
  const [visitHistory, setVisitHistory] = useState<GuestVisitEntry[]>([]);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [participants, setParticipants] = useState<ActiveSessionParticipant[]>([]);
  const [currentTableOrders, setCurrentTableOrders] = useState<GuestTableOrder[]>([]);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSdkReady, setIsSdkReady] = useState(false);
  const [isGuestBlocked, setIsGuestBlocked] = useState(false);
  const [guestBlockedReason, setGuestBlockedReason] = useState<string | null>(null);
  const checkInSyncRef = useRef<string | null>(null);
  const rootOrdersLoadedRef = useRef(false);
  const subOrdersLoadedRef = useRef(false);

  const telegramUid = useMemo(() => {
    if (typeof window === "undefined") return null;
    const tg = getTelegramWebApp();
    const id = tg?.initDataUnsafe?.user?.id;
    return id != null ? String(id) : null;
  }, []);

  const guestIdentity = useMemo(() => {
    const currentUid = resolveUnifiedCustomerUid({
      telegramUserId: telegramUid,
      anonymousId: visitorId?.trim() || null,
    });
    const webApp = getTelegramWebApp();
    const startParam = webApp?.initDataUnsafe?.start_param?.trim() ?? "";
    const sota = startParam ? parseSotaStartappPayload(startParam) : null;
    return {
      sotaId: sota?.venueSotaId ?? null,
      telegramUid,
      currentUid,
    };
  }, [telegramUid, visitorId]);

  const refreshVisitHistory = useCallback(async () => {
    const currentUid = guestIdentity.currentUid;
    if (!currentUid || currentLocation.venueId || currentLocation.tableId) {
      setVisitHistory([]);
      return;
    }
    try {
      const q = query(
        collection(db, "users", currentUid, "visits"),
        orderBy("lastVisitAt", "desc"),
        limit(5)
      );
      const snap = await getDocs(q);
      const entries = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          venueId: d.id,
          lastVisitAt: x.lastVisitAt,
          totalVisits: typeof x.totalVisits === "number" ? x.totalVisits : undefined,
        } satisfies GuestVisitEntry;
      });
      setVisitHistory(entries);
    } catch {
      setVisitHistory([]);
    }
  }, [guestIdentity.currentUid, currentLocation.venueId, currentLocation.tableId]);

  const switchLocation = useCallback(
    async (venueId: string | null, tableId: string | null) => {
      const nextVenueId = venueId?.trim() || null;
      const nextTableId = tableId?.trim() || null;
      setCurrentLocation({ venueId: nextVenueId, tableId: nextTableId });
      setActiveSession(null);
      setParticipants([]);
      setCurrentTableOrders([]);
      if (nextVenueId && !nextTableId) {
        setVisitHistory((prev) => {
          const deduped = prev.filter((v) => v.venueId !== nextVenueId);
          return [{ venueId: nextVenueId }, ...deduped].slice(0, 5);
        });
      }
      if (!nextVenueId && !nextTableId) {
        await refreshVisitHistory();
      }
    },
    [refreshVisitHistory]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const tg = getTelegramWebApp();
    if (!tg) {
      setIsSdkReady(true);
      return;
    }
    tg.ready?.();
    queueMicrotask(() => setIsSdkReady(true));
  }, []);

  useEffect(() => {
    if (!isSdkReady) return;
    const tg = getTelegramWebApp();
    const receiver = tg?.initDataUnsafe?.receiver?.username?.toLowerCase().trim() ?? "";
    if (receiver === "waitertalk_bot") {
      setIsGuestBlocked(true);
      setGuestBlockedReason("Гостевой режим недоступен в @waitertalk_bot");
      setIsInitializing(false);
      return;
    }

    const resolveRoute = async () => {
      const inTg = isTelegramContext();
      if (inTg) {
        const sp = getStartParamFromTelegramWebApp();
        if (sp) {
          const decoded = (() => {
            try {
              return decodeURIComponent(sp.trim());
            } catch {
              return sp.trim();
            }
          })();

          const sota = parseSotaStartappPayload(decoded);
          if (sota) {
            try {
              const resolved = await resolveSotaStartappToVenueTable(db, sota.venueSotaId, sota.tableRef);
              if (resolved) {
                await switchLocation(resolved.venueId, resolved.tableId || null);
                setIsInitializing(false);
                return;
              }
            } catch {
              // fallback to legacy parser below
            }
          }

          const payload = parseStartParamPayload(decoded);
          if (payload) {
            await switchLocation(payload.venueId, payload.tableId || null);
            setIsInitializing(false);
            return;
          }
        }
        await switchLocation(null, null);
        setIsInitializing(false);
        return;
      }

      const v = (searchParams.get("v") ?? "").trim();
      const t = (searchParams.get("t") ?? "").trim();
      if (v && t) {
        await switchLocation(v, t);
      } else {
        await switchLocation(null, null);
      }
      setIsInitializing(false);
    };

    void resolveRoute();
  }, [isSdkReady, searchParams, switchLocation]);

  // Poll table status. When the backend marks it as "closed" we return the guest to dashboard.
  useEffect(() => {
    if (!isSdkReady || !currentLocation.venueId || !currentLocation.tableId) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const q = query(
          collection(db, "activeSessions"),
          where("venueId", "==", currentLocation.venueId),
          where("tableId", "==", currentLocation.tableId),
          where("status", "==", "closed"),
          limit(1)
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        if (!snap.empty) {
          await switchLocation(currentLocation.venueId, null);
        }
      } catch {
        // best-effort polling
      }
    };

    void poll();
    const id = window.setInterval(() => {
      void poll();
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [currentLocation.venueId, currentLocation.tableId, isSdkReady, switchLocation]);

  useEffect(() => {
    if (!isSdkReady || !currentLocation.venueId || !currentLocation.tableId || !guestIdentity.currentUid) return;
    const key = `${currentLocation.venueId}:${currentLocation.tableId}:${guestIdentity.currentUid}`;
    if (checkInSyncRef.current === key) return;
    checkInSyncRef.current = key;
    (async () => {
      try {
        await fetch("/api/check-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            venueId: currentLocation.venueId,
            tableId: currentLocation.tableId,
            participantUid: guestIdentity.currentUid,
          }),
        });
      } catch {
        // session data will be updated by activeSessions snapshot
      }
    })();
  }, [currentLocation.venueId, currentLocation.tableId, guestIdentity.currentUid, isSdkReady]);

  // Live session data: masterId, isPrivate and participants.
  useEffect(() => {
    if (!isSdkReady || !currentLocation.venueId || !currentLocation.tableId) return;

    const q = query(
      collection(db, "activeSessions"),
      where("venueId", "==", currentLocation.venueId),
      where("tableId", "==", currentLocation.tableId),
      where("status", "==", "check_in_success"),
      limit(1)
    );

    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) {
        setActiveSession(null);
        setParticipants([]);
        return;
      }

      const d = (snap.docs[0]!.data() ?? {}) as Record<string, unknown>;
      const masterId = typeof d.masterId === "string" ? d.masterId.trim() : "";
      const isPrivate = typeof d.isPrivate === "boolean" ? d.isPrivate : true;

      const participantsRaw = Array.isArray(d.participants) ? d.participants : [];
      const parsedParticipants: ActiveSessionParticipant[] = participantsRaw
        .map((p) => {
          const x = (p ?? {}) as Record<string, unknown>;
          const uid = typeof x.uid === "string" ? x.uid.trim() : "";
          const statusRaw = x.status;
          const status: ActiveSessionParticipantStatus =
            statusRaw === "paid" || statusRaw === "exited" ? (statusRaw as ActiveSessionParticipantStatus) : "active";
          if (!uid) return null;
          return {
            uid,
            status,
            joinedAt: x.joinedAt ?? null,
            updatedAt: x.updatedAt ?? null,
          };
        })
        .filter(Boolean) as ActiveSessionParticipant[];

      const tableNumber = typeof d.tableNumber === "number" ? d.tableNumber : 0;
      const status = typeof d.status === "string" ? d.status : "check_in_success";

      const session: ActiveSession = {
        id: snap.docs[0]!.id,
        venueId: currentLocation.venueId,
        tableId: currentLocation.tableId,
        tableNumber,
        masterId: masterId || undefined,
        isPrivate,
        participants: parsedParticipants,
        status: status === "check_in_success" ? "check_in_success" : "check_in_success",
        createdAt: d.createdAt ?? null,
        updatedAt: d.updatedAt ?? null,
      };

      setActiveSession(session);
      setParticipants(parsedParticipants);
    });

    return () => unsub();
  }, [isSdkReady, currentLocation.venueId, currentLocation.tableId]);

  // Live orders data for the table.
  useEffect(() => {
    if (!isSdkReady || !currentLocation.venueId || !currentLocation.tableId) return;

    const venueId = currentLocation.venueId;
    const tableId = currentLocation.tableId;

    let rootOrders: GuestTableOrder[] = [];
    let subOrders: GuestTableOrder[] = [];

    const applyMerged = () => {
      if (rootOrdersLoadedRef.current && rootOrders.length > 0) {
        setCurrentTableOrders(rootOrders);
        return;
      }

      if (subOrdersLoadedRef.current && subOrders.length > 0) {
        setCurrentTableOrders(subOrders);
        return;
      }

      if (rootOrdersLoadedRef.current) {
        setCurrentTableOrders([]);
        return;
      }

      setCurrentTableOrders(subOrdersLoadedRef.current ? subOrders : []);
    };

    rootOrdersLoadedRef.current = false;
    subOrdersLoadedRef.current = false;

    const parseOrdersSnap = (snap: any): GuestTableOrder[] => {
      return snap.docs.map((d: any) => parseGuestTableOrder(d.id, d.data() as Record<string, unknown>));
    };

    // Root orders (current schema in this repo)
    const qRoot = query(
      collection(db, "orders"),
      where("venueId", "==", venueId),
      where("tableId", "==", tableId),
      where("status", "in", ["pending", "ready"])
    );
    const unsubRoot = onSnapshot(qRoot, (snap) => {
      rootOrders = parseOrdersSnap(snap);
      rootOrdersLoadedRef.current = true;
      applyMerged();
    });

    // Required subscription per spec: activeSessions/${venueId}_${tableId}/orders
    const docId = `${venueId}_${tableId}`;
    const ordersSubRef = collection(db, "activeSessions", docId, "orders");
    const unsubSub = onSnapshot(ordersSubRef, (snap) => {
      subOrders = parseOrdersSnap(snap);
      subOrdersLoadedRef.current = true;
      applyMerged();
    });

    return () => {
      unsubRoot();
      unsubSub();
    };
  }, [isSdkReady, currentLocation.venueId, currentLocation.tableId]);

  useEffect(() => {
    if (!isSdkReady || isInitializing || currentLocation.venueId || currentLocation.tableId) return;
    void refreshVisitHistory();
  }, [isSdkReady, isInitializing, currentLocation.venueId, currentLocation.tableId, refreshVisitHistory]);

  const openVenueMenu = useCallback(
    (venueId: string) => {
      void switchLocation(venueId, null);
    },
    [switchLocation]
  );

  const openTableScanner = useCallback(() => {
    const inTg = isTelegramContext();
    const tg = getTelegramWebApp();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (inTg && tg?.showScanQrPopup) {
      tg.showScanQrPopup({ text: "Наведите на QR стола" }, (qrText) => {
        void (async () => {
          const raw = String(qrText ?? "").trim();
          if (!raw) {
            toast.error("Неверный QR");
            return;
          }

          const resolveFromUrl = async (u: URL) => {
            const path = u.pathname || "";
            if (path.includes("/check-in") || path.includes("/mini-app")) {
              const v = u.searchParams.get("v") || u.searchParams.get("venueId");
              const t = u.searchParams.get("t") || u.searchParams.get("tableId") || u.searchParams.get("tableRef") || "";
              if (v && v.trim()) return { venueId: v.trim(), tableId: t.trim() };
            }
            const startapp = u.searchParams.get("startapp");
            if (startapp) {
              const decoded = (() => {
                try {
                  return decodeURIComponent(startapp.trim());
                } catch {
                  return startapp.trim();
                }
              })();
              const sota = parseSotaStartappPayload(decoded);
              if (sota) {
                const resolved = await resolveSotaStartappToVenueTable(db, sota.venueSotaId, sota.tableRef);
                if (resolved) return { venueId: resolved.venueId, tableId: resolved.tableId || "" };
              }
              const legacy = parseStartParamPayload(decoded);
              if (legacy) return { venueId: legacy.venueId, tableId: legacy.tableId };
            }
            return null;
          };

          const resolveFromText = async (text: string) => {
            try {
              if (/^https?:\/\//i.test(text)) return await resolveFromUrl(new URL(text));
              if (text.includes("heywaiter.vercel.app")) {
                const normalized = text.startsWith("heywaiter.vercel.app")
                  ? `https://${text}`
                  : `https://${text.replace(/^\/+/, "")}`;
                return await resolveFromUrl(new URL(normalized));
              }
            } catch {
              // ignore
            }

            const startappMatch = text.match(/startapp=([^&\s]+)/i);
            if (startappMatch?.[1]) {
              const rawToken = startappMatch[1];
              const decoded = (() => {
                try {
                  return decodeURIComponent(rawToken.trim());
                } catch {
                  return rawToken.trim();
                }
              })();
              const sota = parseSotaStartappPayload(decoded);
              if (sota) {
                const resolved = await resolveSotaStartappToVenueTable(db, sota.venueSotaId, sota.tableRef);
                if (resolved) return { venueId: resolved.venueId, tableId: resolved.tableId || "" };
              }
              const legacy = parseStartParamPayload(decoded);
              if (legacy) return { venueId: legacy.venueId, tableId: legacy.tableId };
            }

            const legacy = parseStartParamPayload(text);
            if (legacy) return { venueId: legacy.venueId, tableId: legacy.tableId };
            const sota = parseSotaStartappPayload(text);
            if (sota) {
              const resolved = await resolveSotaStartappToVenueTable(db, sota.venueSotaId, sota.tableRef);
              if (resolved) return { venueId: resolved.venueId, tableId: resolved.tableId || "" };
            }
            return null;
          };

          const resolved = await resolveFromText(raw);
          if (!resolved) {
            toast.error("Неверный QR");
            return;
          }
          await switchLocation(resolved.venueId, resolved.tableId || null);
          tg.close?.();
        })();
      });
      return;
    }
    if (inTg) {
      toast.error("Сканер QR недоступен в этой версии клиента. Обновите Telegram до последней версии.");
      return;
    }
    toast("Откройте приложение в Telegram для сканера QR", { icon: "ℹ️" });
    router.push(`${origin}/check-in`);
  }, [router, switchLocation]);

  const callWaiter = useCallback(
    async (reason: "menu" | "bill" | "help") => {
      if (isGuestBlocked) {
        toast.error(guestBlockedReason ?? "Гостевой режим заблокирован");
        return;
      }

      const venueId = currentLocation.venueId?.trim();
      const tableId = currentLocation.tableId?.trim();
      if (!venueId || !tableId) {
        toast.error("Стол не определен");
        return;
      }

      const type = reason === "bill" ? "request_bill" : "call_waiter";

      try {
        const res = await fetch("/api/call-waiter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ venueId, tableId, type }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || data.ok === false) throw new Error(data.error ?? "call-waiter failed");
        toast.success("Официант вызван!");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось вызвать официанта");
      }
    },
    [currentLocation.tableId, currentLocation.venueId, guestBlockedReason, isGuestBlocked]
  );

  const requestBill = useCallback(
    async (type: "full" | "split") => {
      if (isGuestBlocked) {
        toast.error(guestBlockedReason ?? "Гостевой режим заблокирован");
        return;
      }

      const venueId = currentLocation.venueId?.trim();
      const tableId = currentLocation.tableId?.trim();
      const uid = guestIdentity.currentUid?.trim();
      if (!venueId || !tableId || !uid) {
        toast.error("Не удалось определить гостя или стол");
        return;
      }

      try {
        const res = await fetch("/api/request-bill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ venueId, tableId, uid, type }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || data.ok === false) throw new Error(data.error ?? "request-bill failed");
        toast.success("Запрос счета отправлен");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось отправить запрос счета");
      }
    },
    [currentLocation.tableId, currentLocation.venueId, guestIdentity.currentUid, guestBlockedReason, isGuestBlocked]
  );

  const value = useMemo<GuestMiniAppContextValue>(
    () => ({
      guestIdentity,
      currentLocation,
      visitHistory,
      activeSession,
      participants,
      currentTableOrders,
      isInitializing,
      isGuestBlocked,
      guestBlockedReason,
      switchLocation,
      openTableScanner,
      openVenueMenu,
      refreshVisitHistory,
      callWaiter,
      requestBill,
    }),
    [
      guestIdentity,
      currentLocation,
      visitHistory,
      activeSession,
      participants,
      currentTableOrders,
      isInitializing,
      isGuestBlocked,
      guestBlockedReason,
      switchLocation,
      openTableScanner,
      openVenueMenu,
      refreshVisitHistory,
      callWaiter,
      requestBill,
    ]
  );

  return <GuestMiniAppContext.Provider value={value}>{children}</GuestMiniAppContext.Provider>;
}

export function useGuestContext(): GuestMiniAppContextValue {
  const ctx = useContext(GuestMiniAppContext);
  if (!ctx) {
    throw new Error("useGuestContext must be used within GuestMiniAppStateProvider");
  }
  return ctx;
}

export function useOptionalGuestContext(): GuestMiniAppContextValue | null {
  return useContext(GuestMiniAppContext);
}
