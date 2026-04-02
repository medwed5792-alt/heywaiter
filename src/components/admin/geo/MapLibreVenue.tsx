"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { StaffLiveGeo } from "@/lib/types";

/** Детальный растровый стиль OSM (улицы и дома). */
const OSM_RASTER_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const CIRCLE_COLOR = "#2563eb";
const CIRCLE_OPACITY = 0.25;
const SOURCE_ID = "venue-radius";
const LAYER_ID = "venue-radius-fill";
const STAFF_SOURCE_ID = "staff-geos";
const STAFF_LAYER_ID = "staff-geos-circles";

function createRedMarkerElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "venue-marker-red";
  el.style.width = "24px";
  el.style.height = "24px";
  el.style.borderRadius = "50%";
  el.style.backgroundColor = "#dc2626";
  el.style.border = "3px solid white";
  el.style.boxShadow = "0 1px 4px rgba(0,0,0,0.4)";
  el.style.cursor = "grab";
  return el;
}

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
  staffGeos?: StaffLiveGeo[];
}

export function MapLibreVenue({ lat, lng, radius, onLatLngChange, staffGeos = [] }: MapLibreVenueProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onLatLngRef = useRef(onLatLngChange);
  onLatLngRef.current = onLatLngChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_RASTER_STYLE,
      center: [lng, lat],
      zoom: 16,
    });

    mapRef.current = map;

    const markerEl = createRedMarkerElement();
    const marker = new maplibregl.Marker({ element: markerEl, draggable: true })
      .setLngLat([lng, lat])
      .addTo(map);

    marker.on("dragend", () => {
      const pos = marker.getLngLat();
      onLatLngRef.current(pos.lat, pos.lng);
    });

    markerRef.current = marker;

    map.on("click", (e) => {
      marker.setLngLat(e.lngLat);
      onLatLngRef.current(e.lngLat.lat, e.lngLat.lng);
    });

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
      m.addSource(STAFF_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer({
        id: STAFF_LAYER_ID,
        type: "circle",
        source: STAFF_SOURCE_ID,
        paint: {
          "circle-radius": 6,
          "circle-color": ["case", ["get", "isInside"], "#22c55e", "#ef4444"],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fff",
        },
      });
    });

    return () => {
      marker.remove();
      const m = mapRef.current;
      if (m) {
        if (m.getLayer(STAFF_LAYER_ID)) m.removeLayer(STAFF_LAYER_ID);
        if (m.getSource(STAFF_SOURCE_ID)) m.removeSource(STAFF_SOURCE_ID);
        if (m.getLayer(LAYER_ID)) m.removeLayer(LAYER_ID);
        if (m.getSource(SOURCE_ID)) m.removeSource(SOURCE_ID);
        m.remove();
      }
      mapRef.current = null;
      markerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- init once; sync in next effect
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    marker.setLngLat([lng, lat]);
    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData({
        type: "Feature",
        properties: {},
        geometry: circleToPolygon(lat, lng, radius),
      });
    }
  }, [lat, lng, radius]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource(STAFF_SOURCE_ID)) return;
    const src = map.getSource(STAFF_SOURCE_ID) as maplibregl.GeoJSONSource;
    const features: GeoJSON.Feature<GeoJSON.Point>[] = staffGeos.map((s) => ({
      type: "Feature",
      properties: { isInside: s.isInside, staffId: s.staffId },
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
    }));
    src.setData({ type: "FeatureCollection", features });
  }, [staffGeos]);

  return (
    <div
      id="map-container"
      ref={containerRef}
      className="w-full rounded-xl border border-gray-200 overflow-hidden"
      style={{ height: "450px" }}
    />
  );
}
