export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/superadmin-guard";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

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
 * Супер-админ: полное удаление пользователя из системы (global_users и связи в staff).
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
    await globalRef.delete();

    const staffSnap = await firestore.collection("staff").where("userId", "==", userId).get();
    for (const d of staffSnap.docs) {
      const data = d.data() ?? {};
      const venueId = typeof data.venueId === "string" ? data.venueId : "";
      await d.ref.delete();
      if (venueId) {
        await firestore.collection("venues").doc(venueId).collection("staff").doc(d.id).delete().catch(() => undefined);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[super/catalog] DELETE Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
