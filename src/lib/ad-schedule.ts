/**
 * Расписание показа баннеров (локальное время в указанной зоне).
 */

export type SuperAdSchedule = {
  /** 0 = воскресенье … 6 = суббота; пусто или отсутствует = все дни */
  daysOfWeek?: number[];
  /** "HH:mm" 24h */
  startTime?: string;
  /** "HH:mm" 24h */
  endTime?: string;
  /** IANA, по умолчанию Europe/Moscow */
  timezone?: string;
};

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function weekdayIndexInTimezone(date: Date, timeZone: string): number {
  const w = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  const idx = WEEKDAY_SHORT.indexOf(w as (typeof WEEKDAY_SHORT)[number]);
  return idx >= 0 ? idx : 0;
}

function parseHHMM(s: string | undefined): number | null {
  if (!s || typeof s !== "string") return null;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function currentMinutesInTimezone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/** true, если сейчас (в зоне расписания) разрешён показ */
export function matchesAdSchedule(schedule: SuperAdSchedule | undefined | null): boolean {
  if (!schedule || typeof schedule !== "object") return true;
  const tz = schedule.timezone?.trim() || "Europe/Moscow";
  const now = new Date();

  const days = schedule.daysOfWeek;
  if (days && days.length > 0) {
    const dow = weekdayIndexInTimezone(now, tz);
    if (!days.includes(dow)) return false;
  }

  const startM = parseHHMM(schedule.startTime);
  const endM = parseHHMM(schedule.endTime);
  if (startM == null && endM == null) return true;
  if (startM == null || endM == null) return true;

  const cur = currentMinutesInTimezone(now, tz);
  if (startM <= endM) {
    return cur >= startM && cur <= endM;
  }
  /* через полночь */
  return cur >= startM || cur <= endM;
}
