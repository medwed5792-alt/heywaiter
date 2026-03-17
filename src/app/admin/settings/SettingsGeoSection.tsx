"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { collection, doc, getDoc, updateDoc, serverTimestamp, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { StaffLiveGeo } from "@/lib/types";

const VENUE_ID = "venue_andrey_alt";
const RADIUS_MIN = 50;
const RADIUS_MAX = 500;
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

const MapLibreVenue = dynamic(
  () => import("@/components/admin/geo/MapLibreVenue").then((m) => m.MapLibreVenue),
  { ssr: false }
);

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const q = encodeURIComponent(address.trim());
  if (!q) return null;
  const res = await fetch(`${NOMINATIM_URL}?q=${q}&format=json&limit=1`, { headers: { Accept: "application/json" } });
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export function SettingsGeoSection() {
  const [lat, setLat] = useState(55.75);
  const [lng, setLng] = useState(37.62);
  const [radius, setRadius] = useState(100);
  const [addressQuery, setAddressQuery] = useState("");
  const [geocodeLoading, setGeocodeLoading] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [staffGeos, setStaffGeos] = useState<StaffLiveGeo[]>([]);
  const [geoConfigured, setGeoConfigured] = useState(false);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, "venues", VENUE_ID));
      if (snap.exists()) {
        const geo = snap.data().geo;
        if (geo?.lat != null && geo?.lng != null) {
          setLat(geo.lat);
          setLng(geo.lng);
          setGeoConfigured(true);
        }
        if (geo?.radius != null) setRadius(Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, geo.radius)));
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "staffLiveGeos"), where("venueId", "==", VENUE_ID));
    const unsub = onSnapshot(q, (snap) => {
      setStaffGeos(snap.docs.map((d) => {
        const data = d.data();
        return { staffId: data.staffId ?? "", venueId: data.venueId ?? "", lat: data.lat ?? 0, lng: data.lng ?? 0, isInside: data.isInside ?? false, lastUpdate: data.lastUpdate };
      }));
    });
    return () => unsub();
  }, []);

  const saveGeo = useCallback(async (next: { lat?: number; lng?: number; radius?: number }) => {
    setSaving(true);
    try {
      const nextLat = next.lat ?? lat;
      const nextLng = next.lng ?? lng;
      const nextRadius = next.radius ?? radius;
      await updateDoc(doc(db, "venues", VENUE_ID), {
        geo: { lat: nextLat, lng: nextLng, radius: nextRadius },
        updatedAt: serverTimestamp(),
      });
      setGeoConfigured(nextLat != null && nextLng != null);
    } finally {
      setSaving(false);
    }
  }, [lat, lng, radius]);

  const handleSearchAddress = useCallback(async () => {
    if (!addressQuery.trim()) return;
    setGeocodeError(null);
    setGeocodeLoading(true);
    try {
      const result = await geocodeAddress(addressQuery);
      if (result) { setLat(result.lat); setLng(result.lng); } else setGeocodeError("Адрес не найден.");
    } catch {
      setGeocodeError("Ошибка геокодинга.");
    } finally {
      setGeocodeLoading(false);
    }
  }, [addressQuery]);

  const handleMyLocation = useCallback(() => {
    if (!navigator.geolocation) { setGeocodeError("Геолокация недоступна."); return; }
    setGeocodeError(null);
    navigator.geolocation.getCurrentPosition((pos) => { setLat(pos.coords.latitude); setLng(pos.coords.longitude); }, () => setGeocodeError("Не удалось определить местоположение."));
  }, []);

  if (!loaded) return <p className="mt-3 text-sm text-gray-500">Загрузка…</p>;

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-white p-6" style={{ zoom: 0.75 }}>
      <p className="text-sm text-gray-600">
        Интерактивная карта: поиск по адресу, перетаскивание маркера, красная зона по радиусу.
      </p>
      <p className="mt-1 text-xs text-gray-500">
        Гео-проверка: {geoConfigured ? "Активна" : "Не настроена"}
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[200px]">
          <span className="block text-sm font-medium text-gray-700">Поиск по адресу</span>
          <input type="text" value={addressQuery} onChange={(e) => setAddressQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearchAddress()} placeholder="Город, улица, дом" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </label>
        <button type="button" onClick={handleSearchAddress} disabled={geocodeLoading} className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">{geocodeLoading ? "Поиск…" : "Найти"}</button>
        <button
          type="button"
          onClick={handleMyLocation}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Определить моё местоположение
        </button>
        <button
          type="button"
          onClick={async () => {
            if (!navigator.geolocation) {
              setGeocodeError("Геолокация недоступна.");
              return;
            }
            setGeocodeError(null);
            navigator.geolocation.getCurrentPosition(
              async (pos) => {
                const nextLat = pos.coords.latitude;
                const nextLng = pos.coords.longitude;
                setLat(nextLat);
                setLng(nextLng);
                await saveGeo({ lat: nextLat, lng: nextLng });
                setGeoConfigured(true);
              },
              () => {
                setGeocodeError("Не удалось определить местоположение.");
              }
            );
          }}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          ОБНОВИТЬ ГЕО-ПОЗИЦИЮ
        </button>
      </div>
      {geocodeError && <p className="mt-2 text-sm text-red-600">{geocodeError}</p>}
      <div className="mt-4" id="map-container-wrapper">
        <MapLibreVenue
          lat={lat}
          lng={lng}
          radius={radius}
          onLatLngChange={(newLat, newLng) => {
            setLat(newLat);
            setLng(newLng);
          }}
        />
      </div>
      <div className="mt-4 rounded-xl border border-gray-200 p-4">
        <label className="block text-sm font-medium text-gray-700">Радиус приемной зоны, м</label>
        <input type="range" min={RADIUS_MIN} max={RADIUS_MAX} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="mt-1 w-full accent-red-600" />
        <p className="mt-1 text-sm text-gray-600">{radius} м</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block"><span className="block text-sm font-medium text-gray-700">Широта (Lat)</span><input type="number" step="any" className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" value={lat} onChange={(e) => setLat(Number(e.target.value))} /></label>
        <label className="block"><span className="block text-sm font-medium text-gray-700">Долгота (Lng)</span><input type="number" step="any" className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" value={lng} onChange={(e) => setLng(Number(e.target.value))} /></label>
      </div>
      <button type="button" onClick={() => saveGeo({ lat, lng, radius })} disabled={saving} className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">{saving ? "Сохранение…" : "Сохранить"}</button>
    </div>
  );
}
