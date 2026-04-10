/**
 * Guest Recognition Engine — сквозной поиск по всем 7 ID.
 * Масштабируется на все каналы (TG, WA, Viber, WeChat, Insta, FB, Line).
 * Источник данных: коллекция global_users (identities.*).
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
import type { Guest, GuestType, Reservation, UnifiedIdentities } from "@/lib/types";

export type RecognitionPlatform =
  | "tg"
  | "wa"
  | "vk"
  | "viber"
  | "wechat"
  | "instagram"
  | "facebook"
  | "line";

const RESERVATION_WINDOW_MS = 30 * 60 * 1000; // ±30 мин

const IDENTITY_KEY: Record<RecognitionPlatform, keyof UnifiedIdentities> = {
  tg: "tg",
  wa: "wa",
  vk: "vk",
  viber: "viber",
  wechat: "wechat",
  instagram: "inst",
  facebook: "fb",
  line: "line",
};

function globalUserDocToGuest(id: string, data: Record<string, unknown>): Guest {
  const identities = (data.identities ?? {}) as UnifiedIdentities;
  const typeRaw = data.guestType ?? data.type;
  const type: GuestType =
    typeRaw === "constant" ||
    typeRaw === "regular" ||
    typeRaw === "favorite" ||
    typeRaw === "vip" ||
    typeRaw === "blacklisted"
      ? typeRaw
      : "regular";
  const first = (data.firstName as string | undefined) ?? "";
  const last = (data.lastName as string | undefined) ?? "";
  return {
    id,
    sotaId: typeof data.sotaId === "string" ? data.sotaId : undefined,
    phone: identities.phone,
    tgId: identities.tg,
    waId: identities.wa,
    vkId: identities.vk,
    viberId: identities.viber,
    wechatId: identities.wechat,
    instagramId: identities.inst,
    facebookId: identities.fb,
    lineId: identities.line,
    name: [first, last].filter(Boolean).join(" ").trim() || (data.name as string | undefined),
    nickname: data.nickname as string | undefined,
    type,
    tier: data.tier as Guest["tier"],
    lastVisitAt: data.lastVisitAt,
    note: data.note as string | undefined,
  };
}

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
  const identityKey = IDENTITY_KEY[platform];
  const usersRef = collection(db, "global_users");
  const q = query(usersRef, where(`identities.${identityKey}`, "==", platformId), limit(1));
  const snap = await getDocs(q);
  const found = snap.docs[0];
  if (found?.exists()) {
    const guest = globalUserDocToGuest(found.id, found.data() as Record<string, unknown>);
    return { guest, kind: "OWN" };
  }
  if (options?.phone?.trim()) {
    const normalized = normalizePhone(options.phone.trim());
    if (normalized.length >= 10) {
      const byPhone = query(usersRef, where("identities.phone", "==", options.phone.trim()), limit(1));
      const phoneSnap = await getDocs(byPhone);
      const byPhoneAlt = query(usersRef, where("identities.phone", "==", normalized), limit(1));
      const phoneSnapAlt = await getDocs(byPhoneAlt);
      const existing = phoneSnap.docs[0] ?? phoneSnapAlt.docs[0];
      if (existing?.exists()) {
        const mergeCandidate = globalUserDocToGuest(
          existing.id,
          existing.data() as Record<string, unknown>
        );
        return { guest: null, kind: "MERGE_CANDIDATE", mergeCandidate };
      }
    }
  }
  return { guest: null, kind: "STRANGER" };
}

/**
 * Склейка профилей: добавляет platformId нового канала к существующему гостю (primary) в global_users.
 */
export async function mergeGuestProfiles(
  primaryGuestId: string,
  platformId: string,
  platform: RecognitionPlatform
): Promise<{ ok: boolean; error?: string }> {
  try {
    const identityKey = IDENTITY_KEY[platform];
    await updateDoc(doc(db, "global_users", primaryGuestId), {
      [`identities.${identityKey}`]: platformId,
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
  const docSnap = snap.docs[0];
  if (!docSnap?.exists()) {
    return { reserved: false, isOwner: false, reservation: null };
  }
  const reservation = { id: docSnap.id, ...docSnap.data() } as Reservation & { id: string };
  const isOwner = Boolean(guestTgId && String(reservation.tgId) === String(guestTgId));
  return { reserved: true, isOwner, reservation };
}
