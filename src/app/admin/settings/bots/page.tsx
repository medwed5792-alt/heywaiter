import { redirect } from "next/navigation";

/**
 * Настройки ботов перенесены в Кабинет Супер-Админа.
 * /admin/settings/bots → /super/bots
 */
export default function AdminSettingsBotsRedirect() {
  redirect("/super/bots");
}
