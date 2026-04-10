export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import type { DocumentReference } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { findExistingUserIdByIdentities, findUserIdByIdentityKey } from "@/lib/auth-utils";
import type { Affiliation, UnifiedIdentities } from "@/lib/types";
import { DEFAULT_VENUE_ID as VENUE_ID } from "@/lib/standards/venue-default";
import { sanitizeAssignedTableIdsForVenue } from "@/lib/standards/assigned-tables";
import {
  parseCanonicalStaffDocId,
  resolveStaffFirestoreIdToGlobalUser,
} from "@/lib/identity/global-user-staff-bridge";

/** Синхронизирует назначение столов: в venues/VENUE_ID/tables у каждого выбранного стола — assignments.waiter = staffDocId; у снятых — удаляем waiter. */
async function syncTableAssignments(
  firestore: ReturnType<typeof getAdminFirestore>,
  staffDocId: string,
  assignedTableIds: string[],
  previousAssignedTableIds: string[]
): Promise<void> {
  const tablesRef = firestore.collection("venues").doc(VENUE_ID).collection("tables");
  const toAssign = new Set(assignedTableIds);
  const toClear = previousAssignedTableIds.filter((id) => !toAssign.has(id));

  const refsToClear: DocumentReference[] = [];
  for (const tableId of toClear) {
    const ref = tablesRef.doc(tableId);
    const snap = await ref.get();
    const waiter = (snap.data()?.assignments as { waiter?: string } | undefined)?.waiter;
    if (waiter === staffDocId) refsToClear.push(ref);
  }

  const BATCH_MAX = 450;
  const writes: Array<{ ref: DocumentReference; type: "set" | "update" }> = [];
  for (const tableId of assignedTableIds) {
    writes.push({ ref: tablesRef.doc(tableId), type: "set" });
  }
  for (const ref of refsToClear) {
    writes.push({ ref, type: "update" });
  }

  for (let i = 0; i < writes.length; i += BATCH_MAX) {
    const batch = firestore.batch();
    const chunk = writes.slice(i, i + BATCH_MAX);
    for (const w of chunk) {
      if (w.type === "set") {
        batch.set(
          w.ref,
          { assignments: { waiter: staffDocId }, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      } else {
        batch.update(w.ref, {
          "assignments.waiter": FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
    await batch.commit();
  }
}

function cleanPhone(value: string | undefined | null): string {
  if (value == null || typeof value !== "string") return "";
  return value.replace(/\D/g, "");
}

function normalizeMedicalCard(
  card: { expiryDate?: string | null; lastChecked?: string | null; notes?: string } | undefined | null
): typeof card {
  if (card == null) return card;
  const exp = card.expiryDate;
  const iso =
    exp && String(exp).trim() ? new Date(exp).toISOString().slice(0, 10) : null;
  return { ...card, expiryDate: iso, lastChecked: card.lastChecked ?? null };
}

function nextSystemRoleForStaff(current: unknown): "STAFF" | "ADMIN" {
  const u = String(current ?? "").toUpperCase();
  if (u === "ADMIN") return "ADMIN";
  return "STAFF";
}

async function resolveUserIdFromStaffId(
  firestore: ReturnType<typeof getAdminFirestore>,
  staffId: string
): Promise<string | null> {
  const sid = staffId.trim();
  const parsed = parseCanonicalStaffDocId(sid);
  if (parsed) return parsed.globalUserId;
  const r = await resolveStaffFirestoreIdToGlobalUser(firestore, sid, VENUE_ID);
  return r?.globalUserId ?? null;
}

/**
 * POST /api/admin/staff/upsert
 * ЛПР: создание или обновление сотрудника в global_users + venues/{venue}/staff (без корневой staff).
 * Гость с существующим global_users: тот же документ получает affiliation и systemRole STAFF — дубликат не создаётся.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const staffId = body.staffId as string | undefined;

    const identity = body.identity ?? {
      channel: "telegram",
      externalId: body.tgId ?? "",
      locale: "ru",
      displayName: [body.firstName, body.lastName].filter(Boolean).join(" "),
    };

    const phoneCleaned = cleanPhone(body.phone);
    const medicalCardNormalized = normalizeMedicalCard(body.medicalCard);

    const firestore = getAdminFirestore();

    const tablesSnap = await firestore.collection("venues").doc(VENUE_ID).collection("tables").get();
    const allowedTableDocIds = new Set(tablesSnap.docs.map((d) => d.id));
    const assignedTableIds = sanitizeAssignedTableIdsForVenue(body.assignedTableIds, allowedTableDocIds);

    const canonicalStaffDocIdFor = (uid: string) => `${VENUE_ID}_${uid}`;

    if (staffId) {
      const userId = await resolveUserIdFromStaffId(firestore, staffId);
      if (!userId) {
        return NextResponse.json({ error: "Staff not found" }, { status: 404 });
      }

      const canonicalStaffDocId = canonicalStaffDocIdFor(userId);
      const globalRef = firestore.collection("global_users").doc(userId);
      const globalSnap = await globalRef.get();
      if (!globalSnap.exists) {
        return NextResponse.json({ error: "Staff not found" }, { status: 404 });
      }

      const globalData = globalSnap.data() ?? {};
      const affiliations: Affiliation[] = Array.isArray(globalData.affiliations) ? [...globalData.affiliations] : [];
      const idx = affiliations.findIndex((a: { venueId: string }) => a.venueId === VENUE_ID);
      const previousAssignedTableIds =
        (idx >= 0 && Array.isArray((affiliations[idx] as Affiliation)?.assignedTableIds)
          ? (affiliations[idx] as Affiliation).assignedTableIds
          : null) ?? [];

      const venueStaffLegacy = await firestore
        .collection("venues")
        .doc(VENUE_ID)
        .collection("staff")
        .doc(staffId.trim())
        .get();
      const venueStaffCanonical = await firestore
        .collection("venues")
        .doc(VENUE_ID)
        .collection("staff")
        .doc(canonicalStaffDocId)
        .get();
      const mirror =
        (venueStaffLegacy.exists ? venueStaffLegacy.data() : null) ??
        (venueStaffCanonical.exists ? venueStaffCanonical.data() : null) ??
        {};

      const profilePayload: Record<string, unknown> = {
        firstName: body.firstName ?? globalData.firstName ?? mirror.firstName ?? null,
        lastName: body.lastName ?? globalData.lastName ?? mirror.lastName ?? null,
        gender: body.gender ?? globalData.gender ?? mirror.gender ?? null,
        birthDate: body.birthDate ?? globalData.birthDate ?? mirror.birthDate ?? null,
        photoUrl: body.photoUrl ?? globalData.photoUrl ?? mirror.photoUrl ?? null,
        phone:
          body.phone != null && String(body.phone).trim()
            ? phoneCleaned || null
            : ((globalData.phone as string) ?? cleanPhone(mirror.phone as string)) || null,
        identity: body.identity ?? globalData.identity ?? mirror.identity ?? identity,
        primaryChannel: body.primaryChannel ?? globalData.primaryChannel ?? mirror.primaryChannel ?? "telegram",
        tgId: body.tgId ?? globalData.tgId ?? mirror.tgId ?? null,
        guestRating: body.guestRating ?? globalData.guestRating ?? mirror.guestRating ?? null,
        venueRating: body.venueRating ?? globalData.venueRating ?? mirror.venueRating ?? null,
        systemRole: nextSystemRoleForStaff(globalData.systemRole),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (body.globalScore != null) profilePayload.globalScore = body.globalScore;
      if (medicalCardNormalized != null) profilePayload.medicalCard = medicalCardNormalized;

      const identitiesUpdate: UnifiedIdentities =
        typeof body.identities === "object" && body.identities !== null
          ? { ...(globalData.identities as UnifiedIdentities | undefined), ...body.identities }
          : {
              ...(globalData.identities as UnifiedIdentities | undefined),
              ...(body.tgId && { tg: String(body.tgId).trim() }),
              ...(body.email && { email: String(body.email).trim() }),
              ...(body.phone && { phone: String(body.phone).trim() }),
            };
      if (body.phone != null && String(body.phone).trim()) {
        identitiesUpdate.phone = phoneCleaned || String(body.phone).replace(/\D/g, "");
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
              {
                error: "Дубликат",
                duplicateWarning: `Этот ${key === "tg" ? "Telegram ID" : key === "wa" ? "WhatsApp" : key === "vk" ? "VK" : key} уже привязан к другому сотруднику.`,
              },
              { status: 409 }
            );
          }
        }
        profilePayload.identities = identitiesFiltered;
      }

      const roleVal = body.position ?? body.role ?? (idx >= 0 ? affiliations[idx]?.role : null) ?? "waiter";
      const affPayload: Affiliation = {
        venueId: VENUE_ID,
        role: roleVal,
        status: (idx >= 0 ? affiliations[idx]?.status : "active") ?? "active",
        position: body.position ?? (idx >= 0 ? affiliations[idx]?.position : undefined),
        onShift: body.onShift ?? (idx >= 0 ? affiliations[idx]?.onShift : false) ?? false,
        assignedTableIds,
        staffFirestoreId: canonicalStaffDocId,
      };
      if (idx >= 0) affiliations[idx] = affPayload;
      else affiliations.push(affPayload);

      const prevLookup: string[] = Array.isArray(globalData.staffLookupIds) ? globalData.staffLookupIds : [];
      const lookupSet = new Set([...prevLookup, canonicalStaffDocId, staffId.trim()].filter(Boolean));

      const prevActive: string[] = Array.isArray(globalData.staffVenueActive) ? globalData.staffVenueActive : [];
      const activeVenues = new Set(prevActive);
      if (body.active !== false) activeVenues.add(VENUE_ID);

      await globalRef.set(
        {
          ...profilePayload,
          affiliations,
          staffLookupIds: [...lookupSet],
          staffVenueActive: [...activeVenues],
          staffVenueOnShift: Array.isArray(globalData.staffVenueOnShift) ? globalData.staffVenueOnShift : [],
        },
        { merge: true }
      );

      const staffPhone = (profilePayload.phone as string) ?? null;
      const venueStaffRef = firestore.collection("venues").doc(VENUE_ID).collection("staff").doc(canonicalStaffDocId);
      await venueStaffRef.set(
        {
          venueId: VENUE_ID,
          userId,
          role: body.role ?? roleVal ?? "waiter",
          position: body.position ?? null,
          group: body.group ?? mirror.group ?? null,
          call_category: body.call_category ?? mirror.call_category ?? null,
          onShift: body.onShift ?? mirror.onShift ?? false,
          active: body.active !== false,
          assignedTableIds,
          tgId: body.tgId ?? mirror.tgId ?? null,
          phone: staffPhone,
          firstName: profilePayload.firstName ?? null,
          lastName: profilePayload.lastName ?? null,
          identity: profilePayload.identity ?? null,
          updatedAt: FieldValue.serverTimestamp(),
          ...(medicalCardNormalized != null && { medicalCard: medicalCardNormalized }),
        },
        { merge: true }
      );

      if (staffId.trim() !== canonicalStaffDocId) {
        const legacyRef = firestore.collection("venues").doc(VENUE_ID).collection("staff").doc(staffId.trim());
        const leg = await legacyRef.get();
        if (leg.exists) {
          await legacyRef.delete().catch(() => undefined);
        }
      }

      await syncTableAssignments(firestore, canonicalStaffDocId, assignedTableIds, previousAssignedTableIds);

      return NextResponse.json({
        ok: true,
        staffId: canonicalStaffDocId,
        userId,
        role: roleVal ?? "waiter",
        firstName: profilePayload.firstName ?? null,
        lastName: profilePayload.lastName ?? null,
      });
    }

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

    const roleForAff = body.position ?? body.role ?? "waiter";
    const affiliation: Affiliation = {
      venueId: VENUE_ID,
      role: roleForAff,
      status: "active",
      position: body.position ?? undefined,
      onShift: false,
      assignedTableIds,
      staffFirestoreId: "",
    };

    let userId: string;

    if (existingUserId) {
      userId = existingUserId;
      const globalRef = firestore.collection("global_users").doc(userId);
      const globalSnap = await globalRef.get();
      const globalData = globalSnap.data() ?? {};
      const affiliations: Affiliation[] = Array.isArray(globalData.affiliations) ? [...globalData.affiliations] : [];
      const idx = affiliations.findIndex((a: { venueId: string }) => a.venueId === VENUE_ID);
      const linkId = canonicalStaffDocIdFor(userId);
      affiliation.staffFirestoreId = linkId;

      const mergedIdentities: UnifiedIdentities = {
        ...(globalData.identities as UnifiedIdentities | undefined),
        ...identities,
      };
      if (idx >= 0) {
        affiliations[idx] = { ...affiliations[idx], ...affiliation };
      } else {
        affiliations.push(affiliation);
      }

      const prevLookup: string[] = Array.isArray(globalData.staffLookupIds) ? globalData.staffLookupIds : [];
      const prevActive: string[] = Array.isArray(globalData.staffVenueActive) ? globalData.staffVenueActive : [];
      const prevOnShift: string[] = Array.isArray(globalData.staffVenueOnShift) ? globalData.staffVenueOnShift : [];

      await globalRef.set(
        {
          identities: mergedIdentities,
          affiliations,
          firstName: body.firstName ?? globalData.firstName ?? null,
          lastName: body.lastName ?? globalData.lastName ?? null,
          phone: phoneCleaned || (globalData.phone as string) || null,
          identity: identity ?? globalData.identity ?? null,
          tgId: body.tgId ?? globalData.tgId ?? null,
          systemRole: nextSystemRoleForStaff(globalData.systemRole),
          staffLookupIds: [...new Set([...prevLookup, linkId])],
          staffVenueActive: [...new Set([...prevActive, VENUE_ID])],
          staffVenueOnShift: prevOnShift,
          updatedAt: FieldValue.serverTimestamp(),
          ...(medicalCardNormalized != null && { medicalCard: medicalCardNormalized }),
        },
        { merge: true }
      );
    } else {
      const newRef = firestore.collection("global_users").doc();
      userId = newRef.id;
      const linkId = canonicalStaffDocIdFor(userId);
      affiliation.staffFirestoreId = linkId;
      await newRef.set({
        systemRole: "STAFF",
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
        staffLookupIds: [linkId],
        staffVenueActive: [VENUE_ID],
        staffVenueOnShift: [],
        careerHistory: [],
        ...(medicalCardNormalized != null && { medicalCard: medicalCardNormalized }),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const linkId = canonicalStaffDocIdFor(userId);
    await firestore
      .collection("venues")
      .doc(VENUE_ID)
      .collection("staff")
      .doc(linkId)
      .set(
        {
          venueId: VENUE_ID,
          userId,
          role: body.role ?? roleForAff,
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
          phone: phoneCleaned || null,
          ...(medicalCardNormalized != null && { medicalCard: medicalCardNormalized }),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    await syncTableAssignments(firestore, linkId, assignedTableIds, []);
    return NextResponse.json({
      ok: true,
      staffId: linkId,
      userId,
      role: roleForAff,
      firstName: body.firstName ?? null,
      lastName: body.lastName ?? null,
    });
  } catch (err) {
    console.error("[staff/upsert] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
