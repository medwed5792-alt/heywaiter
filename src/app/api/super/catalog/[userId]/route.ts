export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/superadmin-guard";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { parseCanonicalStaffDocId } from "@/lib/identity/global-user-staff-bridge";

/**
 * PATCH /api/super/catalog/[userId]
 * Супер-админ: редактирование кармы (globalScore) пользователя.
 * Тело: { globalScore?: number }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    const { userId } = await params;
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    const globalScore = body.globalScore;
    if (typeof globalScore !== "number" || globalScore < 0 || globalScore > 5) {
      return NextResponse.json(
        { error: "globalScore must be a number 0-5" },
        { status: 400 }
      );
    }
    const firestore = getAdminFirestore();
    const ref = firestore.collection("global_users").doc(userId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    await ref.update({ globalScore, updatedAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[super/catalog] PATCH Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/super/catalog/[userId]
 * Супер-админ: полное удаление пользователя из системы (global_users и подколлекции staff у venues).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    const { userId } = await params;
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    const firestore = getAdminFirestore();
    const globalRef = firestore.collection("global_users").doc(userId);
    const snap = await globalRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const data = snap.data() ?? {};
    const venueSet = new Set<string>();
    for (const a of Array.isArray(data.affiliations) ? data.affiliations : []) {
      const vid = (a as { venueId?: string })?.venueId;
      if (vid) venueSet.add(vid);
    }
    for (const v of Array.isArray(data.staffVenueActive) ? data.staffVenueActive : []) {
      if (typeof v === "string" && v.trim()) venueSet.add(v.trim());
    }
    for (const vid of venueSet) {
      const canonical = `${vid}_${userId}`;
      await firestore
        .collection("venues")
        .doc(vid)
        .collection("staff")
        .doc(canonical)
        .delete()
        .catch(() => undefined);
    }
    for (const lid of Array.isArray(data.staffLookupIds) ? data.staffLookupIds : []) {
      if (typeof lid !== "string") continue;
      const p = parseCanonicalStaffDocId(lid);
      if (!p) continue;
      await firestore
        .collection("venues")
        .doc(p.venueId)
        .collection("staff")
        .doc(lid)
        .delete()
        .catch(() => undefined);
    }

    await globalRef.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[super/catalog] DELETE Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
