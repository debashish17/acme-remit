import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MCP_BEARER_TOKEN: z
    .string({ error: "is required" })
    .min(16, "must be at least 16 characters (use a long random string)"),
  BEDROCK_MODEL_ID: z.string().min(1).default("amazon.nova-2-lite-v1:0"),
  AWS_REGION: z.string().min(1).default("us-east-1"),
  RATES_URL: z.url().default("https://api.frankfurter.dev/v1"),
  DB_PATH: z.string().min(1).default("./data/acme-remit.db"),
  TICKER_MS: z.coerce.number().int().min(100).default(15000),
});

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Validates an environment object. Pure: does not read `.env` or `process.env`. */
export function parseConfig(env: Record<string, string | undefined>): Config {
  // Treat empty strings as unset so `FOO=` in .env falls back to the default.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ""));
  const result = ConfigSchema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new ConfigError(
      `Invalid configuration:\n${lines.join("\n")}\nSee .env.example for every variable.`,
    );
  }
  return result.data;
}

/** Loads `.env` (if present) into `process.env`, then validates. */
export function loadConfig(): Config {
  loadDotenv({ quiet: true });
  return parseConfig(process.env);
}
