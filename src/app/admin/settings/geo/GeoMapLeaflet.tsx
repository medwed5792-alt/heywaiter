"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { StaffLiveGeo } from "@/lib/types";

const RED_ZONE_COLOR = "#dc2626";
const RED_ZONE_OPACITY = 0.25;

interface GeoMapLeafletProps {
  lat: number;
  lng: number;
  radius: number;
  staffGeos: StaffLiveGeo[];
  onLatLngChange: (lat: number, lng: number) => void;
  onRadiusChange: (r: number) => void;
  mapRef: React.MutableRefObject<L.Map | null | unknown>;
  markerRef: React.MutableRefObject<L.Marker | null | unknown>;
  circleRef: React.MutableRefObject<L.Circle | null | unknown>;
  layerRef: React.MutableRefObject<L.LayerGroup | null | unknown>;
}

export function GeoMapLeaflet({
  lat,
  lng,
  radius,
  staffGeos,
  onLatLngChange,
  mapRef,
  markerRef,
  circleRef,
  layerRef,
}: GeoMapLeafletProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inited = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!inited.current) {
      inited.current = true;
      const map = L.map(containerRef.current).setView([lat, lng], 16);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
      }).addTo(map);

      // Иконка маркера: в бандлерах путь к дефолтной иконке Leaflet часто ломается
      const icon = L.icon({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
      });
      const marker = L.marker([lat, lng], { draggable: true, icon }).addTo(map);
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        onLatLngChange(pos.lat, pos.lng);
      });

      const circle = L.circle([lat, lng], {
        radius,
        color: RED_ZONE_COLOR,
        fillColor: RED_ZONE_COLOR,
        fillOpacity: RED_ZONE_OPACITY,
        weight: 2,
      }).addTo(map);

      const staffLayer = L.layerGroup().addTo(map);
      mapRef.current = map;
      markerRef.current = marker;
      circleRef.current = circle;
      layerRef.current = staffLayer;
    }

    return () => {
      (mapRef.current as L.Map | null)?.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const marker = markerRef.current as L.Marker | null;
    const circle = circleRef.current as L.Circle | null;
    const map = mapRef.current as L.Map | null;
    if (!marker || !circle || !map) return;

    marker.setLatLng([lat, lng]);
    circle.setLatLng([lat, lng]);
    circle.setRadius(radius);
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, radius, mapRef, markerRef, circleRef]);

  useEffect(() => {
    const staffLayer = layerRef.current as L.LayerGroup | null;
    if (!staffLayer) return;

    staffLayer.clearLayers();
    staffGeos.forEach((s) => {
      const color = s.isInside ? "#22c55e" : "#ef4444";
      L.circleMarker([s.lat, s.lng], {
        radius: 6,
        fillColor: color,
        color: "#fff",
        weight: 1.5,
        fillOpacity: 1,
      })
        .bindTooltip(`${s.staffId} ${s.isInside ? "в зоне" : "вне зоны"}`, { permanent: false })
        .addTo(staffLayer);
    });
  }, [staffGeos, layerRef]);

  return (
    <div
      ref={containerRef}
      className="h-[400px] w-full rounded-xl border border-gray-200 overflow-hidden"
      style={{ minHeight: 400 }}
    />
  );
}
