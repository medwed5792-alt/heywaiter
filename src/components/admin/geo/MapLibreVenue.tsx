"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const DEMO_STYLE = "https://demotiles.maplibre.org/style.json";
const CIRCLE_COLOR = "#2563eb";
const CIRCLE_OPACITY = 0.25;
const SOURCE_ID = "venue-radius";
const LAYER_ID = "venue-radius-fill";

/** Генерирует полигон-круг в GeoJSON (WGS84) по центру и радиусу в метрах. */
function circleToPolygon(lat: number, lng: number, radiusM: number, points = 64): GeoJSON.Polygon {
  const coords: [number, number][] = [];
  const latRad = (lat * Math.PI) / 180;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(latRad);
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dLat = (radiusM * Math.cos(angle)) / mPerDegLat;
    const dLng = (radiusM * Math.sin(angle)) / mPerDegLng;
    coords.push([lng + dLng, lat + dLat]);
  }
  return { type: "Polygon", coordinates: [coords] };
}

export interface MapLibreVenueProps {
  lat: number;
  lng: number;
  radius: number;
  onLatLngChange: (lat: number, lng: number) => void;
}

export function MapLibreVenue({ lat, lng, radius, onLatLngChange }: MapLibreVenueProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onLatLngRef = useRef(onLatLngChange);
  onLatLngRef.current = onLatLngChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DEMO_STYLE,
      center: [lng, lat],
      zoom: 15,
    });

    mapRef.current = map;

    const marker = new maplibregl.Marker({ draggable: true })
      .setLngLat([lng, lat])
      .addTo(map);

    marker.on("dragend", () => {
      const pos = marker.getLngLat();
      onLatLngRef.current(pos.lat, pos.lng);
    });

    markerRef.current = marker;

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      const m = mapRef.current;
      if (!m) return;
      m.addSource(SOURCE_ID, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: circleToPolygon(lat, lng, radius),
        },
      });
      m.addLayer({
        id: LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": CIRCLE_COLOR,
          "fill-opacity": CIRCLE_OPACITY,
        },
      });
    });

    return () => {
      marker.remove();
      const m = mapRef.current;
      if (m) {
        if (m.getLayer(LAYER_ID)) m.removeLayer(LAYER_ID);
        if (m.getSource(SOURCE_ID)) m.removeSource(SOURCE_ID);
        m.remove();
      }
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    marker.setLngLat([lng, lat]);
    map.setCenter([lng, lat]);
    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData({
        type: "Feature",
        properties: {},
        geometry: circleToPolygon(lat, lng, radius),
      });
    }
  }, [lat, lng, radius]);

  return (
    <div
      id="map-container"
      ref={containerRef}
      className="w-full rounded-xl border border-gray-200 overflow-hidden"
      style={{ height: "450px" }}
    />
  );
}
