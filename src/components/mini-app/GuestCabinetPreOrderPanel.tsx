"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import toast from "react-hot-toast";
import { db } from "@/lib/firebase";
import {
  PREORDER_CARTS_SUBCOLLECTION,
  type PreOrderCartStatus,
  type PreOrderLineItem,
  loadPreorderDraftFromLocal,
  savePreorderDraftToLocal,
  parsePreorderCartDoc,
  newPreorderLineId,
} from "@/lib/pre-order";

const SYNC_DEBOUNCE_MS = 700;

type Props = {
  venueFirestoreId: string;
  venueTitle: string;
  registrySotaId: string | null;
  customerUid: string | null;
  enabled: boolean;
};

function statusLabel(s: PreOrderCartStatus): string {
  switch (s) {
    case "sent":
      return "Отправлен в заведение";
    case "received":
      return "Принят персоналом";
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
}: Props) {
  const [items, setItems] = useState<PreOrderLineItem[]>([]);
  const [status, setStatus] = useState<PreOrderCartStatus>("draft");
  const [hydrated, setHydrated] = useState(false);
  const [sending, setSending] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newQty, setNewQty] = useState("1");

  const cartRef = useMemo(() => {
    const v = venueFirestoreId.trim();
    const u = customerUid?.trim();
    if (!v || !u) return null;
    return doc(db, "venues", v, PREORDER_CARTS_SUBCOLLECTION, u);
  }, [venueFirestoreId, customerUid]);

  const canEdit = status === "draft";
  const vrHint = registrySotaId ? ` · ${registrySotaId}` : "";

  useEffect(() => {
    if (!enabled || !cartRef) return;
    const unsub = onSnapshot(cartRef, (snap) => {
      const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      const parsed = parsePreorderCartDoc(data);
      if (parsed) {
        setStatus(parsed.status);
        setItems(parsed.items);
        setHydrated(true);
        if (parsed.status === "draft") savePreorderDraftToLocal(venueFirestoreId, parsed.items);
        return;
      }
      const local = loadPreorderDraftFromLocal(venueFirestoreId);
      setItems(local);
      setStatus("draft");
      setHydrated(true);
    });
    return () => unsub();
  }, [enabled, cartRef, venueFirestoreId]);

  const pushDraftToFirestore = useCallback(async () => {
    if (!cartRef || !customerUid?.trim()) return;
    try {
      await setDoc(
        cartRef,
        {
          venueId: venueFirestoreId.trim(),
          venueSotaId: registrySotaId,
          customerUid: customerUid.trim(),
          items,
          status: "draft",
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now(),
        },
        { merge: true }
      );
    } catch {
      // сеть / правила — тихо; локальный черновик уже сохранён
    }
  }, [cartRef, customerUid, items, registrySotaId, venueFirestoreId]);

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
  }, [items, enabled, hydrated, canEdit, venueFirestoreId, cartRef, pushDraftToFirestore]);

  const addLine = () => {
    if (!canEdit) return;
    const name = newName.trim();
    if (!name) {
      toast.error("Укажите название позиции");
      return;
    }
    const unitPrice = Number(newPrice.replace(",", "."));
    const qty = Math.max(1, Math.floor(Number(newQty.replace(",", ".")) || 1));
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      toast.error("Укажите цену (число)");
      return;
    }
    setItems((prev) => [...prev, { id: newPreorderLineId(), name, qty, unitPrice }]);
    setNewName("");
    setNewPrice("");
    setNewQty("1");
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

  const sendToVenue = async () => {
    if (!cartRef || !customerUid?.trim()) {
      toast.error("Нет идентификатора гостя для отправки");
      return;
    }
    if (items.length === 0) {
      toast.error("Добавьте позиции в корзину");
      return;
    }
    setSending(true);
    try {
      await setDoc(
        cartRef,
        {
          venueId: venueFirestoreId.trim(),
          venueSotaId: registrySotaId,
          customerUid: customerUid.trim(),
          items,
          status: "sent",
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now(),
          sentAt: serverTimestamp(),
        },
        { merge: true }
      );
      setStatus("sent");
      toast.success("Предзаказ отправлен");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  };

  const startNewPreorder = async () => {
    if (!cartRef || !customerUid?.trim()) return;
    setItems([]);
    setStatus("draft");
    savePreorderDraftToLocal(venueFirestoreId, []);
    try {
      await setDoc(
        cartRef,
        {
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

      {!customerUid?.trim() ? (
        <p className="mt-3 text-xs text-amber-800">Войдите через Telegram или откройте приложение как гость — нужен UID для синхронизации.</p>
      ) : null}

      <div className="mt-3 space-y-2">
        {items.length === 0 ? (
          <p className="text-xs text-slate-600">Корзина пуста. Добавьте блюда до визита.</p>
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
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => bumpQty(l.id, 1)}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => removeLine(l.id)}
                    className="ml-1 rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-700"
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
        <p className="mt-3 text-right text-sm font-bold text-slate-900">Итого: {Math.round(total)} ₽</p>
      ) : null}

      {canEdit ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Добавить позицию</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Название"
              className="min-w-[140px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder="Цена ₽"
              inputMode="decimal"
              className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              placeholder="Кол-во"
              inputMode="numeric"
              className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={addLine}
              disabled={!customerUid?.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              В корзину
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {canEdit ? (
          <button
            type="button"
            onClick={() => void sendToVenue()}
            disabled={sending || !customerUid?.trim() || items.length === 0}
            className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {sending ? "Отправка…" : "Отправить в заведение"}
          </button>
        ) : null}
        {status === "received" ? (
          <button
            type="button"
            onClick={() => void startNewPreorder()}
            className="flex-1 rounded-xl border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Новый предзаказ
          </button>
        ) : null}
      </div>
    </section>
  );
}
