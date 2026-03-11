/**
 * Shift-Aware UI: какие роли показывать гостю (кнопки вызова).
 * Запрос к Firestore: сотрудники заведения с on_shift === true, группировка по serviceRole.
 */
import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ServiceRole } from "@/lib/types";

/** Роли, которые показываем гостю кнопкой (Зал + Сервис: вызов официанта, счёта, охраны и т.д.) */
export const GUEST_VISIBLE_ROLES: ServiceRole[] = [
  "waiter",
  "sommelier",
  "hookah",
  "bartender",
  "runner",
  "tea_master",
  "animator",
  "security",
  "hostess",
];

const ROLE_LABELS: Record<ServiceRole, string> = {
  waiter: "Официант",
  sommelier: "Сомелье",
  hookah: "Кальянщик",
  bartender: "Бармен",
  runner: "Раннер",
  tea_master: "Чайный мастер",
  animator: "Аниматор",
  security: "Охрана",
  hostess: "Хостес",
  chef: "Шеф-повар",
  sous_chef: "Су-шеф",
  cook: "Повар",
  pastry_chef: "Кондитер",
  cleaner: "Уборка",
  dishwasher: "Посудомойка",
  owner: "Владелец",
  director: "Управляющий",
  manager: "Менеджер",
  administrator: "Администратор",
};

export function getRoleLabel(role: ServiceRole): string {
  return ROLE_LABELS[role] ?? role;
}

/**
 * Разовый запрос: какие роли в заведении сейчас имеют хотя бы одного на смене.
 * Запрос: staff где venueId == X и onShift == true и active == true;
 * затем из документов собираем уникальные serviceRole (только из GUEST_VISIBLE_ROLES).
 */
export async function getRolesOnShift(venueId: string): Promise<ServiceRole[]> {
  const staffRef = collection(db, "staff");
  const q = query(
    staffRef,
    where("venueId", "==", venueId),
    where("onShift", "==", true),
    where("active", "==", true)
  );
  const snap = await getDocs(q);
  const roles = new Set<ServiceRole>();
  snap.docs.forEach((d) => {
    const role = d.data().serviceRole as ServiceRole | undefined;
    if (role && GUEST_VISIBLE_ROLES.includes(role)) roles.add(role);
  });
  return Array.from(roles);
}

/**
 * Подписка на изменение списка ролей на смене (для мгновенного исчезновения кнопки).
 * Возвращает функцию отписки.
 */
export function subscribeRolesOnShift(
  venueId: string,
  onRoles: (roles: ServiceRole[]) => void
): () => void {
  const staffRef = collection(db, "staff");
  const q = query(
    staffRef,
    where("venueId", "==", venueId),
    where("onShift", "==", true),
    where("active", "==", true)
  );
  const unsub = onSnapshot(q, (snap) => {
    const roles = new Set<ServiceRole>();
    snap.docs.forEach((d) => {
      const role = d.data().serviceRole as ServiceRole | undefined;
      if (role && GUEST_VISIBLE_ROLES.includes(role)) roles.add(role);
    });
    onRoles(Array.from(roles));
  });
  return unsub;
}
