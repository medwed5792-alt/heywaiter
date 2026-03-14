export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import type { StaffCareerEntry, UnifiedIdentities, MedicalCard } from "@/lib/types";

/**
 * GET /api/admin/staff/lookup-by-phone?phone=+79001234567
 * Ищет в global_users по полям phone и identities.phone (очищенный номер — только цифры).
 * Возвращает «трудовую книжку» для приёма в штат. Если не найден — 404.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const phoneRaw = searchParams.get("phone");
    if (!phoneRaw || !phoneRaw.trim()) {
      return NextResponse.json({ error: "phone is required" }, { status: 400 });
    }

    const cleanPhone = phoneRaw.trim().replace(/\D/g, "");
    if (cleanPhone.length === 0) {
      return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
    }

    console.log("[lookup-by-phone] Входящий номер (raw):", JSON.stringify(phoneRaw.trim()), "| очищенный (cleanPhone):", cleanPhone);

    const firestore = getAdminFirestore();
    let userId: string | null = null;
    let foundBy: "phone" | "identities.phone" | null = null;

    const byPhone = await firestore
      .collection("global_users")
      .where("phone", "==", cleanPhone)
      .limit(1)
      .get();
    if (!byPhone.empty) {
      userId = byPhone.docs[0].id;
      foundBy = "phone";
    }

    if (!userId) {
      const byIdentities = await firestore
        .collection("global_users")
        .where("identities.phone", "==", cleanPhone)
        .limit(1)
        .get();
      if (!byIdentities.empty) {
        userId = byIdentities.docs[0].id;
        foundBy = "identities.phone";
      }
    }

    if (!userId) {
      console.log("[lookup-by-phone] Запрос по cleanPhone:", cleanPhone, "— не найден ни в phone, ни в identities.phone");
      return NextResponse.json(
        { found: false, message: "Пользователь с таким телефоном не найден. Можно создать нового." },
        { status: 404 }
      );
    }

    console.log("[lookup-by-phone] Найден userId:", userId, "по полю:", foundBy);

    const doc = await firestore.collection("global_users").doc(userId).get();
    if (!doc.exists) {
      return NextResponse.json({ found: false }, { status: 404 });
    }

    const data = doc.data() ?? {};
    const careerHistory = (data.careerHistory as StaffCareerEntry[] | undefined) ?? [];
    const identities = (data.identities as UnifiedIdentities | undefined) ?? {};
    const affiliations = Array.isArray(data.affiliations) ? data.affiliations : [];
    const medicalCard = data.medicalCard as MedicalCard | undefined;

    return NextResponse.json({
      found: true,
      userId: doc.id,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      phone: data.phone ?? null,
      photoUrl: data.photoUrl ?? null,
      identities,
      tgId: data.tgId ?? null,
      globalScore: data.globalScore ?? null,
      medicalCard: medicalCard ?? null,
      careerHistory: careerHistory.map((e) => ({
        venueId: e.venueId,
        position: e.position,
        joinDate: e.joinDate,
        exitDate: e.exitDate,
        exitReason: e.exitReason,
        rating: e.rating,
        comment: e.comment,
      })),
      affiliations: affiliations.map((a: { venueId: string; role?: string; status?: string }) => ({
        venueId: a.venueId,
        role: a.role,
        status: a.status,
      })),
    });
  } catch (err) {
    console.error("[staff/lookup-by-phone] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
