export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import type { ServiceRole } from "@/lib/types";
import { LPR_ROLES } from "@/lib/types";

/**
 * POST /api/notifications/call-waiter
 * Вызов официанта из Mini App: создаёт уведомление в staffNotifications,
 * таргетирует официантов и ЛПР заведения. Токен персонал-бота берётся из Firestore (system_settings/bots).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const venueId = (body.venueId as string)?.trim();
    const tableId = (body.tableId as string)?.trim();
    const visitorId = (body.visitorId as string)?.trim() ?? undefined;

    if (!venueId || !tableId) {
      return NextResponse.json(
        { ok: false, error: "venueId и tableId обязательны" },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();

    const assignedId = await getAssignedStaffForTable(firestore, venueId, tableId, "waiter");
    const lprIds = await getLprStaffIds(firestore, venueId);
    const waiterIds = await getStaffIdsByRoleOnShift(firestore, venueId, "waiter");
    const targetUids = assignedId
      ? Array.from(new Set([assignedId, ...lprIds]))
      : Array.from(new Set([...waiterIds, ...lprIds]));

    const message = `Вызов официанта, стол №${tableId}`;
    await firestore.collection("staffNotifications").add({
      venueId,
      tableId,
      sessionId: null,
      type: "role_call",
      role: "waiter" as ServiceRole,
      message,
      read: false,
      targetUids,
      ...(visitorId && { visitorId }),
      createdAt: new Date(),
    });

    return NextResponse.json({ ok: true, message: "Вызов отправлен" });
  } catch (err) {
    console.error("[call-waiter]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}

async function getAssignedStaffForTable(
  firestore: Firestore,
  venueId: string,
  tableId: string,
  role: ServiceRole
): Promise<string | null> {
  const snap = await firestore
    .collection("activeSessions")
    .where("venueId", "==", venueId)
    .where("tableId", "==", tableId)
    .where("status", "==", "check_in_success")
    .limit(1)
    .get();
  const doc = snap.docs[0];
  if (!doc?.exists) return null;
  const assignments = doc.data()?.assignments as Record<string, string> | undefined;
  return assignments?.[role] ?? null;
}

async function getLprStaffIds(
  firestore: Firestore,
  venueId: string
): Promise<string[]> {
  const snap = await firestore
    .collection("staff")
    .where("venueId", "==", venueId)
    .where("active", "==", true)
    .where("onShift", "==", true)
    .get();
  const ids: string[] = [];
  snap.docs.forEach((d) => {
    const role = d.data().serviceRole as ServiceRole | undefined;
    if (role && LPR_ROLES.includes(role)) ids.push(d.id);
  });
  return ids;
}

async function getStaffIdsByRoleOnShift(
  firestore: Firestore,
  venueId: string,
  role: ServiceRole
): Promise<string[]> {
  const snap = await firestore
    .collection("staff")
    .where("venueId", "==", venueId)
    .where("active", "==", true)
    .where("onShift", "==", true)
    .where("serviceRole", "==", role)
    .get();
  return snap.docs.map((d) => d.id);
}
