"use client";

import { useState, useEffect, useCallback } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DEFAULT_VENUE_ID as VENUE_ID } from "@/lib/standards/venue-default";

/** Ссылка на внешнее облачное хранилище (Google Диск, PDF и т.д.). При нажатии гостем кнопки «Меню» в Mini App происходит переход по этой ссылке в браузере. */
type VenueMenuConfig = {
  menuLink?: string;
  menuPdfUrl?: string;
  menuItems?: string[];
};

export function SettingsMenuSection() {
  const [menuUrl, setMenuUrl] = useState("");
  const [menuItemsText, setMenuItemsText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, "venues", VENUE_ID));
      if (snap.exists()) {
        const config = snap.data().config as VenueMenuConfig | undefined;
        const url = config?.menuLink ?? config?.menuPdfUrl ?? "";
        setMenuUrl(typeof url === "string" ? url : "");
        if (config?.menuItems?.length) setMenuItemsText(config.menuItems.join("\n"));
      }
      setLoaded(true);
    })();
  }, []);

  const saveConfig = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const menuItems = menuItemsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const cleanUrl = String(menuUrl || "").trim();
      const payload: Record<string, unknown> = {
        config: {
          menuLink: cleanUrl,
          menuPdfUrl: cleanUrl,
          ...(menuItems.length > 0 ? { menuItems } : {}),
        },
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, "venues", VENUE_ID), payload, { merge: true });
      setMessage({ type: "ok", text: "Настройки меню сохранены. Кнопка «📜 Меню» в Mini App гостя открывает эту ссылку в браузере." });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Ошибка сохранения" });
    } finally {
      setSaving(false);
    }
  }, [menuUrl, menuItemsText]);

  if (!loaded) return <p className="mt-3 text-sm text-gray-500">Загрузка…</p>;

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-white p-6">
      <p className="text-sm text-gray-600">
        Ссылка на внешнее облачное хранилище (PDF, Google Диск и т.д.). При нажатии гостем кнопки «📜 Меню» в Mini App (/mini-app) происходит переход по этой ссылке в браузере.
      </p>
      <div className="mt-4 flex flex-col gap-4 max-w-xl">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Ссылка на меню (URL)</span>
          <input
            type="url"
            placeholder="https://example.com/menu.pdf или ссылка на Google Диск"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={menuUrl}
            onChange={(e) => setMenuUrl(e.target.value)}
          />
          <p className="text-xs text-gray-500">Загрузите PDF на Google Диск или облако и вставьте прямую ссылку.</p>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Позиции меню (по одной на строку, опционально)</span>
          <textarea placeholder="Бургер классический\nКартофель фри\nКофе" rows={5} className="rounded-lg border border-gray-300 px-3 py-2 text-sm resize-y" value={menuItemsText} onChange={(e) => setMenuItemsText(e.target.value)} />
        </label>
        <button type="button" disabled={saving} onClick={saveConfig} className="self-start rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
        {message && <p className={`text-sm ${message.type === "ok" ? "text-green-600" : "text-red-600"}`}>{message.text}</p>}
      </div>
    </div>
  );
}
