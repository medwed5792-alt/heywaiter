/**
 * Единая схема: кто закреплён за столом (документ venues/{venueId}/tables/{tableId}).
 * Порядок полей синхронизирован с дашбордом, Mini App и push-call-waiter.
 */
export function getWaiterIdFromTablePayload(data: Record<string, unknown>): string | null {
  const assignments = data.assignments as { waiter?: unknown } | undefined;
  const raw =
    (typeof data.currentWaiterId === "string" ? data.currentWaiterId : null) ??
    (typeof data.waiterId === "string" ? data.waiterId : null) ??
    (assignments?.waiter != null ? String(assignments.waiter) : null) ??
    (typeof data.assignedStaffId === "string" ? data.assignedStaffId : null);
  const s = raw?.trim();
  return s || null;
}
