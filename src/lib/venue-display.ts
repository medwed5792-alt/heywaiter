/** Человекочитаемое название, если в настройках заведения поле name пустое. */
export const DEFAULT_VENUE_DISPLAY_NAME = "Наше заведение";

export function resolveVenueDisplayName(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s || DEFAULT_VENUE_DISPLAY_NAME;
}

/** Номер стола из документа стола: поля `number` или `tableNumber` (число или строка-цифры). */
export function resolveTableNumberFromDoc(data: Record<string, unknown> | undefined | null): number | null {
  if (!data) return null;
  const n = data.number ?? data.tableNumber;
  if (typeof n === "number" && !Number.isNaN(n)) return n;
  if (typeof n === "string" && n.trim() !== "") {
    const parsed = Number(n.trim());
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}
