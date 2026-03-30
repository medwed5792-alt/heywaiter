import {
  resolvePreorderMaxCartItems,
  resolvePreorderSubmissionGate,
  readVenueSotaId,
  type PreOrderLineItem,
} from "@/lib/pre-order";
import { parsePreorderModuleConfig, PREORDER_SYSTEM_CONFIG_DOC_ID } from "@/lib/system-configs/preorder-module-config";
import { isNowInMenuGroupInterval, parseVenueMenuVenueBlock } from "@/lib/system-configs/venue-menu-config";
import { readVenueTimezone } from "@/lib/venue-timezone";
import type { Firestore } from "firebase-admin/firestore";

export type GuestPreorderSendValidationError = { status: number; message: string };

/**
 * Серверная проверка перед отправкой предзаказа: окно ЦУП и расписание групп меню по времени заведения.
 */
export async function validateGuestPreorderSend(args: {
  firestore: Firestore;
  venueId: string;
  items: PreOrderLineItem[];
  now?: Date;
}): Promise<{ ok: true } | { ok: false; error: GuestPreorderSendValidationError }> {
  const venueId = args.venueId.trim();
  const items = args.items;
  const now = args.now ?? new Date();

  if (!venueId) {
    return { ok: false, error: { status: 400, message: "venueId обязателен" } };
  }
  if (!items.length) {
    return { ok: false, error: { status: 400, message: "Пустая корзина" } };
  }

  const venueSnap = await args.firestore.collection("venues").doc(venueId).get();
  if (!venueSnap.exists) {
    return { ok: false, error: { status: 404, message: "Заведение не найдено" } };
  }
  const venueData = (venueSnap.data() ?? {}) as Record<string, unknown>;
  const timeZone = readVenueTimezone(venueData);
  const registrySotaId = readVenueSotaId(venueData);

  const preorderSnap = await args.firestore.collection("system_configs").doc(PREORDER_SYSTEM_CONFIG_DOC_ID).get();
  const preorderModule = parsePreorderModuleConfig(
    preorderSnap.exists ? (preorderSnap.data() as Record<string, unknown>) : {}
  );

  const gate = resolvePreorderSubmissionGate({
    registrySotaId,
    preorderModule,
    venueTimeZone: timeZone,
    now,
  });
  if (!gate.ok) {
    return { ok: false, error: { status: 403, message: gate.reason } };
  }

  const maxCart = resolvePreorderMaxCartItems(registrySotaId, preorderModule, 100);
  if (items.length > maxCart) {
    return {
      ok: false,
      error: { status: 400, message: `Не более ${maxCart} позиций в заказе` },
    };
  }

  const menuSnap = await args.firestore.collection("venues").doc(venueId).collection("configs").doc("menu").get();
  if (!menuSnap.exists) {
    return { ok: false, error: { status: 400, message: "Каталог меню не настроен" } };
  }
  const menuBlock = parseVenueMenuVenueBlock(menuSnap.data() as Record<string, unknown>);
  if (!menuBlock?.categories?.length || !menuBlock?.items?.length) {
    return { ok: false, error: { status: 400, message: "Каталог меню пуст" } };
  }

  const itemById = new Map(menuBlock.items.map((i) => [i.id, i]));
  const catById = new Map(menuBlock.categories.map((c) => [c.id, c]));

  for (const line of items) {
    const cid = line.catalogItemId?.trim();
    if (!cid) {
      return { ok: false, error: { status: 400, message: "В заказе есть позиция без привязки к меню" } };
    }
    const menuItem = itemById.get(cid);
    if (!menuItem || menuItem.isActive !== true) {
      return { ok: false, error: { status: 400, message: "Позиция недоступна в меню — обновите витрину" } };
    }
    const cat = catById.get(menuItem.categoryId);
    if (!cat || cat.isActive !== true) {
      return { ok: false, error: { status: 400, message: "Категория недоступна" } };
    }
    if (
      !isNowInMenuGroupInterval({
        now,
        timeZone,
        availableFrom: cat.availableFrom,
        availableTo: cat.availableTo,
      })
    ) {
      return {
        ok: false,
        error: {
          status: 403,
          message: `Сейчас нельзя заказать из группы «${cat.name}» (расписание заведения)`,
        },
      };
    }
  }

  return { ok: true };
}
