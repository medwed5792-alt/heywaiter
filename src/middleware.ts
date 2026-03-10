/**
 * RBAC: защита маршрутов по роли (Edge-совместимо, только cookies).
 * Роль задаётся cookie heywaiter_role (admin | super | staff).
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ROLE_COOKIE = "heywaiter_role";

function isAuthWhitelist(pathname: string): boolean {
  return (
    pathname.startsWith("/super/login") ||
    pathname.startsWith("/admin/login") ||
    pathname.startsWith("/staff/login") ||
    pathname.startsWith("/api/auth/")
  );
}

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

  if (isAuthWhitelist(pathname)) {
    console.log("Middleware allowed path:", pathname);
    return NextResponse.next();
  }

  const requiredRole = getRequiredRole(pathname);
  if (!requiredRole) {
    return NextResponse.next();
  }

  const role = request.cookies.get(ROLE_COOKIE)?.value as RouteRole | undefined;
  if (role !== requiredRole) {
    const url = request.nextUrl.clone();
    url.pathname = "/profile";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Статика (/_next/*, /favicon.ico и т.д.) не в matcher — middleware для них не вызывается
  matcher: [
    "/admin/:path*",
    "/super/:path*",
    "/staff/:path*",
    "/api/auth/:path*",
  ],
};
