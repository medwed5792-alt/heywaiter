"use client";

const STAFF_VENUE_SESSION_KEY = "heywaiter_staff_venue_id";

export function getStaffVenueFromSession(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return sessionStorage.getItem(STAFF_VENUE_SESSION_KEY);
  } catch {
    return null;
  }
}

export function setStaffVenueInSession(venueId: string): void {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(STAFF_VENUE_SESSION_KEY, venueId);
    }
  } catch (_) {}
}

export interface VenueOption {
  venueId: string;
  name: string;
}

interface StaffVenuePickerProps {
  venues: VenueOption[];
  onSelect: (venueId: string) => void;
}

/**
 * Экран выбора заведения: «Где вы сегодня работаете?» — для сотрудников с несколькими активными привязками.
 */
export function StaffVenuePicker({ venues, onSelect }: StaffVenuePickerProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-center text-lg font-semibold text-slate-800">
          Где вы сегодня работаете?
        </h1>
        <ul className="mt-4 space-y-2">
          {venues.map((v) => (
            <li key={v.venueId}>
              <button
                type="button"
                onClick={() => onSelect(v.venueId)}
                className="w-full rounded-xl border border-slate-200 bg-white py-3 px-4 text-left text-sm font-medium text-slate-800 shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50/50"
              >
                {v.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
