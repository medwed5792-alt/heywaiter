import type { ActiveSession } from "@/lib/types";

/**
 * ID документа staff / swid для чаевых — из снимка activeSessions (приоритет полей сессии).
 */
export function resolveWaiterStaffIdFromSessionDoc(data: Record<string, unknown>): string | null {
  const assigned = typeof data.assignedStaffId === "string" ? data.assignedStaffId.trim() : "";
  if (assigned) return assigned;
  const waiter = typeof data.waiterId === "string" ? data.waiterId.trim() : "";
  if (waiter) return waiter;
  const assignments = data.assignments as Record<string, unknown> | undefined;
  if (assignments && typeof assignments === "object") {
    const w = typeof assignments.waiter === "string" ? assignments.waiter.trim() : "";
    if (w) return w;
  }
  return null;
}

export function normalizeActiveSessionStatus(raw: string): ActiveSession["status"] {
  const s = raw.trim();
  const u = s.toUpperCase();
  if (s === "awaiting_guest_feedback" || u === "AWAITING_FEEDBACK") return "awaiting_guest_feedback";
  if (s === "completed" || u === "COMPLETED") return "completed";
  if (s === "closed") return "closed";
  if (s === "table_conflict") return "table_conflict";
  return "check_in_success";
}
