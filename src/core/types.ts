/**
 * Shared core types. All amounts are integer minor units (fils for AED, paise for INR) and every
 * field holding one ends in `_minor`; the server converts those at the edge (CLAUDE.md rule 2).
 */

export type PayoutMethod = "bank_deposit" | "upi" | "cash_pickup";
export const PAYOUT_METHODS = ["bank_deposit", "upi", "cash_pickup"] as const;

export const PURPOSES = [
  "family_maintenance",
  "savings_own_account",
  "education",
  "medical",
  "loan_repayment",
  "gift",
  "property_purchase",
  "business",
] as const;
export type Purpose = (typeof PURPOSES)[number];

export type TransferStatus =
  | "CREATED"
  | "FUNDS_RECEIVED"
  | "SCREENING"
  | "SENT_TO_PARTNER"
  | "PAID_OUT"
  | "ON_HOLD"
  | "CANCELLED"
  | "RETURNED";

/** Returns the current time. Injected everywhere so tests control expiry and ticker timing. */
export type Clock = () => Date;

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

export const consoleLogger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
};

export interface Recipient {
  id: string;
  userId: string;
  nickname: string;
  fullName: string;
  relationship: string;
  payoutMethod: PayoutMethod;
  bankName: string | null;
  ifsc: string | null;
  accountLast4: string | null;
  accountType: string | null;
  upiId: string | null;
  city: string | null;
  state: string | null;
  defaultPurpose: Purpose;
  nameVerified: boolean;
  addedAt: string;
  aliases: string[];
}

export interface User {
  id: string;
  name: string;
  country: string;
  kycTier: string;
  cardLast4: string;
}

export const REFUSAL_CODES = [
  // limits
  "PER_TRANSACTION_LIMIT",
  "DAILY_LIMIT",
  "MONTHLY_LIMIT",
  "NEW_RECIPIENT_LIMIT",
  "SOURCE_OF_FUNDS_REQUIRED",
  "CASH_PICKUP_LIMIT",
  "LIMIT_EXCEEDED",
  // pricing and purpose
  "AMOUNT_TOO_SMALL",
  "PURPOSE_NOT_SUPPORTED",
  "PURPOSE_REQUIRES_DOCUMENTS",
  "PAYOUT_METHOD_UNAVAILABLE",
  "BENEFICIARY_NOT_FOUND",
  "QUOTE_UNKNOWN",
  "QUOTE_EXPIRED",
  "QUOTE_ALREADY_USED",
  // confirmation gate and ledger
  "TOKEN_UNKNOWN",
  "TOKEN_EXPIRED",
  "TOKEN_USED",
  "CARD_DECLINED",
  "TRANSFER_NOT_FOUND",
  "CANCEL_WINDOW_CLOSED",
  // rates
  "CURRENCY_NOT_SUPPORTED",
  "RATE_UNAVAILABLE",
  // alerts
  "ALERT_TARGET_INVALID",
  // anything unexpected, converted at the tool boundary
  "INTERNAL_ERROR",
] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];

/** CLAUDE.md rule 4: `{ refused: { code, ...numbers, resolution } }`. */
export interface Refusal {
  refused: { code: RefusalCode; resolution: string } & Record<string, unknown>;
}

export interface Warning {
  code: "NEAR_MONTHLY_LIMIT" | "GIFT_TAXABLE_IN_INDIA";
  [key: string]: unknown;
}
