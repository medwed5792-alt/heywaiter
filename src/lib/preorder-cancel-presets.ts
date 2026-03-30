/** Пресеты причины отклонения предзаказа персоналом (Staff App). */
export const PREORDER_STAFF_CANCEL_PRESETS = [
  "Нет продуктов",
  "Заведение перегружено",
  "Технический сбой",
] as const;

export type PreorderStaffCancelPreset = (typeof PREORDER_STAFF_CANCEL_PRESETS)[number];

export function isPreorderStaffCancelPreset(s: string): s is PreorderStaffCancelPreset {
  return (PREORDER_STAFF_CANCEL_PRESETS as readonly string[]).includes(s);
}

/** Текст `cancelReason` при отмене гостём (хранится в документе корзины). */
export const PREORDER_GUEST_CANCEL_REASON = "Отмена гостем";
