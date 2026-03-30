"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  UserCog,
  Settings,
  Star,
  Calendar,
  BarChart2,
  ChefHat,
} from "lucide-react";
import { getTabsForRole } from "@/lib/rbac";
import type { AdminRole } from "@/lib/types";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  bookings: Calendar,
  settings: Settings,
  crm: Users,
  team: UserCog,
  staff: UserCog,
  reviews: Star,
  schedule: Calendar,
  analytics: BarChart2,
  kitchen: ChefHat,
  delivery: ChefHat,
  "settings-bots": Settings,
  system: Settings,
};

interface AdminSidebarProps {
  role?: AdminRole;
}

export function AdminSidebar({ role = "owner" }: AdminSidebarProps) {
  const pathname = usePathname();
  const tabs = getTabsForRole(role);

  return (
    <aside className="sticky top-0 flex h-screen max-h-[100dvh] w-56 shrink-0 flex-col self-start overflow-hidden border-r border-gray-200 bg-white">
      <div className="flex h-14 shrink-0 items-center border-b border-gray-200 px-4">
        <span className="text-base font-semibold text-gray-900">HeyWaiter</span>
      </div>
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-3">
        {tabs.map((tab) => {
          const Icon = ICONS[tab.id] ?? LayoutDashboard;
          const isActive = pathname === tab.path || (tab.path !== "/admin" && pathname.startsWith(tab.path));
          return (
            <Link
              key={tab.id}
              href={tab.path}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-gray-900 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
