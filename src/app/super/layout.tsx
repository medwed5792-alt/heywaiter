"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SuperSidebar } from "@/components/super/SuperSidebar";
import { auth, signInAnonymously } from "@/lib/firebase";
import { getIdToken } from "firebase/auth";

const SUPERADMIN_ROLE_KEY = "heywaiter_admin_role";
const LOGIN_PATH = "/super/login";

/**
 * Интерфейс №4: Кабинет Супер-Админа (Центр управления полётами).
 * Доступ только для UID в super_admins (isSuperAdmin=true). Остальных редирект на /super/login.
 * Страница /super/login исключена из проверки, чтобы не было бесконечного редиректа.
 */
export default function SuperLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [denyReason, setDenyReason] = useState<string | null>(null);

  const isLoginPage = pathname === LOGIN_PATH;

  useEffect(() => {
    if (isLoginPage) {
      setAllowed(true);
      return;
    }
    let cancelled = false;
    setAllowed(null);
    setDenyReason(null);

    (async () => {
      const role =
        typeof window !== "undefined"
          ? (localStorage.getItem(SUPERADMIN_ROLE_KEY) ?? "").toLowerCase()
          : "";
      if (role !== "superadmin") {
        router.replace(LOGIN_PATH);
        return;
      }

      try {
        if (!auth.currentUser) {
          await signInAnonymously(auth);
        }
        const token = auth.currentUser ? await getIdToken(auth.currentUser, true) : "";
        if (!token) throw new Error("Missing auth token");

        const res = await fetch("/api/super/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || data.ok !== true) {
          throw new Error(data.error || "SuperAdmin access required");
        }

        if (!cancelled) setAllowed(true);
      } catch (e) {
        if (!cancelled) {
          setAllowed(false);
          setDenyReason(e instanceof Error ? e.message : "Access denied");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, pathname, isLoginPage]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (allowed !== true) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <p className="text-slate-400">
          {allowed === null ? "Проверка доступа…" : `Доступ запрещен: ${denyReason ?? "SuperAdmin required"}`}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-100">
      <SuperSidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex h-14 shrink-0 items-center border-b border-slate-200 bg-white px-6">
          <h1 className="text-base font-semibold text-slate-900">
            Центр управления (SuperAdmin)
          </h1>
        </header>
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
