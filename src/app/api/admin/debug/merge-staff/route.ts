export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { UnifiedIdentities } from "@/lib/types";
import { resolveVenueId } from "@/lib/standards/venue-default";

const MERGE_SECRET = "HW_MERGE_2026";

/**
 * GET /api/admin/debug/merge-staff?keepId=...&sourceId=...&secret=HW_MERGE_2026
 * Одноразовое слияние дубликатов сотрудника: данные из sourceId переносятся в keepId,
 * sourceId помечается как merged_duplicate, в global_users объединяются identities (телефон + TG → один uid).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get("secret");
    const keepId = searchParams.get("keepId")?.trim();
    const sourceId = searchParams.get("sourceId")?.trim();

    if (secret !== MERGE_SECRET) {
      return NextResponse.json({ error: "Forbidden: invalid or missing secret" }, { status: 403 });
    }
    if (!keepId || !sourceId) {
      return NextResponse.json(
        { error: "keepId and sourceId are required" },
        { status: 400 }
      );
    }
    if (keepId === sourceId) {
      return NextResponse.json(
        { error: "keepId and sourceId must be different" },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();

    const keepStaffRef = firestore.collection("staff").doc(keepId);
    const sourceStaffRef = firestore.collection("staff").doc(sourceId);

    const [keepStaffSnap, sourceStaffSnap] = await Promise.all([
      keepStaffRef.get(),
      sourceStaffRef.get(),
    ]);

    if (!keepStaffSnap.exists) {
      return NextResponse.json({ error: "keepId staff document not found" }, { status: 404 });
    }
    if (!sourceStaffSnap.exists) {
      return NextResponse.json({ error: "sourceId staff document not found" }, { status: 404 });
    }

    const keepData = keepStaffSnap.data() ?? {};
    const sourceData = sourceStaffSnap.data() ?? {};

    const keepUserId = (keepData.userId as string) || keepId;
    const sourceUserId = (sourceData.userId as string) || sourceId;

    const keepGlobalRef = firestore.collection("global_users").doc(keepUserId);
    const sourceGlobalRef = firestore.collection("global_users").doc(sourceUserId);

    const [keepGlobalSnap, sourceGlobalSnap] = await Promise.all([
      keepGlobalRef.get(),
      sourceGlobalRef.get(),
    ]);

    const keepIdentities = (keepGlobalSnap.exists ? keepGlobalSnap.data()?.identities : keepData.identities) as UnifiedIdentities | undefined;
    const sourceIdentities = (sourceGlobalSnap.exists ? sourceGlobalSnap.data()?.identities : sourceData.identities) as UnifiedIdentities | undefined;

    const mergedIdentities: UnifiedIdentities = {
      ...(keepIdentities && typeof keepIdentities === "object" ? keepIdentities : {}),
      ...(sourceIdentities && typeof sourceIdentities === "object" ? sourceIdentities : {}),
    };
    Object.keys(mergedIdentities).forEach((k) => {
      const v = mergedIdentities[k as keyof UnifiedIdentities];
      if (v == null || (typeof v === "string" && !v.trim())) delete mergedIdentities[k as keyof UnifiedIdentities];
    });

    const batch = firestore.batch();

    const keepUpdate: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
      tgId: (sourceData.tgId as string) ?? keepData.tgId ?? null,
      identity: (sourceData.identity as Record<string, unknown>) ?? keepData.identity ?? null,
    };
    if (sourceData.primaryChannel != null) keepUpdate.primaryChannel = sourceData.primaryChannel;
    if (Object.keys(mergedIdentities).length > 0) keepUpdate.identities = mergedIdentities;

    batch.update(keepStaffRef, keepUpdate);

    batch.update(sourceStaffRef, {
      active: false,
      status: "merged_duplicate",
      mergedInto: keepId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (keepGlobalSnap.exists) {
      batch.update(keepGlobalRef, {
        identities: mergedIdentities,
        updatedAt: FieldValue.serverTimestamp(),
        ...(sourceGlobalSnap.exists && { mergedFrom: [sourceUserId] }),
      });
    }

    const venueId = resolveVenueId(keepData.venueId as string | undefined);
    const venueSourceStaffRef = firestore.collection("venues").doc(venueId).collection("staff").doc(sourceId);
    batch.set(
      venueSourceStaffRef,
      { status: "merged_duplicate", mergedInto: keepId, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    await batch.commit();

    const result = {
      ok: true,
      message: "Данные из Doc B (sourceId) перенесены в Doc A (keepId).",
      keepId,
      sourceId,
      keepUserId,
      sourceUserId,
      mergedIdentities: Object.keys(mergedIdentities).length > 0 ? mergedIdentities : undefined,
      sourceMarked: { active: false, status: "merged_duplicate", mergedInto: keepId },
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[merge-staff] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
