export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import type { StaffCareerEntry, UnifiedIdentities, MedicalCard } from "@/lib/types";

/** Ключи identities для соцсетей (поиск по ID мессенджера / username). */
const SOCIAL_IDENTITY_KEYS = ["tg", "wa", "vk", "viber", "wechat", "inst", "fb", "line"] as const;
type SocialKey = (typeof SOCIAL_IDENTITY_KEYS)[number];

/**
 * GET /api/admin/staff/lookup-by-identity?query=...
 * Универсальный поиск по Unified ID V.2.0:
 * - Если query после очистки — только цифры: поиск по полям phone и identities.phone.
 * - Если строка начинается с @ или содержит буквы: поиск по всем полям identities (tg, wa, vk, …).
 * Поиск параллельный (Promise.all) для скорости.
 * Возвращает трудовую книжку и foundBy (каким полем найден).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const queryRaw = searchParams.get("query");
    if (!queryRaw || !queryRaw.trim()) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const trimmed = queryRaw.trim();
    const normalizedForSocial = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
    const digitsOnly = trimmed.replace(/\D/g, "");
    const isDigitsOnly = digitsOnly.length > 0 && trimmed === digitsOnly;

    const firestore = getAdminFirestore();
    let userId: string | null = null;
    let foundBy: "phone" | "identities.phone" | SocialKey | null = null;

    if (isDigitsOnly) {
      const [byPhone, byIdentitiesPhone] = await Promise.all([
        firestore.collection("global_users").where("phone", "==", digitsOnly).limit(1).get(),
        firestore.collection("global_users").where("identities.phone", "==", digitsOnly).limit(1).get(),
      ]);
      if (!byPhone.empty) {
        userId = byPhone.docs[0].id;
        foundBy = "phone";
      } else if (!byIdentitiesPhone.empty) {
        userId = byIdentitiesPhone.docs[0].id;
        foundBy = "identities.phone";
      }
    } else {
      const searches = SOCIAL_IDENTITY_KEYS.map((key) =>
        firestore
          .collection("global_users")
          .where(`identities.${key}`, "==", normalizedForSocial)
          .limit(1)
          .get()
          .then((snap) => ({ key, snap }))
      );
      const results = await Promise.all(searches);
      for (const { key, snap } of results) {
        if (!snap.empty) {
          userId = snap.docs[0].id;
          foundBy = key;
          break;
        }
      }
    }

    if (!userId) {
      return NextResponse.json(
        { found: false, message: "Пользователь не найден. Можно создать нового." },
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
      foundBy,
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
    console.error("[staff/lookup-by-identity] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
