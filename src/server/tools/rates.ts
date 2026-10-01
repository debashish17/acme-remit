import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Core } from "../../core/index.js";
import { aedAmount, safely, toMinor } from "../wire.js";
import { READ_ONLY } from "./common.js";
import { TOOL_DESCRIPTIONS } from "./descriptions.js";

const from = z.literal("AED").default("AED").describe("Send currency. Only AED is supported.");
const to = z.literal("INR").default("INR").describe("Receive currency. Only INR is supported.");

const getRateOutput = {
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

export function registerRateTools(server: McpServer, core: Core): void {
  server.registerTool(
    "get_rate",
    {
      title: "Get AED to INR rate",
      description: TOOL_DESCRIPTIONS.get_rate,
      inputSchema: { from, to },
      outputSchema: getRateOutput,
      annotations: READ_ONLY,
    },
    safely("get_rate", ({ from: f, to: t }: { from: string; to: string }) =>
      core.rates.snapshot(f, t),
    ),
  );

  server.registerTool(
    "compare_options",
    {
      title: "Compare payout options",
      description: TOOL_DESCRIPTIONS.compare_options,
      inputSchema: {
        send_amount: aedAmount.describe("Amount to send, in dirhams (AED)."),
        send_currency: from,
      },
      annotations: READ_ONLY,
    },
    safely("compare_options", ({ send_amount }: { send_amount: number }) =>
      core.quotes.compare(toMinor(send_amount)),
    ),
  );
}
