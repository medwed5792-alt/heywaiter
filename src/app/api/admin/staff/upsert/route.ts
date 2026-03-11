export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import type { Affiliation, UnifiedIdentities } from "@/lib/types";

const VENUE_ID = "current";

/**
 * Ищет существующий global_users по одному из идентификаторов (identities.tg, .email, .phone).
 * Возвращает userId первого найденного документа или null.
 */
async function findExistingUserIdByIdentities(
  firestore: Firestore,
  identities: UnifiedIdentities
): Promise<string | null> {
  const keys = ["tg", "email", "phone", "wa", "vk"] as const;
  for (const key of keys) {
    const value = identities[key];
    if (!value || typeof value !== "string" || !value.trim()) continue;
    const snap = await firestore
      .collection("global_users")
      .where(`identities.${key}`, "==", value.trim())
      .limit(1)
      .get();
    if (!snap.empty) {
      return snap.docs[0].id;
    }
  }
  return null;
}

/**
 * POST /api/admin/staff/upsert
 * ЛПР: создание или обновление сотрудника.
 * - Без staffId: ищет существующий global_users по identities (tg, email, phone), чтобы не создавать дубликатов и сохранять историю кармы; при отсутствии — создаёт новый документ. Привязывает к текущему venueId.
 * - Со staffId: обновляет global_users и связь (affiliation) для текущего заведения.
 * Использует Firebase Admin.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const staffId = body.staffId as string | undefined;

    const assignedTableIds = Array.isArray(body.assignedTableIds) ? body.assignedTableIds : [];
    const identity = body.identity ?? {
      channel: "telegram",
      externalId: body.tgId ?? "",
      locale: "ru",
      displayName: [body.firstName, body.lastName].filter(Boolean).join(" "),
    };

    const firestore = getAdminFirestore();

    if (staffId) {
      const staffRef = firestore.collection("staff").doc(staffId);
      const staffSnap = await staffRef.get();
      if (!staffSnap.exists) {
        return NextResponse.json({ error: "Staff not found" }, { status: 404 });
      }
      const staffData = staffSnap.data() ?? {};
      const userId = (staffData.userId as string) || staffId;

      const globalRef = firestore.collection("global_users").doc(userId);
      const globalSnap = await globalRef.get();

      const profilePayload: Record<string, unknown> = {
        firstName: body.firstName ?? staffData.firstName ?? null,
        lastName: body.lastName ?? staffData.lastName ?? null,
        gender: body.gender ?? staffData.gender ?? null,
        birthDate: body.birthDate ?? staffData.birthDate ?? null,
        photoUrl: body.photoUrl ?? staffData.photoUrl ?? null,
        phone: body.phone ?? staffData.phone ?? null,
        identity: body.identity ?? staffData.identity ?? identity,
        primaryChannel: body.primaryChannel ?? staffData.primaryChannel ?? "telegram",
        tgId: body.tgId ?? staffData.tgId ?? null,
        guestRating: body.guestRating ?? staffData.guestRating ?? null,
        venueRating: body.venueRating ?? staffData.venueRating ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (body.globalScore != null) profilePayload.globalScore = body.globalScore;
      const identitiesUpdate: UnifiedIdentities = {
        ...(staffData.identities as UnifiedIdentities | undefined),
        ...(body.tgId && { tg: String(body.tgId).trim() }),
        ...(body.email && { email: String(body.email).trim() }),
        ...(body.phone && { phone: String(body.phone).trim() }),
      };
      if (Object.keys(identitiesUpdate).length > 0) profilePayload.identities = identitiesUpdate;

      if (globalSnap.exists) {
        const globalData = globalSnap.data() ?? {};
        const affiliations: Affiliation[] = Array.isArray(globalData.affiliations) ? [...globalData.affiliations] : [];
        const idx = affiliations.findIndex((a: { venueId: string }) => a.venueId === VENUE_ID);
        const affPayload: Affiliation = {
          venueId: VENUE_ID,
          role: body.position ?? body.role ?? (globalData.affiliations as Affiliation[])?.[idx]?.role ?? "waiter",
          status: (affiliations[idx] as Affiliation)?.status ?? "active",
          position: body.position ?? (affiliations[idx] as Affiliation)?.position,
          onShift: body.onShift ?? (affiliations[idx] as Affiliation)?.onShift ?? false,
          assignedTableIds: assignedTableIds.length ? assignedTableIds : (affiliations[idx] as Affiliation)?.assignedTableIds,
        };
        if (idx >= 0) affiliations[idx] = affPayload;
        else affiliations.push(affPayload);

        await globalRef.update({
          ...profilePayload,
          affiliations,
        });
      } else {
        await globalRef.set({
          ...profilePayload,
          identities: profilePayload.identities ?? {
            ...(body.tgId && { tg: String(body.tgId).trim() }),
            ...(body.email && { email: String(body.email).trim() }),
            ...(body.phone && { phone: String(body.phone).trim() }),
          },
          affiliations: [{
            venueId: VENUE_ID,
            role: body.position ?? body.role ?? "waiter",
            status: "active",
            position: body.position ?? null,
            onShift: body.onShift ?? false,
            assignedTableIds: assignedTableIds.length ? assignedTableIds : undefined,
          } as Affiliation],
        });
      }

      await staffRef.update({
        position: body.position ?? staffData.position,
        group: body.group ?? staffData.group,
        call_category: body.call_category ?? staffData.call_category,
        onShift: body.onShift ?? staffData.onShift,
        assignedTableIds,
        updatedAt: FieldValue.serverTimestamp(),
        ...(body.role != null && { role: body.role }),
        ...(body.active != null && { active: body.active }),
      });

      return NextResponse.json({ ok: true, staffId });
    }

    // Создание: поиск по identities (Единый профиль), затем создание или привязка
    const identities: UnifiedIdentities = {};
    if (body.tgId && String(body.tgId).trim()) identities.tg = String(body.tgId).trim();
    if (body.email && String(body.email).trim()) identities.email = String(body.email).trim();
    if (body.phone && String(body.phone).trim()) identities.phone = String(body.phone).trim();

    let existingUserId: string | null = null;
    if (Object.keys(identities).length > 0) {
      existingUserId = await findExistingUserIdByIdentities(firestore, identities);
    }

    const affiliation: Affiliation = {
      venueId: VENUE_ID,
      role: body.position ?? body.role ?? "waiter",
      status: "active",
      position: body.position ?? undefined,
      onShift: false,
      assignedTableIds: assignedTableIds.length ? assignedTableIds : undefined,
    };

    let userId: string;

    if (existingUserId) {
      userId = existingUserId;
      const globalRef = firestore.collection("global_users").doc(userId);
      const globalSnap = await globalRef.get();
      const globalData = globalSnap.data() ?? {};
      const affiliations: Affiliation[] = Array.isArray(globalData.affiliations) ? [...globalData.affiliations] : [];
      const idx = affiliations.findIndex((a: { venueId: string }) => a.venueId === VENUE_ID);
      const mergedIdentities: UnifiedIdentities = { ...(globalData.identities as UnifiedIdentities | undefined), ...identities };
      if (idx >= 0) {
        affiliations[idx] = { ...affiliations[idx], ...affiliation };
      } else {
        affiliations.push(affiliation);
      }
      await globalRef.update({
        identities: mergedIdentities,
        affiliations,
        firstName: body.firstName ?? globalData.firstName,
        lastName: body.lastName ?? globalData.lastName,
        phone: body.phone ?? globalData.phone,
        identity: identity ?? globalData.identity,
        tgId: body.tgId ?? globalData.tgId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      const newRef = firestore.collection("global_users").doc();
      userId = newRef.id;
      await newRef.set({
        firstName: body.firstName ?? null,
        lastName: body.lastName ?? null,
        gender: body.gender ?? null,
        birthDate: body.birthDate ?? null,
        photoUrl: body.photoUrl ?? null,
        phone: body.phone ?? null,
        identity,
        primaryChannel: body.primaryChannel ?? "telegram",
        tgId: body.tgId ?? null,
        identities: Object.keys(identities).length > 0 ? identities : null,
        affiliations: [affiliation],
        careerHistory: [],
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const linkId = `${VENUE_ID}_${userId}`;
    const staffRef = firestore.collection("staff").doc(linkId);
    const existingStaff = await staffRef.get();
    if (existingStaff.exists) {
      await staffRef.update({
        position: body.position ?? null,
        group: body.group ?? null,
        call_category: body.call_category ?? null,
        onShift: false,
        active: true,
        assignedTableIds,
        tgId: body.tgId ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      await staffRef.set({
        venueId: VENUE_ID,
        userId,
        role: body.role ?? "waiter",
        primaryChannel: body.primaryChannel ?? "telegram",
        identity,
        onShift: false,
        active: true,
        firstName: body.firstName ?? null,
        lastName: body.lastName ?? null,
        position: body.position ?? null,
        group: body.group ?? null,
        call_category: body.call_category ?? null,
        assignedTableIds,
        tgId: body.tgId ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return NextResponse.json({ ok: true, staffId: linkId });
  } catch (err) {
    console.error("[staff/upsert] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
