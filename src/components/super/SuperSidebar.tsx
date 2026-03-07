"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, Radio } from "lucide-react";
import { SUPER_TABS } from "@/lib/rbac";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  bots: Settings,
  system: Radio,
};

/**
 * Боковое меню Интерфейса №4 (Кабинет Супер-Админа).
 * Показывает только вкладки супер-админа: Настройки ботов, Система.
 */
export function SuperSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-14 items-center border-b border-gray-200 px-4">
        <span className="text-base font-semibold text-gray-900">HeyWaiter</span>
      </div>
      <nav className="flex-1 space-y-0.5 p-3">
        {SUPER_TABS.map((tab) => {
          const Icon = ICONS[tab.id] ?? Settings;
          const isActive = pathname === tab.path || (tab.path !== "/super" && pathname.startsWith(tab.path));
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
