"use client";

import { useState, useEffect } from "react";
import { subscribeRolesOnShift } from "@/lib/shift-aware-roles";
import type { ServiceRole } from "@/lib/types";

/**
 * Подписка на роли на смене (onSnapshot). Кнопки вызова у гостя появляются/исчезают в реальном времени.
 */
export function useRolesOnShift(venueId: string | null) {
  const [roles, setRoles] = useState<ServiceRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!venueId) {
      setRoles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeRolesOnShift(venueId, (r) => {
      setRoles(r);
      setLoading(false);
    });
    return () => unsub();
  }, [venueId]);

  return { roles, loading };
}
