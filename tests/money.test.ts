import { describe, expect, it } from "vitest";
import {
  applyMargin,
  maxSendForReceive,
  receiveMinor,
  sayAed,
  sayDate,
  sayInr,
  sayRate,
} from "../src/core/money.js";
import {
  dubaiDate,
  monthlyResetDate,
  startOfDubaiDay,
  startOfDubaiMonth,
} from "../src/core/time.js";

describe("money", () => {
  it("reproduces the SPEC example: mid 23.42, 0.9% margin, 2,000 AED less 15 fee -> 46,070 rupees", () => {
    const rate = applyMargin(23.42, 90);
    expect(rate).toBe(23.2092);
    expect(sayRate(rate)).toBe("23.21");
    const receive = receiveMinor(200_000, 1500, rate);
    expect(receive).toBe(4_607_026); // 1,985 x 23.2092 = 46,070.262 -> floored to the paisa
    expect(sayInr(receive)).toBe("46,070 rupees");
    expect(receiveMinor(200_000, 2000, rate)).toBe(4_595_421); // cash pickup: 45,954 rupees
  });

  it("floors to the paisa and never goes negative", () => {
    expect(receiveMinor(101, 0, 23.2092)).toBe(2344); // 1.01 x 23.2092 = 23.441...
    expect(receiveMinor(1000, 1500, 23.2092)).toBe(0);
  });

  it("finds the largest send amount under a receive cap", () => {
    const rate = 23.2092;
    const send = maxSendForReceive(5_000_000, 2000, rate);
    expect(receiveMinor(send, 2000, rate)).toBeLessThanOrEqual(5_000_000);
    expect(receiveMinor(send + 1, 2000, rate)).toBeGreaterThan(5_000_000);
  });

  it("speaks amounts and dates", () => {
    expect(sayAed(200_000)).toBe("2,000 dirhams");
    expect(sayAed(150)).toBe("1.50 dirhams");
    expect(sayAed(100)).toBe("1 dirham");
    expect(sayInr(4_607_099)).toBe("46,070 rupees");
    expect(sayDate("2026-11-01")).toBe("1 November");
  });
});

describe("Dubai time", () => {
  it("uses UTC+4 for day and month boundaries", () => {
    // 21:30 UTC on 31 Oct is 01:30 on 1 Nov in Dubai.
    const late = new Date("2026-10-31T21:30:00Z");
    expect(dubaiDate(late)).toBe("2026-11-01");
    expect(startOfDubaiDay(late).toISOString()).toBe("2026-10-31T20:00:00.000Z");
    expect(startOfDubaiMonth(late).toISOString()).toBe("2026-10-31T20:00:00.000Z");
    expect(monthlyResetDate(new Date("2026-10-15T08:00:00Z"))).toBe("2026-11-01");
    expect(monthlyResetDate(new Date("2026-12-20T08:00:00Z"))).toBe("2027-01-01");
  });
});
