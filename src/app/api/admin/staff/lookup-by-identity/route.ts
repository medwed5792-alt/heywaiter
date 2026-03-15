export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import type { StaffCareerEntry, UnifiedIdentities, MedicalCard } from "@/lib/types";

/** Ключи identities для соцсетей (поиск строго по одному полю). */
const SOCIAL_IDENTITY_KEYS = ["tg", "wa", "vk", "viber", "wechat", "inst", "fb", "line"] as const;
export type SocialKey = (typeof SOCIAL_IDENTITY_KEYS)[number];

/** Допустимый type для поиска: номер телефона или одна из соцсетей. */
export type LookupType = "phone" | SocialKey;

/**
 * GET /api/admin/staff/lookup-by-identity?type=...&value=...
 * Поиск по типу идентификатора (защита от пересечения цифровых ID между платформами):
 * - type=phone: поиск строго по полю phone (value очищается от нецифровых символов).
 * - type=tg|wa|vk|...: поиск строго в identities.[type] по value.
 * Возвращает трудовую книжку и foundBy = type.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const typeRaw = searchParams.get("type");
    const valueRaw = searchParams.get("value");

    if (!typeRaw || !typeRaw.trim()) {
      return NextResponse.json({ error: "type is required (phone | tg | wa | vk | viber | wechat | inst | fb | line)" }, { status: 400 });
    }
    if (valueRaw == null || String(valueRaw).trim() === "") {
      return NextResponse.json({ error: "value is required" }, { status: 400 });
    }

    const type = typeRaw.trim().toLowerCase() as LookupType;
    const allowedTypes: LookupType[] = ["phone", ...SOCIAL_IDENTITY_KEYS];
    if (!allowedTypes.includes(type)) {
      return NextResponse.json(
        { error: `type must be one of: ${allowedTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();
    let userId: string | null = null;
    let foundBy: LookupType | null = null;

    if (type === "phone") {
      const digitsOnly = String(valueRaw).trim().replace(/\D/g, "");
      if (!digitsOnly) {
        return NextResponse.json({ error: "Для типа «Номер телефона» укажите цифры" }, { status: 400 });
      }
      const byPhone = await firestore
        .collection("global_users")
        .where("phone", "==", digitsOnly)
        .limit(1)
        .get();
      if (!byPhone.empty) {
        userId = byPhone.docs[0].id;
        foundBy = "phone";
      }
    } else {
      const value = String(valueRaw).trim();
      const normalized = value.startsWith("@") ? value.slice(1) : value;
      if (!normalized) {
        return NextResponse.json({ error: "Укажите значение для поиска" }, { status: 400 });
      }
      const snap = await firestore
        .collection("global_users")
        .where(`identities.${type}`, "==", normalized)
        .limit(1)
        .get();
      if (!snap.empty) {
        userId = snap.docs[0].id;
        foundBy = type;
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
