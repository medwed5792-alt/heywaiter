export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { HEYWAITER_STAFF_ADMIN_AUTH_COOKIE } from "@/lib/auth/staff-admin-auth-cookie";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { idToken?: string };
    const idToken = typeof body.idToken === "string" ? body.idToken.trim() : "";
    if (!idToken) {
      return NextResponse.json({ ok: false, error: "id_token_required" }, { status: 400 });
    }

    let uid: string;
    try {
      const decoded = await getAdminAuth().verifyIdToken(idToken);
      uid = decoded.uid;
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 401 });
    }

    const snap = await getAdminFirestore().collection("global_users").doc(uid).get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: "no_profile" }, { status: 403 });
    }

    const systemRole = String(snap.data()?.systemRole ?? "").trim();
    const upper = systemRole.toUpperCase();
    if (upper !== "STAFF" && upper !== "ADMIN") {
      return NextResponse.json({ ok: false, error: "forbidden_role" }, { status: 403 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(HEYWAITER_STAFF_ADMIN_AUTH_COOKIE, idToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
    });
    return res;
  } catch (e) {
    console.error("[api/auth/sync-staff-session]", e);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
