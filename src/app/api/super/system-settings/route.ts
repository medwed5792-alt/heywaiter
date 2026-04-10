export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/superadmin-guard";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import {
  GLOBAL_SETTINGS_DOC_ID,
  SYSTEM_CONFIGS_COLLECTION,
} from "@/lib/system-configs/collection";

const DOC_PATH = `${SYSTEM_CONFIGS_COLLECTION}/${GLOBAL_SETTINGS_DOC_ID}`;

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) return auth.response;

  const firestore = getAdminFirestore();
  const snap = await firestore.doc(DOC_PATH).get();
  return NextResponse.json({ ok: true, settings: snap.exists ? snap.data() ?? {} : {} });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const updates = (body.updates ?? body) as Record<string, unknown>;
  if (!updates || typeof updates !== "object") {
    return NextResponse.json({ ok: false, error: "updates object required" }, { status: 400 });
  }

  const firestore = getAdminFirestore();
  await firestore.doc(DOC_PATH).set(
    {
      ...updates,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
    },
    { merge: true }
  );
  return NextResponse.json({ ok: true });
}

