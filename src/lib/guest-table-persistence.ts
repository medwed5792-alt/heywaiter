/**
 * Сохранение «гость сидит за столом» между перезапусками Mini App (канал-агностично: ключ = globalGuestUid).
 */
import { collection, getDocs, limit, query, where, type Firestore } from "firebase/firestore";
import { guestCustomerUidsMatch } from "@/lib/identity/customer-uid";

const SEAT_KEY = "heywaiter_guest_seat_v1";

export type PersistedGuestSeat = {
  venueId: string;
  tableId: string;
  /** Id документа global_users — единый ключ для восстановления сессии в любой соцсети */
  globalGuestUid: string;
  savedAt: number;
};

export function writePersistedGuestSeat(venueId: string, tableId: string, globalGuestUid: string): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedGuestSeat = {
      venueId: venueId.trim(),
      tableId: tableId.trim(),
      globalGuestUid: globalGuestUid.trim(),
      savedAt: Date.now(),
    };
    window.localStorage.setItem(SEAT_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / private mode
  }
}

export function clearPersistedGuestSeat(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SEAT_KEY);
  } catch {
    // ignore
  }
}

/** Есть ли активная сессия стола и участвует ли гость (хозяин или в participants). */
export async function verifyGuestSeatStillActive(
  db: Firestore,
  venueId: string,
  tableId: string,
  globalGuestUid: string
): Promise<boolean> {
  const uid = globalGuestUid.trim();
  if (!uid) return false;
  const q = query(
    collection(db, "activeSessions"),
    where("venueId", "==", venueId.trim()),
    where("tableId", "==", tableId.trim()),
    where("status", "in", ["check_in_success", "payment_confirmed"]),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return false;
  const d = (snap.docs[0].data() ?? {}) as Record<string, unknown>;
  const masterId = typeof d.masterId === "string" ? d.masterId.trim() : "";
  if (guestCustomerUidsMatch(masterId, uid)) return true;
  const raw = Array.isArray(d.participants) ? d.participants : [];
  for (const p of raw) {
    const x = (p ?? {}) as Record<string, unknown>;
    const u = typeof x.uid === "string" ? x.uid.trim() : "";
    if (u && guestCustomerUidsMatch(u, uid)) return true;
  }
  return false;
}
