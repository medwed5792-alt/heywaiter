"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth } from "@/lib/firebase";
import { getIdToken, onAuthStateChanged } from "firebase/auth";
import { safeStaffAdminNextPath } from "@/lib/auth/safe-staff-admin-redirect";

function LoginInner({ defaultNext }: { defaultNext: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const next = safeStaffAdminNextPath(sp.get("next"), defaultNext);
    let cancelled = false;
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u || cancelled) return;
      try {
        const token = await getIdToken(u);
        const r = await fetch("/api/auth/sync-staff-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: token }),
          credentials: "same-origin",
        });
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean };
        if (cancelled) return;
        if (r.ok && j.ok) {
          router.replace(next);
          return;
        }
        if (r.status === 403) {
          setMsg("В global_users нет роли STAFF или ADMIN для этого аккаунта Firebase.");
          return;
        }
        setMsg("Не удалось подтвердить сессию. Повторите попытку.");
      } catch {
        if (!cancelled) setMsg("Сетевая ошибка.");
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [sp, router, defaultNext]);

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-8">
      <h1 className="text-xl font-semibold text-gray-900">Вход персонала</h1>
      <p className="text-sm text-gray-600">
        Доступ выдаётся только по документу{" "}
        <code className="rounded bg-gray-100 px-1 text-xs">global_users/&lt;uid&gt;</code> с полем{" "}
        <code className="rounded bg-gray-100 px-1 text-xs">systemRole</code>: STAFF или ADMIN (uid =
        Firebase Auth).
      </p>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </div>
  );
}

export function StaffAdminLoginClient({ defaultNext }: { defaultNext: string }) {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-600">Загрузка…</div>}>
      <LoginInner defaultNext={defaultNext} />
    </Suspense>
  );
}
