"use client";

import { useState, useCallback } from "react";
import { Globe } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { LocaleCode } from "@/lib/types";

interface VoiceTranslatorProProps {
  venueId: string;
  /** Язык гостя (авто из навигатора или профиля) */
  guestLocale?: LocaleCode;
}

/**
 * PRO: Голосовой ввод (STT) → перевод на язык заведения → текст + озвучка (TTS).
 * Целевой язык из venue.settings.language.
 */
export function VoiceTranslatorPro({ venueId, guestLocale }: VoiceTranslatorProProps) {
  const [targetLang, setTargetLang] = useState<LocaleCode | null>(null);
  const [loading, setLoading] = useState(false);
  const [translatedText, setTranslatedText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadVenueLanguage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const venueSnap = await getDoc(doc(db, "venues", venueId));
      const lang = venueSnap.exists()
        ? (venueSnap.data().settings?.language as LocaleCode | undefined)
        : "ru";
      setTargetLang(lang ?? "ru");
    } catch (e) {
      setError("Не удалось загрузить настройки");
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  const handleOpen = useCallback(() => {
    loadVenueLanguage();
  }, [loadVenueLanguage]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
      >
        <Globe className="h-4 w-4" />
        Переводчик (PRO)
      </button>
      {loading && <p className="mt-2 text-xs text-gray-500">Загрузка…</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {targetLang && !loading && (
        <p className="mt-2 text-xs text-gray-500">
          Язык заведения: {targetLang}. Голосовой ввод → перевод → текст и озвучка (STT/TTS — подключите API).
        </p>
      )}
      {translatedText && (
        <p className="mt-2 text-sm text-gray-800">{translatedText}</p>
      )}
    </div>
  );
}
