"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isStaffAdminLoginPath } from "@/lib/auth/staff-admin-paths";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { AdminStaffSessionSync } from "@/components/admin/AdminStaffSessionSync";

export function AdminLayoutChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (isStaffAdminLoginPath(pathname)) {
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
