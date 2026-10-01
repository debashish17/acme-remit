import { pathToFileURL } from "node:url";
import { openDb, type Db } from "./connection.js";
import { migrate } from "./migrate.js";

/**
 * Demo seed from docs/SPEC.md "Data model and seed data". Wipes every table and reloads,
 * so each demo take starts identical. Dates are anchored to the month of `now` (UTC):
 * "this month" in the spec is the current month, "Jul/Aug/Sep" are the three months before it.
 * All amounts are integer minor units (fils, paise).
 */

export const USER_ID = "usr_priya";

const TABLES = [
  "users",
  "beneficiaries",
  "rates_cache",
  "rates_history",
  "quotes",
  "confirmations",
  "transfers",
  "transfer_events",
  "alerts",
] as const;

const FEE_MINOR = { bank_deposit: 1500, upi: 1500, cash_pickup: 2000 } as const;
type PayoutMethod = keyof typeof FEE_MINOR;

interface SeedBeneficiary {
  id: string;
  nickname: string;
  full_name: string;
  relationship: string;
  payout_method: PayoutMethod;
  bank_name: string | null;
  ifsc: string | null;
  account_last4: string | null;
  account_type: string | null;
  upi_id: string | null;
  city: string;
  state: string;
  default_purpose: string;
  aliases: string[];
}

const BENEFICIARIES: SeedBeneficiary[] = [
  {
    id: "ben_01",
    nickname: "Mum",
    full_name: "Sunita Nair",
    relationship: "mother",
    payout_method: "bank_deposit",
    bank_name: "HDFC Bank",
    ifsc: "HDFC0001234",
    account_last4: "4421",
    account_type: "savings",
    upi_id: null,
    city: "Chandigarh",
    state: "Punjab",
    default_purpose: "family_maintenance",
    aliases: ["mum", "mom", "mother", "amma", "sunita"],
  },
  {
    id: "ben_02",
    nickname: "Rahul",
    full_name: "Rahul Nair",
    relationship: "brother",
    payout_method: "upi",
    bank_name: null,
    ifsc: null,
    account_last4: null,
    account_type: null,
    upi_id: "rahul.nair@okhdfc",
    city: "Pune",
    state: "Maharashtra",
    default_purpose: "family_maintenance",
    aliases: ["rahul", "brother", "bhai"],
  },
  {
    id: "ben_03",
    nickname: "Rahul (college)",
    full_name: "Rahul Menon",
    relationship: "friend",
    payout_method: "bank_deposit",
    bank_name: "ICICI Bank",
    ifsc: null,
    account_last4: "3302",
    account_type: null,
    upi_id: null,
    city: "Kochi",
    state: "Kerala",
    default_purpose: "gift",
    aliases: ["rahul menon", "college rahul"],
  },
  {
    id: "ben_04",
    nickname: "My NRE account",
    full_name: "Priya Nair",
    relationship: "self",
    payout_method: "bank_deposit",
    bank_name: "SBI",
    ifsc: null,
    account_last4: "0917",
    account_type: "NRE",
    upi_id: null,
    city: "Chandigarh",
    state: "Chandigarh",
    default_purpose: "savings_own_account",
    aliases: ["my account", "nre", "savings", "myself"],
  },
];

// PLACEHOLDER mid rates, last 7 days ending on the seed day. To be replaced with values pulled
// once from Frankfurter in Phase 2 (see SPEC.md "Rates history"). Shape matches the get_rate
// example: high 23.55, low 23.10, latest 23.42, +0.6% over the week.
const AED_INR_7D = [23.28, 23.1, 23.19, 23.35, 23.55, 23.47, 23.42];
const AED_PER_USD = 3.6725; // AED is pegged to USD
const USD_PER_GBP = 1.345; // placeholder cross

// PLACEHOLDER customer (board) rates for past transfers, keyed by month offset from now.
const BOARD_RATE_BY_MONTH: Record<number, number> = {
  [-7]: 22.95,
  [-6]: 23.02,
  [-5]: 22.88,
  [-4]: 23.1,
  [-3]: 23.05,
  [-2]: 23.12,
  [-1]: 23.18,
  [0]: 23.21,
};

type SeedStatus = "PAID_OUT" | "RETURNED" | "ON_HOLD";

interface SeedTransfer {
  monthOffset: number;
  day: number;
  beneficiaryId: string;
  sendAed: number;
  purpose: string;
  status: SeedStatus;
}

// Chronological; refs are assigned in this order so the ON_HOLD one is ACM-240120 (SPEC example).
const TRANSFERS: SeedTransfer[] = [
  ...[-7, -6, -5, -4, -3].map((m) => mum(m)),
  ben02(-3),
  mum(-2),
  {
    monthOffset: -2,
    day: 15,
    beneficiaryId: "ben_03",
    sendAed: 500,
    purpose: "gift",
    status: "RETURNED",
  },
  mum(-1),
  ben02(-1),
  // this month: 2,000 + 1,500 + 13,000 = 16,500 of the 20,000 monthly limit
  mum(0),
  ben02(0),
  {
    monthOffset: 0,
    day: 10,
    beneficiaryId: "ben_04",
    sendAed: 13000,
    purpose: "savings_own_account",
    status: "ON_HOLD",
  },
];

function mum(monthOffset: number): SeedTransfer {
  return {
    monthOffset,
    day: 2,
    beneficiaryId: "ben_01",
    sendAed: 2000,
    purpose: "family_maintenance",
    status: "PAID_OUT",
  };
}

function ben02(monthOffset: number): SeedTransfer {
  return {
    monthOffset,
    day: 5,
    beneficiaryId: "ben_02",
    sendAed: 1500,
    purpose: "family_maintenance",
    status: "PAID_OUT",
  };
}

const FIRST_REF = 240108;
const RETURN_REASON = "recipient bank reported a name mismatch";
const RETURNED_REFUND_MINOR = 49200; // 492 AED: refunded at the return-date rate, fee kept

/** (send - fee) x rate, floored to the paisa, using integer maths on a 4-dp rate. */
function receiveMinor(sendMinor: number, feeMinor: number, rate: number): number {
  const rate4 = Math.round(rate * 10_000);
  return Math.floor(((sendMinor - feeMinor) * rate4) / 10_000);
}

function at(now: Date, monthOffset: number, day: number, minutes = 0): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, day, 9, 0) + minutes * 60_000,
  );
}

const iso = (d: Date) => d.toISOString();
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function utrFor(b: SeedBeneficiary, paidOut: Date, seq: number): string {
  const digits = String(seq).padStart(8, "0");
  // UPI references are a 12-digit RRN; bank (IMPS) UTRs carry a bank prefix and the date.
  if (b.payout_method === "upi")
    return `${ymd(paidOut).slice(2).replaceAll("-", "")}${String(seq).slice(-6)}`;
  const prefix =
    b.bank_name === "HDFC Bank" ? "HDFCR5" : b.bank_name === "SBI" ? "SBINR5" : "ICICR5";
  return `${prefix}${ymd(paidOut).replaceAll("-", "")}${digits}`;
}

export interface SeedSummary {
  users: number;
  beneficiaries: number;
  ratesHistory: number;
  transfers: number;
  transferEvents: number;
}

export function seed(db: Db, now: Date = new Date()): SeedSummary {
  const run = db.transaction((): SeedSummary => {
    for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run();

    db.prepare(
      "INSERT INTO users (id, name, country, kyc_tier, card_last4) VALUES (?, ?, ?, ?, ?)",
    ).run(USER_ID, "Priya Nair", "AE", "Verified", "8812");

    const addedAt = iso(at(now, -12, 1));
    const insBen = db.prepare(`INSERT INTO beneficiaries
      (id, user_id, nickname, full_name, relationship, payout_method, bank_name, ifsc, account_last4,
       account_type, upi_id, city, state, mobile_last4, default_purpose, name_verified, added_at, aliases)
      VALUES (@id, @user_id, @nickname, @full_name, @relationship, @payout_method, @bank_name, @ifsc,
       @account_last4, @account_type, @upi_id, @city, @state, NULL, @default_purpose, 1, @added_at, @aliases)`);
    for (const b of BENEFICIARIES) {
      insBen.run({ ...b, user_id: USER_ID, added_at: addedAt, aliases: JSON.stringify(b.aliases) });
    }

    const insRate = db.prepare("INSERT INTO rates_history (pair, day, mid) VALUES (?, ?, ?)");
    const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
    AED_INR_7D.forEach((aed, i) => {
      const day = ymd(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6 + i)),
      );
      const usd = round4(aed * AED_PER_USD);
      insRate.run("AED/INR", day, aed);
      insRate.run("USD/INR", day, usd);
      insRate.run("GBP/INR", day, round4(usd * USD_PER_GBP));
    });

    const insTransfer = db.prepare(`INSERT INTO transfers
      (ref, user_id, beneficiary_id, quote_id, send_amount_minor, send_currency, receive_amount_minor,
       fee_minor, rate, payout_method, purpose, status, utr, created_at, paid_out_at, eta,
       hold_rfi_json, return_reason, refund_minor)
      VALUES (@ref, @user_id, @beneficiary_id, NULL, @send_amount_minor, 'AED', @receive_amount_minor,
       @fee_minor, @rate, @payout_method, @purpose, @status, @utr, @created_at, @paid_out_at, @eta,
       @hold_rfi_json, @return_reason, @refund_minor)`);
    const insEvent = db.prepare("INSERT INTO transfer_events (ref, status, at) VALUES (?, ?, ?)");

    let events = 0;
    TRANSFERS.forEach((t, i) => {
      const ben = BENEFICIARIES.find((b) => b.id === t.beneficiaryId);
      const rate = BOARD_RATE_BY_MONTH[t.monthOffset];
      if (!ben || rate === undefined) throw new Error(`Bad seed row ${i}`);
      const ref = `ACM-${FIRST_REF + i}`;
      const feeMinor = FEE_MINOR[ben.payout_method];
      const sendMinor = t.sendAed * 100;
      const created = at(now, t.monthOffset, t.day);

      const timeline: [string, Date][] = [
        ["FUNDS_RECEIVED", created],
        ["SCREENING", at(now, t.monthOffset, t.day, 1)],
      ];
      let paidOut: Date | null = null;
      if (t.status === "PAID_OUT") {
        paidOut = at(now, t.monthOffset, t.day, 3);
        timeline.push(["SENT_TO_PARTNER", at(now, t.monthOffset, t.day, 2)], ["PAID_OUT", paidOut]);
      } else if (t.status === "RETURNED") {
        timeline.push(
          ["SENT_TO_PARTNER", at(now, t.monthOffset, t.day, 2)],
          ["RETURNED", at(now, t.monthOffset, t.day + 2)],
        );
      } else {
        timeline.push(["ON_HOLD", at(now, t.monthOffset, t.day, 2)]);
      }

      // Customer-facing RFI only; a screening reason is never stored or emitted (CLAUDE.md rule 5).
      const rfi =
        t.status === "ON_HOLD"
          ? JSON.stringify({
              type: "RFI",
              document: "updated Emirates ID",
              how: "upload in the Acme app",
              deadline: ymd(at(now, t.monthOffset, t.day + 7)),
            })
          : null;

      insTransfer.run({
        ref,
        user_id: USER_ID,
        beneficiary_id: ben.id,
        send_amount_minor: sendMinor,
        receive_amount_minor: receiveMinor(sendMinor, feeMinor, rate),
        fee_minor: feeMinor,
        rate,
        payout_method: ben.payout_method,
        purpose: t.purpose,
        status: t.status,
        utr: paidOut ? utrFor(ben, paidOut, FIRST_REF + i) : null,
        created_at: iso(created),
        paid_out_at: paidOut ? iso(paidOut) : null,
        eta: "within minutes",
        hold_rfi_json: rfi,
        return_reason: t.status === "RETURNED" ? RETURN_REASON : null,
        refund_minor: t.status === "RETURNED" ? RETURNED_REFUND_MINOR : null,
      });
      for (const [status, when] of timeline) {
        insEvent.run(ref, status, iso(when));
        events++;
      }
    });

    return {
      users: 1,
      beneficiaries: BENEFICIARIES.length,
      ratesHistory: AED_INR_7D.length * 3,
      transfers: TRANSFERS.length,
      transferEvents: events,
    };
  });
  return run();
}

const isCli =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const { loadConfig } = await import("../config.js");
  const { DB_PATH } = loadConfig();
  const db = openDb(DB_PATH);
  migrate(db);
  const summary = seed(db);
  db.close();
  console.log(`Seeded ${DB_PATH}:`, summary);
}
