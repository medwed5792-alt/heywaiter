/**
 * Единая логика принятия оффера (Unified Logic).
 * Используется: API POST /api/staff/accept-offer и Webhook callback "Принять" в чате.
 */
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export interface AcceptOfferResult {
  ok: boolean;
  error?: string;
  venueId?: string;
  userId?: string;
  alreadyActive?: boolean;
}

/**
 * Переводит сотрудника в штат: active: true, status: 'active', добавляет venue в global_users.
 * @param staffId — id документа в коллекции staff (формат venueId_userId)
 * @returns AcceptOfferResult
 */
export async function acceptOffer(staffId: string): Promise<AcceptOfferResult> {
  if (!staffId || !staffId.trim()) {
    return { ok: false, error: "staffId обязателен" };
  }
  const firestore = getAdminFirestore();
  const staffRef = firestore.collection("staff").doc(staffId);
  const staffSnap = await staffRef.get();
  if (!staffSnap.exists) {
    return { ok: false, error: "Предложение не найдено" };
  }
  const staffData = staffSnap.data() ?? {};
  const userId = staffData.userId as string;
  const venueId = staffData.venueId as string;
  if (!venueId || !userId) {
    return { ok: false, error: "Некорректные данные оффера" };
  }
  if (staffData.active === true) {
    return { ok: true, alreadyActive: true, venueId, userId };
  }

  const joinedAt = new Date().toISOString();

  await staffRef.update({
    active: true,
    status: "active",
    joinedAt,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const venueStaffRef = firestore.collection("venues").doc(venueId).collection("staff").doc(staffId);
  await venueStaffRef.set(
    {
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
    await globalRef.update({
      affiliations: FieldValue.arrayUnion({
        venueId,
        role: "waiter",
        status: "active",
        onShift: false,
      }),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  console.log("SUCCESS: Staff", staffId, "accepted in Venue", venueId);
  return { ok: true, venueId, userId };
}
