import { addDoc, collection, serverTimestamp, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

const DEFAULT_VENUE_ID = "venue_andrey_alt";

export type GuestEventType = "call_waiter" | "request_bill" | "sos";

interface GuestEventPayload {
  type: GuestEventType;
  tableId: string;
  tableNumber?: number;
  visitorId?: string;
  /** Если не задан — используется дефолтное заведение (одна свая в текущей сборке). */
  venueId?: string;
}

/**
 * Та же схема приоритетов, что и на Дашборде для «карты стола», плюс currentWaiterId из редактора.
 */
function pickWaiterIdFromTableData(data: Record<string, unknown>): string | null {
  const assignments = data.assignments as { waiter?: unknown } | undefined;
  const raw =
    (typeof data.currentWaiterId === "string" ? data.currentWaiterId : null) ??
    (typeof data.waiterId === "string" ? data.waiterId : null) ??
    (assignments?.waiter != null ? String(assignments.waiter) : null) ??
    (typeof data.assignedStaffId === "string" ? data.assignedStaffId : null);
  const s = raw?.trim();
  return s || null;
}

/**
 * Читает карточку стола и staff: при закреплённом на смене официанте возвращает его id,
 * иначе — сигнал для ленты «общий» вызов (ЛПР).
 */
export async function resolveAssignedStaffForCall(
  venueId: string,
  tableId: string
): Promise<{ assignedStaffId: string } | { status: "unassigned" }> {
  const tableSnap = await getDoc(doc(db, "venues", venueId, "tables", tableId));
  if (!tableSnap.exists()) {
    return { status: "unassigned" };
  }
  const data = (tableSnap.data() ?? {}) as Record<string, unknown>;
  const staffId = pickWaiterIdFromTableData(data);
  if (!staffId) {
    return { status: "unassigned" };
  }
  const staffSnap = await getDoc(doc(db, "staff", staffId));
  if (!staffSnap.exists()) {
    return { status: "unassigned" };
  }
  const sd = staffSnap.data() ?? {};
  const onVenue = sd.venueId === venueId;
  const onShift = sd.onShift === true;
  if (onVenue && onShift) {
    return { assignedStaffId: staffId };
  }
  return { status: "unassigned" };
}

export async function createGuestEvent(payload: GuestEventPayload): Promise<void> {
  const { type, tableId, tableNumber, visitorId } = payload;
  const effectiveVenueId = (payload.venueId?.trim() || DEFAULT_VENUE_ID).trim();

  const baseMessage =
    type === "request_bill"
      ? `Стол №${tableNumber ?? tableId}: запрос счёта`
      : type === "sos"
        ? `Стол №${tableNumber ?? tableId}: SOS`
        : `Стол №${tableNumber ?? tableId}: вызов официанта`;

  const resolution = await resolveAssignedStaffForCall(effectiveVenueId, tableId);

  const eventBody: Record<string, unknown> = {
    venueId: effectiveVenueId,
    tableId,
    tableNumber: tableNumber ?? null,
    type,
    message: baseMessage,
    text: baseMessage,
    visitorId: visitorId ?? null,
    read: false,
    createdAt: serverTimestamp(),
    timestamp: serverTimestamp(),
  };

  if ("assignedStaffId" in resolution) {
    eventBody.assignedStaffId = resolution.assignedStaffId;
  } else {
    eventBody.status = "unassigned";
  }

  await addDoc(collection(db, "venues", effectiveVenueId, "events"), eventBody);
}
