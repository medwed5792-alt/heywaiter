export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";

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
  const m = (eh * 60 + em) - (sh * 60 + sm);
  return m <= 0 ? 0 : Math.round((m / 60) * 10) / 10;
}

/**
 * POST /api/staff/shift
 * Вход на смену / выход (Shift Management).
 * Тело: { userId: string, venueId: string, action: "start" | "stop" } или { staffId: string, action: "start" | "stop" }
 *
 * - start: onShift = true, shiftStartTime; при наличии смены на сегодня в scheduleEntries — пишем checkIn (HH:mm).
 * - stop: onShift = false, shiftEndTime; при наличии смены с checkIn — пишем checkOut и factHours (для План/Факт).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const staffIdBody = (body.staffId as string)?.trim();
    const userId = (body.userId as string)?.trim();
    // Для синхронизации с админкой используем строго один venue.
    // Игнорируем переданный из клиента currentVenueId/venueId.
    const venueId = "venue_andrey_alt";
    const action = (body.action as string)?.trim();

    if (action !== "start" && action !== "stop") {
      return NextResponse.json(
        { error: "action должен быть start или stop" },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();
    let staffRef: DocumentReference;
    let staffDocId: string;

    if (staffIdBody) {
      staffRef = firestore.collection("staff").doc(staffIdBody);
      staffDocId = staffIdBody;
    } else if (userId) {
      staffDocId = `${venueId}_${userId}`;
      staffRef = firestore.collection("staff").doc(staffDocId);
    } else {
      return NextResponse.json(
        { error: "Укажите staffId либо userId" },
        { status: 400 }
      );
    }

    const VENUE_ID = "venue_andrey_alt";
    let snap = await staffRef.get();
    const staffVenueId =
      (venueId && venueId.trim()) || (snap.exists ? (snap.data()?.venueId as string) : null) || VENUE_ID;

    if (!snap.exists) {
      if (staffIdBody) {
        return NextResponse.json(
          { error: "Запись сотрудника не найдена" },
          { status: 404 }
        );
      }
      const alt = await firestore
        .collection("staff")
        .where("venueId", "==", venueId)
        .where("userId", "==", userId)
        .limit(1)
        .get();
      if (alt.empty) {
        return NextResponse.json(
          { error: "Запись сотрудника для этого заведения не найдена" },
          { status: 404 }
        );
      }
      const docRef = alt.docs[0].ref;
      const legacyId = alt.docs[0].id;
      const staffData = alt.docs[0].data() ?? {};
      const firstName = (staffData.firstName as string) ?? "";
      const lastName = (staffData.lastName as string) ?? "";
      const displayName =
        [firstName, lastName].filter(Boolean).join(" ") || legacyId.slice(-8);

      if (action === "start") {
        const resolvedUserIdForVenue =
          (snap.data()?.userId as string | undefined) ?? userId ?? legacyId;
        const venueStaffRef = firestore
          .collection("venues")
          .doc(venueId)
          .collection("staff")
          .doc(resolvedUserIdForVenue);
        await venueStaffRef.set(
          {
            onShift: true,
            shiftStartTime: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            userId: resolvedUserIdForVenue,
            active: true,
          },
          { merge: true }
        );
        if (venueId) {
          const today = new Date().toISOString().slice(0, 10);
          const entriesSnap = await firestore
            .collection("scheduleEntries")
            .where("staffId", "==", legacyId)
            .where("venueId", "==", venueId)
            .where("slot.date", "==", today)
            .get();
          const toSet = entriesSnap.docs.find((d) => !d.data().checkIn);
          if (toSet) await toSet.ref.update({ checkIn: nowHHmm(), updatedAt: FieldValue.serverTimestamp() });
        }
        await firestore
          .collection("venues")
          .doc(venueId)
          .collection("events")
          .add({
            type: "shift",
            message: `${displayName} заступил на смену`,
            staffId: legacyId,
            createdAt: FieldValue.serverTimestamp(),
          });
      } else {
        if (venueId) {
          const today = new Date().toISOString().slice(0, 10);
          const entriesSnap = await firestore
            .collection("scheduleEntries")
            .where("staffId", "==", legacyId)
            .where("venueId", "==", venueId)
            .where("slot.date", "==", today)
            .get();
          const toSet = entriesSnap.docs.find((d) => d.data().checkIn && !d.data().checkOut);
          if (toSet) {
            const data = toSet.data();
            const cin = (data.checkIn as string) || nowHHmm();
            await toSet.ref.update({
              checkOut: nowHHmm(),
              factHours: factHoursFromCheckInOut(cin, nowHHmm()),
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
        }
        const resolvedUserIdForVenue =
          (snap.data()?.userId as string | undefined) ?? userId ?? legacyId;
        const venueStaffRef = firestore
          .collection("venues")
          .doc(venueId)
          .collection("staff")
          .doc(resolvedUserIdForVenue);
        await venueStaffRef.set(
          {
            onShift: false,
            shiftEndTime: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            userId: resolvedUserIdForVenue,
            active: true,
          },
          { merge: true }
        );
        if (venueId) {
          await clearWaiterFromTables(firestore, venueId, legacyId);
          await firestore
            .collection("venues")
            .doc(venueId)
            .collection("events")
            .add({
              type: "shift",
              message: `${displayName} ушел со смены`,
              staffId: legacyId,
              createdAt: FieldValue.serverTimestamp(),
            });
        }
      }
      return NextResponse.json({
        ok: true,
        onShift: action === "start",
        staffId: legacyId,
        ...(action === "start" && { shiftStartTime: new Date().toISOString() }),
        ...(action === "stop" && { shiftEndTime: new Date().toISOString() }),
      });
    }

    if (action === "start") {
      const resolvedUserIdForVenue = userId ?? (snap.data()?.userId as string | undefined) ?? staffDocId;
      const venueStaffRef = firestore
        .collection("venues")
        .doc(staffVenueId)
        .collection("staff")
        .doc(resolvedUserIdForVenue);
      await venueStaffRef.set(
        {
          onShift: true,
          shiftStartTime: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          userId: resolvedUserIdForVenue,
          active: true,
        },
        { merge: true }
      );
      if (staffVenueId) {
        const today = new Date().toISOString().slice(0, 10);
        const entriesSnap = await firestore
          .collection("scheduleEntries")
          .where("staffId", "==", staffDocId)
          .where("venueId", "==", staffVenueId)
          .where("slot.date", "==", today)
          .get();
        const toSetCheckIn = entriesSnap.docs.find((d) => !d.data().checkIn);
        if (toSetCheckIn) {
          await toSetCheckIn.ref.update({
            checkIn: nowHHmm(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        const staffData = snap.data() ?? {};
        const firstName = (staffData.firstName as string) ?? "";
        const lastName = (staffData.lastName as string) ?? "";
        const displayName =
          [firstName, lastName].filter(Boolean).join(" ") || staffDocId.slice(-8);
        await firestore
          .collection("venues")
          .doc(staffVenueId)
          .collection("events")
          .add({
            type: "shift",
            message: `${displayName} заступил на смену`,
            staffId: staffDocId,
            createdAt: FieldValue.serverTimestamp(),
          });
      }
      return NextResponse.json({
        ok: true,
        onShift: true,
        staffId: staffDocId,
        shiftStartTime: new Date().toISOString(),
      });
    }

    if (staffVenueId) {
      const today = new Date().toISOString().slice(0, 10);
      const entriesSnap = await firestore
        .collection("scheduleEntries")
        .where("staffId", "==", staffDocId)
        .where("venueId", "==", staffVenueId)
        .where("slot.date", "==", today)
        .get();
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
    }

    const resolvedUserIdForVenue = userId ?? (snap.data()?.userId as string | undefined) ?? staffDocId;
    const venueStaffRef = firestore
      .collection("venues")
      .doc(staffVenueId)
      .collection("staff")
      .doc(resolvedUserIdForVenue);
    await venueStaffRef.set(
      {
        onShift: false,
        shiftEndTime: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        userId: resolvedUserIdForVenue,
        active: true,
      },
      { merge: true }
    );
    if (staffVenueId) {
      await clearWaiterFromTables(firestore, staffVenueId, staffDocId);
      const staffData = snap.data() ?? {};
      const firstName = (staffData.firstName as string) ?? "";
      const lastName = (staffData.lastName as string) ?? "";
      const displayName =
        [firstName, lastName].filter(Boolean).join(" ") || staffDocId.slice(-8);
      await firestore
        .collection("venues")
        .doc(staffVenueId)
        .collection("events")
        .add({
          type: "shift",
          message: `${displayName} ушел со смены`,
          staffId: staffDocId,
          createdAt: FieldValue.serverTimestamp(),
        });
    }
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
