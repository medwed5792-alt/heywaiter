"use client";

import { useState, useEffect } from "react";
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
};

type BotStatus = { channel: string; botType: BotType; active: boolean };

export default function AdminSettingsBotsPage() {
  const [testing, setTesting] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; ok: boolean; message?: string } | null>(null);
  const [statusList, setStatusList] = useState<BotStatus[]>([]);

  useEffect(() => {
    fetch("/api/admin/bots/status")
      .then((r) => r.json())
      .then((data: { bots?: BotStatus[] }) => setStatusList(data.bots ?? []))
      .catch(() => setStatusList([]));
  }, []);

  const handleTest = async (channel: MessengerChannel, botType: BotType) => {
    const key = `${channel}-${botType}`;
    setTesting(key);
    setResult(null);
    try {
      const res = await fetch("/api/admin/bots/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, botType }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
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

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">Настройки ботов</h2>
      <p className="mt-2 text-sm text-gray-600">
        Токены задаются через переменные окружения (TELEGRAM_CLIENT_TOKEN, VK_CLIENT_TOKEN и т.д.). Кнопка «Тест связи» проверяет работу вебхука (getMe для Telegram).
      </p>

      <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[400px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="p-3 text-left text-xs font-medium text-gray-600">Статус</th>
              <th className="p-3 text-left text-xs font-medium text-gray-600">Канал</th>
              <th className="p-3 text-left text-xs font-medium text-gray-600">Тип</th>
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
                const isActive = statusList.some((s) => s.channel === channel && s.botType === botType && s.active);
                return (
                  <tr key={key} className="border-b border-gray-100">
                    <td className="p-3">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: isActive ? "#22c55e" : "#d1d5db" }}
                        title={isActive ? "Активен" : "Не настроен"}
                        aria-label={isActive ? "Активен" : "Не настроен"}
                      />
                      <span className="ml-1.5 text-xs text-gray-500">{isActive ? "Активен" : "—"}</span>
                    </td>
                    <td className="p-3 text-sm">{CHANNEL_LABEL[channel] ?? channel}</td>
                    <td className="p-3 text-sm text-gray-600">{botType === "client" ? "Клиент" : "Персонал"}</td>
                    <td className="p-3">
                      <button
                        type="button"
                        disabled={isTesting}
                        onClick={() => handleTest(channel, botType)}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {isTesting ? "…" : "⚡️ Тест связи"}
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
