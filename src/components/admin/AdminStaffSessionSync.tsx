"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { auth } from "@/lib/firebase";
import { getIdToken } from "firebase/auth";

const REFRESH_MS = 45 * 60 * 1000;

/** Продлевает httpOnly cookie с Firebase ID token для middleware. */
export function AdminStaffSessionSync() {
  const pathname = usePathname();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (pathname?.startsWith("/admin/login")) return;

    const tick = async () => {
      const u = auth.currentUser;
      if (!u) return;
      try {
        const token = await getIdToken(u, true);
        await fetch("/api/auth/sync-staff-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: token }),
          credentials: "same-origin",
        });
      } catch {
        /* ignore */
      }
    };

    void tick();
    intervalRef.current = setInterval(() => void tick(), REFRESH_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [pathname]);

  return null;
}
