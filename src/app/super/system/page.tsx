"use client";

/**
 * Супер-админ: «Система» — только глобальная реклама Mini App (super_ads_catalog).
 * Настройки ботов и токены — исключительно /super/bots.
 */
import { SuperAdsCatalogTab } from "@/components/super/SuperAdsCatalogTab";
import { SotaRegistryTab } from "@/components/super/SotaRegistryTab";
import { SystemSettingsTab } from "@/components/super/SystemSettingsTab";

export default function SuperSystemPage() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600 max-w-2xl">
        Рекламные слоты и таргетинг хранятся в коллекции{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono">super_ads_catalog</code>.
        Связь с ботами здесь не настраивается.
      </p>
      <SuperAdsCatalogTab />

      <SotaRegistryTab />

      <SystemSettingsTab />
    </div>
  );
}
