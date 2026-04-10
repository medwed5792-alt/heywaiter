export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { parseCanonicalStaffDocId } from "@/lib/identity/global-user-staff-bridge";

const MIGRATE_SECRET = "HW_CLEAN_2026";
const JUNK_SUBSTRINGS = ["о1", "о2", "с1", "гури", "ааа", "тест"];
const BATCH_SIZE = 500;

function getDisplayName(venueStaffData: Record<string, unknown>, rootStaffData: Record<string, unknown> | null): string {
  const fromVenue =
    (venueStaffData.displayName as string)?.trim() ||
    (venueStaffData.name as string)?.trim() ||
    "";
  if (fromVenue) return fromVenue;
  if (!rootStaffData) return "";
  const first = (rootStaffData.firstName as string)?.trim() ?? "";
  const last = (rootStaffData.lastName as string)?.trim() ?? "";
  const fromRoot = [first, last].filter(Boolean).join(" ").trim();
  if (fromRoot) return fromRoot;
  const identity = rootStaffData.identity as { displayName?: string } | undefined;
  return (identity?.displayName as string)?.trim() ?? "";
}

function isJunkName(name: string): boolean {
  const lower = name.toLowerCase();
  return JUNK_SUBSTRINGS.some((s) => lower.includes(s));
}

/**
 * GET /api/admin/debug/migrate-staff?venueId=...&secret=HW_CLEAN_2026
 * Одноразовая миграция подколлекции venues/[venueId]/staff до стандарта V.2.0:
 * - Мусорные имена (о1, о2, с1, гури, ааа, тест) -> active: false, status: 'inactive'
 * - Реальные сотрудники без поля active -> active: true, status: 'active'
 * - Дубликаты по имени -> один активный, остальные active: false
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get("secret");
    const venueId = searchParams.get("venueId");

    if (secret !== MIGRATE_SECRET) {
      return NextResponse.json({ error: "Forbidden: invalid or missing secret" }, { status: 403 });
    }
    if (!venueId || !venueId.trim()) {
      return NextResponse.json({ error: "venueId is required" }, { status: 400 });
    }

    const firestore = getAdminFirestore();
    const venueStaffRef = firestore.collection("venues").doc(venueId.trim()).collection("staff");
    const staffSnap = await venueStaffRef.get();

    const globalByStaffDocId = new Map<string, Record<string, unknown>>();
    for (const d of staffSnap.docs) {
      const parsed = parseCanonicalStaffDocId(d.id);
      if (!parsed) continue;
      const gs = await firestore.collection("global_users").doc(parsed.globalUserId).get();
      if (gs.exists) globalByStaffDocId.set(d.id, gs.data() as Record<string, unknown>);
    }

    type DocEntry = { id: string; ref: DocumentReference; data: Record<string, unknown>; displayName: string };
    const entries: DocEntry[] = [];

    for (const d of staffSnap.docs) {
      const data = d.data() as Record<string, unknown>;
      const globalData = globalByStaffDocId.get(d.id) ?? null;
      const displayName = getDisplayName(data, globalData);
      entries.push({ id: d.id, ref: d.ref, data, displayName });
    }

    const nameToIds = new Map<string, string[]>();
    for (const e of entries) {
      const key = e.displayName.trim().toLowerCase() || e.id;
      if (!nameToIds.has(key)) nameToIds.set(key, []);
      nameToIds.get(key)!.push(e.id);
    }

    const toInactive = new Set<string>();
    const toActive = new Set<string>();

    for (const e of entries) {
      const name = e.displayName;
      const key = name.trim().toLowerCase() || e.id;
      const idsWithSameName = nameToIds.get(key) ?? [e.id];

      if (isJunkName(name)) {
        toInactive.add(e.id);
        continue;
      }

      const hasActive = e.data.active === true;

      if (idsWithSameName.length > 1) {
        const firstId = idsWithSameName[0];
        if (e.id === firstId) {
          if (!hasActive) toActive.add(e.id);
        } else {
          toInactive.add(e.id);
        }
        continue;
      }

      if (!hasActive && name) {
        toActive.add(e.id);
      }
    }

    const updates: { ref: DocumentReference; payload: Record<string, unknown> }[] = [];

    for (const id of toInactive) {
      const e = entries.find((x) => x.id === id);
      if (!e) continue;
      updates.push({
        ref: e.ref,
        payload: { active: false, status: "inactive", updatedAt: FieldValue.serverTimestamp() },
      });
    }
    for (const id of toActive) {
      const e = entries.find((x) => x.id === id);
      if (!e) continue;
      updates.push({
        ref: e.ref,
        payload: { active: true, status: "active", updatedAt: FieldValue.serverTimestamp() },
      });
    }

    let committed = 0;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = firestore.batch();
      const chunk = updates.slice(i, i + BATCH_SIZE);
      for (const { ref, payload } of chunk) {
        batch.set(ref, payload, { merge: true });
      }
      await batch.commit();
      committed += chunk.length;
    }

    const logMessage = `[migrate-staff] venueId=${venueId} total=${entries.length} updated=${committed} (inactive=${toInactive.size} active=${toActive.size})`;
    console.log(logMessage);

    return NextResponse.json({
      ok: true,
      venueId: venueId.trim(),
      total: entries.length,
      updated: committed,
      setInactive: toInactive.size,
      setActive: toActive.size,
      log: logMessage,
    });
  } catch (err) {
    console.error("[migrate-staff] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
