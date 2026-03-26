"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { haversineDistanceM } from "@/lib/geo";

type LocationStatus = "idle" | "requesting" | "ready" | "denied" | "unavailable" | "error";

type VenueGeoData = {
  lat: number;
  lng: number;
  radius: number;
};

type EffectiveRadiusResult = {
  venueId: string;
  configured: boolean;
  venueRadius: number | null;
  globalRadiusLimit: number;
  effectiveRadius: number | null;
  venueLat: number | null;
  venueLng: number | null;
};

type VenueDistanceResult = {
  venueId: string;
  configured: boolean;
  effectiveRadius: number | null;
  distanceMeters: number | null;
  isNear: boolean;
};

type InsideVenueResult = {
  allowed: boolean;
  configured: boolean;
  distanceMeters: number | null;
  effectiveRadius: number | null;
};

type SotaLocationContextValue = {
  coords: { lat: number; lng: number } | null;
  status: LocationStatus;
  error: string | null;
  globalRadiusLimit: number;
  requestLocation: () => Promise<{ lat: number; lng: number } | null>;
  getEffectiveRadius: (venueId: string) => Promise<EffectiveRadiusResult>;
  getVenueDistance: (venueId: string) => Promise<VenueDistanceResult>;
  checkInsideVenue: (venueId: string) => Promise<InsideVenueResult>;
};

const DEFAULT_GLOBAL_RADIUS_LIMIT = 500;

const SotaLocationContext = createContext<SotaLocationContextValue | null>(null);

function readVenueGeo(raw: unknown): VenueGeoData | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const lat = typeof d.lat === "number" ? d.lat : NaN;
  const lng = typeof d.lng === "number" ? d.lng : NaN;
  const radius = typeof d.radius === "number" && Number.isFinite(d.radius) ? d.radius : 100;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, radius };
}

export function SotaLocationProvider({ children }: { children: ReactNode }) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [status, setStatus] = useState<LocationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [globalRadiusLimit, setGlobalRadiusLimit] = useState<number>(DEFAULT_GLOBAL_RADIUS_LIMIT);
  const venueGeoCacheRef = useRef<Map<string, VenueGeoData | null>>(new Map());

  useEffect(() => {
    const ref = doc(db, "system_settings", "global");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const d = (snap.data() ?? {}) as Record<string, unknown>;
        const next =
          typeof d.geoRadiusLimit === "number" && Number.isFinite(d.geoRadiusLimit)
            ? d.geoRadiusLimit
            : DEFAULT_GLOBAL_RADIUS_LIMIT;
        setGlobalRadiusLimit(next);
      },
      () => setGlobalRadiusLimit(DEFAULT_GLOBAL_RADIUS_LIMIT)
    );
    return () => unsub();
  }, []);

  const requestLocation = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      setError("Геолокация недоступна");
      return null;
    }

    setStatus("requesting");
    setError(null);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          maximumAge: 60_000,
          timeout: 10_000,
        });
      });
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setCoords(next);
      setStatus("ready");
      return next;
    } catch (e) {
      const ge = e as GeolocationPositionError | undefined;
      if (ge?.code === ge.PERMISSION_DENIED) {
        setStatus("denied");
        setError("Доступ к геолокации запрещен");
      } else {
        setStatus("error");
        setError("Не удалось получить координаты");
      }
      return null;
    }
  }, []);

  const getVenueGeo = useCallback(async (venueId: string): Promise<VenueGeoData | null> => {
    const key = venueId.trim();
    if (!key) return null;
    if (venueGeoCacheRef.current.has(key)) {
      return venueGeoCacheRef.current.get(key) ?? null;
    }
    try {
      const snap = await getDoc(doc(db, "venues", key));
      const geo = snap.exists() ? readVenueGeo((snap.data() as Record<string, unknown>).geo) : null;
      venueGeoCacheRef.current.set(key, geo);
      return geo;
    } catch {
      venueGeoCacheRef.current.set(key, null);
      return null;
    }
  }, []);

  const getEffectiveRadius = useCallback(
    async (venueId: string): Promise<EffectiveRadiusResult> => {
      const geo = await getVenueGeo(venueId);
      if (!geo) {
        return {
          venueId,
          configured: false,
          venueRadius: null,
          globalRadiusLimit,
          effectiveRadius: null,
          venueLat: null,
          venueLng: null,
        };
      }
      const effectiveRadius = Math.min(geo.radius, globalRadiusLimit);
      return {
        venueId,
        configured: true,
        venueRadius: geo.radius,
        globalRadiusLimit,
        effectiveRadius,
        venueLat: geo.lat,
        venueLng: geo.lng,
      };
    },
    [getVenueGeo, globalRadiusLimit]
  );

  const getVenueDistance = useCallback(
    async (venueId: string): Promise<VenueDistanceResult> => {
      const eff = await getEffectiveRadius(venueId);
      const current =
        coords ??
        (status === "idle" || status === "requesting"
          ? await requestLocation()
          : null);
      if (!current || !eff.configured || eff.venueLat == null || eff.venueLng == null || eff.effectiveRadius == null) {
        return {
          venueId,
          configured: eff.configured,
          effectiveRadius: eff.effectiveRadius,
          distanceMeters: null,
          isNear: false,
        };
      }
      const distanceMeters = haversineDistanceM(current.lat, current.lng, eff.venueLat, eff.venueLng);
      return {
        venueId,
        configured: true,
        effectiveRadius: eff.effectiveRadius,
        distanceMeters,
        isNear: distanceMeters <= eff.effectiveRadius,
      };
    },
    [coords, getEffectiveRadius, requestLocation, status]
  );

  const checkInsideVenue = useCallback(
    async (venueId: string): Promise<InsideVenueResult> => {
      const dist = await getVenueDistance(venueId);
      if (!dist.configured || dist.distanceMeters == null) {
        return {
          allowed: true,
          configured: dist.configured,
          distanceMeters: dist.distanceMeters,
          effectiveRadius: dist.effectiveRadius,
        };
      }
      return {
        allowed: dist.isNear,
        configured: dist.configured,
        distanceMeters: dist.distanceMeters,
        effectiveRadius: dist.effectiveRadius,
      };
    },
    [getVenueDistance]
  );

  const value = useMemo<SotaLocationContextValue>(
    () => ({
      coords,
      status,
      error,
      globalRadiusLimit,
      requestLocation,
      getEffectiveRadius,
      getVenueDistance,
      checkInsideVenue,
    }),
    [coords, status, error, globalRadiusLimit, requestLocation, getEffectiveRadius, getVenueDistance, checkInsideVenue]
  );

  return <SotaLocationContext.Provider value={value}>{children}</SotaLocationContext.Provider>;
}

export function useSotaLocation(): SotaLocationContextValue {
  const ctx = useContext(SotaLocationContext);
  if (!ctx) throw new Error("useSotaLocation must be used within SotaLocationProvider");
  return ctx;
}

