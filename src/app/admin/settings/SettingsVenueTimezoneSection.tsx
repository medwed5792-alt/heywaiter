"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import toast from "react-hot-toast";
import { DEFAULT_VENUE_ID as venueId } from "@/lib/standards/venue-default";
import { DEFAULT_VENUE_TIMEZONE } from "@/lib/venue-timezone";

export function SettingsVenueTimezoneSection() {
  const [timezone, setTimezone] = useState<string>(DEFAULT_VENUE_TIMEZONE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "venues", venueId));
        if (!snap.exists() || cancelled) return;
        const data = snap.data() as Record<string, unknown>;
        const tz = typeof data.timezone === "string" && data.timezone.trim() ? data.timezone.trim() : "";
        if (!cancelled) setTimezone(tz || DEFAULT_VENUE_TIMEZONE);
      } catch {
        // оставляем дефолт
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const ref = doc(db, "venues", venueId);
      const trimmed = timezone.trim();
      await setDoc(
        ref,
        {
          timezone: trimmed || DEFAULT_VENUE_TIMEZONE,
          updatedAt: new Date(),
        },
        { merge: true }
      );
      toast.success("Часовой пояс сохранён");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600">
        Расписание групп меню и приём предзаказов считаются по этому поясу (IANA), а не по часам устройства гостя.
        По умолчанию — <span className="font-mono">{DEFAULT_VENUE_TIMEZONE}</span>.
      </p>
      <label className="block max-w-md">
        <span className="block text-xs text-gray-600">IANA timezone</span>
        <input
          type="text"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          disabled={loading || saving}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm disabled:bg-gray-100"
          placeholder={DEFAULT_VENUE_TIMEZONE}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={loading || saving}
        className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        Сохранить часовой пояс
      </button>
    </div>
  );
}
