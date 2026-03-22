/**
 * Закрепление столов за сотрудником: только валидные doc-id столов заведения.
 * Нули, пустые строки и несуществующие id отбрасываются; если нечего оставить — [].
 */
export function sanitizeAssignedTableIdsForVenue(
  raw: unknown,
  allowedTableDocIds: Set<string>
): string[] {
  if (!Array.isArray(raw) || allowedTableDocIds.size === 0) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (x === null || x === undefined) continue;
    if (typeof x === "number" && (x === 0 || !Number.isFinite(x))) continue;
    const s = String(x).trim();
    if (!s || s === "0") continue;
    if (allowedTableDocIds.has(s)) out.push(s);
  }
  return [...new Set(out)];
}
