"use client";

import { Bell } from "lucide-react";
import type { AdminRole } from "@/lib/types";

interface AdminHeaderProps {
  role?: AdminRole;
  venueName?: string;
  userEmail?: string;
}

export function AdminHeader({
  role = "owner",
  venueName = "Моё заведение",
  userEmail,
}: AdminHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div className="flex items-center gap-4">
        <h1 className="text-base font-semibold text-gray-900">
          {venueName}
        </h1>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          {role === "superadmin" ? "SuperAdmin" : role === "owner" ? "ЛПР" : role}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Уведомления"
        >
          <Bell className="h-5 w-5" />
        </button>
        {userEmail && (
          <span className="text-sm text-gray-600">{userEmail}</span>
        )}
      </div>
    </header>
  );
}
