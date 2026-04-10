/**
 * Единая логика принятия оффера (Unified Logic).
 * Используется: API POST /api/staff/accept-offer и Webhook callback "Принять" в чате.
 */
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { parseCanonicalStaffDocId, resolveStaffFirestoreIdToGlobalUser } from "@/lib/identity/global-user-staff-bridge";
import type { Affiliation } from "@/lib/types";

export interface AcceptOfferResult {
  ok: boolean;
  error?: string;
  venueId?: string;
  userId?: string;
  alreadyActive?: boolean;
}

/**
 * Переводит сотрудника в штат: активирует venues/{venueId}/staff/{staffId}, добавляет affiliation в global_users.
 * @param staffId — id в venues/.../staff (канон `${venueId}_${globalUserId}` или legacy, резолвится при известном venueId)
 * @param venueIdHint — опционально, если staffId legacy без префикса venue
 */
export async function acceptOffer(staffId: string, venueIdHint?: string): Promise<AcceptOfferResult> {
  if (!staffId || !staffId.trim()) {
    return { ok: false, error: "staffId обязателен" };
  }
  const firestore = getAdminFirestore();
  const sid = staffId.trim();

  let venueId: string;
  let userId: string;

  const parsed = parseCanonicalStaffDocId(sid);
  if (parsed) {
    venueId = parsed.venueId;
    userId = parsed.globalUserId;
  } else if (venueIdHint?.trim()) {
    const vid = venueIdHint.trim();
    const resolved = await resolveStaffFirestoreIdToGlobalUser(firestore, sid, vid);
    if (!resolved) {
      return { ok: false, error: "Предложение не найдено" };
    }
    venueId = vid;
    userId = resolved.globalUserId;
  } else {
    return { ok: false, error: "Предложение не найдено" };
  }

  let venueStaffRef = firestore.collection("venues").doc(venueId).collection("staff").doc(sid);
  let venueStaffSnap = await venueStaffRef.get();

  if (!venueStaffSnap.exists) {
    const canonicalId = `${venueId}_${userId}`;
    if (canonicalId !== sid) {
      venueStaffRef = firestore.collection("venues").doc(venueId).collection("staff").doc(canonicalId);
      venueStaffSnap = await venueStaffRef.get();
    }
  }

  if (!venueStaffSnap.exists) {
    return { ok: false, error: "Предложение не найдено" };
  }

  const staffData = venueStaffSnap.data() ?? {};
  const docUserId = (staffData.userId as string | undefined)?.trim() || userId;
  if (docUserId !== userId) {
    userId = docUserId;
  }

  if (staffData.active === true) {
    return { ok: true, alreadyActive: true, venueId, userId };
  }

  const joinedAt = new Date().toISOString();
  const staffDocIdForVenue = venueStaffSnap.id;

  await venueStaffSnap.ref.set(
    {
      venueId,
      userId,
      active: true,
      status: "active",
      joinedAt,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const globalRef = firestore.collection("global_users").doc(userId);
  const globalSnap = await globalRef.get();
  if (globalSnap.exists) {
    const g = globalSnap.data() ?? {};
    const affiliations: Affiliation[] = Array.isArray(g.affiliations) ? [...g.affiliations] : [];
    const idx = affiliations.findIndex((a) => a.venueId === venueId);
    const nextAff: Affiliation = {
      venueId,
      role: "waiter",
      status: "active",
      onShift: false,
      staffFirestoreId: staffDocIdForVenue,
    };
    if (idx >= 0) affiliations[idx] = { ...affiliations[idx], ...nextAff };
    else affiliations.push(nextAff);

    const prevLookup: string[] = Array.isArray(g.staffLookupIds) ? g.staffLookupIds : [];
    const lookup = [...new Set([...prevLookup, staffDocIdForVenue])];
    const prevActive: string[] = Array.isArray(g.staffVenueActive) ? g.staffVenueActive : [];
    const venuesActive = [...new Set([...prevActive, venueId])];

    await globalRef.set(
      {
        affiliations,
        staffLookupIds: lookup,
        staffVenueActive: venuesActive,
        staffVenueOnShift: Array.isArray(g.staffVenueOnShift) ? g.staffVenueOnShift : [],
        systemRole: g.systemRole ?? "STAFF",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  console.log("SUCCESS: Staff", staffDocIdForVenue, "accepted in Venue", venueId);
  return { ok: true, venueId, userId };
}
