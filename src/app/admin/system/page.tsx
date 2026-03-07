import { redirect } from "next/navigation";

/**
 * Система (SuperAdmin) перенесена в Кабинет Супер-Админа.
 * /admin/system → /super/system
 */
export default function AdminSystemRedirect() {
  redirect("/super/system");
}
