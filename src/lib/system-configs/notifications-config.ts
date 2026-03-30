/**
 * Документ Firestore: system_configs/notifications
 * Тексты push / in-app для статусов предзаказа и др. (ЦУП).
 */

export const NOTIFICATIONS_SYSTEM_CONFIG_DOC_ID = "notifications";

export type PreorderNotificationTemplateKey = "status_confirmed" | "status_ready" | "status_completed";

export type NotificationTemplatesBlock = {
  status_confirmed?: string;
  status_ready?: string;
  status_completed?: string;
};

export type NotificationsSystemConfig = {
  version?: number;
  /** Если false — массовые уведомления предзаказа не отправляем (undefined = включено). */
  global_enabled?: boolean;
  /** Каноническая структура ЦУП. */
  templates?: NotificationTemplatesBlock;
  /** @deprecated Корневые ключи; читаются, если нет templates.* */
  status_confirmed?: string;
  status_ready?: string;
  status_completed?: string;
};

/** Жёсткие дефолты, если документа нет или поле пустое — без undefined и без падений. */
export const DEFAULT_NOTIFICATIONS_TEMPLATES: Required<NotificationTemplatesBlock> = {
  status_confirmed: "Ваш заказ №{id} подтвержден и передан на кухню!",
  status_ready: "Заказ №{id} готов! Можете забирать.",
  status_completed: "Спасибо за визит! Ждем вас снова.",
};

function readTemplateString(cfg: NotificationsSystemConfig, key: PreorderNotificationTemplateKey): string | undefined {
  const t = cfg.templates;
  if (t && typeof t === "object") {
    const v = t[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  const legacy = cfg[key];
  if (typeof legacy === "string" && legacy.trim()) return legacy;
  return undefined;
}

export function parseNotificationsSystemConfig(raw: Record<string, unknown> | null | undefined): NotificationsSystemConfig {
  if (!raw || typeof raw !== "object") return {};
  const templatesRaw = raw.templates;
  let templates: NotificationTemplatesBlock | undefined;
  if (templatesRaw && typeof templatesRaw === "object") {
    const tr = templatesRaw as Record<string, unknown>;
    templates = {
      status_confirmed: typeof tr.status_confirmed === "string" ? tr.status_confirmed : undefined,
      status_ready: typeof tr.status_ready === "string" ? tr.status_ready : undefined,
      status_completed: typeof tr.status_completed === "string" ? tr.status_completed : undefined,
    };
  }
  return {
    version: typeof raw.version === "number" ? raw.version : undefined,
    global_enabled: typeof raw.global_enabled === "boolean" ? raw.global_enabled : undefined,
    templates,
    status_confirmed: typeof raw.status_confirmed === "string" ? raw.status_confirmed : undefined,
    status_ready: typeof raw.status_ready === "string" ? raw.status_ready : undefined,
    status_completed: typeof raw.status_completed === "string" ? raw.status_completed : undefined,
  };
}

/** true, если отправку не отключили явно в ЦУП. */
export function isNotificationsGloballyEnabled(cfg: NotificationsSystemConfig): boolean {
  return cfg.global_enabled !== false;
}

export function interpolateNotificationTemplate(template: string, vars: { id: string }): string {
  return template.replace(/\{id\}/g, vars.id);
}

export function resolvePreorderNotificationText(
  cfg: NotificationsSystemConfig,
  key: PreorderNotificationTemplateKey,
  orderDisplayId: string
): string {
  const id = orderDisplayId.trim() || "—";
  const raw = readTemplateString(cfg, key) ?? DEFAULT_NOTIFICATIONS_TEMPLATES[key];
  return interpolateNotificationTemplate(raw, { id });
}

export const NOTIFICATIONS_SYSTEM_CONFIG_JSON_EXAMPLE = JSON.stringify(
  {
    templates: {
      status_confirmed: DEFAULT_NOTIFICATIONS_TEMPLATES.status_confirmed,
      status_ready: DEFAULT_NOTIFICATIONS_TEMPLATES.status_ready,
      status_completed: DEFAULT_NOTIFICATIONS_TEMPLATES.status_completed,
    },
    global_enabled: true,
  },
  null,
  2
);
