/**
 * Утилиты для Unified Identity: поиск существующего пользователя по идентификаторам.
 * Использует firebase-admin (FIREBASE_PRIVATE_KEY с обработкой \n в firebase-admin.ts).
 */
import { getAdminFirestore } from "@/lib/firebase-admin";
import type { UnifiedIdentities } from "@/lib/types";

const IDENTITY_KEYS = ["tg", "email", "phone", "wa", "vk"] as const;

/**
 * Ищет существующий userId в коллекции global_users по доступным полям identities.
 * Поочерёдно проверяет identities.tg, .email, .phone, .wa, .vk (where('identities.<key>', '==', value)).
 * Возвращает id первого найденного документа или null.
 */
export async function findExistingUserIdByIdentities(
  identities: UnifiedIdentities
): Promise<string | null> {
  const firestore = getAdminFirestore();
  for (const key of IDENTITY_KEYS) {
    const value = identities[key];
    if (!value || typeof value !== "string" || !value.trim()) continue;
    const snap = await firestore
      .collection("global_users")
      .where(`identities.${key}`, "==", value.trim())
      .limit(1)
      .get();
    if (!snap.empty) {
      return snap.docs[0].id;
    }
  }
  return null;
}
