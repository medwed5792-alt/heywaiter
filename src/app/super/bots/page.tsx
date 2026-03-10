"use client";

import { useState, useEffect, useCallback } from "react";
import { WEBHOOK_CHANNELS } from "@/lib/webhook/channels";
import type { MessengerChannel } from "@/lib/types";
import type { BotType } from "@/lib/webhook/channels";

const CHANNEL_LABEL: Record<string, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  vk: "VK",
  viber: "Viber",
  wechat: "WeChat",
  instagram: "Instagram",
  facebook: "Facebook",
  line: "Line",
};

type BotStatus = { channel: string; botType: BotType; active: boolean; username?: string };

/**
 * Супер-админ: настройки ботов. Токены Telegram вводятся в таблицу и сохраняются в Firestore (system_settings/bots).
 * Кнопка «Тест связи» для Telegram: проверка токена (getMe), установка webhook, сохранение.
 */
export default function SuperBotsPage() {
  const [testing, setTesting] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; ok: boolean; message?: string } | null>(null);
  const [statusList, setStatusList] = useState<BotStatus[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});

  const fetchStatus = useCallback(() => {
    fetch("/api/admin/bots/status")
      .then((r) => r.json())
      .then((data: { bots?: BotStatus[] }) => setStatusList(data.bots ?? []))
      .catch(() => setStatusList([]));
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleTest = async (channel: MessengerChannel, botType: BotType) => {
    const key = `${channel}-${botType}`;
    setTesting(key);
    setResult(null);

    if (channel === "telegram") {
      const token = (tokens[key] ?? "").trim();
      if (!token) {
        setResult({ key, ok: false, message: "Введите токен бота" });
        setTesting(null);
        return;
      }
      try {
        const res = await fetch("/api/super/bots/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, botType }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          message?: string;
        };
        setResult({
          key,
          ok: res.ok && Boolean(data.ok),
          message: data.ok ? (data.message ?? "Активен") : (data.error ?? "Ошибка"),
        });
        if (res.ok && data.ok) {
          setTokens((prev) => ({ ...prev, [key]: "" }));
          fetchStatus();
        }
      } catch (e) {
        setResult({
          key,
          ok: false,
          message: e instanceof Error ? e.message : "Ошибка",
        });
      } finally {
        setTesting(null);
      }
      return;
    }

    try {
      const res = await fetch("/api/admin/bots/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, botType }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      setResult({
        key,
        ok: res.ok && Boolean(data.ok),
        message: data.ok ? "HeyWaiter: Связь установлена успешно!" : data.error,
      });
    } catch (e) {
      setResult({ key, ok: false, message: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setTesting(null);
    }
  };

  const setToken = (key: string, value: string) => {
    setTokens((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">Настройки ботов</h2>
      <p className="mt-2 text-sm text-gray-600">
        Для Telegram: введите токен бота и нажмите «Тест связи» — система проверит токен, установит webhook и сохранит настройки в базу. Остальные каналы — через переменные окружения.
      </p>

      <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[500px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="p-3 text-left text-xs font-medium text-gray-600">Статус</th>
              <th className="p-3 text-left text-xs font-medium text-gray-600">Канал</th>
              <th className="p-3 text-left text-xs font-medium text-gray-600">Тип</th>
              <th className="p-3 text-left text-xs font-medium text-gray-600">Токен</th>
              <th className="p-3 text-left text-xs font-medium text-gray-600">Действие</th>
              <th className="p-3 text-left text-xs font-medium text-gray-600">Результат</th>
            </tr>
          </thead>
          <tbody>
            {WEBHOOK_CHANNELS.flatMap((channel) =>
              (["client", "staff"] as BotType[]).map((botType) => {
                const key = `${channel}-${botType}`;
                const isTesting = testing === key;
                const res = result?.key === key ? result : null;
                const status = statusList.find((s) => s.channel === channel && s.botType === botType);
                const isActive = status?.active ?? false;
                const isTelegram = channel === "telegram";
                return (
                  <tr key={key} className="border-b border-gray-100">
                    <td className="p-3">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: isActive ? "#22c55e" : "#d1d5db" }}
                        title={isActive ? "Активен" : "Не настроен"}
                        aria-label={isActive ? "Активен" : "Не настроен"}
                      />
                      <span className="ml-1.5 text-xs text-gray-500">
                        {isActive ? (status?.username ? `Активен (${status.username})` : "Активен") : "—"}
                      </span>
                    </td>
                    <td className="p-3 text-sm">{CHANNEL_LABEL[channel] ?? channel}</td>
                    <td className="p-3 text-sm text-gray-600">{botType === "client" ? "Клиент" : "Персонал"}</td>
                    <td className="p-3">
                      {isTelegram ? (
                        <input
                          type="password"
                          placeholder="Введите токен бота"
                          value={tokens[key] ?? ""}
                          onChange={(e) => setToken(key, e.target.value)}
                          className="w-full min-w-[180px] rounded border border-gray-300 px-2 py-1.5 text-sm placeholder-gray-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                        />
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      <button
                        type="button"
                        disabled={isTesting}
                        onClick={() => handleTest(channel, botType)}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {isTesting ? "В процессе…" : "⚡️ Тест связи"}
                      </button>
                    </td>
                    <td className="p-3 text-sm">
                      {res?.ok && <span className="text-green-600">{res.message}</span>}
                      {res && !res.ok && <span className="text-red-600">{res.message}</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
