import type { NextRequest } from "next/server";
import { staffAdminMiddlewareResponse } from "@/lib/auth/staff-admin-edge-gate";

/**
 * Защита /admin и /staff на Edge до отдачи HTML.
 * Источник правды по роли: только Firestore global_users/{uid}.systemRole (через REST + SA).
 * Cookie хранит только проверяемый Firebase ID token (подпись Google), не роль.
 */
export async function middleware(request: NextRequest) {
  return staffAdminMiddlewareResponse(request);
}

export const config = {
  matcher: ["/admin/:path*", "/staff/:path*"],
};
