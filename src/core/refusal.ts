import type { Refusal, RefusalCode } from "./types.js";

export function refuse(
  code: RefusalCode,
  resolution: string,
  fields: Record<string, unknown> = {},
): Refusal {
  return { refused: { code, ...fields, resolution } };
}

export function isRefusal(value: unknown): value is Refusal {
  return typeof value === "object" && value !== null && "refused" in value;
}
