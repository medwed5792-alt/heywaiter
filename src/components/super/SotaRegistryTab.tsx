"use client";

import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { withSuperAdminAuthHeaders } from "@/components/super/super-auth";

type RegistryKind = "venue" | "staff" | "guest";

type SearchResult = {
  kind: RegistryKind;
  docId: string;
  sotaId: string | null;
  venueId: string | null;
  displayName: string | null;
};

export function SotaRegistryTab() {
  const [prefix, setPrefix] = useState<"VR" | "SW" | "GP" | "GN">("VR");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);

  const [selected, setSelected] = useState<{ kind: RegistryKind; docId: string } | null>(null);
  const [selectedData, setSelectedData] = useState<Record<string, unknown> | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  const effectiveQuery = useMemo(() => (q.trim().toUpperCase() ? q.trim().toUpperCase() : prefix), [q, prefix]);

  const search = async () => {
    const queryStr = q.trim().toUpperCase();
    if (queryStr.length < 2) {
      toast.error("Введите минимум 2 символа SOTA-ID");
      return;
    }
    setLoading(true);
    setResults([]);
    setSelected(null);
    setSelectedData(null);
    try {
      const url = `/api/super/sota-registry/search?prefix=${encodeURIComponent(prefix)}&q=${encodeURIComponent(queryStr)}`;
      const res = await fetch(url, await withSuperAdminAuthHeaders({ cache: "no-store" }));
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; results?: SearchResult[]; error?: string };
      if (!res.ok || data.ok !== true) throw new Error(data.error || "Ошибка поиска");
      setResults(data.results ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  const openCard = async (r: SearchResult) => {
    setSelected({ kind: r.kind, docId: r.docId });
    setSelectedData(null);
    setSelectedLoading(true);
    try {
      const url = `/api/super/sota-registry/item?kind=${encodeURIComponent(r.kind)}&docId=${encodeURIComponent(r.docId)}`;
      const res = await fetch(url, await withSuperAdminAuthHeaders({ cache: "no-store" }));
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: Record<string, unknown>; error?: string };
      if (!res.ok || data.ok !== true) throw new Error(data.error || "Ошибка загрузки карточки");
      setSelectedData(data.data ?? {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSelectedLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-900">Реестр SOTA-ID</h3>
      <p className="mt-1 text-sm text-slate-600">
        Поиск по префиксам: <span className="font-mono">VR</span> (заведения), <span className="font-mono">SW</span> (персонал),
        <span className="font-mono">GP/GN</span> (гости). Только просмотр для аудита.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Префикс</span>
          <select
            value={prefix}
            onChange={(e) => setPrefix(e.target.value as any)}
            className="mt-1 w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="VR">VR (venues)</option>
            <option value="SW">SW (staff)</option>
            <option value="GP">GP (guests)</option>
            <option value="GN">GN (guests)</option>
          </select>
        </label>
        <label className="block flex-1">
          <span className="text-xs font-medium text-slate-600">SOTA-ID или префикс</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
            placeholder={`${effectiveQuery}...`}
          />
        </label>
        <button
          type="button"
          onClick={() => void search()}
          disabled={loading}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "…" : "Поиск"}
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Результаты</p>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {results.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Нет результатов.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {results.map((r) => (
                  <li key={`${r.kind}-${r.docId}`} className="p-3">
                    <button
                      type="button"
                      onClick={() => void openCard(r)}
                      className="w-full text-left"
                    >
                      <p className="text-sm font-semibold text-slate-900">
                        {r.sotaId ?? "—"}{" "}
                        <span className="ml-2 text-xs font-mono text-slate-500">{r.kind}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-600">
                        {r.displayName ?? "—"} · docId: <span className="font-mono">{r.docId}</span>
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Карточка (read-only)</p>
          </div>
          <div className="p-4">
            {!selected ? (
              <p className="text-sm text-slate-500">Выберите ID из списка.</p>
            ) : selectedLoading ? (
              <p className="text-sm text-slate-500">Загрузка…</p>
            ) : (
              <pre className="max-h-[420px] overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
{JSON.stringify(selectedData ?? {}, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

