"use client";

import { useState, useEffect, useCallback } from "react";
import { collection, doc, getDoc, updateDoc, serverTimestamp, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DebugPanelTrigger } from "@/components/debug/DebugPanelTrigger";
import type { VenueGeo, StaffLiveGeo } from "@/lib/types";

const VENUE_ID = "current";
const RADIUS_MIN = 50;
const RADIUS_MAX = 500;
const MAP_SIZE = 400;
/** Масштаб: 1px = сколько метров (чтобы радиус и точки Staff помещались) */
const METERS_PER_PX = 2;

function latLngToPx(
  staffLat: number,
  staffLng: number,
  venueLat: number,
  venueLng: number,
  centerPx: number,
  metersPerPx: number
): { x: number; y: number } {
  const toM = (deg: number, scale: number) => deg * scale * 1000;
  const latScale = 111;
  const lngScale = 111 * Math.cos((venueLat * Math.PI) / 180);
  const dxM = (staffLng - venueLng) * lngScale * 1000;
  const dyM = (staffLat - venueLat) * latScale * 1000;
  return {
    x: centerPx + dxM / metersPerPx,
    y: centerPx - dyM / metersPerPx,
  };
}

export default function AdminSettingsGeoPage() {
  const [lat, setLat] = useState(55.75);
  const [lng, setLng] = useState(37.62);
  const [radius, setRadius] = useState(100);
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
    const q = query(
      collection(db, "staffLiveGeos"),
      where("venueId", "==", VENUE_ID)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: StaffLiveGeo[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          staffId: data.staffId ?? "",
          venueId: data.venueId ?? "",
          lat: data.lat ?? 0,
          lng: data.lng ?? 0,
          isInside: data.isInside ?? false,
          lastUpdate: data.lastUpdate,
        };
      });
      setStaffGeos(list);
    });
    return () => unsub();
  }, []);

  const saveGeo = useCallback(
    async (next: Partial<VenueGeo>) => {
      setSaving(true);
      try {
        await updateDoc(doc(db, "venues", VENUE_ID), {
          geo: {
            lat: next.lat ?? lat,
            lng: next.lng ?? lng,
            radius: next.radius ?? radius,
          },
          updatedAt: serverTimestamp(),
        });
      } finally {
        setSaving(false);
      }
    },
    [lat, lng, radius]
  );

  const handleRadiusChange = (value: number) => {
    setRadius(value);
  };

  const handleRadiusCommit = useCallback(() => {
    saveGeo({ radius });
  }, [radius, saveGeo]);

  const handleLatLngBlur = useCallback(() => {
    saveGeo({ lat, lng });
  }, [lat, lng, saveGeo]);

  const radiusPx = radius / METERS_PER_PX;
  const cx = MAP_SIZE / 2;
  const cy = MAP_SIZE / 2;

  return (
    <div>
      <DebugPanelTrigger>
        {({ onClick }) => (
          <h2
            className="text-lg font-semibold text-gray-900 cursor-pointer select-none"
            onClick={onClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onClick()}
          >
            Настройки GPS (геозона)
          </h2>
        )}
      </DebugPanelTrigger>
      <p className="mt-1 text-sm text-gray-600">
        Маркер заведения и круг радиуса. Слайдер обновляет радиус; значение сохраняется в Firestore.
      </p>

      {!loaded ? (
        <p className="mt-4 text-sm text-gray-500">Загрузка…</p>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row">
            {/* SVG-карта: сетка, центр (заведение), пульсирующий круг, точки Staff */}
            <div className="shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-slate-50">
              <svg
                width={MAP_SIZE}
                height={MAP_SIZE}
                viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`}
                className="block"
              >
                {/* Сетка координат */}
                {Array.from({ length: 9 }, (_, i) => (
                  <g key={i}>
                    <line
                      x1={0}
                      y1={(MAP_SIZE / 8) * i}
                      x2={MAP_SIZE}
                      y2={(MAP_SIZE / 8) * i}
                      stroke="#cbd5e1"
                      strokeWidth={0.5}
                    />
                    <line
                      x1={(MAP_SIZE / 8) * i}
                      y1={0}
                      x2={(MAP_SIZE / 8) * i}
                      y2={MAP_SIZE}
                      stroke="#cbd5e1"
                      strokeWidth={0.5}
                    />
                  </g>
                ))}
                {/* Пульсирующий круг радиуса */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={radiusPx}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  strokeOpacity={0.6}
                  className="animate-pulse"
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={radiusPx}
                  fill="rgba(59, 130, 246, 0.08)"
                />
                {/* Центр — заведение */}
                <circle cx={cx} cy={cy} r={6} fill="#1d4ed8" stroke="#fff" strokeWidth={2} />
                <title>{`Заведение ${lat.toFixed(5)}, ${lng.toFixed(5)}`}</title>
                {/* Точки Staff в реальном времени */}
                {staffGeos.map((s) => {
                  const { x, y } = latLngToPx(s.lat, s.lng, lat, lng, cx, METERS_PER_PX);
                  const inBounds = x >= 0 && x <= MAP_SIZE && y >= 0 && y <= MAP_SIZE;
                  if (!inBounds) return null;
                  return (
                    <g key={s.staffId}>
                      <circle
                        cx={x}
                        cy={y}
                        r={5}
                        fill={s.isInside ? "#22c55e" : "#ef4444"}
                        stroke="#fff"
                        strokeWidth={1.5}
                      />
                      <title>{`${s.staffId} ${s.isInside ? "в зоне" : "вне зоны"}`}</title>
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="flex flex-1 flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Радиус охраны, м
                </label>
                <input
                  type="range"
                  min={RADIUS_MIN}
                  max={RADIUS_MAX}
                  value={radius}
                  onChange={(e) => handleRadiusChange(Number(e.target.value))}
                  onMouseUp={handleRadiusCommit}
                  onTouchEnd={handleRadiusCommit}
                  className="mt-1 w-full accent-blue-600"
                />
                <p className="mt-1 text-sm text-gray-600">
                  {radius} м — круг на карте расширяется при перемещении слайдера
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  При отпускании слайдера значение geo.radius сохраняется в Firestore.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700">Широта (Lat)</span>
                  <input
                    type="number"
                    step="any"
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    value={lat}
                    onChange={(e) => setLat(Number(e.target.value))}
                    onBlur={handleLatLngBlur}
                  />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700">Долгота (Lng)</span>
                  <input
                    type="number"
                    step="any"
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    value={lng}
                    onChange={(e) => setLng(Number(e.target.value))}
                    onBlur={handleLatLngBlur}
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => saveGeo({ lat, lng, radius })}
                disabled={saving}
                className="self-start rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {saving ? "Сохранение…" : "Сохранить в Firestore"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
