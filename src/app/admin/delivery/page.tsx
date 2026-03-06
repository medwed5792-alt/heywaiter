"use client";

import { useState } from "react";

const VENUE_ID = "current";

export default function AdminDeliveryPage() {
  const [orderNumber, setOrderNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const handleNotify = async () => {
    const num = orderNumber.trim();
    if (!num) {
      setMessage({ type: "error", text: "Введите номер заказа" });
      return;
    }
    const n = parseInt(num, 10);
    if (Number.isNaN(n) || n < 1) {
      setMessage({ type: "error", text: "Номер заказа — положительное число" });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/delivery/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber: n }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setMessage({ type: "ok", text: `Заказ №${n} — гостю отправлено уведомление в мессенджер.` });
        setOrderNumber("");
      } else {
        setMessage({ type: "error", text: data.error || "Ошибка отправки" });
      }
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">Пульт выдачи</h2>
      <p className="mt-2 text-sm text-gray-600">
        Введите номер заказа/чека и нажмите «ГОТОВО» — гостю придёт пуш в тот мессенджер (TG, WA, VK и др.), через который он нажал «Ждать».
      </p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="text"
          inputMode="numeric"
          placeholder="Номер заказа"
          className="max-w-[140px] rounded-lg border border-gray-300 px-4 py-3 text-lg font-semibold"
          value={orderNumber}
          onChange={(e) => setOrderNumber(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => e.key === "Enter" && handleNotify()}
        />
        <button
          type="button"
          disabled={loading}
          onClick={handleNotify}
          className="rounded-xl bg-green-600 px-6 py-3 text-base font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? "…" : "ГОТОВО"}
        </button>
      </div>

      {message && (
        <p
          className={`mt-3 text-sm ${message.type === "ok" ? "text-green-600" : "text-red-600"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
