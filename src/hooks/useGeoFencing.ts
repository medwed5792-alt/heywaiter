"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { doc, getDoc, updateDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isOutsideVenue, offsetLatLngByMeters } from "@/lib/geo";
import { createGuestEscapeAlert, createStaffEscapeAlert } from "@/lib/stealth-notifications";
import { getSimulateOutOfZone } from "@/components/debug/DebugPanelTrigger";
import type { VenueGeo } from "@/lib/types";

const CHECK_INTERVAL_MS = 30_000;
const OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 60_000,
  timeout: 10_000,
};

export type GeoFencingMode = "guest" | "staff";

interface UseGeoFencingGuest {
  mode: "guest";
  venueId: string;
  tableId: string;
  sessionId?: string;
  sessionOpen: boolean;
  /** Ghost: запрашивать GPS только после первого нажатия любой кнопки (с пояснением "Для точности подачи заказа") */
  startAfterUserAction?: boolean;
}

interface UseGeoFencingStaff {
  mode: "staff";
  venueId: string;
  staffId: string;
  staffName: string;
  onShift: boolean;
}

type UseGeoFencingParams = UseGeoFencingGuest | UseGeoFencingStaff;

/**
 * Ghost: локация запрашивается ТОЛЬКО после первого нажатия кнопки в Mini App.
 * Если гость запретил GPS — не блокируем интерфейс, логируем geo_status: denied в сессию.
 */
export function useGeoFencing(params: UseGeoFencingParams) {
  const { venueId } = params;
  const geoRef = useRef<VenueGeo | null>(null);
  const alertedGuestRef = useRef(false);
  const alertedStaffRef = useRef(false);
  const [active, setActive] = useState(!(params.mode === "guest" && params.startAfterUserAction));

  const paramsRef = useRef(params);
  paramsRef.current = params;

  const checkPosition = useCallback(
    async (lat: number, lng: number) => {
      const geo = geoRef.current;
      if (!geo) return;
      const outside = isOutsideVenue(lat, lng, geo.lat, geo.lng, geo.radius);
      if (!outside) return;

      const p = paramsRef.current;
      if (p.mode === "guest" && p.sessionOpen && !alertedGuestRef.current) {
        alertedGuestRef.current = true;
        await createGuestEscapeAlert(venueId, p.tableId, p.sessionId);
      }
      if (p.mode === "staff" && p.onShift && !alertedStaffRef.current) {
        alertedStaffRef.current = true;
        await createStaffEscapeAlert(venueId, p.staffId, p.staffName);
      }
    },
    [venueId]
  );

  const onPosition = useCallback(
    (position: GeolocationPosition) => {
      let lat = position.coords.latitude;
      let lng = position.coords.longitude;
      if (getSimulateOutOfZone()) {
        const offset = offsetLatLngByMeters(lat, lng, 500, 0);
        lat = offset.lat;
        lng = offset.lng;
      }
      checkPosition(lat, lng);

      const p = paramsRef.current;
      if (p.mode === "staff" && p.onShift) {
        const geo = geoRef.current;
        const isInside = geo
          ? !isOutsideVenue(lat, lng, geo.lat, geo.lng, geo.radius ?? 100)
          : false;
        setDoc(doc(db, "staffLiveGeos", p.staffId), {
          staffId: p.staffId,
          venueId: p.venueId,
          lat,
          lng,
          isInside,
          lastUpdate: serverTimestamp(),
        }).catch(() => {});
      }
    },
    [checkPosition]
  );

  useEffect(() => {
    if (!active) return;
    let watchId: number | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    (async () => {
      const venueSnap = await getDoc(doc(db, "venues", venueId));
      const geo = venueSnap.exists() ? venueSnap.data().geo : undefined;
      if (!geo?.lat || !geo?.lng) return;
      geoRef.current = { lat: geo.lat, lng: geo.lng, radius: geo.radius ?? 100 };

      if (typeof navigator === "undefined" || !navigator.geolocation) return;
      const onError = (err: GeolocationPositionError) => {
        if (err.code !== err.PERMISSION_DENIED) return;
        const p = paramsRef.current;
        if (p.mode === "guest" && p.sessionId) {
          updateDoc(doc(db, "activeSessions", p.sessionId), {
            geoStatus: "denied",
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
      };
      watchId = navigator.geolocation.watchPosition(onPosition, onError, OPTIONS);
      intervalId = setInterval(() => {
        navigator.geolocation.getCurrentPosition(onPosition, onError, OPTIONS);
      }, CHECK_INTERVAL_MS);
    })();

    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      if (intervalId != null) clearInterval(intervalId);
    };
  }, [venueId, onPosition, active, params.mode, params.sessionId]);

  const startGeoFencing = useCallback(() => {
    if (params.mode === "guest" && params.startAfterUserAction) setActive(true);
  }, [params.mode, params.startAfterUserAction]);

  return {
    startGeoFencing,
    geoPromptMessage: "Для точности подачи заказа разрешите доступ к геолокации.",
  };
}
