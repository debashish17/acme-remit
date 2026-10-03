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
  stepUp?: {
    codeHash: string;
    salt: string;
    expiresAt: number;
    attempts: number;
    sends: number;
  };
}

/**
 * Persistence for the gate. `markUsed` must be atomic: of two concurrent callers for the same
 * token, exactly one may get `true` (in SQL, `UPDATE ... SET used_at = ? WHERE hash = ? AND
 * used_at IS NULL` and check the change count).
 */
export interface TokenStore {
  put(record: TokenRecord): Awaitable<void>;
  get(hash: string): Awaitable<TokenRecord | undefined>;
  update(hash: string, patch: Partial<Omit<TokenRecord, "hash">>): Awaitable<void>;
  markUsed(hash: string, at: number): Awaitable<boolean>;
  /** Ends every unused, unexpired token for `target` (a newer one replaces them). */
  expireTarget(target: string, at: number): Awaitable<void>;
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

  /** For tests: everything stored, as stored. */
  dump(): TokenRecord[] {
    return [...this.records.values()].map((r) => structuredClone(r));
  }
}
