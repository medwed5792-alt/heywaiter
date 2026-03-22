import { NextRequest, NextResponse } from "next/server";
import type { ActiveSession, MessengerIdentity } from "@/lib/types";
import { resolveVenueId } from "@/lib/standards/venue-default";

const RESERVATION_WINDOW_MS = 30 * 60 * 1000; // 30 мин

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { venueId, tableId, tableNumber, guestId, guestIdentity: rawGuest } = body as {
      venueId?: string;
      tableId?: string;
      tableNumber?: number;
      guestId?: string;
      guestIdentity?: unknown;
    };
    const guestIdentity: MessengerIdentity | undefined =
      rawGuest && typeof rawGuest === "object" && "channel" in rawGuest && "externalId" in rawGuest
        ? (rawGuest as MessengerIdentity)
        : undefined;
    const guestExternalId = guestIdentity?.externalId ?? undefined;

    if (!venueId || !tableId) {
      return NextResponse.json(
        { error: "venueId and tableId required" },
        { status: 400 }
      );
    }

    const { getAdminFirestore } = await import("@/lib/firebase-admin");
    const firestore = getAdminFirestore();
    const now = new Date();
    const windowStart = new Date(now.getTime() - RESERVATION_WINDOW_MS);
    const windowEnd = new Date(now.getTime() + RESERVATION_WINDOW_MS);

    // Цифровой замок: если сканирующий гость совпадает с guestId в активной брони на этот стол (±30 мин) — arrived, сессия активируется, официанту пуш "Ваш гость пришел!"
    const bookingsSnap = await firestore
      .collection("bookings")
      .where("venueId", "==", venueId)
      .where("tableId", "==", tableId)
      .where("status", "in", ["pending", "confirmed"])
      .get();

    let matchedBooking: (typeof bookingsSnap.docs)[number] | null = null;
    for (const docSnap of bookingsSnap.docs) {
      const d = docSnap.data() as { startAt?: { toDate?: () => Date }; guestId?: string; guestExternalId?: string };
      const startAt = d.startAt?.toDate?.();
      if (!startAt) continue;
      if (startAt < windowStart || startAt > windowEnd) continue;
      const matchGuest =
        (guestId && d.guestId === guestId) ||
        (guestExternalId && d.guestExternalId === guestExternalId);
      if (matchGuest) {
        matchedBooking = docSnap;
        break;
      }
    }

    const VENUE_EVENTS_ID = resolveVenueId(venueId);

    type FirestoreAdmin = ReturnType<typeof getAdminFirestore>;
    async function addGuestArrivedEvent(
      fs: FirestoreAdmin,
      sessionId: string,
      tableId: string,
      tableNum: number | string,
      guestId: string | undefined,
      guestNameFromBooking: string | undefined
    ) {
      let name = guestNameFromBooking ?? "Гость";
      if (guestId) {
        const guestSnap = await fs
          .collection("venues")
          .doc(VENUE_EVENTS_ID)
          .collection("guests")
          .doc(guestId)
          .get();
        if (guestSnap.exists) {
          const d = guestSnap.data();
          name = (d?.name as string) || (d?.phone as string) || name;
        }
      }
      const message = `Гость ${name} занял стол № ${tableNum}`;
      await fs
        .collection("venues")
        .doc(VENUE_EVENTS_ID)
        .collection("events")
        .add({
          type: "guest_arrived",
          message,
          text: message,
          tableId,
          tableNumber: typeof tableNum === "number" ? tableNum : null,
          sessionId,
          read: false,
          venueId: VENUE_EVENTS_ID,
          createdAt: now,
        });
    }

    if (matchedBooking) {
      await firestore.collection("bookings").doc(matchedBooking.id).update({
        arrived: true,
        status: "arrived",
        updatedAt: now,
      });
      const sessionRef = await firestore.collection("activeSessions").add({
        venueId,
        tableId,
        tableNumber: tableNumber ?? 0,
        guestIdentity: guestIdentity ?? undefined,
        guestId: matchedBooking.data()?.guestId,
        waiterId: undefined,
        waiterDisplayName: undefined,
        status: "check_in_success",
        createdAt: now,
        updatedAt: now,
      } satisfies Omit<ActiveSession, "id"> & { createdAt: Date; updatedAt: Date });
      await firestore.collection("staffNotifications").add({
        venueId,
        tableId,
        sessionId: sessionRef.id,
        type: "guest_arrived",
        message: "Ваш гость пришел!",
        read: false,
        targetUids: [],
        createdAt: now,
      });
      await addGuestArrivedEvent(
        firestore,
        sessionRef.id,
        tableId,
        tableNumber ?? tableId,
        matchedBooking.data()?.guestId,
        matchedBooking.data()?.guestName
      );
      return NextResponse.json({
        status: "check_in_success",
        sessionId: sessionRef.id,
        messageGuest: "Посадка подтверждена. Официант закреплён за вами.",
      });
    }

    // Проверка брони: есть ли резерв на этот стол в окне ±30 мин
    const reservationsSnap = await firestore
      .collection("reservations")
      .where("venueId", "==", venueId)
      .where("tableId", "==", tableId)
      .where("reservedAt", ">=", windowStart)
      .where("reservedAt", "<=", windowEnd)
      .limit(1)
      .get();

    const hasReservation = !reservationsSnap.empty;

    if (hasReservation) {
      // Сценарий А: table_conflict — критическая вибрация 3р, уведомление официанту + ЛПР
      const conflictDoc = await firestore.collection("activeSessions").add({
        venueId,
        tableId,
        tableNumber: tableNumber ?? 0,
        guestIdentity: guestIdentity ?? undefined,
        status: "table_conflict",
        createdAt: now,
        updatedAt: now,
      });

      await firestore.collection("staffNotifications").add({
        venueId,
        tableId,
        type: "table_conflict",
        sessionId: conflictDoc.id,
        message: `Конфликт брони: стол ${tableId}. К вам уже идут.`,
        read: false,
        createdAt: now,
      });

      return NextResponse.json({
        status: "table_conflict",
        sessionId: conflictDoc.id,
        messageGuest: "Извините, стол забронирован. К вам уже идут.",
      });
    }

    // Сценарий Б: check_in_success — сессия в activeSessions, уведомление официанту
    const sessionRef = await firestore.collection("activeSessions").add({
      venueId,
      tableId,
      tableNumber: tableNumber ?? 0,
      guestIdentity: guestIdentity ?? undefined,
      waiterId: undefined,
      waiterDisplayName: undefined,
      status: "check_in_success",
      createdAt: now,
      updatedAt: now,
    } satisfies Omit<ActiveSession, "id"> & { createdAt: Date; updatedAt: Date });

    await firestore.collection("staffNotifications").add({
      venueId,
      tableId,
      sessionId: sessionRef.id,
      type: "new_guest",
      message: `Новый гость, Стол №${tableNumber ?? tableId}`,
      read: false,
      createdAt: now,
    });

    await addGuestArrivedEvent(
      firestore,
      sessionRef.id,
      tableId,
      tableNumber ?? tableId,
      undefined,
      undefined
    );

    return NextResponse.json({
      status: "check_in_success",
      sessionId: sessionRef.id,
      messageGuest: "Посадка подтверждена. Официант закреплён за вами.",
    });
  } catch (err) {
    console.error("check-in API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
