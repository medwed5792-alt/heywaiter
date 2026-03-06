import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import type { ActiveSession } from "@/lib/types";

const RESERVATION_WINDOW_MS = 30 * 60 * 1000; // 30 мин

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { venueId, tableId, tableNumber, guestIdentity } = body as {
      venueId?: string;
      tableId?: string;
      tableNumber?: number;
      guestIdentity?: unknown;
    };

    if (!venueId || !tableId) {
      return NextResponse.json(
        { error: "venueId and tableId required" },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();
    const now = new Date();
    const windowStart = new Date(now.getTime() - RESERVATION_WINDOW_MS);
    const windowEnd = new Date(now.getTime() + RESERVATION_WINDOW_MS);

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
        guestIdentity: guestIdentity ?? null,
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
      guestIdentity: guestIdentity ?? null,
      waiterId: null,
      waiterDisplayName: null,
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
