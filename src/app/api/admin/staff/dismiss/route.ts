export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { StaffCareerEntry, Affiliation } from "@/lib/types";

const VENUE_ID = "current";

/**
 * POST /api/admin/staff/dismiss
 * Тело: { staffId: string, venueId?: string, exitReason: string (текст), rating: number (1-5) }
 *
 * - Находит документ staff по staffId, при необходимости берёт venueId из тела или из документа.
 * - В global_users находит affiliation с этим venueId и ставит status: "former".
 * - Добавляет запись в careerHistory (date, exitReason как текст в comment, rating).
 * - Пересчитывает globalScore по истории оценок.
 * - В коллекции staff ставит active: false, onShift: false.
 * - Fallback: если у сотрудника нет записи в global_users — создаёт её при увольнении.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { staffId, venueId: bodyVenueId, exitReason, rating } = body as {
      staffId?: string;
      venueId?: string;
      exitReason?: string;
      rating?: number;
    };

    if (!staffId) {
      return NextResponse.json(
        { error: "staffId required" },
        { status: 400 }
      );
    }
    if (typeof exitReason !== "string" || !exitReason.trim()) {
      return NextResponse.json(
        { error: "exitReason required (text)" },
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

    const firestore = getAdminFirestore();

    const staffSnap = await firestore.collection("staff").doc(staffId).get();
    if (!staffSnap.exists) {
      return NextResponse.json({ error: "Staff not found" }, { status: 404 });
    }

    const staffData = staffSnap.data() ?? {};
    const venueId = (bodyVenueId && String(bodyVenueId).trim()) || (staffData.venueId as string) || VENUE_ID;
    const userId = (staffData.userId as string) || staffId;
    const position = (staffData.position as string) || "Сотрудник";
    const joinDate = staffData.invitedAt ?? staffData.createdAt;

    const newEntry: StaffCareerEntry = {
      venueId,
      position,
      joinDate,
      exitDate: FieldValue.serverTimestamp(),
      exitReason: "other",
      rating: ratingNum,
      comment: exitReason.trim(),
    };

    const globalRef = firestore.collection("global_users").doc(userId);
    const globalSnap = await globalRef.get();

    if (globalSnap.exists) {
      const globalData = globalSnap.data() ?? {};
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

      await globalRef.update({
        affiliations,
        careerHistory,
        ...(globalScore != null && { globalScore }),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      await globalRef.set({
        firstName: staffData.firstName ?? null,
        lastName: staffData.lastName ?? null,
        identity: staffData.identity ?? null,
        identities: staffData.identities ?? null,
        affiliations: [{ venueId, role: position, status: "former" as const }],
        careerHistory: [newEntry],
        globalScore: ratingNum,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await firestore.collection("staff").doc(staffId).update({
      active: false,
      onShift: false,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const today = new Date().toISOString().slice(0, 10);
    const futureShiftsSnap = await firestore
      .collection("scheduleEntries")
      .where("staffId", "==", staffId)
      .get();
    for (const d of futureShiftsSnap.docs) {
      const slot = d.data().slot as { date?: string } | undefined;
      const date = slot?.date ?? (d.data().date as string);
      if (date && date >= today) {
        await firestore.collection("scheduleEntries").doc(d.id).delete();
      }
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
