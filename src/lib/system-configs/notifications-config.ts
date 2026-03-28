/**
 * Документ Firestore: system_configs/notifications
 * Тексты push / in-app для статусов предзаказа и др. (ЦУП).
 */

export const NOTIFICATIONS_SYSTEM_CONFIG_DOC_ID = "notifications";

export type PreorderNotificationTemplateKey = "status_confirmed" | "status_ready";

export type NotificationsSystemConfig = {
  version?: number;
  /** Шаблон с плейсхолдером {id} — номер/метка заказа для гостя. */
  status_confirmed?: string;
  status_ready?: string;
};

export const DEFAULT_NOTIFICATIONS_TEMPLATES: Required<
  Pick<NotificationsSystemConfig, "status_confirmed" | "status_ready">
> = {
  status_confirmed: "Ваш заказ №{id} подтвержден!",
  status_ready: "Заказ №{id} готов, ждем вас!",
};

export function parseNotificationsSystemConfig(raw: Record<string, unknown> | null | undefined): NotificationsSystemConfig {
  if (!raw || typeof raw !== "object") return {};
  return {
    version: typeof raw.version === "number" ? raw.version : undefined,
    status_confirmed: typeof raw.status_confirmed === "string" ? raw.status_confirmed : undefined,
    status_ready: typeof raw.status_ready === "string" ? raw.status_ready : undefined,
  };
}

export function interpolateNotificationTemplate(template: string, vars: { id: string }): string {
  return template.replace(/\{id\}/g, vars.id);
}

export function resolvePreorderNotificationText(
  cfg: NotificationsSystemConfig,
  key: PreorderNotificationTemplateKey,
  orderDisplayId: string
): string {
  const raw =
    key === "status_confirmed"
      ? (cfg.status_confirmed ?? DEFAULT_NOTIFICATIONS_TEMPLATES.status_confirmed)
      : (cfg.status_ready ?? DEFAULT_NOTIFICATIONS_TEMPLATES.status_ready);
  return interpolateNotificationTemplate(raw, { id: orderDisplayId });
}

export const NOTIFICATIONS_SYSTEM_CONFIG_JSON_EXAMPLE = JSON.stringify(
  {
    version: 1,
    status_confirmed: "Ваш заказ №{id} подтвержден!",
    status_ready: "Заказ №{id} готов, ждем вас!",
  },
  null,
  2
);
