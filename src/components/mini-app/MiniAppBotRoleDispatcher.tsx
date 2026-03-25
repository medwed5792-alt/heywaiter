"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function normalizeBotUsername(raw: string | undefined | null): string {
  return (raw ?? "").trim().replace(/^@/, "").toLowerCase();
}

type BotRole = "staff" | "guest" | null;

const POLL_MS = 300;
const TOTAL_MS = 5000;

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
  try {
    tg.ready?.();
  } catch {
    // ignore
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
  const [status, setStatus] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    if (!isMiniAppRoute) {
      setRole(null);
      setStatus("ready");
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    setStatus("loading");

    const STAFF_ROUTE_PREFIX = "/mini-app/staff";
    const pathStaff = (pathname ?? "").startsWith(STAFF_ROUTE_PREFIX);

    const applyRole = (nextRole: BotRole) => {
      if (cancelled || !nextRole) return;
      setRole(nextRole);
      setStatus("ready");
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
      return () => {
        cancelled = true;
      };
    }

    const startedAt = Date.now();

    const tick = () => {
      if (cancelled) return;

      const { initData, receiverUsername } = readTelegramWebAppState();
      const fromRecv = roleFromReceiver(receiverUsername, staffBot, guestBot);

      if (fromRecv && initData.length > 0) {
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

  if (isMiniAppRoute && status === "loading") {
    return (
      <main className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <p className="text-sm text-slate-500">Загрузка (бот-контекст)…</p>
      </main>
    );
  }

  if (isMiniAppRoute && role == null) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <p className="text-sm text-slate-500">Загрузка (бот-контекст)…</p>
      </main>
    );
  }

  return <>{children}</>;
}
