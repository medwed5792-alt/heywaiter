"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { QrCode } from "lucide-react";
import { hasTelegramWebAppInitData } from "@/lib/telegram-webapp-user";

function RootGuardContent() {
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
    if (!hasTelegramWebAppInitData()) return;
    const v = (searchParams.get("v") ?? searchParams.get("venueId") ?? "").trim();
    const t = (searchParams.get("t") ?? searchParams.get("tableId") ?? "").trim();
    if (v && t) {
      router.replace(`/mini-app?v=${encodeURIComponent(v)}&t=${encodeURIComponent(t)}`);
      return;
    }
    // Стол в URL отсутствует — только /mini-app подхватит start_param из deep link бота.
    router.replace("/mini-app");
  }, [router, searchParams]);

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <QrCode className="h-10 w-10 text-slate-400" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold text-slate-900">HeyWaiter</h1>
        <p className="mt-2 text-sm text-slate-600">
          Откройте Mini App из Telegram, чтобы продолжить вход гостя по QR.
        </p>
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

export default function RootPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-50">
          <p className="text-slate-500">Загрузка…</p>
        </main>
      }
    >
      <RootGuardContent />
    </Suspense>
  );
}
