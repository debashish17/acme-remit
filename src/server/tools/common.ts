import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/** The part of the SDK's per-call `extra` the tools use. */
export interface Extra {
  authInfo?: AuthInfo | undefined;
}

export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

/** Writes a quote, token or alert row; moves no money. */
export const WRITES_STATE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

/** confirm_transfer and cancel_transfer: the only tools that move money. */
export const MOVES_MONEY: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};
