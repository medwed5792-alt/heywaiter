"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { getIdToken, onAuthStateChanged } from "firebase/auth";
import { deleteField, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import toast from "react-hot-toast";
import { auth, db } from "@/lib/firebase";
import { PREORDER_GUEST_CANCEL_REASON } from "@/lib/preorder-cancel-presets";
import {
  PREORDER_CARTS_SUBCOLLECTION,
  type PreOrderCartStatus,
  type PreOrderLineItem,
  loadPreorderDraftFromLocal,
  savePreorderDraftToLocal,
  parsePreorderCartDoc,
  newPreorderLineId,
} from "@/lib/pre-order";
import type { VenueMenuItem, VenueMenuVenueBlock } from "@/lib/system-configs/venue-menu-config";

const SYNC_DEBOUNCE_MS = 700;

type Props = {
  venueFirestoreId: string;
  venueTitle: string;
  registrySotaId: string | null;
  customerUid: string | null;
  enabled: boolean;
  maxCartItems: number;
  submissionAllowed: boolean;
  submissionBlockedReason: string | null;
  /** Каталог из venues/.../configs/menu (уже без стоп-листа: только isActive === true). */
  menuCatalog: VenueMenuVenueBlock | null;
  /** PDF / внешняя ссылка из venues.config — только просмотр. */
  menuPdfUrl: string | null;
};

function statusLabel(s: PreOrderCartStatus): string {
  switch (s) {
    case "sent":
      return "Отправлен в заведение";
    case "confirmed":
      return "Подтверждён заведением";
    case "ready":
      return "Готов к выдаче";
    case "completed":
      return "Выполнен";
    case "cancelled":
      return "Отменён";
    default:
      return "Черновик";
  }
}

export function GuestCabinetPreOrderPanel({
  venueFirestoreId,
  venueTitle,
  registrySotaId,
  customerUid,
  enabled,
  maxCartItems,
  submissionAllowed,
  submissionBlockedReason,
  menuCatalog,
  menuPdfUrl,
}: Props) {
  const [items, setItems] = useState<PreOrderLineItem[]>([]);
  const [status, setStatus] = useState<PreOrderCartStatus>("draft");
  const [hydrated, setHydrated] = useState(false);
  const [sending, setSending] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [firebaseAuthUid, setFirebaseAuthUid] = useState<string | null>(() => auth.currentUser?.uid ?? null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReasonShown, setCancelReasonShown] = useState<string | null>(null);
  const [cancelledByShown, setCancelledByShown] = useState<"guest" | "staff" | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  const catalogItemIds = useMemo(
    () => new Set((menuCatalog?.items ?? []).map((i) => i.id)),
    [menuCatalog]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setFirebaseAuthUid(u?.uid ?? null));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!menuCatalog?.categories.length) {
      setSelectedCategoryId(null);
      return;
    }
    setSelectedCategoryId((cur) => {
      if (cur && menuCatalog.categories.some((c) => c.id === cur)) return cur;
      return menuCatalog.categories[0]!.id;
    });
  }, [menuCatalog]);

  const cartRef = useMemo(() => {
    const v = venueFirestoreId.trim();
    const u = customerUid?.trim();
    if (!v || !u) return null;
    return doc(db, "venues", v, PREORDER_CARTS_SUBCOLLECTION, u);
  }, [venueFirestoreId, customerUid]);

  const canEdit = status === "draft";
  const canStartNewPreorder =
    status === "confirmed" || status === "ready" || status === "completed" || status === "cancelled";
  const vrHint = registrySotaId ? ` · ${registrySotaId}` : "";

  const visibleMenuItems = useMemo(() => {
    if (!menuCatalog?.items.length) return [];
    if (!selectedCategoryId) return menuCatalog.items;
    return menuCatalog.items.filter((i) => i.categoryId === selectedCategoryId);
  }, [menuCatalog, selectedCategoryId]);

  useEffect(() => {
    if (!enabled || !cartRef) return;
    const unsub = onSnapshot(cartRef, (snap) => {
      const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      const parsed = parsePreorderCartDoc(data);
      if (parsed) {
        setStatus(parsed.status);
        setItems(parsed.items);
        setCancelReasonShown(parsed.cancelReason ?? null);
        setCancelledByShown(parsed.cancelledBy ?? null);
        setHydrated(true);
        if (parsed.status === "draft") savePreorderDraftToLocal(venueFirestoreId, parsed.items);
        return;
      }
      const local = loadPreorderDraftFromLocal(venueFirestoreId);
      setItems(local);
      setStatus("draft");
      setCancelReasonShown(null);
      setCancelledByShown(null);
      setHydrated(true);
    });
    return () => unsub();
  }, [enabled, cartRef, venueFirestoreId]);

  /** Черновик: только позиции из текущего каталога (Zero Input). */
  useEffect(() => {
    if (!hydrated || status !== "draft") return;
    if (!menuCatalog) {
      setItems((prev) => (prev.length ? [] : prev));
      return;
    }
    setItems((prev) => {
      const next = prev.filter((l) => Boolean(l.catalogItemId && catalogItemIds.has(l.catalogItemId!)));
      return next.length === prev.length ? prev : next;
    });
  }, [hydrated, status, menuCatalog, catalogItemIds]);

  const itemsCapped = useMemo(() => items.slice(0, maxCartItems), [items, maxCartItems]);

  const pushDraftToFirestore = useCallback(async () => {
    if (!cartRef || !customerUid?.trim() || !firebaseAuthUid) return;
    try {
      await setDoc(
        cartRef,
        {
          authUid: firebaseAuthUid,
          venueId: venueFirestoreId.trim(),
          venueSotaId: registrySotaId,
          customerUid: customerUid.trim(),
          items: itemsCapped,
          status: "draft",
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now(),
        },
        { merge: true }
      );
    } catch {
      // ignore
    }
  }, [cartRef, customerUid, firebaseAuthUid, itemsCapped, registrySotaId, venueFirestoreId]);

  useEffect(() => {
    if (!enabled || !hydrated || !canEdit) return;
    savePreorderDraftToLocal(venueFirestoreId, items);
    if (!cartRef) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void pushDraftToFirestore();
    }, SYNC_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [items, enabled, hydrated, canEdit, venueFirestoreId, cartRef, pushDraftToFirestore, firebaseAuthUid]);

  const addFromCatalog = (item: VenueMenuItem) => {
    if (!canEdit || !menuCatalog) return;
    const existing = items.find((l) => l.catalogItemId === item.id);
    if (existing) {
      setItems((prev) =>
        prev.map((l) => (l.id === existing.id ? { ...l, qty: l.qty + 1 } : l))
      );
      return;
    }
    if (items.length >= maxCartItems) {
      toast.error(`Не более ${maxCartItems} позиций в заказе`);
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        id: newPreorderLineId(),
        catalogItemId: item.id,
        name: item.name,
        qty: 1,
        unitPrice: item.price,
      },
    ]);
  };

  const bumpQty = (id: string, delta: number) => {
    if (!canEdit) return;
    setItems((prev) =>
      prev
        .map((l) => (l.id === id ? { ...l, qty: Math.max(1, l.qty + delta) } : l))
        .filter((l) => l.qty >= 1)
    );
  };

  const removeLine = (id: string) => {
    if (!canEdit) return;
    setItems((prev) => prev.filter((l) => l.id !== id));
  };

  const openPdfMenu = () => {
    const u = menuPdfUrl?.trim();
    if (!u) return;
    try {
      window.open(u, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Не удалось открыть меню");
    }
  };

  const cancelGuestOrder = async () => {
    if (!cartRef || !customerUid?.trim() || !firebaseAuthUid) {
      toast.error("Нет идентификатора гостя или сессии Firebase");
      return;
    }
    setCancelling(true);
    try {
      await updateDoc(cartRef, {
        status: "cancelled",
        cancelReason: PREORDER_GUEST_CANCEL_REASON,
        cancelledBy: "guest",
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now(),
      });
      setStatus("cancelled");

      const user = auth.currentUser;
      if (!user) {
        toast.error("Нет сессии для уведомления персонала");
        return;
      }
      const token = await getIdToken(user);
      const res = await fetch("/api/guest/preorder-guest-cancel-notify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          venueId: venueFirestoreId.trim(),
          cartDocId: customerUid.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; skipped?: string };
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Не удалось уведомить персонал");
        return;
      }
      if (data.skipped === "notifications_disabled") {
        toast.success("Заказ отменён");
      } else {
        toast.success("Заказ отменён, персонал уведомлён");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отменить заказ");
    } finally {
      setCancelling(false);
    }
  };

  const sendToVenue = async () => {
    if (!cartRef || !customerUid?.trim() || !firebaseAuthUid) {
      toast.error("Нет идентификатора гостя или сессии Firebase для отправки");
      return;
    }
    if (!menuCatalog) {
      toast.error("Каталог недоступен");
      return;
    }
    if (!submissionAllowed) {
      toast.error(submissionBlockedReason ?? "Сейчас нельзя отправить заказ");
      return;
    }
    if (items.length === 0) {
      toast.error("Выберите блюда на витрине");
      return;
    }
    const bad = items.some((l) => !l.catalogItemId || !catalogItemIds.has(l.catalogItemId));
    if (bad) {
      toast.error("В корзине есть устаревшие позиции — очистите и добавьте заново");
      return;
    }
    setSending(true);
    try {
      await setDoc(
        cartRef,
        {
          authUid: firebaseAuthUid,
          venueId: venueFirestoreId.trim(),
          venueSotaId: registrySotaId,
          customerUid: customerUid.trim(),
          items: itemsCapped,
          status: "sent",
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now(),
          sentAt: serverTimestamp(),
        },
        { merge: true }
      );
      setStatus("sent");
      toast.success("Заказ отправлен");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  };

  const startNewPreorder = async () => {
    if (!cartRef || !customerUid?.trim() || !firebaseAuthUid) return;
    setItems([]);
    setStatus("draft");
    savePreorderDraftToLocal(venueFirestoreId, []);
    try {
      await setDoc(
        cartRef,
        {
          authUid: firebaseAuthUid,
          venueId: venueFirestoreId.trim(),
          venueSotaId: registrySotaId,
          customerUid: customerUid.trim(),
          items: [],
          status: "draft",
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now(),
          sentAt: null,
          receivedAt: null,
          receivedByStaffId: null,
          confirmedAt: null,
          confirmedByStaffId: null,
          cancelReason: deleteField(),
          cancelledBy: deleteField(),
          cancelledAt: deleteField(),
          cancelledByStaffId: deleteField(),
        },
        { merge: true }
      );
    } catch {
      toast.error("Не удалось сбросить корзину");
    }
  };

  if (!enabled) return null;

  const total = items.reduce((acc, l) => acc + l.qty * l.unitPrice, 0);

  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">Предзаказ</p>
          <p className="mt-0.5 text-xs text-slate-600">
            {venueTitle}
            {vrHint}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-900">
          {statusLabel(status)}
        </span>
      </div>

      {menuPdfUrl?.trim() ? (
        <button
          type="button"
          onClick={openPdfMenu}
          className="mt-3 flex w-full min-h-[52px] items-center justify-center gap-2 rounded-2xl border-2 border-slate-300 bg-white py-3 text-base font-bold text-slate-800 shadow-sm active:scale-[0.99]"
        >
          <FileText className="h-6 w-6 shrink-0 text-slate-600" aria-hidden />
          Меню (PDF)
        </button>
      ) : null}

      {!customerUid?.trim() ? (
        <p className="mt-3 text-xs text-amber-800">
          Войдите через Telegram или откройте приложение как гость — нужен UID для синхронизации.
        </p>
      ) : !firebaseAuthUid ? (
        <p className="mt-3 text-xs text-amber-800">
          Подключение к Firebase… корзина сохраняется только на устройстве, пока не готова анонимная сессия.
        </p>
      ) : null}

      {status === "confirmed" ? (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-100/70 px-3 py-2 text-sm font-medium text-emerald-950">
          Заказ подтвержден заведением
        </p>
      ) : null}

      {status === "cancelled" && cancelReasonShown ? (
        <p className="mt-3 rounded-xl border border-slate-200 bg-slate-100/80 px-3 py-2 text-xs text-slate-800">
          {cancelledByShown === "staff" ? "Отмена заведения" : "Отменено вами"}
          {": "}
          <span className="font-medium">{cancelReasonShown}</span>
        </p>
      ) : null}

      {canEdit && customerUid?.trim() && firebaseAuthUid && !submissionAllowed && submissionBlockedReason ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {submissionBlockedReason}
        </p>
      ) : null}

      {canEdit && menuCatalog ? (
        <>
          <h3 className="mt-4 text-center text-lg font-bold text-slate-900">Заказать</h3>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {menuCatalog.categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCategoryId(c.id)}
                className={`flex shrink-0 items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-bold ${
                  selectedCategoryId === c.id
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-200 bg-white text-slate-800"
                }`}
              >
                {c.imageUrl ? (
                  <img src={c.imageUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs">🍽</span>
                )}
                {c.name}
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            {visibleMenuItems.map((item) => (
              <article
                key={item.id}
                className="flex flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm"
              >
                <div className="relative aspect-square w-full bg-slate-100">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-5xl" aria-hidden>
                      🍽
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-2">
                  <p className="line-clamp-2 text-sm font-bold text-slate-900">{item.name}</p>
                  {item.description ? (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-600">{item.description}</p>
                  ) : null}
                  <p className="mt-1 text-base font-bold text-emerald-800">{Math.round(item.price)} ₽</p>
                  <button
                    type="button"
                    disabled={!customerUid?.trim() || !firebaseAuthUid}
                    onClick={() => addFromCatalog(item)}
                    className="mt-2 min-h-14 w-full rounded-xl bg-emerald-600 text-3xl font-bold leading-none text-white shadow-md active:bg-emerald-700 disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : canEdit && !menuCatalog && menuPdfUrl?.trim() ? (
        <p className="mt-4 rounded-xl border border-slate-200 bg-white px-3 py-3 text-center text-sm text-slate-600">
          Заведение пока не заполнило витрину предзаказа. Откройте «Меню (PDF)» — полный перечень в привычном формате.
        </p>
      ) : canEdit && !menuCatalog && !menuPdfUrl?.trim() ? (
        <p className="mt-4 rounded-xl border border-slate-200 bg-amber-50 px-3 py-3 text-center text-sm text-amber-900">
          Каталог предзаказа и ссылка на меню не настроены.
        </p>
      ) : null}

      <div className="mt-4 space-y-2">
        {items.length === 0 ? (
          <p className="text-xs text-slate-600">
            {menuCatalog
              ? "Корзина пуста. Нажимайте «+» на карточках."
              : menuPdfUrl?.trim()
                ? "Витрина не заполнена — добавление блюд из списка недоступно; при необходимости откройте «Меню (PDF)»."
                : "Корзина пуста."}
          </p>
        ) : (
          items.map((l) => (
            <div
              key={l.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 font-medium text-slate-800">{l.name}</span>
              <span className="text-slate-600">
                {l.qty} × {Math.round(l.unitPrice)} ₽
              </span>
              {canEdit ? (
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => bumpQty(l.id, -1)}
                    className="min-h-11 min-w-11 rounded-xl border-2 border-slate-300 bg-white text-lg font-bold text-slate-800 active:bg-slate-50"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => bumpQty(l.id, 1)}
                    className="min-h-11 min-w-11 rounded-xl border-2 border-slate-300 bg-white text-lg font-bold text-slate-800 active:bg-slate-50"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => removeLine(l.id)}
                    className="ml-1 min-h-11 min-w-11 rounded-xl border-2 border-red-200 bg-white text-lg font-bold text-red-700 active:bg-red-50"
                  >
                    ×
                  </button>
                </span>
              ) : null}
            </div>
          ))
        )}
      </div>

      {items.length > 0 ? (
        <p className="mt-3 text-right text-base font-bold text-slate-900">Итого: {Math.round(total)} ₽</p>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {canEdit ? (
          <button
            type="button"
            onClick={() => void sendToVenue()}
            disabled={
              sending ||
              !customerUid?.trim() ||
              !firebaseAuthUid ||
              items.length === 0 ||
              !submissionAllowed ||
              !menuCatalog
            }
            className="min-h-14 flex-1 rounded-2xl bg-emerald-600 py-4 text-base font-bold text-white shadow-md active:bg-emerald-700 disabled:opacity-50"
          >
            {sending ? "Отправка…" : "Отправить в заведение"}
          </button>
        ) : null}
        {status === "sent" ? (
          <button
            type="button"
            onClick={() => void cancelGuestOrder()}
            disabled={cancelling || !customerUid?.trim() || !firebaseAuthUid}
            className="min-h-14 flex-1 rounded-2xl border-2 border-red-200 bg-white py-4 text-base font-bold text-red-700 active:bg-red-50 disabled:opacity-50"
          >
            {cancelling ? "Отмена…" : "Отменить заказ"}
          </button>
        ) : null}
        {canStartNewPreorder ? (
          <button
            type="button"
            onClick={() => void startNewPreorder()}
            className="min-h-14 flex-1 rounded-2xl border-2 border-slate-300 bg-white py-4 text-base font-bold text-slate-800 active:bg-slate-50"
          >
            Новый предзаказ
          </button>
        ) : null}
      </div>
    </section>
  );
}
