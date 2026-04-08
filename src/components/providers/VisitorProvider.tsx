"use client";

/**
 * Сквозная идентификация гостя (Visitor ID).
 * UUID сохраняется в localStorage; при первом визите на /check-in записывается в Firestore (visitor_sessions).
 * Инициализирует анонимный вход Firebase для правил Firestore.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db, auth, signInAnonymously } from "@/lib/firebase";
import {
  GUEST_DEVICE_STORAGE_KEY,
  getOrCreateGuestDeviceId,
} from "@/lib/guest-device-anchor";

export interface VisitorContextValue {
  visitorId: string | null;
  setVisitorId: (id: string) => void;
  recordVisitorSession: (venueId: string, tableId: string) => Promise<void>;
}

const VisitorContext = createContext<VisitorContextValue>({
  visitorId: null,
  setVisitorId: () => {},
  recordVisitorSession: async () => {},
});

export function useVisitor() {
  const ctx = useContext(VisitorContext);
  if (!ctx) {
    throw new Error("useVisitor must be used within VisitorProvider");
  }
  return ctx;
}

interface VisitorProviderProps {
  children: ReactNode;
}

export function VisitorProvider({ children }: VisitorProviderProps) {
  const [visitorId, setVisitorId] = useState<string | null>(() =>
    typeof window !== "undefined" ? getOrCreateGuestDeviceId() || null : null
  );
  const recordedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const id = getOrCreateGuestDeviceId();
    setVisitorId(id || null);
    if (id && process.env.NODE_ENV === "development") {
      console.log("Visitor ID detected:", id);
    }
  }, []);

  const setVisitorIdFromExternal = useCallback((id: string) => {
    if (typeof window === "undefined" || !id) return;
    try {
      localStorage.setItem(GUEST_DEVICE_STORAGE_KEY, id);
      setVisitorId(id);
      if (process.env.NODE_ENV === "development") {
        console.log("Visitor ID detected:", id);
      }
    } catch (_) {}
  }, []);

  // Анонимный вход для гостей (безопасность правил Firestore)
  useEffect(() => {
    if (typeof window === "undefined") return;
    signInAnonymously(auth).catch((e) => {
      console.warn("[VisitorProvider] signInAnonymously failed:", e);
    });
  }, []);

  const recordVisitorSession = useCallback(
    async (venueId: string, tableId: string) => {
      const id = visitorId ?? getOrCreateGuestDeviceId();
      if (!id || !venueId || !tableId) return;
      const key = `${id}:${venueId}:${tableId}`;
      if (recordedRef.current.has(key)) return;
      recordedRef.current.add(key);
      try {
        await addDoc(collection(db, "visitor_sessions"), {
          visitorId: id,
          venueId,
          tableId,
          createdAt: serverTimestamp(),
        });
      } catch (e) {
        console.warn("[VisitorProvider] recordVisitorSession failed:", e);
        recordedRef.current.delete(key);
      }
    },
    [visitorId]
  );

  const value: VisitorContextValue = {
    visitorId,
    setVisitorId: setVisitorIdFromExternal,
    recordVisitorSession,
  };

  return (
    <VisitorContext.Provider value={value}>
      {children}
    </VisitorContext.Provider>
  );
}
