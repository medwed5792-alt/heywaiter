export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    const { getAdminFirestore } = await import("@/lib/firebase-admin");
    const firestore = getAdminFirestore();
    const ref = firestore.collection("super_ads_catalog").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.title === "string") patch.title = body.title.trim();
    if (typeof body.body === "string") patch.body = body.body.trim();
    if (typeof body.imageUrl === "string") patch.imageUrl = body.imageUrl.trim();
    if (typeof body.href === "string") patch.href = body.href.trim();
    if (typeof body.active === "boolean") patch.active = body.active;
    if (Array.isArray(body.placements)) patch.placements = body.placements.map(String);
    if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;
    await ref.update(patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[super/ads-catalog] PATCH", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const { getAdminFirestore } = await import("@/lib/firebase-admin");
    const firestore = getAdminFirestore();
    await firestore.collection("super_ads_catalog").doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[super/ads-catalog] DELETE", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
