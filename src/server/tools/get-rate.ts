import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Verbatim from docs/SPEC.md "Tool contract"; change only after a simulator mis-pick (CLAUDE.md).
export const GET_RATE_DESCRIPTION =
  "Get today's AED to INR exchange rate for sending money to India, with the 7-day trend. Use when the user asks about the rate, the rupee, or whether now is a good time to send.";

const inputSchema = {
  from: z.literal("AED").default("AED").describe("Send currency. Only AED is supported."),
  to: z.literal("INR").default("INR").describe("Receive currency. Only INR is supported."),
};

const outputSchema = {
  corridor: z.string().describe("Send and receive country pair, e.g. AE-IN"),
  pair: z.string(),
  customer_rate: z.number().describe("Acme's rate: rupees per dirham the recipient gets"),
  mid_rate: z.number().describe("Mid-market rate"),
  fx_margin_pct: z.number(),
  week_high: z.number(),
  week_low: z.number(),
  trend: z.string(),
  as_of: z.string(),
  source: z.string(),
};

type GetRateOutput = { [K in keyof typeof outputSchema]: z.infer<(typeof outputSchema)[K]> };

// Phase 1 stub: the SPEC.md example output with a fixed rate. Phase 2 replaces this with a call
// to core RatesService (Frankfurter, 15-min cache, seeded fallback).
const STUB: GetRateOutput = {
  corridor: "AE-IN",
  pair: "AED/INR",
  customer_rate: 23.21,
  mid_rate: 23.42,
  fx_margin_pct: 0.9,
  week_high: 23.55,
  week_low: 23.1,
  trend: "rupee weakened 0.6% this week",
  as_of: "2026-10-01T09:15:00Z",
  source: "ECB via Frankfurter, cached",
};

export function registerGetRate(server: McpServer): void {
  server.registerTool(
    "get_rate",
    {
      title: "Get AED to INR rate",
      description: GET_RATE_DESCRIPTION,
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    () => {
      const out = STUB;
      return {
        structuredContent: out,
        content: [{ type: "text", text: JSON.stringify(out) }],
      };
    },
  );
}
