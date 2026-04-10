export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { requireSuperAdmin } from "@/lib/superadmin-guard";
import { parseCanonicalStaffDocId } from "@/lib/identity/global-user-staff-bridge";

function cleanPhone(value: string | undefined | null): string {
  if (value == null || typeof value !== "string") return "";
  return value.replace(/\D/g, "");
}

async function deleteVenueStaffForUser(
  firestore: ReturnType<typeof getAdminFirestore>,
  userId: string,
  data: Record<string, unknown>
): Promise<string[]> {
  const deleted: string[] = [];
  const venueSet = new Set<string>();
  for (const a of Array.isArray(data.affiliations) ? data.affiliations : []) {
    const vid = (a as { venueId?: string })?.venueId;
    if (vid) venueSet.add(vid);
  }
  for (const v of Array.isArray(data.staffVenueActive) ? data.staffVenueActive : []) {
    if (typeof v === "string" && v.trim()) venueSet.add(v.trim());
  }
  for (const vid of venueSet) {
    const canonical = `${vid}_${userId}`;
    const ref = firestore.collection("venues").doc(vid).collection("staff").doc(canonical);
    const s = await ref.get();
    if (s.exists) {
      await ref.delete();
      deleted.push(`${vid}/${canonical}`);
    }
  }
  for (const lid of Array.isArray(data.staffLookupIds) ? data.staffLookupIds : []) {
    if (typeof lid !== "string") continue;
    const p = parseCanonicalStaffDocId(lid);
    if (!p) continue;
    const ref = firestore.collection("venues").doc(p.venueId).collection("staff").doc(lid);
    const s = await ref.get();
    if (s.exists) {
      await ref.delete();
      deleted.push(`${p.venueId}/${lid}`);
    }
  }
  return deleted;
}

/**
 * POST /api/super/cleanup-onboarding
 * Удаляет global_users по tg/phone и связанные документы venues/.../staff (без корневой staff).
 */
export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    const tgId = typeof body.tgId === "string" ? body.tgId.trim() : "";
    const phoneRaw = typeof body.phone === "string" ? body.phone.trim() : "";
    const phoneNorm = cleanPhone(phoneRaw);

    if (!tgId && !phoneNorm) {
      return NextResponse.json(
        { error: "Укажите tgId и/или phone в теле запроса" },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();
    const userIds = new Set<string>();

    if (tgId) {
      const byTg = await firestore
        .collection("global_users")
        .where("identities.tg", "==", tgId)
        .get();
      byTg.docs.forEach((d) => userIds.add(d.id));
    }

    if (phoneNorm) {
      const byIdentitiesPhone = await firestore
        .collection("global_users")
        .where("identities.phone", "==", phoneNorm)
        .get();
      byIdentitiesPhone.docs.forEach((d) => userIds.add(d.id));
    }

    if (phoneNorm) {
      const byPhone = await firestore
        .collection("global_users")
        .where("phone", "==", phoneNorm)
        .get();
      byPhone.docs.forEach((d) => userIds.add(d.id));
    }

    const deletedGlobalUsers: string[] = [];
    const deletedVenueStaff: string[] = [];

    for (const userId of userIds) {
      const globalRef = firestore.collection("global_users").doc(userId);
      const snap = await globalRef.get();
      if (snap.exists) {
        const d = snap.data() ?? {};
        const vs = await deleteVenueStaffForUser(firestore, userId, d);
        deletedVenueStaff.push(...vs);
        await globalRef.delete();
        deletedGlobalUsers.push(userId);
      }
    }

    return NextResponse.json({
      ok: true,
      deleted: {
        globalUsers: deletedGlobalUsers,
        venueStaff: deletedVenueStaff,
      },
      message:
        deletedGlobalUsers.length > 0
          ? "Данные удалены. Можно снова пройти онбординг в боте."
          : "Совпадений не найдено (база уже чиста или указаны неверные tgId/phone).",
    });
  } catch (err) {
    console.error("[super/cleanup-onboarding] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
