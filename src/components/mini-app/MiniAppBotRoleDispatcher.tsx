"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function normalizeBotUsername(raw: string | undefined | null): string {
  return (raw ?? "").trim().replace(/^@/, "").toLowerCase();
}

type BotRole = "staff" | "guest" | null;

const POLL_MS = 300;
const TOTAL_MS = 5000;

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

export function MiniAppBotRoleDispatcher({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
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
    const p = pathname ?? "";
    return p === "/mini-app" || p.startsWith("/mini-app/");
  }, [pathname]);

  const [role, setRole] = useState<BotRole>(null);

  /** Пока роль не определена на mini-app — не монтируем гостевой/рабочий UI (только нейтральный экран). */
  const isIdentifying = isMiniAppRoute && role == null;

  useLayoutEffect(() => {
    if (!isMiniAppRoute) {
      setRole(null);
      return;
    }

    try {
      (window as unknown as { Telegram?: { WebApp?: { ready?: () => void } } }).Telegram?.WebApp?.ready?.();
    } catch {
      // ignore
    }

    setRole(null);

    const STAFF_ROUTE_PREFIX = "/mini-app/staff";
    const pathStaff = (pathname ?? "").startsWith(STAFF_ROUTE_PREFIX);

    const applyRole = (nextRole: BotRole) => {
      if (!nextRole) return;
      setRole(nextRole);
      const isStaffRoute = (pathname ?? "").startsWith(STAFF_ROUTE_PREFIX);
      if (nextRole === "staff" && !isStaffRoute) {
        router.replace("/mini-app/staff?v=current");
        return;
      }
      if (nextRole === "guest" && isStaffRoute) {
        router.replace("/mini-app");
      }
    };

    const decideRoleAfterTimeout = (): BotRole => {
      const fromUrl = getRoleFromUrl(searchParams, staffBot, guestBot);
      if (fromUrl) return fromUrl;
      const { receiverUsername } = readTelegramWebAppState();
      const fromRecv = roleFromReceiver(receiverUsername, staffBot, guestBot);
      if (fromRecv) return fromRecv;
      return pathStaff ? "staff" : "guest";
    };

    const urlRoleImmediate = getRoleFromUrl(searchParams, staffBot, guestBot);
    if (urlRoleImmediate) {
      applyRole(urlRoleImmediate);
      return;
    }

    // 1) Приоритет: receiver.username (waitertalk_bot / гостевой бот) — без ожидания initData.
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
        applyRole(decideRoleAfterTimeout());
        return;
      }

      timeoutId = setTimeout(tick, POLL_MS);
    };

    tick();

    return () => {
      cancelled = true;
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [guestBot, isMiniAppRoute, pathname, router, searchParams, staffBot]);

  if (isIdentifying) {
    return <MiniAppIdentifyingFallback />;
  }

  return <>{children}</>;
}
