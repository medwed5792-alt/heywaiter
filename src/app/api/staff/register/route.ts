export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { findUserByIdentity, toIdentityKey } from "@/lib/auth/unifiedSearch";
import type { Affiliation, UnifiedIdentities } from "@/lib/types";
import { resolveVenueId } from "@/lib/standards/venue-default";
import { generateSotaId } from "@/lib/sota-id";

/**
 * POST /api/staff/register
 * Онбординг: регистрация нового сотрудника (форма Имя, Фамилия).
 * Создаёт только global_users (цифровой паспорт + привязка к venue). Коллекция staff в коде не используется.
 * Тело: { firstName: string, lastName: string, platform: string, platformId: string, venueId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
    const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
    const platform = typeof body.platform === "string" ? body.platform.trim() : "tg";
    const platformId = typeof body.platformId === "string" ? body.platformId.trim() : "";
    const venueId = resolveVenueId(typeof body.venueId === "string" ? body.venueId : undefined);

    if (!platformId) {
      return NextResponse.json(
        { error: "platformId обязателен" },
        { status: 400 }
      );
    }

    const key = toIdentityKey(platform);
    if (!key) {
      return NextResponse.json(
        { error: "Неподдерживаемая платформа" },
        { status: 400 }
      );
    }

    const existing = await findUserByIdentity(platform, platformId);
    if (existing) {
      return NextResponse.json(
        { error: "Пользователь с этим ID уже зарегистрирован", userId: existing },
        { status: 409 }
      );
    }

    const firestore = getAdminFirestore();
    const identities: UnifiedIdentities = { [key]: platformId };
    const newRef = firestore.collection("global_users").doc();
    const userId = newRef.id;
    const sotaId = generateSotaId("S", "W");
    const staffDocId = `${venueId}_${userId}`;
    const affiliation: Affiliation = {
      venueId,
      role: "waiter",
      status: "active",
      onShift: false,
      staffFirestoreId: staffDocId,
    };

    await newRef.set({
      systemRole: "STAFF",
      firstName: firstName || null,
      lastName: lastName || null,
      sotaId,
      identities,
      affiliations: [affiliation],
      staffLookupIds: [staffDocId],
      staffVenueActive: [venueId],
      staffVenueOnShift: [],
      careerHistory: [],
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Виртуальный кошелек сотрудника: ключ = unified_id (global_users.id).
    await firestore.collection("staff_wallets").doc(userId).set(
      {
        staffUnifiedId: userId,
        staffSotaId: sotaId,
        staffId: staffDocId,
        venueId,
        balance: 0,
        totalTips: 0,
        txCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({
      userId,
      staffId: staffDocId,
      venueId,
      onShift: false,
    });
  } catch (err) {
    console.error("[staff/register]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
