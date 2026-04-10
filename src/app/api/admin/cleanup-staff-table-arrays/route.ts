export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { DEFAULT_VENUE_ID as VENUE_ID } from "@/lib/standards/venue-default";

function isValidTableIdEntry(x: unknown): boolean {
  if (x === null || x === undefined) return false;
  if (typeof x === "number") return x !== 0;
  if (typeof x === "string") {
    const s = x.trim();
    return s !== "" && s !== "0" && s.toLowerCase() !== "null" && s.toLowerCase() !== "undefined";
  }
  return false;
}

function cleanStringTableList(arr: unknown): string[] | null {
  if (!Array.isArray(arr)) return null;
  const next = arr
    .map((x) => {
      if (x === null || x === undefined) return null;
      if (typeof x === "number") {
        if (x === 0) return null;
        return String(x);
      }
      const s = String(x).trim();
      if (!isValidTableIdEntry(s)) return null;
      return s;
    })
    .filter((x): x is string => x != null);
  const prevNorm = JSON.stringify(arr);
  const nextNorm = JSON.stringify(next);
  return prevNorm === nextNorm ? null : next;
}

/**
 * POST /api/admin/cleanup-staff-table-arrays
 * Удаляет из global_users.affiliations[].assignedTableIds и venues/{venue}/staff мусорные значения.
 */
export async function POST(_request: NextRequest) {
  try {
    const firestore = getAdminFirestore();
    let venueStaffUpdated = 0;
    let globalUpdated = 0;

    const venueStaffSnap = await firestore
      .collection("venues")
      .doc(VENUE_ID)
      .collection("staff")
      .get();
    for (const d of venueStaffSnap.docs) {
      const data = d.data();
      const patch: Record<string, unknown> = {};
      const ca = cleanStringTableList(data.assignedTableIds);
      if (ca) patch.assignedTableIds = ca;
      const cd = cleanStringTableList(data.defaultTables);
      if (cd) patch.defaultTables = cd;
      if (Object.keys(patch).length > 0) {
        await d.ref.update(patch);
        venueStaffUpdated += 1;
      }
    }

    const globalSnap = await firestore.collection("global_users").get();
    for (const d of globalSnap.docs) {
      const data = d.data();
      const aff = data.affiliations;
      if (!Array.isArray(aff) || aff.length === 0) continue;
      let changed = false;
      const nextAff = aff.map((a: Record<string, unknown>) => {
        if (!a || typeof a !== "object") return a;
        const ca = cleanStringTableList(a.assignedTableIds);
        if (ca) {
          changed = true;
          return { ...a, assignedTableIds: ca };
        }
        return a;
      });
      if (changed) {
        await d.ref.update({ affiliations: nextAff });
        globalUpdated += 1;
      }
    }

    return NextResponse.json({ ok: true, venueStaffUpdated, globalUpdated });
  } catch (err) {
    console.error("[admin/cleanup-staff-table-arrays]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
