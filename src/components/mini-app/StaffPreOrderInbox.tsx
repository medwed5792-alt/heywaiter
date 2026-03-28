"use client";

import { useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";
import { collection, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  PREORDER_CARTS_SUBCOLLECTION,
  parsePreorderCartDoc,
  type PreOrderLineItem,
} from "@/lib/pre-order";

type Row = {
  id: string;
  customerUid: string;
  items: PreOrderLineItem[];
  venueSotaId: string | null;
};

export function StaffPreOrderInbox({ venueId, staffId }: { venueId: string; staffId: string | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const v = venueId.trim();
    if (!v) {
      setRows([]);
      return;
    }
    const col = collection(db, "venues", v, PREORDER_CARTS_SUBCOLLECTION);
    const unsub = onSnapshot(
      col,
      (snap) => {
        const next: Row[] = [];
        for (const d of snap.docs) {
          const raw = d.data() as Record<string, unknown>;
          const p = parsePreorderCartDoc(raw);
          if (!p || p.status !== "sent") continue;
          const customerUid =
            typeof raw.customerUid === "string" && raw.customerUid.trim() ? raw.customerUid.trim() : d.id;
          const venueSotaId =
            typeof raw.venueSotaId === "string" && raw.venueSotaId.trim() ? raw.venueSotaId.trim() : null;
          next.push({ id: d.id, customerUid, items: p.items, venueSotaId });
        }
        next.sort((a, b) => a.customerUid.localeCompare(b.customerUid, "ru"));
        setRows(next);
      },
      () => setRows([])
    );
    return () => unsub();
  }, [venueId]);

  const acknowledge = async (cartDocId: string) => {
    const v = venueId.trim();
    if (!v) return;
    setBusy(cartDocId);
    try {
      const ref = doc(db, "venues", v, PREORDER_CARTS_SUBCOLLECTION, cartDocId);
      await updateDoc(ref, {
        status: "received",
        receivedAt: serverTimestamp(),
        receivedByStaffId: staffId?.trim() || null,
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now(),
      });
    } catch (e) {
      console.warn("[StaffPreOrderInbox] acknowledge failed", e);
    } finally {
      setBusy(null);
    }
  };

  if (!venueId.trim()) return null;

  return (
    <section className="rounded-2xl border border-emerald-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50/80 px-4 py-3">
        <ShoppingBag className="h-4 w-4 text-emerald-800" aria-hidden />
        <h2 className="text-sm font-medium text-emerald-950">Предзаказы гостей</h2>
      </div>
      <div className="max-h-[40vh] overflow-y-auto">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-slate-500 text-center">Нет входящих предзаказов</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              const total = r.items.reduce((acc, l) => acc + l.qty * l.unitPrice, 0);
              return (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Гость</p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-600">{r.customerUid}</p>
                      {r.venueSotaId ? (
                        <p className="mt-1 text-[11px] font-mono text-slate-500">VR: {r.venueSotaId}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void acknowledge(r.id)}
                      disabled={busy === r.id}
                      className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {busy === r.id ? "…" : "Принято"}
                    </button>
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-slate-700">
                    {r.items.map((l) => (
                      <li key={l.id} className="flex justify-between gap-2">
                        <span className="truncate">{l.name}</span>
                        <span className="shrink-0 text-slate-500">
                          {l.qty} × {Math.round(l.unitPrice)} ₽
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-right text-sm font-bold text-slate-900">Итого: {Math.round(total)} ₽</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
