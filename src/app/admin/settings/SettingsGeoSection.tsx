"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { collection, doc, getDoc, updateDoc, serverTimestamp, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { StaffLiveGeo } from "@/lib/types";

const VENUE_ID = "current";
const RADIUS_MIN = 50;
const RADIUS_MAX = 500;
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

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

type LeafletRef = React.MutableRefObject<unknown>;

function GeoMap({
  lat,
  lng,
  radius,
  staffGeos,
  onLatLngChange,
  onRadiusChange,
}: {
  lat: number;
  lng: number;
  radius: number;
  staffGeos: StaffLiveGeo[];
  onLatLngChange: (lat: number, lng: number) => void;
  onRadiusChange: (r: number) => void;
}) {
  const mapRef = useRef<unknown>(null);
  const markerRef = useRef<unknown>(null);
  const circleRef = useRef<unknown>(null);
  const layerRef = useRef<unknown>(null);
  const [MapComponent, setMapComponent] = useState<React.ComponentType<{
    lat: number;
    lng: number;
    radius: number;
    staffGeos: StaffLiveGeo[];
    onLatLngChange: (lat: number, lng: number) => void;
    onRadiusChange: (r: number) => void;
    mapRef: LeafletRef;
    markerRef: LeafletRef;
    circleRef: LeafletRef;
    layerRef: LeafletRef;
  }> | null>(null);

  useEffect(() => {
    import("./geo/GeoMapLeaflet").then((m) => setMapComponent(() => m.GeoMapLeaflet));
  }, []);

  if (!MapComponent) {
    return (
      <div className="flex h-[400px] w-full items-center justify-center rounded-xl border border-gray-200 bg-slate-50 text-sm text-gray-500">
        Загрузка карты…
      </div>
    );
  }

  return (
    <MapComponent
      lat={lat}
      lng={lng}
      radius={radius}
      staffGeos={staffGeos}
      onLatLngChange={onLatLngChange}
      onRadiusChange={onRadiusChange}
      mapRef={mapRef}
      markerRef={markerRef}
      circleRef={circleRef}
      layerRef={layerRef}
    />
  );
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

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, "venues", VENUE_ID));
      if (snap.exists()) {
        const geo = snap.data().geo;
        if (geo?.lat != null) setLat(geo.lat);
        if (geo?.lng != null) setLng(geo.lng);
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
      await updateDoc(doc(db, "venues", VENUE_ID), {
        geo: { lat: next.lat ?? lat, lng: next.lng ?? lng, radius: next.radius ?? radius },
        updatedAt: serverTimestamp(),
      });
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
    <div className="mt-3 rounded-xl border border-gray-200 bg-white p-6">
      <p className="text-sm text-gray-600">Интерактивная карта: поиск по адресу, перетаскивание маркера, красная зона по радиусу.</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[200px]">
          <span className="block text-sm font-medium text-gray-700">Поиск по адресу</span>
          <input type="text" value={addressQuery} onChange={(e) => setAddressQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearchAddress()} placeholder="Город, улица, дом" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </label>
        <button type="button" onClick={handleSearchAddress} disabled={geocodeLoading} className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">{geocodeLoading ? "Поиск…" : "Найти"}</button>
        <button type="button" onClick={handleMyLocation} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Определить моё местоположение</button>
      </div>
      {geocodeError && <p className="mt-2 text-sm text-red-600">{geocodeError}</p>}
      <GeoMap lat={lat} lng={lng} radius={radius} staffGeos={staffGeos} onLatLngChange={(a, b) => { setLat(a); setLng(b); }} onRadiusChange={setRadius} />
      <div className="mt-4 rounded-xl border border-gray-200 p-4">
        <label className="block text-sm font-medium text-gray-700">Радиус красной зоны, м</label>
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
