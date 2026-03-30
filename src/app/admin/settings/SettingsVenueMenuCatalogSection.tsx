"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import toast from "react-hot-toast";
import { GripVertical, ImageIcon, LayoutGrid, Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { db, storage } from "@/lib/firebase";
import { DEFAULT_VENUE_ID as VENUE_ID } from "@/lib/standards/venue-default";
import {
  parseVenueMenuVenueBlock,
  type VenueMenuCategory,
  type VenueMenuItem,
} from "@/lib/system-configs/venue-menu-config";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

const MENU_DOC = () => doc(db, "venues", VENUE_ID, "configs", "menu");

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function itemEffectiveActive(i: VenueMenuItem): boolean {
  return i.active !== false;
}

/** Единый порядок: категории по sortOrder; внутри категории — блюда по sortOrder; сироты — в последнюю категорию. */
function normalizeCatalog(
  categories: VenueMenuCategory[],
  items: VenueMenuItem[]
): { categories: VenueMenuCategory[]; items: VenueMenuItem[] } {
  const cats = categories.map((c, i) => ({ ...c, sortOrder: i }));
  const catIds = cats.map((c) => c.id);
  const set = new Set(catIds);
  const nextItems: VenueMenuItem[] = [];
  for (const c of cats) {
    const sub = items
      .filter((i) => i.categoryId === c.id && set.has(i.categoryId))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    sub.forEach((it, idx) => nextItems.push({ ...it, categoryId: c.id, sortOrder: idx }));
  }
  const orphans = items.filter((i) => !set.has(i.categoryId));
  if (orphans.length && cats.length > 0) {
    const last = cats[cats.length - 1]!;
    const base = nextItems.filter((i) => i.categoryId === last.id).length;
    orphans.forEach((it, idx) =>
      nextItems.push({
        ...it,
        categoryId: last.id,
        sortOrder: base + idx,
      })
    );
  }
  return { categories: cats, items: nextItems };
}

type DragPayload = { kind: "category" | "item"; id: string; fromCategoryId?: string };

export function SettingsVenueMenuCatalogSection() {
  const [categories, setCategories] = useState<VenueMenuCategory[]>([]);
  const [items, setItems] = useState<VenueMenuItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const prevActiveByItemIdRef = useRef<Map<string, boolean>>(new Map());
  const dragPayloadRef = useRef<DragPayload | null>(null);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  const applyNormalized = useCallback((cats: VenueMenuCategory[], its: VenueMenuItem[]) => {
    const n = normalizeCatalog(cats, its);
    setCategories(n.categories);
    setItems(n.items);
  }, []);

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
    const n = normalizeCatalog(block.categories, block.items);
    setCategories(n.categories);
    setItems(n.items);
    for (const it of n.items) m.set(it.id, itemEffectiveActive(it));
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

  const patchItem = useCallback(
    (id: string, patch: Partial<VenueMenuItem>) => {
      applyNormalized(
        categories,
        items.map((it) => (it.id === id ? { ...it, ...patch } : it))
      );
    },
    [categories, items, applyNormalized]
  );

  const addCategory = () => {
    const name = newCategoryName.trim();
    if (!name) {
      toast.error("Введите название категории");
      return;
    }
    const id = newId();
    applyNormalized([...categories, { id, name, sortOrder: categories.length }], items);
    setNewCategoryName("");
    toast.success("Категория добавлена (сохраните каталог)");
  };

  const saveCategoryName = (cat: VenueMenuCategory) => {
    const name = editingCategoryName.trim();
    if (!name) return;
    applyNormalized(
      categories.map((c) => (c.id === cat.id ? { ...c, name } : c)),
      items
    );
    setEditingCategoryId(null);
    setEditingCategoryName("");
  };

  const openDeleteCategory = (cat: VenueMenuCategory) => {
    const cnt = items.filter((i) => i.categoryId === cat.id).length;
    setConfirmState({
      open: true,
      title: "Удалить категорию",
      message:
        cnt > 0
          ? `Удалить «${cat.name}» и все позиции в ней (${cnt})?`
          : `Удалить пустую категорию «${cat.name}»?`,
      onConfirm: async () => {
        applyNormalized(
          categories.filter((c) => c.id !== cat.id),
          items.filter((i) => i.categoryId !== cat.id)
        );
        setConfirmState(null);
        toast.success("Категория удалена из черновика — нажмите «Сохранить каталог»");
      },
    });
  };

  const addItem = (categoryId: string) => {
    const sub = items.filter((i) => i.categoryId === categoryId);
    const it: VenueMenuItem = {
      id: newId(),
      categoryId,
      name: "Новая позиция",
      price: 0,
      description: "",
      active: true,
      sortOrder: sub.length,
    };
    applyNormalized(categories, [...items, it]);
  };

  const openDeleteItem = (it: VenueMenuItem) => {
    setConfirmState({
      open: true,
      title: "Удалить позицию",
      message: `Удалить «${it.name}» из каталога?`,
      onConfirm: async () => {
        applyNormalized(
          categories,
          items.filter((i) => i.id !== it.id)
        );
        setConfirmState(null);
        toast.success("Позиция удалена — сохраните каталог");
      },
    });
  };

  const reorderCategories = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const fromIdx = categories.findIndex((c) => c.id === fromId);
    const toIdx = categories.findIndex((c) => c.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...categories];
    const [r] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, r);
    applyNormalized(next, items);
  };

  const moveItemToCategory = (itemId: string, targetCategoryId: string) => {
    const it = items.find((i) => i.id === itemId);
    if (!it || it.categoryId === targetCategoryId) return;
    const others = items.filter((i) => i.id !== itemId);
    const inTarget = others.filter((i) => i.categoryId === targetCategoryId);
    const moved = {
      ...it,
      categoryId: targetCategoryId,
      sortOrder: inTarget.length,
    };
    applyNormalized(categories, [...others, moved]);
  };

  const onDragStartCategory = (id: string) => {
    dragPayloadRef.current = { kind: "category", id };
  };

  const onDragStartItem = (id: string, fromCategoryId: string) => {
    dragPayloadRef.current = { kind: "item", id, fromCategoryId };
  };

  const onDragEnd = () => {
    dragPayloadRef.current = null;
  };

  const onDropOnCategory = (e: React.DragEvent, targetCategoryId: string) => {
    e.preventDefault();
    const p = dragPayloadRef.current;
    dragPayloadRef.current = null;
    if (!p || p.kind !== "item") return;
    moveItemToCategory(p.id, targetCategoryId);
  };

  const onDropCategoryOnCategory = (e: React.DragEvent, targetCategoryId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const p = dragPayloadRef.current;
    if (!p || p.kind !== "category") return;
    reorderCategories(p.id, targetCategoryId);
    dragPayloadRef.current = null;
  };

  const onDropItemOnItem = (e: React.DragEvent, categoryId: string, targetItemId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const p = dragPayloadRef.current;
    dragPayloadRef.current = null;
    if (!p || p.kind !== "item") return;

    const next = items.map((i) => ({ ...i }));
    const dragged = next.find((i) => i.id === p.id);
    if (!dragged) return;
    dragged.categoryId = categoryId;

    const sub = next
      .filter((i) => i.categoryId === categoryId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const others = next.filter((i) => i.categoryId !== categoryId);
    const without = sub.filter((i) => i.id !== p.id);
    const toIdx = without.findIndex((i) => i.id === targetItemId);
    if (toIdx < 0) return;
    const reordered = [...without.slice(0, toIdx), dragged, ...without.slice(toIdx)];
    const reindexed = reordered.map((it, idx) => ({ ...it, sortOrder: idx }));
    applyNormalized(categories, [...others, ...reindexed]);
  };

  const uploadPhoto = async (itemId: string, file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Нужен файл изображения");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      toast.error("Файл больше 6 МБ");
      return;
    }
    setUploadingItemId(itemId);
    try {
      const safe = `${Date.now()}_${file.name.replace(/[^\w.\-]/g, "_")}`;
      const r = ref(storage, `venues/${VENUE_ID}/menu/${safe}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      patchItem(itemId, { imageUrl: url });
      toast.success("Фото загружено");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка загрузки в Storage");
    } finally {
      setUploadingItemId(null);
    }
  };

  const seedDemo = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const catId = newId();
      const itemId = newId();
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
      await reload();
      setMessage({ type: "ok", text: "Добавлен пример. Отредактируйте и нажмите «Сохранить каталог»." });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setSaving(false);
    }
  };

  const saveCatalog = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const normalized = normalizeCatalog(categories, items);
      const prev = prevActiveByItemIdRef.current;
      const changes: { dishName: string; active: boolean }[] = [];
      for (const it of normalized.items) {
        const next = itemEffectiveActive(it);
        if (!prev.has(it.id)) continue;
        const was = prev.get(it.id)!;
        if (was !== next) changes.push({ dishName: it.name, active: next });
      }

      await setDoc(
        MENU_DOC(),
        {
          categories: normalized.categories,
          items: normalized.items,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setCategories(normalized.categories);
      setItems(normalized.items);

      const nextMap = new Map<string, boolean>();
      for (const it of normalized.items) nextMap.set(it.id, itemEffectiveActive(it));
      prevActiveByItemIdRef.current = nextMap;

      if (changes.length > 0) {
        const res = await fetch("/api/admin/venue/menu-stoplist-notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ venueId: VENUE_ID, changes }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; notified?: number };
        if (!res.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Не удалось уведомить персонал");
        }
        setMessage({
          type: "ok",
          text: `Каталог сохранён в Firestore. Уведомления о стоп-листе: ${data.notified ?? changes.length}.`,
        });
      } else {
        setMessage({ type: "ok", text: "Каталог сохранён. Изменений «В продаже / Стоп» с прошлого сохранения не было." });
      }
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Ошибка сохранения" });
    } finally {
      setSaving(false);
    }
  }, [categories, items]);

  if (!loaded) return <p className="mt-3 text-sm text-gray-500">Загрузка конструктора…</p>;

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/40 p-5">
      <h4 className="flex items-center gap-2 font-medium text-gray-900">
        <LayoutGrid className="h-5 w-5 text-gray-500" />
        Графический каталог (предзаказ / витрина)
      </h4>
      <p className="mt-1 text-sm text-gray-500">
        Структура хранится в <span className="font-mono text-xs">venues/{VENUE_ID}/configs/menu</span>. Можно использовать
        только этот каталог, только PDF выше, или оба сразу.
      </p>
      <p className="mt-2 text-xs text-gray-500">
        Перетаскивайте <GripVertical className="inline h-3 w-3" /> категории и блюда. Блюдо можно бросить на другую
        категорию или на карточку внутри неё.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 min-h-[40px]">
        <input
          type="text"
          placeholder="Название категории (Завтраки, Напитки…)"
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addCategory()}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm w-56 max-w-full flex-shrink-0"
        />
        <button
          type="button"
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
          onClick={addCategory}
        >
          <Plus className="h-4 w-4" />
          Добавить категорию
        </button>
        {categories.length === 0 && items.length === 0 ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => void seedDemo()}
            className="text-sm text-amber-800 underline decoration-amber-600 hover:text-amber-950 disabled:opacity-50"
          >
            Заполнить демо (Борщ)
          </button>
        ) : null}
      </div>

      <div className="mt-6 space-y-6">
        {categories.map((cat) => {
          const hallItems = items
            .filter((i) => i.categoryId === cat.id)
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
          return (
            <div
              key={cat.id}
              className="rounded-lg border border-gray-200 bg-gray-50/50 p-4"
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => onDropOnCategory(e, cat.id)}
            >
              <div
                className="flex items-center justify-between gap-2"
                onDragOver={(e) => {
                  if (dragPayloadRef.current?.kind === "category") e.preventDefault();
                }}
                onDrop={(e) => {
                  if (dragPayloadRef.current?.kind === "category") {
                    onDropCategoryOnCategory(e, cat.id);
                  }
                }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    draggable
                    onDragStart={() => onDragStartCategory(cat.id)}
                    onDragEnd={onDragEnd}
                    title="Перетащить категорию"
                    className="cursor-grab rounded p-1 text-gray-400 hover:bg-gray-200 active:cursor-grabbing"
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                  <LayoutGrid className="h-4 w-4 shrink-0 text-gray-500" />
                  {editingCategoryId === cat.id ? (
                    <input
                      type="text"
                      value={editingCategoryName}
                      onChange={(e) => setEditingCategoryName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveCategoryName(cat);
                        if (e.key === "Escape") {
                          setEditingCategoryId(null);
                          setEditingCategoryName("");
                        }
                      }}
                      className="rounded border border-gray-300 px-2 py-1 text-sm w-48 max-w-[50vw]"
                      autoFocus
                    />
                  ) : (
                    <h5 className="font-medium text-gray-900 truncate">{cat.name}</h5>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  {editingCategoryId === cat.id ? (
                    <>
                      <button
                        type="button"
                        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                        onClick={() => saveCategoryName(cat)}
                      >
                        Сохранить
                      </button>
                      <button
                        type="button"
                        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                        onClick={() => {
                          setEditingCategoryId(null);
                          setEditingCategoryName("");
                        }}
                      >
                        Отмена
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="rounded p-1 text-gray-500 hover:bg-gray-200"
                        onClick={() => {
                          setEditingCategoryId(cat.id);
                          setEditingCategoryName(cat.name);
                        }}
                        title="Переименовать"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 text-gray-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => openDeleteCategory(cat)}
                        title="Удалить категорию"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => addItem(cat.id)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Добавить позицию
                </button>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {hallItems.map((it) => {
                  const on = itemEffectiveActive(it);
                  return (
                    <div
                      key={it.id}
                      className="flex flex-col rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => onDropItemOnItem(e, cat.id, it.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          draggable
                          onDragStart={() => onDragStartItem(it.id, cat.id)}
                          onDragEnd={onDragEnd}
                          className="cursor-grab rounded p-1 text-gray-400 hover:bg-gray-100 active:cursor-grabbing"
                          title="Перетащить позицию"
                        >
                          <GripVertical className="h-4 w-4" />
                        </button>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            className="rounded p-1 text-gray-500 hover:text-red-600 hover:bg-red-50"
                            onClick={() => openDeleteItem(it)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 aspect-video w-full overflow-hidden rounded-md bg-gray-100">
                        {it.imageUrl ? (
                          <img src={it.imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-gray-400">
                            <ImageIcon className="h-10 w-10" />
                          </div>
                        )}
                      </div>
                      <label className="mt-2 flex cursor-pointer flex-col">
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          disabled={uploadingItemId === it.id}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (f) void uploadPhoto(it.id, f);
                          }}
                        />
                        <span className="flex items-center justify-center gap-2 rounded border border-dashed border-gray-300 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                          {uploadingItemId === it.id ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Загрузка…
                            </>
                          ) : (
                            <>
                              <ImageIcon className="h-3.5 w-3.5" />
                              Фото
                            </>
                          )}
                        </span>
                      </label>

                      <label className="mt-2 block text-xs text-gray-600">
                        Название
                        <input
                          type="text"
                          value={it.name}
                          onChange={(e) => patchItem(it.id, { name: e.target.value })}
                          className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
                        />
                      </label>
                      <label className="mt-2 block text-xs text-gray-600">
                        Цена (₽)
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={Number.isFinite(it.price) ? it.price : 0}
                          onChange={(e) => patchItem(it.id, { price: Math.max(0, Number(e.target.value) || 0) })}
                          className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
                        />
                      </label>
                      <label className="mt-2 block text-xs text-gray-600">
                        Описание
                        <textarea
                          value={it.description ?? ""}
                          onChange={(e) => patchItem(it.id, { description: e.target.value })}
                          rows={2}
                          className="mt-0.5 w-full resize-y rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
                        />
                      </label>

                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
                        <span className={`text-xs font-semibold ${on ? "text-green-700" : "text-red-700"}`}>
                          {on ? "В продаже" : "Стоп-лист"}
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          onClick={() => patchItem(it.id, { active: !on })}
                          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 ${
                            on ? "bg-green-600" : "bg-gray-400"
                          }`}
                        >
                          <span
                            className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                              on ? "translate-x-[1.5rem]" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {categories.length === 0 ? (
          <p className="text-sm text-gray-500">Нет категорий. Добавьте первую категорию — как зал в разделе выше.</p>
        ) : null}
      </div>

      <button
        type="button"
        disabled={saving || categories.length === 0}
        onClick={() => void saveCatalog()}
        className="mt-6 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {saving ? "Сохранение…" : "Сохранить каталог и уведомить персонал"}
      </button>

      {message ? (
        <p className={`mt-3 text-sm ${message.type === "ok" ? "text-green-700" : "text-red-600"}`}>{message.text}</p>
      ) : null}

      {confirmState ? (
        <ConfirmModal
          open={confirmState.open}
          title={confirmState.title}
          message={confirmState.message}
          variant="danger"
          confirmLabel="УДАЛИТЬ"
          cancelLabel="ОТМЕНА"
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      ) : null}
    </div>
  );
}
