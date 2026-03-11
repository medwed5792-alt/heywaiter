export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { DocumentReference } from "firebase-admin/firestore";

/**
 * POST /api/staff/shift
 * Вход на смену / выход (Shift Management).
 * Тело: { userId: string, venueId: string, action: "start" | "stop" } или { staffId: string, action: "start" | "stop" }
 *
 * - start: onShift = true, shiftStartTime = serverTimestamp()
 * - stop: onShift = false, shiftEndTime = serverTimestamp()
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const staffIdBody = (body.staffId as string)?.trim();
    const userId = (body.userId as string)?.trim();
    const venueId = (body.venueId as string)?.trim();
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
    } else if (userId && venueId) {
      staffDocId = `${venueId}_${userId}`;
      staffRef = firestore.collection("staff").doc(staffDocId);
    } else {
      return NextResponse.json(
        { error: "Укажите staffId либо userId и venueId" },
        { status: 400 }
      );
    }

    let snap = await staffRef.get();

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
      if (action === "start") {
        await docRef.update({
          onShift: true,
          shiftStartTime: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        await docRef.update({
          onShift: false,
          shiftEndTime: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
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
      await staffRef.update({
        onShift: true,
        shiftStartTime: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({
        ok: true,
        onShift: true,
        staffId: staffDocId,
        shiftStartTime: new Date().toISOString(),
      });
    }

    await staffRef.update({
      onShift: false,
      shiftEndTime: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
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
