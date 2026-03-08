"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, Suspense } from "react";

/**
 * Алиас для Mini App: /mini-app?v=venueId&t=tableId&... → редирект на /check-in/panel с теми же параметрами.
 * Используется в Deep Link и в кнопке бота (URL Mini App с параметрами).
 */
function RedirectContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    const q = searchParams.toString();
    router.replace(q ? `/check-in/panel?${q}` : "/check-in/panel");
  }, [searchParams, router]);
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50">
      <p className="text-gray-500">Открытие пульта…</p>
    </main>
  );
}

export default function MiniAppRedirect() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-slate-50"><p className="text-gray-500">Загрузка…</p></main>}>
      <RedirectContent />
    </Suspense>
  );
}
