"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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

function getTelegramUserIdFromTelegram(): string | null {
  if (typeof window === "undefined") return null;
  const tg = (window as unknown as { Telegram?: { WebApp?: any } }).Telegram?.WebApp;
  const id = tg?.initDataUnsafe?.user?.id;
  return id != null ? String(id) : null;
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

  // Служебные параметры наших ссылок.
  if (roleNorm === "staff" || botNorm === "staff") return "staff";
  if (roleNorm === "guest" || botNorm === "guest") return "guest";

  // Иногда могут прислать реальные usernames ботов.
  const botUsernameLike = normalizeBotUsername(rawBot);
  if (botUsernameLike && botUsernameLike === staffBot) return "staff";
  if (botUsernameLike && botUsernameLike === guestBot) return "guest";

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
  const [contextError, setContextError] = useState<{
    message: string;
    debug: Record<string, unknown>;
  } | null>(null);

  useEffect(() => {
    if (!isMiniAppRoute) {
      setRole(null);
      setStatus("ready");
      setContextError(null);
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setContextError(null);

    const STAFF_ROUTE_PREFIX = "/mini-app/staff";
    const deadline = Date.now() + 5000;

    const tick = async () => {
      if (cancelled) return;
      const receiverUsername = getReceiverUsernameFromTelegram();
      const telegramUserId = getTelegramUserIdFromTelegram();
      const nextRoleFromUrl = getRoleFromUrl(searchParams, staffBot, guestBot);
      const nextRoleFromReceiver: BotRole = receiverUsername
        ? receiverUsername === staffBot
          ? "staff"
          : receiverUsername === guestBot
            ? "guest"
            : null
        : null;
      const nextRole: BotRole = nextRoleFromUrl ?? nextRoleFromReceiver;

      const hasTelegramContext = Boolean(telegramUserId);

      if (nextRole && hasTelegramContext) {
        setRole(nextRole);
        setStatus("ready");
        setContextError(null);

        const isStaffRoute = (pathname ?? "").startsWith(STAFF_ROUTE_PREFIX);
        if (nextRole === "staff" && !isStaffRoute) {
          router.replace("/mini-app/staff?v=current");
          return;
        }
        if (nextRole === "guest" && isStaffRoute) {
          router.replace("/mini-app");
          return;
        }
        return;
      }

      // Ждём, пока Telegram WebApp SDK заполнит initDataUnsafe.
      if (Date.now() < deadline) {
        setTimeout(tick, 50);
        return;
      }

      setRole(null);
      setStatus("ready");
      setContextError({
        message: !hasTelegramContext
          ? "Telegram WebApp context не получен (initDataUnsafe.user.id отсутствует)"
          : "Роль бота не определена (staff/guest) за отведённое время",
        debug: {
          pathname,
          receiverUsername: receiverUsername || null,
          staffBot,
          guestBot,
          urlRole: searchParams.get("role"),
          urlBot: searchParams.get("bot"),
          telegramUserId: telegramUserId || null,
        },
      });
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
  }, [guestBot, isMiniAppRoute, pathname, router, searchParams, staffBot]);

  if (isMiniAppRoute && status === "loading") {
    return (
      <main className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <p className="text-sm text-slate-500">Загрузка (бот-контекст)…</p>
      </main>
    );
  }

  const onReload = () => {
    try {
      const tg = (window as unknown as { Telegram?: { WebApp?: any } }).Telegram?.WebApp;
      tg?.ready?.();
    } catch {
      // ignore
    }
    window.location.reload();
  };

  // “Железная” блокировка: если мы на mini-app маршруте и роль/контекст так и не определились,
  // не пускаем в UI, чтобы не было смешения гостя/персонала.
  if (isMiniAppRoute && role == null) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Не удалось инициализировать Telegram</h2>
          <p className="mt-2 text-sm text-slate-600">
            {contextError?.message ?? "Контекст Telegram не получен за отведённое время."}
          </p>
          <button
            type="button"
            onClick={onReload}
            className="mt-4 w-full rounded-xl bg-emerald-600 py-3 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Перезагрузить
          </button>
          <div className="mt-4">
            <p className="text-xs font-medium text-slate-500">Техлог</p>
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700 border border-slate-100">
              {JSON.stringify(contextError?.debug ?? { role, pathname }, null, 2)}
            </pre>
          </div>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}

