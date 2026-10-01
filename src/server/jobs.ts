import type { Core } from "../core/index.js";
import { RATES_CACHE_MINUTES } from "../core/policy.js";

/**
 * Background work, outside any tool call:
 * - the ledger ticker (checked every second; each status lasts TICKER_MS)
 * - a rates refresh at start-up and every 15 minutes, so tool calls almost always hit a warm cache
 * - alert evaluation every TICKER_MS
 * Returns a function that stops all three.
 */
export function startJobs(core: Core, tickMs: number): () => void {
  const stopTicker = core.ledger.startTicker(1000);

  void core.rates.refresh();
  const ratesTimer = setInterval(() => void core.rates.refresh(), RATES_CACHE_MINUTES * 60_000);

  let evaluating = false;
  const alertTimer = setInterval(() => {
    if (evaluating) return;
    evaluating = true;
    core.alerts
      .evaluate()
      .then((fired) => {
        for (const a of fired) console.log(`alerts: fired ${a.alert_id}: ${a.notification}`);
      })
      .catch((err: unknown) =>
        console.warn(`alerts: evaluate failed (${err instanceof Error ? err.message : err})`),
      )
      .finally(() => {
        evaluating = false;
      });
  }, tickMs);

  ratesTimer.unref();
  alertTimer.unref();
  return () => {
    stopTicker();
    clearInterval(ratesTimer);
    clearInterval(alertTimer);
  };
}
