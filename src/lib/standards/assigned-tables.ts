/**
 * Жёсткая нормализация одного элемента перед проверкой по справочнику столов.
 */
function normalizeTableIdEntry(x: unknown): string | null {
  if (x === null || x === undefined) return null;
  if (typeof x === "number") {
    if (x === 0 || !Number.isFinite(x)) return null;
    return String(x);
  }
  const s = String(x).trim();
  if (!s || s === "0") return null;
  return s;
}

/**
 * Закрепление столов за сотрудником: только валидные doc-id из текущей коллекции `venues/{venueId}/tables`.
 * Любые 0, "0", null, пустые строки и несуществующие id отбрасываются; если нечего оставить — [].
 */
export function sanitizeAssignedTableIdsForVenue(
  raw: unknown,
  allowedTableDocIds: Set<string>
): string[] {
  if (!Array.isArray(raw)) return [];
  if (allowedTableDocIds.size === 0) return [];
  const out: string[] = [];
  for (const x of raw) {
    const s = normalizeTableIdEntry(x);
    if (s == null) continue;
    if (allowedTableDocIds.has(s)) out.push(s);
  }
  return [...new Set(out)];
}

/** Клиент/сервер: оставить только id, присутствующие в справочнике столов (массив doc-id). */
export function filterAssignedTableIdsToVenueDocIds(ids: unknown, allowedTableDocIds: Set<string>): string[] {
  return sanitizeAssignedTableIdsForVenue(Array.isArray(ids) ? ids : [], allowedTableDocIds);
}
