/**
 * RBAC: защита маршрутов по роли (Edge-совместимо, только cookies).
 * Роль задаётся cookie heywaiter_role (admin | super | staff).
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ROLE_COOKIE = "heywaiter_role";

type RouteRole = "admin" | "super" | "staff";

const PATH_ROLES: { path: string; role: RouteRole }[] = [
  { path: "/admin", role: "admin" },
  { path: "/super", role: "super" },
  { path: "/staff", role: "staff" },
];

function getRequiredRole(pathname: string): RouteRole | null {
  for (const { path, role } of PATH_ROLES) {
    if (pathname === path || pathname.startsWith(path + "/")) {
      return role;
    }
  }
  return null;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requiredRole = getRequiredRole(pathname);
  if (!requiredRole) {
    return NextResponse.next();
  }

  const role = request.cookies.get(ROLE_COOKIE)?.value as RouteRole | undefined;
  if (role !== requiredRole) {
    const url = request.nextUrl.clone();
    // Пользователь залогинен (Firebase), но роли в куках ещё нет — ведём на /profile или /auth, чтобы роль подтянулась из Firestore
    url.pathname = "/profile";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/super/:path*", "/staff/:path*"],
};
