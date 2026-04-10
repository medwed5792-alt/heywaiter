"use client";

import { useState, useEffect } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  GOOGLE_MAPS_SYSTEM_CONFIG_DOC_ID,
  SYSTEM_CONFIGS_COLLECTION,
} from "@/lib/system-configs/collection";

export interface GoogleMapsConfig {
  apiKey: string;
  placesApiKey: string;
  hasKey: boolean;
}

/**
 * Ключ: сначала Firestore (system_configs/google_maps), затем .env (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).
 */
export function useGoogleMapsConfig(): GoogleMapsConfig {
  const [apiKey, setApiKey] = useState("");
  const [placesApiKey, setPlacesApiKey] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(
          doc(db, SYSTEM_CONFIGS_COLLECTION, GOOGLE_MAPS_SYSTEM_CONFIG_DOC_ID)
        );
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
