"use client";

import { useState, useEffect } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import toast from "react-hot-toast";

const SYSTEM_CONFIG_GOOGLE_MAPS = "google_maps";

export default function SuperInfrastructureInner() {
  const [googleMapsApiKey, setGoogleMapsApiKey] = useState("");
  const [googlePlacesApiKey, setGooglePlacesApiKey] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, "system_config", SYSTEM_CONFIG_GOOGLE_MAPS));
      if (snap.exists()) {
        const d = snap.data();
        setGoogleMapsApiKey(d.googleMapsApiKey ?? "");
        setGooglePlacesApiKey(d.googlePlacesApiKey ?? "");
      }
      setLoaded(true);
    })();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await setDoc(
        doc(db, "system_config", SYSTEM_CONFIG_GOOGLE_MAPS),
        {
          googleMapsApiKey: String(googleMapsApiKey ?? "").trim(),
          googlePlacesApiKey: String(googlePlacesApiKey ?? "").trim(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      toast.success("Ключи сохранены. Карта в настройках заведения обновится при следующей загрузке.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <p className="text-sm text-gray-500">Загрузка…</p>;

  return (
    <div style={{ zoom: 0.75 }}>
      <h2 className="text-lg font-semibold text-gray-900">Инфраструктура / API Ключи</h2>
      <p className="mt-2 text-sm text-gray-600">
        Централизованное хранение ключей в Firestore (system_config/google_maps). Карта в настройках заведения (/admin/settings) подгружает ключ отсюда.
      </p>
      <form onSubmit={handleSave} className="mt-6 max-w-xl space-y-4">
        <label className="block">
          <span className="block text-sm font-medium text-gray-700">Google Maps API Key</span>
          <input
            type="password"
            autoComplete="off"
            value={googleMapsApiKey}
            onChange={(e) => setGoogleMapsApiKey(e.target.value)}
            placeholder="AIza..."
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-gray-700">Google Places API Key (если отдельный)</span>
          <input
            type="password"
            autoComplete="off"
            value={googlePlacesApiKey}
            onChange={(e) => setGooglePlacesApiKey(e.target.value)}
            placeholder="Оставьте пустым, если используете один ключ для Maps и Places"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? "Сохранение…" : "Сохранить и Обновить систему"}
        </button>
      </form>
    </div>
  );
}
