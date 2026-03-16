"use client";

import { Suspense } from "react";
import { SettingsHallsSection } from "./SettingsHallsSection";
import { SettingsMenuSection } from "./SettingsMenuSection";
import { SettingsGeoSection } from "./SettingsGeoSection";
import { SettingsOperatingHoursSection, useFinalVenueId } from "./SettingsOperatingHoursSection";

function SettingsContent() {
  const { finalVenueId, hasVenue, venueIdSource } = useFinalVenueId();
  return (
    <div className="max-w-4xl">
      <h2 className="text-lg font-semibold text-gray-900">Настройки</h2>
      {venueIdSource === "localStorage" && finalVenueId ? (
        <p className="mt-1 text-xs text-gray-500">Настройки для заведения: {finalVenueId}</p>
      ) : null}
      <p className="mt-2 text-sm text-gray-600">
        Залы и столы, меню заведения, гео-периметр. Все данные сохраняются в Firestore под venueId.
      </p>

      <section className="mt-6">
        <h3 className="text-base font-medium text-gray-900">0. Режим работы</h3>
        <SettingsOperatingHoursSection
          finalVenueId={finalVenueId}
          hasVenue={hasVenue}
          venueIdSource={venueIdSource}
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
