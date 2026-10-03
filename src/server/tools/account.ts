import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Core } from "../../core/index.js";
import { HELP_TOPICS, type HelpTopic } from "../../core/help.js";
import { REFUSAL_CODES, type RefusalCode } from "../../core/types.js";
import { principalOf } from "../auth.js";
import { safely } from "../wire.js";
import { READ_ONLY, WRITES_STATE, type Extra } from "./common.js";
import { TOOL_DESCRIPTIONS } from "./descriptions.js";

export function registerAccountTools(server: McpServer, core: Core): void {
  server.registerTool(
    "check_limits",
    {
      title: "Check limits",
      description: TOOL_DESCRIPTIONS.check_limits,
      inputSchema: {
        refusal_code: z
          .enum(REFUSAL_CODES)
          .optional()
          .describe("A refusal code from another tool, to explain in plain words."),
      },
      annotations: READ_ONLY,
    },
    safely(
      "check_limits",
      ({ refusal_code }: { refusal_code?: RefusalCode | undefined }, extra: Extra) =>
        core.limits.describe(principalOf(extra.authInfo).userId, refusal_code),
    ),
  );

  server.registerTool(
    "set_rate_alert",
    {
      title: "Set a rate alert",
      description: TOOL_DESCRIPTIONS.set_rate_alert,
      inputSchema: {
        pair: z.literal("AED/INR").default("AED/INR"),
        target: z.number().describe("Rupees per dirham to alert at, e.g. 26.5."),
        direction: z
          .enum(["above", "below"])
          .default("above")
          .describe("Alert when the rate goes above or below the target."),
      },
      annotations: WRITES_STATE,
    },
    safely(
      "set_rate_alert",
      (
        { pair, target, direction }: { pair: string; target: number; direction: "above" | "below" },
        extra: Extra,
      ) => core.alerts.set(principalOf(extra.authInfo).userId, pair, target, direction),
    ),
  );

  server.registerTool(
    "get_help",
    {
      title: "Remittance help",
      description: TOOL_DESCRIPTIONS.get_help,
      inputSchema: {
        topic: z
          .enum(HELP_TOPICS)
          .default("overview")
          .describe("The closest topic to the question; overview lists them all."),
      },
      annotations: READ_ONLY,
    },
    safely("get_help", ({ topic }: { topic: HelpTopic }) => core.help(topic)),
  );

  server.registerTool(
    "get_pending",
    {
      title: "What's pending",
      description: TOOL_DESCRIPTIONS.get_pending,
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safely("get_pending", (_args: Record<string, never>, extra: Extra) =>
      core.pending.pending(principalOf(extra.authInfo).userId),
    ),
  );
}
