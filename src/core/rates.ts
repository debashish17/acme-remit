import { z } from "zod";
import type { Db } from "../db/connection.js";
import { applyMargin } from "./money.js";
import { AED_PER_USD, FX_MARGIN_BP, RATES_CACHE_MINUTES } from "./policy.js";
import { consoleLogger, type Clock, type Logger } from "./types.js";

/**
 * RatesService (SPEC "Core module interface"). The only outbound call in the system.
 *
 * ECB, and so Frankfurter, publishes no AED. One request fetches USD->INR and USD->GBP for the last
 * two weeks; AED/INR is USD/INR divided by the CBUAE peg and GBP/INR is the cross. The latest day
 * goes to rates_cache, every day to rates_history (the offline fallback).
 *
 * Caching is stale-while-revalidate: under 15 minutes old the cache is served as is; up to 24 hours
 * old it is served immediately while a background refresh runs. Only a cold start waits for the
 * network, with a timeout, and any failure falls back to the newest rates_history row.
 */

export const SUPPORTED_PAIRS = ["AED/INR", "USD/INR", "GBP/INR"] as const;
export type Pair = (typeof SUPPORTED_PAIRS)[number];

export interface MidRate {
  rate: number;
  asOf: string;
  source: "live" | "fallback";
}

export interface RateSnapshot {
  corridor: string;
  pair: Pair;
  customer_rate: number;
  mid_rate: number;
  fx_margin_pct: number;
  week_high: number;
  week_low: number;
  trend: string;
  as_of: string;
  source: string;
}

export interface RatesDeps {
  db: Db;
  baseUrl: string;
  fetch?: typeof fetch;
  now?: Clock;
  logger?: Logger;
  /** Cold-start fetch timeout. */
  timeoutMs?: number;
}

const STALE_LIMIT_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 60_000;

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** AED/INR mid from USD/INR at the peg. */
export function deriveAedInr(usdInr: number): number {
  return round4(usdInr / AED_PER_USD);
}

const SeriesSchema = z.object({
  base: z.literal("USD"),
  rates: z.record(z.string(), z.object({ INR: z.number().positive(), GBP: z.number().positive() })),
});

export function toPair(from: string, to: string): Pair {
  const pair = `${from}/${to}`;
  if (!(SUPPORTED_PAIRS as readonly string[]).includes(pair)) {
    throw new Error(`Unsupported pair ${pair}`);
  }
  return pair as Pair;
}

export class RatesService {
  private readonly db: Db;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: Clock;
  private readonly logger: Logger;
  private readonly timeoutMs: number;
  private inflight: Promise<boolean> | null = null;
  private lastFailureAt = 0;

  constructor(deps: RatesDeps) {
    this.db = deps.db;
    this.baseUrl = deps.baseUrl.replace(/\/+$/, "");
    this.fetchFn = deps.fetch ?? fetch;
    this.now = deps.now ?? (() => new Date());
    this.logger = deps.logger ?? consoleLogger;
    this.timeoutMs = deps.timeoutMs ?? 1500;
  }

  async getMid(from: string, to: string): Promise<MidRate> {
    const pair = toPair(from, to);
    const cached = this.readCache(pair);
    const age = cached ? this.now().getTime() - Date.parse(cached.fetched_at) : Infinity;

    if (cached && age < RATES_CACHE_MINUTES * 60_000) return this.live(cached);
    if (cached && age < STALE_LIMIT_MS) {
      void this.refresh();
      return this.live(cached);
    }
    if (await this.refresh()) {
      const fresh = this.readCache(pair);
      if (fresh) return this.live(fresh);
    }
    return this.fallback(pair);
  }

  async getCustomerRate(from: string, to: string): Promise<{ rate: number; fxMarginPct: number }> {
    const pair = toPair(from, to);
    const { rate } = await this.getMid(from, to);
    const marginBp = FX_MARGIN_BP[pair] ?? 0;
    return { rate: applyMargin(rate, marginBp), fxMarginPct: marginBp / 100 };
  }

  async getWeekRange(
    from: string,
    to: string,
  ): Promise<{ high: number; low: number; changePct: number }> {
    const pair = toPair(from, to);
    await this.getMid(from, to); // make sure history includes the latest fetch
    const rows = this.db
      .prepare("SELECT mid FROM rates_history WHERE pair = ? ORDER BY day DESC LIMIT 7")
      .all(pair) as { mid: number }[];
    if (rows.length === 0) throw new Error(`No rate history for ${pair}`);
    const mids = rows.map((r) => r.mid);
    const latest = mids[0] ?? 0;
    const oldest = mids[mids.length - 1] ?? latest;
    return {
      high: Math.max(...mids),
      low: Math.min(...mids),
      changePct: Math.round(((latest - oldest) / oldest) * 1000) / 10,
    };
  }

  /** Everything get_rate returns, from one call. */
  async snapshot(from: string, to: string): Promise<RateSnapshot> {
    const pair = toPair(from, to);
    const mid = await this.getMid(from, to);
    const customer = await this.getCustomerRate(from, to);
    const week = await this.getWeekRange(from, to);
    return {
      corridor: "AE-IN",
      pair,
      customer_rate: customer.rate,
      mid_rate: mid.rate,
      fx_margin_pct: customer.fxMarginPct,
      week_high: week.high,
      week_low: week.low,
      trend: describeTrend(week.changePct),
      as_of: mid.asOf,
      source:
        mid.source === "live"
          ? "ECB via Frankfurter (USD/INR, AED at the 3.6725 peg), cached"
          : "ECB reference history, offline fallback",
    };
  }

  /**
   * Fetches the last two weeks and updates cache and history. Concurrent callers share one
   * request; after a failure, retries wait a minute so an outage cannot slow every call.
   * Background callers pass a generous timeout; a tool call on a cold cache uses the short default.
   */
  refresh(timeoutMs: number = this.timeoutMs): Promise<boolean> {
    if (this.inflight) return this.inflight;
    if (this.now().getTime() - this.lastFailureAt < RETRY_AFTER_FAILURE_MS) {
      return Promise.resolve(false);
    }
    this.inflight = this.fetchSeries(timeoutMs)
      .then((ok) => {
        if (!ok) this.lastFailureAt = this.now().getTime();
        return ok;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async fetchSeries(timeoutMs: number): Promise<boolean> {
    const start = new Date(this.now().getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
    const url = `${this.baseUrl}/${start}..?from=USD&to=INR,GBP`;
    try {
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const series = SeriesSchema.parse(await res.json());
      const days = Object.keys(series.rates).sort();
      const latestDay = days[days.length - 1];
      if (!latestDay) throw new Error("empty series");

      const fetchedAt = this.now().toISOString();
      const upsertHistory = this.db.prepare(
        "INSERT OR REPLACE INTO rates_history (pair, day, mid) VALUES (?, ?, ?)",
      );
      const upsertCache = this.db.prepare(
        "INSERT OR REPLACE INTO rates_cache (pair, mid, fetched_at, source) VALUES (?, ?, ?, 'live')",
      );
      this.db.transaction(() => {
        for (const day of days) {
          for (const [pair, mid] of pairsFor(series.rates[day])) upsertHistory.run(pair, day, mid);
        }
        for (const [pair, mid] of pairsFor(series.rates[latestDay])) {
          upsertCache.run(pair, mid, fetchedAt);
        }
      })();
      return true;
    } catch (err) {
      this.logger.warn(
        `rates: fetch failed, using cache or fallback (${err instanceof Error ? err.message : String(err)})`,
      );
      return false;
    }
  }

  private readCache(pair: Pair): { mid: number; fetched_at: string } | undefined {
    return this.db.prepare("SELECT mid, fetched_at FROM rates_cache WHERE pair = ?").get(pair) as
      { mid: number; fetched_at: string } | undefined;
  }

  private live(row: { mid: number; fetched_at: string }): MidRate {
    return { rate: row.mid, asOf: row.fetched_at, source: "live" };
  }

  private fallback(pair: Pair): MidRate {
    const row = this.db
      .prepare("SELECT mid, day FROM rates_history WHERE pair = ? ORDER BY day DESC LIMIT 1")
      .get(pair) as { mid: number; day: string } | undefined;
    if (!row) throw new Error(`No live or fallback rate for ${pair}`);
    return { rate: row.mid, asOf: `${row.day}T00:00:00.000Z`, source: "fallback" };
  }
}

function pairsFor(day: { INR: number; GBP: number } | undefined): [Pair, number][] {
  if (!day) return [];
  return [
    ["AED/INR", deriveAedInr(day.INR)],
    ["USD/INR", round4(day.INR)],
    ["GBP/INR", round4(day.INR / day.GBP)],
  ];
}

/** AED/INR going up means each dirham buys more rupees: the rupee weakened. */
export function describeTrend(changePct: number): string {
  if (Math.abs(changePct) < 0.1) return "rupee steady this week";
  const pct = Math.abs(changePct).toFixed(1);
  return changePct > 0
    ? `rupee weakened ${pct}% this week`
    : `rupee strengthened ${pct}% this week`;
}
