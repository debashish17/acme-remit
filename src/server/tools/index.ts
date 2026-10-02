import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Core } from "../../core/index.js";
import { registerAccountTools } from "./account.js";
import { registerRateTools } from "./rates.js";
import { registerRecipientTools } from "./recipients.js";
import { registerTransferTools } from "./transfers.js";

/** The thirteen tools of the SPEC contract, in contract order. */
export function registerTools(server: McpServer, core: Core): void {
  registerRateTools(server, core); // get_rate, compare_options
  registerRecipientTools(server, core); // list_beneficiaries, resolve_beneficiary
  registerTransferTools(server, core); // quote, prepare, confirm, track, cancel, history
  registerAccountTools(server, core); // check_limits, set_rate_alert, get_help
}
