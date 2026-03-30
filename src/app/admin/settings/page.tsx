"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { SettingsAccordionSection } from "@/components/admin/SettingsAccordionSection";
import { SettingsHallsSection } from "./SettingsHallsSection";
import { SettingsMenuSection } from "./SettingsMenuSection";
import { SettingsGeoSection } from "./SettingsGeoSection";
import { SettingsOperatingHoursSection } from "./SettingsOperatingHoursSection";
import { DEFAULT_VENUE_ID as venueId } from "@/lib/standards/venue-default";

function SettingsContent() {
  const [venueName, setVenueName] = useState<string>("");
  const [loadingName, setLoadingName] = useState<boolean>(true);
  const [savingName, setSavingName] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "venues", venueId));
        if (!cancelled && snap.exists()) {
          const data = snap.data() ?? {};
          const name = (data.name as string) ?? "";
          setVenueName(name);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoadingName(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveName = useCallback(async () => {
    setSavingName(true);
    try {
      await updateDoc(doc(db, "venues", venueId), {
        name: venueName.trim() || null,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // можно добавить toast при необходимости
    } finally {
      setSavingName(false);
    }
  }, [venueName]);

  const handleResetName = useCallback(async () => {
    setSavingName(true);
    try {
      setVenueName("");
      await updateDoc(doc(db, "venues", venueId), {
        name: null,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // ignore
    } finally {
      setSavingName(false);
    }
  }, []);

  return (
    <div className="max-w-4xl pb-[200px]">
      <h2 className="text-lg font-semibold text-gray-900">Настройки</h2>
      <p className="mt-1 text-xs text-gray-500">
        Заведение: {venueName.trim() ? venueName : venueId}
      </p>
      <p className="mt-2 text-sm text-gray-600">
        Залы и столы, меню заведения, гео-периметр. Все данные сохраняются в Firestore.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        <SettingsAccordionSection
          title="0. Основная информация"
          subtitle={
            <>
              Название заведения в Админке и гостевом интерфейсе. Если пусто — используется ID{" "}
              <span className="font-mono">venue_andrey_alt</span>.
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-[2fr_auto_auto] items-end">
            <label className="block sm:col-span-1">
              <span className="block text-xs text-gray-600">Название заведения</span>
              <input
                type="text"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
                disabled={loadingName || savingName}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
                placeholder="Например: HeyWaiter Bar & Grill"
              />
            </label>
            <button
              type="button"
              onClick={handleSaveName}
              disabled={loadingName || savingName}
              className="mt-2 inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              Сохранить
            </button>
            <button
              type="button"
              onClick={handleResetName}
              disabled={loadingName || savingName}
              className="mt-2 inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Сбросить название
            </button>
          </div>
        </SettingsAccordionSection>

        <SettingsAccordionSection title="1. Режим работы">
          <SettingsOperatingHoursSection />
        </SettingsAccordionSection>

        <SettingsAccordionSection
          title="2. Залы и столы"
          subtitle={
            <>
              Залы и столы в{" "}
              <span className="font-mono">venues/venue_andrey_alt/halls</span> и{" "}
              <span className="font-mono">tables</span>.
            </>
          }
        >
          <SettingsHallsSection />
        </SettingsAccordionSection>

        <SettingsAccordionSection
          title="3. Меню заведения (конструктор и PDF)"
          subtitle="PDF-ссылка и графический каталог для гостя и предзаказа."
          defaultOpen
        >
          <SettingsMenuSection />
        </SettingsAccordionSection>

        <SettingsAccordionSection title="4. Гео-периметр (GPS)">
          <SettingsGeoSection />
        </SettingsAccordionSection>
      </div>
    </div>
  );
}

export default function AdminSettingsPage() {
  return (
    <Suspense fallback={<div>Загрузка настроек...</div>}>
      <SettingsContent />
    </Suspense>
  );
}
