"use client";

/**
 * Супер-админ: «Система» — только глобальная реклама Mini App (super_ads_catalog).
 * Настройки ботов и токены — исключительно /super/bots.
 */
import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Megaphone, Database, Settings, ExternalLink } from "lucide-react";
import { SuperAdsCatalogTab } from "@/components/super/SuperAdsCatalogTab";
import { SotaExplorerTab } from "@/components/super/SotaExplorerTab";
import { SystemSettingsTab } from "@/components/super/SystemSettingsTab";

type TabId = "ad" | "explorer" | "engine";

function TabButton({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-left shadow-sm transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl ${
            active ? "bg-white/10" : "bg-slate-100"
          }`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${active ? "text-white" : "text-slate-900"}`}>{title}</p>
          <p className={`mt-1 text-xs ${active ? "text-white/80" : "text-slate-600"}`}>{subtitle}</p>
        </div>
      </div>
    </button>
  );
}

export default function SuperSystemPage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tab = (sp.get("tab") as TabId | null) ?? "explorer";

  const setTab = (next: TabId) => {
    const params = new URLSearchParams(sp.toString());
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const header = useMemo(() => {
    if (tab === "ad") return { title: "AdManager", subtitle: "Управление рекламной сетью Mini App" };
    if (tab === "engine") return { title: "System Engine", subtitle: "Глобальные настройки, рубильники, ключи" };
    return { title: "SOTA‑Explorer", subtitle: "База данных: VR / SW / GP" };
  }, [tab]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{header.title}</h1>
            <p className="mt-1 text-sm text-slate-600">{header.subtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="/super/bots"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ExternalLink className="h-4 w-4" />
              Bots
            </a>
            <a
              href="/super/infrastructure"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ExternalLink className="h-4 w-4" />
              Infrastructure
            </a>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <TabButton
          active={tab === "ad"}
          onClick={() => setTab("ad")}
          icon={<Megaphone className={`h-5 w-5 ${tab === "ad" ? "text-white" : "text-slate-700"}`} />}
          title="AdManager"
          subtitle="Штаб маркетинга"
        />
        <TabButton
          active={tab === "explorer"}
          onClick={() => setTab("explorer")}
          icon={<Database className={`h-5 w-5 ${tab === "explorer" ? "text-white" : "text-slate-700"}`} />}
          title="SOTA‑Explorer"
          subtitle="Реестр и трудовая книжка"
        />
        <TabButton
          active={tab === "engine"}
          onClick={() => setTab("engine")}
          icon={<Settings className={`h-5 w-5 ${tab === "engine" ? "text-white" : "text-slate-700"}`} />}
          title="System Engine"
          subtitle="Капот системы"
        />
      </div>

      {tab === "ad" ? (
        <SuperAdsCatalogTab />
      ) : tab === "engine" ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-semibold text-slate-900">Системные переменные</h3>
            <p className="mt-1 text-sm text-slate-600">
              Источник правды: <span className="font-mono">system_settings/global</span>. Изменения применяются к гостевому Mini App в real-time.
            </p>
          </div>
          <SystemSettingsTab />
        </div>
      ) : (
        <SotaExplorerTab />
      )}
    </div>
  );
}
