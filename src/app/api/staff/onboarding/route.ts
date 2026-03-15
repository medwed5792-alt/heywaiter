export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { findUserByIdentity, toIdentityKey } from "@/lib/auth/unifiedSearch";
import type { UnifiedIdentities } from "@/lib/types";

/**
 * POST /api/staff/onboarding
 * Первая регистрация: только Имя и Фамилия → создаётся только global_user (без staff и без привязки к заведению).
 * Тело: { firstName: string, lastName: string, platform: string, platformId: string }
 * После успеха фронт направляет в Личный кабинет (/mini-app/staff/cabinet).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
    const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
    const platform = typeof body.platform === "string" ? body.platform.trim() : "tg";
    const platformId = typeof body.platformId === "string" ? body.platformId.trim() : "";

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

    await newRef.set({
      firstName: firstName || null,
      lastName: lastName || null,
      identities,
      affiliations: [],
      careerHistory: [],
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      userId,
      message: "Профиль создан. Переход в Личный кабинет.",
    });
  } catch (err) {
    console.error("[staff/onboarding]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
