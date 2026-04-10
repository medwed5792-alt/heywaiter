export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { UnifiedIdentities, Affiliation } from "@/lib/types";
import { resolveVenueId } from "@/lib/standards/venue-default";
import { parseCanonicalStaffDocId } from "@/lib/identity/global-user-staff-bridge";

const MERGE_SECRET = "HW_MERGE_2026";

function toGlobalUserId(id: string): string {
  const p = parseCanonicalStaffDocId(id.trim());
  return p ? p.globalUserId : id.trim();
}

/**
 * GET /api/admin/debug/merge-staff?keepId=...&sourceId=...&secret=HW_MERGE_2026
 * Слияние двух global_users: keepId и sourceId могут быть uid или staff doc id venue_uid.
 * Корневая коллекция staff не используется.
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

    const keepUserId = toGlobalUserId(keepId);
    const sourceUserId = toGlobalUserId(sourceId);
    if (keepUserId === sourceUserId) {
      return NextResponse.json(
        { error: "keepId and sourceId resolve to the same global user" },
        { status: 400 }
      );
    }

    const keepGlobalRef = firestore.collection("global_users").doc(keepUserId);
    const sourceGlobalRef = firestore.collection("global_users").doc(sourceUserId);

    const [keepGlobalSnap, sourceGlobalSnap] = await Promise.all([
      keepGlobalRef.get(),
      sourceGlobalRef.get(),
    ]);

    if (!keepGlobalSnap.exists) {
      return NextResponse.json({ error: "keepId global user not found" }, { status: 404 });
    }
    if (!sourceGlobalSnap.exists) {
      return NextResponse.json({ error: "sourceId global user not found" }, { status: 404 });
    }

    const keepData = keepGlobalSnap.data() ?? {};
    const sourceData = sourceGlobalSnap.data() ?? {};

    const keepIdentities = (keepData.identities as UnifiedIdentities | undefined) ?? {};
    const sourceIdentities = (sourceData.identities as UnifiedIdentities | undefined) ?? {};

    const mergedIdentities: UnifiedIdentities = {
      ...keepIdentities,
      ...sourceIdentities,
    };
    Object.keys(mergedIdentities).forEach((k) => {
      const v = mergedIdentities[k as keyof UnifiedIdentities];
      if (v == null || (typeof v === "string" && !v.trim())) delete mergedIdentities[k as keyof UnifiedIdentities];
    });

    const keepAff = Array.isArray(keepData.affiliations) ? [...keepData.affiliations] : [];
    const sourceAff = Array.isArray(sourceData.affiliations) ? [...sourceData.affiliations] : [];
    const byVenue = new Map<string, Affiliation>();
    for (const a of keepAff as Affiliation[]) {
      if (a?.venueId) byVenue.set(a.venueId, a);
    }
    for (const a of sourceAff as Affiliation[]) {
      if (!a?.venueId) continue;
      const prev = byVenue.get(a.venueId);
      byVenue.set(a.venueId, prev ? { ...prev, ...a } : a);
    }
    const mergedAffiliations = [...byVenue.values()];

    const lookup = new Set<string>([
      ...(Array.isArray(keepData.staffLookupIds) ? keepData.staffLookupIds : []),
      ...(Array.isArray(sourceData.staffLookupIds) ? sourceData.staffLookupIds : []),
    ]);

    const batch = firestore.batch();

    batch.set(
      keepGlobalRef,
      {
        identities: mergedIdentities,
        affiliations: mergedAffiliations,
        staffLookupIds: [...lookup],
        tgId: (sourceData.tgId as string) ?? keepData.tgId ?? null,
        identity: (sourceData.identity as Record<string, unknown>) ?? keepData.identity ?? null,
        updatedAt: FieldValue.serverTimestamp(),
        mergedFrom: FieldValue.arrayUnion(sourceUserId),
      },
      { merge: true }
    );

    batch.set(
      sourceGlobalRef,
      {
        active: false,
        status: "merged_duplicate",
        mergedInto: keepUserId,
        affiliations: [],
        staffVenueActive: [],
        staffVenueOnShift: [],
        staffLookupIds: [],
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const venueId = resolveVenueId((keepAff[0] as Affiliation)?.venueId as string | undefined);
    const venueSourceStaffRef = firestore.collection("venues").doc(venueId).collection("staff").doc(sourceId);
    batch.set(
      venueSourceStaffRef,
      { status: "merged_duplicate", mergedInto: keepId, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    await batch.commit();

    return NextResponse.json({
      ok: true,
      message: "Данные из source global user перенесены в keep global user.",
      keepId,
      sourceId,
      keepUserId,
      sourceUserId,
      mergedIdentities: Object.keys(mergedIdentities).length > 0 ? mergedIdentities : undefined,
    });
  } catch (err) {
    console.error("[merge-staff] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
