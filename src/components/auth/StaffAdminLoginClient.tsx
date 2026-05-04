"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth } from "@/lib/firebase";
import { getIdToken, onAuthStateChanged, signOut } from "firebase/auth";
import { safeStaffAdminNextPath } from "@/lib/auth/safe-staff-admin-redirect";

export type StaffAdminLoginClientProps = {
  defaultNext: string;
  title: string;
};

function LoginInner({ defaultNext, title }: StaffAdminLoginClientProps) {
  const router = useRouter();
  const sp = useSearchParams();
  const [msg, setMsg] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const next = safeStaffAdminNextPath(sp.get("next"), defaultNext);
    let cancelled = false;
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (cancelled) return;
      if (!u) {
        setChecking(false);
        return;
      }
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
        setChecking(false);
        if (r.ok && j.ok) {
          router.replace(next);
          return;
        }
        await fetch("/api/auth/clear-staff-session", { method: "POST", credentials: "same-origin" });
        if (r.status === 403) {
          setMsg("В Firestore для этого uid нет роли STAFF или ADMIN в global_users.");
          try {
            await signOut(auth);
          } catch {
            /* ignore */
          }
          return;
        }
        setMsg("Не удалось подтвердить сессию. Повторите попытку.");
      } catch {
        if (!cancelled) {
          setChecking(false);
          setMsg("Сетевая ошибка.");
        }
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [sp, router, defaultNext]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col justify-center gap-5 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          Доступ только если в коллекции{" "}
          <code className="rounded bg-gray-200/80 px-1.5 py-0.5 font-mono text-xs text-gray-800">
            global_users
          </code>{" "}
          есть документ с id = uid Firebase Auth и полем{" "}
          <code className="rounded bg-gray-200/80 px-1.5 py-0.5 font-mono text-xs text-gray-800">
            systemRole
          </code>{" "}
          со значением <span className="font-medium text-gray-800">STAFF</span> или{" "}
          <span className="font-medium text-gray-800">ADMIN</span>. Без записи в Firestore вход
          невозможен.
        </p>
      </div>
      {checking && !msg && (
        <p className="text-sm text-gray-500" aria-live="polite">
          Проверка доступа…
        </p>
      )}
      {msg && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {msg}
        </p>
      )}
    </div>
  );
}

export function StaffAdminLoginClient(props: StaffAdminLoginClientProps) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-lg px-4 py-10 text-sm text-gray-600" aria-busy="true">
          Загрузка…
        </div>
      }
    >
      <LoginInner {...props} />
    </Suspense>
  );
}
