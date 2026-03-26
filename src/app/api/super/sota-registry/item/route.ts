export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/superadmin-guard";
import { getAdminFirestore } from "@/lib/firebase-admin";

type RegistryKind = "venue" | "staff" | "guest";

function kindToCollection(kind: RegistryKind): string {
  switch (kind) {
    case "venue":
      return "venues";
    case "staff":
      return "staff";
    case "guest":
      return "global_users";
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const kind = (searchParams.get("kind") ?? "").trim() as RegistryKind;
  const docId = (searchParams.get("docId") ?? "").trim();

  if ((kind !== "venue" && kind !== "staff" && kind !== "guest") || !docId) {
    return NextResponse.json({ ok: false, error: "kind and docId required" }, { status: 400 });
  }

  const firestore = getAdminFirestore();
  const snap = await firestore.collection(kindToCollection(kind)).doc(docId).get();
  if (!snap.exists) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, kind, docId: snap.id, data: snap.data() ?? {} });
}

