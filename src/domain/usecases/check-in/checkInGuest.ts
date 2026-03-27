import type {
  ActiveSessionParticipant,
  ActiveSessionParticipantStatus,
  MessengerIdentity,
} from "@/lib/types";

import { getAdminFirestore } from "@/lib/firebase-admin";
import { buildTelegramCustomerUid } from "@/lib/identity/customer-uid";
import { resolveVenueId } from "@/lib/standards/venue-default";
import { FieldValue } from "firebase-admin/firestore";

const RESERVATION_WINDOW_MS = 30 * 60 * 1000; // ±30 минут

export type CheckInGuestResult =
  | { status: "check_in_success"; sessionId: string; messageGuest: string; onboardingHint?: string }
  | { status: "table_private"; sessionId: string; messageGuest: string }
  | { status: "table_conflict"; sessionId: string; messageGuest: string };

export interface CheckInGuestInput {
  venueId: string;
  tableId: string;
  tableNumber?: number;
  guestId?: string;
  participantUid?: string;
  guestIdentity?: MessengerIdentity | undefined;
}

/**
 * Unified check-in use-case:
 * - If there's a booking for the table in ±30min and guest matches -> create guest_arrived event + active session.
 * - Else if there's any reservation for the table in ±30min -> create table_conflict.
 * - Else -> create check_in_success.
 */
export async function checkInGuest(input: CheckInGuestInput): Promise<CheckInGuestResult> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - RESERVATION_WINDOW_MS);
  const windowEnd = new Date(now.getTime() + RESERVATION_WINDOW_MS);

  const { venueId, tableId, tableNumber, guestId, guestIdentity, participantUid } = input;
  const guestExternalId = guestIdentity?.externalId ?? undefined;
  const uidFromIdentity =
    guestIdentity?.channel === "telegram"
      ? buildTelegramCustomerUid(guestExternalId)
      : (guestExternalId || "").trim();
  const currentUid = (participantUid || uidFromIdentity || guestId || "").trim();

  // API route historically routes "events" through a resolved default venue id.
  const VENUE_EVENTS_ID = resolveVenueId(venueId);

  const firestore = getAdminFirestore();
  let shouldShowPinHint = false;

  async function recordGuestVisit() {
    if (!currentUid) return;
    const ref = firestore.doc(`users/${currentUid}/visits/${venueId}`);
    const prev = await ref.get();
    shouldShowPinHint = !prev.exists;
    await ref.set(
      {
        lastVisitAt: FieldValue.serverTimestamp(),
        totalVisits: FieldValue.increment(1),
      },
      { merge: true }
    );
  }

  function nowParticipant(status: ActiveSessionParticipantStatus): ActiveSessionParticipant {
    return {
      uid: currentUid,
      status,
      joinedAt: now,
      updatedAt: now,
    };
  }

  function normalizeParticipants(raw: unknown): ActiveSessionParticipant[] {
    if (!Array.isArray(raw)) return [];
    const out: ActiveSessionParticipant[] = [];
    for (const item of raw) {
      const d = (item ?? {}) as Record<string, unknown>;
      const uid = typeof d.uid === "string" ? d.uid.trim() : "";
      if (!uid) continue;
      const status = d.status as ActiveSessionParticipantStatus | undefined;
      out.push({
        uid,
        status: status === "paid" || status === "exited" ? status : "active",
        joinedAt: d.joinedAt ?? now,
        updatedAt: d.updatedAt ?? now,
      });
    }
    return out;
  }

  // Idempotency & collective session: if a successful check-in already exists for this table,
  // apply master/private/participants rules instead of creating a new session.
  const existingSuccessSnap = await firestore
    .collection("activeSessions")
    .where("venueId", "==", venueId)
    .where("tableId", "==", tableId)
    .where("status", "==", "check_in_success")
    .limit(1)
    .get();

  if (!existingSuccessSnap.empty) {
    const existing = existingSuccessSnap.docs[0];
    const existingData = existing.data() as Record<string, unknown>;
    const existingMasterId = (existingData.masterId as string | undefined)?.trim();
    const isPrivate = typeof existingData.isPrivate === "boolean" ? (existingData.isPrivate as boolean) : true;
    const participants = normalizeParticipants(existingData.participants);

    if (!currentUid) {
      if (isPrivate) {
        return {
          status: "table_private",
          sessionId: existing.id,
          messageGuest: "Стол приватный. Подселение запрещено без разрешения хозяина.",
        };
      }
      await recordGuestVisit();
      return {
        status: "check_in_success",
        sessionId: existing.id,
        messageGuest: "Посадка подтверждена. Официант закреплён за вами.",
        ...(shouldShowPinHint
          ? { onboardingHint: "Закрепите этот чат, чтобы быстро вызывать официанта." }
          : {}),
      };
    }

    const existingParticipantIdx = participants.findIndex((p) => p.uid === currentUid);
    const existingParticipant = existingParticipantIdx >= 0 ? participants[existingParticipantIdx] : null;

    // Private table: only Master can join/rejoin.
    if (isPrivate && existingMasterId && existingMasterId !== currentUid) {
      return {
        status: "table_private",
        sessionId: existing.id,
        messageGuest: "Стол приватный. Подселение запрещено без разрешения хозяина.",
      };
    }

    if (existingParticipant) {
      // Re-activate exited participant, keep paid as paid.
      const nextStatus: ActiveSessionParticipantStatus =
        existingParticipant.status === "exited" ? "active" : existingParticipant.status;
      if (nextStatus !== existingParticipant.status) {
        participants[existingParticipantIdx] = {
          ...existingParticipant,
          status: nextStatus,
          updatedAt: now,
        };
        await firestore.collection("activeSessions").doc(existing.id).update({
          participants,
          updatedAt: now,
        });
      }
    } else if (!existingMasterId || !isPrivate || existingMasterId === currentUid) {
      // Public table, master check-in, or legacy session without masterId: add participant.
      participants.push(nowParticipant("active"));
      await firestore.collection("activeSessions").doc(existing.id).update({
        participants,
        // Backward compatible write if master was missing in older sessions.
        ...(existingMasterId ? {} : { masterId: currentUid }),
        updatedAt: now,
      });
    }

    await recordGuestVisit();
    return {
      status: "check_in_success",
      sessionId: existing.id,
      messageGuest: "Посадка подтверждена. Официант закреплён за вами.",
    };
  }

  // 1) Try to match a booking (±30 min) by guest identity (tgId/guestId or external id).
  const bookingsSnap = await firestore
    .collection("bookings")
    .where("venueId", "==", venueId)
    .where("tableId", "==", tableId)
    .where("status", "in", ["pending", "confirmed"])
    .get();

  let matchedBooking: (typeof bookingsSnap.docs)[number] | null = null;
  for (const docSnap of bookingsSnap.docs) {
    const d = docSnap.data() as {
      startAt?: { toDate?: () => Date };
      guestId?: string;
      guestExternalId?: string;
      guestName?: string;
    };
    const startAt = d.startAt?.toDate?.();
    if (!startAt) continue;
    if (startAt < windowStart || startAt > windowEnd) continue;

    const matchGuest =
      (guestId && d.guestId === guestId) || (guestExternalId && d.guestExternalId === guestExternalId);
    if (matchGuest) {
      matchedBooking = docSnap;
      break;
    }
  }

  async function addGuestArrivedEvent(args: {
    sessionId: string;
    tableId: string;
    tableNum: number | string;
    guestId: string | undefined;
    guestNameFromBooking: string | undefined;
  }) {
    let name = args.guestNameFromBooking ?? "Гость";
    if (args.guestId) {
      const guestSnap = await firestore
        .collection("venues")
        .doc(VENUE_EVENTS_ID)
        .collection("guests")
        .doc(args.guestId)
        .get();

      if (guestSnap.exists) {
        const d = guestSnap.data() as Record<string, unknown> | undefined;
        name =
          (d?.name as string) || (d?.phone as string) || name;
      }
    }

    const message = `Гость ${name} занял стол № ${args.tableNum}`;
    await firestore.collection("venues").doc(VENUE_EVENTS_ID).collection("events").add({
      type: "guest_arrived",
      message,
      text: message,
      tableId: args.tableId,
      tableNumber: typeof args.tableNum === "number" ? args.tableNum : null,
      sessionId: args.sessionId,
      read: false,
      venueId: VENUE_EVENTS_ID,
      createdAt: now,
    });
  }

  if (matchedBooking) {
    // 2a) booking exists + guest matches => mark booking arrived + create active session.
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
      masterId: currentUid || matchedBooking.data()?.guestId || guestExternalId || "",
      participants: currentUid ? [nowParticipant("active")] : [],
      isPrivate: true,
      status: "check_in_success",
      createdAt: now,
      updatedAt: now,
    });

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

    await addGuestArrivedEvent({
      sessionId: sessionRef.id,
      tableId,
      tableNum: tableNumber ?? tableId,
      guestId: matchedBooking.data()?.guestId,
      guestNameFromBooking: matchedBooking.data()?.guestName,
    });

    await recordGuestVisit();
    return {
      status: "check_in_success",
      sessionId: sessionRef.id,
      messageGuest: "Посадка подтверждена. Официант закреплён за вами.",
      ...(shouldShowPinHint
        ? { onboardingHint: "Закрепите этот чат, чтобы быстро вызывать официанта." }
        : {}),
    };
  }

  // 2b) no matched booking (or guest unknown) => check reservation conflict in ±30 min.
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
    const conflictDoc = await firestore.collection("activeSessions").add({
      venueId,
      tableId,
      tableNumber: tableNumber ?? 0,
      guestIdentity: guestIdentity ?? undefined,
      masterId: currentUid || undefined,
      participants: currentUid ? [nowParticipant("active")] : [],
      isPrivate: true,
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

    return {
      status: "table_conflict",
      sessionId: conflictDoc.id,
      messageGuest: "Извините, стол забронирован. К вам уже идут.",
    };
  }

  // 2c) free => create check-in success session.
  const sessionRef = await firestore.collection("activeSessions").add({
    venueId,
    tableId,
    tableNumber: tableNumber ?? 0,
    guestIdentity: guestIdentity ?? undefined,
    waiterId: undefined,
    waiterDisplayName: undefined,
    masterId: currentUid || undefined,
    participants: currentUid ? [nowParticipant("active")] : [],
    isPrivate: true,
    status: "check_in_success",
    createdAt: now,
    updatedAt: now,
  });

  await firestore.collection("staffNotifications").add({
    venueId,
    tableId,
    sessionId: sessionRef.id,
    type: "new_guest",
    message: `Новый гость, Стол №${tableNumber ?? tableId}`,
    read: false,
    createdAt: now,
  });

  // Keep API behaviour: the legacy API always creates "guest_arrived" event for check_in_success.
  await addGuestArrivedEvent({
    sessionId: sessionRef.id,
    tableId,
    tableNum: tableNumber ?? tableId,
    guestId: undefined,
    guestNameFromBooking: undefined,
  });
  await recordGuestVisit();
  return {
    status: "check_in_success",
    sessionId: sessionRef.id,
    messageGuest: "Посадка подтверждена. Официант закреплён за вами.",
    ...(shouldShowPinHint
      ? { onboardingHint: "Закрепите этот чат, чтобы быстро вызывать официанта." }
      : {}),
  };
}

