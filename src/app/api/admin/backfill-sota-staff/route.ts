export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { generateSotaId } from "@/lib/sota-id";
import { FieldValue, type DocumentReference, type QueryDocumentSnapshot } from "firebase-admin/firestore";

const PAGE_SIZE = 500;
const MAX_BATCH_OPS = 500;

function trimSotaId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toUpperCase();
  if (!s) return null;
  if (/^[VGSA][A-Z0-9]{7}$/.test(s)) return s;
  if (/^(VR|SW|GP|GN)[A-Z0-9]{2,}$/.test(s)) return s;
  return null;
}

/**
 * POST /api/admin/backfill-sota-staff
 *
 * Бэкфилл только global_users (+ зеркало sotaId в venues/{venueId}/staff/{venueId}_{uid}).
 * Корневая коллекция staff не используется.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dryRun === true;

    const firestore = getAdminFirestore();

    let batch = firestore.batch();
    let batchOps = 0;

    const employeeSeen = new Set<string>();
    const employeeUpdated = new Set<string>();

    async function stageUpdate(ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>) {
      if (dryRun) return;
      batch.set(ref, data, { merge: true });
      batchOps++;
      if (batchOps >= MAX_BATCH_OPS) {
        await batch.commit();
        batch = firestore.batch();
        batchOps = 0;
      }
    }

    let lastDoc: QueryDocumentSnapshot | null = null;
    while (true) {
      let q = firestore.collection("global_users").orderBy("__name__").limit(PAGE_SIZE);
      if (lastDoc) q = q.startAfter(lastDoc);

      const snap = await q.get();
      if (snap.empty) break;

      const globalDocs = snap.docs;
      for (const gd of globalDocs) {
        const gData = gd.data() as Record<string, unknown>;
        const userId = gd.id;
        const existing = trimSotaId(gData.sotaId);
        employeeSeen.add(userId);

        let sotaToWrite: string;
        if (existing) {
          sotaToWrite = existing;
        } else {
          sotaToWrite = generateSotaId("S", "W");
          employeeUpdated.add(userId);
          await stageUpdate(gd.ref, { sotaId: sotaToWrite, updatedAt: FieldValue.serverTimestamp() });
        }

        const affiliations = Array.isArray(gData.affiliations) ? gData.affiliations : [];
        for (const aff of affiliations) {
          const a = aff as Record<string, unknown>;
          const status = typeof a.status === "string" ? a.status : "former";
          const venueId = typeof a.venueId === "string" ? a.venueId.trim() : "";
          if (!venueId) continue;
          if (status === "former") continue;

          const staffDocId = `${venueId}_${userId}`;
          const venueStaffRef = firestore.collection("venues").doc(venueId).collection("staff").doc(staffDocId);
          await stageUpdate(venueStaffRef, { sotaId: sotaToWrite, updatedAt: FieldValue.serverTimestamp() });
        }
      }

      lastDoc = globalDocs[globalDocs.length - 1] ?? null;
    }

    if (!dryRun && batchOps > 0) {
      await batch.commit();
    }

    const updatedCount = employeeUpdated.size;
    const skippedCount = Math.max(0, employeeSeen.size - updatedCount);

    console.log(`[backfill-sota-staff] Обновлено (${updatedCount}) сотрудников, пропущено (${skippedCount})`);

    return NextResponse.json({
      ok: true,
      dryRun,
      updatedCount,
      skippedCount,
    });
  } catch (err) {
    console.error("[backfill-sota-staff]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
