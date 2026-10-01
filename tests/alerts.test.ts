import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCore, type Core } from "../src/core/index.js";
import { USER_ID } from "../src/db/seed.js";
import { frankfurterSeries, liveFetch, seededDb, silentLogger, testClock } from "./helpers.js";

let clock: ReturnType<typeof testClock>;
let fetchFn: ReturnType<typeof liveFetch>;
let core: Core;

beforeEach(() => {
  clock = testClock();
  fetchFn = liveFetch(); // customer rate 25.9940
  core = createCore({
    db: seededDb(),
    ratesUrl: "https://rates.test/v1",
    fetch: fetchFn,
    now: clock,
    logger: silentLogger,
  });
});
afterEach(() => core.db.close());

/** Moves the live rate: USD/INR 97.5 -> AED/INR mid 26.5487 -> customer 26.3097. */
async function rateRisesTo97_5() {
  clock.advance(16 * 60_000);
  fetchFn.mockImplementation(async () =>
    frankfurterSeries({ "2026-10-15": { INR: 97.5, GBP: 0.76 } }),
  );
  await core.rates.refresh();
}

describe("AlertService.set", () => {
  it("creates al_01 with the SPEC message shape and today's rate", async () => {
    const r = await core.alerts.set(USER_ID, "AED/INR", 26.3, "above");
    expect(r).toEqual({
      alert_id: "al_01",
      pair: "AED/INR",
      target: 26.3,
      direction: "above",
      channel: "push and email",
      created_at: "2026-10-15T08:00:00.000Z",
      fired_at: null,
      current_rate: 25.994,
      already_met: false,
      message: "I'll let you know when a dirham buys more than 26.30 rupees. Today it buys 25.99.",
    });
  });

  it("says so when the target is already met", async () => {
    const r = await core.alerts.set(USER_ID, "AED/INR", 26, "below");
    expect(r).toMatchObject({ already_met: true });
    if ("message" in r) expect(r.message).toMatch(/It already does today, at 25\.99/);
  });

  it("is idempotent for the same open alert, and numbers new ones in order", async () => {
    const a = await core.alerts.set(USER_ID, "AED/INR", 26.3, "above");
    const b = await core.alerts.set(USER_ID, "AED/INR", 26.3, "above");
    const c = await core.alerts.set(USER_ID, "AED/INR", 25.5, "below");
    expect([a, b, c].map((x) => ("alert_id" in x ? x.alert_id : x))).toEqual([
      "al_01",
      "al_01",
      "al_02",
    ]);
    expect(core.alerts.list(USER_ID)).toHaveLength(2);
  });

  it.each([0, -3, 1000, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses target %s as ALERT_TARGET_INVALID",
    async (target) => {
      expect(await core.alerts.set(USER_ID, "AED/INR", target, "above")).toMatchObject({
        refused: { code: "ALERT_TARGET_INVALID" },
      });
    },
  );
});

describe("AlertService.evaluate", () => {
  it("fires an 'above' alert once the customer rate reaches the target, exactly once", async () => {
    await core.alerts.set(USER_ID, "AED/INR", 26.3, "above");
    expect(await core.alerts.evaluate()).toEqual([]);

    await rateRisesTo97_5();
    const fired = await core.alerts.evaluate();
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      alert_id: "al_01",
      rate: 26.3097,
      fired_at: "2026-10-15T08:16:00.000Z",
      notification: "A dirham now buys 26.31 rupees, above your 26.30 target.",
    });
    expect(await core.alerts.evaluate()).toEqual([]);
    expect(core.alerts.list(USER_ID)[0]?.fired_at).toBe("2026-10-15T08:16:00.000Z");
  });

  it("fires 'below' alerts on the way down and leaves unmet ones pending", async () => {
    await core.alerts.set(USER_ID, "AED/INR", 26, "below"); // met now (25.99)
    await core.alerts.set(USER_ID, "AED/INR", 25, "below"); // not met
    const fired = await core.alerts.evaluate();
    expect(fired.map((f) => f.alert_id)).toEqual(["al_01"]);
    expect(core.alerts.list(USER_ID).map((a) => a.fired_at === null)).toEqual([false, true]);
  });

  it("a fired alert can be set again as a new alert", async () => {
    await core.alerts.set(USER_ID, "AED/INR", 26, "below");
    await core.alerts.evaluate();
    const again = await core.alerts.set(USER_ID, "AED/INR", 26, "below");
    expect("alert_id" in again && again.alert_id).toBe("al_02");
  });

  it("does nothing, and makes no rate call, when no alerts are pending", async () => {
    expect(await core.alerts.evaluate()).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("AlertService dev controls", () => {
  it("fireNext fires the oldest pending alert, flagged simulated, and the feed reports it", async () => {
    await core.alerts.set(USER_ID, "AED/INR", 26.5, "above");
    await core.alerts.set(USER_ID, "AED/INR", 27, "above");
    const before = clock().toISOString();
    clock.advance(1000);

    const fired = core.alerts.fireNext(USER_ID);
    expect(fired).toMatchObject({
      alert_id: "al_01",
      simulated: true,
      notification: "A dirham now buys 26.50 rupees, your target.",
    });
    expect(core.alerts.firedSince(USER_ID, before).map((a) => a.alert_id)).toEqual(["al_01"]);
    expect(core.alerts.firedSince(USER_ID, clock().toISOString())).toEqual([]);
    expect(core.alerts.fireNext(USER_ID)?.alert_id).toBe("al_02");
    expect(core.alerts.fireNext(USER_ID)).toBeUndefined();
  });
});
