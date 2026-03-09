/**
 * Заявка на бронирование от гостя (кнопка «Бронирование» в боте).
 * Если >24ч и есть свободный стол — автоподтверждение. Если <24ч или нет стола — запрос ЛПР с контактом гостя.
 */
import { NextRequest, NextResponse } from "next/server";

const HOURS_AUTO_CONFIRM = 24;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
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
    const startAt = new Date(`${date}T${startTime ?? "12:00"}:00`);
    const now = new Date();
    const hoursUntil = (startAt.getTime() - now.getTime()) / (60 * 60 * 1000);
    const canAutoConfirm = hoursUntil >= HOURS_AUTO_CONFIRM;

    const tablesSnap = await firestore.collection("tables").where("venueId", "==", venueId).limit(50).get();
    const sessionsSnap = await firestore
      .collection("activeSessions")
      .where("venueId", "==", venueId)
      .where("status", "==", "check_in_success")
      .get();
    const occupied = new Set(sessionsSnap.docs.map((d) => d.data().tableId ?? ""));
    const freeTable = tablesSnap.docs.find((d) => !occupied.has((d.data().tableId ?? d.id) as string));
    const tableId = freeTable ? (freeTable.data().tableId ?? freeTable.id) as string : "";

    const status = canAutoConfirm && tableId ? "confirmed" : "pending";
    const doc = {
      venueId,
      tableId: tableId || "",
      guestName: guestName ?? "",
      guestContact: guestContact ?? "",
      seats: seats ?? 2,
      date: date ?? "",
      startTime: startTime ?? "12:00",
      endTime: endTime ?? "14:00",
      startAt: startAt,
      status,
      arrived: false,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await firestore.collection("bookings").add(doc);

    if (status === "pending") {
      await firestore.collection("staffNotifications").add({
        venueId,
        tableId: "",
        type: "booking_request",
        message: `Заявка на бронь: ${guestName ?? "Гость"}, ${date} ${startTime ?? ""}–${endTime ?? ""}, контакт: ${guestContact ?? "—"}`,
        read: false,
        targetUids: [] as string[],
        payload: { bookingId: ref.id },
        createdAt: now,
      });
    }

    return NextResponse.json({ ok: true, bookingId: ref.id, status });
  } catch (err) {
    console.error("[bookings/request]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
