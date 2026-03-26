"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { withSuperAdminAuthHeaders } from "@/components/super/super-auth";

type SettingRow = { key: string; value: string };

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function isPlainKey(key: string): boolean {
  return /^[a-zA-Z0-9_.-]{1,64}$/.test(key);
}

export function SystemSettingsTab() {
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/super/system-settings", await withSuperAdminAuthHeaders());
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; settings?: Record<string, unknown>; error?: string };
        if (!res.ok || data.ok !== true) throw new Error(data.error || "Ошибка загрузки");
        const settings = data.settings ?? {};
        const nextRows = Object.entries(settings)
          .filter(([k]) => k !== "updatedAt" && k !== "updatedBy")
          .map(([k, v]) => ({ key: k, value: JSON.stringify(v) }));
        setRows(nextRows.length ? nextRows : [{ key: "adsNetworkEnabled", value: "true" }]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Ошибка");
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const invalidKeys = useMemo(() => rows.filter((r) => !isPlainKey(r.key.trim())), [rows]);

  const addRow = () => setRows((prev) => [...prev, { key: "", value: "null" }]);

  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));

  const save = async () => {
    if (invalidKeys.length > 0) {
      toast.error("Некорректные ключи (разрешены a-zA-Z0-9_.-)");
      return;
    }
    const updates: Record<string, unknown> = {};
    for (const r of rows) {
      const key = r.key.trim();
      if (!key) continue;
      updates[key] = safeJsonParse(r.value.trim());
    }

    setSaving(true);
    try {
      const res = await fetch(
        "/api/super/system-settings",
        await withSuperAdminAuthHeaders({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates }),
        })
      );
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok !== true) throw new Error(data.error || "Ошибка сохранения");
      toast.success("Сохранено");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Системные переменные</h3>
          <p className="mt-1 text-sm text-slate-600">
            Хранится в <code className="rounded bg-slate-100 px-1 text-xs">system_settings/global</code>. Значения — JSON.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={addRow}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            + Переменная
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!loaded || saving}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? "…" : "Сохранить"}
          </button>
        </div>
      </div>

      {!loaded ? (
        <p className="mt-4 text-sm text-slate-500">Загрузка…</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="p-3 text-left text-xs font-medium text-slate-600">Ключ</th>
                <th className="p-3 text-left text-xs font-medium text-slate-600">Значение (JSON)</th>
                <th className="p-3 text-left text-xs font-medium text-slate-600">Действия</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const badKey = r.key.trim() && !isPlainKey(r.key.trim());
                return (
                  <tr key={idx} className="border-b border-slate-100">
                    <td className="p-3">
                      <input
                        value={r.key}
                        onChange={(e) =>
                          setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, key: e.target.value } : x)))
                        }
                        className={`w-full rounded-lg border px-3 py-2 text-sm ${
                          badKey ? "border-red-300" : "border-slate-300"
                        }`}
                        placeholder="adsNetworkEnabled"
                      />
                    </td>
                    <td className="p-3">
                      <input
                        value={r.value}
                        onChange={(e) =>
                          setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, value: e.target.value } : x)))
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                        placeholder="true"
                      />
                    </td>
                    <td className="p-3">
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

