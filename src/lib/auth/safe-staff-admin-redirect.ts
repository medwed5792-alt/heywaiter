/**
 * Защита от open-redirect после логина: только относительные пути /admin или /staff.
 */
export function safeStaffAdminNextPath(raw: string | null | undefined, fallback: string): string {
  const s = (raw ?? "").trim();
  if (!s.startsWith("/") || s.startsWith("//")) return fallback;
  if (!(s.startsWith("/admin") || s.startsWith("/staff"))) return fallback;
  return s;
}
