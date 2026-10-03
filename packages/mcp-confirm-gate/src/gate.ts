import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { MemoryStore, type Awaitable, type TokenRecord, type TokenStore } from "./store.js";

/**
 * A confirmation gate for tools that do something consequential (move money, delete data, send
 * messages) when an LLM agent calls them.
 *
 * The pattern: a "prepare" tool returns the exact sentence to read back plus a single-use token;
 * the "confirm" tool does the work only with that token, issued to the same caller, within a
 * few minutes, once. Optionally, confirming also needs a one-time code sent out of band (SMS,
 * push), which the model is never given, so it cannot approve on its own.
 */

export type Refusal =
  | { ok: false; code: "TOKEN_UNKNOWN" | "TOKEN_EXPIRED" | "TOKEN_USED" }
  | { ok: false; code: "STEP_UP_REQUIRED"; expiresAt: number; attemptsLeft: number }
  | { ok: false; code: "OTP_INVALID"; attemptsLeft: number }
  | { ok: false; code: "OTP_EXPIRED" | "OTP_LOCKED" };

export type Confirmed = { ok: true; target: string };

/** What a step-up sender gets: enough to word the message for this one action. */
export interface StepUpContext {
  target: string;
  caller: string;
  /** When the code stops working (epoch ms). */
  expiresAt: number;
}

export interface StepUpOptions {
  /** Delivers the code out of band. Put what is being approved in the message. */
  send: (code: string, ctx: StepUpContext) => Awaitable<void>;
  digits?: number; // default 6
  ttlMs?: number; // default 5 minutes, never past the token
  maxAttempts?: number; // default 3; then the token is void
  maxSends?: number; // default 3 codes per token
}

export interface GateOptions {
  store?: TokenStore;
  /** Token prefix, handy for telling token kinds apart in logs. Default "ct_". */
  prefix?: string;
  /** Token lifetime. Default 5 minutes. */
  ttlMs?: number;
  /** Require a one-time code before a token can be spent. */
  stepUp?: StepUpOptions;
  now?: () => number;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Safe to log: the prefix and the first five characters of the random part. */
export function tokenPrefix(token: string): string {
  return `${token.slice(0, 8)}…`;
}

export class ConfirmGate {
  readonly store: TokenStore;
  private readonly prefix: string;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: GateOptions = {}) {
    this.store = opts.store ?? new MemoryStore();
    this.prefix = opts.prefix ?? "ct_";
    this.ttlMs = opts.ttlMs ?? 5 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  /**
   * A new single-use token for `target`, bound to `caller`. A newer token for the same target
   * replaces any older unused one. `notAfter` caps the expiry (e.g. at a price lock).
   */
  async issue(
    target: string,
    caller: string,
    opts: { notAfter?: number } = {},
  ): Promise<{ token: string; expiresAt: number }> {
    const now = this.now();
    const ttlEnd = now + this.ttlMs;
    const expiresAt = opts.notAfter !== undefined ? Math.min(opts.notAfter, ttlEnd) : ttlEnd;
    const token = `${this.prefix}${randomBytes(32).toString("base64url")}`;
    await this.store.expireTarget(target, now);
    await this.store.put({ hash: sha256(token), target, caller, expiresAt, usedAt: null });
    return { token, expiresAt };
  }

  /** Checks a token without spending it. A token issued to another caller reads as unknown. */
  async peek(
    token: string,
    caller: string,
  ): Promise<(Confirmed & { expiresAt: number }) | Refusal> {
    const r = await this.valid(token, caller);
    return "code" in r ? r : { ok: true, target: r.target, expiresAt: r.expiresAt };
  }

  /** Spends the token once. Without step-up configured, this is the whole confirmation. */
  async consume(token: string, caller: string): Promise<Confirmed | Refusal> {
    if (this.opts.stepUp) return this.confirm(token, caller);
    return this.spend(token, caller);
  }

  /**
   * With step-up: called without `code`, sends one and refuses STEP_UP_REQUIRED; called with the
   * code the user read out (spaces and dashes are ignored), checks it, then spends the token.
   */
  async confirm(token: string, caller: string, code?: string): Promise<Confirmed | Refusal> {
    const s = this.opts.stepUp;
    if (!s) return this.spend(token, caller);
    const r = await this.valid(token, caller);
    if ("code" in r) return r;
    const digits = s.digits ?? 6;
    const maxAttempts = s.maxAttempts ?? 3;
    const now = this.now();

    if (code === undefined) {
      const sends = r.stepUp?.sends ?? 0;
      if (sends >= (s.maxSends ?? 3)) return { ok: false, code: "OTP_LOCKED" };
      const otp = String(randomInt(0, 10 ** digits)).padStart(digits, "0");
      const salt = randomBytes(16).toString("hex");
      const expiresAt = Math.min(now + (s.ttlMs ?? 5 * 60_000), r.expiresAt);
      await this.store.update(r.hash, {
        stepUp: {
          codeHash: sha256(`${salt}:${otp}`),
          salt,
          expiresAt,
          attempts: 0,
          sends: sends + 1,
        },
      });
      await s.send(otp, { target: r.target, caller, expiresAt });
      return { ok: false, code: "STEP_UP_REQUIRED", expiresAt, attemptsLeft: maxAttempts };
    }

    const st = r.stepUp;
    if (!st) return { ok: false, code: "OTP_INVALID", attemptsLeft: maxAttempts };
    if (st.expiresAt <= now) return { ok: false, code: "OTP_EXPIRED" };
    const given = code.replace(/[\s-]/g, "");
    const match =
      given.length === digits &&
      timingSafeEqual(
        Buffer.from(sha256(`${st.salt}:${given}`), "hex"),
        Buffer.from(st.codeHash, "hex"),
      );
    if (!match) {
      const attempts = st.attempts + 1;
      if (attempts >= maxAttempts) {
        await this.store.update(r.hash, { expiresAt: now, stepUp: { ...st, attempts } });
        return { ok: false, code: "OTP_LOCKED" };
      }
      await this.store.update(r.hash, { stepUp: { ...st, attempts } });
      return { ok: false, code: "OTP_INVALID", attemptsLeft: maxAttempts - attempts };
    }
    return this.spend(token, caller);
  }

  private async spend(token: string, caller: string): Promise<Confirmed | Refusal> {
    const r = await this.valid(token, caller);
    if ("code" in r) return r;
    // Of two concurrent spends, exactly one wins.
    if (!(await this.store.markUsed(r.hash, this.now()))) return { ok: false, code: "TOKEN_USED" };
    return { ok: true, target: r.target };
  }

  private async valid(token: string, caller: string): Promise<TokenRecord | Refusal> {
    if (!token.startsWith(this.prefix)) return { ok: false, code: "TOKEN_UNKNOWN" };
    const r = await this.store.get(sha256(token));
    if (!r || r.caller !== caller) return { ok: false, code: "TOKEN_UNKNOWN" };
    if (r.usedAt !== null) return { ok: false, code: "TOKEN_USED" };
    if (r.expiresAt <= this.now()) return { ok: false, code: "TOKEN_EXPIRED" };
    return r;
  }
}
