import { NextRequest, NextResponse } from "next/server";
import { doc, getDoc, updateDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ExitReason, StaffCareerEntry } from "@/lib/types";

/**
 * POST /api/admin/staff/dismiss
 * Тело: { staffId: string, exitReason: ExitReason, rating: number (1-5) }
 * ЛПР обязан выбрать причину и оценку. Данные сотрудника перманентны: в careerHistory добавляется запись, globalScore пересчитывается.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { staffId, exitReason, rating } = body as { staffId?: string; exitReason?: ExitReason; rating?: number };

    if (!staffId || !exitReason) {
      return NextResponse.json(
        { error: "staffId and exitReason required" },
        { status: 400 }
      );
    }
    const allowed: ExitReason[] = ["own_wish", "discipline", "professionalism", "conflict", "other"];
    if (!allowed.includes(exitReason)) {
      return NextResponse.json(
        { error: "Invalid exitReason" },
        { status: 400 }
      );
    }
    const ratingNum = typeof rating === "number" ? rating : parseInt(String(rating), 10);
    if (Number.isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return NextResponse.json(
        { error: "rating required, 1-5" },
        { status: 400 }
      );
    }

    const staffRef = doc(db, "staff", staffId);
    const snap = await getDoc(staffRef);
    if (!snap.exists()) {
      return NextResponse.json({ error: "Staff not found" }, { status: 404 });
    }

    const data = snap.data();
    const venueId = data.venueId as string;
    const position = (data.position as string) || "Сотрудник";
    const joinDate = data.invitedAt || data.createdAt;
    const careerHistory = (data.careerHistory || []) as StaffCareerEntry[];

    const newEntry: StaffCareerEntry = {
      venueId,
      position,
      joinDate,
      exitDate: serverTimestamp(),
      exitReason,
      rating: ratingNum,
    };
    careerHistory.push(newEntry);

    const ratingsWithValues = careerHistory.map((e) => e.rating).filter((r): r is number => typeof r === "number" && r >= 1 && r <= 5);
    const globalScore = ratingsWithValues.length > 0
      ? Math.round((ratingsWithValues.reduce((a, b) => a + b, 0) / ratingsWithValues.length) * 10) / 10
      : undefined;

    const updatePayload: Record<string, unknown> = {
      active: false,
      careerHistory,
      onShift: false,
      updatedAt: serverTimestamp(),
    };
    if (globalScore != null) updatePayload.globalScore = globalScore;

    await updateDoc(staffRef, updatePayload);

    // Синхронизация с глобальной коллекцией global_staff (Биржа труда, видна Супер-Админу в /super)
    const globalRef = doc(db, "global_staff", staffId);
    await setDoc(globalRef, {
      venueId,
      active: false,
      careerHistory,
      globalScore: globalScore ?? null,
      onShift: false,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[staff/dismiss] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
