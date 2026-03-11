export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { doc, getDoc, updateDoc, deleteDoc, getDocs, query, collection, where, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * PATCH /api/super/catalog/[userId]
 * Супер-админ: редактирование кармы (globalScore) пользователя.
 * Тело: { globalScore?: number }
 */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    const body = await _request.json();
    const globalScore = body.globalScore;
    if (typeof globalScore !== "number" || globalScore < 0 || globalScore > 5) {
      return NextResponse.json(
        { error: "globalScore must be a number 0-5" },
        { status: 400 }
      );
    }
    const ref = doc(db, "global_users", userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    await updateDoc(ref, { globalScore, updatedAt: serverTimestamp() });
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
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    const globalRef = doc(db, "global_users", userId);
    const snap = await getDoc(globalRef);
    if (!snap.exists()) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    await deleteDoc(globalRef);
    // Удалить связи staff, где userId = userId (staff doc id = venueId_userId)
    const staffSnap = await getDocs(
      query(collection(db, "staff"), where("userId", "==", userId))
    );
    for (const d of staffSnap.docs) {
      await deleteDoc(doc(db, "staff", d.id));
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
