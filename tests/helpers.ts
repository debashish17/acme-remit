import { vi } from "vitest";
import { openDb, type Db } from "../src/db/connection.js";
import { migrate } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";
import type { Logger } from "../src/core/types.js";

/** Mid-October: after every seeded transfer this month, monthly used 16,500 AED, daily used 0. */
export const NOW = new Date("2026-10-15T08:00:00Z");

export function seededDb(now: Date = NOW): Db {
  const db = openDb(":memory:");
  migrate(db);
  seed(db, now);
  return db;
}

/** A clock tests can move. */
export function testClock(start: Date = NOW) {
  let t = start.getTime();
  const clock = () => new Date(t);
  clock.advance = (ms: number) => {
    t += ms;
  };
  clock.set = (d: Date) => {
    t = d.getTime();
  };
  return clock;
}

export const silentLogger: Logger & { warnings: string[] } = Object.assign(
  { info: () => undefined, warn: (m: string) => silentLogger.warnings.push(m) },
  { warnings: [] as string[] },
);

/** Frankfurter /v1/{start}.. response: USD base, INR and GBP per day. */
export function frankfurterSeries(days: Record<string, { INR: number; GBP: number }>): Response {
  return new Response(JSON.stringify({ amount: 1, base: "USD", rates: days }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** USD/INR 96.33 on 2026-10-14 -> AED/INR 26.2301 mid. */
export function liveFetch() {
  return vi.fn(async () =>
    frankfurterSeries({
      "2026-10-13": { INR: 95.9, GBP: 0.755 },
      "2026-10-14": { INR: 96.33, GBP: 0.75565 },
    }),
  );
}

export function failingFetch() {
  return vi.fn(async () => {
    throw new TypeError("fetch failed");
  });
}
