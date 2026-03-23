import { addDoc, collection, serverTimestamp, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { resolveVenueId } from "@/lib/standards/venue-default";
import { getWaiterIdFromTablePayload } from "@/lib/standards/table-waiter";

export type GuestEventType = "call_waiter" | "request_bill" | "sos";

interface GuestEventPayload {
  type: GuestEventType;
  tableId: string;
  tableNumber?: number;
  /** Unified UID for guest actions: telegram_user_id:* or anonymous_id:* */
  customerUid?: string;
  /** @deprecated use customerUid */
  visitorId?: string;
  /** Если не задан — используется дефолтное заведение (одна свая в текущей сборке). */
  venueId?: string;
}

/** Алиас к единой схеме `getWaiterIdFromTablePayload` (см. @/lib/standards/table-waiter). */
export function getWaiterIdFromTableDoc(data: Record<string, unknown>): string | null {
  return getWaiterIdFromTablePayload(data);
}

/**
 * Только документ venues/{venueId}/tables/{tableId}; официант — поле currentWaiterId (как в Дашборде).
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
  const staffId = getWaiterIdFromTableDoc(data);
  if (!staffId) {
    return { status: "unassigned" };
  }
  return { assignedStaffId: staffId };
}

export async function createGuestEvent(payload: GuestEventPayload): Promise<void> {
  const { type, tableId, tableNumber } = payload;
  const customerUid = payload.customerUid?.trim() || payload.visitorId?.trim() || undefined;
  const effectiveVenueId = resolveVenueId(payload.venueId);

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
    customerUid: customerUid ?? null,
    ...(customerUid ? { visitorId: customerUid } : { visitorId: null }), // backward compatibility
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

  const pushPayload = {
    venueId: effectiveVenueId,
    tableId,
    customerUid,
    type: type as "call_waiter" | "request_bill" | "sos",
  };
  if (typeof window === "undefined") {
    const { pushCallWaiterNotification } = await import("@/lib/notifications/push-call-waiter");
    await pushCallWaiterNotification(pushPayload).catch((e) =>
      console.warn("[createGuestEvent] pushCallWaiterNotification:", e)
    );
  } else {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    await fetch(`${origin}/api/notifications/call-waiter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pushPayload),
    }).catch((e) => console.warn("[createGuestEvent] call-waiter fetch:", e));
  }
}
