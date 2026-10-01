import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RecipientWithLastSent } from "../../core/beneficiaries.js";
import type { Core } from "../../core/index.js";
import type { Recipient } from "../../core/types.js";
import { principalOf } from "../auth.js";
import { safely } from "../wire.js";
import { READ_ONLY, type Extra } from "./common.js";
import { TOOL_DESCRIPTIONS } from "./descriptions.js";

function listed(r: RecipientWithLastSent) {
  return {
    id: r.id,
    nickname: r.nickname,
    full_name: r.fullName,
    relationship: r.relationship,
    payout_method: r.payoutMethod,
    bank: r.bankName,
    account_last4: r.accountLast4,
    upi_id: r.upiId,
    city: r.city,
    name_verified: r.nameVerified,
    default_purpose: r.defaultPurpose,
    last_sent: r.lastSent,
  };
}

const match = (r: Recipient) => ({
  id: r.id,
  nickname: r.nickname,
  full_name: r.fullName,
  relationship: r.relationship,
  payout_method: r.payoutMethod,
});

const candidate = (r: Recipient) => ({
  id: r.id,
  nickname: r.nickname,
  full_name: r.fullName,
  relationship: r.relationship,
});

export function registerRecipientTools(server: McpServer, core: Core): void {
  server.registerTool(
    "list_beneficiaries",
    {
      title: "List saved recipients",
      description: TOOL_DESCRIPTIONS.list_beneficiaries,
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safely("list_beneficiaries", (_args: object, extra: Extra) => {
      const { userId } = principalOf(extra.authInfo);
      return { recipients: core.beneficiaries.list(userId).map(listed) };
    }),
  );

  server.registerTool(
    "resolve_beneficiary",
    {
      title: "Find a saved recipient",
      description: TOOL_DESCRIPTIONS.resolve_beneficiary,
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(100)
          .describe('The name or nickname the user said, e.g. "Mum" or "my brother".'),
      },
      annotations: READ_ONLY,
    },
    safely("resolve_beneficiary", ({ query }: { query: string }, extra: Extra) => {
      const r = core.beneficiaries.resolve(principalOf(extra.authInfo).userId, query);
      if ("match" in r) return { match: match(r.match) };
      if ("ambiguous" in r) return { ambiguous: true, candidates: r.candidates.map(candidate) };
      return { not_found: true, hint: r.hint };
    }),
  );
}
