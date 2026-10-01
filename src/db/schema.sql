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
