"use client";

import { useState, useEffect, useCallback } from "react";
import { deleteField, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { FileText } from "lucide-react";
import { db } from "@/lib/firebase";
import { DEFAULT_VENUE_ID as VENUE_ID } from "@/lib/standards/venue-default";
import { SettingsVenueMenuCatalogSection } from "./SettingsVenueMenuCatalogSection";

type VenueMenuConfig = {
  menuLink?: string;
  menuPdfUrl?: string;
  menuItems?: string[];
};

export function SettingsMenuSection() {
  const [menuUrl, setMenuUrl] = useState("");
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
      }
      setLoaded(true);
    })();
  }, []);

  const savePdfConfig = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const cleanUrl = String(menuUrl || "").trim();
      const configPatch: Record<string, unknown> = {
        menuItems: deleteField(),
      };
      if (cleanUrl) {
        configPatch.menuLink = cleanUrl;
        configPatch.menuPdfUrl = cleanUrl;
      } else {
        configPatch.menuLink = deleteField();
        configPatch.menuPdfUrl = deleteField();
      }

      await setDoc(
        doc(db, "venues", VENUE_ID),
        {
          config: configPatch,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setMessage({
        type: "ok",
        text: cleanUrl
          ? "Ссылка сохранена. В Mini App гостя появится кнопка «Меню (PDF)»."
          : "Ссылка очищена. Кнопка «Меню (PDF)» скрыта (если не задан другой источник).",
      });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Ошибка сохранения" });
    } finally {
      setSaving(false);
    }
  }, [menuUrl]);

  if (!loaded) return <p className="mt-3 text-sm text-gray-500">Загрузка…</p>;

  return (
    <div className="mt-3 space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h4 className="flex items-center gap-2 font-medium text-gray-900">
          <FileText className="h-5 w-5 text-gray-500" />
          Меню (PDF) — отдельная ссылка
        </h4>
        <p className="mt-1 text-sm text-gray-600">
          Независимо от каталожного конструктора ниже. Доступны три режима: только PDF, только витрина для предзаказа, или оба
          вместе.
        </p>
        <div className="mt-4 flex max-w-xl flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-700">Ссылка на меню (URL)</span>
            <input
              type="url"
              placeholder="https://example.com/menu.pdf или ссылка на облако"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={menuUrl}
              onChange={(e) => setMenuUrl(e.target.value)}
            />
            <p className="text-xs text-gray-500">Если поле заполнено — в Mini App показывается кнопка «Меню (PDF)».</p>
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={savePdfConfig}
            className="self-start rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? "Сохранение…" : "Сохранить ссылку"}
          </button>
          {message ? <p className={`text-sm ${message.type === "ok" ? "text-green-600" : "text-red-600"}`}>{message.text}</p> : null}
        </div>
      </div>

      <SettingsVenueMenuCatalogSection />
    </div>
  );
}
