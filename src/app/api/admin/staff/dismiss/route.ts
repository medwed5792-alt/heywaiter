export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  setDoc,
  query,
  where,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ExitReason, StaffCareerEntry, Affiliation } from "@/lib/types";

const VENUE_ID = "current";

/**
 * POST /api/admin/staff/dismiss
 * ЛПР: «Удаление» = Unlink — снятие связи с заведением.
 * Тело: { staffId: string, exitReason: ExitReason, rating?: number (1-5) }
 * - Устанавливает status: "former" для текущего venueId в affiliations.
 * - Сохраняет причину увольнения в careerHistory глобального профиля.
 * - Профиль остаётся в global_users для Супер-админа (/super/catalog).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { staffId, exitReason, rating } = body as {
      staffId?: string;
      exitReason?: ExitReason;
      rating?: number;
    };

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
    const ratingNum =
      typeof rating === "number" ? rating : parseInt(String(rating), 10);
    if (Number.isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return NextResponse.json(
        { error: "rating required, 1-5" },
        { status: 400 }
      );
    }

    const staffRef = doc(db, "staff", staffId);
    const staffSnap = await getDoc(staffRef);
    if (!staffSnap.exists()) {
      return NextResponse.json({ error: "Staff not found" }, { status: 404 });
    }

    const staffData = staffSnap.data();
    const venueId = (staffData.venueId as string) || VENUE_ID;
    const userId = (staffData.userId as string) || staffId;
    const position = (staffData.position as string) || "Сотрудник";
    const joinDate = staffData.invitedAt || staffData.createdAt;

    const globalRef = doc(db, "global_users", userId);
    const globalSnap = await getDoc(globalRef);

    const newEntry: StaffCareerEntry = {
      venueId,
      position,
      joinDate,
      exitDate: serverTimestamp(),
      exitReason,
      rating: ratingNum,
    };

    if (globalSnap.exists()) {
      const globalData = globalSnap.data();
      const affiliations: Affiliation[] = Array.isArray(globalData.affiliations)
        ? [...globalData.affiliations]
        : [];
      const idx = affiliations.findIndex((a: { venueId: string }) => a.venueId === venueId);
      if (idx >= 0) {
        affiliations[idx] = { ...affiliations[idx], status: "former" as const };
      }
      const careerHistory: StaffCareerEntry[] = [
        ...(Array.isArray(globalData.careerHistory) ? globalData.careerHistory : []),
        newEntry,
      ];
      const ratingsWithValues = careerHistory
        .map((e) => e.rating)
        .filter((r): r is number => typeof r === "number" && r >= 1 && r <= 5);
      const globalScore =
        ratingsWithValues.length > 0
          ? Math.round((ratingsWithValues.reduce((a, b) => a + b, 0) / ratingsWithValues.length) * 10) / 10
          : undefined;

      await updateDoc(globalRef, {
        affiliations,
        careerHistory,
        ...(globalScore != null && { globalScore }),
        updatedAt: serverTimestamp(),
      });
    } else {
      // Legacy: staff без global_users — создаём запись в каталоге для Супер-админа
      await setDoc(globalRef, {
        firstName: staffData.firstName ?? null,
        lastName: staffData.lastName ?? null,
        identity: staffData.identity ?? null,
        affiliations: [{ venueId, role: position, status: "former" as const }],
        careerHistory: [newEntry],
        globalScore: ratingNum,
        updatedAt: serverTimestamp(),
      });
    }

    await updateDoc(staffRef, {
      active: false,
      onShift: false,
      updatedAt: serverTimestamp(),
    });

    const today = new Date().toISOString().slice(0, 10);
    const futureShiftsSnap = await getDocs(
      query(collection(db, "scheduleEntries"), where("staffId", "==", staffId))
    );
    for (const d of futureShiftsSnap.docs) {
      const slot = d.data().slot as { date?: string } | undefined;
      const date = slot?.date ?? (d.data().date as string);
      if (date && date >= today) await deleteDoc(doc(db, "scheduleEntries", d.id));
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[staff/dismiss] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
