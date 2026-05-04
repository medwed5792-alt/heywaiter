"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { AdminStaffSessionSync } from "@/components/admin/AdminStaffSessionSync";

export function AdminLayoutChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/admin/login" || pathname?.startsWith("/admin/login/")) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen bg-gray-100">
      <AdminStaffSessionSync />
      <AdminSidebar />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <AdminHeader />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
