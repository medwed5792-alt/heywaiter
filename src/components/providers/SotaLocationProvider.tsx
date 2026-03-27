"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { haversineDistanceM } from "@/lib/geo";

type LocationStatus = "idle" | "requesting" | "ready" | "denied" | "unavailable" | "error";
type LocationSource = "none" | "gps" | "network" | "ip";

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
  source: LocationSource;
  error: string | null;
  globalRadiusLimit: number;
  requestLocation: (force?: boolean) => Promise<{ lat: number; lng: number } | null>;
  getEffectiveRadius: (venueId: string) => Promise<EffectiveRadiusResult>;
  getVenueDistance: (venueId: string) => Promise<VenueDistanceResult>;
  checkInsideVenue: (venueId: string) => Promise<InsideVenueResult>;
};

const DEFAULT_GLOBAL_RADIUS_LIMIT = 500;
const HIGH_ACCURACY_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 5000,
  maximumAge: 0,
};
const COARSE_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10000,
  maximumAge: 60000,
};

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
  const [source, setSource] = useState<LocationSource>("none");
  const [error, setError] = useState<string | null>(null);
  const [globalRadiusLimit, setGlobalRadiusLimit] = useState<number>(DEFAULT_GLOBAL_RADIUS_LIMIT);
  const venueGeoCacheRef = useRef<Map<string, VenueGeoData | null>>(new Map());
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const statusRef = useRef<LocationStatus>("idle");
  const sourceRef = useRef<LocationSource>("none");
  const inFlightRef = useRef<Promise<{ lat: number; lng: number } | null> | null>(null);
  const autoFailCountRef = useRef(0);
  const stateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    coordsRef.current = coords;
  }, [coords]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

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

  const getGeoPosition = useCallback((options: PositionOptions) => {
    return new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
  }, []);

  const fetchIpFallback = useCallback(async (): Promise<{ lat: number; lng: number } | null> => {
    try {
      const res = await fetch("https://ipapi.co/json/");
      if (!res.ok) return null;
      const data = (await res.json()) as { latitude?: number; longitude?: number };
      const lat = Number(data.latitude);
      const lng = Number(data.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    } catch {
      return null;
    }
  }, []);

  const scheduleGeoStateUpdate = useCallback((updater: () => void) => {
    if (stateDebounceRef.current) {
      clearTimeout(stateDebounceRef.current);
    }
    stateDebounceRef.current = setTimeout(() => {
      updater();
      stateDebounceRef.current = null;
    }, 150);
  }, []);

  useEffect(() => {
    return () => {
      if (stateDebounceRef.current) clearTimeout(stateDebounceRef.current);
    };
  }, []);

  const requestLocation = useCallback(async (force = false) => {
    if (inFlightRef.current) return inFlightRef.current;

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      setError("Геолокация недоступна");
      return null;
    }

    if (!force && autoFailCountRef.current >= 2) {
      scheduleGeoStateUpdate(() => {
        setStatus("error");
        setError("Не удалось определить местоположение автоматически. Нажмите «Попробовать снова».");
      });
      return null;
    }

    const task = (async () => {
      scheduleGeoStateUpdate(() => {
        setStatus("requesting");
        setError(null);
      });
      try {
        // 1) Try high-accuracy GPS first (fast timeout).
        const pos = await getGeoPosition(HIGH_ACCURACY_OPTIONS).catch(async (err) => {
          const ge = err as GeolocationPositionError | undefined;
          if (ge?.code === ge.PERMISSION_DENIED) throw err;
          // 2) Fallback to coarse network/Wi-Fi mode.
          return await getGeoPosition(COARSE_OPTIONS);
        });
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        scheduleGeoStateUpdate(() => {
          setCoords(next);
          setStatus("ready");
          setSource(pos.coords.accuracy <= 150 ? "gps" : "network");
          setError(null);
        });
        autoFailCountRef.current = 0;
        return next;
      } catch (e) {
        const ge = e as GeolocationPositionError | undefined;
        const coarse = await fetchIpFallback();
        scheduleGeoStateUpdate(() => {
          if (ge?.code === ge.PERMISSION_DENIED) {
            setStatus("denied");
            setError("Доступ к геолокации запрещен. Разрешите геолокацию в браузере.");
          } else {
            setStatus("error");
            setError("Не удалось получить координаты. Включите Wi-Fi/GPS и повторите попытку.");
          }
          if (coarse) {
            setCoords(coarse);
            setSource("ip");
          } else {
            setSource("none");
          }
        });
        if (!force) autoFailCountRef.current += 1;
        return null;
      } finally {
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = task;
    return task;
  }, [fetchIpFallback, getGeoPosition, scheduleGeoStateUpdate]);

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
        coordsRef.current ??
        (statusRef.current === "idle" || statusRef.current === "requesting"
          ? await requestLocation()
          : null);
      if (sourceRef.current === "ip") {
        return {
          venueId,
          configured: eff.configured,
          effectiveRadius: eff.effectiveRadius,
          distanceMeters: null,
          isNear: false,
        };
      }
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
    [getEffectiveRadius, requestLocation]
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
      source,
      error,
      globalRadiusLimit,
      requestLocation,
      getEffectiveRadius,
      getVenueDistance,
      checkInsideVenue,
    }),
    [coords, status, source, error, globalRadiusLimit, requestLocation, getEffectiveRadius, getVenueDistance, checkInsideVenue]
  );

  return <SotaLocationContext.Provider value={value}>{children}</SotaLocationContext.Provider>;
}

export function useSotaLocation(): SotaLocationContextValue {
  const ctx = useContext(SotaLocationContext);
  if (!ctx) throw new Error("useSotaLocation must be used within SotaLocationProvider");
  return ctx;
}

