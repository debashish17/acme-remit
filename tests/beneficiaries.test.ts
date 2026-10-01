import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BeneficiaryService, NOT_FOUND_HINT } from "../src/core/beneficiaries.js";
import type { Db } from "../src/db/connection.js";
import { USER_ID } from "../src/db/seed.js";
import { seededDb } from "./helpers.js";

let db: Db;
let svc: BeneficiaryService;
beforeEach(() => {
  db = seededDb();
  svc = new BeneficiaryService(db);
});
afterEach(() => db.close());

const matchId = (q: string) => {
  const r = svc.resolve(USER_ID, q);
  return "match" in r ? r.match.id : r;
};

describe("BeneficiaryService.resolve", () => {
  it.each(["Mum", "mother", "amma", "my mum", "Mom", "Sunita", "Mum's"])(
    "%s resolves to ben_01",
    (q) => expect(matchId(q)).toBe("ben_01"),
  );

  it.each(["my account", "My NRE account", "savings", "myself"])("%s resolves to ben_04", (q) =>
    expect(matchId(q)).toBe("ben_04"),
  );

  it.each([
    ["my brother", "ben_02"],
    ["Rahul Nair", "ben_02"],
    ["Rahul Menon", "ben_03"],
    ["college Rahul", "ben_03"],
  ])("%s resolves to %s", (q, id) => expect(matchId(q)).toBe(id));

  it('"Rahul" is ambiguous with two candidates', () => {
    const r = svc.resolve(USER_ID, "Rahul");
    expect(r).toMatchObject({ ambiguous: true });
    if (!("candidates" in r)) throw new Error("expected candidates");
    expect(r.candidates.map((c) => [c.id, c.relationship])).toEqual([
      ["ben_02", "brother"],
      ["ben_03", "friend"],
    ]);
  });

  it.each(["Deepak", "", "   ", "?!"])("unknown name %j returns not_found with the app hint", (q) =>
    expect(svc.resolve(USER_ID, q)).toEqual({ notFound: true, hint: NOT_FOUND_HINT }),
  );

  it("only searches the caller's own recipients", () => {
    expect(svc.resolve("usr_someone_else", "Mum")).toEqual({
      notFound: true,
      hint: NOT_FOUND_HINT,
    });
  });

  it("never creates a record", () => {
    const count = () =>
      (db.prepare("SELECT COUNT(*) AS n FROM beneficiaries").get() as { n: number }).n;
    const before = count();
    for (const q of ["Deepak", "my new friend", "Rahul", "Mum"]) svc.resolve(USER_ID, q);
    expect(count()).toBe(before);
  });
});

describe("BeneficiaryService.list", () => {
  it("lists the four seeded recipients with when they last received money", () => {
    const list = svc.list(USER_ID);
    expect(list.map((r) => r.id)).toEqual(["ben_01", "ben_02", "ben_03", "ben_04"]);
    expect(list[0]?.lastSent).toEqual({
      date: "2026-10-02",
      send_amount_minor: 200_000,
      currency: "AED",
    });
    // ben_03's only transfer was RETURNED; ben_04's is ON_HOLD: neither received money
    expect(list[2]?.lastSent).toBeNull();
    expect(list[3]?.lastSent).toBeNull();
  });
});
