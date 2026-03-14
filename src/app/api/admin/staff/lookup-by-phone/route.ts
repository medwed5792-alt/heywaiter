export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import type { StaffCareerEntry, UnifiedIdentities, MedicalCard } from "@/lib/types";

/**
 * Нормализует телефон для поиска: только цифры, российский формат +7XXXXXXXXXX.
 */
function normalizePhone(input: string): string[] {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 0) return [];
  const variants: string[] = [];
  if (digits.length === 10 && digits.startsWith("9")) {
    variants.push("+7" + digits);
    variants.push("7" + digits);
    variants.push("8" + digits);
  } else if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    const ten = digits.slice(-10);
    variants.push("+7" + ten);
    variants.push("7" + ten);
    variants.push("8" + ten);
  } else {
    variants.push("+" + digits);
    variants.push(digits);
  }
  return [...new Set(variants)];
}

/**
 * GET /api/admin/staff/lookup-by-phone?phone=+79001234567
 * Ищет в global_users по identities.phone. Возвращает «трудовую книжку» (опыт, рейтинг)
 * для приёма в штат. Если не найден — 404 (фронт предложит создать нового).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const phoneRaw = searchParams.get("phone");
    if (!phoneRaw || !phoneRaw.trim()) {
      return NextResponse.json({ error: "phone is required" }, { status: 400 });
    }

    const variants = normalizePhone(phoneRaw.trim());
    if (variants.length === 0) {
      return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
    }

    const firestore = getAdminFirestore();
    let userId: string | null = null;

    for (const phone of variants) {
      const snap = await firestore
        .collection("global_users")
        .where("identities.phone", "==", phone)
        .limit(1)
        .get();
      if (!snap.empty) {
        userId = snap.docs[0].id;
        break;
      }
    }

    if (!userId) {
      return NextResponse.json(
        { found: false, message: "Пользователь с таким телефоном не найден. Можно создать нового." },
        { status: 404 }
      );
    }

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
