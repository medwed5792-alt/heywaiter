"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DEFAULT_VENUE_ID as VENUE_ID } from "@/lib/standards/venue-default";
import {
  parseVenueMenuVenueBlock,
  type VenueMenuCategory,
  type VenueMenuItem,
} from "@/lib/system-configs/venue-menu-config";

const MENU_DOC = () => doc(db, "venues", VENUE_ID, "configs", "menu");

function itemEffectiveActive(i: VenueMenuItem): boolean {
  return i.active !== false;
}

export function SettingsVenueMenuCatalogSection() {
  const [categories, setCategories] = useState<VenueMenuCategory[]>([]);
  const [items, setItems] = useState<VenueMenuItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const prevActiveByItemIdRef = useRef<Map<string, boolean>>(new Map());

  const reload = useCallback(async () => {
    const snap = await getDoc(MENU_DOC());
    const m = new Map<string, boolean>();
    if (!snap.exists()) {
      setCategories([]);
      setItems([]);
      prevActiveByItemIdRef.current = m;
      return;
    }
    const block = parseVenueMenuVenueBlock(snap.data() as Record<string, unknown>);
    if (!block) {
      setCategories([]);
      setItems([]);
      prevActiveByItemIdRef.current = m;
      return;
    }
    setCategories(block.categories);
    setItems(block.items);
    for (const it of block.items) {
      m.set(it.id, itemEffectiveActive(it));
    }
    prevActiveByItemIdRef.current = m;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await reload();
      } finally {
        setLoaded(true);
      }
    })();
  }, [reload]);

  const setItemActive = useCallback((id: string, active: boolean) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, active } : it)));
  }, []);

  const initMinimalCatalog = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const catId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `cat_${Date.now()}`;
      const itemId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `item_${Date.now()}`;
      await setDoc(
        MENU_DOC(),
        {
          categories: [{ id: catId, name: "Основное", sortOrder: 0 }],
          items: [
            {
              id: itemId,
              categoryId: catId,
              name: "Борщ",
              description: "Классический",
              price: 350,
              sortOrder: 0,
              active: true,
            },
          ],
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      const m = new Map<string, boolean>();
      m.set(itemId, true);
      prevActiveByItemIdRef.current = m;
      await reload();
      setMessage({ type: "ok", text: "Создан пример каталога. Переключатель «В продаже» управляет active в Firestore." });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setSaving(false);
    }
  }, [reload]);

  const saveCatalog = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const prev = prevActiveByItemIdRef.current;
      const changes: { dishName: string; active: boolean }[] = [];
      for (const it of items) {
        const next = itemEffectiveActive(it);
        if (!prev.has(it.id)) continue;
        const was = prev.get(it.id)!;
        if (was !== next) {
          changes.push({ dishName: it.name, active: next });
        }
      }

      await setDoc(
        MENU_DOC(),
        {
          categories,
          items,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const nextMap = new Map<string, boolean>();
      for (const it of items) nextMap.set(it.id, itemEffectiveActive(it));
      prevActiveByItemIdRef.current = nextMap;

      if (changes.length > 0) {
        const res = await fetch("/api/admin/venue/menu-stoplist-notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ venueId: VENUE_ID, changes }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; notified?: number };
        if (!res.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Не удалось отправить уведомления персоналу");
        }
        setMessage({
          type: "ok",
          text: `Каталог сохранён. Уведомления персоналу: ${data.notified ?? changes.length} (изменения active).`,
        });
      } else {
        setMessage({ type: "ok", text: "Каталог сохранён. Изменений active не было — рассылка не нужна." });
      }
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Ошибка сохранения" });
    } finally {
      setSaving(false);
    }
  }, [categories, items]);

  if (!loaded) return <p className="mt-3 text-sm text-gray-500">Загрузка каталога…</p>;

  return (
    <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50/40 p-6">
      <h4 className="text-base font-semibold text-gray-900">Витрина и стоп-лист (venues/…/configs/menu)</h4>
      <p className="mt-1 text-sm text-gray-600">
        Поле <span className="font-mono text-xs">active</span> в документе меню: выключите — блюдо скрывается из витрины
        гостя; персонал получает сообщение вида «Администратор: … -&gt; СТОП / АКТИВНО».
      </p>

      {items.length === 0 ? (
        <div className="mt-4">
          <p className="text-sm text-gray-600">Локальный каталог пуст. Создайте структуру вручную в Firestore или нажмите:</p>
          <button
            type="button"
            disabled={saving}
            onClick={() => void initMinimalCatalog()}
            className="mt-3 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
          >
            Инициализировать пример
          </button>
        </div>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-amber-200/80 rounded-lg border border-amber-200 bg-white">
            {items.map((it) => {
              const on = itemEffectiveActive(it);
              return (
                <li key={it.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900">{it.name}</p>
                    <p className="text-xs text-gray-500">
                      {Math.round(it.price)} ₽ · id: <span className="font-mono">{it.id}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={`text-sm font-semibold ${on ? "text-green-700" : "text-red-700"}`}>
                      {on ? "В продаже" : "Стоп"}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={on ? "В продаже, нажмите для стоп-листа" : "В стоп-листе, нажмите чтобы вернуть в продажу"}
                      onClick={() => setItemActive(it.id, !on)}
                      className={`relative h-9 w-[3.5rem] shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 ${
                        on ? "bg-green-600" : "bg-gray-400"
                      }`}
                    >
                      <span
                        className={`absolute top-1 left-1 h-7 w-7 rounded-full bg-white shadow-md transition-transform ${
                          on ? "translate-x-[1.35rem]" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveCatalog()}
            className="mt-4 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? "Сохранение…" : "Сохранить каталог и уведомить персонал"}
          </button>
        </>
      )}

      {message ? (
        <p className={`mt-3 text-sm ${message.type === "ok" ? "text-green-700" : "text-red-600"}`}>{message.text}</p>
      ) : null}
    </div>
  );
}
