import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LimitService } from "../src/core/limits.js";
import { QuoteService, type Quote } from "../src/core/quotes.js";
import { RatesService } from "../src/core/rates.js";
import { isRefusal } from "../src/core/refusal.js";
import type { Refusal } from "../src/core/types.js";
import type { Db } from "../src/db/connection.js";
import { USER_ID } from "../src/db/seed.js";
import { frankfurterSeries, liveFetch, seededDb, silentLogger, testClock } from "./helpers.js";

let db: Db;
let clock: ReturnType<typeof testClock>;
let fetchFn: ReturnType<typeof liveFetch>;
let rates: RatesService;
let quotes: QuoteService;

beforeEach(() => {
  db = seededDb();
  clock = testClock();
  fetchFn = liveFetch(); // USD/INR 96.33 -> AED/INR mid 26.2301 -> customer 25.9940
  rates = new RatesService({
    db,
    baseUrl: "https://rates.test/v1",
    fetch: fetchFn,
    now: clock,
    logger: silentLogger,
  });
  let n = 0;
  quotes = new QuoteService({
    db,
    rates,
    limits: new LimitService(db, clock),
    now: clock,
    newId: () => `q_test${++n}`,
  });
});
afterEach(() => db.close());

const aed = (n: number) => Math.round(n * 100);

function ok(r: Quote | Refusal): Quote {
  if (isRefusal(r)) throw new Error(`unexpected refusal ${r.refused.code}`);
  return r;
}

describe("QuoteService.create", () => {
  it("locked rate equals the rate at quote time even after a cache refresh", async () => {
    const q = ok(await quotes.create(USER_ID, { beneficiaryId: "ben_01", sendMinor: aed(2000) }));
    expect(q.locked_rate).toBe(25.994);

    clock.advance(16 * 60_000);
    fetchFn.mockImplementation(async () =>
      frankfurterSeries({ "2026-10-15": { INR: 97.5, GBP: 0.76 } }),
    );
    await rates.refresh();
    expect((await rates.getCustomerRate("AED", "INR")).rate).not.toBe(25.994);

    const stored = quotes.get(USER_ID, q.quote_id);
    expect(stored?.lockedRate).toBe(25.994);
    expect(stored?.receiveMinor).toBe(q.receive_amount_minor);
  });

  it("fee by payout method: bank 15, UPI 15, cash pickup 20", async () => {
    const bank = ok(await quotes.create(USER_ID, { beneficiaryId: "ben_01", sendMinor: aed(500) }));
    const upi = ok(await quotes.create(USER_ID, { beneficiaryId: "ben_02", sendMinor: aed(500) }));
    const cash = ok(
      await quotes.create(USER_ID, {
        beneficiaryId: "ben_01",
        sendMinor: aed(500),
        payoutMethod: "cash_pickup",
      }),
    );
    expect([bank.payout_method, upi.payout_method, cash.payout_method]).toEqual([
      "bank_deposit",
      "upi",
      "cash_pickup",
    ]);
    expect([bank.fee_minor, upi.fee_minor, cash.fee_minor]).toEqual([1500, 1500, 2000]);
    expect(cash.eta).toBe("within 2 hours");
  });

  it("receive_amount = (send_amount - fee) x rate, rounded down to the paisa", async () => {
    const a = ok(await quotes.create(USER_ID, { beneficiaryId: "ben_01", sendMinor: aed(2000) }));
    expect(a.receive_amount_minor).toBe(5_159_809); // 1,985 x 25.994 = 51,598.09
    const b = ok(
      await quotes.create(USER_ID, { beneficiaryId: "ben_01", sendMinor: aed(1234.56) }),
    );
    expect(b.receive_amount_minor).toBe(3_170_124); // 1,219.56 x 25.994 = 31,701.2426...
    expect(Number.isInteger(b.receive_amount_minor)).toBe(true);
  });

  it("writes an open quote held for 30 minutes, then reads as expired", async () => {
    const q = ok(await quotes.create(USER_ID, { beneficiaryId: "ben_01", sendMinor: aed(2000) }));
    expect(q).toMatchObject({
      quote_id: "q_test1",
      rate_locked_until: "2026-10-15T08:30:00.000Z",
      guaranteed: true,
      receive_currency: "INR",
      funding: "debit card ending 8812",
      purpose: "family_maintenance",
    });
    expect(quotes.get(USER_ID, q.quote_id)?.status).toBe("open");
    clock.advance(30 * 60_000);
    expect(quotes.get(USER_ID, q.quote_id)?.status).toBe("expired");
    expect(quotes.get("usr_other", q.quote_id)).toBeUndefined();
  });

  it("business purpose is refused", async () => {
    const r = await quotes.create(USER_ID, {
      beneficiaryId: "ben_01",
      sendMinor: aed(1000),
      purpose: "business",
    });
    expect(r).toMatchObject({ refused: { code: "PURPOSE_NOT_SUPPORTED", purpose: "business" } });
  });

  it("property purpose is refused with the document resolution", async () => {
    const r = await quotes.create(USER_ID, {
      beneficiaryId: "ben_01",
      sendMinor: aed(1000),
      purpose: "property_purchase",
    });
    expect(r).toEqual({
      refused: {
        code: "PURPOSE_REQUIRES_DOCUMENTS",
        purpose: "property_purchase",
        resolution:
          "Property payments need a sale agreement uploaded in the Acme app before sending.",
      },
    });
  });

  it("a gift to a non-relative warns about Indian gift tax; to a brother it does not", async () => {
    const friend = ok(
      await quotes.create(USER_ID, { beneficiaryId: "ben_03", sendMinor: aed(500) }),
    );
    expect(friend.purpose).toBe("gift"); // ben_03's default purpose
    expect(friend.warnings).toContainEqual(
      expect.objectContaining({ code: "GIFT_TAXABLE_IN_INDIA" }),
    );
    const brother = ok(
      await quotes.create(USER_ID, {
        beneficiaryId: "ben_02",
        sendMinor: aed(500),
        purpose: "gift",
      }),
    );
    expect(brother.warnings.map((w) => w.code)).not.toContain("GIFT_TAXABLE_IN_INDIA");
  });

  it("refuses an unknown recipient and a payout method the recipient cannot take", async () => {
    expect(
      await quotes.create(USER_ID, { beneficiaryId: "ben_99", sendMinor: aed(100) }),
    ).toMatchObject({ refused: { code: "BENEFICIARY_NOT_FOUND" } });
    expect(
      await quotes.create("usr_other", { beneficiaryId: "ben_01", sendMinor: aed(100) }),
    ).toMatchObject({ refused: { code: "BENEFICIARY_NOT_FOUND" } });
    expect(
      await quotes.create(USER_ID, {
        beneficiaryId: "ben_01",
        sendMinor: aed(100),
        payoutMethod: "upi",
      }),
    ).toMatchObject({
      refused: {
        code: "PAYOUT_METHOD_UNAVAILABLE",
        available_methods: ["bank_deposit", "cash_pickup"],
      },
    });
  });

  it("refuses amounts that do not exceed the fee", async () => {
    expect(
      await quotes.create(USER_ID, { beneficiaryId: "ben_01", sendMinor: aed(15) }),
    ).toMatchObject({ refused: { code: "AMOUNT_TOO_SMALL", minimum_exclusive_minor: 1500 } });
    ok(await quotes.create(USER_ID, { beneficiaryId: "ben_01", sendMinor: aed(15.01) }));
  });

  it("passes limit refusals and warnings through: the SPEC demo beats", async () => {
    // 16,500 of 20,000 used this month
    const first = ok(
      await quotes.create(USER_ID, { beneficiaryId: "ben_01", sendMinor: aed(2000) }),
    );
    expect(first.warnings).toEqual([
      {
        code: "NEAR_MONTHLY_LIMIT",
        remaining_after_minor: 150_000,
        currency: "AED",
        resets_on: "2026-11-01",
      },
    ]);
    const tooMuch = await quotes.create(USER_ID, { beneficiaryId: "ben_01", sendMinor: aed(4000) });
    expect(tooMuch).toMatchObject({
      refused: { code: "MONTHLY_LIMIT", used_minor: 1_650_000, resets_on: "2026-11-01" },
    });
  });

  it("quotes do not reserve limit: two 3,000 quotes both price with 3,500 left", async () => {
    ok(await quotes.create(USER_ID, { beneficiaryId: "ben_01", sendMinor: aed(3000) }));
    ok(await quotes.create(USER_ID, { beneficiaryId: "ben_01", sendMinor: aed(3000) }));
  });
});

describe("QuoteService.compare", () => {
  it("prices every payout method against mid and a typical bank", async () => {
    const r = await quotes.compare(aed(2000));
    if (isRefusal(r)) throw new Error("unexpected refusal");
    expect(r.mid_rate).toBe(26.2301);
    expect(r.customer_rate).toBe(25.994);
    expect(
      r.payout_methods.map((m) => [m.method, m.rail, m.fee_minor, m.receive_amount_minor]),
    ).toEqual([
      ["bank_deposit", "IMPS", 1500, 5_159_809],
      ["upi", "UPI", 1500, 5_159_809],
      ["cash_pickup", "MTSS partner", 2000, 5_146_812],
    ]);
    expect(r.benchmark).toEqual({
      name: "typical bank",
      rate: 25.5743, // mid less 2.5%
      fee_minor: 2500,
      receive_amount_minor: 5_050_924,
      illustrative: true,
    });
  });

  it("marks cash pickup unavailable over the 50,000 rupee cash cap, with the most sendable", async () => {
    const big = await quotes.compare(aed(2000));
    if (isRefusal(big)) throw new Error("unexpected refusal");
    const cash = big.payout_methods.find((m) => m.method === "cash_pickup");
    expect(cash).toMatchObject({
      available: false,
      caps: {
        per_transaction_aed_minor: 918_000,
        per_recipient_per_year: 30,
        max_cash_inr_minor: 5_000_000,
      },
    });
    expect(cash?.note).toBe(
      "Over the cash cap of 50,000 rupees; up to 1,943.52 dirhams can be sent for cash pickup.",
    );

    const small = await quotes.compare(aed(1000));
    if (isRefusal(small)) throw new Error("unexpected refusal");
    expect(small.payout_methods.every((m) => m.available)).toBe(true);
  });

  it("refuses an amount that does not cover the fee", async () => {
    expect(await quotes.compare(aed(10))).toMatchObject({ refused: { code: "AMOUNT_TOO_SMALL" } });
  });
});
