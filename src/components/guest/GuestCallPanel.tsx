"use client";

import { useState, useCallback, useEffect } from "react";
import { Bell, Receipt } from "lucide-react";
import { createTargetedNotification } from "@/lib/stealth-notifications";
import { useRolesOnShift } from "@/hooks/useRolesOnShift";
import { getRoleLabel } from "@/lib/shift-aware-roles";
import { VoiceTranslatorPro } from "./VoiceTranslatorPro";
import type { ServiceRole } from "@/lib/types";
import { CALL_WAITER_COOLDOWN_MS } from "@/lib/constants";
import { createGuestEvent } from "@/lib/guest-events";

interface GuestCallPanelProps {
  venueId: string;
  tableId: string;
  sessionId?: string;
  customerUid?: string | null;
  /** @deprecated use customerUid */
  visitorId?: string | null;
  sessionOpen?: boolean;
  isPro?: boolean;
}

export function GuestCallPanel({
  venueId,
  tableId,
  sessionId,
  customerUid,
  visitorId,
  sessionOpen: _sessionOpen = true,
  isPro = false,
}: GuestCallPanelProps) {
  const { roles, loading } = useRolesOnShift(venueId);
  const [callingRole, setCallingRole] = useState<ServiceRole | null>(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);

  const handleCallRole = useCallback(
    async (role: ServiceRole) => {
      setCallingRole(role);
      try {
        if (role === "waiter") {
          await createGuestEvent({
            type: "call_waiter",
            venueId,
            tableId,
            customerUid: customerUid ?? visitorId ?? undefined,
          });
        } else {
          await createTargetedNotification(
            venueId,
            tableId,
            role,
            `Вызов: ${getRoleLabel(role)}, стол №${tableId}`,
            sessionId
          );
        }
        setCooldownLeft(Math.ceil(CALL_WAITER_COOLDOWN_MS / 1000));
      } catch (e) {
        console.error("createTargetedNotification / call-waiter error:", e);
      } finally {
        setCallingRole(null);
      }
    },
    [venueId, tableId, sessionId, customerUid, visitorId]
  );

  const handleRequestBill = useCallback(async () => {
    setCallingRole("waiter");
    try {
      await createGuestEvent({
        type: "request_bill",
        venueId,
        tableId,
        customerUid: customerUid ?? visitorId ?? undefined,
      });
      setCooldownLeft(Math.ceil(CALL_WAITER_COOLDOWN_MS / 1000));
    } catch (e) {
      console.error("createTargetedNotification (счёт) error:", e);
    } finally {
      setCallingRole(null);
    }
  }, [venueId, tableId, customerUid, visitorId]);

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const t = setInterval(() => {
      setCooldownLeft((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [cooldownLeft]);

  const disabled = loading || cooldownLeft > 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">
        Вызвать сотрудника
      </h3>
      {loading ? (
        <p className="text-sm text-gray-500">Загрузка…</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {roles.map((role) => (
            <button
              key={role}
              type="button"
              disabled={disabled}
              onClick={() => handleCallRole(role)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              <Bell className="h-4 w-4" />
              {callingRole === role ? "…" : getRoleLabel(role)}
            </button>
          ))}
          {roles.length === 0 && (
            <p className="text-sm text-gray-500">
              Сейчас никто на смене. Обратитесь к официанту.
            </p>
          )}
        </div>
      )}
      <div className="mt-3">
        <button
          type="button"
          disabled={disabled}
          onClick={handleRequestBill}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <Receipt className="h-4 w-4" />
          Попросить счёт
        </button>
      </div>
      {cooldownLeft > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          Следующий вызов через {cooldownLeft} сек
        </p>
      )}
      {isPro && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <VoiceTranslatorPro venueId={venueId} />
        </div>
      )}
    </div>
  );
}
