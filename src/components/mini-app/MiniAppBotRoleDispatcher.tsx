"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HEYWAITER_STAFF_LS_SOTA_ID } from "@/components/providers/StaffProvider";

function normalizeBotUsername(raw: string | undefined | null): string {
  return (raw ?? "").trim().replace(/^@/, "").toLowerCase();
}

export type MiniAppResolvedBotRole = "staff" | "guest";

type BotRole = MiniAppResolvedBotRole | null;

const POLL_MS = 300;
const TOTAL_MS = 5000;

const STAFF_ROUTE_PREFIX = "/mini-app/staff";

export type MiniAppBotRoleContextValue = {
  /** Роль после идентификации; null на splash/ошибке внутри mini-app. */
  role: BotRole;
  identificationFailed: boolean;
};

const MiniAppBotRoleContext = createContext<MiniAppBotRoleContextValue | null>(null);

export function useMiniAppBotRole(): MiniAppBotRoleContextValue {
  const v = useContext(MiniAppBotRoleContext);
  if (!v) {
    throw new Error("useMiniAppBotRole должен вызываться внутри MiniAppBotRoleDispatcher");
  }
  return v;
}

/** Чтение состояния WebApp; для роли по боту достаточно receiver — initData не обязателен. */
function readTelegramWebAppState(): {
  initData: string;
  receiverUsername: string;
  userId: string | null;
} {
  if (typeof window === "undefined") {
    return { initData: "", receiverUsername: "", userId: null };
  }
  const tg = (window as unknown as { Telegram?: { WebApp?: any } }).Telegram?.WebApp;
  if (!tg) {
    return { initData: "", receiverUsername: "", userId: null };
  }
  const initData = typeof tg.initData === "string" ? tg.initData.trim() : "";
  const receiverUsername = normalizeBotUsername(
    typeof tg.initDataUnsafe?.receiver?.username === "string"
      ? tg.initDataUnsafe.receiver.username
      : undefined
  );
  let userId: string | null = null;
  const unsafeId = tg.initDataUnsafe?.user?.id;
  if (unsafeId != null) {
    userId = String(unsafeId);
  } else if (initData) {
    try {
      const params = new URLSearchParams(initData);
      const userJson = params.get("user");
      if (userJson) {
        const u = JSON.parse(userJson) as { id?: number | string };
        if (u?.id != null) userId = String(u.id);
      }
    } catch {
      // ignore
    }
  }
  return { initData, receiverUsername, userId };
}

function getRoleFromUrl(
  searchParams: Pick<URLSearchParams, "get">,
  staffBot: string,
  guestBot: string
): BotRole {
  const rawRole = searchParams.get("role")?.trim() ?? "";
  const rawBot = searchParams.get("bot")?.trim() ?? "";

  const roleNorm = rawRole.toLowerCase();
  const botNorm = rawBot.toLowerCase();

  if (roleNorm === "staff" || botNorm === "staff") return "staff";
  if (roleNorm === "guest" || botNorm === "guest") return "guest";

  const botUsernameLike = normalizeBotUsername(rawBot);
  if (botUsernameLike && botUsernameLike === staffBot) return "staff";
  if (botUsernameLike && botUsernameLike === guestBot) return "guest";

  return null;
}

function roleFromReceiver(receiverUsername: string, staffBot: string, guestBot: string): BotRole {
  if (!receiverUsername) return null;
  if (receiverUsername === staffBot) return "staff";
  if (receiverUsername === guestBot) return "guest";
  return null;
}

function hasStaffSotaInStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = localStorage.getItem(HEYWAITER_STAFF_LS_SOTA_ID)?.trim();
    return Boolean(v);
  } catch {
    return false;
  }
}

type TimeoutDecision = { kind: "role"; role: MiniAppResolvedBotRole } | { kind: "failed" };

function decideRoleAfterTimeout(
  searchParams: Pick<URLSearchParams, "get">,
  staffBot: string,
  guestBot: string,
  pathStaff: boolean
): TimeoutDecision {
  const fromUrl = getRoleFromUrl(searchParams, staffBot, guestBot);
  if (fromUrl) return { kind: "role", role: fromUrl };

  const { receiverUsername } = readTelegramWebAppState();
  const fromRecv = roleFromReceiver(receiverUsername, staffBot, guestBot);
  if (fromRecv) return { kind: "role", role: fromRecv };

  if (pathStaff) return { kind: "role", role: "staff" };

  if (hasStaffSotaInStorage()) return { kind: "role", role: "staff" };

  return { kind: "failed" };
}

/** Нейтральный экран до идентификации бота (железная изоляция от гостевого UI). */
export function MiniAppIdentifyingFallback() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[#fafafa] px-6">
      <div className="flex w-full max-w-[280px] flex-col items-center gap-8">
        <div className="text-center">
          <span className="text-2xl font-semibold tracking-[0.22em] text-slate-800">SOTA</span>
          <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
            HeyWaiter
          </p>
        </div>
        <div className="w-full space-y-3" aria-hidden>
          <div className="mx-auto h-2.5 w-3/4 animate-pulse rounded-full bg-slate-200/95" />
          <div className="h-2.5 w-full animate-pulse rounded-full bg-slate-200/85" />
          <div className="mx-auto h-2.5 w-5/6 animate-pulse rounded-full bg-slate-200/85" />
        </div>
      </div>
    </main>
  );
}

function MiniAppIdentificationFailedScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[#fafafa] px-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm text-center">
        <p className="text-2xl font-semibold tracking-[0.18em] text-slate-800">SOTA</p>
        <h1 className="mt-4 text-base font-semibold text-slate-900">Режим не определён</h1>
        <p className="mt-2 text-sm text-slate-600">
          Не удалось распознать бота Mini App. Откройте приложение из Telegram (@waitertalk_bot или гостевого бота)
          или повторите попытку.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Попробовать снова
        </button>
      </div>
    </main>
  );
}

function Provider({
  value,
  children,
}: {
  value: MiniAppBotRoleContextValue;
  children: ReactNode;
}) {
  return (
    <MiniAppBotRoleContext.Provider value={value}>{children}</MiniAppBotRoleContext.Provider>
  );
}

export function MiniAppBotRoleDispatcher({ children }: { children: React.ReactNode }) {
  const nextPathname = usePathname() ?? "";
  const pathname =
    typeof window !== "undefined" && window.location.pathname
      ? window.location.pathname
      : nextPathname;

  const router = useRouter();
  const searchParams = useSearchParams();

  const staffBot = useMemo(
    () => normalizeBotUsername(process.env.NEXT_PUBLIC_STAFF_BOT_USERNAME),
    []
  );
  const guestBot = useMemo(
    () => normalizeBotUsername(process.env.NEXT_PUBLIC_GUEST_BOT_USERNAME),
    []
  );

  const isMiniAppRoute = useMemo(() => {
    const p = pathname;
    return p === "/mini-app" || p.startsWith("/mini-app/");
  }, [pathname]);

  const [role, setRole] = useState<BotRole>(null);
  const [identificationFailed, setIdentificationFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const isIdentifying = isMiniAppRoute && role == null && !identificationFailed;

  useLayoutEffect(() => {
    if (!isMiniAppRoute) {
      setRole(null);
      setIdentificationFailed(false);
      return;
    }

    try {
      (window as unknown as { Telegram?: { WebApp?: { ready?: () => void } } }).Telegram?.WebApp?.ready?.();
    } catch {
      // ignore
    }

    setRole(null);
    setIdentificationFailed(false);

    const pathStaff = pathname.startsWith(STAFF_ROUTE_PREFIX);

    const applyRole = (nextRole: MiniAppResolvedBotRole) => {
      setRole(nextRole);
      const isStaffRoute = pathname.startsWith(STAFF_ROUTE_PREFIX);
      if (nextRole === "staff" && !isStaffRoute) {
        router.replace("/mini-app/staff?v=current");
        return;
      }
      if (nextRole === "guest" && isStaffRoute) {
        router.replace("/mini-app");
      }
    };

    const urlRoleImmediate = getRoleFromUrl(searchParams, staffBot, guestBot);
    if (urlRoleImmediate) {
      applyRole(urlRoleImmediate);
      return;
    }

    const { receiverUsername: recvNow } = readTelegramWebAppState();
    const fromRecvNow = roleFromReceiver(recvNow, staffBot, guestBot);
    if (fromRecvNow) {
      applyRole(fromRecvNow);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    const tick = () => {
      if (cancelled) return;

      const { receiverUsername } = readTelegramWebAppState();
      const fromRecv = roleFromReceiver(receiverUsername, staffBot, guestBot);
      if (fromRecv) {
        applyRole(fromRecv);
        return;
      }

      if (Date.now() - startedAt >= TOTAL_MS) {
        const decision = decideRoleAfterTimeout(searchParams, staffBot, guestBot, pathStaff);
        if (decision.kind === "failed") {
          setIdentificationFailed(true);
          return;
        }
        applyRole(decision.role);
        return;
      }

      timeoutId = setTimeout(tick, POLL_MS);
    };

    tick();

    return () => {
      cancelled = true;
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [
    guestBot,
    isMiniAppRoute,
    pathname,
    router,
    searchParams,
    staffBot,
    retryNonce,
  ]);

  const ctxValue: MiniAppBotRoleContextValue = useMemo(
    () => ({
      role: isMiniAppRoute ? role : null,
      identificationFailed: isMiniAppRoute ? identificationFailed : false,
    }),
    [identificationFailed, isMiniAppRoute, role]
  );

  if (!isMiniAppRoute) {
    return <Provider value={ctxValue}>{children}</Provider>;
  }

  // Hard silence screen: never render guest/staff content while role and route are inconsistent.
  const isStaffRoute = pathname.startsWith(STAFF_ROUTE_PREFIX);
  const routeMismatch =
    (role === "staff" && !isStaffRoute) || (role === "guest" && isStaffRoute);

  if (identificationFailed) {
    return (
      <Provider value={ctxValue}>
        <MiniAppIdentificationFailedScreen onRetry={() => setRetryNonce((n) => n + 1)} />
      </Provider>
    );
  }

  if (isIdentifying) {
    return (
      <Provider value={ctxValue}>
        <MiniAppIdentifyingFallback />
      </Provider>
    );
  }

  if (routeMismatch) {
    return (
      <Provider value={ctxValue}>
        <MiniAppIdentifyingFallback />
      </Provider>
    );
  }

  return <Provider value={ctxValue}>{children}</Provider>;
}
