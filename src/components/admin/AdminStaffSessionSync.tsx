"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { auth } from "@/lib/firebase";
import { getIdToken } from "firebase/auth";
import { isStaffAdminLoginPath } from "@/lib/auth/staff-admin-paths";

const REFRESH_MS = 45 * 60 * 1000;

/** Продлевает httpOnly cookie с Firebase ID token для middleware. */
export function AdminStaffSessionSync() {
  const pathname = usePathname();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isStaffAdminLoginPath(pathname)) return;

    const tick = async () => {
      const u = auth.currentUser;
      if (!u) return;
      try {
        const token = await getIdToken(u, true);
        const r = await fetch("/api/auth/sync-staff-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: token }),
          credentials: "same-origin",
        });
        if (r.status === 401 || r.status === 403) {
          await fetch("/api/auth/clear-staff-session", { method: "POST", credentials: "same-origin" });
          const next = encodeURIComponent(
            `${pathname ?? "/admin"}${typeof window !== "undefined" ? window.location.search : ""}`
          );
          window.location.assign(`/admin/login?next=${next}`);
        }
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
