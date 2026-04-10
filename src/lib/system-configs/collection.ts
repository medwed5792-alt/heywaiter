/**
 * Единая коллекция системных конфигов Firestore (`system_configs`).
 *
 * Перенос с legacy: `system_settings/global` → `global_settings`,
 * `system_settings/bots` → `bots`, `system_config/google_maps` → `google_maps`.
 */

export const SYSTEM_CONFIGS_COLLECTION = "system_configs";

/** Бывший `system_settings/global` — глобальные флаги Mini App, geo, реклама и т.д. */
export const GLOBAL_SETTINGS_DOC_ID = "global_settings";

/** Бывший `system_settings/bots` — токены и username Telegram-ботов. */
export const BOTS_SYSTEM_CONFIG_DOC_ID = "bots";

/** Бывший `system_config/google_maps` — ключи Maps / Places. */
export const GOOGLE_MAPS_SYSTEM_CONFIG_DOC_ID = "google_maps";
