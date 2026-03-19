export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { findExistingUserIdByIdentities } from "@/lib/auth-utils";

/**
 * GET /api/staff/me?venueId=...&telegramId=...
 * Возвращает запись сотрудника для Mini App: userId, staffId, onShift.
 * Поиск: 1) staff по composite id или tgId/userId; 2) global_users по identities.tg (и др. ключам при входе из другого мессенджера).
 * Если staff документа нет — не создаём новые записи (чтобы не плодить клонов).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    // Для синхронизации с админкой используем строго один venue.
    const requestedVenueId = searchParams.get("venueId")?.trim();
    const venueId = "venue_andrey_alt";
    const telegramId = searchParams.get("telegramId")?.trim();
    const channel = searchParams.get("channel")?.trim() || "tg";

    // requestedVenueId намеренно игнорируем.
    if (!telegramId) {
      return NextResponse.json(
        { error: "telegramId обязателен" },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();

    // 1) Global Profile: ищем глобальный userId по Telegram ID в global_users.identities.tg
    const foundGlobalUserId = await findExistingUserIdByIdentities({ tg: telegramId });
    if (!foundGlobalUserId) {
      return NextResponse.json(
        {
          error: `Ваш Telegram ID [${telegramId}] не найден в системе SaaS. Обратитесь к супер-админу`,
        },
        { status: 404 }
      );
    }

    const globalUserRef = firestore.collection("global_users").doc(foundGlobalUserId);
    const globalUserSnap = await globalUserRef.get();
    const globalData = globalUserSnap.data() ?? {};

    // 2) Venue Access: проверяем наличие привязки к venue_andrey_alt в профиле (affiliations)
    const affiliations = Array.isArray(globalData.affiliations) ? globalData.affiliations : [];
    const hasVenueByAffiliation = affiliations.some(
      (a: { venueId?: string; status?: string }) =>
        a?.venueId === venueId && a?.status !== "former"
    );

    // Дополнительно (совместимость): иногда может существовать документ venues/.../staff/{tgId}
    const venueStaffByTgSnap = await firestore
      .collection("venues")
      .doc(venueId)
      .collection("staff")
      .doc(telegramId)
      .get();

    if (!hasVenueByAffiliation && !venueStaffByTgSnap.exists) {
      return NextResponse.json(
        { error: "Сотрудник не найден для этого заведения" },
        { status: 404 }
      );
    }

    // 3) Локальная запись сотрудника (root staff doc для этого venue)
    // Ищем staff в корневой коллекции по venueId + userId (global user id),
    // т.к. именно этот staffId дальше используется для onShift в venues/.../staff/{staffId}.
    let staffSnap = await firestore
      .collection("staff")
      .where("venueId", "==", venueId)
      .where("userId", "==", foundGlobalUserId)
      .limit(1)
      .get();

    // Фолбэк на совместимость со старым полем tgId
    if (staffSnap.empty) {
      staffSnap = await firestore
        .collection("staff")
        .where("venueId", "==", venueId)
        .where("tgId", "==", telegramId)
        .limit(1)
        .get();
    }

    if (staffSnap.empty) {
      return NextResponse.json(
        { error: "Сотрудник не найден для этого заведения" },
        { status: 404 }
      );
    }

    const staffDoc = staffSnap.docs[0];
    const staffDocId = staffDoc.id;
    const staffData = staffDoc.data() ?? {};
    const userId = (staffData.userId as string | undefined) ?? foundGlobalUserId;

    // 4) onShift читается ТОЛЬКО из venues/venue_andrey_alt/staff/[staffDocId]
    const resolvedVenueId = venueId;
    let onShift = false;
    let shiftStartTime: string | null = null;
    let shiftEndTime: string | null = null;

    const venueStaffSnap = await firestore
      .collection("venues")
      .doc(resolvedVenueId)
      .collection("staff")
      .doc(staffDocId)
      .get();

    if (venueStaffSnap.exists) {
      const vd = venueStaffSnap.data() ?? {};
      onShift = vd.onShift === true;
      shiftStartTime = (vd.shiftStartTime as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? null;
      shiftEndTime = (vd.shiftEndTime as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? null;
    }

    return NextResponse.json({
      userId,
      staffId: staffDocId,
      venueId: resolvedVenueId,
      onShift,
      shiftStartTime,
      shiftEndTime,
    });
  } catch (err) {
    console.error("[staff/me]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}
