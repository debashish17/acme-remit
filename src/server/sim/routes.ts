import express, { type Router } from "express";
import { z } from "zod";
import type { Core } from "../../core/index.js";
import { DEMO_USER_ID } from "../../core/policy.js";
import { isRefusal } from "../../core/refusal.js";
import { toWire } from "../wire.js";
import type { ChatService } from "./chat.js";
import { hasCode, RateLimiter, requireCode, type DailyBudget } from "./guards.js";
import type { Exchange, McpRelay } from "./relay.js";

/**
 * /sim/* serves the simulator page (behind SIM_ACCESS_CODE); /dev/* holds the recording controls
 * (behind DEV_CONTROLS_CODE, and 404 when that is unset). The page never sees the Bearer secret:
 * every tool call goes through the relay to POST /mcp.
 */

export interface SimDeps {
  core: Core;
  chat: ChatService;
  relay: McpRelay;
  budget: DailyBudget;
  accessCode?: string | undefined;
  devCode?: string | undefined;
  /** Wipes and reloads the demo seed. */
  reseed: () => void;
}

const ChatBody = z.object({
  conversation_id: z.string().max(64).optional(),
  text: z.string().trim().min(1).max(500),
});

export function simRouter(deps: SimDeps): Router {
  const { core, chat, relay, budget } = deps;
  const router = express.Router();
  router.use(
    requireCode(deps.accessCode, "x-sim-code", {
      status: 503,
      message: "The simulator is disabled on this server (SIM_ACCESS_CODE is not set).",
    }),
  );
  router.use(express.json({ limit: "16kb" }));

  // Page load: a fresh initialize + tools/list so the protocol panel shows the real handshake.
  router.get("/tools", new RateLimiter(60, 10 * 60_000).middleware(), async (_req, res) => {
    const exchanges: Exchange[] = [];
    try {
      relay.reset();
      const tools = await relay.listTools(exchanges);
      res.json({ protocol_version: relay.protocolVersion, tools, exchanges });
    } catch (err) {
      res.status(502).json({ error: "mcp_unavailable", message: String(err), exchanges });
    }
  });

  // Holders of the dev-controls code (recording, evals) skip the per-IP limit; the daily Bedrock
  // cap still applies to them.
  const devCaller = hasCode(deps.devCode, "x-dev-code");
  router.post("/chat", new RateLimiter(30, 10 * 60_000).middleware(devCaller), async (req, res) => {
    const body = ChatBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "bad_request", message: "Send { text } of 1-500 characters." });
      return;
    }
    res.json(await chat.send(body.data.conversation_id, body.data.text));
  });

  // The ledger strip polls this; `since` returns alerts fired after that time, for toasts.
  router.get("/state", new RateLimiter(600, 10 * 60_000).middleware(), async (req, res) => {
    const since = typeof req.query.since === "string" ? req.query.since : new Date().toISOString();
    // On failure the strip shows a dash; get_rate reports the problem when asked.
    const rate = await todaysRate(core).catch(() => null);
    const latest = core.ledger.track(DEMO_USER_ID);
    const quote = core.quotes.latestOpen(DEMO_USER_ID);
    res.json(
      toWire({
        server_time: new Date().toISOString(),
        latest_transfer: isRefusal(latest) ? null : latest,
        open_quote: quote
          ? {
              quote_id: quote.id,
              beneficiary_id: quote.beneficiaryId,
              send_amount_minor: quote.sendMinor,
              receive_amount_minor: quote.receiveMinor,
              status: quote.status,
              rate_locked_until: quote.rateLockedUntil,
            }
          : null,
        limits: core.limits.remaining(DEMO_USER_ID),
        rate,
        alerts: core.alerts.firedSince(DEMO_USER_ID, since),
        assistant_calls_left_today: budget.remaining,
      }),
    );
  });

  return router;
}

export function devRouter(deps: SimDeps): Router {
  const { core } = deps;
  const router = express.Router();
  router.use(requireCode(deps.devCode, "x-dev-code", { status: 404, message: "Not found." }));
  router.use(express.json({ limit: "4kb" }));
  router.use(new RateLimiter(120, 10 * 60_000).middleware());

  router.post("/tick", (_req, res) => {
    res.json({ advanced: core.ledger.tick({ force: true }) });
  });

  router.post("/release", (req, res) => {
    const ref = typeof req.body?.ref === "string" ? req.body.ref : undefined;
    const released = core.ledger.releaseHold(DEMO_USER_ID, ref);
    res.status(released ? 200 : 404).json(released ?? { error: "no transfer under review" });
  });

  router.post("/alert", (_req, res) => {
    const fired = core.alerts.fireNext(DEMO_USER_ID);
    res.status(fired ? 200 : 404).json(fired ?? { error: "no pending alert" });
  });

  router.post("/reset", (_req, res) => {
    deps.reseed();
    res.json({ reset: true });
  });

  return router;
}

async function todaysRate(core: Core) {
  const mid = await core.rates.getMid("AED", "INR");
  const customer = await core.rates.getCustomerRate("AED", "INR");
  return { customer_rate: customer.rate, mid_rate: mid.rate, as_of: mid.asOf };
}
