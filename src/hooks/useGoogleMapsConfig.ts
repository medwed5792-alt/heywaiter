"use client";

import { useState, useEffect } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

const SYSTEM_CONFIG_GOOGLE_MAPS = "google_maps";

export interface GoogleMapsConfig {
  apiKey: string;
  placesApiKey: string;
  hasKey: boolean;
}

/**
 * Ключ: сначала Firestore (system_config/google_maps), затем .env (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).
 */
export function useGoogleMapsConfig(): GoogleMapsConfig {
  const [apiKey, setApiKey] = useState("");
  const [placesApiKey, setPlacesApiKey] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "system_config", SYSTEM_CONFIG_GOOGLE_MAPS));
        if (snap.exists()) {
          const d = snap.data();
          const mapsKey = String(d?.googleMapsApiKey ?? "").trim();
          const placesKey = String(d?.googlePlacesApiKey ?? "").trim();
          if (mapsKey) {
            setApiKey(mapsKey);
            setPlacesApiKey(placesKey || mapsKey);
            setLoaded(true);
            return;
          }
        }
      } catch (_) {}
      const envKey = typeof process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY === "string"
        ? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.trim()
        : "";
      if (envKey) {
        setApiKey(envKey);
        setPlacesApiKey(envKey);
      }
      setLoaded(true);
    })();
  }, []);

  const key = apiKey || "";
  return {
    apiKey: key,
    placesApiKey: placesApiKey || key,
    hasKey: key.length > 0,
  };
}
