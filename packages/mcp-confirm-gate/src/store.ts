/** A value or a promise of it, so stores can be synchronous (SQLite) or not (Redis). */
export type Awaitable<T> = T | Promise<T>;

/**
 * What the gate keeps per token. It never holds the token itself, only its SHA-256, and a step-up
 * code only as a salted hash.
 */
export interface TokenRecord {
  /** SHA-256 (hex) of the token. */
  hash: string;
  /** What the token authorises, e.g. "transfer:q_7f3a". */
  target: string;
  /** Binding key of the authenticated caller the token was issued to. */
  caller: string;
  /** Epoch ms. */
  expiresAt: number;
  usedAt: number | null;
  /** Step-up state, present once a code has been sent. */
  stepUp?: StepUpChallenge & { attempts: number; sends: number };
}

/** One code sent for a token: its salted hash and when it stops working (epoch ms). */
export interface StepUpChallenge {
  codeHash: string;
  salt: string;
  expiresAt: number;
}

/**
 * Persistence for the gate. Three methods must be atomic, because agents can call tools in
 * parallel and each guards a count that a read-then-write would let parallel calls share:
 *
 * - `markUsed`: of concurrent callers for one token, exactly one gets `true`.
 * - `claimSend`: counts a code against the token's cap and stores it, in one step.
 * - `claimAttempt`: reserves a try at the current code before the code is checked.
 *
 * The README shows each as one SQL statement.
 */
export interface TokenStore {
  put(record: TokenRecord): Awaitable<void>;
  get(hash: string): Awaitable<TokenRecord | undefined>;
  update(hash: string, patch: Partial<Omit<TokenRecord, "hash">>): Awaitable<void>;
  markUsed(hash: string, at: number): Awaitable<boolean>;
  /** Ends every unused, unexpired token for `target` (a newer one replaces them). */
  expireTarget(target: string, at: number): Awaitable<void>;
  /**
   * If fewer than `maxSends` codes were sent for this token, makes `challenge` the current code
   * with no tries used and returns the new send count; otherwise `undefined`. Atomic.
   */
  claimSend(
    hash: string,
    challenge: StepUpChallenge,
    maxSends: number,
  ): Awaitable<number | undefined>;
  /**
   * If the current code is still `codeHash`, adds one to its tries and returns the new count;
   * otherwise (no code, or a newer one replaced it) `undefined`. Atomic.
   */
  claimAttempt(hash: string, codeHash: string): Awaitable<number | undefined>;
}

/** In-memory store for tests and single-process servers. State is lost on restart. */
export class MemoryStore implements TokenStore {
  private readonly records = new Map<string, TokenRecord>();

  put(record: TokenRecord): void {
    this.records.set(record.hash, structuredClone(record));
  }

  get(hash: string): TokenRecord | undefined {
    const r = this.records.get(hash);
    return r ? structuredClone(r) : undefined;
  }

  update(hash: string, patch: Partial<Omit<TokenRecord, "hash">>): void {
    const r = this.records.get(hash);
    if (r) this.records.set(hash, { ...r, ...structuredClone(patch) });
  }

  markUsed(hash: string, at: number): boolean {
    const r = this.records.get(hash);
    if (!r || r.usedAt !== null) return false;
    r.usedAt = at;
    return true;
  }

  expireTarget(target: string, at: number): void {
    for (const r of this.records.values()) {
      if (r.target === target && r.usedAt === null && r.expiresAt > at) r.expiresAt = at;
    }
  }

  // Synchronous, so each runs to completion before any other call: atomic within one process.
  claimSend(hash: string, challenge: StepUpChallenge, maxSends: number): number | undefined {
    const r = this.records.get(hash);
    const sends = r?.stepUp?.sends ?? 0;
    if (!r || sends >= maxSends) return undefined;
    r.stepUp = { ...challenge, attempts: 0, sends: sends + 1 };
    return sends + 1;
  }

  claimAttempt(hash: string, codeHash: string): number | undefined {
    const st = this.records.get(hash)?.stepUp;
    if (!st || st.codeHash !== codeHash) return undefined;
    st.attempts += 1;
    return st.attempts;
  }

  /** For tests: everything stored, as stored. */
  dump(): TokenRecord[] {
    return [...this.records.values()].map((r) => structuredClone(r));
  }
}
