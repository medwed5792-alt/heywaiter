"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { SuperSidebar } from "@/components/super/SuperSidebar";

const SUPERADMIN_ROLE_KEY = "heywaiter_admin_role";

/**
 * Интерфейс №4: Кабинет Супер-Админа (Центр управления полётами).
 * Доступ только для роли superadmin. Остальных редирект на /admin.
 */
export default function SuperLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const role = typeof window !== "undefined"
      ? (localStorage.getItem(SUPERADMIN_ROLE_KEY) ?? "").toLowerCase()
      : "";
    if (role !== "superadmin") {
      router.replace("/admin");
    }
  }, [router, pathname]);

  return (
    <div className="flex min-h-screen bg-gray-100">
      <SuperSidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex h-14 shrink-0 items-center border-b border-gray-200 bg-white px-6">
          <h1 className="text-base font-semibold text-gray-900">
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
