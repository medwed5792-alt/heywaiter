import type {
  ActiveSessionParticipant,
  ActiveSessionParticipantStatus,
  MessengerIdentity,
} from "@/lib/types";

import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  buildTelegramCustomerUid,
  guestCustomerUidsMatch,
  visitHistoryUidCandidates,
} from "@/lib/identity/customer-uid";
import {
  guestIdentityFromCustomerUid,
  resolveGlobalGuestUidForCheckIn,
  type GuestIdentityInput,
} from "@/lib/identity/global-guest-hub";
import { resolveVenueId } from "@/lib/standards/venue-default";
import { pickNewestFreshActiveSessionDoc } from "@/lib/session-freshness";
import { isFeedbackActSessionRecord } from "@/lib/feedback-act-session";
import { syncGuestGlobalProfileOnVisit } from "@/lib/identity/guest-global-profile";
import { FieldValue, type QueryDocumentSnapshot } from "firebase-admin/firestore";

const RESERVATION_WINDOW_MS = 30 * 60 * 1000; // ±30 минут

/** Активные фазы визита: повторный вход должен подхватывать ту же сессию, без дублей. */
/** Только «бой» в activeSessions; сессии второго акта (`feedback_*` / guest_feedback_act) не блокируют стол. */
const ACTIVE_VISIT_SESSION_STATUSES = ["check_in_success", "payment_confirmed"] as const;

function collectGuestActiveSessionLookupKeys(currentUid: string, rawUidCandidate: string): string[] {
  const set = new Set<string>();
  for (const u of [currentUid, rawUidCandidate]) {
    const t = String(u ?? "").trim();
    if (!t) continue;
    set.add(t);
    for (const c of visitHistoryUidCandidates(t)) {
      if (c.trim()) set.add(c.trim());
    }
  }
  return [...set];
}

async function findGuestExistingBattleSessionDoc(
  firestore: ReturnType<typeof getAdminFirestore>,
  lookupKeys: string[],
  nowMs: number
): Promise<QueryDocumentSnapshot | null> {
  if (lookupKeys.length === 0) return null;
  const docsById = new Map<string, QueryDocumentSnapshot>();

  const statusIn = [...ACTIVE_VISIT_SESSION_STATUSES];

  for (let i = 0; i < lookupKeys.length; i += 10) {
    const chunk = [...new Set(lookupKeys.slice(i, i + 10).map((x) => String(x ?? "").trim()).filter(Boolean))];
    if (chunk.length === 0) continue;
    try {
      const snap = await firestore
        .collection("activeSessions")
        .where("masterId", "in", chunk)
        .where("status", "in", statusIn)
        .limit(50)
        .get();
      for (const d of snap.docs) docsById.set(d.id, d);
    } catch (e) {
      console.error("[checkInGuest] activeSessions masterId probe failed:", e);
    }
  }

  const seenParticipantKeys = new Set<string>();
  for (const key of lookupKeys) {
    const k = String(key ?? "").trim();
    if (!k || seenParticipantKeys.has(k)) continue;
    seenParticipantKeys.add(k);
    try {
      const snap = await firestore
        .collection("activeSessions")
        .where("participantUids", "array-contains", k)
        .where("status", "in", statusIn)
        .limit(50)
        .get();
      for (const d of snap.docs) docsById.set(d.id, d);
    } catch (e) {
      console.error("[checkInGuest] activeSessions participantUids probe failed:", e);
    }
  }

  try {
    const battleDocs = [...docsById.values()].filter((d) => {
      const raw = d.data() as Record<string, unknown>;
      const st = typeof raw.status === "string" ? raw.status : "";
      return !isFeedbackActSessionRecord({ id: d.id, status: st });
    });
    return pickNewestFreshActiveSessionDoc(battleDocs, nowMs);
  } catch (e) {
    console.error("[checkInGuest] pickNewestFreshActiveSessionDoc failed:", e);
    return null;
  }
}

export type CheckInGuestResult =
  | { status: "check_in_success"; sessionId: string; tableId: string; globalGuestUid: string; messageGuest: string; onboardingHint?: string }
  | { status: "table_private"; sessionId: string; tableId: string; globalGuestUid: string; messageGuest: string }
  | { status: "table_conflict"; sessionId: string; tableId: string; globalGuestUid: string; messageGuest: string }
  | {
      status: "already_seated_elsewhere";
      sessionId: string;
      venueId: string;
      tableId: string;
      tableNumber: number;
      globalGuestUid: string;
      messageGuest: string;
    };

export interface CheckInGuestInput {
  venueId: string;
  tableId: string;
  tableNumber?: number;
  guestId?: string;
  participantUid?: string;
  guestIdentity?: MessengerIdentity | undefined;
  /** Браузерный якорь (visitor id / device id), чтобы не плодить global_users без anon-ключа */
  deviceAnchor?: string;
  /** Уже известный global UID (cookie, хранилище клиента) — merge на входе без ожидания мессенджера */
  knownGlobalGuestUid?: string;
  /** Предпочтения гостя для аналитики / маркетинга (опционально). */
  locale?: string;
  timezone?: string;
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

  const {
    venueId,
    tableId,
    tableNumber,
    guestId,
    guestIdentity,
    participantUid,
    deviceAnchor,
    knownGlobalGuestUid,
    locale,
    timezone,
  } = input;
  const firestore = getAdminFirestore();
  const guestExternalId = guestIdentity?.externalId ?? undefined;
  const uidFromIdentity =
    guestIdentity?.channel === "telegram"
      ? buildTelegramCustomerUid(guestExternalId)
      : (guestExternalId || "").trim();
  const rawUidCandidate = (participantUid || uidFromIdentity || guestId || "").trim();
  const identityInputs: GuestIdentityInput[] = [];
  const fromUid = guestIdentityFromCustomerUid(rawUidCandidate);
  if (fromUid) identityInputs.push(fromUid);
  if (guestIdentity?.channel === "telegram" && guestExternalId) {
    identityInputs.push({ key: "tg", value: String(guestExternalId).trim() });
  }
  const anchor = String(deviceAnchor ?? "").trim();
  if (identityInputs.length === 0 && anchor) {
    identityInputs.push({ key: "anon", value: anchor });
  }
  const currentUid = await resolveGlobalGuestUidForCheckIn({
    knownGlobalUid: knownGlobalGuestUid?.trim(),
    identityInputs,
  });

  const isSameGuestUid = (existingUid: string): boolean => {
    if (guestCustomerUidsMatch(existingUid, currentUid)) return true;
    if (rawUidCandidate && guestCustomerUidsMatch(existingUid, rawUidCandidate)) return true;
    return false;
  };

  /** Один гость — один стол: пока «бой» в activeSessions, другой стол недоступен (Акт 2 / архив снимает блок). */
  const guestLockLookupKeys = collectGuestActiveSessionLookupKeys(currentUid, rawUidCandidate);
  if (guestLockLookupKeys.length > 0) {
    try {
      const existingBattleElsewhere = await findGuestExistingBattleSessionDoc(
        firestore,
        guestLockLookupKeys,
        now.getTime()
      );
      if (existingBattleElsewhere) {
        const exData = existingBattleElsewhere.data() as Record<string, unknown>;
        const exVenue = String(exData.venueId ?? "").trim();
        const exTable = String(exData.tableId ?? "").trim();
        const requestVenue = venueId.trim();
        const requestTable = tableId.trim();
        const sameSeating = exVenue === requestVenue && exTable === requestTable;
        if (!sameSeating) {
          const exTableNumber =
            typeof exData.tableNumber === "number" && Number.isFinite(exData.tableNumber) ? exData.tableNumber : 0;
          const label = exTableNumber > 0 ? String(exTableNumber) : exTable || "—";
          return {
            status: "already_seated_elsewhere",
            sessionId: existingBattleElsewhere.id,
            venueId: exVenue,
            tableId: exTable,
            tableNumber: exTableNumber,
            globalGuestUid: currentUid,
            messageGuest: `У вас есть открытый заказ за столом №${label}. Пожалуйста, завершите его.`,
          };
        }
      }
    } catch (lockErr) {
      console.error("[checkInGuest] guest lock probe failed (continuing check-in):", lockErr);
    }
  }

  if (currentUid) {
    await syncGuestGlobalProfileOnVisit(firestore, {
      globalUid: currentUid,
      venueId,
      tableId,
      locale,
      timezone,
    });
  }

  // API route historically routes "events" through a resolved default venue id.
  const VENUE_EVENTS_ID = resolveVenueId(venueId);

  let shouldShowPinHint = false;

  async function recordGuestVisit() {
    if (!currentUid) return;
    const ref = firestore.collection("global_users").doc(currentUid).collection("visits").doc(venueId);
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

  function participantUidList(parts: ActiveSessionParticipant[]): string[] {
    const set = new Set<string>();
    for (const p of parts) {
      const uid = String(p.uid ?? "").trim();
      if (uid) set.add(uid);
    }
    return [...set];
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

  // Idempotency & collective session: если за этим столом уже есть активная фаза визита —
  // подхватываем её (включая оплату/отзыв), не создаём вторую сессию.
  const existingActiveSnap = await firestore
    .collection("activeSessions")
    .where("venueId", "==", venueId)
    .where("tableId", "==", tableId)
    .where("status", "in", [...ACTIVE_VISIT_SESSION_STATUSES])
    .limit(30)
    .get();

  const battleDocs = existingActiveSnap.docs.filter((d) => {
    const raw = d.data() as Record<string, unknown>;
    const st = typeof raw.status === "string" ? raw.status : "";
    return !isFeedbackActSessionRecord({ id: d.id, status: st });
  });
  const existing = pickNewestFreshActiveSessionDoc(battleDocs, now.getTime());

  if (existing) {
    const existingData = existing.data() as Record<string, unknown>;
    const existingMasterId = (existingData.masterId as string | undefined)?.trim();
    const isPrivate = typeof existingData.isPrivate === "boolean" ? (existingData.isPrivate as boolean) : true;
    const participants = normalizeParticipants(existingData.participants);

    if (!currentUid) {
      if (isPrivate) {
        return {
          status: "table_private",
          sessionId: existing.id,
          tableId,
          globalGuestUid: currentUid,
          messageGuest: "Стол приватный. Подселение запрещено без разрешения хозяина.",
        };
      }
      await recordGuestVisit();
      return {
        status: "check_in_success",
        sessionId: existing.id,
        tableId,
        globalGuestUid: currentUid,
        messageGuest: "Посадка подтверждена. Официант закреплён за вами.",
        ...(shouldShowPinHint
          ? { onboardingHint: "Закрепите этот чат для быстрого вызова персонала." }
          : {}),
      };
    }

    const existingParticipantIdx = participants.findIndex((p) => isSameGuestUid(p.uid));
    const existingParticipant = existingParticipantIdx >= 0 ? participants[existingParticipantIdx] : null;

    if (
      isPrivate &&
      existingMasterId?.startsWith("anon:") &&
      rawUidCandidate.startsWith("tg:") &&
      !isSameGuestUid(existingMasterId)
    ) {
      const merged = participants.map((p) =>
        guestCustomerUidsMatch(p.uid, existingMasterId)
          ? { ...p, uid: currentUid, status: "active" as ActiveSessionParticipantStatus, updatedAt: now }
          : p
      );
      let nextP = merged;
      if (!nextP.some((p) => isSameGuestUid(p.uid))) {
        nextP = [...merged, nowParticipant("active")];
      }
      await firestore.collection("activeSessions").doc(existing.id).update({
        masterId: currentUid,
        participants: nextP,
        participantUids: participantUidList(nextP),
        updatedAt: now,
      });
      await recordGuestVisit();
      return {
        status: "check_in_success",
        sessionId: existing.id,
        tableId,
        globalGuestUid: currentUid,
        messageGuest: "Посадка подтверждена. Официант закреплён за вами.",
      };
    }

    // Private table: только хозяин (с учётом tg ↔ legacy uid в списке участников).
    if (isPrivate && existingMasterId && !isSameGuestUid(existingMasterId)) {
      return {
        status: "table_private",
        sessionId: existing.id,
        tableId,
        globalGuestUid: currentUid,
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
          participantUids: participantUidList(participants),
          updatedAt: now,
        });
      }
    } else if (!existingMasterId || !isPrivate || isSameGuestUid(existingMasterId)) {
      // Public table, master check-in, or legacy session without masterId: add participant.
      participants.push(nowParticipant("active"));
      await firestore.collection("activeSessions").doc(existing.id).update({
        participants,
        participantUids: participantUidList(participants),
        // Backward compatible write if master was missing in older sessions.
        ...(existingMasterId ? {} : { masterId: currentUid }),
        updatedAt: now,
      });
    }

    await recordGuestVisit();
    return {
      status: "check_in_success",
      sessionId: existing.id,
      tableId,
      globalGuestUid: currentUid,
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
      const guestSnap = await firestore.collection("global_users").doc(args.guestId).get();
      if (guestSnap.exists) {
        const d = guestSnap.data() as Record<string, unknown> | undefined;
        const first = (d?.firstName as string) || "";
        const last = (d?.lastName as string) || "";
        const fromName = [first, last].filter(Boolean).join(" ").trim();
        const identities = (d?.identities as Record<string, string> | undefined) ?? {};
        name =
          fromName ||
          (d?.name as string) ||
          (identities.phone ? String(identities.phone) : "") ||
          name;
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
      participantUids: currentUid ? [currentUid] : [],
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
      tableId,
      globalGuestUid: currentUid,
      messageGuest: "Посадка подтверждена. Официант закреплён за вами.",
      ...(shouldShowPinHint
        ? { onboardingHint: "Закрепите этот чат для быстрого вызова персонала." }
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
      participantUids: currentUid ? [currentUid] : [],
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
      tableId,
      globalGuestUid: currentUid,
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
    participantUids: currentUid ? [currentUid] : [],
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
    tableId,
    globalGuestUid: currentUid,
    messageGuest: "Посадка подтверждена. Официант закреплён за вами.",
    ...(shouldShowPinHint
      ? { onboardingHint: "Закрепите этот чат для быстрого вызова персонала." }
      : {}),
  };
}

