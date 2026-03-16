"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SettingsHallsSection } from "./SettingsHallsSection";
import { SettingsMenuSection } from "./SettingsMenuSection";
import { SettingsGeoSection } from "./SettingsGeoSection";
import { SettingsOperatingHoursSection } from "./SettingsOperatingHoursSection";

function SettingsContent() {
  const searchParams = useSearchParams();
  const fromUrl = (searchParams.get("v") || searchParams.get("venueId") || "").trim();
  const [fromStorage, setFromStorage] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setFromStorage(localStorage.getItem("lastVenueId"));
    }
  }, []);
  const currentVenueId =
    (fromUrl && fromUrl !== "current" ? fromUrl : null) || fromStorage || "current";
  const hasVenue = Boolean(currentVenueId);
  const venueIdFromStorage = Boolean(fromStorage && currentVenueId === fromStorage);

  return (
    <div className="max-w-4xl">
      <h2 className="text-lg font-semibold text-gray-900">Настройки</h2>
      {venueIdFromStorage && currentVenueId ? (
        <p className="mt-1 text-xs text-gray-500">Настройки для заведения: {currentVenueId}</p>
      ) : null}
      <p className="mt-2 text-sm text-gray-600">
        Залы и столы, меню заведения, гео-периметр. Все данные сохраняются в Firestore под venueId.
      </p>

      <section className="mt-6">
        <h3 className="text-base font-medium text-gray-900">0. Режим работы</h3>
        <SettingsOperatingHoursSection
          finalVenueId={currentVenueId}
          hasVenue={hasVenue}
          venueIdSource={venueIdFromStorage ? "localStorage" : fromUrl ? "url" : null}
        />
      </section>

        <section className="mt-6">
          <h3 className="text-base font-medium text-gray-900">1. Залы и столы</h3>
          <SettingsHallsSection />
        </section>

        <section className="mt-8">
          <h3 className="text-base font-medium text-gray-900">2. Меню заведения</h3>
          <SettingsMenuSection />
        </section>

      <section className="mt-8">
        <h3 className="text-base font-medium text-gray-900">3. Гео-периметр (GPS)</h3>
        <SettingsGeoSection />
      </section>
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
