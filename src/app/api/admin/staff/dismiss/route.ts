export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { StaffCareerEntry, Affiliation } from "@/lib/types";

import { DEFAULT_VENUE_ID as VENUE_ID } from "@/lib/standards/venue-default";

/**
 * POST /api/admin/staff/dismiss (Unlink / Расторжение контракта)
 * Тело: { staffId: string, venueId?: string, exitReason: string (текст), rating: number (1-5) }
 *
 * Концепция: заведение не удаляет пользователя, а разрывает связь (Affiliation) и оставляет
 * запись в трудовой книжке (careerHistory) для Биржи смен.
 *
 * 1. Находит staff и global_users по userId.
 * 2. Удаляет текущий venueId из массива affiliations (разрыв связи).
 * 3. Находит последнюю запись в careerHistory для этого заведения или создаёт новую;
 *    записывает endDate, exitReason: "contract_terminated", rating и comment.
 * 4. В коллекции venues/[venueId]/staff/[staffId] устанавливает status: 'inactive'
 *    (скрывает из списка «Команда», сохраняет в архиве заведения).
 * 5. В корневой коллекции staff ставит active: false, onShift: false.
 * 6. Удаляет будущие смены (scheduleEntries).
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
    const nowIso = new Date().toISOString();
    const joinDateRaw = staffData.invitedAt ?? staffData.createdAt;
    const joinDate =
      joinDateRaw !== undefined && joinDateRaw !== null
        ? typeof joinDateRaw === "object" && "toDate" in joinDateRaw
          ? (joinDateRaw as { toDate: () => Date }).toDate().toISOString()
          : String(joinDateRaw)
        : nowIso;

    const newEntry: StaffCareerEntry = {
      venueId,
      position,
      joinDate,
      exitDate: nowIso,
      exitReason: "contract_terminated",
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
      const filteredAffiliations = affiliations.filter((a: { venueId: string }) => a.venueId !== venueId);

      let careerHistory: StaffCareerEntry[] = Array.isArray(globalData.careerHistory)
        ? [...globalData.careerHistory]
        : [];
      const lastIdxForVenue = careerHistory.map((e, i) => (e.venueId === venueId ? i : -1)).filter((i) => i >= 0).pop();
      if (lastIdxForVenue !== undefined && lastIdxForVenue >= 0) {
        careerHistory[lastIdxForVenue] = {
          ...careerHistory[lastIdxForVenue],
          exitDate: nowIso,
          exitReason: "contract_terminated",
          rating: ratingNum,
          comment: exitReason.trim(),
        };
      } else {
        careerHistory = [...careerHistory, newEntry];
      }

      const ratingsWithValues = careerHistory
        .map((e) => e.rating)
        .filter((r): r is number => typeof r === "number" && r >= 1 && r <= 5);
      const globalScore =
        ratingsWithValues.length > 0
          ? Math.round((ratingsWithValues.reduce((a, b) => a + b, 0) / ratingsWithValues.length) * 10) / 10
          : undefined;

      await globalRef.update({
        affiliations: filteredAffiliations,
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
        affiliations: [],
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

    const venueStaffRef = firestore.collection("venues").doc(venueId).collection("staff").doc(staffId);
    await venueStaffRef.set(
      { status: "inactive", updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

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
