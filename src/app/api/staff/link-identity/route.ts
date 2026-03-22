export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { findUserByIdentity, toIdentityKey } from "@/lib/auth/unifiedSearch";
import type { Affiliation, UnifiedIdentities } from "@/lib/types";
import { resolveVenueId } from "@/lib/standards/venue-default";

function cleanPhone(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * POST /api/staff/link-identity
 * Онбординг: "У меня уже есть аккаунт (вход по номеру телефона)".
 * Ищет пользователя по phone, добавляет в его identities новый platformId (не создаёт нового юзера).
 * Тело: { phone: string, platform: string, platformId: string, venueId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const platform = typeof body.platform === "string" ? body.platform.trim() : "tg";
    const platformId = typeof body.platformId === "string" ? body.platformId.trim() : "";
    const venueId = resolveVenueId(typeof body.venueId === "string" ? body.venueId : undefined);

    if (!phone || !platformId) {
      return NextResponse.json(
        { error: "phone, platformId обязательны" },
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

    const phoneCleaned = cleanPhone(phone);
    if (!phoneCleaned) {
      return NextResponse.json(
        { error: "Некорректный номер телефона" },
        { status: 400 }
      );
    }

    const foundUserId = await findUserByIdentity("phone", phoneCleaned);
    if (!foundUserId) {
      return NextResponse.json(
        { error: "Пользователь с таким номером не найден. Зарегистрируйтесь или проверьте номер." },
        { status: 404 }
      );
    }

    const firestore = getAdminFirestore();
    const globalRef = firestore.collection("global_users").doc(foundUserId);
    const globalSnap = await globalRef.get();
    if (!globalSnap.exists) {
      return NextResponse.json({ error: "Профиль не найден" }, { status: 404 });
    }

    const globalData = globalSnap.data() ?? {};
    const identities: UnifiedIdentities = { ...(globalData.identities as UnifiedIdentities), [key]: platformId };
    await globalRef.update({
      identities,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const staffDocId = `${venueId}_${foundUserId}`;
    const staffRef = firestore.collection("staff").doc(staffDocId);
    let staffSnap = await staffRef.get();

    if (!staffSnap.exists) {
      const affiliations: Affiliation[] = Array.isArray(globalData.affiliations) ? [...globalData.affiliations] : [];
      const hasAff = affiliations.some((a: { venueId: string }) => a.venueId === venueId);
      if (!hasAff) {
        affiliations.push({
          venueId,
          role: "waiter",
          status: "active",
          onShift: false,
        });
        await globalRef.update({ affiliations });
      }
      await staffRef.set({
        venueId,
        userId: foundUserId,
        role: "waiter",
        primaryChannel: platform === "tg" || key === "tg" ? "telegram" : "telegram",
        identity: globalData.identity ?? { channel: "telegram", externalId: platformId, locale: "ru" },
        onShift: false,
        active: true,
        ...(key === "tg" && { tgId: platformId }),
        firstName: globalData.firstName ?? null,
        lastName: globalData.lastName ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      staffSnap = await staffRef.get();
    } else {
      const staffData = staffSnap.data() ?? {};
      const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      if (key === "tg" && platformId) updates.tgId = platformId;
      if (Object.keys(updates).length > 1) await staffRef.update(updates);
    }

    if (!staffSnap.exists) {
      return NextResponse.json({ error: "Не удалось привязать к заведению" }, { status: 500 });
    }

    const d = staffSnap.data() ?? {};
    return NextResponse.json({
      userId: foundUserId,
      staffId: staffSnap.id,
      venueId: d.venueId ?? venueId,
      onShift: d.onShift === true,
    });
  } catch (err) {
    console.error("[staff/link-identity]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
