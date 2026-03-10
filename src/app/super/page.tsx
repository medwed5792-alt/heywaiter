import { redirect } from "next/navigation";

/**
 * /super — редирект на первую вкладку Кабинета Супер-Админа.
 */
export default function SuperPage() {
  redirect("/super/bots");
}
