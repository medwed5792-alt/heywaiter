"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useGuestContext } from "@/components/mini-app/GuestMiniAppStateProvider";
type ChannelStatus = { linked: boolean; hint?: string };

type TelegramWebAppInit = {
  initData?: string;
};

function getTelegramWebApp(): TelegramWebAppInit | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebAppInit } }).Telegram?.WebApp;
}

const CHANNEL_LABELS: Record<string, string> = {
  telegram: "Telegram",
  vk: "VK",
  whatsapp: "WhatsApp",
  phone: "Телефон",
  email: "Email",
  device: "Устройство (анонимный якорь)",
};

export function GuestProfileSettings() {
  const { canonicalGuestUid } = useGuestContext();
  const [channels, setChannels] = useState<Record<string, ChannelStatus> | null>(null);
  const [resolvedUid, setResolvedUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [linkKey, setLinkKey] = useState<"phone" | "vk" | "wa">("phone");
  const [linkValue, setLinkValue] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const tg = getTelegramWebApp();
      const initData = typeof tg?.initData === "string" ? tg.initData.trim() : "";
      const res = await fetch("/api/guest/hub-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initData: initData || undefined,
          globalGuestUid: canonicalGuestUid ?? undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        globalGuestUid?: string | null;
        channels?: Record<string, ChannelStatus> | null;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "profile_load_failed");
      setResolvedUid(typeof data.globalGuestUid === "string" ? data.globalGuestUid : null);
      setChannels(data.channels ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить профиль");
      setChannels(null);
      setResolvedUid(null);
    } finally {
      setLoading(false);
    }
  }, [canonicalGuestUid]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const tg = getTelegramWebApp();
    const initData = typeof tg?.initData === "string" ? tg.initData.trim() : "";
    if (!initData) {
      toast.error("Привязка доступна в Telegram Mini App с initData");
      return;
    }
    const v = linkValue.trim();
    if (!v) {
      toast.error("Введите значение");
      return;
    }
    setLinkBusy(true);
    try {
      const res = await fetch("/api/guest/link-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, key: linkKey, value: v }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "link_failed");
      toast.success("Ключ добавлен к вашему профилю");
      setLinkValue("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка привязки");
    } finally {
      setLinkBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Профиль и привязки</p>
        <p className="mt-1 text-xs text-slate-600">
          Один аккаунт HeyWaiter (global UID) для всех каналов. Здесь видно, какие контакты уже объединены.
        </p>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Загрузка…</p>
        ) : (
          <>
            <p className="mt-3 text-xs font-medium text-slate-500">Идентификатор</p>
            <p className="mt-1 break-all font-mono text-xs text-slate-800">
              {resolvedUid ?? "Профиль появится после первого захода за стол"}
            </p>
            <ul className="mt-4 space-y-2">
              {channels
                ? Object.entries(channels).map(([key, st]) => (
                    <li
                      key={key}
                      className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
                    >
                      <span className="text-slate-800">{CHANNEL_LABELS[key] ?? key}</span>
                      <span
                        className={`shrink-0 text-xs font-semibold ${
                          st.linked ? "text-emerald-700" : "text-slate-400"
                        }`}
                      >
                        {st.linked ? `Подключено${st.hint ? ` · ${st.hint}` : ""}` : "Не привязано"}
                      </span>
                    </li>
                  ))
                : null}
            </ul>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Привязать соцсеть / телефон</p>
        <p className="mt-1 text-xs text-slate-600">
          Данные добавляются к текущему профилю Telegram в этом Mini App. Номер — только цифры и +.
        </p>
        <form onSubmit={handleLink} className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Тип</span>
            <select
              value={linkKey}
              onChange={(e) => setLinkKey(e.target.value as "phone" | "vk" | "wa")}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="phone">Телефон</option>
              <option value="vk">VK (числовой id)</option>
              <option value="wa">WhatsApp (номер)</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Значение</span>
            <input
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={linkKey === "phone" ? "+7 900 123-45-67" : linkKey === "vk" ? "123456789" : "79991234567"}
            />
          </label>
          <button
            type="submit"
            disabled={linkBusy}
            className="w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {linkBusy ? "Сохранение…" : "Привязать к профилю"}
          </button>
        </form>
      </section>
    </div>
  );
}
