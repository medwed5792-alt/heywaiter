export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * GET /api/staff/profile?telegramId=...
 * Личный кабинет: данные global_user по identities.tg (только для владельца по telegramId).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const telegramId = searchParams.get("telegramId")?.trim();
    if (!telegramId) {
      return NextResponse.json({ error: "telegramId обязателен" }, { status: 400 });
    }

    const firestore = getAdminFirestore();
    const snap = await firestore
      .collection("global_users")
      .where("identities.tg", "==", telegramId)
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json({ error: "Профиль не найден" }, { status: 404 });
    }

    const doc = snap.docs[0];
    const data = doc.data();
    const affiliations = Array.isArray(data.affiliations) ? data.affiliations : [];

    return NextResponse.json({
      userId: doc.id,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      phone: data.phone ?? null,
      birthDate: data.birthDate ?? null,
      photoUrl: data.photoUrl ?? null,
      identities: data.identities ?? {},
      affiliations,
      isFreeAgent: affiliations.filter((a: { status?: string }) => a.status !== "former").length === 0,
    });
  } catch (err) {
    console.error("[staff/profile GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/staff/profile
 * Обновление полей личного кабинета: phone, birthDate, photoUrl (только свои по telegramId).
 * Body: { telegramId: string, phone?: string, birthDate?: string, photoUrl?: string }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const telegramId = typeof body.telegramId === "string" ? body.telegramId.trim() : "";
    if (!telegramId) {
      return NextResponse.json({ error: "telegramId обязателен" }, { status: 400 });
    }

    const firestore = getAdminFirestore();
    const snap = await firestore
      .collection("global_users")
      .where("identities.tg", "==", telegramId)
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json({ error: "Профиль не найден" }, { status: 404 });
    }

    const ref = snap.docs[0].ref;
    const current = snap.docs[0].data();
    const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

    if (body.phone !== undefined) {
      const phone = typeof body.phone === "string" ? body.phone.replace(/\D/g, "") : "";
      updates.phone = phone || null;
      const identities = { ...(current.identities as Record<string, string>), ...(phone ? { phone } : {}) };
      if (!phone && identities.phone) delete identities.phone;
      updates.identities = identities;
    }
    if (body.birthDate !== undefined) {
      updates.birthDate = typeof body.birthDate === "string" ? body.birthDate.trim() || null : null;
    }
    if (body.photoUrl !== undefined) {
      updates.photoUrl = typeof body.photoUrl === "string" ? body.photoUrl.trim() || null : null;
    }

    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ ok: true, message: "Нечего обновлять" });
    }

    await ref.update(updates);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[staff/profile PATCH]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
