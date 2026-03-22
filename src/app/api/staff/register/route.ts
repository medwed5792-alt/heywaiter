export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { findUserByIdentity, toIdentityKey } from "@/lib/auth/unifiedSearch";
import type { Affiliation, UnifiedIdentities } from "@/lib/types";
import { resolveVenueId } from "@/lib/standards/venue-default";

/**
 * POST /api/staff/register
 * Онбординг: регистрация нового сотрудника (форма Имя, Фамилия).
 * Создаёт global_users и staff для текущей платформы и venueId.
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
    const affiliation: Affiliation = {
      venueId,
      role: "waiter",
      status: "active",
      onShift: false,
    };

    await newRef.set({
      firstName: firstName || null,
      lastName: lastName || null,
      identities,
      affiliations: [affiliation],
      careerHistory: [],
      updatedAt: FieldValue.serverTimestamp(),
    });

    const staffDocId = `${venueId}_${userId}`;
    const staffRef = firestore.collection("staff").doc(staffDocId);
    await staffRef.set({
      venueId,
      userId,
      role: "waiter",
      primaryChannel: "telegram",
      identity: { channel: "telegram", externalId: platformId, locale: "ru", displayName: [firstName, lastName].filter(Boolean).join(" ") },
      onShift: false,
      active: true,
      ...(key === "tg" && { tgId: platformId }),
      firstName: firstName || null,
      lastName: lastName || null,
      updatedAt: FieldValue.serverTimestamp(),
    });

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
