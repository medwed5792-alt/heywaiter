import type { Firestore } from "firebase-admin/firestore";
import { resolveStaffFirestoreIdToGlobalUser } from "@/lib/identity/global-user-staff-bridge";

export async function getTelegramIdsForStaffIds(
  firestore: Firestore,
  venueId: string,
  staffDocIds: string[]
): Promise<Set<string>> {
  const vid = venueId.trim();
  const tgIds = new Set<string>();
  for (const sid of staffDocIds) {
    const resolved = vid ? await resolveStaffFirestoreIdToGlobalUser(firestore, sid, vid) : null;
    if (!resolved) continue;
    const globalSnap = await firestore.collection("global_users").doc(resolved.globalUserId).get();
    if (!globalSnap.exists) continue;
    const globalData = globalSnap.data() ?? {};
    const identities = globalData.identities as { tg?: string } | undefined;
    const tgId = identities?.tg?.trim();
    if (tgId) tgIds.add(tgId);
  }
  return tgIds;
}

export async function resolveTargetStaffIdsForVenue(firestore: Firestore, venueId: string): Promise<string[]> {
  const vid = venueId.trim();
  if (!vid) return [];

  const onShift = await firestore
    .collection("global_users")
    .where("staffVenueOnShift", "array-contains", vid)
    .get();
  const mapIds = (docs: typeof onShift.docs) =>
    docs.map((d) => `${vid}_${d.id}`);

  if (!onShift.empty) return mapIds(onShift.docs);

  const active = await firestore
    .collection("global_users")
    .where("staffVenueActive", "array-contains", vid)
    .get();
  return mapIds(active.docs);
}
