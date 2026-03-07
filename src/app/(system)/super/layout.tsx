"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SuperSidebar } from "@/components/super/SuperSidebar";

const SUPERADMIN_ROLE_KEY = "heywaiter_admin_role";
const LOGIN_PATH = "/super/login";

/**
 * Интерфейс №4: Кабинет Супер-Админа (Центр управления полётами).
 * Доступ только для роли superadmin. Остальных редирект на /super/login.
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

  const isLoginPage = pathname === LOGIN_PATH;

  useEffect(() => {
    if (isLoginPage) {
      setAllowed(true);
      return;
    }
    const role = typeof window !== "undefined"
      ? (localStorage.getItem(SUPERADMIN_ROLE_KEY) ?? "").toLowerCase()
      : "";
    if (role !== "superadmin") {
      router.replace(LOGIN_PATH);
      return;
    }
    setAllowed(true);
  }, [router, pathname, isLoginPage]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (allowed !== true) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <p className="text-slate-400">Проверка доступа…</p>
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
