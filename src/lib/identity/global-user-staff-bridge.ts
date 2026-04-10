/**
 * Единый резолвер: legacy staff doc id (корневая коллекция staff) → global_users.id.
 * После отказа от коллекции staff в коде остаются строки вида `${venueId}_${globalUserId}` и произвольные legacy id в staffLookupIds.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";

/** Разбор `${venueId}_${globalUserId}` (venueId может содержать `_`). */
export function parseCanonicalStaffDocId(
  staffDocId: string
): { venueId: string; globalUserId: string } | null {
  const s = staffDocId.trim();
  const u = s.lastIndexOf("_");
  if (u <= 0) return null;
  const venueId = s.slice(0, u).trim();
  const globalUserId = s.slice(u + 1).trim();
  if (!venueId || !globalUserId) return null;
  return { venueId, globalUserId };
}

export type ResolvedStaffGlobal = {
  globalUserId: string;
  sotaId: string | null;
};

export async function resolveStaffFirestoreIdToGlobalUser(
  firestore: Firestore,
  staffFirestoreId: string,
  venueId: string
): Promise<ResolvedStaffGlobal | null> {
  const sid = staffFirestoreId.trim();
  const vid = venueId.trim();
  if (!sid || !vid) return null;

  const prefix = `${vid}_`;
  if (sid.startsWith(prefix)) {
    const candidate = sid.slice(prefix.length).trim();
    if (candidate) {
      const doc = await firestore.collection("global_users").doc(candidate).get();
      if (doc.exists) {
        const d = doc.data() ?? {};
        const sota = typeof d.sotaId === "string" ? d.sotaId.trim() : null;
        return { globalUserId: candidate, sotaId: sota || null };
      }
    }
  }

  const q = await firestore
    .collection("global_users")
    .where("staffLookupIds", "array-contains", sid)
    .limit(1)
    .get();
  if (!q.empty) {
    const doc = q.docs[0]!;
    const d = doc.data() ?? {};
    const sota = typeof d.sotaId === "string" ? d.sotaId.trim() : null;
    return { globalUserId: doc.id, sotaId: sota || null };
  }

  const direct = await firestore.collection("global_users").doc(sid).get();
  if (direct.exists) {
    const d = direct.data() ?? {};
    const sota = typeof d.sotaId === "string" ? d.sotaId.trim() : null;
    return { globalUserId: direct.id, sotaId: sota || null };
  }

  return null;
}

/** Обновить денормализованные поля смены (без коллекции staff). */
export async function syncGlobalUserShiftVenues(
  firestore: Firestore,
  globalUserId: string,
  venueId: string,
  onShift: boolean
): Promise<void> {
  const uid = globalUserId.trim();
  const vid = venueId.trim();
  if (!uid || !vid) return;
  const ref = firestore.collection("global_users").doc(uid);
  await ref.set(
    {
      staffVenueOnShift: onShift ? FieldValue.arrayUnion(vid) : FieldValue.arrayRemove(vid),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}
