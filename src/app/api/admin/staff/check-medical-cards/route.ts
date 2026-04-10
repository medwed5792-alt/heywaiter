export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import type { ServiceRole } from "@/lib/types";
import { LPR_ROLES } from "@/lib/types";
import { getTelegramIdsForStaffIds } from "@/lib/notifications/staff-notify-helpers";

const TELEGRAM_API = "https://api.telegram.org/bot";
const DAYS_THRESHOLD = 15;

async function getLprStaffIdsForVenue(firestore: Firestore, venueId: string): Promise<string[]> {
  const vid = venueId.trim();
  if (!vid) return [];
  const snap = await firestore
    .collection("global_users")
    .where("staffVenueActive", "array-contains", vid)
    .get();
  const ids: string[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    const aff = Array.isArray(data.affiliations) ? data.affiliations : [];
    const row = aff.find((a: { venueId?: string }) => a?.venueId === vid);
    const role = (row?.role as string) ?? (row?.position as string) ?? "";
    if (role && LPR_ROLES.includes(role as ServiceRole)) ids.push(`${vid}_${d.id}`);
  }
  return ids;
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
 * Медкнижки читаются из global_users (staffVenueActive + medicalCard).
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
      .collection("global_users")
      .where("staffVenueActive", "array-contains", venueId)
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

      const firstName = (data.firstName as string) ?? "";
      const lastName = (data.lastName as string) ?? "";
      const name =
        [firstName, lastName].filter(Boolean).join(" ") ||
        ((data.identity as { displayName?: string })?.displayName as string) ||
        d.id;
      const staffDocId = `${venueId}_${d.id}`;
      expiring.push({ staffId: staffDocId, name, expiryDate: expiryStr, daysLeft });
    }

    if (expiring.length === 0) {
      return NextResponse.json({ ok: true, venueId, notified: 0, expiring: [] });
    }

    const lprIds = await getLprStaffIdsForVenue(firestore, venueId);
    const tgIds = await getTelegramIdsForStaffIds(firestore, venueId, lprIds);

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
      const message = `\u26a0\ufe0f Срок медкнижки сотрудника ${item.name} истекает ${daysText} (${item.expiryDate}).`;

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
