"use client";

import { useEffect, useRef, useState } from "react";

const RED_ZONE_COLOR = "#dc2626";
const RED_ZONE_OPACITY = 0.25;

declare global {
  interface Window {
    google?: typeof google;
    __googleMapsVenueInit?: () => void;
  }
}

export interface GoogleMapVenueProps {
  apiKey: string;
  lat: number;
  lng: number;
  radius: number;
  onLatLngChange: (lat: number, lng: number) => void;
  onRadiusChange: (r: number) => void;
  onAddressSelect?: (address: string) => void;
}

export function GoogleMapVenue({
  apiKey,
  lat,
  lng,
  radius,
  onLatLngChange,
  onRadiusChange,
  onAddressSelect,
}: GoogleMapVenueProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onLatLngRef = useRef(onLatLngChange);
  const onRadiusRef = useRef(onRadiusChange);
  onLatLngRef.current = onLatLngChange;
  onRadiusRef.current = onRadiusChange;

  useEffect(() => {
    if (!apiKey || !containerRef.current) return;

    const initMap = () => {
      if (!containerRef.current || !window.google) return;
      const center = { lat, lng };
      const map = new window.google.maps.Map(containerRef.current, {
        center,
        zoom: 16,
        mapTypeControl: true,
        streetViewControl: false,
      });
      mapRef.current = map;

      const marker = new window.google.maps.Marker({
        position: center,
        map,
        draggable: true,
        title: "Центр зоны",
      });
      marker.addListener("dragend", () => {
        const pos = marker.getPosition();
        if (pos) onLatLngRef.current(pos.lat(), pos.lng());
      });
      markerRef.current = marker;

      const circle = new window.google.maps.Circle({
        map,
        center,
        radius,
        fillColor: RED_ZONE_COLOR,
        fillOpacity: RED_ZONE_OPACITY,
        strokeColor: RED_ZONE_COLOR,
        strokeWeight: 2,
      });
      circleRef.current = circle;

      if (inputRef.current && window.google.maps.places) {
        const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
          types: ["address"],
          fields: ["geometry", "formatted_address"],
        });
        autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace();
          if (place.geometry?.location) {
            const lat2 = place.geometry.location.lat();
            const lng2 = place.geometry.location.lng();
            onLatLngRef.current(lat2, lng2);
            if (place.formatted_address) onAddressSelect?.(place.formatted_address);
          }
        });
        autocompleteRef.current = autocomplete;
      }
      setLoaded(true);
    };

    if (window.google?.maps?.Map) {
      initMap();
      return;
    }

    const callbackName = "__googleMapsVenueInit";
    window[callbackName] = () => {
      initMap();
      window[callbackName] = undefined;
    };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      setError("Не удалось загрузить Google Maps");
      window[callbackName] = undefined;
    };
    document.head.appendChild(script);
    return () => {
      script.remove();
      circleRef.current?.setMap(null);
      markerRef.current?.setMap(null);
      mapRef.current = null;
      circleRef.current = null;
      markerRef.current = null;
      autocompleteRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- init on apiKey; geometry in next effect
  }, [apiKey]);

  useEffect(() => {
    if (!loaded || !mapRef.current || !markerRef.current || !circleRef.current) return;
    const center = { lat, lng };
    markerRef.current.setPosition(center);
    circleRef.current.setCenter(center);
    circleRef.current.setRadius(radius);
    mapRef.current.setCenter(center);
  }, [loaded, lat, lng, radius]);

  if (error) {
    return (
      <div className="flex h-[400px] w-full items-center justify-center rounded-xl border border-gray-200 bg-slate-50 text-sm text-red-600">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="text"
        placeholder="Поиск по адресу (Google Places)"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <div className="relative h-[400px] w-full">
        <div
          ref={containerRef}
          className="h-full w-full rounded-xl border border-gray-200 overflow-hidden"
        />
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl border border-gray-200 bg-slate-50 text-sm text-gray-500">
            Загрузка карты…
          </div>
        )}
      </div>
    </div>
  );
}
