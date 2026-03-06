/**
 * Guest Recognition Engine — сквозной поиск по всем 7 ID.
 * Масштабируется на все каналы (TG, WA, Viber, WeChat, Insta, FB, Line).
 */
import {
  collection,
  doc,
  query,
  where,
  getDocs,
  updateDoc,
  serverTimestamp,
  limit,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Guest, Reservation } from "@/lib/types";

export type RecognitionPlatform =
  | "tg" | "wa" | "vk" | "viber" | "wechat" | "instagram" | "facebook";

const RESERVATION_WINDOW_MS = 30 * 60 * 1000; // ±30 мин

const PLATFORM_FIELD: Record<
  RecognitionPlatform,
  keyof Pick<Guest, "tgId" | "waId" | "vkId" | "viberId" | "wechatId" | "instagramId" | "facebookId">
> = {
  tg: "tgId",
  wa: "waId",
  vk: "vkId",
  viber: "viberId",
  wechat: "wechatId",
  instagram: "instagramId",
  facebook: "facebookId",
};

export interface IdentifyResult {
  guest: Guest | null;
  kind: "OWN" | "STRANGER" | "MERGE_CANDIDATE";
  /** При kind === "MERGE_CANDIDATE": гость из другого канала с тем же телефоном (предложить склеить) */
  mergeCandidate?: Guest;
}

export interface ReservationCheckResult {
  reserved: boolean;
  isOwner: boolean;
  reservation: (Reservation & { id: string }) | null;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

/**
 * Идентифицирует гостя по ID в мессенджере. Опционально — по телефону для склейки профилей.
 * OWN — найден по platformId; STRANGER — не найден; MERGE_CANDIDATE — не найден по platformId, но найден другой профиль с тем же phone.
 */
export async function identifyGuest(
  platformId: string,
  platform: RecognitionPlatform,
  options?: { phone?: string }
): Promise<IdentifyResult> {
  const field = PLATFORM_FIELD[platform];
  const guestsRef = collection(db, "guests");
  const q = query(guestsRef, where(field, "==", platformId), limit(1));
  const snap = await getDocs(q);
  const found = snap.docs[0];
  if (found?.exists()) {
    const guest = { id: found.id, ...found.data() } as Guest;
    return { guest, kind: "OWN" };
  }
  if (options?.phone?.trim()) {
    const normalized = normalizePhone(options.phone.trim());
    if (normalized.length >= 10) {
      const byPhone = query(guestsRef, where("phone", "==", options.phone.trim()), limit(1));
      const phoneSnap = await getDocs(byPhone);
      const byPhoneAlt = query(guestsRef, where("phone", "==", normalized), limit(1));
      const phoneSnapAlt = await getDocs(byPhoneAlt);
      const existing = phoneSnap.docs[0] ?? phoneSnapAlt.docs[0];
      if (existing?.exists()) {
        const mergeCandidate = { id: existing.id, ...existing.data() } as Guest;
        return { guest: null, kind: "MERGE_CANDIDATE", mergeCandidate };
      }
    }
  }
  return { guest: null, kind: "STRANGER" };
}

/**
 * Склейка профилей: добавляет platformId нового канала к существующему гостю (primary).
 */
export async function mergeGuestProfiles(
  primaryGuestId: string,
  platformId: string,
  platform: RecognitionPlatform
): Promise<{ ok: boolean; error?: string }> {
  try {
    const field = PLATFORM_FIELD[platform];
    await updateDoc(doc(db, "guests", primaryGuestId), {
      [field]: platformId,
      updatedAt: serverTimestamp(),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

/**
 * Проверка брони по правилу 30 мин: есть ли активная бронь на стол в окне ±30 мин.
 * isOwner: true если переданный tgId совпадает с reservation.tgId.
 */
export async function getReservationForTable(
  venueId: string,
  tableId: string,
  guestTgId: string | undefined
): Promise<ReservationCheckResult> {
  const now = new Date();
  const windowStart = Timestamp.fromDate(new Date(now.getTime() - RESERVATION_WINDOW_MS));
  const windowEnd = Timestamp.fromDate(new Date(now.getTime() + RESERVATION_WINDOW_MS));

  const resRef = collection(db, "reservations");
  const q = query(
    resRef,
    where("venueId", "==", venueId),
    where("tableId", "==", tableId),
    where("reservedAt", ">=", windowStart),
    where("reservedAt", "<=", windowEnd),
    limit(1)
  );
  const snap = await getDocs(q);
  const doc = snap.docs[0];
  if (!doc?.exists()) {
    return { reserved: false, isOwner: false, reservation: null };
  }
  const reservation = { id: doc.id, ...doc.data() } as Reservation & { id: string };
  const isOwner = Boolean(guestTgId && String(reservation.tgId) === String(guestTgId));
  return { reserved: true, isOwner, reservation };
}
