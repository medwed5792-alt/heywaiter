"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LegacyGuestPanelRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const guestBotUsername = (process.env.NEXT_PUBLIC_GUEST_BOT_USERNAME ?? "").trim();
  const miniAppName = (process.env.NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME ?? "").trim();
  const telegramDeepLink = useMemo(() => {
    const v = (searchParams.get("v") ?? searchParams.get("venueId") ?? "").trim();
    const t = (searchParams.get("t") ?? searchParams.get("tableId") ?? "").trim();
    if (!v || !t) return null;
    const bot = (guestBotUsername || "HeyWaiter_bot").replace(/^@/, "");
    const miniName = miniAppName || "waiter";
    const startapp = `v_${v}_t_${t}`;
    return `https://t.me/${bot}/${miniName}?startapp=${encodeURIComponent(startapp)}`;
  }, [searchParams, guestBotUsername, miniAppName]);

  useEffect(() => {
    if (guestBotUsername && miniAppName) return;
    console.warn("[guest-entry] Telegram deep link env missing", {
      NEXT_PUBLIC_GUEST_BOT_USERNAME: Boolean(guestBotUsername),
      NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME: Boolean(miniAppName),
    });
  }, [guestBotUsername, miniAppName]);

  useEffect(() => {
    const v = (searchParams.get("v") ?? searchParams.get("venueId") ?? "").trim();
    const t = (searchParams.get("t") ?? searchParams.get("tableId") ?? "").trim();
    if (v && t) {
      router.replace(`/mini-app?v=${encodeURIComponent(v)}&t=${encodeURIComponent(t)}`);
      return;
    }
    router.replace("/check-in");
  }, [router, searchParams]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-slate-600">Перенаправление в Mini App…</p>
        {telegramDeepLink ? (
          <a
            href={telegramDeepLink}
            className="mt-4 inline-flex rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Открыть в Telegram со столом
          </a>
        ) : null}
      </div>
    </main>
  );
}

export default function GuestPanelPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-50">
          <p className="text-slate-500">Загрузка…</p>
        </main>
      }
    >
      <LegacyGuestPanelRedirect />
    </Suspense>
  );
}
