export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { findExistingUserIdByIdentities, findUserIdByIdentityKey } from "@/lib/auth-utils";
import type { Affiliation, UnifiedIdentities } from "@/lib/types";

const VENUE_ID = "venue_andrey_alt";

/** Номер телефона в БД — только цифры (без +, скобок, пробелов). */
function cleanPhone(value: string | undefined | null): string {
  if (value == null || typeof value !== "string") return "";
  return value.replace(/\D/g, "");
}

/** Нормализует медкнижку: expiryDate в формате ISO date (YYYY-MM-DD) для корректной проверки за 15 дней. */
function normalizeMedicalCard(
  card: { expiryDate?: string | null; lastChecked?: string | null; notes?: string } | undefined | null
): typeof card {
  if (card == null) return card;
  const exp = card.expiryDate;
  const iso =
    exp && String(exp).trim()
      ? new Date(exp).toISOString().slice(0, 10)
      : null;
  return { ...card, expiryDate: iso, lastChecked: card.lastChecked ?? null };
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

    const phoneCleaned = cleanPhone(body.phone);
    const medicalCardNormalized = normalizeMedicalCard(body.medicalCard);

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
        phone: (body.phone != null && String(body.phone).trim() ? phoneCleaned || null : (staffData.phone as string) ?? null),
        identity: body.identity ?? staffData.identity ?? identity,
        primaryChannel: body.primaryChannel ?? staffData.primaryChannel ?? "telegram",
        tgId: body.tgId ?? staffData.tgId ?? null,
        guestRating: body.guestRating ?? staffData.guestRating ?? null,
        venueRating: body.venueRating ?? staffData.venueRating ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (body.globalScore != null) profilePayload.globalScore = body.globalScore;
      if (medicalCardNormalized != null) profilePayload.medicalCard = medicalCardNormalized;
      const identitiesUpdate: UnifiedIdentities =
        typeof body.identities === "object" && body.identities !== null
          ? { ...(staffData.identities as UnifiedIdentities | undefined), ...body.identities }
          : {
              ...(staffData.identities as UnifiedIdentities | undefined),
              ...(body.tgId && { tg: String(body.tgId).trim() }),
              ...(body.email && { email: String(body.email).trim() }),
              ...(body.phone && { phone: String(body.phone).trim() }),
            };
      if (body.phone != null && String(body.phone).trim()) {
        identitiesUpdate.phone = String(body.phone).trim();
      }
      const identitiesFiltered: UnifiedIdentities = {};
      for (const [k, v] of Object.entries(identitiesUpdate)) {
        if (v && typeof v === "string" && v.trim()) {
          const val = k === "phone" ? phoneCleaned || v.replace(/\D/g, "") : v.trim();
          if (val) identitiesFiltered[k as keyof UnifiedIdentities] = val;
        }
      }
      if (Object.keys(identitiesFiltered).length > 0) {
        for (const key of Object.keys(identitiesFiltered) as (keyof UnifiedIdentities)[]) {
          const other = await findUserIdByIdentityKey(key, identitiesFiltered[key]!, userId);
          if (other) {
            return NextResponse.json(
              { error: "Дубликат", duplicateWarning: `Этот ${key === "tg" ? "Telegram ID" : key === "wa" ? "WhatsApp" : key === "vk" ? "VK" : key} уже привязан к другому сотруднику.` },
              { status: 409 }
            );
          }
        }
        profilePayload.identities = identitiesFiltered;
      }

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
          identities: profilePayload.identities ?? (Object.keys(identitiesFiltered).length > 0 ? identitiesFiltered : undefined),
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

      const staffPhone = (profilePayload.phone as string) ?? (staffData.phone as string) ?? null;
      await staffRef.update({
        position: body.position ?? staffData.position,
        group: body.group ?? staffData.group,
        call_category: body.call_category ?? staffData.call_category,
        onShift: body.onShift ?? staffData.onShift,
        assignedTableIds,
        phone: staffPhone,
        updatedAt: FieldValue.serverTimestamp(),
        ...(body.role != null && { role: body.role }),
        ...(body.active != null && { active: body.active }),
        ...(medicalCardNormalized != null && { medicalCard: medicalCardNormalized }),
      });

      const venueStaffRef = firestore.collection("venues").doc(VENUE_ID).collection("staff").doc(staffId);
      await venueStaffRef.set(
        { ...(staffPhone != null && { phone: staffPhone }), updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );

      return NextResponse.json({ ok: true, staffId });
    }

    // Создание: поиск по identities (Единый профиль), затем создание или привязка
    const identities: UnifiedIdentities =
      typeof body.identities === "object" && body.identities !== null
        ? (Object.fromEntries(
            Object.entries(body.identities)
              .filter(([, v]) => v && typeof v === "string" && String(v).trim())
              .map(([k, v]) => [k, k === "phone" ? cleanPhone(String(v)) : String(v).trim()])
              .filter(([, v]) => v !== "")
          ) as UnifiedIdentities)
        : (() => {
            const out: UnifiedIdentities = {};
            if (body.tgId && String(body.tgId).trim()) out.tg = String(body.tgId).trim();
            if (body.email && String(body.email).trim()) out.email = String(body.email).trim();
            if (phoneCleaned) out.phone = phoneCleaned;
            return out;
          })();

    let existingUserId: string | null = null;
    if (Object.keys(identities).length > 0) {
      existingUserId = await findExistingUserIdByIdentities(identities);
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
        phone: (phoneCleaned || globalData.phone) ?? null,
        identity: identity ?? globalData.identity,
        tgId: body.tgId ?? globalData.tgId,
        updatedAt: FieldValue.serverTimestamp(),
        ...(medicalCardNormalized != null && { medicalCard: medicalCardNormalized }),
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
        phone: phoneCleaned || null,
        identity,
        primaryChannel: body.primaryChannel ?? "telegram",
        tgId: body.tgId ?? null,
        identities: Object.keys(identities).length > 0 ? identities : null,
        affiliations: [affiliation],
        careerHistory: [],
        ...(medicalCardNormalized != null && { medicalCard: medicalCardNormalized }),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const linkId = `${VENUE_ID}_${userId}`;
    const staffRef = firestore.collection("staff").doc(linkId);
    const existingStaff = await staffRef.get();
    if (existingStaff.exists) {
      // Сотрудник уже есть в коллекции staff для этого venue — обновляем, не создаём дубликат
      await staffRef.update({
        position: body.position ?? null,
        group: body.group ?? null,
        call_category: body.call_category ?? null,
        onShift: false,
        active: true,
        assignedTableIds,
        tgId: body.tgId ?? null,
        ...(medicalCardNormalized != null && { medicalCard: medicalCardNormalized }),
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
        ...(medicalCardNormalized != null && { medicalCard: medicalCardNormalized }),
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
