/**
 * Источник истины — документ venues/{venueId}/tables/{tableId} (как в Дашборде).
 * Для маршрутизации вызова используется только поле currentWaiterId (ID документа в staff).
 */
export function getWaiterIdFromTablePayload(data: Record<string, unknown>): string | null {
  const raw = typeof data.currentWaiterId === "string" ? data.currentWaiterId.trim() : "";
  return raw || null;
}
