import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/db/connection.js";
import { migrate } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";

const NOW = new Date("2026-10-15T08:00:00Z");

let db: Db;
beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});
afterEach(() => db.close());

const count = (table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("migrate", () => {
  it("creates the nine SPEC.md tables and is idempotent", () => {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(tables).toEqual([
      "alerts",
      "beneficiaries",
      "confirmations",
      "quotes",
      "rates_cache",
      "rates_history",
      "transfer_events",
      "transfers",
      "users",
    ]);
    expect(migrate(db)).toEqual([]);
  });
});

describe("seed", () => {
  it("wipes and reloads to identical state", () => {
    const first = seed(db, NOW);
    db.prepare("INSERT INTO alerts (id, user_id) VALUES ('al_x', 'usr_priya')").run();
    const second = seed(db, NOW);
    expect(second).toEqual(first);
    expect(count("alerts")).toBe(0);
    expect(count("users")).toBe(1);
    expect(count("beneficiaries")).toBe(4);
    expect(count("rates_history")).toBe(21);
    expect(count("transfers")).toBe(13);
  });

  it("leaves 16,500 AED used this month, in minor units", () => {
    seed(db, NOW);
    const { used } = db
      .prepare(
        "SELECT SUM(send_amount_minor) AS used FROM transfers WHERE created_at >= '2026-10-01' AND status != 'CANCELLED'",
      )
      .get() as { used: number };
    expect(used).toBe(1_650_000);
  });

  it("prices receive amounts as (send - fee) x rate floored to the paisa", () => {
    seed(db, NOW);
    const row = db
      .prepare(
        "SELECT receive_amount_minor, fee_minor, rate FROM transfers WHERE beneficiary_id = 'ben_01' AND created_at LIKE '2026-10-02%'",
      )
      .get() as { receive_amount_minor: number; fee_minor: number; rate: number };
    expect(row.fee_minor).toBe(1500);
    expect(row.rate).toBe(23.21);
    expect(row.receive_amount_minor).toBe(4_607_185);
    expect(Number.isInteger(row.receive_amount_minor)).toBe(true);
  });

  it("seeds the ON_HOLD transfer with an RFI and no screening reason", () => {
    seed(db, NOW);
    const t = db.prepare("SELECT * FROM transfers WHERE status = 'ON_HOLD'").get() as Record<
      string,
      unknown
    >;
    expect(t.ref).toBe("ACM-240120");
    expect(t.send_amount_minor).toBe(1_300_000);
    expect(t.return_reason).toBeNull();
    const rfi = JSON.parse(t.hold_rfi_json as string) as Record<string, unknown>;
    expect(rfi).toEqual({
      type: "RFI",
      document: "updated Emirates ID",
      how: "upload in the Acme app",
      deadline: "2026-10-17",
    });
    const timeline = db
      .prepare("SELECT status FROM transfer_events WHERE ref = ? ORDER BY at")
      .all(t.ref) as { status: string }[];
    expect(timeline.map((e) => e.status)).toEqual(["FUNDS_RECEIVED", "SCREENING", "ON_HOLD"]);
  });

  it("seeds the RETURNED transfer with a 492 AED refund and the fee kept", () => {
    seed(db, NOW);
    const t = db.prepare("SELECT * FROM transfers WHERE status = 'RETURNED'").get() as Record<
      string,
      unknown
    >;
    expect(t.beneficiary_id).toBe("ben_03");
    expect(t.created_at).toBe("2026-08-15T09:00:00.000Z");
    expect(t.refund_minor).toBe(49_200);
    expect(t.return_reason).toBe("recipient bank reported a name mismatch");
    expect(t.utr).toBeNull();
  });

  it("gives every PAID_OUT transfer a UTR and a four-step timeline", () => {
    seed(db, NOW);
    const paid = db.prepare("SELECT ref, utr FROM transfers WHERE status = 'PAID_OUT'").all() as {
      ref: string;
      utr: string | null;
    }[];
    expect(paid).toHaveLength(11);
    for (const t of paid) {
      expect(t.utr).toMatch(/^(HDFCR5\d{16}|\d{12})$/);
      const n = db
        .prepare("SELECT COUNT(*) AS n FROM transfer_events WHERE ref = ?")
        .get(t.ref) as {
        n: number;
      };
      expect(n.n).toBe(4);
    }
  });
});
