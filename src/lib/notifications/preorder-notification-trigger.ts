import type { Firestore } from "firebase-admin/firestore";
import {
  NOTIFICATIONS_SYSTEM_CONFIG_DOC_ID,
  type PreorderNotificationTemplateKey,
  isNotificationsGloballyEnabled,
  parseNotificationsSystemConfig,
  resolvePreorderNotificationText,
} from "@/lib/system-configs/notifications-config";
import { sendSotaNotification, type PreorderCartNotificationContext } from "@/lib/notifications/sota-notification-dispatcher";

/** Шаблоны, которые уходят гостю через sendSotaNotification (не алерт персоналу). */
export type PreorderGuestOutboundTemplateKey = Exclude<
  PreorderNotificationTemplateKey,
  "preorder_guest_cancelled_staff"
>;

export type DispatchPreorderNotificationArgs = {
  firestore: Firestore;
  venueId: string;
  cartDocId: string;
  customerUid: string;
  templateKey: PreorderGuestOutboundTemplateKey;
  /** Подстановка {id} в шаблон из ЦУП */
  orderDisplayId: string;
  /** Для status_cancelled_by_staff — подстановка {reason} */
  cancelReason?: string;
};

/**
 * Загружает тексты из system_configs/notifications и отправляет уведомление в канал гостя.
 * Вызывается из API персонала и в будущем — из Cloud Function onWrite(preorder_carts).
 */
export async function dispatchPreorderStatusNotification(args: DispatchPreorderNotificationArgs): Promise<void> {
  let cfg = parseNotificationsSystemConfig(undefined);

  try {
    const cfgSnap = await args.firestore.collection("system_configs").doc(NOTIFICATIONS_SYSTEM_CONFIG_DOC_ID).get();
    cfg = parseNotificationsSystemConfig(
      cfgSnap.exists ? (cfgSnap.data() as Record<string, unknown>) : undefined
    );
  } catch (e) {
    console.warn("[dispatch preorder notify] не удалось прочитать system_configs/notifications, используем дефолты", e);
    cfg = {};
  }

  if (!isNotificationsGloballyEnabled(cfg)) {
    console.log("[dispatch preorder notify] пропуск: global_enabled = false");
    return;
  }

  const orderId = args.orderDisplayId.trim() || args.cartDocId;
  const message =
    args.templateKey === "status_cancelled_by_staff"
      ? resolvePreorderNotificationText(cfg, args.templateKey, orderId, {
          cancelReason: args.cancelReason,
        })
      : resolvePreorderNotificationText(cfg, args.templateKey, orderId);

  const cartContext: PreorderCartNotificationContext = {
    venueId: args.venueId,
    cartDocId: args.cartDocId,
  };

  await sendSotaNotification(args.firestore, args.customerUid, message, cartContext, {
    statusKey: args.templateKey,
  });
}

/**
 * Триггер Firestore (для выноса в Cloud Functions):
 *
 * onUpdate('venues/{venueId}/preorder_carts/{cartId}') → если изменился status,
 * вызвать dispatchPreorderStatusNotification({ ... , templateKey: 'status_confirmed' | 'status_ready' }).
 *
 * В монолите Next.js пока вызываем dispatch после успешного updateDoc из Staff App (см. /api/staff/preorder-notify).
 */
export const PREORDER_CART_NOTIFICATION_TRIGGER_NOTE = "preorder_carts Cloud Function hook — см. JSDoc выше";
