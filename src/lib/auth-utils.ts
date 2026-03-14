/**
 * Утилиты для Unified Identity: поиск существующего пользователя по идентификаторам.
 * Использует firebase-admin (FIREBASE_PRIVATE_KEY с обработкой \n в firebase-admin.ts).
 */
import { getAdminFirestore } from "@/lib/firebase-admin";
import type { UnifiedIdentities } from "@/lib/types";
import { UNIFIED_IDENTITY_KEYS } from "@/lib/types";

/**
 * Ищет существующий userId в коллекции global_users по доступным полям identities.
 * Поочерёдно проверяет identities.tg, .email, .phone, .wa, .vk (where('identities.<key>', '==', value)).
 * Возвращает id первого найденного документа или null.
 */
export async function findExistingUserIdByIdentities(
  identities: UnifiedIdentities
): Promise<string | null> {
  const firestore = getAdminFirestore();
  for (const key of UNIFIED_IDENTITY_KEYS) {
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

/**
 * Ищет userId по одному полю identities. Если excludeUserId задан, игнорирует этот документ (для проверки дубликата при редактировании).
 */
export async function findUserIdByIdentityKey(
  key: keyof UnifiedIdentities,
  value: string,
  excludeUserId?: string
): Promise<string | null> {
  if (!value || !value.trim()) return null;
  const firestore = getAdminFirestore();
  const snap = await firestore
    .collection("global_users")
    .where(`identities.${key}`, "==", value.trim())
    .limit(2)
    .get();
  for (const doc of snap.docs) {
    if (excludeUserId && doc.id === excludeUserId) continue;
    return doc.id;
  }
  return null;
}
