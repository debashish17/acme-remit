-- Step-up check before money moves: confirm_transfer sends a one-time code by SMS to the
-- customer's registered phone, and only a second call carrying that code charges the card.
-- Codes are stored as salted SHA-256 hashes, bound to the confirmation token's hash and caller.
ALTER TABLE users ADD COLUMN phone_last4 TEXT;

CREATE TABLE step_up_challenges (
  id         TEXT PRIMARY KEY,
  token      TEXT NOT NULL,              -- SHA-256 of the ct_ token, as in confirmations.token
  session_id TEXT NOT NULL,              -- caller binding key
  code_hash  TEXT NOT NULL,              -- SHA-256 of "<id>:<code>"
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT
);
CREATE INDEX step_up_by_token ON step_up_challenges (token, created_at);

-- The simulated phone: what an SMS gateway would deliver. The simulator page shows these.
CREATE TABLE sms_outbox (
  id         INTEGER PRIMARY KEY,
  user_id    TEXT NOT NULL,
  to_last4   TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sms_outbox_user ON sms_outbox (user_id, created_at);
