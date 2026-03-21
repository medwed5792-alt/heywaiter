"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

/** Восемь мессенджеров (без phone — он отдельным полем). */
const MESSENGER_KEYS = ["tg", "wa", "vk", "viber", "wechat", "inst", "fb", "line"] as const;

const LABELS: Record<(typeof MESSENGER_KEYS)[number], string> = {
  tg: "Telegram ID",
  wa: "WhatsApp",
  vk: "VK",
  viber: "Viber",
  wechat: "WeChat",
  inst: "Instagram",
  fb: "Facebook",
  line: "LINE",
};

type MessengerKey = (typeof MESSENGER_KEYS)[number];

interface ProfileResponse {
  userId?: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  identities?: Record<string, string | null | undefined>;
}

interface StaffCabinetProfileProps {
  platformKey: string;
  platformId: string | null;
}

interface FormState {
  firstName: string;
  lastName: string;
  phone: string;
  identities: Record<MessengerKey, string>;
}

function emptyIdentities(): Record<MessengerKey, string> {
  return MESSENGER_KEYS.reduce((acc, k) => {
    acc[k] = "";
    return acc;
  }, {} as Record<MessengerKey, string>);
}

export function StaffCabinetProfile({ platformKey, platformId }: StaffCabinetProfileProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    firstName: "",
    lastName: "",
    phone: "",
    identities: emptyIdentities(),
  });

  const load = useCallback(async () => {
    if (!platformId) {
      setLoading(false);
      setError("Откройте приложение из мессенджера (нужен platformId).");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const q = new URLSearchParams({
        channel: platformKey,
        platformId,
      });
      const res = await fetch(`/api/staff/profile?${q.toString()}`);
      const data = (await res.json()) as ProfileResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Не удалось загрузить профиль");
      }
      const idents = data.identities ?? {};
      const nextId = emptyIdentities();
      for (const k of MESSENGER_KEYS) {
        const v = idents[k];
        nextId[k] = typeof v === "string" ? v : "";
      }
      setForm({
        firstName: data.firstName ?? "",
        lastName: data.lastName ?? "",
        phone: typeof data.phone === "string" ? data.phone : "",
        identities: nextId,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [platformKey, platformId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!platformId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const identities: Record<string, string> = {};
      for (const k of MESSENGER_KEYS) {
        if (k === platformKey) continue;
        identities[k] = form.identities[k].trim();
      }
      const res = await fetch("/api/staff/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: platformKey,
          platformId,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.replace(/\D/g, "") || "",
          identities,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "Ошибка сохранения");
      }
      await load();
      setSuccess("Сохранено");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  if (!platformId) {
    return (
      <p className="text-sm text-amber-600">
        Профиль недоступен: откройте мини-приложение из чата бота, чтобы передался идентификатор платформы.
      </p>
    );
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Загрузка профиля…</p>;
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="flex w-full items-start justify-between gap-3 rounded-2xl p-4 text-left transition-colors hover:bg-slate-50"
        aria-expanded={isExpanded}
      >
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-slate-800">Глобальная карточка</span>
          <p className="mt-0.5 text-xs text-slate-500">Имя, контакты и мессенджеры</p>
        </div>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-slate-500 transition-transform duration-300 ease-out ${
            isExpanded ? "rotate-180" : "rotate-0"
          }`}
          aria-hidden
        />
      </button>

      {(error || success) && !isExpanded && (
        <div className="border-t border-slate-100 px-4 py-2">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-emerald-600">{success}</p>}
        </div>
      )}

      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <form onSubmit={handleSubmit} className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-3">
            {(error || success) && isExpanded && (
              <div className="space-y-1">
                {error && <p className="text-sm text-red-600">{error}</p>}
                {success && <p className="text-sm text-emerald-600">{success}</p>}
              </div>
            )}
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Имя</span>
                <input
                  type="text"
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  autoComplete="given-name"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Фамилия</span>
                <input
                  type="text"
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  autoComplete="family-name"
                />
              </label>
            </fieldset>

            <label className="block">
              <span className="text-xs font-medium text-slate-600">Телефон</span>
              <input
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                autoComplete="tel"
                placeholder="+7…"
              />
            </label>

            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs font-medium text-slate-600">Мессенджеры (identities)</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {MESSENGER_KEYS.map((key) => {
                  const isAnchor = key === platformKey;
                  return (
                    <label key={key} className="block">
                      <span className="text-xs text-slate-500">
                        {LABELS[key]}
                        {isAnchor ? " (как вы вошли)" : ""}
                      </span>
                      <input
                        type="text"
                        value={form.identities[key]}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            identities: { ...f.identities, [key]: e.target.value },
                          }))
                        }
                        disabled={isAnchor}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-600"
                        placeholder={isAnchor ? "Закреплено за входом" : ""}
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => void load()}
                disabled={saving || loading}
                className="order-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:order-1"
              >
                Обновить
              </button>
              <button
                type="submit"
                disabled={saving}
                className="order-1 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:order-2 sm:w-auto sm:min-w-[12rem]"
              >
                {saving ? "Сохранение…" : "Сохранить изменения"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
