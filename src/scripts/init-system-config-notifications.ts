/* eslint-disable no-console */
/**
 * Разовая инициализация: system_configs/notifications
 *
 * Использование:
 *   npx tsx src/scripts/init-system-config-notifications.ts --dry-run
 *   npx tsx src/scripts/init-system-config-notifications.ts --write
 *
 * Требуется Firebase Admin в .env (как у других скриптов).
 */
import { config as loadEnv } from "dotenv";
import fs from "fs";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { NOTIFICATIONS_SYSTEM_CONFIG_DOC_ID } from "@/lib/system-configs/notifications-config";

loadEnv();
if (fs.existsSync(".env.local")) {
  loadEnv({ path: ".env.local", override: true });
}

const PAYLOAD = {
  templates: {
    status_confirmed: "Ваш заказ №{id} подтвержден и передан на кухню!",
    status_ready: "Заказ №{id} готов! Можете забирать.",
    status_completed: "Спасибо за визит! Ждем вас снова.",
  },
  global_enabled: true,
} as const;

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const write = args.includes("--write");

  if (!dryRun && !write) {
    console.error("Укажите --dry-run (только вывод) или --write (запись в Firestore).");
    process.exit(1);
  }

  const ref = getAdminFirestore().collection("system_configs").doc(NOTIFICATIONS_SYSTEM_CONFIG_DOC_ID);

  if (dryRun) {
    console.log("[dry-run] Документ:", ref.path);
    console.log(JSON.stringify(PAYLOAD, null, 2));
    return;
  }

  await ref.set(PAYLOAD, { merge: true });
  console.log("Записано:", ref.path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
