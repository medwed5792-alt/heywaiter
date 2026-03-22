"use client";

import { useId, useState, useCallback } from "react";
import { X } from "lucide-react";
import { AD_CITY_HINTS, AD_COUNTRY_HINTS } from "@/lib/ad-geo-hints";
import { normalizeRegionKey } from "@/lib/super-ads";

function dedupeAdd(list: string[], next: string): string[] {
  const k = normalizeRegionKey(next);
  if (!k) return list;
  if (list.some((x) => normalizeRegionKey(x) === k)) return list;
  return [...list, next.trim()];
}

type TagFieldProps = {
  label: string;
  description: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  hints: string[];
  placeholder: string;
};

function TagField({ label, description, tags, onChange, hints, placeholder }: TagFieldProps) {
  const id = useId();
  const listId = `${id}-datalist`;
  const [draft, setDraft] = useState("");

  const commit = useCallback(() => {
    const t = draft.trim();
    if (!t) return;
    onChange(dedupeAdd(tags, t));
    setDraft("");
  }, [draft, tags, onChange]);

  const remove = useCallback(
    (x: string) => {
      onChange(tags.filter((t) => normalizeRegionKey(t) !== normalizeRegionKey(x)));
    },
    [tags, onChange]
  );

  return (
    <div>
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{description}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          className="min-w-[12rem] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          list={listId}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
        <datalist id={listId}>
          {hints.map((h) => (
            <option key={h} value={h} />
          ))}
        </datalist>
        <button
          type="button"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          onClick={commit}
        >
          Добавить
        </button>
      </div>
      {tags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={normalizeRegionKey(t) + t}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-800"
            >
              {t}
              <button
                type="button"
                className="rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                aria-label={`Удалить ${t}`}
                onClick={() => remove(t)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-slate-400">Пусто — без ограничения по этому измерению</p>
      )}
    </div>
  );
}

type AdGeoTagFieldsProps = {
  regions: string[];
  countries: string[];
  onRegionsChange: (v: string[]) => void;
  onCountriesChange: (v: string[]) => void;
};

/**
 * Глобальный таргетинг: города/регионы и страны — произвольные строки + подсказки в datalist.
 */
export function AdGeoTagFields({ regions, countries, onRegionsChange, onCountriesChange }: AdGeoTagFieldsProps) {
  return (
    <div className="space-y-6 rounded-lg border border-slate-200 bg-slate-50/80 p-4">
      <TagField
        label="Города и регионы"
        description="Введите название и нажмите Enter или «Добавить». Можно любой город мира; подсказки неполные."
        tags={regions}
        onChange={onRegionsChange}
        hints={AD_CITY_HINTS}
        placeholder="Например: Стамбул или São Paulo"
      />
      <TagField
        label="Страны"
        description="Таргет на всю страну (например вся Турция). Название должно совпадать с полем adCountry в карточке заведения."
        tags={countries}
        onChange={onCountriesChange}
        hints={AD_COUNTRY_HINTS}
        placeholder="Например: Казахстан"
      />
    </div>
  );
}
