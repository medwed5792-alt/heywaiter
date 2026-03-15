/**
 * Заявка на бронирование от гостя (кнопка «Бронирование» в боте).
 * Если >24ч и есть свободный стол — автоподтверждение. Если <24ч или нет стола — запрос ЛПР с контактом гостя.
 * Все даты в Firestore пишутся как Timestamp.
 */
import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

const HOURS_AUTO_CONFIRM = 24;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { venueId, guestName, guestContact, seats, date, startTime, endTime } = body as {
      venueId?: string;
      guestName?: string;
      guestContact?: string;
      seats?: number;
      date?: string;
      startTime?: string;
      endTime?: string;
    };
    if (!venueId || !date) {
      return NextResponse.json({ error: "venueId and date required" }, { status: 400 });
    }
    const { getAdminFirestore } = await import("@/lib/firebase-admin");
    const firestore = getAdminFirestore();
    const startAtDate = new Date(`${String(date).trim()}T${String(startTime ?? "12:00").trim()}:00`);
    const now = new Date();
    const hoursUntil = (startAtDate.getTime() - now.getTime()) / (60 * 60 * 1000);
    const canAutoConfirm = hoursUntil >= HOURS_AUTO_CONFIRM;

    const sessionsSnap = await firestore
      .collection("activeSessions")
      .where("venueId", "==", venueId)
      .where("status", "==", "check_in_success")
      .get();
    const occupied = new Set(sessionsSnap.docs.map((d) => String(d.data().tableId ?? "").trim()));

    let tableId = "";
    const venueTablesSnap = await firestore.collection("venues").doc(venueId).collection("tables").get();
    if (venueTablesSnap.size > 0) {
      const free = venueTablesSnap.docs.find((d) => !occupied.has(d.id));
      if (free) tableId = free.id;
    }
    if (!tableId) {
      const rootTablesSnap = await firestore.collection("tables").where("venueId", "==", venueId).limit(50).get();
      const freeRoot = rootTablesSnap.docs.find((d) => !occupied.has((d.data().tableId ?? d.id) as string));
      if (freeRoot) tableId = (freeRoot.data().tableId ?? freeRoot.id) as string;
    }

    const status = canAutoConfirm && tableId ? "confirmed" : "pending";
    const doc = {
      venueId: String(venueId).trim(),
      tableId: String(tableId).trim(),
      guestName: String(guestName ?? "").trim(),
      guestContact: String(guestContact ?? "").trim(),
      seats: typeof seats === "number" && seats > 0 ? seats : 2,
      date: String(date).trim(),
      startTime: String(startTime ?? "12:00").trim(),
      endTime: String(endTime ?? "14:00").trim(),
      startAt: Timestamp.fromDate(startAtDate),
      status,
      arrived: false,
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
    };
    const ref = await firestore.collection("bookings").add(doc);

    if (status === "pending") {
      await firestore.collection("staffNotifications").add({
        venueId,
        tableId: tableId || "",
        type: "booking_request",
        message: `Заявка на бронь: ${guestName ?? "Гость"}, ${date} ${startTime ?? ""}–${endTime ?? ""}, контакт: ${guestContact ?? "—"}`,
        read: false,
        targetUids: [] as string[],
        payload: { bookingId: ref.id },
        createdAt: Timestamp.fromDate(now),
      });
    }

    return NextResponse.json({ ok: true, bookingId: ref.id, status });
  } catch (err) {
    console.error("[bookings/request]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
