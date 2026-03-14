/**
 * Универсальный поиск пользователя по платформе и ID (Unified ID V.2.0).
 * Один сотрудник = один профиль в global_users, независимо от бота (TG, WA, VK, …).
 */
import { getAdminFirestore } from "@/lib/firebase-admin";
import type { UnifiedIdentities } from "@/lib/types";
import { UNIFIED_IDENTITY_KEYS } from "@/lib/types";

/** Маппинг имени канала/платформы на ключ в identities. */
const PLATFORM_TO_KEY: Record<string, keyof UnifiedIdentities> = {
  telegram: "tg",
  tg: "tg",
  whatsapp: "wa",
  wa: "wa",
  vk: "vk",
  viber: "viber",
  wechat: "wechat",
  instagram: "inst",
  inst: "inst",
  facebook: "fb",
  fb: "fb",
  line: "line",
  phone: "phone",
  email: "email",
};

/**
 * Нормализует платформу к ключу identities (tg, wa, vk, …).
 */
export function toIdentityKey(platform: string): keyof UnifiedIdentities | null {
  const key = PLATFORM_TO_KEY[platform.toLowerCase().trim()] ?? (platform as keyof UnifiedIdentities);
  if (UNIFIED_IDENTITY_KEYS.includes(key)) return key;
  return null;
}

/**
 * Ищет пользователя в global_users по полю identities.{platform}.
 * @param platform — ключ платформы: "tg" | "wa" | "vk" | "viber" | "wechat" | "inst" | "fb" | "line" | "phone" | "email" или имя канала (telegram, whatsapp, …)
 * @param platformId — значение (например telegram user id, номер телефона).
 * @returns userId (id документа global_users) или null.
 */
export async function findUserByIdentity(
  platform: string,
  platformId: string
): Promise<string | null> {
  const key = toIdentityKey(platform);
  if (!key) return null;
  const value = typeof platformId === "string" ? platformId.trim() : String(platformId).trim();
  if (!value) return null;

  const firestore = getAdminFirestore();
  const snap = await firestore
    .collection("global_users")
    .where(`identities.${key}`, "==", value)
    .limit(1)
    .get();

  if (snap.empty) return null;
  return snap.docs[0].id;
}
