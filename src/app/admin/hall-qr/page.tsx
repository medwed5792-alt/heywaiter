"use client";

import { useState, useEffect } from "react";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { VenueType } from "@/lib/types";

const DEFAULT_CHECK_IN = "Располагайтесь! Нажмите кнопку ниже, чтобы открыть меню или позвать официанта.";
const DEFAULT_BOOKING = "Извините, этот стол забронирован. Обратитесь к хостес.";
const DEFAULT_THANK_YOU = "🙏 Спасибо за визит! Будем рады видеть вас снова.";
const VENUE_ID = "current";

export default function HallQRPage() {
  const [venueType, setVenueType] = useState<VenueType>("full_service");
  const [venueTypeSaving, setVenueTypeSaving] = useState(false);
  const [messages, setMessages] = useState({
    checkIn: DEFAULT_CHECK_IN,
    booking: DEFAULT_BOOKING,
    thankYou: DEFAULT_THANK_YOU,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, "venues", VENUE_ID));
      if (snap.exists() && snap.data().venueType) {
        setVenueType(snap.data().venueType as VenueType);
      }
    })();
  }, []);

  const handleSaveVenueType = async () => {
    setVenueTypeSaving(true);
    try {
      await updateDoc(doc(db, "venues", VENUE_ID), {
        venueType,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка сохранения типа заведения");
    } finally {
      setVenueTypeSaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/venue/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId: "current", messages }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Ошибка");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">Зал & QR</h2>
      <p className="mt-2 text-sm text-gray-600">
        Конструктор приветствий (посадка, бронь, благодарность) и генератор QR-кодов для столов.
      </p>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="font-medium text-gray-900">Тип заведения</h3>
        <p className="mt-1 text-xs text-gray-500">
          Влияет на логику Mini App: полный сервис — вызов официанта по столам; фастфуд — статус заказа по номеру и уведомление «Готово» в мессенджер.
        </p>
        <div className="mt-3 flex gap-4">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="venueType"
              checked={venueType === "full_service"}
              onChange={() => setVenueType("full_service")}
              className="text-gray-900"
            />
            <span className="text-sm">Полный сервис (столы, официант)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="venueType"
              checked={venueType === "fast_food"}
              onChange={() => setVenueType("fast_food")}
              className="text-gray-900"
            />
            <span className="text-sm">Фастфуд (заказ по номеру, выдача)</span>
          </label>
        </div>
        <button
          type="button"
          className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          onClick={handleSaveVenueType}
          disabled={venueTypeSaving}
        >
          {venueTypeSaving ? "Сохранение…" : "Сохранить тип"}
        </button>
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="font-medium text-gray-900">Тексты сценариев (venue.messages)</h3>
        <p className="mt-1 text-xs text-gray-500">
          При закрытии стола официант вводит цифру → гостю в Client-бот уходит messages.thankYou.
        </p>
        <label className="mt-4 block text-sm font-medium text-gray-700">
          Посадка (checkIn)
        </label>
        <textarea
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          rows={2}
          value={messages.checkIn}
          onChange={(e) => setMessages((m) => ({ ...m, checkIn: e.target.value }))}
        />
        <label className="mt-4 block text-sm font-medium text-gray-700">
          Бронь / отказ (booking)
        </label>
        <textarea
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          rows={2}
          value={messages.booking}
          onChange={(e) => setMessages((m) => ({ ...m, booking: e.target.value }))}
        />
        <label className="mt-4 block text-sm font-medium text-gray-700">
          Благодарность после обслуживания (thankYou)
        </label>
        <textarea
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          rows={2}
          value={messages.thankYou}
          onChange={(e) => setMessages((m) => ({ ...m, thankYou: e.target.value }))}
        />
        <button
          type="button"
          className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Сохранение…" : "Сохранить тексты"}
        </button>
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="font-medium text-gray-900">Генератор QR</h3>
        <p className="mt-1 text-sm text-gray-500">
          QR ведёт на /check-in?v=venueId&t=номер_стола
        </p>
      </section>
    </div>
  );
}
