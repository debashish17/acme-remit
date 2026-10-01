/**
 * Integer money maths. Rates are carried as numbers with up to 4 decimals but every calculation
 * converts them to integer ten-thousandths first, so no float ever touches an amount.
 */

export const RATE_SCALE = 10_000;

/** A rate as an integer number of ten-thousandths (23.2092 -> 232092). */
export function rateToUnits(rate: number): number {
  return Math.round(rate * RATE_SCALE);
}

export function unitsToRate(units: number): number {
  return units / RATE_SCALE;
}

/** Customer (board) rate: mid less the FX margin, floored to 4 decimals. */
export function applyMargin(mid: number, marginBp: number): number {
  return unitsToRate(Math.floor((rateToUnits(mid) * (10_000 - marginBp)) / 10_000));
}

/** Guaranteed receive amount in paise: (send - fee) x rate, rounded down to the paisa. */
export function receiveMinor(sendMinor: number, feeMinor: number, rate: number): number {
  const converted = sendMinor - feeMinor;
  if (converted <= 0) return 0;
  return Math.floor((converted * rateToUnits(rate)) / RATE_SCALE);
}

/** Largest send amount (fils) whose receive amount stays within `maxReceiveMinor` paise. */
export function maxSendForReceive(maxReceiveMinor: number, feeMinor: number, rate: number): number {
  return Math.floor((maxReceiveMinor * RATE_SCALE) / rateToUnits(rate)) + feeMinor;
}

// ---- spoken formatting (used only for sentences the model reads aloud) ----

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const groupedCents = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function major(minor: number): string {
  return minor % 100 === 0 ? grouped.format(minor / 100) : groupedCents.format(minor / 100);
}

/** 200000 -> "2,000 dirhams"; 150 -> "1.50 dirhams". */
export function sayAed(minor: number): string {
  return `${major(minor)} ${minor === 100 ? "dirham" : "dirhams"}`;
}

/** Whole rupees, rounded down so a spoken guarantee is never overstated. */
export function sayInr(minor: number): string {
  const rupees = Math.floor(minor / 100);
  return `${grouped.format(rupees)} ${rupees === 1 ? "rupee" : "rupees"}`;
}

/** "2,000" (no unit), for phrases like "the 2,000 dirham transfer". */
export function aedNumber(minor: number): string {
  return major(minor);
}

export function sayRate(rate: number): string {
  return rate.toFixed(2);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-11-01" -> "1 November". */
export function sayDate(isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}
