"use client";

import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { User, Star, Trash2, Pencil } from "lucide-react";
import type { GlobalUser } from "@/lib/types";
import { withSuperAdminAuthHeaders } from "@/components/super/super-auth";

function SuperStaffCatalogTab() {
  const [users, setUsers] = useState<GlobalUser[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editScore, setEditScore] = useState<number>(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/super/catalog", await withSuperAdminAuthHeaders());
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
        setUsers(data.users ?? []);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Ошибка");
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const handleSaveKarma = async (userId: string) => {
    try {
      const res = await fetch(
        `/api/super/catalog/${encodeURIComponent(userId)}`,
        await withSuperAdminAuthHeaders({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ globalScore: editScore }),
        })
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, globalScore: editScore } : u))
      );
      setEditingId(null);
      toast.success("Рейтинг обновлён");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm("Полностью удалить этого сотрудника из системы? Это удалит запись в global_users и все связи с заведениями.")) return;
    setDeletingId(userId);
    try {
      const res = await fetch(
        `/api/super/catalog/${encodeURIComponent(userId)}`,
        await withSuperAdminAuthHeaders({ method: "DELETE" })
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      setDeletingId(null);
      toast.success("Пользователь удалён");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
      setDeletingId(null);
    }
  };

  const displayName = (u: GlobalUser) =>
    [u.firstName, u.lastName].filter(Boolean).join(" ") ||
    u.identity?.displayName ||
    u.id;

  const affiliationsText = (u: GlobalUser) =>
    u.affiliations?.length
      ? u.affiliations.map((a) => `${a.venueId}: ${a.role ?? a.position ?? "—"} (${a.status})`).join("; ")
      : "—";

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900">Каталог персонала</h2>
      <p className="mt-2 text-sm text-slate-600">
        Весь список людей в системе (global_users). Супер-админ может редактировать рейтинг (карму) и полностью удалять запись.
      </p>

      {!loaded ? (
        <p className="mt-4 text-sm text-slate-500">Загрузка…</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="p-3 text-left text-xs font-medium text-slate-600">Человек</th>
                <th className="p-3 text-left text-xs font-medium text-slate-600">Связи (venue : роль, статус)</th>
                <th className="p-3 text-left text-xs font-medium text-slate-600">
                  <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5" /> Рейтинг</span>
                </th>
                <th className="p-3 text-left text-xs font-medium text-slate-600">Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-sm text-slate-500">
                    Нет записей в global_users.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="border-b border-slate-100">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="h-10 w-10 rounded-full overflow-hidden bg-slate-200 flex items-center justify-center shrink-0">
                          {u.photoUrl ? (
                            <img src={u.photoUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <User className="h-5 w-5 text-slate-500" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-900">{displayName(u)}</p>
                          <p className="text-xs text-slate-500">{u.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-sm text-slate-600 max-w-xs truncate" title={affiliationsText(u)}>
                      {affiliationsText(u)}
                    </td>
                    <td className="p-3">
                      {editingId === u.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            max={5}
                            step={0.1}
                            value={editScore}
                            onChange={(e) => setEditScore(Number(e.target.value))}
                            className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
                          />
                          <button
                            type="button"
                            className="rounded bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-800"
                            onClick={() => handleSaveKarma(u.id)}
                          >
                            OK
                          </button>
                          <button
                            type="button"
                            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                            onClick={() => setEditingId(null)}
                          >
                            Отмена
                          </button>
                        </div>
                      ) : (
                        <span className="text-sm">{u.globalScore != null ? String(u.globalScore) : "—"}</span>
                      )}
                    </td>
                    <td className="p-3 flex gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          setEditingId(u.id);
                          setEditScore(typeof u.globalScore === "number" ? u.globalScore : 0);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Карма
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        onClick={() => handleDelete(u.id)}
                        disabled={deletingId === u.id}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {deletingId === u.id ? "…" : "Удалить"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Каталог персонала (global_users). Реклама — /super/system. */
export default function SuperCatalogPage() {
  return <SuperStaffCatalogTab />;
}
