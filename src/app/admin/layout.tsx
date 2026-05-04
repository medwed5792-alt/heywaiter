import { AdminLayoutChrome } from "@/components/admin/AdminLayoutChrome";

/**
 * Личный кабинет HeyWaiter.
 * Масштаб 75% задаётся глобально в globals.css (html { font-size: 75% }).
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminLayoutChrome>{children}</AdminLayoutChrome>;
}
