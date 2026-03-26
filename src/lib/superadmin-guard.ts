import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";

export type SuperAdminAuthResult =
  | { ok: true; uid: string }
  | { ok: false; response: NextResponse };

function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ ok: false, error: message }, { status: 401 });
}

function forbidden(message = "Forbidden") {
  return NextResponse.json({ ok: false, error: message }, { status: 403 });
}

export async function requireSuperAdmin(request: NextRequest): Promise<SuperAdminAuthResult> {
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1]?.trim() || "";
  if (!token) return { ok: false, response: unauthorized("Missing bearer token") };

  let decoded: { uid: string } | null = null;
  try {
    decoded = await getAdminAuth().verifyIdToken(token);
  } catch {
    return { ok: false, response: unauthorized("Invalid token") };
  }

  const uid = decoded?.uid?.trim() || "";
  if (!uid) return { ok: false, response: unauthorized("Invalid uid") };

  const firestore = getAdminFirestore();
  const snap = await firestore.collection("super_admins").doc(uid).get();
  const data = snap.data() ?? {};
  const allowed = snap.exists && data.isSuperAdmin === true;
  if (!allowed) return { ok: false, response: forbidden("SuperAdmin access required") };

  return { ok: true, uid };
}

