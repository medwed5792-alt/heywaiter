export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { generateSotaId } from "@/lib/sota-id";
import { FieldValue } from "firebase-admin/firestore";

const PAGE_SIZE = 500;
const MAX_BATCH_OPS = 500;

function trimSotaId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

/**
 * POST /api/admin/backfill-sota-staff
 *
 * Разовый бэкфилл:
 * - просканировать `staff` и `global_users`
 * - если отсутствует/не совпадает `sotaId`, сгенерировать через `generateSotaId("S", "W")`
 * - синхронизировать `staff` <-> `global_users` по `staff.userId`
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

    async function stageUpdate(ref: any, data: Record<string, unknown>) {
      if (dryRun) return;
      // `set(..., { merge: true })` избегает падения батча, если документ вдруг отсутствует.
      batch.set(ref, data, { merge: true });
      batchOps++;
      if (batchOps >= MAX_BATCH_OPS) {
        await batch.commit();
        batch = firestore.batch();
        batchOps = 0;
      }
    }

    // 1) staff pass: синхронизация `staff.userId` -> `global_users`
    let lastDoc: any = null;
    while (true) {
      let q = firestore.collection("staff").orderBy("__name__").limit(PAGE_SIZE);
      if (lastDoc) q = q.startAfter(lastDoc);

      const snap = await q.get();
      if (snap.empty) break;

      const staffDocs = snap.docs;

      // Unique global userIds for this page
      const userIds = new Set<string>();
      for (const sd of staffDocs) {
        const d = sd.data() as Record<string, unknown>;
        const uid = typeof d.userId === "string" ? d.userId.trim() : "";
        if (uid) userIds.add(uid);
      }

      const userIdsArr = [...userIds];
      const globalSotaByUid = new Map<string, string | null>();
      const globalSotaSnaps = await Promise.all(
        userIdsArr.map((uid) => firestore.collection("global_users").doc(uid).get())
      );
      for (let i = 0; i < userIdsArr.length; i++) {
        const uid = userIdsArr[i]!;
        const gs = globalSotaSnaps[i]!;
        const gd = gs.exists ? (gs.data() as Record<string, unknown>) : null;
        globalSotaByUid.set(uid, gd ? trimSotaId(gd.sotaId) : null);
      }

      const canonicalSotaByUid = new Map<string, string>(); // stable per user in this run
      for (const uid of userIdsArr) {
        const gs = globalSotaByUid.get(uid) ?? null;
        if (gs) canonicalSotaByUid.set(uid, gs);
      }
      const globalWasMissing = new Set<string>(userIdsArr.filter((uid) => !canonicalSotaByUid.has(uid)));

      for (const sd of staffDocs) {
        const sData = sd.data() as Record<string, unknown>;
        const staffSota = trimSotaId(sData.sotaId);

        const uidRaw = sData.userId;
        const uid = typeof uidRaw === "string" ? uidRaw.trim() : "";
        if (!uid) {
          // No global link: only ensure staff has sotaId
          if (!staffSota) {
            const newSotaId = generateSotaId("S", "W");
            await stageUpdate(sd.ref, { sotaId: newSotaId, updatedAt: FieldValue.serverTimestamp() });
          }
          continue;
        }

        employeeSeen.add(uid);

        const staffRef = sd.ref;
        let canonical = canonicalSotaByUid.get(uid) ?? null;

        // Determine canonical sotaId for this user:
        // - if global has it already => canonical is global
        // - else first observed staff.sotaId wins, otherwise generate once
        if (!canonical) {
          const firstStaffHas = staffSota ? staffSota : null;
          const newSotaId = firstStaffHas ?? generateSotaId("S", "W");

          canonicalSotaByUid.set(uid, newSotaId);

          // If global was missing, set global once for this canonical
          if (globalWasMissing.has(uid)) {
            globalWasMissing.delete(uid);
            employeeUpdated.add(uid);
            await stageUpdate(firestore.collection("global_users").doc(uid), {
              sotaId: newSotaId,
              updatedAt: FieldValue.serverTimestamp(),
            });
          }

          canonical = newSotaId;
        }

        const shouldUpdateStaff = !staffSota || staffSota !== canonical;
        if (shouldUpdateStaff) {
          employeeUpdated.add(uid);
          await stageUpdate(staffRef, { sotaId: canonical, updatedAt: FieldValue.serverTimestamp() });
        }
      }

      lastDoc = staffDocs[staffDocs.length - 1] ?? null;
    }

    // 2) global_users pass: для глобалок без sotaId (и/или без staff фиксации)
    lastDoc = null;
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

        if (existing) continue;

        const newSotaId = generateSotaId("S", "W");
        employeeUpdated.add(userId);
        await stageUpdate(gd.ref, { sotaId: newSotaId, updatedAt: FieldValue.serverTimestamp() });

        const affiliations = Array.isArray(gData.affiliations) ? gData.affiliations : [];
        for (const aff of affiliations) {
          const a = aff as Record<string, unknown>;
          const status = typeof a.status === "string" ? a.status : "former";
          const venueId = typeof a.venueId === "string" ? a.venueId.trim() : "";
          if (!venueId) continue;
          if (status === "former") continue;

          // staff doc id format used in staff/register: `${venueId}_${userId}`
          const staffRef = firestore.collection("staff").doc(`${venueId}_${userId}`);
          await stageUpdate(staffRef, { sotaId: newSotaId, updatedAt: FieldValue.serverTimestamp() });
        }
      }

      lastDoc = globalDocs[globalDocs.length - 1] ?? null;
    }

    // Commit remaining batch ops
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

