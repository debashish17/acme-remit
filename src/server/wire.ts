import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { refuse } from "../core/refusal.js";

/**
 * The edge (CLAUDE.md rule 2): core speaks integer minor units in fields ending `_minor`; tools
 * speak major units. Every `x_minor` becomes `x` divided by 100, recursively. Input amounts go
 * the other way through `aedAmount`.
 */
export function toWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toWire);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key.endsWith("_minor") && typeof v === "number") out[key.slice(0, -6)] = v / 100;
    else if (key.endsWith("_minor") && v === null) out[key.slice(0, -6)] = null;
    else out[key] = toWire(v);
  }
  return out;
}

/** Major-unit AED from the model: positive, at most 2 decimals. */
export const aedAmount = z
  .number()
  .positive()
  .max(1_000_000)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "at most 2 decimal places");

export const toMinor = (major: number) => Math.round(major * 100);

export function result(value: unknown): CallToolResult {
  const wire = toWire(value) as Record<string, unknown>;
  return { structuredContent: wire, content: [{ type: "text", text: JSON.stringify(wire) }] };
}

/**
 * CLAUDE.md rule 4: nothing thrown reaches the tool boundary. Unexpected errors become a
 * structured INTERNAL_ERROR refusal; the message is logged without arguments (they may hold tokens).
 */
export function safely<A extends unknown[]>(
  name: string,
  fn: (...args: A) => Promise<unknown> | unknown,
): (...args: A) => Promise<CallToolResult> {
  return async (...args: A) => {
    try {
      return result(await fn(...args));
    } catch (err) {
      console.error(`tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
      return {
        ...result(
          refuse(
            "INTERNAL_ERROR",
            "Something went wrong on our side and nothing was changed. Try again in a moment.",
          ),
        ),
        isError: true,
      };
    }
  };
}
