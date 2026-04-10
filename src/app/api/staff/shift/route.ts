export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore, QuerySnapshot } from "firebase-admin/firestore";
import { DEFAULT_VENUE_ID, resolveVenueId } from "@/lib/standards/venue-default";
import {
  resolveStaffFirestoreIdToGlobalUser,
  syncGlobalUserShiftVenues,
} from "@/lib/identity/global-user-staff-bridge";

/** При завершении смены — очистить waiterId у всех столов, где сотрудник был назначен с Дашборда */
async function clearWaiterFromTables(
  firestore: Firestore,
  venueId: string,
  staffId: string
): Promise<void> {
  const tablesSnap = await firestore
    .collection("venues")
    .doc(venueId)
    .collection("tables")
    .get();
  let count = 0;
  const batch = firestore.batch();
  for (const doc of tablesSnap.docs) {
    const data = doc.data();
    const waiter = (data.assignments as { waiter?: string } | undefined)?.waiter;
    if (waiter === staffId) {
      batch.update(doc.ref, {
        "assignments.waiter": FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      count++;
    }
  }
  if (count > 0) await batch.commit();
}

/** Текущее время в формате HH:mm */
function nowHHmm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Факт часов из checkIn/checkOut (HH:mm) */
function factHoursFromCheckInOut(checkIn: string, checkOut: string): number {
  const [sh, sm] = checkIn.split(":").map(Number);
  const [eh, em] = checkOut.split(":").map(Number);
  const m = eh * 60 + em - (sh * 60 + sm);
  return m <= 0 ? 0 : Math.round((m / 60) * 10) / 10;
}

function shortDisplayNameFromGlobalUser(d: Record<string, unknown>): string {
  const gFirst = (d.firstName as string | undefined) ?? "";
  const gLast = (d.lastName as string | undefined) ?? "";
  const identityName =
    ((d.identity as { displayName?: string })?.displayName as string | undefined) ??
    ((d.identity as { name?: string })?.name as string | undefined) ??
    "";
  const full = [gFirst, gLast].filter(Boolean).join(" ").trim() || String(identityName).trim();
  return full ? full.split(" ")[0]! : "Сотрудник";
}

async function scheduleEntriesForStaffCandidates(
  firestore: Firestore,
  venueId: string,
  staffIds: string[]
): Promise<QuerySnapshot> {
  const today = new Date().toISOString().slice(0, 10);
  for (const sid of staffIds) {
    const s = sid?.trim();
    if (!s) continue;
    const snap = await firestore
      .collection("scheduleEntries")
      .where("staffId", "==", s)
      .where("venueId", "==", venueId)
      .where("slot.date", "==", today)
      .get();
    if (!snap.empty) return snap;
  }
  return firestore.collection("scheduleEntries").where("venueId", "==", "__none__").limit(0).get();
}

/**
 * POST /api/staff/shift
 * Вход на смену / выход (Shift Management).
 * Тело: { userId: string, venueId: string, action: "start" | "stop" } или { staffId: string, action: "start" | "stop" }
 *
 * - start: onShift = true, shiftStartTime; при наличии смены на сегодня в scheduleEntries — пишем checkIn (HH:mm).
 * - stop: onShift = false, shiftEndTime; при наличии смены с checkIn — пишем checkOut и factHours (для План/Факт).
 *
 * Источник идентичности — global_users; venues/{venueId}/staff/{venueId}_{globalUserId}.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const staffIdBody = (body.staffId as string)?.trim();
    const userIdBody = (body.userId as string)?.trim();
    const venueId = resolveVenueId(typeof body.venueId === "string" ? body.venueId : undefined);
    const action = (body.action as string)?.trim();

    if (action !== "start" && action !== "stop") {
      return NextResponse.json(
        { error: "action должен быть start или stop" },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();
    const staffVenueId = (venueId && venueId.trim()) || DEFAULT_VENUE_ID;
    const vid = staffVenueId.trim();

    let globalUserId: string | null = null;
    let legacyStaffIdForSchedule: string | null = null;

    if (userIdBody) {
      const g = await firestore.collection("global_users").doc(userIdBody).get();
      if (!g.exists) {
        return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
      }
      globalUserId = userIdBody;
      const canonical = `${vid}_${globalUserId}`;
      if (staffIdBody && staffIdBody !== canonical) legacyStaffIdForSchedule = staffIdBody;
    } else if (staffIdBody) {
      const resolved = await resolveStaffFirestoreIdToGlobalUser(firestore, staffIdBody, vid);
      if (!resolved) {
        return NextResponse.json({ error: "Запись сотрудника не найдена" }, { status: 404 });
      }
      globalUserId = resolved.globalUserId;
      const canonical = `${vid}_${resolved.globalUserId}`;
      if (staffIdBody !== canonical) legacyStaffIdForSchedule = staffIdBody;
    } else {
      return NextResponse.json(
        { error: "Укажите staffId либо userId" },
        { status: 400 }
      );
    }

    const staffDocId = `${vid}_${globalUserId}`;
    const scheduleStaffIds = [...new Set([staffDocId, legacyStaffIdForSchedule].filter(Boolean) as string[])];

    const globalSnap = await firestore.collection("global_users").doc(globalUserId).get();
    const displayName = shortDisplayNameFromGlobalUser(globalSnap.data() ?? {});

    const venueStaffRef = firestore.collection("venues").doc(vid).collection("staff").doc(staffDocId);

    const tableWaiterIds = [...new Set([staffDocId, legacyStaffIdForSchedule].filter(Boolean) as string[])];

    if (action === "start") {
      await venueStaffRef.set(
        {
          onShift: true,
          shiftStartTime: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          userId: globalUserId,
          active: true,
        },
        { merge: true }
      );
      await syncGlobalUserShiftVenues(firestore, globalUserId, vid, true);

      const entriesSnap = await scheduleEntriesForStaffCandidates(firestore, vid, scheduleStaffIds);
      const toSetCheckIn = entriesSnap.docs.find((d) => !d.data().checkIn);
      if (toSetCheckIn) {
        await toSetCheckIn.ref.update({ checkIn: nowHHmm(), updatedAt: FieldValue.serverTimestamp() });
      }

      await firestore.collection("venues").doc(vid).collection("events").add({
        type: "shift",
        message: `${displayName} заступил на смену`,
        staffId: staffDocId,
        createdAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({
        ok: true,
        onShift: true,
        staffId: staffDocId,
        shiftStartTime: new Date().toISOString(),
      });
    }

    const entriesSnap = await scheduleEntriesForStaffCandidates(firestore, vid, scheduleStaffIds);
    const toSetCheckOut = entriesSnap.docs.find((d) => d.data().checkIn && !d.data().checkOut);
    if (toSetCheckOut) {
      const data = toSetCheckOut.data();
      const cin = (data.checkIn as string) || nowHHmm();
      const cout = nowHHmm();
      await toSetCheckOut.ref.update({
        checkOut: cout,
        factHours: factHoursFromCheckInOut(cin, cout),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await venueStaffRef.set(
      {
        onShift: false,
        shiftEndTime: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        userId: globalUserId,
        active: true,
      },
      { merge: true }
    );
    await syncGlobalUserShiftVenues(firestore, globalUserId, vid, false);

    for (const sid of tableWaiterIds) {
      await clearWaiterFromTables(firestore, vid, sid);
    }

    await firestore.collection("venues").doc(vid).collection("events").add({
      type: "shift",
      message: `${displayName} ушел со смены`,
      staffId: staffDocId,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      ok: true,
      onShift: false,
      staffId: staffDocId,
      shiftEndTime: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[staff/shift]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}
