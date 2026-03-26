"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import toast from "react-hot-toast";
import { Clock, MapPin, Sparkles, Activity } from "lucide-react";
import { withSuperAdminAuthHeaders } from "@/components/super/super-auth";

type GuestLoyaltyStats = {
  ok: true;
  uid: string;
  totalVisits: number;
  topVenues: { venueId: string; venueName: string; visits: number }[];
  lastSeenAtMs: number | null;
};

function formatRuDateTime(ms: number) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
}

function loyaltyTier(totalVisits: number): { label: string; tone: "slate" | "amber" | "green" } {
  // Пороговые значения можно будет согласовать с бизнесом.
  if (totalVisits < 3) return { label: "Новичок", tone: "slate" };
  if (totalVisits < 11) return { label: "Завсегдатай", tone: "amber" };
  return { label: "Амбассадор", tone: "green" };
}

function Chip({ tone, children }: { tone: "slate" | "amber" | "green"; children: ReactNode }) {
  const cls =
    tone === "green"
      ? "bg-green-50 text-green-700 border-green-200"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-slate-50 text-slate-700 border-slate-200";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${cls}`}>{children}</span>;
}

export function GuestLoyaltyCard({ uid }: { uid: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<GuestLoyaltyStats | null>(null);

  const tier = useMemo(() => {
    const total = stats?.totalVisits ?? 0;
    return loyaltyTier(total);
  }, [stats]);

  const toggle = async () => {
    const nextOpen = !open;
    setOpen(nextOpen);

    if (!nextOpen) return;
    if (stats) return;
    if (loading) return;

    try {
      setLoading(true);
      const res = await fetch(`/api/super/guest-analytics?uid=${encodeURIComponent(uid)}`, await withSuperAdminAuthHeaders({ cache: "no-store" }));
      const data = (await res.json().catch(() => ({}))) as GuestLoyaltyStats | { ok?: boolean; error?: string };
      if (!res.ok || data.ok !== true) throw new Error("Ошибка загрузки статистики");
      setStats(data as GuestLoyaltyStats);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  const topVenues = stats?.topVenues ?? [];
  const lastSeen = stats?.lastSeenAtMs ?? null;

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-slate-700" />
            <p className="text-sm font-semibold text-slate-900">Living Loyalty Card</p>
          </div>
          <p className="mt-1 text-xs text-slate-600">Статистика подтягивается лениво при раскрытии.</p>
        </div>

        <button
          type="button"
          onClick={() => void toggle()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Activity className={`h-4 w-4 ${open ? "text-slate-900" : "text-slate-700"}`} />
          {open ? "Скрыть" : "Показать статистику"}
        </button>
      </div>

      {!open ? null : loading ? (
        <div className="mt-4 space-y-3">
          <div className="h-6 w-52 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-full animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-full animate-pulse rounded bg-slate-200" />
          <div className="h-10 w-3/4 animate-pulse rounded bg-slate-200" />
        </div>
      ) : stats ? (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-900">Всего визитов: {stats.totalVisits}</p>
            <Chip tone={tier.tone}>{tier.label}</Chip>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-slate-700" />
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Топ места</p>
            </div>
            {topVenues.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">Пока нет истории визитов.</p>
            ) : (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {topVenues.slice(0, 3).map((v) => (
                  <li key={v.venueId} className="text-sm text-slate-800">
                    <span className="font-medium">{v.venueName || v.venueId}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-slate-700" />
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Last Seen</p>
            </div>
            <p className="text-sm font-mono text-slate-900">{lastSeen ? formatRuDateTime(lastSeen) : "—"}</p>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-600">Нажмите “Показать статистику”, чтобы подгрузить данные.</p>
      )}
    </div>
  );
}

