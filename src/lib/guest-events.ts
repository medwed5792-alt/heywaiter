import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

const VENUE_ID = "venue_andrey_alt";

export type GuestEventType = "call_waiter" | "request_bill" | "sos";

interface GuestEventPayload {
  type: GuestEventType;
  tableId: string;
  tableNumber?: number;
  visitorId?: string;
}

export async function createGuestEvent(payload: GuestEventPayload): Promise<void> {
  const { type, tableId, tableNumber, visitorId } = payload;
  const baseMessage =
    type === "request_bill"
      ? `Стол №${tableNumber ?? tableId}: запрос счёта`
      : type === "sos"
        ? `Стол №${tableNumber ?? tableId}: SOS`
        : `Стол №${tableNumber ?? tableId}: вызов официанта`;

  await addDoc(collection(db, "venues", VENUE_ID, "events"), {
    venueId: VENUE_ID,
    tableId,
    tableNumber: tableNumber ?? null,
    type,
    message: baseMessage,
    text: baseMessage,
    visitorId: visitorId ?? null,
    read: false,
    createdAt: serverTimestamp(),
    timestamp: serverTimestamp(),
  });
}

