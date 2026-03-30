/**
 * «Настенные часы» заведения: минуты от полуночи и метка минуты в календаре зоны (IANA).
 * Всегда передавайте реальный UTC-инстант в `now` (например `new Date()` на сервере);
 * интерпретация HH:mm — строго в `timeZone`.
 */

export function wallClockMinutesSinceMidnight(now: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === "hour") h = Number(p.value);
    if (p.type === "minute") m = Number(p.value);
  }
  return h * 60 + m;
}

/** Ключ для дедупликации: локальная дата+час:минута в зоне заведения. */
export function venueLocalCalendarMinuteKey(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const g = (t: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}
