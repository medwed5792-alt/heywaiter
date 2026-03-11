export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import type { ServiceRole } from "@/lib/types";
import { LPR_ROLES } from "@/lib/types";

/**
 * POST /api/notifications/call-waiter
 * Вызов официанта из Mini App: создаёт уведомление в staffNotifications.
 * Уведомления уходят только сотрудникам с onShift === true для данного venueId
 * (и закреплённый официант, и группы официантов/ЛПР проходят эту проверку).
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

    // 1) Закреплённый официант за столом — только если на смене
    const assignedId = await getAssignedStaffForTable(firestore, venueId, tableId, "waiter");
    const assignedOnShift = assignedId
      ? await isStaffOnShift(firestore, assignedId, venueId)
      : false;

    // 2) Официанты на смене (уже фильтр по onShift в запросе)
    const waiterIds = await getStaffIdsByRoleOnShift(firestore, venueId, "waiter");

    // 3) ЛПР на смене (уже фильтр по onShift в запросе)
    const lprIds = await getLprStaffIds(firestore, venueId);

    const rawTargetUids = Array.from(
      new Set([
        ...(assignedOnShift && assignedId ? [assignedId] : []),
        ...waiterIds,
        ...lprIds,
      ])
    );

    // Финальная проверка: в рассылку попадают только те, у кого onShift === true
    const targetUids: string[] = [];
    for (const id of rawTargetUids) {
      const onShift = await isStaffOnShift(firestore, id, venueId);
      if (onShift) targetUids.push(id);
    }

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

/** Проверяет, что сотрудник (staffId) на смене для данного venueId. */
async function isStaffOnShift(
  firestore: Firestore,
  staffId: string,
  venueId: string
): Promise<boolean> {
  const snap = await firestore.collection("staff").doc(staffId).get();
  if (!snap.exists) return false;
  const d = snap.data();
  return (d?.venueId === venueId && d?.onShift === true) || false;
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
