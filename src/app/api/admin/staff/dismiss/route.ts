export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { StaffCareerEntry, Affiliation } from "@/lib/types";

import { DEFAULT_VENUE_ID as VENUE_ID } from "@/lib/standards/venue-default";
import {
  parseCanonicalStaffDocId,
  resolveStaffFirestoreIdToGlobalUser,
  syncGlobalUserShiftVenues,
} from "@/lib/identity/global-user-staff-bridge";

/**
 * POST /api/admin/staff/dismiss (Unlink / Расторжение контракта)
 * Тело: { staffId: string, venueId?: string, exitReason: string (текст), rating: number (1-5) }
 *
 * Работает через global_users + venues/{venueId}/staff (без корневой staff).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { staffId, venueId: bodyVenueId, exitReason, rating } = body as {
      staffId?: string;
      venueId?: string;
      exitReason?: string;
      rating?: number;
    };

    if (!staffId) {
      return NextResponse.json(
        { error: "staffId required" },
        { status: 400 }
      );
    }
    if (typeof exitReason !== "string" || !exitReason.trim()) {
      return NextResponse.json(
        { error: "exitReason required (text)" },
        { status: 400 }
      );
    }
    const ratingNum =
      typeof rating === "number" ? rating : parseInt(String(rating), 10);
    if (Number.isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return NextResponse.json(
        { error: "rating required, 1-5" },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();
    const sid = staffId.trim();
    const venueFallback = (bodyVenueId && String(bodyVenueId).trim()) || VENUE_ID;

    let userId: string | null = null;
    let venueId = venueFallback;
    const parsed = parseCanonicalStaffDocId(sid);
    if (parsed) {
      userId = parsed.globalUserId;
      venueId = parsed.venueId || venueFallback;
    } else {
      const r = await resolveStaffFirestoreIdToGlobalUser(firestore, sid, venueFallback);
      if (r) userId = r.globalUserId;
    }
    if (!userId) {
      return NextResponse.json({ error: "Staff not found" }, { status: 404 });
    }

    const canonicalStaffDocId = `${venueId}_${userId}`;

    const globalRef = firestore.collection("global_users").doc(userId);
    const globalSnap = await globalRef.get();
    if (!globalSnap.exists) {
      return NextResponse.json({ error: "Staff not found" }, { status: 404 });
    }

    const globalData = globalSnap.data() ?? {};
    const affiliations: Affiliation[] = Array.isArray(globalData.affiliations)
      ? [...globalData.affiliations]
      : [];
    const affForVenue = affiliations.find((a) => a.venueId === venueId);
    const position =
      (affForVenue?.position as string) ||
      (affForVenue?.role as string) ||
      "Сотрудник";

    const mirrorSnap = await firestore
      .collection("venues")
      .doc(venueId)
      .collection("staff")
      .doc(sid)
      .get();
    const mirrorCanonical = await firestore
      .collection("venues")
      .doc(venueId)
      .collection("staff")
      .doc(canonicalStaffDocId)
      .get();
    const staffMirror = (mirrorSnap.exists ? mirrorSnap.data() : null) ?? (mirrorCanonical.exists ? mirrorCanonical.data() : null) ?? {};
    const joinDateRaw = staffMirror.invitedAt ?? staffMirror.createdAt ?? globalData.updatedAt;
    const nowIso = new Date().toISOString();
    const joinDate =
      joinDateRaw !== undefined && joinDateRaw !== null
        ? typeof joinDateRaw === "object" && joinDateRaw !== null && "toDate" in joinDateRaw
          ? (joinDateRaw as { toDate: () => Date }).toDate().toISOString()
          : String(joinDateRaw)
        : nowIso;

    const newEntry: StaffCareerEntry = {
      venueId,
      position,
      joinDate,
      exitDate: nowIso,
      exitReason: "contract_terminated",
      rating: ratingNum,
      comment: exitReason.trim(),
    };

    const filteredAffiliations = affiliations.filter((a: { venueId: string }) => a.venueId !== venueId);

    let careerHistory: StaffCareerEntry[] = Array.isArray(globalData.careerHistory)
      ? [...globalData.careerHistory]
      : [];
    const lastIdxForVenue = careerHistory.map((e, i) => (e.venueId === venueId ? i : -1)).filter((i) => i >= 0).pop();
    if (lastIdxForVenue !== undefined && lastIdxForVenue >= 0) {
      careerHistory[lastIdxForVenue] = {
        ...careerHistory[lastIdxForVenue],
        exitDate: nowIso,
        exitReason: "contract_terminated",
        rating: ratingNum,
        comment: exitReason.trim(),
      };
    } else {
      careerHistory = [...careerHistory, newEntry];
    }

    const ratingsWithValues = careerHistory
      .map((e) => e.rating)
      .filter((r): r is number => typeof r === "number" && r >= 1 && r <= 5);
    const globalScore =
      ratingsWithValues.length > 0
        ? Math.round((ratingsWithValues.reduce((a, b) => a + b, 0) / ratingsWithValues.length) * 10) / 10
        : undefined;

    const prevLookup: string[] = Array.isArray(globalData.staffLookupIds) ? globalData.staffLookupIds : [];
    const nextLookup = prevLookup.filter((x) => x !== sid && x !== canonicalStaffDocId);
    const prevActive: string[] = Array.isArray(globalData.staffVenueActive) ? globalData.staffVenueActive : [];
    const nextActive = prevActive.filter((v) => v !== venueId);

    await globalRef.update({
      affiliations: filteredAffiliations,
      careerHistory,
      staffLookupIds: nextLookup,
      staffVenueActive: nextActive,
      ...(globalScore != null && { globalScore }),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await syncGlobalUserShiftVenues(firestore, userId, venueId, false);

    const venueStaffCanonicalRef = firestore
      .collection("venues")
      .doc(venueId)
      .collection("staff")
      .doc(canonicalStaffDocId);
    await venueStaffCanonicalRef.set(
      { status: "inactive", active: false, onShift: false, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    if (sid !== canonicalStaffDocId) {
      const leg = firestore.collection("venues").doc(venueId).collection("staff").doc(sid);
      const ls = await leg.get();
      if (ls.exists) {
        await leg.set(
          { status: "inactive", active: false, onShift: false, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const scheduleIds = [...new Set([sid, canonicalStaffDocId])];
    for (const scheduleStaffId of scheduleIds) {
      const futureShiftsSnap = await firestore
        .collection("scheduleEntries")
        .where("staffId", "==", scheduleStaffId)
        .get();
      for (const d of futureShiftsSnap.docs) {
        const slot = d.data().slot as { date?: string } | undefined;
        const date = slot?.date ?? (d.data().date as string);
        if (date && date >= today) {
          await firestore.collection("scheduleEntries").doc(d.id).delete();
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[staff/dismiss] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
