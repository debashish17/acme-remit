import { randomInt } from "node:crypto";
import type { PayoutMethod } from "./types.js";

/**
 * Simulated payout references. Bank (IMPS) UTRs carry the bank's IFSC prefix, a marker and the
 * date; UPI references are 12-digit RRNs; cash pickups get a partner control number.
 */

const BANK_CODES: Record<string, string> = {
  "HDFC Bank": "HDFC",
  SBI: "SBIN",
  "ICICI Bank": "ICIC",
};

export function randomDigits(n: number): string {
  return Array.from({ length: n }, () => randomInt(10)).join("");
}

export function makeUtr(
  method: PayoutMethod,
  bankName: string | null,
  paidOut: Date,
  digits: string = randomDigits(8),
): string {
  const ymd = paidOut.toISOString().slice(0, 10).replaceAll("-", "");
  if (method === "upi") return `${ymd.slice(2)}${digits.slice(-6).padStart(6, "0")}`;
  if (method === "cash_pickup") return `MTSS${ymd.slice(2)}${digits.padStart(8, "0")}`;
  return `${BANK_CODES[bankName ?? ""] ?? "ACMB"}R5${ymd}${digits.padStart(8, "0")}`;
}
