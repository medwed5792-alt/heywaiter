import type { Firestore } from "firebase-admin/firestore";

export async function getTelegramIdsForStaffIds(firestore: Firestore, staffDocIds: string[]): Promise<Set<string>> {
  const tgIds = new Set<string>();
  for (const sid of staffDocIds) {
    const staffSnap = await firestore.collection("staff").doc(sid).get();
    if (!staffSnap.exists) continue;
    const staffData = staffSnap.data() ?? {};
    const userId = (staffData.userId as string) || sid;
    let tgId: string | null =
      (staffData.tgId as string) || (staffData.identity as { externalId?: string })?.externalId || null;
    const globalSnap = await firestore.collection("global_users").doc(userId).get();
    if (globalSnap.exists) {
      const globalData = globalSnap.data() ?? {};
      const identities = globalData.identities as { tg?: string } | undefined;
      if (identities?.tg) tgId = identities.tg;
    }
    if (tgId && tgId.trim()) tgIds.add(tgId.trim());
  }
  return tgIds;
}

export async function resolveTargetStaffIdsForVenue(firestore: Firestore, venueId: string): Promise<string[]> {
  const onShift = await firestore
    .collection("staff")
    .where("venueId", "==", venueId)
    .where("active", "==", true)
    .where("onShift", "==", true)
    .get();
  if (!onShift.empty) return onShift.docs.map((d) => d.id);
  const active = await firestore.collection("staff").where("venueId", "==", venueId).where("active", "==", true).get();
  return active.docs.map((d) => d.id);
}
