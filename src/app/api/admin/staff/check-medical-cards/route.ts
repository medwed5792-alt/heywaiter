export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import type { ServiceRole } from "@/lib/types";
import { LPR_ROLES } from "@/lib/types";

const TELEGRAM_API = "https://api.telegram.org/bot";
const DAYS_THRESHOLD = 15;

async function getLprStaffIdsForVenue(firestore: Firestore, venueId: string): Promise<string[]> {
  const snap = await firestore
    .collection("staff")
    .where("venueId", "==", venueId)
    .where("active", "==", true)
    .get();
  const ids: string[] = [];
  snap.docs.forEach((d) => {
    const data = d.data();
    const role = (data.serviceRole ?? data.position) as ServiceRole | undefined;
    if (role && LPR_ROLES.includes(role)) ids.push(d.id);
  });
  return ids;
}

async function getTelegramIdsForStaff(
  firestore: Firestore,
  staffIds: string[]
): Promise<Set<string>> {
  const tgIds = new Set<string>();
  for (const sid of staffIds) {
    const staffSnap = await firestore.collection("staff").doc(sid).get();
    if (!staffSnap.exists) continue;
    const staffData = staffSnap.data() ?? {};
    const userId = (staffData.userId as string) || sid;
    let tgId: string | null =
      (staffData.tgId as string) ||
      (staffData.identity as { externalId?: string })?.externalId ||
      null;
    const globalSnap = await firestore.collection("global_users").doc(userId).get();
    if (globalSnap.exists) {
      const globalData = globalSnap.data() ?? {};
      const identities = globalData.identities as { tg?: string } | undefined;
      if (identities?.tg) tgId = identities.tg;
    }
    if (tgId && tgId.trim()) tgIds.add(tgId.trim());
  }
  return tgIds;
}

async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram API: ${res.status} ${err}`);
  }
}

/**
 * GET /api/admin/staff/check-medical-cards?venueId=current
 * Проверяет сроки медкнижек: если до окончания <= 15 дней, создаёт NOTIFY_LPR
 * (запись в staffNotifications и отправка в @waitertalk_bot ЛПР заведения).
 * Вызывается при входе в админку (страница Команда) или по крону.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get("venueId")?.trim();
    if (!venueId) {
      return NextResponse.json({ error: "venueId is required" }, { status: 400 });
    }

    const firestore = getAdminFirestore();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const staffSnap = await firestore
      .collection("staff")
      .where("venueId", "==", venueId)
      .where("active", "==", true)
      .get();

    const expiring: { staffId: string; name: string; expiryDate: string; daysLeft: number }[] = [];

    for (const d of staffSnap.docs) {
      const data = d.data();
      const medicalCard = data.medicalCard as { expiryDate?: string | null } | undefined;
      const expiryStr = medicalCard?.expiryDate;
      if (!expiryStr || typeof expiryStr !== "string") continue;

      const expiry = new Date(expiryStr);
      expiry.setHours(0, 0, 0, 0);
      const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
      if (daysLeft > DAYS_THRESHOLD) continue;

      const firstName = data.firstName ?? "";
      const lastName = data.lastName ?? "";
      const name = [firstName, lastName].filter(Boolean).join(" ") || (data.identity as { displayName?: string })?.displayName || d.id;
      expiring.push({ staffId: d.id, name, expiryDate: expiryStr, daysLeft });
    }

    if (expiring.length === 0) {
      return NextResponse.json({ ok: true, venueId, notified: 0, expiring: [] });
    }

    const lprIds = await getLprStaffIdsForVenue(firestore, venueId);
    const tgIds = await getTelegramIdsForStaff(firestore, lprIds);

    const { getBotTokenFromStore } = await import("@/lib/webhook/bots-store");
    const token =
      (await getBotTokenFromStore("telegram", "staff")) ||
      process.env.TELEGRAM_STAFF_TOKEN;

    for (const item of expiring) {
      const daysText =
        item.daysLeft > 0
          ? `через ${item.daysLeft} дн.`
          : item.daysLeft === 0
            ? "сегодня"
            : "истёк";
      const message = `⚠️ Срок медкнижки сотрудника ${item.name} истекает ${daysText} (${item.expiryDate}).`;

      await firestore.collection("staffNotifications").add({
        venueId,
        type: "NOTIFY_LPR",
        subType: "medical_card_expiry",
        message,
        read: false,
        targetUids: lprIds,
        staffId: item.staffId,
        expiryDate: item.expiryDate,
        createdAt: new Date(),
      });

      if (token && tgIds.size > 0) {
        for (const chatId of tgIds) {
          try {
            await sendTelegramMessage(token, chatId, message);
          } catch (err) {
            console.error("[check-medical-cards] Telegram send to", chatId, err);
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      venueId,
      notified: expiring.length,
      expiring: expiring.map((e) => ({ staffId: e.staffId, name: e.name, expiryDate: e.expiryDate, daysLeft: e.daysLeft })),
    });
  } catch (err) {
    console.error("[check-medical-cards] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
