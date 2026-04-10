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

    const staffDocId = `${venueId}_${foundUserId}`;
    const affiliations: Affiliation[] = Array.isArray(globalData.affiliations) ? [...globalData.affiliations] : [];
    const hasAff = affiliations.some((a: { venueId: string }) => a.venueId === venueId);
    if (!hasAff) {
      affiliations.push({
        venueId,
        role: "waiter",
        status: "active",
        onShift: false,
        staffFirestoreId: staffDocId,
      });
    } else {
      const ix = affiliations.findIndex((a) => a.venueId === venueId);
      if (ix >= 0) {
        affiliations[ix] = { ...affiliations[ix], staffFirestoreId: staffDocId };
      }
    }

    const prevLookup: string[] = Array.isArray(globalData.staffLookupIds) ? globalData.staffLookupIds : [];
    const lookup = [...new Set([...prevLookup, staffDocId])];
    const prevActive: string[] = Array.isArray(globalData.staffVenueActive) ? globalData.staffVenueActive : [];
    const venuesActive = [...new Set([...prevActive, venueId])];

    await globalRef.set(
      {
        identities,
        systemRole: "STAFF",
        affiliations,
        staffLookupIds: lookup,
        staffVenueActive: venuesActive,
        staffVenueOnShift: Array.isArray(globalData.staffVenueOnShift) ? globalData.staffVenueOnShift : [],
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const venueStaffRef = firestore.collection("venues").doc(venueId).collection("staff").doc(staffDocId);
    const vsSnap = await venueStaffRef.get();
    const vs = vsSnap.data() ?? {};
    let onShift = vs.onShift === true;
    if (!vsSnap.exists) {
      await venueStaffRef.set(
        {
          venueId,
          userId: foundUserId,
          role: "waiter",
          primaryChannel: key === "tg" ? "telegram" : "telegram",
          identity: globalData.identity ?? { channel: "telegram", externalId: platformId, locale: "ru" },
          onShift: false,
          active: true,
          tgId: key === "tg" ? platformId : vs.tgId,
          firstName: globalData.firstName ?? null,
          lastName: globalData.lastName ?? null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      onShift = false;
    } else if (key === "tg" && platformId) {
      await venueStaffRef.set({ tgId: platformId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }

    return NextResponse.json({
      userId: foundUserId,
      staffId: staffDocId,
      venueId,
      onShift,
    });
  } catch (err) {
    console.error("[staff/link-identity]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
