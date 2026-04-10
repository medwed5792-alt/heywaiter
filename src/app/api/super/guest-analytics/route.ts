export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/superadmin-guard";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { resolveVenueDisplayName } from "@/lib/venue-display";

type GuestAnalyticsResponse = {
  ok: true;
  uid: string;
  totalVisits: number;
  topVenues: { venueId: string; venueName: string; visits: number }[];
  lastSeenAtMs: number | null;
};

function timestampToMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  if (v && typeof v === "object") {
    const anyV = v as any;
    if (typeof anyV.toDate === "function") {
      const d = anyV.toDate();
      const ms = d?.getTime?.();
      return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
    }
    if (typeof anyV.seconds === "number") {
      const nanos = typeof anyV.nanoseconds === "number" ? anyV.nanoseconds : 0;
      return anyV.seconds * 1000 + nanos / 1_000_000;
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const uid = (searchParams.get("uid") ?? "").trim();
  if (!uid) {
    return NextResponse.json({ ok: false, error: "uid required" }, { status: 400 });
  }

  const firestore = getAdminFirestore();

  try {
    const visitsRef = firestore.collection("global_users").doc(uid).collection("visits");
    const visitsSnap = await visitsRef.get();

    // Schema from `checkInGuest.ts`:
    // global_users/${uid}/visits/${venueId} doc contains:
    // - totalVisits (increment)
    // - lastVisitAt (serverTimestamp)
    const venueCounters = new Map<string, { venueId: string; visits: number }>();
    let totalVisits = 0;
    let lastSeenAtMs: number | null = null;

    visitsSnap.docs.forEach((doc) => {
      const venueId = doc.id;
      const d = doc.data() as Record<string, unknown>;
      const visits = typeof d.totalVisits === "number" && Number.isFinite(d.totalVisits) ? d.totalVisits : 0;
      totalVisits += visits;
      venueCounters.set(venueId, { venueId, visits });

      const lastMs = timestampToMs(d.lastVisitAt);
      if (lastMs != null && (lastSeenAtMs == null || lastMs > lastSeenAtMs)) lastSeenAtMs = lastMs;
    });

    const topVenues = [...venueCounters.values()]
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 3);

    const venueDocs = await Promise.all(
      topVenues.map(async (v) => {
        const snap = await firestore.collection("venues").doc(v.venueId).get();
        const data = snap.data() as Record<string, unknown> | undefined;
        const rawName =
          (data?.name as string | undefined) ??
          (data?.title as string | undefined) ??
          (data?.displayName as string | undefined) ??
          "";
        const venueName = resolveVenueDisplayName(rawName);
        return { venueId: v.venueId, venueName, visits: v.visits };
      })
    );

    const res: GuestAnalyticsResponse = {
      ok: true,
      uid,
      totalVisits,
      topVenues: venueDocs,
      lastSeenAtMs,
    };

    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

