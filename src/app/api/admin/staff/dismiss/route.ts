import { NextRequest, NextResponse } from "next/server";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ExitReason, StaffCareerEntry } from "@/lib/types";

/**
 * POST /api/admin/staff/dismiss
 * Тело: { staffId: string, exitReason: ExitReason }
 * ЛПР обязан выбрать причину. Данные сотрудника перманентны: в careerHistory добавляется запись.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { staffId, exitReason } = body as { staffId?: string; exitReason?: ExitReason };

    if (!staffId || !exitReason) {
      return NextResponse.json(
        { error: "staffId and exitReason required" },
        { status: 400 }
      );
    }
    const allowed: ExitReason[] = ["own_wish", "discipline", "professionalism", "other"];
    if (!allowed.includes(exitReason)) {
      return NextResponse.json(
        { error: "Invalid exitReason" },
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
      rating: data.rating,
    };
    careerHistory.push(newEntry);

    await updateDoc(staffRef, {
      active: false,
      careerHistory,
      onShift: false,
      updatedAt: serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[staff/dismiss] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
