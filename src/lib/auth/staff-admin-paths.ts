/** Единый whitelist страниц логина (middleware + клиентские layout). */
export function isStaffAdminLoginPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) return true;
  if (pathname === "/staff/login" || pathname.startsWith("/staff/login/")) return true;
  return false;
}
