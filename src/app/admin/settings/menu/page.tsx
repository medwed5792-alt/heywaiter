"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

const VENUE_ID = "current";

type VenueMenuConfig = {
  menuLink?: string;
  menuPdfUrl?: string;
  menuItems?: string[];
};

export default function AdminSettingsMenuPage() {
  const [menuLink, setMenuLink] = useState("");
  const [menuPdfUrl, setMenuPdfUrl] = useState("");
  const [menuItemsText, setMenuItemsText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, "venues", VENUE_ID));
      if (snap.exists()) {
        const config = snap.data().config as VenueMenuConfig | undefined;
        if (config?.menuLink != null) setMenuLink(config.menuLink);
        if (config?.menuPdfUrl != null) setMenuPdfUrl(config.menuPdfUrl);
        if (config?.menuItems?.length) setMenuItemsText(config.menuItems.join("\n"));
      }
      setLoaded(true);
    })();
  }, []);

  const handlePdfUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || file.type !== "application/pdf") {
      setMessage({ type: "error", text: "Выберите файл PDF." });
      return;
    }
    setMessage(null);
    setUploading(true);
    try {
      const path = `venues/${VENUE_ID}/menu_${Date.now()}.pdf`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setMenuPdfUrl(url);
      setMessage({ type: "ok", text: "PDF загружен. Нажмите «Сохранить», чтобы применить." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Ошибка загрузки" });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }, []);

  const saveConfig = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const menuItems = menuItemsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const config: VenueMenuConfig = {
        menuLink: menuLink.trim() || undefined,
        menuPdfUrl: menuPdfUrl.trim() || undefined,
        menuItems: menuItems.length > 0 ? menuItems : undefined,
      };
      await updateDoc(doc(db, "venues", VENUE_ID), {
        config,
        updatedAt: serverTimestamp(),
      });
      setMessage({ type: "ok", text: "Настройки меню сохранены. Кнопка «📜 Меню» в Mini App гостя появится, если заполнена ссылка, PDF или позиции." });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Ошибка сохранения" });
    } finally {
      setSaving(false);
    }
  }, [menuLink, menuPdfUrl, menuItemsText]);

  if (!loaded) {
    return <p className="text-sm text-gray-500">Загрузка…</p>;
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">Меню заведения</h2>
      <p className="mt-1 text-sm text-gray-600">
        Если заполнена хотя бы одна опция (ссылка, PDF или позиции), в Mini App гостя (/check-in/panel) отображается кнопка «📜 Меню». Если всё пусто — кнопки нет.
      </p>

      <div className="mt-6 flex flex-col gap-4 max-w-xl">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Внешняя ссылка на меню</span>
          <input
            type="url"
            placeholder="https://example.com/menu"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={menuLink}
            onChange={(e) => setMenuLink(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">PDF меню (Firebase Storage)</span>
          <input type="file" ref={fileInputRef} accept="application/pdf" className="hidden" onChange={handlePdfUpload} />
          <div className="flex gap-2 items-center">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {uploading ? "Загрузка…" : "Загрузить PDF"}
            </button>
            {menuPdfUrl && (
              <a href={menuPdfUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline">
                Открыть
              </a>
            )}
          </div>
          <input
            type="url"
            placeholder="или вставьте ссылку на PDF"
            className="mt-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={menuPdfUrl}
            onChange={(e) => setMenuPdfUrl(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Позиции меню (по одной на строку, опционально)</span>
          <textarea
            placeholder="Бургер классический\nКартофель фри\nКофе"
            rows={5}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm resize-y"
            value={menuItemsText}
            onChange={(e) => setMenuItemsText(e.target.value)}
          />
        </label>

        <button
          type="button"
          disabled={saving}
          onClick={saveConfig}
          className="self-start rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? "Сохранение…" : "Сохранить"}
        </button>

        {message && (
          <p className={`text-sm ${message.type === "ok" ? "text-green-600" : "text-red-600"}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
