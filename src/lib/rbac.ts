/**
 * RBAC — разграничение прав в админке HeyWaiter.
 * owner (ЛПР) = полный доступ к заведению; superadmin = Система (SuperAdmin).
 */
import type { AdminRole } from "./types";

export const ADMIN_ROLES: AdminRole[] = [
  "owner",
  "manager",
  "waiter",
  "security",
  "superadmin",
];

export interface AdminTab {
  id: string;
  label: string;
  path: string;
  roles: readonly AdminRole[];
}

/** Вкладки личного кабинета и роли, которым доступны (ReadonlyArray, не кортеж) */
export const ADMIN_TABS: readonly AdminTab[] = [
  { id: "dashboard", label: "Дашборд", path: "/admin", roles: ["owner", "manager", "waiter", "security", "superadmin"] },
  { id: "settings", label: "Настройки", path: "/admin/settings", roles: ["owner", "manager"] },
  { id: "crm", label: "CRM: Гости", path: "/admin/crm/guests", roles: ["owner", "manager"] },
  { id: "team", label: "Команда", path: "/admin/team", roles: ["owner", "manager"] },
  { id: "staff", label: "Сотрудники (Биржа труда)", path: "/admin/staff", roles: ["owner", "manager"] },
  { id: "reviews", label: "Отзывы", path: "/admin/reviews", roles: ["owner", "manager"] },
  { id: "schedule", label: "График", path: "/admin/schedule", roles: ["owner", "manager"] },
  { id: "kitchen", label: "Кухня", path: "/admin/kitchen", roles: ["owner", "manager"] },
  { id: "delivery", label: "Пульт выдачи", path: "/admin/delivery", roles: ["owner", "manager"] },
];

/** Вкладки Кабинета Супер-Админа (/super). Только роль superadmin. */
export interface SuperTab {
  id: string;
  label: string;
  path: string;
}

export const SUPER_TABS: readonly SuperTab[] = [
  { id: "bots", label: "Настройки ботов", path: "/super/bots" },
  { id: "system", label: "Система", path: "/super/system" },
];

/** Шпаргалка по гостю (preferences, заметки): только ЛПР и manager. Официант видит только статус. */
export function canViewGuestCheatsheet(role: AdminRole): boolean {
  return role === "owner" || role === "manager";
}

/** Настройка ботов, генерация кодов для персонала */
export function canManageBots(role: AdminRole): boolean {
  return role === "owner" || role === "manager";
}

/** Управление подписками, глобальная аналитика, реклама */
export function canAccessSystem(role: AdminRole): boolean {
  return role === "owner" || role === "superadmin";
}

/** Доступ к вкладке по path */
export function canAccessPath(role: AdminRole, path: string): boolean {
  const tab = ADMIN_TABS.find((t) => path.startsWith(t.path));
  if (!tab) return true;
  return tab.roles.includes(role);
}

export function getTabsForRole(role: AdminRole): readonly AdminTab[] {
  return ADMIN_TABS.filter((t) => t.roles.includes(role));
}
