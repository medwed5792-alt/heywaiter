"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isStaffAdminLoginPath } from "@/lib/auth/staff-admin-paths";
import { StaffStaffSessionSync } from "@/components/staff/StaffStaffSessionSync";

/**
 * Оболочка /staff: без «админского» chrome; на странице логина — только контент.
 */
export function StaffLayoutChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (isStaffAdminLoginPath(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <StaffStaffSessionSync />
      <main className="mx-auto max-w-6xl p-4 md:p-6">{children}</main>
    </div>
  );
}
