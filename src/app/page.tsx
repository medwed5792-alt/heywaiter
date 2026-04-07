"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { QrCode } from "lucide-react";

function isTelegramMiniAppContext(): boolean {
  if (typeof window === "undefined") return false;
  const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp;
  const initData = typeof tg?.initData === "string" ? tg.initData.trim() : "";
  return initData.length > 0;
}

function RootGuardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (isTelegramMiniAppContext()) {
      const qs = searchParams.toString();
      router.replace(qs ? `/mini-app?${qs}` : "/mini-app");
    }
  }, [router, searchParams]);

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <QrCode className="h-10 w-10 text-slate-400" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold text-slate-900">HeyWaiter</h1>
        <p className="mt-2 text-sm text-slate-600">
          Откройте Mini App из Telegram, чтобы продолжить вход гостя по QR.
        </p>
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
