/**
 * Чтение/запись настроек ботов в Firestore (system_configs/bots).
 * Приоритет: Firestore (system_configs/bots) → env (TELEGRAM_BOT_TOKEN / TELEGRAM_TOKEN).
 * Только для сервера (API routes) — использует firebase-admin.
 */

import type { BotType } from "@/lib/webhook/channels";
import { getBotToken } from "@/lib/webhook/channels";
import {
  BOTS_SYSTEM_CONFIG_DOC_ID,
  SYSTEM_CONFIGS_COLLECTION,
} from "@/lib/system-configs/collection";

const BOTS_DOC_PATH = `${SYSTEM_CONFIGS_COLLECTION}/${BOTS_SYSTEM_CONFIG_DOC_ID}`;

export interface BotsConfig {
  tg_client_token?: string | null;
  tg_staff_token?: string | null;
  tg_client_username?: string | null;
  tg_staff_username?: string | null;
}

export async function getBotsConfig(): Promise<BotsConfig> {
  const { getAdminFirestore } = await import("@/lib/firebase-admin");
  const firestore = getAdminFirestore();
  const doc = await firestore.doc(BOTS_DOC_PATH).get();
  const data = doc.exists ? (doc.data() as BotsConfig) : {};
  return {
    tg_client_token: data?.tg_client_token ?? null,
    tg_staff_token: data?.tg_staff_token ?? null,
    tg_client_username: data?.tg_client_username ?? null,
    tg_staff_username: data?.tg_staff_username ?? null,
  };
}

export async function getBotTokenFromStore(
  channel: string,
  botType: BotType
): Promise<string | undefined> {
  if (channel !== "telegram") return undefined;
  const config = await getBotsConfig();
  if (botType === "client") return config.tg_client_token ?? undefined;
  return config.tg_staff_token ?? undefined;
}

/**
 * Эффективный токен: сначала Firestore (system_configs/bots), при пустоте — env (TELEGRAM_BOT_TOKEN / TELEGRAM_TOKEN).
 */
export async function getEffectiveBotToken(
  channel: string,
  botType: BotType
): Promise<string | undefined> {
  const fromStore = await getBotTokenFromStore(channel, botType);
  if (fromStore) return fromStore;
  return getBotToken(channel, botType);
}

export async function getBotUsernameFromStore(
  botType: "client" | "staff"
): Promise<string | undefined> {
  const config = await getBotsConfig();
  if (botType === "client") return config.tg_client_username ?? undefined;
  return config.tg_staff_username ?? undefined;
}

export async function updateBotsConfig(updates: Partial<BotsConfig>): Promise<void> {
  const { getAdminFirestore } = await import("@/lib/firebase-admin");
  const firestore = getAdminFirestore();
  const ref = firestore.doc(BOTS_DOC_PATH);
  await ref.set(
    {
      ...updates,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}
