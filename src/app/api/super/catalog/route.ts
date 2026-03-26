export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { GlobalUser } from "@/lib/types";
import { requireSuperAdmin } from "@/lib/superadmin-guard";
import { getAdminFirestore } from "@/lib/firebase-admin";

/**
 * GET /api/super/catalog
 * Супер-админ: полный список людей в системе (global_users).
 */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    const firestore = getAdminFirestore();
    const snap = await firestore.collection("global_users").get();
    const users: GlobalUser[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as GlobalUser[];
    return NextResponse.json({ users });
  } catch (err) {
    console.error("[super/catalog] GET Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
