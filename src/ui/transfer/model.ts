/**
 * The transfer view's state (SPEC "MCP Apps view"), derived only from what its host sends:
 * ui/notifications/tool-input (the arguments) then tool-result (the CallToolResult) for each
 * linked tool call, plus the results of the view's own calls. Results are recognised by shape,
 * not by tool name, so the view works in hosts that open one view per call and in the simulator,
 * which keeps one view per transfer. No DOM here, so it is tested under Node.
 */

export type Json = Record<string, unknown>;

export interface Quote {
  quote_id: string;
  send_amount: number;
  fee: number;
  locked_rate: number;
  receive_amount: number;
  rate_locked_until: string;
  eta?: string;
  funding?: string;
  warnings?: { code: string; remaining_after?: number; resets_on?: string }[];
}

export interface Transfer {
  transfer_ref: string;
  status: string;
  customer_label?: string;
  recipient?: string;
  send_amount?: number;
  fee?: number;
  charged?: number;
  funding?: string;
  receive_amount?: number;
  eta?: string;
  utr?: string;
  timeline?: { status: string; at: string }[];
  action_required?: { type?: string; document?: string; how?: string; deadline?: string };
}

export interface Refusal {
  code: string;
  resolution?: string;
  attempts_left?: number;
  sent_to?: string;
  expires_at?: string;
  [k: string]: unknown;
}

export type Phase =
  | { kind: "waiting" }
  | { kind: "quote"; quote: Quote }
  | {
      kind: "readback";
      token: string;
      expiresAt: string;
      readBack: string;
      quote?: Quote | undefined;
      /** Set once the user tapped Confirm or Not now (the words go to the assistant). */
      answered?: "yes" | "no";
    }
  | {
      kind: "code";
      token: string;
      sentTo: string;
      expiresAt: string;
      attemptsLeft: number;
      quote?: Quote | undefined;
      error?: string;
    }
  | { kind: "receipt"; transfer: Transfer }
  | { kind: "refused"; code: string; message: string };

export interface ViewState {
  phase: Phase;
  /** The latest quote seen, so the read-back can show its figures. */
  quote?: Quote | undefined;
  /** The latest confirmation token seen, from a prepare result or confirm arguments. */
  token?: string | undefined;
  /** Arguments of the call whose result comes next. */
  input?: Json | undefined;
}

export const initialState: ViewState = { phase: { kind: "waiting" } };

/** Statuses after which track_transfer never changes again. */
export const FINAL = new Set(["PAID_OUT", "CANCELLED", "RETURNED"]);

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Codes whose `resolution` speaks to the model; the view says it in the user's words instead. */
const USER_WORDS: Record<string, (r: Refusal) => string> = {
  OTP_EXPIRED: () =>
    "That code has expired and nothing was sent. Say yes to the assistant to get a new one.",
  OTP_LOCKED: () =>
    "Too many wrong codes, so this confirmation was cancelled and nothing was sent. Ask the assistant for a new quote.",
  TOKEN_EXPIRED: () =>
    "This confirmation has expired and nothing was sent. Ask the assistant for a new quote.",
  TOKEN_USED: () => "This confirmation has already been used.",
  TOKEN_UNKNOWN: () => "This confirmation is no longer valid. Ask the assistant for a new quote.",
  STEP_UP_REQUIRED: (r) => `We texted a code to your ${r.sent_to ?? "phone"}.`,
};

export function refusalMessage(r: Refusal): string {
  return USER_WORDS[r.code]?.(r) ?? r.resolution ?? "That can't be done right now.";
}

export function onToolInput(state: ViewState, args: unknown): ViewState {
  const input = isObj(args) ? args : {};
  return { ...state, input, token: str(input.confirmation_token) ?? state.token };
}

export function onToolResult(state: ViewState, result: unknown): ViewState {
  const r = isObj(result) ? result : {};
  const sc = isObj(r.structuredContent) ? r.structuredContent : {};
  const input = state.input ?? {};
  const next: ViewState = { ...state, input: undefined };

  if (isObj(sc.refused)) {
    const refusal = sc.refused as unknown as Refusal;
    const token = str(input.confirmation_token) ?? state.token;
    if (refusal.code === "STEP_UP_REQUIRED" && token) {
      return {
        ...next,
        token,
        phase: {
          kind: "code",
          token,
          sentTo: refusal.sent_to ?? "phone",
          expiresAt: refusal.expires_at ?? "",
          attemptsLeft: refusal.attempts_left ?? 3,
          quote: state.quote,
        },
      };
    }
    if (refusal.code === "OTP_INVALID" && state.phase.kind === "code") {
      const left = refusal.attempts_left ?? state.phase.attemptsLeft;
      return {
        ...next,
        phase: {
          ...state.phase,
          attemptsLeft: left,
          error: `That code didn't match and nothing was sent. ${left} ${left === 1 ? "try" : "tries"} left.`,
        },
      };
    }
    return {
      ...next,
      phase: { kind: "refused", code: refusal.code, message: refusalMessage(refusal) },
    };
  }

  if (str(sc.confirmation_token) && str(sc.read_back)) {
    const quote = state.quote?.quote_id === sc.quote_id ? state.quote : undefined;
    return {
      ...next,
      token: sc.confirmation_token as string,
      phase: {
        kind: "readback",
        token: sc.confirmation_token as string,
        expiresAt: str(sc.expires_at) ?? "",
        readBack: sc.read_back as string,
        quote,
      },
    };
  }

  if (str(sc.quote_id) && typeof sc.locked_rate === "number") {
    const quote = sc as unknown as Quote;
    return { ...next, quote, phase: { kind: "quote", quote } };
  }

  if (str(sc.transfer_ref) && str(sc.status)) {
    const prev = state.phase.kind === "receipt" ? state.phase.transfer : undefined;
    const same = prev?.transfer_ref === sc.transfer_ref;
    const transfer = { ...(same ? prev : {}), ...(sc as unknown as Transfer) };
    return { ...next, phase: { kind: "receipt", transfer } };
  }

  return next; // a result this view does not draw
}

/* ---------- formatting (en-AE / en-IN figures, as the simulator shows them) ---------- */

export function aed(v: number | undefined): string {
  if (typeof v !== "number") return "";
  const dp = Number.isInteger(v) ? 0 : 2;
  return `${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })} AED`;
}

export function inr(v: number | undefined): string {
  if (typeof v !== "number") return "";
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Seconds left until `iso` at `now`, never negative; NaN-safe (0 for a bad date). */
export function secondsLeft(iso: string, now: number): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - now) / 1000)) : 0;
}

export function mmss(s: number): string {
  const n = Math.max(0, Math.ceil(s));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

/** Keeps the digits of what was typed, at most six. */
export function digits(typed: string): string {
  return typed.replace(/\D/g, "").slice(0, 6);
}

const STEPS: [string, string][] = [
  ["FUNDS_RECEIVED", "Payment received"],
  ["SCREENING", "Checking details"],
  ["SENT_TO_PARTNER", "Sent to the payout partner"],
  ["PAID_OUT", "Paid out"],
];
const END: Record<string, string> = {
  ON_HOLD: "Under review",
  CANCELLED: "Cancelled",
  RETURNED: "Returned",
};

export interface Step {
  label: string;
  state: "done" | "todo" | "end";
}

/** The progress steps for a status, as the simulator's receipt draws them. */
export function steps(status: string, timeline: { status: string }[] = []): Step[] {
  const reached = new Set([...timeline.map((e) => e.status), status]);
  const at = STEPS.findIndex(([s]) => s === status);
  const last = at >= 0 ? at : Math.max(-1, ...STEPS.map(([s], i) => (reached.has(s) ? i : -1)));
  const out: Step[] = STEPS.map(([, label], i) => ({ label, state: i <= last ? "done" : "todo" }));
  const end = END[status];
  if (status === "ON_HOLD" && end) out.splice(last + 1, 1, { label: end, state: "end" });
  else if (end) {
    out.length = last + 1;
    out.push({ label: end, state: "end" });
  }
  return out;
}

/** What the view tells the assistant after a code entered in it confirmed a transfer. */
export function confirmedContext(t: Transfer): { text: string; structured: Json } {
  const label = t.customer_label ?? t.status;
  return {
    text: `The user entered the code from their phone in the transfer view on screen, and the transfer is confirmed: ${t.transfer_ref} to ${t.recipient ?? "the recipient"}, ${label}. Nothing is waiting for a code any more.`,
    structured: {
      event: "transfer_confirmed",
      transfer_ref: t.transfer_ref,
      status: t.status,
      customer_label: label,
    },
  };
}
