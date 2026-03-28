import type { Firestore } from "firebase-admin/firestore";

/**
 * Проверка доступа персонала к площадке по документу preorder_staff_gate/{firebaseUid}.
 * Должна совпадать с логикой firestore.rules → preorderStaffForVenue.
 */
export async function verifyPreorderStaffForVenue(
  db: Firestore,
  firebaseUid: string,
  venueId: string
): Promise<boolean> {
  const uid = firebaseUid.trim();
  const vid = venueId.trim();
  if (!uid || !vid) return false;

  const gateSnap = await db.collection("preorder_staff_gate").doc(uid).get();
  if (!gateSnap.exists) return false;

  const gate = gateSnap.data() ?? {};
  const venueIds = gate.venueIds;
  if (Array.isArray(venueIds) && venueIds.some((x) => typeof x === "string" && x.trim() === vid)) {
    return true;
  }

  const venueSotaIds = gate.venueSotaIds;
  if (!Array.isArray(venueSotaIds) || venueSotaIds.length === 0) return false;

  const venueSnap = await db.collection("venues").doc(vid).get();
  if (!venueSnap.exists) return false;
  const sotaId = venueSnap.data()?.sotaId;
  if (typeof sotaId !== "string" || !sotaId.trim()) return false;

  return venueSotaIds.some((x) => typeof x === "string" && x.trim() === sotaId.trim());
}
