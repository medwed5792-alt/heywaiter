export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { findExistingUserIdByIdentities } from "@/lib/auth-utils";
import type { Affiliation } from "@/lib/types";

/**
 * GET /api/staff/me?venueId=...&telegramId=...
 * Возвращает запись сотрудника для Mini App: userId, staffId, onShift.
 * Поиск: 1) staff по composite id или tgId/userId; 2) global_users по identities.tg (и др. ключам при входе из другого мессенджера); при нахождении — при необходимости создаётся staff и affiliation.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get("venueId")?.trim();
    const telegramId = searchParams.get("telegramId")?.trim();
    const channel = searchParams.get("channel")?.trim() || "tg";

    if (!venueId || !telegramId) {
      return NextResponse.json(
        { error: "venueId и telegramId обязательны" },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();
    const byCompositeId = firestore.collection("staff").doc(`${venueId}_${telegramId}`);
    let snap = await byCompositeId.get();

    if (!snap.exists) {
      const byTg = await firestore
        .collection("staff")
        .where("venueId", "==", venueId)
        .where("tgId", "==", telegramId)
        .limit(1)
        .get();
      if (!byTg.empty) {
        snap = byTg.docs[0];
      } else {
        const byUserId = await firestore
          .collection("staff")
          .where("venueId", "==", venueId)
          .where("userId", "==", telegramId)
          .limit(1)
          .get();
        if (!byUserId.empty) {
          snap = byUserId.docs[0];
        }
      }
    }

    if (!snap.exists) {
      const identityKey = channel === "wa" ? "wa" : channel === "vk" ? "vk" : "tg";
      const foundUserId = await findExistingUserIdByIdentities(
        identityKey === "tg" ? { tg: telegramId } : identityKey === "wa" ? { wa: telegramId } : { vk: telegramId }
      );
      if (foundUserId) {
        const staffDocId = `${venueId}_${foundUserId}`;
        const staffRef = firestore.collection("staff").doc(staffDocId);
        let staffSnap = await staffRef.get();
        if (!staffSnap.exists) {
          const globalRef = firestore.collection("global_users").doc(foundUserId);
          const globalSnap = await globalRef.get();
          const globalData = globalSnap.data() ?? {};
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
            primaryChannel: "telegram",
            identity: globalData.identity ?? { channel: "telegram", externalId: telegramId, locale: "ru" },
            onShift: false,
            active: true,
            tgId: telegramId,
            firstName: globalData.firstName ?? null,
            lastName: globalData.lastName ?? null,
            updatedAt: new Date(),
          });
          staffSnap = await staffRef.get();
        }
        if (staffSnap.exists) {
          snap = staffSnap;
        }
      }
    }

    if (!snap.exists) {
      return NextResponse.json(
        { error: "Сотрудник не найден для этого заведения" },
        { status: 404 }
      );
    }

    const id = snap.id;
    const d = snap.data() ?? {};
    const userId = (d.userId as string) || (d.tgId as string) || telegramId;
    const resolvedVenueId = (d.venueId as string) ?? venueId;

    // onShift только из venues/venueId/staff (единая точка с Дашбордом)
    let onShift = false;
    let shiftStartTime: string | null = null;
    let shiftEndTime: string | null = null;
    // onShift только из venues/venueId/staff/[userId]
    const venueStaffSnap = await firestore
      .collection("venues")
      .doc(resolvedVenueId)
      .collection("staff")
      .doc(userId)
      .get();
    if (venueStaffSnap.exists) {
      const vd = venueStaffSnap.data() ?? {};
      onShift = vd.onShift === true;
      shiftStartTime = (vd.shiftStartTime as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? null;
      shiftEndTime = (vd.shiftEndTime as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? null;
    }

    return NextResponse.json({
      userId,
      staffId: id,
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
