export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { GlobalUser } from "@/lib/types";

/**
 * GET /api/super/catalog
 * Супер-админ: полный список людей в системе (global_users).
 */
export async function GET() {
  try {
    const snap = await getDocs(collection(db, "global_users"));
    const users: GlobalUser[] = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    })) as GlobalUser[];
    return NextResponse.json({ users });
  } catch (err) {
    console.error("[super/catalog] GET Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
