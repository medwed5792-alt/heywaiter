export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { HEYWAITER_STAFF_ADMIN_AUTH_COOKIE } from "@/lib/auth/staff-admin-auth-cookie";

/** Сбрасывает httpOnly-сессию персонала (например после 403 или выхода). */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(HEYWAITER_STAFF_ADMIN_AUTH_COOKIE);
  return res;
}
