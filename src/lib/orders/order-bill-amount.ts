/** Расчёт суммы заказа для счёта и архива визитов (общая логика с request-bill). */

export type OrderBillItemInfo = { label: string; amount: number };

export function parseOrderMoneyNumber(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function extractOrderBillInfo(data: Record<string, unknown>): { amount: number; items: OrderBillItemInfo[] } {
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items: OrderBillItemInfo[] = [];
  for (const i of rawItems) {
    const x = (i ?? {}) as Record<string, unknown>;
    const label =
      String(x.name ?? x.title ?? x.dishName ?? x.itemName ?? "").trim() || "Позиция";
    const qty = Math.max(parseOrderMoneyNumber(x.qty ?? x.quantity), 1);
    const unit = parseOrderMoneyNumber(x.price ?? x.unitPrice);
    const row = parseOrderMoneyNumber(x.amount ?? x.total);
    const amount = row > 0 ? row : unit > 0 ? unit * qty : 0;
    items.push({ label: qty > 1 ? `${label} x${qty}` : label, amount });
  }

  if (items.length === 0) {
    const single =
      parseOrderMoneyNumber(data.amount) ||
      parseOrderMoneyNumber(data.total) ||
      parseOrderMoneyNumber(data.sum) ||
      parseOrderMoneyNumber(data.price);
    if (single > 0) items.push({ label: `Заказ`, amount: single });
  }

  const amount = items.reduce((acc, i) => acc + i.amount, 0);
  return { amount, items };
}
