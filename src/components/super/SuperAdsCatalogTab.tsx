"use client";

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import type { SuperAdCatalogItem } from "@/lib/super-ads";
import {
  SUPER_AD_PLACEMENTS,
  SUPER_AD_TARGET_REGIONS,
  SUPER_AD_CATEGORY_PRESETS,
} from "@/lib/super-ads";

const PLACEMENT_LABELS: Record<string, string> = {
  main_ad: "Mini App гость: под кнопкой вызова (первый визит)",
  main_gate: "Mini App: под шапкой (главный слот)",
  mini_gateway: "Шлюз Mini App (загрузка)",
  guest_welcome: "Под приветствием гостя (стол)",
  guest_hub_between_history_promos: "Хаб: между «История» и «Акции»",
  guest_hub_between_promos_rating: "Хаб: между «Акции» и «Рейтинг»",
  repeat_after_scan: "Лента: после сканера",
  repeat_after_places: "Лента: после «Мои места»",
  repeat_after_promos: "Лента: после «Акции»",
  repeat_after_rating: "Лента: после «Рейтинг»",
};

const DAY_LABELS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"] as const;

const TIMEZONES = [
  "Europe/Moscow",
  "Europe/Kaliningrad",
  "Europe/Samara",
  "Asia/Yekaterinburg",
  "Asia/Omsk",
  "Asia/Krasnoyarsk",
  "Asia/Irkutsk",
  "Asia/Vladivostok",
  "UTC",
];

const VENUE_LEVELS = [1, 2, 3, 4, 5] as const;

type FormState = {
  title: string;
  body: string;
  imageUrl: string;
  href: string;
  active: boolean;
  placements: string[];
  sortOrder: number;
  regions: string[];
  venueLevels: number[];
  category: string;
  isGlobalReserve: boolean;
  scheduleDays: number[];
  scheduleStart: string;
  scheduleEnd: string;
  scheduleTz: string;
};

const emptyForm = (): FormState => ({
  title: "",
  body: "",
  imageUrl: "",
  href: "",
  active: true,
  placements: [],
  sortOrder: 0,
  regions: [],
  venueLevels: [],
  category: "",
  isGlobalReserve: false,
  scheduleDays: [],
  scheduleStart: "",
  scheduleEnd: "",
  scheduleTz: "Europe/Moscow",
});

function buildSchedulePayload(f: FormState): Record<string, unknown> | undefined {
  const hasDays = f.scheduleDays.length > 0;
  const hasTime = Boolean(f.scheduleStart.trim() || f.scheduleEnd.trim());
  if (!hasDays && !hasTime) return undefined;
  const o: Record<string, unknown> = {
    timezone: f.scheduleTz.trim() || "Europe/Moscow",
  };
  if (hasDays) o.daysOfWeek = [...f.scheduleDays].sort((a, b) => a - b);
  if (f.scheduleStart.trim()) o.startTime = f.scheduleStart.trim();
  if (f.scheduleEnd.trim()) o.endTime = f.scheduleEnd.trim();
  return o;
}

function itemToForm(a: SuperAdCatalogItem): FormState {
  const sch = a.schedule;
  return {
    title: a.title ?? "",
    body: a.body ?? "",
    imageUrl: a.imageUrl ?? "",
    href: a.href ?? "",
    active: a.active !== false,
    placements: a.placements ?? [],
    sortOrder: a.sortOrder ?? 0,
    regions: a.regions ?? [],
    venueLevels: a.venueLevels ?? [],
    category: a.category ?? "",
    isGlobalReserve: a.isGlobalReserve === true,
    scheduleDays: sch?.daysOfWeek ? [...sch.daysOfWeek] : [],
    scheduleStart: sch?.startTime ?? "",
    scheduleEnd: sch?.endTime ?? "",
    scheduleTz: sch?.timezone ?? "Europe/Moscow",
  };
}

export function SuperAdsCatalogTab() {
  const [ads, setAds] = useState<SuperAdCatalogItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
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
    setForm(emptyForm());
  };

  const openEdit = (a: SuperAdCatalogItem) => {
    setEditingId(a.id);
    setForm(itemToForm(a));
  };

  const togglePlacement = (id: string) => {
    setForm((f) => ({
      ...f,
      placements: f.placements.includes(id)
        ? f.placements.filter((x) => x !== id)
        : [...f.placements, id],
    }));
  };

  const toggleLevel = (n: number) => {
    setForm((f) => ({
      ...f,
      venueLevels: f.venueLevels.includes(n)
        ? f.venueLevels.filter((x) => x !== n)
        : [...f.venueLevels, n].sort((a, b) => a - b),
    }));
  };

  const toggleScheduleDay = (d: number) => {
    setForm((f) => ({
      ...f,
      scheduleDays: f.scheduleDays.includes(d)
        ? f.scheduleDays.filter((x) => x !== d)
        : [...f.scheduleDays, d].sort((a, b) => a - b),
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const schedule = buildSchedulePayload(form);
      const body =
        editingId === "new"
          ? {
              title: form.title,
              body: form.body,
              imageUrl: form.imageUrl,
              href: form.href,
              active: form.active,
              placements: form.placements,
              sortOrder: form.sortOrder,
              regions: form.regions,
              venueLevels: form.venueLevels,
              category: form.category,
              isGlobalReserve: form.isGlobalReserve,
              ...(schedule ? { schedule } : {}),
            }
          : {
              title: form.title,
              body: form.body,
              imageUrl: form.imageUrl,
              href: form.href,
              active: form.active,
              placements: form.placements,
              sortOrder: form.sortOrder,
              regions: form.regions,
              venueLevels: form.venueLevels,
              category: form.category,
              isGlobalReserve: form.isGlobalReserve,
              schedule: schedule ?? null,
            };
      if (editingId === "new") {
        const res = await fetch("/api/super/ads-catalog", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Ошибка");
        toast.success("Объявление создано");
      } else if (editingId) {
        const res = await fetch(`/api/super/ads-catalog/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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

  const targetingSummary = (a: SuperAdCatalogItem) => {
    const parts: string[] = [];
    if (a.isGlobalReserve) parts.push("резерв");
    if (a.regions?.length) parts.push(`регионы: ${a.regions.length}`);
    if (a.venueLevels?.length) parts.push(`★ ${a.venueLevels.join(",")}`);
    if (a.category?.trim()) parts.push(a.category);
    return parts.length ? parts.join(" · ") : "широкий";
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
            Коллекция <code className="rounded bg-slate-100 px-1 text-xs">super_ads_catalog</code>: регионы,
            уровень заведения (1–5★), тип (кафе/бар/ресторан), расписание. Баннер с флагом «Глобальный резерв»
            показывается только если нет подходящей таргетированной рекламы.
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
          <table className="w-full min-w-[960px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="p-3 text-left text-xs font-medium text-slate-600">Заголовок</th>
                <th className="p-3 text-left text-xs font-medium text-slate-600">Таргетинг</th>
                <th className="p-3 text-left text-xs font-medium text-slate-600">Слоты</th>
                <th className="p-3 text-right text-xs font-medium text-slate-600">Показы</th>
                <th className="p-3 text-right text-xs font-medium text-slate-600">Клики</th>
                <th className="p-3 text-left text-xs font-medium text-slate-600">Активно</th>
                <th className="p-3 text-left text-xs font-medium text-slate-600">Действия</th>
              </tr>
            </thead>
            <tbody>
              {ads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-sm text-slate-500">
                    Нет объявлений. Добавьте записи и отметьте хотя бы одну как «Глобальный резерв», чтобы слот не
                    пустовал.
                  </td>
                </tr>
              ) : (
                ads.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100">
                    <td className="p-3 text-sm text-slate-900 max-w-xs">
                      {a.title || <span className="text-slate-400">(без заголовка)</span>}
                    </td>
                    <td className="p-3 text-xs text-slate-600 max-w-[200px]">{targetingSummary(a)}</td>
                    <td className="p-3 text-xs text-slate-600">
                      {!a.placements?.length ? (
                        <span title="Все слоты">все</span>
                      ) : (
                        a.placements.join(", ")
                      )}
                    </td>
                    <td className="p-3 text-sm text-right tabular-nums">{a.impressions ?? 0}</td>
                    <td className="p-3 text-sm text-right tabular-nums">{a.clicks ?? 0}</td>
                    <td className="p-3 text-sm">{a.active !== false ? "да" : "нет"}</td>
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
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
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
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.isGlobalReserve}
                  onChange={(e) => setForm((f) => ({ ...f, isGlobalReserve: e.target.checked }))}
                />
                <span>
                  Глобальный резерв сети (показ только если нет подходящей таргетированной рекламы)
                </span>
              </label>

              <div>
                <p className="text-xs font-medium text-slate-600">Регионы (пусто = все города)</p>
                <select
                  multiple
                  className="mt-2 h-36 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  value={form.regions}
                  onChange={(e) => {
                    const opts = Array.from(e.target.selectedOptions).map((o) => o.value);
                    setForm((f) => ({ ...f, regions: opts }));
                  }}
                >
                  {SUPER_AD_TARGET_REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">Ctrl/Cmd + клик для нескольких регионов</p>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-600">Уровень заведения (1–5★), пусто = любой</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {VENUE_LEVELS.map((n) => (
                    <label key={n} className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.venueLevels.includes(n)}
                        onChange={() => toggleLevel(n)}
                      />
                      {n}★
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">Тип заведения</label>
                <select
                  className="mt-1 w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                >
                  {SUPER_AD_CATEGORY_PRESETS.map((o) => (
                    <option key={o.value || "__any"} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-700">Расписание показа</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Без дней и без интервала времени — круглосуточно (в зоне по умолчанию).
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {DAY_LABELS.map((label, d) => (
                    <label
                      key={d}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={form.scheduleDays.includes(d)}
                        onChange={() => toggleScheduleDay(d)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="text-xs text-slate-600">Начало (HH:mm)</label>
                    <input
                      type="text"
                      placeholder="09:00"
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      value={form.scheduleStart}
                      onChange={(e) => setForm((f) => ({ ...f, scheduleStart: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600">Конец (HH:mm)</label>
                    <input
                      type="text"
                      placeholder="23:00"
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      value={form.scheduleEnd}
                      onChange={(e) => setForm((f) => ({ ...f, scheduleEnd: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="mt-2">
                  <label className="text-xs text-slate-600">Часовой пояс</label>
                  <select
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                    value={form.scheduleTz}
                    onChange={(e) => setForm((f) => ({ ...f, scheduleTz: e.target.value }))}
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

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
