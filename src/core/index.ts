import type { Db } from "../db/connection.js";
import { BeneficiaryService } from "./beneficiaries.js";
import { ConfirmationGate } from "./confirm.js";
import { LedgerService, type CardGateway } from "./ledger.js";
import { LimitService } from "./limits.js";
import { VERIFIED_TIER, type TierConfig } from "./policy.js";
import { QuoteService } from "./quotes.js";
import { RatesService } from "./rates.js";
import { consoleLogger, type Clock, type Logger } from "./types.js";

/** Composition root for the core services. No transport, no timers: callers start those. */

export interface CoreDeps {
  db: Db;
  ratesUrl: string;
  fetch?: typeof fetch;
  now?: Clock;
  logger?: Logger;
  card?: CardGateway;
  tier?: TierConfig;
  /** TICKER_MS: time in each ticker-driven status. */
  stepMs?: number;
  newQuoteId?: () => string;
}

export function createCore(deps: CoreDeps) {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? consoleLogger;
  const tier = deps.tier ?? VERIFIED_TIER;
  const { db } = deps;

  const rates = new RatesService({
    db,
    baseUrl: deps.ratesUrl,
    now,
    logger,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  const limits = new LimitService(db, now, tier);
  const gate = new ConfirmationGate({ db, now, logger });
  const quotes = new QuoteService({
    db,
    rates,
    limits,
    gate,
    now,
    tier,
    ...(deps.newQuoteId ? { newId: deps.newQuoteId } : {}),
  });
  const ledger = new LedgerService({
    db,
    gate,
    limits,
    now,
    logger,
    ...(deps.card ? { card: deps.card } : {}),
    ...(deps.stepMs ? { stepMs: deps.stepMs } : {}),
  });
  const beneficiaries = new BeneficiaryService(db);

  return { db, rates, limits, gate, quotes, ledger, beneficiaries };
}

export type Core = ReturnType<typeof createCore>;
