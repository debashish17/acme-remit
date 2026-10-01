# Acme Remit for Alexa+ — Build Spec & Hackathon Plan

Oct 1, 2026 · @Debashish

## Locked decisions

Acme Remit is one remittance provider's own Alexa+ add-on: a self-hosted MCP server (spec 2025-11-25, Streamable HTTP) over a simulated ledger, entered in the Alexa+ track plus the AWS Builder and Open Source mini challenges.

| Decision | Choice | Why |
| --- | --- | --- |
| Framing | Single provider ("Acme Remit", name TBD), UAE–India corridor, AED to INR | Matches how every real Alexa+ add-on works; one board rate, one backend, no scraping |
| Rates | Live mid-market from Frankfurter (ECB), cached 15 min; ECB publishes no AED, so AED/INR is USD/INR divided by the CBUAE peg of 3.6725 AED per USD, plus a simulated Acme FX margin; seeded fallback table. Customer sees "our rate" plus the guaranteed receive amount, Wise-style mid shown only in `compare_options` | Realistic pricing model, one dependency, demo never breaks |
| Payout methods | Bank deposit via IMPS (instant), UPI ID (instant), cash pickup (MTSS caps). No economy/express tiers | What UAE exchange houses actually offer; cash pickup brings a real regulatory cap into the demo |
| Competitor data | None live. `compare_options` shows the mid rate, Acme's rate, and a labelled illustrative typical-bank rate derived from the same mid | Honest, defensible, still reads well aloud |
| Funding | Saved debit card, charged at confirm; funds received instantly in the mock | Voice cannot take card details; matches per-transfer funding norms |
| Money movement | Simulated ledger only; every write labelled "no real funds move" | Expected for the event; the tool contract is production-shaped |
| User and KYC tier | One demo user (Priya, Dubai), tier "Verified" (Emirates ID done, no income proof), Bearer token auth | Tier explains the limits; account linking (OAuth 2.1 + PKCE) documented as the production path |
| Recipients | Resolved by nickname server-side via `resolve_beneficiary`; adding or editing recipients is out of scope | Adding payees by voice is a fraud surface; say so on purpose |
| Compliance | Purpose of remittance captured (family maintenance default); screening hold modelled as ON\_HOLD with an RFI the customer can act on; reason for a hit is never disclosed (tipping-off) | Shows real AML behaviour without inventing internals |
| State changes | Only `confirm_transfer` and `cancel_transfer` move money, both behind the same read-back-and-token gate; `set_rate_alert` writes alert state | The asymmetry is the headline safety claim |
| Stack | TypeScript, Express, `@modelcontextprotocol/sdk`, SQLite (better-sqlite3), AWS App Runner us-east-1, Bedrock in the simulator | Lowest ops for a solo build, satisfies AWS Builder |

Open item: the product name. Placeholder `acme-remit` in code until chosen.

## Architecture

The MCP layer is a thin adapter; every rule about money lives in the core module, which has no idea MCP exists. That split is what lets the README say "swap `core/ledger` for the production API" and mean it.

&#91;embedded content: architecture · 5 layers, one external call\]

Requests flow top to bottom; the only outbound network call is the cached rate fetch, so every tool answers from local data well inside the 500 ms budget Alexa+ requires.

**A transfer, end to end ("Send 2,000 dirhams to Mum")**

1. Model calls `resolve_beneficiary("Mum")` → one match, `ben_01`, bank deposit, name verified.
2. Model calls `quote_transfer(2000, "AED", "ben_01", "bank_deposit", "family_maintenance")` → core reads the cached mid rate, applies the corridor FX margin, adds the flat fee, checks tier limits and velocity, writes a quote row (rate and fee locked 30 min), returns the guaranteed receive amount, ETA and `quote_id`.
3. Model reads the quote back. User: "Confirm."
4. Model calls `prepare_transfer(quote_id)` → core issues a single-use `confirmation_token` (5-min expiry) and returns the exact read-back sentence. Model says it again; this is the consent step.
5. User: "Yes." Model calls `confirm_transfer(token)` → core validates the token, re-checks limits, charges the saved card (mock, instant), writes the transfer as `FUNDS_RECEIVED` then `SCREENING`, returns `transfer_ref`.
6. A background ticker moves it to `SENT_TO_PARTNER` after 15 s and `PAID_OUT` with a generated UTR after 30 s, so `track_transfer` changes during the video. One seeded past transfer sits in `RETURNED` and one in `ON_HOLD` with an RFI, so the model can explain those states too.

**Real vs simulated**

| Component | Real | Simulated |
| --- | --- | --- |
| MCP server, Streamable HTTP, spec 2025-11-25 | yes |  |
| Bearer auth, token lifecycle, limit enforcement | yes |  |
| AWS App Runner deployment, Bedrock in the client | yes |  |
| Mid-market exchange rates | yes, Frankfurter |  |
| Acme FX margin, fees, payout methods, KYC tier limits |  | yes |
| Card funding, ledger, screening, payout partner, UTRs |  | yes |

## Tool contract

Twelve tools, one domain, two money-moving tools behind one gate. The `description` strings below are the product copy the model reads to pick a tool: ship them verbatim and tune only after watching the simulator mis-pick.

| # | Tool | Description (what the model reads) | Writes state |
| --- | --- | --- | --- |
| 1 | `get_rate` | Get today's AED to INR exchange rate for sending money to India, with the 7-day trend. Use when the user asks about the rate, the rupee, or whether now is a good time to send. | no |
| 2 | `compare_options` | Compare what the recipient would receive for a send amount across Acme's payout methods (bank deposit, UPI, cash pickup), including fee and arrival time, and show Acme's rate against the mid-market rate and a typical bank rate. Use when the user asks which option is best or how much will be received. | no |
| 3 | `list_beneficiaries` | List the user's saved recipients: nickname, relationship, bank or UPI, payout method, and when they last received money. Use when the user asks who they can send to. | no |
| 4 | `resolve_beneficiary` | Find one saved recipient from a name or nickname such as "Mum", "my brother" or "Sunita". Call this before quoting whenever the user names a person. Returns one match, or candidates to ask the user to choose from. Never invents a recipient; new recipients are added in the Acme app. | no |
| 5 | `quote_transfer` | Price a transfer: fee, locked rate, guaranteed receive amount in rupees, arrival time, and any limit warnings or document requirements for the purpose. Does not move money. Returns a quote\_id with rate and fee held for 30 minutes. | quote row |
| 6 | `prepare_transfer` | Turn a quote into a confirmation request. Returns the exact sentence to read back to the user and a single-use confirmation\_token valid for 5 minutes. Does not move money. Call confirm\_transfer only after the user explicitly agrees to the read-back. | token row |
| 7 | `confirm_transfer` | Execute a prepared transfer using its confirmation\_token: charges the saved debit card and submits the transfer. Fails if the token is unknown, expired, already used, or if limits changed since the quote. | **transfer, card charge** |
| 8 | `track_transfer` | Get the status of a transfer by reference or the most recent one: current stage, timeline, UTR once paid out, whether it can still be cancelled, and any action the user must take if it is under review. Use when the user asks where their money is or whether it was credited. | no |
| 9 | `cancel_transfer` | Cancel a transfer that has not yet been sent to the payout partner. Without a cancel\_token it returns a preview (refund amount, timing) and a single-use cancel\_token valid for 5 minutes; with the token it cancels and refunds send amount and fee to the card. Call with the token only after the user explicitly agrees to the preview. Fails once the transfer has been sent; recalls need the recipient's consent and are handled by support. | **transfer, refund** |
| 10 | `get_transfer_history` | List past transfers for the last N months or to one recipient, including cancelled, returned or refunded ones, with totals and how much of each limit has been used this month. | no |
| 11 | `check_limits` | Show the user's KYC tier, remaining per-transaction, daily and monthly limits, cash-pickup caps, the reset date, and explain any refusal code in plain words with how to resolve it. | no |
| 12 | `set_rate_alert` | Ask to be told when the AED to INR rate reaches a target. Use when the user says "tell me when" or "alert me if". | alert row |

**Inputs and outputs**

```json
// 1 get_rate
in:  { "from": "AED", "to": "INR" }
out: { "corridor": "AE-IN", "pair": "AED/INR", "customer_rate": 23.21, "mid_rate": 23.42, "fx_margin_pct": 0.9,
       "week_high": 23.55, "week_low": 23.10, "trend": "rupee weakened 0.6% this week",
       "as_of": "2026-10-01T09:15:00Z", "source": "ECB via Frankfurter, cached" }

// 2 compare_options
in:  { "send_amount": 2000, "send_currency": "AED" }
out: { "mid_rate": 23.42, "customer_rate": 23.21,
       "payout_methods": [
         { "method": "bank_deposit", "rail": "IMPS", "fee": 15, "receive_amount": 46070, "eta": "within minutes, 24x7" },
         { "method": "upi", "rail": "UPI", "fee": 15, "receive_amount": 46070, "eta": "within minutes, 24x7" },
         { "method": "cash_pickup", "rail": "MTSS partner", "fee": 20, "receive_amount": 45954, "eta": "within 2 hours",
           "caps": { "per_transaction_aed": 9180, "per_recipient_per_year": 30, "max_cash_inr": 50000 } } ],
       "benchmark": { "name": "typical bank", "rate": 22.83, "fee": 25, "receive_amount": 45090, "illustrative": true },
       "note": "Benchmark is illustrative: derived from the mid rate with a typical published FX margin." }

// 3 list_beneficiaries
in:  {}
out: { "recipients": [ { "id": "ben_01", "nickname": "Mum", "full_name": "Sunita Nair", "relationship": "mother",
         "payout_method": "bank_deposit", "bank": "HDFC Bank", "account_last4": "4421", "name_verified": true,
         "default_purpose": "family_maintenance", "last_sent": { "date": "2026-10-02", "send_amount": 2000, "currency": "AED" } } ] }

// 4 resolve_beneficiary
in:  { "query": "Mum" }
out: { "match": { "id": "ben_01", "nickname": "Mum", "full_name": "Sunita Nair", "payout_method": "bank_deposit" } }
  or { "ambiguous": true, "candidates": [ { "id": "ben_02", "nickname": "Rahul", "relationship": "brother" }, { "id": "ben_03", "nickname": "Rahul (college)", "relationship": "friend" } ] }
  or { "not_found": true, "hint": "Recipients are added and name-verified in the Acme app." }

// 5 quote_transfer
in:  { "send_amount": 2000, "send_currency": "AED", "beneficiary_id": "ben_01", "payout_method": "bank_deposit", "purpose": "family_maintenance" }
out: { "quote_id": "q_7f3a", "rate_locked_until": "...+30m", "fee": 15, "locked_rate": 23.21, "send_amount": 2000,
       "receive_amount": 46070, "receive_currency": "INR", "guaranteed": true, "eta": "within minutes",
       "funding": "debit card ending 8812",
       "warnings": [ { "code": "NEAR_MONTHLY_LIMIT", "remaining_after": 1500, "currency": "AED", "resets_on": "2026-11-01" } ] }
  or { "refused": { "code": "MONTHLY_LIMIT", "limit": 20000, "used": 18500, "requested": 3000, "currency": "AED", "resets_on": "2026-11-01",
       "resolution": "Send up to 1,500 dirhams now, or raise your limit by adding salary proof in the Acme app." } }
  or { "refused": { "code": "PURPOSE_REQUIRES_DOCUMENTS", "purpose": "property_purchase",
       "resolution": "Property payments need a sale agreement uploaded in the Acme app before sending." } }

// 6 prepare_transfer
in:  { "quote_id": "q_7f3a" }
out: { "confirmation_token": "ct_9b2e...", "expires_at": "...+5m",
       "read_back": "Send 2,000 dirhams to Mum, Sunita Nair at HDFC Bank ending 4421, for family maintenance. Fee 15 dirhams, rate 23.21, charged to your card ending 8812. She receives 46,070 rupees, guaranteed, within minutes. Shall I go ahead?" }

// 7 confirm_transfer
in:  { "confirmation_token": "ct_9b2e..." }
out: { "transfer_ref": "ACM-240133", "status": "SCREENING", "receive_amount": 46070, "eta": "within minutes",
       "receipt": "Receipt and FIRA will be available in the Acme app once paid out." }
  or { "refused": { "code": "TOKEN_EXPIRED" | "TOKEN_USED" | "TOKEN_UNKNOWN" | "LIMIT_EXCEEDED" | "CARD_DECLINED", "resolution": "..." } }

// 8 track_transfer
in:  { "transfer_ref": "ACM-240133" }   or   { "latest": true }
out: { "transfer_ref": "ACM-240133", "status": "PAID_OUT", "recipient": "Mum", "utr": "HDFCR52026100112345678",
       "timeline": [ { "status": "FUNDS_RECEIVED", "at": "..." }, { "status": "SCREENING", "at": "..." },
                     { "status": "SENT_TO_PARTNER", "at": "..." }, { "status": "PAID_OUT", "at": "..." } ] }
  or { "status": "ON_HOLD", "customer_label": "Under review",
       "action_required": { "type": "RFI", "document": "updated Emirates ID", "how": "upload in the Acme app", "deadline": "2026-10-05" } }
  or { "status": "RETURNED", "reason": "recipient bank reported a name mismatch", "refund": { "amount": 492, "currency": "AED",
       "note": "refunded at the rate on the return date; fee not refunded", "eta": "2-7 working days" } }

// 9 get_transfer_history
in:  { "months": 3 }   or   { "beneficiary_id": "ben_01" }
out: { "transfers": [ ... ], "totals": { "count": 5, "send_amount": 18500, "currency": "AED", "returned": 1 },
       "limits_used": { "monthly": { "used": 18500, "limit": 20000, "resets_on": "2026-11-01" }, "daily": { "used": 2000, "limit": 10000 } } }

// 10 check_limits
in:  { "refusal_code": "MONTHLY_LIMIT" }   (optional)
out: { "kyc_tier": "Verified (Emirates ID)", "next_tier": "Verified Plus: add salary proof to raise monthly limit to 60,000 AED",
       "per_transaction": { "limit": 5000, "currency": "AED", "funding": "debit card" }, "daily": { "remaining": 8000 },
       "monthly": { "remaining": 1500, "resets_on": "2026-11-01" },
       "cash_pickup": { "per_transaction_aed": 9180, "per_recipient_per_year": 30 },
       "new_recipient_first_transfer": { "limit": 2000 },
       "explanation": "On your current tier you can send 20,000 dirhams a month. You have 1,500 left until 1 November. ..." }

// 9 cancel_transfer (preview, then execute)
in:  { "transfer_ref": "ACM-240120" }
out: { "cancel_token": "cx_41d7...", "expires_at": "...+5m", "status": "ON_HOLD", "cancellable": true,
       "preview": "Cancel the 13,000 dirham transfer to your NRE account. 13,000 dirhams, including the 15 dirham fee, go back to your card ending 8812 within 2 to 7 working days. Shall I cancel it?" }
in:  { "transfer_ref": "ACM-240120", "cancel_token": "cx_41d7..." }
out: { "transfer_ref": "ACM-240120", "status": "CANCELLED", "refund": { "amount": 13000, "currency": "AED", "to": "card ending 8812", "eta": "2-7 working days" },
       "limits_now": { "monthly": { "remaining": 14500 } } }
  or { "refused": { "code": "CANCEL_WINDOW_CLOSED", "status": "SENT_TO_PARTNER",
       "resolution": "This transfer has already been sent. A recall needs the recipient's consent; Acme support can request one from the app." } }
  or { "refused": { "code": "TOKEN_EXPIRED" | "TOKEN_USED" | "TOKEN_UNKNOWN", "resolution": "..." } }

// 12 set_rate_alert
in:  { "pair": "AED/INR", "target": 23.5, "direction": "above" }
out: { "alert_id": "al_02", "channel": "push and email", "message": "I'll let you know when a dirham buys more than 23.50 rupees." }
```

Every refusal is structured (`code`, numbers, `resolution`) so the model can explain it well. No tool ever returns a bare string error.

## Core module interface

Six small services behind plain TypeScript interfaces; the MCP handlers only parse input, call one of these, and shape the output. Nothing in `core/` imports the MCP SDK, so every rule is unit-testable with no transport.

```
src/
  server/            MCP adapter: Express app, Streamable HTTP transport, Bearer check, tool registrations
  core/
    rates.ts         RatesService
    beneficiaries.ts BeneficiaryService
    quotes.ts        QuoteService  (pricing + delivery options)
    limits.ts        LimitService
    ledger.ts        LedgerService (confirm, transfers, status ticker)
    alerts.ts        AlertService
    confirm.ts       ConfirmationGate (token issue/validate; candidate OSS package)
  db/                schema.sql, migrate.ts, seed.ts
  simulator/         static web client
tests/
```

```ts
type PayoutMethod = 'bank_deposit' | 'upi' | 'cash_pickup';
type Purpose = 'family_maintenance' | 'savings_own_account' | 'education' | 'medical' | 'loan_repayment' | 'gift' | 'property_purchase' | 'business';
type TransferStatus = 'CREATED' | 'FUNDS_RECEIVED' | 'SCREENING' | 'SENT_TO_PARTNER' | 'PAID_OUT' | 'ON_HOLD' | 'CANCELLED' | 'RETURNED';

interface RatesService {
  getMid(from: string, to: string): Promise<{ rate: number; asOf: string; source: 'live' | 'fallback' }>;
  getCustomerRate(from: string, to: string): Promise<{ rate: number; fxMarginPct: number }>;   // one board rate per corridor
  getWeekRange(from: string, to: string): Promise<{ high: number; low: number; changePct: number }>;
}
// Fetches USD->INR from Frankfurter (https://api.frankfurter.dev/v1; it has no AED) and derives AED/INR = USD/INR / 3.6725 (peg),
// caches 15 min in SQLite rates_cache,
// falls back to the seeded 7-day table on any error. FX margin per corridor lives in config.

interface BeneficiaryService {
  list(userId: string): Recipient[];
  resolve(userId: string, query: string): { match: Recipient } | { ambiguous: true; candidates: Recipient[] } | { notFound: true };
}
// resolve: lowercase, strip punctuation, match nickname, first name, full name, relationship words
// ("mum", "mother", "amma" -> relationship=mother; "my account", "savings" -> ben_04). Equal scores -> ambiguous.

interface QuoteService {
  compare(userId: string, sendAmount: number): CompareResult;                 // all payout methods + benchmark
  create(userId: string, input: QuoteInput): Quote | Refusal;                   // purpose rules, limits, lock rate+fee 30 min
  get(quoteId: string): Quote | undefined;
}
// Purpose rules: business -> refused (retail app); property_purchase -> refused PURPOSE_REQUIRES_DOCUMENTS;
// gift from a non-relative -> warning GIFT_TAXABLE_IN_INDIA; everything else passes.

interface LimitService {
  check(userId: string, recipient: Recipient, sendAmount: number, method: PayoutMethod): { ok: true; warnings: Warning[] } | Refusal;
  remaining(userId: string): LimitsSnapshot;
  explain(code: RefusalCode): string;
}
// Tier "Verified": per transaction 5,000 AED (card), daily 10,000, monthly 20,000, first transfer to a recipient
// added < 24 h ago 2,000, single transfer >= 15,000 -> SOURCE_OF_FUNDS_REQUIRED (would become an RFI).
// Cash pickup: per transaction 9,180 AED (~USD 2,500), 30 per recipient per year, receive amount <= 50,000 INR.

interface ConfirmationGate {
  issue(quoteId: string, callerId: string): { token: string; expiresAt: string };
  consume(token: string, callerId: string): { quoteId: string } | Refusal;     // single use, 5-min TTL, caller-bound
  // The same gate issues cancel tokens: issue({ kind: 'cancel', ref }, callerId) -> cx_ token; consume checks kind matches.
  // callerId is the authenticated principal from the Bearer check (the OAuth subject + client in production):
  // the transport is stateless, so there is no MCP session id to bind to.
}

interface LedgerService {
  confirm(userId: string, quoteId: string): Transfer | Refusal;   // re-checks limits, charges mock card, writes FUNDS_RECEIVED -> SCREENING
  cancel(userId: string, ref: string): Transfer | Refusal;        // allowed in CREATED, FUNDS_RECEIVED, SCREENING, ON_HOLD; refunds the amount charged (send amount, fee included); frees limits
  cancellable(ref: string): boolean;                               // false from SENT_TO_PARTNER onward
  track(userId: string, ref?: string): TransferView | undefined;  // includes utr, action_required (RFI) or refund details
  history(userId: string, filter: { months?: number; beneficiaryId?: string }): HistoryResult;
  startTicker(): void;   // every 15 s: SCREENING -> SENT_TO_PARTNER -> PAID_OUT (+ generated UTR); ON_HOLD stays until a dev control releases it
}

interface AlertService {
  set(userId: string, pair: string, target: number, direction: 'above' | 'below'): Alert;
  evaluate(): Alert[];   // called by the ticker; the simulator polls /dev/alerts to "fire" one on screen
}
```

All monetary values are integers in minor units internally (fils, paise) and formatted at the edge. The `Refusal` type is shared: `{ refused: { code, ...numbers, resolution } }`.

## Data model and seed data

One SQLite file, eight tables, reset to the seed on every `npm run seed` so each demo take starts identical.

```sql
CREATE TABLE users        (id TEXT PRIMARY KEY, name TEXT, country TEXT, kyc_tier TEXT, card_last4 TEXT);
CREATE TABLE beneficiaries(id TEXT PRIMARY KEY, user_id TEXT, nickname TEXT, full_name TEXT, relationship TEXT,
                           payout_method TEXT, bank_name TEXT, ifsc TEXT, account_last4 TEXT, account_type TEXT,
                           upi_id TEXT, city TEXT, state TEXT, mobile_last4 TEXT, default_purpose TEXT,
                           name_verified INTEGER, added_at TEXT, aliases TEXT /* json array */);
CREATE TABLE rates_cache  (pair TEXT PRIMARY KEY, mid REAL, fetched_at TEXT, source TEXT);
CREATE TABLE rates_history(pair TEXT, day TEXT, mid REAL, PRIMARY KEY (pair, day));   -- seeded 7 days, fallback
CREATE TABLE quotes       (id TEXT PRIMARY KEY, user_id TEXT, beneficiary_id TEXT, send_amount_minor INTEGER, send_currency TEXT,
                           payout_method TEXT, purpose TEXT, locked_rate REAL, fee_minor INTEGER, receive_amount_minor INTEGER,
                           created_at TEXT, rate_locked_until TEXT, status TEXT /* open|prepared|consumed|expired */);
CREATE TABLE confirmations(token TEXT PRIMARY KEY, quote_id TEXT, session_id TEXT, created_at TEXT, expires_at TEXT, used_at TEXT);
CREATE TABLE transfers    (ref TEXT PRIMARY KEY, user_id TEXT, beneficiary_id TEXT, quote_id TEXT, send_amount_minor INTEGER,
                           send_currency TEXT, receive_amount_minor INTEGER, fee_minor INTEGER, rate REAL, payout_method TEXT,
                           purpose TEXT, status TEXT, utr TEXT, created_at TEXT, paid_out_at TEXT, eta TEXT,
                           hold_rfi_json TEXT, return_reason TEXT, refund_minor INTEGER);
CREATE TABLE transfer_events(ref TEXT, status TEXT, at TEXT);          -- the timeline track_transfer returns
CREATE TABLE alerts       (id TEXT PRIMARY KEY, user_id TEXT, pair TEXT, target REAL, direction TEXT, created_at TEXT, fired_at TEXT);
```

The block above is migration 1 (`src/db/schema.sql`). Later changes are numbered files in `src/db/migrations/`, tracked in `PRAGMA user_version`:

```sql
-- 0002_cancel_token_target.sql
-- Cancel tokens (cx_) record the transfer they cancel; confirmation tokens (ct_) keep using quote_id.
-- The token kind is its prefix. session_id holds the caller binding key (stateless transport, no MCP session id).
ALTER TABLE confirmations ADD COLUMN transfer_ref TEXT;
CREATE INDEX confirmations_quote ON confirmations (quote_id);
CREATE INDEX transfers_user_created ON transfers (user_id, created_at);
CREATE INDEX transfer_events_ref ON transfer_events (ref, at);
```

**Seed**

| Entity | Values |
| --- | --- |
| User | `usr_priya`, Priya Nair, Dubai (AE), tier Verified (Emirates ID), debit card \*\*\*\*8812 |
| `ben_01` | Mum, Sunita Nair, mother, bank deposit, HDFC Bank, IFSC HDFC0001234, acct \*\*\*\*4421, savings, Chandigarh, Punjab, name verified, purpose family\_maintenance, aliases `["mum","mom","mother","amma","sunita"]` |
| `ben_02` | Rahul, Rahul Nair, brother, UPI `rahul.nair@okhdfc`, Pune, Maharashtra, name verified, purpose family\_maintenance, aliases `["rahul","brother","bhai"]` |
| `ben_03` | Rahul (college), Rahul Menon, friend, bank deposit, ICICI Bank, acct \*\*\*\*3302, Kochi, Kerala, name verified, purpose gift, aliases `["rahul menon","college rahul"]` |
| `ben_04` | My NRE account, Priya Nair, self, bank deposit, SBI, acct \*\*\*\*0917, NRE, Chandigarh, purpose savings\_own\_account, aliases `["my account","nre","savings","myself"]` |
| Transfers, past | 7 months: 2,000 AED to Mum on the 2nd of each month, PAID\_OUT with UTRs. 1,500 AED to brother in Jul and Sep by UPI. 500 AED to friend in Aug: RETURNED (name mismatch), refund 492 AED, fee kept |
| Transfers, this month | Mum 2,000 (2nd, PAID\_OUT), brother 1,500 (5th, PAID\_OUT), NRE account 13,000 (10th, ON\_HOLD, RFI: updated Emirates ID). Monthly used 16,500 of 20,000, so one more 2,000 passes and the next 3,000 refuses on camera |
| Rates history | 7 days each for AED/INR, USD/INR, GBP/INR, pulled once from Frankfurter when writing the seed script and hard-coded; AED/INR derived from USD/INR at the 3.6725 peg |
| Limits config | Tier Verified: per transaction 5,000 AED, daily 10,000, monthly 20,000, new-recipient first transfer 2,000, source-of-funds threshold 15,000. Cash pickup 9,180 AED per transaction, 30 per recipient per year, 50,000 INR cash cap. Next tier Verified Plus (salary proof): monthly 60,000 |
| FX margin | AED/INR 0.9%; USD/INR 0.8%; GBP/INR 1.0%; one board rate, no per-method rate difference |
| Fees | bank deposit 15 AED, UPI 15 AED, cash pickup 20 AED; flat per transfer, taken out of the send amount (the card is charged the send amount; receive = (send − fee) × rate) |
| Purpose rules | business refused; property\_purchase needs documents; gift to non-relative warns about Indian gift tax; others pass |

The two Rahuls exist on purpose: "send money to Rahul" triggers the disambiguation turn. The ON\_HOLD transfer to the NRE account gives the model a real RFI to explain, and the RETURNED one lets it explain a bounce, the FX loss on refund, and the kept fee.

## Transfer lifecycle and glossary

Five stages on the main path and three exits; the demo advances the main path on a timer, the user can reach Cancelled by voice before the transfer is sent, and the other two exits exist in seed data so the model can explain them.

&#91;embedded content: transfer lifecycle · 5 stages, 3 exits\]

Most transfers reach paid out in minutes; the slow tail comes from screening holds and funding delays, not the payout rail. On a hold the customer sees "Under review" and, only if something is needed from them, an RFI such as an updated Emirates ID or salary proof. The reason for a screening hit is never disclosed.

**Glossary used in tool outputs and the simulator**

| Term | Meaning | Where it appears |
| --- | --- | --- |
| Corridor | A send country and receive country pair, here UAE–India (AE-IN) | `get_rate` |
| Send amount / receive amount | What the sender pays in AED / what the recipient gets in INR | every pricing tool |
| FX margin | The difference between the mid-market rate and the customer rate; the provider's main revenue | `get_rate`, `compare_options` |
| Rate lock / guaranteed rate | Rate and fee held for a window so the receive amount is fixed | `quote_transfer` |
| Payout method | How the recipient gets the money: bank deposit (IMPS), UPI, cash pickup | `compare_options`, `quote_transfer` |
| Payout partner | The Indian bank or MTSS agent that credits the recipient | lifecycle, `track_transfer` |
| UTR | Unique Transaction Reference from the Indian banking system; what the recipient's bank asks for | `track_transfer` |
| FIRA | Foreign Inward Remittance Advice, the receipt used for tax and bank purposes in India | `confirm_transfer` receipt line |
| Purpose of remittance | Declared reason, mapped to CBUAE and RBI purpose codes behind the scenes | `quote_transfer` |
| Source of funds | Evidence of where large send amounts came from, requested above a threshold | `check_limits`, RFI |
| RFI | Request for information during a compliance hold | `track_transfer` |
| Returned / bounced | Payout failed at the recipient bank; money refunded to the sender, often with FX loss and fee kept | `track_transfer`, history |
| Recall | Asking for money back after it has landed; needs recipient consent, out of scope | README only |
| MTSS | India's Money Transfer Service Scheme governing cash pickup caps | `compare_options` caps |
| KYC tier | Verification level that sets the user's limits | `check_limits` |

Consumer-facing words win in anything the model speaks: recipient not beneficiary, sender not remitter, "under review" not "on hold".

## Quote and token lifecycle, and the tests to write

A transfer needs three calls in order, and each step can only be used once; the tests below are the evidence judges look for in the repo.

**Rules**

1. `quote_transfer` writes a quote with status `open`, rate and fee locked for 30 min, and the guaranteed receive amount. A quote is priced once; `confirm` never re-fetches the rate.
2. `prepare_transfer` requires an `open`, unexpired quote. It moves the quote to `prepared`, issues one random 32-byte token (base64url) bound to the quote and the authenticated caller (stateless transport, so no MCP session id), expiry now + 5 min. Calling prepare again on the same quote invalidates the previous token.
3. `confirm_transfer` requires a token that exists, is unused, unexpired, and was issued to the same authenticated caller. It re-runs the limit check, then in one SQLite transaction: marks the token used, marks the quote `consumed`, records the mock card charge, inserts the transfer as `FUNDS_RECEIVED` and immediately `SCREENING`, and writes both timeline events.
4. The ticker advances `SCREENING` → `SENT_TO_PARTNER` → `PAID_OUT` and generates a UTR on payout. `ON_HOLD`, `RETURNED` and `CANCELLED` are set as follows: CANCELLED only by cancel\_transfer, and only while the transfer is in CREATED, FUNDS\_RECEIVED, SCREENING or ON\_HOLD, refunding the amount charged (the send amount, which includes the fee) to the card and releasing the amount from the monthly and daily counters; ON\_HOLD and RETURNED only by seed data or a dev control. No tool recalls.
5. Any rejected confirm is logged with the reason and the token prefix, never the full token.
6. A transfer in `ON_HOLD` reports `customer_label: "Under review"` and the RFI if one exists; it never reports a screening reason.

**Tests (Vitest), one file per service plus one protocol file**

| File | Cases |
| --- | --- |
| `confirm.test.ts` | unknown token refused · expired token refused · reused token refused · token from another caller refused · second prepare invalidates first token · happy path consumes exactly once |
| `limits.test.ts` | per-transaction cap · daily cap across two quotes · monthly cap at exactly the limit with reset date in the refusal · new-recipient first-transfer cap · source-of-funds threshold · cash pickup per-transaction, per-year count and 50,000 INR caps · NEAR\_MONTHLY\_LIMIT warning below 25% remaining · explanation text per code |
| `quotes.test.ts` | locked rate equals rate at quote time even after cache refresh · fee by payout method · receive\_amount = (send\_amount − fee) × rate, rounded down to the paisa · expired quote cannot be prepared · business purpose refused · property purpose refused with document resolution · gift to non-relative warns |
| `beneficiaries.test.ts` | "Mum", "mother", "amma" resolve to ben\_01 · "my account" resolves to ben\_04 · "Rahul" is ambiguous with two candidates · unknown name returns not\_found with the app hint · never creates a record |
| `ledger.test.ts` | confirm charges the card exactly once under two concurrent confirms (second refused) · ticker advances SCREENING → SENT\_TO\_PARTNER → PAID\_OUT and sets a UTR · ON\_HOLD is not advanced by the ticker · cancel in SCREENING or ON\_HOLD refunds the amount charged (fee included) and lowers monthly used · cancel after SENT\_TO\_PARTNER refused CANCEL\_WINDOW\_CLOSED · cancel preview then execute consumes one cx\_ token, reuse refused · track returns RFI for ON\_HOLD and refund details for RETURNED · history totals and limits\_used match seeded rows |
| `rates.test.ts` | live fetch populates cache · second call within 15 min does not hit the network (mocked fetch) · network failure falls back to seeded history with source=fallback |
| `protocol.test.ts` | `initialize` negotiates `2025-11-25` · `tools/list` returns 12 tools with JSON schemas · `tools/call` on each tool returns structured content · missing Bearer returns 401 · legacy GET /sse is not served |

Run `npm test` in CI (GitHub Actions on every push) so the green badge is in the README on submission day.

## Simulated Alexa+ client

The simulator stands in for Alexa+ because Alexa+ is not available in India; it talks to the MCP server over the same HTTP endpoint Alexa+ would, so nothing in the server is simulator-specific.

**How it works**

1. On load, the page calls `POST /mcp` with `initialize` then `tools/list` and keeps the 11 tool schemas.
2. The user speaks (Web Speech API, `webkitSpeechRecognition`) or types. The transcript is appended to a message history.
3. The page calls a tiny proxy route on the same server, `POST /sim/chat`, which forwards history + tool schemas to Amazon Bedrock (Nova 2 Lite or Claude on Bedrock via the Converse API with tool use). Keeping Bedrock behind the server avoids shipping AWS keys to the browser and is the documented AWS Builder integration.
4. When Bedrock returns a tool call, the proxy executes it against its own `/mcp` endpoint (a real JSON-RPC round trip, not an in-process shortcut), feeds the result back, and loops until Bedrock returns text.
5. The reply is rendered as a chat bubble and spoken with `speechSynthesis`.

**The system prompt given to Bedrock** is the one place you emulate Alexa+ behaviour: be brief, speak amounts in words, always read back a prepared transfer and wait for an explicit yes before calling `confirm_transfer`, ask the user to choose when a recipient is ambiguous, say "recipient" and "receive amount" rather than "beneficiary" or "payout", never speculate about why a transfer is under review, and explain refusals using the `resolution` text.

**On screen**

| Element | Purpose |
| --- | --- |
| Conversation column | Chat bubbles with a mic button; the Alexa-style blue light bar while listening (no Amazon logos or wordmarks) |
| Protocol panel (collapsible, right) | Live JSON-RPC: each request and response, the negotiated `protocolVersion`, latency per call in ms |
| Ledger strip (top) | Balance, open quote, latest transfer status; updates live so the ticker is visible |
| Banner | "Simulated ledger: no real funds move. Mid-market rates are live; Acme pricing is simulated." always visible |
| Dev controls (hidden behind `?dev=1`) | Fire alert, advance ticker, reset seed: used only while recording |

Serve the simulator as static files from the same Express app at `/`, so one App Runner service hosts both and the demo URL is a single link in the README.

## Hackathon step-by-step plan

Submit by Oct 22, 2026; the Devpost deadline is Oct 23, 2026 at 12:00 PDT (00:30 IST on Oct 24), judging runs from Oct 26, 2026, winners are announced Dec 3, 2026.

&#91;embedded content: build plan · 6 phases, submit Oct 22\]

Each phase ends with a checkable milestone; if a phase slips, cut from phase 4 first, never from phase 5.

**Phase 0 · Oct 1–2 · Setup, zero code**

- [ ] Register on Devpost and join the hackathon; create an Amazon developer account
- [ ] Request the $150 AWS credits via the hackathon form; enable Bedrock model access in us-east-1
- [ ] Create the GitHub repo (public, MIT license), add `FRICTION_LOG.md` and `FEEDBACK.md`, log from the first command
- [ ] Install Node 22, pnpm, Alexa AI CLI; run `alexa-ai configure` and note what happens from India

* Milestone: repo exists, first friction entry written

**Phase 1 · Oct 3–6 · Protocol skeleton**

- [ ] Express app, `StreamableHTTPServerTransport` stateless mode on `POST /mcp`, Bearer middleware, `GET /health`
- [ ] One trivial tool (`get_rate` returning a constant); verify with MCP Inspector: initialize → tools/list → tools/call
- [ ] SQLite schema + migrate + seed scripts; Vitest + GitHub Actions workflow
- [ ] `protocol.test.ts` green

* Milestone: `curl` initialize negotiates `2025-11-25`; CI badge green

**Phase 2 · Oct 7–11 · Core and 11 tools**

- [ ] `rates.ts` with Frankfurter fetch, cache, fallback; `beneficiaries.ts` resolve
- [ ] `limits.ts`, `quotes.ts` (compare + create), `confirm.ts` gate, `ledger.ts` with ticker, `alerts.ts`
- [ ] Register all 11 tools with JSON schemas and the descriptions from the contract
- [ ] All six service test files green

* Milestone: full send flow works through MCP Inspector with the refusal path visible

**Phase 3 · Oct 12–15 · Deploy and simulator**

- [ ] Dockerfile; deploy to App Runner us-east-1; measure p95 latency per tool from a US region (<500 ms)
- [ ] Simulator page: tools/list on load, mic + TTS, chat loop via `/sim/chat` → Bedrock Converse tool use
- [ ] Protocol panel, ledger strip, disclaimer banner, `?dev=1` controls
- [ ] Tune tool descriptions and the Bedrock system prompt until the six demo beats run clean three times in a row

* Milestone: public URL runs the whole demo script

**Phase 4 · Oct 16–18 · Alexa+ CLI attempt**

- [ ] `alexa-ai new mcp` against the public URL; fill `addon.json`; six icon sizes + one 600×900 carousel image; hosted privacy and terms pages
- [ ] `alexa-ai deploy`; test in Amazon's web simulator if it is reachable; record whatever blocks as friction entries
- [ ] Optional: extract `confirm.ts` into a small published npm package (`mcp-confirm-gate`) for the Open Source mini challenge

* Milestone: either a deployed dev-stage add-on, or a documented account of exactly where region gating stopped it

**Phase 5 · Oct 19–21 · Video and write-ups**

- [ ] Record the 2:45 video (script in the submission checklist); upload to YouTube, public, English
- [ ] README: what it does, architecture, real-vs-simulated table, run steps, test badge, demo URL
- [ ] `FEEDBACK.md` per tool used (MCP SDK, Alexa AI CLI, Bedrock, App Runner, Devpost itself); feature requests with severity; friction log finalised

* Milestone: a stranger can clone, seed, run tests and open the simulator in 10 minutes

**Oct 22 · Submit**

- [ ] Fill every Devpost field; select Alexa+ track plus AWS Builder and Open Source mini challenges
- [ ] Repo is public, so no reviewer invites needed; double-check the license file is at the root
- [ ] Keep Oct 23 free for fixes only

## Submission checklist

Everything Devpost asks for, mapped to where it lives in the repo, plus the video script.

| Devpost field | What we submit | Lives in |
| --- | --- | --- |
| Text description | What it does, how it works, the three safety properties (read-back, single-use token, server-side limits), what is simulated | `README.md` top section |
| GitHub repo | Public, MIT license at root, run steps, test badge, demo URL | repo root |
| Demo video | Under 3 min, YouTube public, English, no third-party music or logos | link in README |
| Product feedback | One entry per tool: MCP TypeScript SDK, Alexa AI CLI and Add-on Agent Skill, Bedrock Converse tool use, App Runner, Devpost form; what it was used for, what worked, what did not, onboarding feel, would use again | `FEEDBACK.md` |
| Tracks | Alexa+ primary; AWS Builder (Bedrock + App Runner, documented); Open Source (`mcp-confirm-gate` package or a PR to the MCP SDK docs) | form |
| Pre-existing project | Not applicable: everything built in the window; say so | form |
| Feature requests (optional) | Step-up auth before consequential tools (critical); India availability for add-on testing (important); per-tool latency metrics in the developer console (nice-to-have) | `FEEDBACK.md` |
| Friction log (optional, up to +10%) | Dated entries: task, steps, expected vs actual, severity, workaround, suggestion | `FRICTION_LOG.md` |

**Video script, 2:45**

| Time | Beat | On screen |
| --- | --- | --- |
| 0:00–0:20 | "Acme Remit is a self-hosted MCP server that lets Alexa+ handle UAE-to-India remittances safely. Everything runs on a simulated ledger; mid-market rates are live; the tool contract is production-shaped." | Architecture drawing, 5 s, then the simulator |
| 0:20–0:38 | "What's the rupee at today?" → rate and trend. "Is that better than last week?" | Chat + protocol panel showing `get_rate` |
| 0:38–0:55 | "How much would Mum get for 2,000 dirhams?" → bank deposit vs UPI vs cash pickup, and vs a typical bank | `compare_options` in the bubble |
| 0:55–1:28 | "Send 2,000 dirhams to Mum." → quote → read-back with purpose, card and guaranteed rupees → "Yes." → confirmed | Panel shows `prepare_transfer` token then `confirm_transfer`; ledger strip shows SCREENING |
| 1:28–1:42 | "Send her another three thousand." → refused: monthly limit, 1,500 left until 1 November, add salary proof to raise it | Refusal JSON in the panel: the server enforced it, not the model |
| 1:42–1:55 | "Send 500 to Rahul." → "Which Rahul, your brother or Rahul Menon?" | Candidates from `resolve_beneficiary` |
| 1:55–2:10 | "Where's Mum's money?" → paid out, UTR read aloud. "And the one to my NRE account?" → under review, upload updated Emirates ID in the app | Ticker reached PAID\_OUT; RFI shown, no reason given |
| 2:10–2:24 | "Cancel the one to my NRE account." → preview: 13,000 dirhams back to the card → "Yes." → cancelled, 14,500 of monthly limit now free | `cancel_transfer` twice in the panel; ledger strip updates |
| 2:24–2:30 | "Tell me when the dirham hits 23.5." → alert set, fired via dev control | Push-style toast |
| 2:30–2:40 | Repo tour: tool list, token and limit tests passing, CI green, App Runner URL, Bedrock call in `/sim/chat` | Editor and terminal |
| 2:40–2:45 | "The ledger module is the only thing between this and a licensed exchange house's backend." | README real-vs-simulated table |

Record in one take per beat and stitch; judges are not required to watch past three minutes, so nothing important lands after 2:40.
