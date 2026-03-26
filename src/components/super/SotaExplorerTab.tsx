"use client";

import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Building2, Shield, UserRound, ExternalLink, Database, ChevronDown, ChevronUp } from "lucide-react";
import { withSuperAdminAuthHeaders } from "@/components/super/super-auth";
import { SuperStaffCatalogTab } from "@/components/super/SuperStaffCatalogTab";
import { GuestLoyaltyCard } from "@/components/super/GuestLoyaltyCard";

type RegistryPrefix = "VR" | "SW" | "GP" | "GN";
type RegistryKind = "venue" | "staff" | "guest";

type SearchResult = {
  kind: RegistryKind;
  docId: string;
  sotaId: string | null;
  venueId: string | null;
  displayName: string | null;
};

type ItemResponse = { ok?: boolean; data?: Record<string, unknown>; error?: string };

function detectPrefix(input: string): RegistryPrefix | null {
  const v = input.trim().toUpperCase();
  if (v.startsWith("VR")) return "VR";
  if (v.startsWith("SW")) return "SW";
  if (v.startsWith("GP")) return "GP";
  if (v.startsWith("GN")) return "GN";
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function toMillis(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  if (isRecord(v) && typeof v.seconds === "number") return v.seconds * 1000;
  return null;
}

function formatTenure(createdAt: unknown): string | null {
  const ms = toMillis(createdAt);
  if (!ms) return null;
  const days = Math.max(0, Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24)));
  if (days < 30) return `${days} дн.`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months} мес.`;
  const years = Math.floor(months / 12);
  return `${years} г.`;
}

function Chip({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "amber" | "blue" }) {
  const cls =
    tone === "green"
      ? "bg-green-50 text-green-700 border-green-200"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : tone === "blue"
          ? "bg-blue-50 text-blue-700 border-blue-200"
          : "bg-slate-50 text-slate-700 border-slate-200";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${cls}`}>{children}</span>;
}

function KeyValue({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k}</div>
      <div className="text-sm text-slate-900 text-right">{v}</div>
    </div>
  );
}

export function SotaExplorerTab() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);

  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [selectedData, setSelectedData] = useState<Record<string, unknown> | null>(null);
  const [linkedUser, setLinkedUser] = useState<Record<string, unknown> | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const effectivePrefix = useMemo<RegistryPrefix>(() => detectPrefix(q) ?? "VR", [q]);
  const normalizedQ = useMemo(() => q.trim().toUpperCase(), [q]);

  const search = async () => {
    if (normalizedQ.length < 2) {
      toast.error("Введите минимум 2 символа SOTA-ID");
      return;
    }
    const prefix = detectPrefix(normalizedQ) ?? effectivePrefix;
    setLoading(true);
    setResults([]);
    setSelected(null);
    setSelectedData(null);
    setLinkedUser(null);
    setRawOpen(false);
    try {
      const url = `/api/super/sota-registry/search?prefix=${encodeURIComponent(prefix)}&q=${encodeURIComponent(normalizedQ)}`;
      const res = await fetch(url, await withSuperAdminAuthHeaders({ cache: "no-store" }));
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; results?: SearchResult[]; error?: string };
      if (!res.ok || data.ok !== true) throw new Error(data.error || "Ошибка поиска");
      setResults(data.results ?? []);
      if ((data.results ?? []).length === 0) toast("Нет совпадений");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  const loadItem = async (kind: RegistryKind, docId: string): Promise<Record<string, unknown>> => {
    const url = `/api/super/sota-registry/item?kind=${encodeURIComponent(kind)}&docId=${encodeURIComponent(docId)}`;
    const res = await fetch(url, await withSuperAdminAuthHeaders({ cache: "no-store" }));
    const data = (await res.json().catch(() => ({}))) as ItemResponse;
    if (!res.ok || data.ok !== true) throw new Error(data.error || "Ошибка загрузки карточки");
    return data.data ?? {};
  };

  const openCard = async (r: SearchResult) => {
    setSelected(r);
    setSelectedLoading(true);
    setSelectedData(null);
    setLinkedUser(null);
    setRawOpen(false);
    try {
      const data = await loadItem(r.kind, r.docId);
      setSelectedData(data);

      // SW: доп. подтягиваем global_users/{userId} для “трудовой книжки”
      if (r.kind === "staff") {
        const userId = isRecord(data) ? (data.userId as string | undefined) : undefined;
        if (userId && userId.trim()) {
          const userDoc = await loadItem("guest", userId.trim());
          setLinkedUser(userDoc);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSelectedLoading(false);
    }
  };

  const title = useMemo(() => {
    if (!selected) return null;
    const kind = selected.kind;
    if (kind === "venue") return "Карточка заведения (VR)";
    if (kind === "staff") return "Трудовая книжка (SW)";
    return "Карточка гостя (GP/GN)";
  }, [selected]);

  const icon = useMemo(() => {
    if (!selected) return null;
    if (selected.kind === "venue") return <Building2 className="h-4 w-4" />;
    if (selected.kind === "staff") return <Shield className="h-4 w-4" />;
    return <UserRound className="h-4 w-4" />;
  }, [selected]);

  const card = useMemo(() => {
    if (!selected || !selectedData) return null;

    if (selected.kind === "venue") {
      const name = pickString(selectedData, ["title", "name", "displayName"]) ?? selected.displayName ?? selected.sotaId ?? selected.docId;
      const logoUrl = pickString(selectedData, ["logoUrl", "photoUrl", "imageUrl", "avatarUrl"]);
      const address =
        pickString(selectedData, ["address", "addressText", "fullAddress"]) ??
        pickString(selectedData, ["city", "street"]) ??
        null;

      return (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-slate-100 flex items-center justify-center">
              {logoUrl ? <img src={logoUrl} alt="" className="h-full w-full object-cover" /> : <Building2 className="h-7 w-7 text-slate-500" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold text-slate-900 truncate">{name}</p>
                <Chip tone="green">В сети</Chip>
              </div>
              <p className="mt-1 text-xs font-mono text-slate-500">{selected.sotaId ?? selected.docId}</p>
              <p className="mt-2 text-sm text-slate-700">{address ?? "Адрес не указан"}</p>
            </div>
          </div>
          <div className="mt-4">
            <KeyValue k="docId" v={<span className="font-mono">{selected.docId}</span>} />
            <KeyValue k="тип" v={<span className="font-mono">VR</span>} />
          </div>
        </div>
      );
    }

    if (selected.kind === "staff") {
      const staffVenueId = pickString(selectedData, ["venueId"]) ?? selected.venueId ?? null;
      const position = pickString(selectedData, ["role", "position", "staffRole"]);

      const personName =
        (linkedUser ? pickString(linkedUser, ["displayName", "fullName"]) : null) ??
        pickString(selectedData, ["displayName", "fullName"]) ??
        selected.displayName ??
        selected.sotaId ??
        selected.docId;

      const photoUrl = (linkedUser ? pickString(linkedUser, ["photoUrl", "avatarUrl"]) : null) ?? pickString(selectedData, ["photoUrl", "avatarUrl"]);
      const score = linkedUser && typeof linkedUser.globalScore === "number" ? linkedUser.globalScore : null;
      const createdAt = linkedUser?.createdAt ?? selectedData.createdAt;
      const tenure = formatTenure(createdAt);
      const affiliations = (linkedUser?.affiliations as any[] | undefined) ?? [];

      return (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-slate-100 flex items-center justify-center">
              {photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : <Shield className="h-7 w-7 text-slate-500" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold text-slate-900 truncate">{personName}</p>
                {typeof score === "number" ? <Chip tone="amber">Рейтинг: {score}</Chip> : <Chip>Рейтинг: —</Chip>}
                {tenure ? <Chip tone="blue">Стаж: {tenure}</Chip> : null}
              </div>
              <p className="mt-1 text-xs font-mono text-slate-500">{selected.sotaId ?? selected.docId}</p>
              <p className="mt-2 text-sm text-slate-700">
                Текущее место:{" "}
                <span className="font-mono text-slate-900">{staffVenueId ?? "—"}</span>
                {position ? <span className="text-slate-500"> · {position}</span> : null}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">История перемещений (affiliations)</p>
            {affiliations.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">Нет данных.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {affiliations.map((a, idx) => {
                  const venueId = typeof a?.venueId === "string" ? a.venueId : "—";
                  const role = typeof a?.role === "string" ? a.role : typeof a?.position === "string" ? a.position : "—";
                  const status = typeof a?.status === "string" ? a.status : "—";
                  return (
                    <li key={`${venueId}-${idx}`} className="rounded-lg bg-white border border-slate-200 px-3 py-2">
                      <p className="text-sm text-slate-900">
                        <span className="font-mono">{venueId}</span>
                        <span className="text-slate-500"> · {role}</span>
                      </p>
                      <p className="text-xs text-slate-600">Статус: {status}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mt-4">
            <KeyValue k="docId" v={<span className="font-mono">{selected.docId}</span>} />
            <KeyValue k="тип" v={<span className="font-mono">SW</span>} />
            {staffVenueId ? <KeyValue k="venueId" v={<span className="font-mono">{staffVenueId}</span>} /> : null}
          </div>
        </div>
      );
    }

    // guest
    const name =
      pickString(selectedData, ["displayName", "fullName"]) ?? selected.displayName ?? selected.sotaId ?? selected.docId;
    const photoUrl = pickString(selectedData, ["photoUrl", "avatarUrl"]);

    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-slate-100 flex items-center justify-center">
            {photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : <UserRound className="h-7 w-7 text-slate-500" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-base font-semibold text-slate-900 truncate">{name}</p>
            </div>
            <p className="mt-1 text-xs font-mono text-slate-500">{selected.sotaId ?? selected.docId}</p>
              <GuestLoyaltyCard uid={selected.docId} />
          </div>
        </div>

        <div className="mt-4">
          <KeyValue k="docId" v={<span className="font-mono">{selected.docId}</span>} />
          <KeyValue k="тип" v={<span className="font-mono">GP/GN</span>} />
        </div>
      </div>
    );
  }, [selected, selectedData, linkedUser]);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">SOTA‑Explorer</h3>
            <p className="mt-1 text-sm text-slate-600">
              Единый поиск по <span className="font-mono">VR/SW/GP/GN</span>. Формат карточки выбирается автоматически по префиксу.
            </p>
          </div>
          <a
            href="/super/catalog"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ExternalLink className="h-4 w-4" />
            Каталог персонала
          </a>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block flex-1">
            <span className="text-xs font-medium text-slate-600">Глобальный поиск</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void search();
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              placeholder="VR..., SW..., GP..., GN..."
            />
          </label>
          <button
            type="button"
            onClick={() => void search()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "…" : "Поиск"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Chip>Авто‑префикс: {effectivePrefix}</Chip>
          <Chip tone="blue">Режим: read‑only</Chip>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Результаты</p>
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            {results.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">Нет результатов.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {results.map((r) => (
                  <li key={`${r.kind}-${r.docId}`} className="p-4">
                    <button type="button" onClick={() => void openCard(r)} className="w-full text-left">
                      <p className="text-sm font-semibold text-slate-900">
                        <span className="font-mono">{r.sotaId ?? "—"}</span>
                        <span className="ml-2 text-xs font-mono text-slate-500">{r.kind}</span>
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        {r.displayName ?? "—"} · docId: <span className="font-mono">{r.docId}</span>
                      </p>
                      {r.venueId ? (
                        <p className="mt-1 text-xs text-slate-500">
                          venueId: <span className="font-mono">{r.venueId}</span>
                        </p>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Карточка</p>
              {selected ? (
                <span className="inline-flex items-center gap-2 text-xs font-mono text-slate-600">
                  {icon}
                  {title}
                </span>
              ) : null}
            </div>
            <div className="p-5">
              {!selected ? (
                <p className="text-sm text-slate-500">Выберите ID из списка.</p>
              ) : selectedLoading ? (
                <div className="space-y-3">
                  <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
                  <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
                  <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
                </div>
              ) : (
                <div className="space-y-3">
                  {card}

                  <button
                    type="button"
                    onClick={() => setRawOpen((v) => !v)}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Database className="h-4 w-4" />
                    {rawOpen ? "Скрыть Raw Data" : "Показать Raw Data"}
                    {rawOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>

                  {rawOpen ? (
                    <pre className="max-h-[360px] overflow-auto rounded-xl bg-slate-900 p-4 text-xs text-slate-100">
{JSON.stringify({ selectedData, linkedUser }, null, 2)}
                    </pre>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setCatalogOpen((v) => !v)}
              className="w-full border-b border-slate-200 bg-slate-50 px-5 py-3 flex items-center justify-between gap-3"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Трудовая книжка (полный каталог)
              </span>
              {catalogOpen ? <ChevronUp className="h-4 w-4 text-slate-600" /> : <ChevronDown className="h-4 w-4 text-slate-600" />}
            </button>
            {catalogOpen ? (
              <div className="p-5">
                <SuperStaffCatalogTab />
              </div>
            ) : (
              <div className="p-5">
                <p className="text-sm text-slate-600">
                  Для полного управления персоналом (рейтинг/удаление) раскройте блок или откройте отдельную страницу.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

