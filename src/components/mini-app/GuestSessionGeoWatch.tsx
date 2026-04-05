"use client";

import { useGeoFencing } from "@/hooks/useGeoFencing";
import { useGuestContext } from "@/components/mini-app/GuestMiniAppStateProvider";

function telegramGuestLabel(): string {
  if (typeof window === "undefined") return "Гость";
  const tg = (
    window as unknown as {
      Telegram?: { WebApp?: { initDataUnsafe?: { user?: { first_name?: string; last_name?: string } } } };
    }
  ).Telegram?.WebApp;
  const u = tg?.initDataUnsafe?.user;
  if (!u) return "Гость";
  const s = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return s || "Гость";
}

/**
 * Геозона с момента открытой сессии стола (включая экран приветствия). Снимается, когда стол закрыт / гость ушёл с экрана стола.
 * Уведомление при каждом переходе «были внутри зоны → оказались снаружи».
 */
export function GuestSessionGeoWatch() {
  const { currentLocation, activeSession } = useGuestContext();
  const venueId = currentLocation.venueId?.trim() ?? "";
  const tableId = currentLocation.tableId?.trim() ?? "";
  const sessionOpen = Boolean(activeSession && venueId && tableId);

  useGeoFencing({
    mode: "guest",
    venueId: venueId || "_",
    tableId: tableId || "_",
    sessionId: activeSession?.id,
    sessionOpen,
    guestLabel: telegramGuestLabel(),
    tableNumber: activeSession?.tableNumber,
    startAfterUserAction: false,
  });

  return null;
}
