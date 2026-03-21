"use client";

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import type { SuperAdCatalogItem } from "@/lib/super-ads";
import { SUPER_AD_PLACEMENTS } from "@/lib/super-ads";

const PLACEMENT_LABELS: Record<string, string> = {
  mini_gateway: "Шлюз Mini App (загрузка)",
  guest_welcome: "Под приветствием гостя (стол)",
  guest_hub_between_history_promos: "Хаб: между «История» и «Акции»",
  guest_hub_between_promos_rating: "Хаб: между «Акции» и «Рейтинг»",
};

const emptyForm = {
  title: "",
  body: "",
  imageUrl: "",
  href: "",
  active: true,
  placements: [] as string[],
  sortOrder: 0,
};

export function SuperAdsCatalogTab() {
  const [ads, setAds] = useState<SuperAdCatalogItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/super/ads-catalog");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
    setAds(data.ads ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Ошибка");
      } finally {
        setLoaded(true);
      }
    })();
  }, [load]);

  const openNew = () => {
    setEditingId("new");
    setForm({ ...emptyForm });
  };

  const openEdit = (a: SuperAdCatalogItem) => {
    setEditingId(a.id);
    setForm({
      title: a.title ?? "",
      body: a.body ?? "",
      imageUrl: a.imageUrl ?? "",
      href: a.href ?? "",
      active: a.active !== false,
      placements: a.placements ?? [],
      sortOrder: a.sortOrder ?? 0,
    });
  };

  const togglePlacement = (id: string) => {
    setForm((f) => ({
      ...f,
      placements: f.placements.includes(id)
        ? f.placements.filter((x) => x !== id)
        : [...f.placements, id],
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editingId === "new") {
        const res = await fetch("/api/super/ads-catalog", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Ошибка");
        toast.success("Объявление создано");
      } else if (editingId) {
        const res = await fetch(`/api/super/ads-catalog/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Ошибка");
        toast.success("Сохранено");
      }
      setEditingId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Удалить объявление из глобального каталога?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/super/ads-catalog/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      toast.success("Удалено");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 inline-flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-slate-600" />
            Глобальный рекламный каталог
          </h2>
          <p className="mt-2 text-sm text-slate-600 max-w-2xl">
            Коллекция Firestore <code className="rounded bg-slate-100 px-1 text-xs">super_ads_catalog</code>.
            Эти объявления показываются в Mini App гостей и на шлюзе. Админы заведений не редактируют эти слоты —
            только Супер-админ.
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          Новое объявление
        </button>
      </div>

      {!loaded ? (
        <p className="mt-4 text-sm text-slate-500">Загрузка…</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="p-3 text-left text-xs font-medium text-slate-600">Заголовок</th>
                <th className="p-3 text-left text-xs font-medium text-slate-600">Слоты</th>
                <th className="p-3 text-left text-xs font-medium text-slate-600">Активно</th>
                <th className="p-3 text-left text-xs font-medium text-slate-600">Порядок</th>
                <th className="p-3 text-left text-xs font-medium text-slate-600">Действия</th>
              </tr>
            </thead>
            <tbody>
              {ads.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-sm text-slate-500">
                    Нет объявлений. Добавьте записи — они попадут в ротацию на слотах Mini App.
                  </td>
                </tr>
              ) : (
                ads.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100">
                    <td className="p-3 text-sm text-slate-900 max-w-xs">
                      {a.title || <span className="text-slate-400">(без заголовка)</span>}
                    </td>
                    <td className="p-3 text-xs text-slate-600">
                      {!a.placements?.length ? (
                        <span title="Все слоты">все</span>
                      ) : (
                        a.placements.join(", ")
                      )}
                    </td>
                    <td className="p-3 text-sm">{a.active !== false ? "да" : "нет"}</td>
                    <td className="p-3 text-sm">{a.sortOrder ?? 0}</td>
                    <td className="p-3 flex gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                        onClick={() => openEdit(a)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Изменить
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                        onClick={() => remove(a.id)}
                        disabled={deletingId === a.id}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {deletingId === a.id ? "…" : "Удалить"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">
              {editingId === "new" ? "Новое объявление" : "Редактирование"}
            </h3>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-medium text-slate-600">Заголовок</label>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
              <label className="block text-xs font-medium text-slate-600">Текст</label>
              <textarea
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                rows={3}
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              />
              <label className="block text-xs font-medium text-slate-600">URL картинки</label>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.imageUrl}
                onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
              />
              <label className="block text-xs font-medium text-slate-600">Ссылка (клик)</label>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.href}
                onChange={(e) => setForm((f) => ({ ...f, href: e.target.value }))}
              />
              <label className="block text-xs font-medium text-slate-600">Порядок сортировки</label>
              <input
                type="number"
                className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) || 0 }))}
              />
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                />
                Активно
              </label>
              <div>
                <p className="text-xs font-medium text-slate-600">Слоты (пусто = все слоты)</p>
                <div className="mt-2 space-y-2">
                  {SUPER_AD_PLACEMENTS.map((pid) => (
                    <label key={pid} className="flex items-start gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.placements.includes(pid)}
                        onChange={() => togglePlacement(pid)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-mono text-xs text-slate-500">{pid}</span>
                        <br />
                        <span className="text-xs text-slate-500">{PLACEMENT_LABELS[pid] ?? ""}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => setEditingId(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                onClick={() => void save()}
              >
                {saving ? "…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
