export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";

/**
 * Нормализация телефона: только цифры (без +, скобок, пробелов).
 */
function cleanPhone(value: string | undefined | null): string {
  if (value == null || typeof value !== "string") return "";
  return value.replace(/\D/g, "");
}

/**
 * POST /api/super/cleanup-onboarding
 * Очистка данных для повторного теста онбординга сотрудника.
 * Тело: { tgId?: string, phone?: string }
 * - Находит в global_users ВСЕ документы, где identities.tg == tgId ИЛИ phone/identities.phone == phone.
 * - Удаляет эти документы из global_users.
 * - В корневой коллекции staff удаляет все документы с userId из удалённых.
 * - В venues/[venueId]/staff удаляет документы с соответствующим staffId.
 * Возвращает: { ok: true, deleted: { globalUsers: string[], staff: string[], venueStaff: string[] } }
 */
export async function POST(request: NextRequest) {
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

    // 1) Найти все global_users по identities.tg
    if (tgId) {
      const byTg = await firestore
        .collection("global_users")
        .where("identities.tg", "==", tgId)
        .get();
      byTg.docs.forEach((d) => userIds.add(d.id));
    }

    // 2) По identities.phone (нормализованный)
    if (phoneNorm) {
      const byIdentitiesPhone = await firestore
        .collection("global_users")
        .where("identities.phone", "==", phoneNorm)
        .get();
      byIdentitiesPhone.docs.forEach((d) => userIds.add(d.id));
    }

    // 3) По верхнему полю phone (нормализованный)
    if (phoneNorm) {
      const byPhone = await firestore
        .collection("global_users")
        .where("phone", "==", phoneNorm)
        .get();
      byPhone.docs.forEach((d) => userIds.add(d.id));
    }

    const deletedGlobalUsers: string[] = [];
    const deletedStaff: string[] = [];
    const deletedVenueStaff: string[] = [];

    for (const userId of userIds) {
      const globalRef = firestore.collection("global_users").doc(userId);
      const snap = await globalRef.get();
      if (snap.exists) {
        await globalRef.delete();
        deletedGlobalUsers.push(userId);
      }
    }

    // Удалить все документы staff, где userId в списке удалённых
    const staffSnap = await firestore.collection("staff").get();
    for (const d of staffSnap.docs) {
      const data = d.data();
      const uid = (data.userId as string) || "";
      if (userIds.has(uid)) {
        const staffId = d.id;
        const venueId = (data.venueId as string) || "";
        await d.ref.delete();
        deletedStaff.push(staffId);
        if (venueId) {
          const venueStaffRef = firestore
            .collection("venues")
            .doc(venueId)
            .collection("staff")
            .doc(staffId);
          const vs = await venueStaffRef.get();
          if (vs.exists) {
            await venueStaffRef.delete();
            deletedVenueStaff.push(`${venueId}/${staffId}`);
          }
        }
      }
    }

    // Дополнительно: удалить из staff по tgId или phone (на случай если userId не совпал)
    const staffByTg = tgId
      ? await firestore.collection("staff").where("tgId", "==", tgId).get()
      : { docs: [] };
    const staffByPhone = phoneNorm
      ? await firestore.collection("staff").where("phone", "==", phoneNorm).get()
      : { docs: [] };

    for (const d of [...staffByTg.docs, ...staffByPhone.docs]) {
      if (deletedStaff.includes(d.id)) continue;
      const data = d.data();
      const venueId = (data.venueId as string) || "";
      await d.ref.delete();
      deletedStaff.push(d.id);
      if (venueId) {
        const venueStaffRef = firestore
          .collection("venues")
          .doc(venueId)
          .collection("staff")
          .doc(d.id);
        const vs = await venueStaffRef.get();
        if (vs.exists) {
          await venueStaffRef.delete();
          deletedVenueStaff.push(`${venueId}/${d.id}`);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      deleted: {
        globalUsers: deletedGlobalUsers,
        staff: deletedStaff,
        venueStaff: deletedVenueStaff,
      },
      message:
        deletedGlobalUsers.length > 0 || deletedStaff.length > 0
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
