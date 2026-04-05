/**
 * Stealth Targeted Notifications: таргетированная маршрутизация уведомлений.
 * Уведомление получают: (а) закреплённый за столом сотрудник этой роли, (б) группа ЛПР.
 * Каскад: если за столом никто не закреплён — все сотрудники этой роли на смене.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ServiceRole } from "@/lib/types";
import { LPR_ROLES } from "@/lib/types";

/**
 * Находит закреплённого сотрудника данной роли для стола.
 *
 * СТРУКТУРА ЗАПРОСА:
 * 1) Берём активную сессию по (venueId, tableId): в ней хранится assignments[role] = staffId.
 * 2) Если сессии нет или в assignments нет этой роли — проверяем коллекцию tables
 *    (документ tables/{venueId}_{tableId} или подколлекция) на assignments[role].
 *
 * Запрос к Firestore:
 *   activeSessions: query(where('venueId','==',venueId), where('tableId','==',tableId), where('status','==','check_in_success')), limit(1)
 *   Дальше: session.assignments?.sommelier → assignedStaffId.
 *
 * Альтернатива: если assignments хранятся в отдельной коллекции tableAssignments:
 *   query(where('venueId','==',venueId), where('tableId','==',tableId), where('role','==',role)), limit(1)
 *   → doc.staffId
 */
export async function getAssignedStaffForTable(
  venueId: string,
  tableId: string,
  role: ServiceRole
): Promise<string | null> {
  const sessionsRef = collection(db, "activeSessions");
  const q = query(
    sessionsRef,
    where("venueId", "==", venueId),
    where("tableId", "==", tableId),
    where("status", "==", "check_in_success")
  );
  const snap = await getDocs(q);
  const sessionDoc = snap.docs[0];
  if (!sessionDoc?.exists()) return null;
  const data = sessionDoc.data();
  const assignments = data.assignments as Record<string, string> | undefined;
  return assignments?.[role] ?? null;
}

/**
 * Список staffId сотрудников ЛПР заведения, которые на смене (для KPI).
 */
async function getLprStaffIds(venueId: string): Promise<string[]> {
  const staffRef = collection(db, "staff");
  const q = query(
    staffRef,
    where("venueId", "==", venueId),
    where("active", "==", true),
    where("onShift", "==", true)
  );
  const snap = await getDocs(q);
  const ids: string[] = [];
  snap.docs.forEach((d) => {
    const role = d.data().serviceRole as ServiceRole | undefined;
    if (role && LPR_ROLES.includes(role)) ids.push(d.id);
  });
  return ids;
}

/**
 * Список staffId всех сотрудников данной роли заведения, которые на смене (каскад).
 */
async function getStaffIdsByRoleOnShift(
  venueId: string,
  role: ServiceRole
): Promise<string[]> {
  const staffRef = collection(db, "staff");
  const q = query(
    staffRef,
    where("venueId", "==", venueId),
    where("active", "==", true),
    where("onShift", "==", true),
    where("serviceRole", "==", role)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.id);
}

/**
 * Создаёт уведомление с таргетированной маршрутизацией (Stealth).
 * targetUids = [закреплённый за столом этой роли] + ЛПР ИЛИ [все этой роли на смене] + ЛПР.
 */
export async function createTargetedNotification(
  venueId: string,
  tableId: string,
  role: ServiceRole,
  message: string,
  sessionId?: string
): Promise<{ id: string; targetUids: string[] }> {
  const assignedId = await getAssignedStaffForTable(venueId, tableId, role);
  const lprIds = await getLprStaffIds(venueId);

  let targetUids: string[];
  if (assignedId) {
    targetUids = Array.from(new Set([assignedId, ...lprIds]));
  } else {
    const roleStaffIds = await getStaffIdsByRoleOnShift(venueId, role);
    targetUids = Array.from(new Set([...roleStaffIds, ...lprIds]));
  }

  const ref = await addDoc(collection(db, "staffNotifications"), {
    venueId,
    tableId,
    sessionId: sessionId ?? null,
    type: "role_call",
    role,
    message,
    read: false,
    targetUids,
    createdAt: serverTimestamp(),
  });

  return { id: ref.id, targetUids };
}

/**
 * Проверка: должно ли текущее уведомление быть видно сотруднику (staffId).
 * В Staff-боте фильтровать: показывать только где targetUids.includes(currentStaffId).
 */
export function isNotificationVisibleToStaff(
  targetUids: string[],
  staffId: string
): boolean {
  return targetUids.includes(staffId);
}

/**
 * Запрос к Firestore для выдачи уведомлений в рабочем боте:
 *   collection('staffNotifications')
 *   where('targetUids', 'array-contains', staffId)
 *   where('read', '==', false)
 *   orderBy('createdAt', 'desc')
 *   limit(50)
 * Так официанты и другие роли не видят чужие вызовы (изоляция).
 */
export const STAFF_NOTIFICATIONS_QUERY = {
  collection: "staffNotifications",
  whereTargetUids: (staffId: string) => [
    ["targetUids", "array-contains", staffId],
    ["read", "==", false],
  ],
} as const;

/**
 * Гость покинул геозону при активной сессии → лента дашборда + таргет официанту (и ЛПР по каскаду).
 */
export async function createGuestEscapeAlert(
  venueId: string,
  tableId: string,
  sessionId?: string,
  opts?: { guestLabel?: string; tableNumber?: number }
): Promise<string> {
  const name = (opts?.guestLabel ?? "Гость").trim() || "Гость";
  const tbl =
    opts?.tableNumber != null && Number.isFinite(opts.tableNumber) && opts.tableNumber > 0
      ? String(Math.floor(opts.tableNumber))
      : tableId;
  const message = `Гость ${name} стол №${tbl} покинул радиус`;
  const ref = await createTargetedNotification(venueId, tableId, "waiter", message, sessionId);
  return ref.id;
}

/**
 * Escape Alert: сотрудник покинул зону во время смены → уведомление ЛПР.
 */
export async function createStaffEscapeAlert(
  venueId: string,
  staffId: string,
  staffName: string
): Promise<string> {
  const lprIds = await getLprStaffIds(venueId);
  const targetUids = Array.from(new Set(lprIds));
  const ref = await addDoc(collection(db, "staffNotifications"), {
    venueId,
    type: "geo_escape",
    role: "owner",
    message: `Сотрудник ${staffName} покинул зону заведения`,
    read: false,
    targetUids,
    payload: { staffId },
    createdAt: serverTimestamp(),
  });
  return ref.id;
}
