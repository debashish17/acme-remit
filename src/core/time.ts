/**
 * Day and month boundaries for limits follow the customer's clock in Dubai. The UAE is UTC+4 with
 * no daylight saving, so a fixed offset is exact.
 */
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

const shift = (d: Date) => new Date(d.getTime() + DUBAI_OFFSET_MS);
const unshift = (ms: number) => new Date(ms - DUBAI_OFFSET_MS);

export function startOfDubaiDay(now: Date): Date {
  const d = shift(now);
  return unshift(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function startOfDubaiMonth(now: Date, monthOffset = 0): Date {
  const d = shift(now);
  return unshift(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthOffset, 1));
}

export function startOfDubaiYear(now: Date): Date {
  return unshift(Date.UTC(shift(now).getUTCFullYear(), 0, 1));
}

/** The calendar date (YYYY-MM-DD, Dubai) on which the monthly limit resets. */
export function monthlyResetDate(now: Date): string {
  return dubaiDate(startOfDubaiMonth(now, 1));
}

/** YYYY-MM-DD in Dubai time. */
export function dubaiDate(d: Date): string {
  return shift(d).toISOString().slice(0, 10);
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}
