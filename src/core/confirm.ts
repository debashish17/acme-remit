import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/connection.js";
import { TOKEN_TTL_MINUTES } from "./policy.js";
import { refuse } from "./refusal.js";
import { addMinutes } from "./time.js";
import { consoleLogger, type Clock, type Logger, type Refusal } from "./types.js";

/**
 * ConfirmationGate (SPEC). Issues and consumes single-use tokens for the two money-moving tools:
 * `ct_` tokens confirm a prepared quote, `cx_` tokens confirm a cancellation. A token is 32 random
 * bytes (base64url), lives 5 minutes (never past `notAfter`, e.g. the quote's rate lock), is bound
 * to the authenticated caller, and works once. Issuing a new token for the same target expires the
 * previous one.
 *
 * Only the SHA-256 of a token is stored, so the database never holds a usable token, and logs show
 * a short prefix only (CLAUDE.md rule 6). The gate knows nothing about quotes or transfers: the
 * caller wraps `consume` in the same SQLite transaction as the state change it authorises, so a
 * later refusal rolls the consumption back.
 */

export type GateTarget = { kind: "transfer"; quoteId: string } | { kind: "cancel"; ref: string };
export type GateKind = GateTarget["kind"];

export interface IssuedToken {
  token: string;
  expiresAt: string;
}

export interface GateDeps {
  db: Db;
  now?: Clock;
  logger?: Logger;
  ttlMinutes?: number;
}

const PREFIX: Record<GateKind, string> = { transfer: "ct_", cancel: "cx_" };

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Safe to log: the kind prefix and the first five characters of the random part. */
export const tokenPrefix = (token: string) => `${token.slice(0, 8)}…`;

interface ConfirmationRow {
  quote_id: string | null;
  transfer_ref: string | null;
  session_id: string;
  expires_at: string;
  used_at: string | null;
}

export class ConfirmationGate {
  private readonly db: Db;
  private readonly now: Clock;
  private readonly logger: Logger;
  private readonly ttlMinutes: number;

  constructor(deps: GateDeps) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
    this.logger = deps.logger ?? consoleLogger;
    this.ttlMinutes = deps.ttlMinutes ?? TOKEN_TTL_MINUTES;
  }

  issue(target: GateTarget, callerId: string, opts: { notAfter?: Date } = {}): IssuedToken {
    const now = this.now();
    const ttlEnd = addMinutes(now, this.ttlMinutes);
    const expires = opts.notAfter && opts.notAfter < ttlEnd ? opts.notAfter : ttlEnd;
    const token = `${PREFIX[target.kind]}${randomBytes(32).toString("base64url")}`;
    const quoteId = target.kind === "transfer" ? target.quoteId : null;
    const ref = target.kind === "cancel" ? target.ref : null;

    this.db.transaction(() => {
      // A newer token for the same target replaces any older unused one.
      this.db
        .prepare(
          `UPDATE confirmations SET expires_at = ?
           WHERE used_at IS NULL AND expires_at > ? AND ${quoteId ? "quote_id = ?" : "transfer_ref = ?"}`,
        )
        .run(now.toISOString(), now.toISOString(), quoteId ?? ref);
      this.db
        .prepare(
          `INSERT INTO confirmations (token, quote_id, session_id, created_at, expires_at, used_at, transfer_ref)
           VALUES (?, ?, ?, ?, ?, NULL, ?)`,
        )
        .run(hash(token), quoteId, callerId, now.toISOString(), expires.toISOString(), ref);
    })();

    return { token, expiresAt: expires.toISOString() };
  }

  /**
   * Validates and marks the token used. Wrong kind or wrong caller read as TOKEN_UNKNOWN, so a
   * token reveals nothing to anyone but the caller it was issued to.
   */
  consume(token: string, callerId: string, kind: GateKind): GateTarget | Refusal {
    const prefix = tokenPrefix(token);
    const reject = (code: "TOKEN_UNKNOWN" | "TOKEN_EXPIRED" | "TOKEN_USED", reason: string) => {
      this.logger.warn(`gate: rejected ${kind} token ${prefix} (${reason})`);
      return refusal(code, kind);
    };

    if (!token.startsWith(PREFIX[kind])) return reject("TOKEN_UNKNOWN", "wrong kind or format");
    const row = this.db
      .prepare(
        "SELECT quote_id, transfer_ref, session_id, expires_at, used_at FROM confirmations WHERE token = ?",
      )
      .get(hash(token)) as ConfirmationRow | undefined;
    if (!row) return reject("TOKEN_UNKNOWN", "not found");
    if (row.session_id !== callerId) return reject("TOKEN_UNKNOWN", "issued to another caller");
    if (row.used_at) return reject("TOKEN_USED", "already used");
    const now = this.now();
    if (Date.parse(row.expires_at) <= now.getTime()) return reject("TOKEN_EXPIRED", "expired");

    // Conditional update: of two concurrent consumers, exactly one sees a change.
    const { changes } = this.db
      .prepare("UPDATE confirmations SET used_at = ? WHERE token = ? AND used_at IS NULL")
      .run(now.toISOString(), hash(token));
    if (changes !== 1) return reject("TOKEN_USED", "lost a concurrent consume");

    this.logger.info(`gate: consumed ${kind} token ${prefix}`);
    return kind === "transfer"
      ? { kind, quoteId: row.quote_id ?? "" }
      : { kind, ref: row.transfer_ref ?? "" };
  }
}

function refusal(code: "TOKEN_UNKNOWN" | "TOKEN_EXPIRED" | "TOKEN_USED", kind: GateKind): Refusal {
  const what = kind === "transfer" ? "transfer" : "cancellation";
  const again =
    kind === "transfer"
      ? "Prepare the transfer again and read back the new confirmation."
      : "Ask to cancel again to get a new preview.";
  const resolution = {
    TOKEN_UNKNOWN: `That ${what} confirmation is not valid. ${again}`,
    TOKEN_EXPIRED: `That ${what} confirmation has expired or was replaced by a newer one; confirmations last ${TOKEN_TTL_MINUTES} minutes. ${again}`,
    TOKEN_USED: `That ${what} confirmation has already been used, so nothing was done twice. Check the transfer with track_transfer.`,
  }[code];
  return refuse(code, resolution);
}
