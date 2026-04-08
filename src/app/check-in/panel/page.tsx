"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LegacyGuestPanelRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

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
      <p className="text-slate-500">Перенаправление в Mini App…</p>
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
