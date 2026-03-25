"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

function normalizeBotUsername(raw: string | undefined | null): string {
  return (raw ?? "").trim().replace(/^@/, "").toLowerCase();
}

type BotRole = "staff" | "guest" | null;

function getReceiverUsernameFromTelegram(): string {
  if (typeof window === "undefined") return "";
  const tg = (window as unknown as { Telegram?: { WebApp?: any } }).Telegram?.WebApp;
  const username = tg?.initDataUnsafe?.receiver?.username;
  return normalizeBotUsername(typeof username === "string" ? username : undefined);
}

export function MiniAppBotRoleDispatcher({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

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
    setStatus("loading");

    const STAFF_ROUTE_PREFIX = "/mini-app/staff";
    const deadline = Date.now() + 2500;

    const tick = async () => {
      if (cancelled) return;
      const receiverUsername = getReceiverUsernameFromTelegram();
      if (receiverUsername) {
        const nextRole: BotRole =
          receiverUsername === staffBot ? "staff" : receiverUsername === guestBot ? "guest" : null;
        if (!nextRole) {
          setRole(null);
          setStatus("ready");
          return;
        }

        setRole(nextRole);
        setStatus("ready");

        const isStaffRoute = (pathname ?? "").startsWith(STAFF_ROUTE_PREFIX);
        const isGuestRoute = (pathname ?? "") === "/mini-app";

        if (nextRole === "staff" && !isStaffRoute) {
          router.replace("/mini-app/staff?v=current");
          return;
        }
        if (nextRole === "guest" && isStaffRoute) {
          router.replace("/mini-app");
          return;
        }
        // If it's already the correct section — do nothing.
        if (nextRole === "guest" && (isGuestRoute || !isStaffRoute)) return;
      }

      // Wait for Telegram to populate initDataUnsafe.receiver.username
      if (Date.now() < deadline) {
        setTimeout(tick, 50);
        return;
      }

      // Role couldn't be determined in time: block render on purpose.
      setRole(null);
      setStatus("ready");
    };

    // Подталкиваем Telegram WebApp SDK к инициализации.
    try {
      const tg = (window as unknown as { Telegram?: { WebApp?: any } }).Telegram?.WebApp;
      tg?.ready?.();
    } catch {
      // ignore
    }

    tick();

    return () => {
      cancelled = true;
    };
  }, [guestBot, isMiniAppRoute, pathname, router, staffBot]);

  if (isMiniAppRoute && status === "loading") {
    return (
      <main className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <p className="text-sm text-slate-500">Загрузка (бот-контекст)…</p>
      </main>
    );
  }

  // “Железная” блокировка: если мы на mini-app маршруте и роль так и не определилась,
  // не пускаем в UI, чтобы не было смешения гостя/персонала.
  if (isMiniAppRoute && role == null) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <p className="text-sm text-slate-500">Ожидание контекста Telegram…</p>
      </main>
    );
  }

  return <>{children}</>;
}

