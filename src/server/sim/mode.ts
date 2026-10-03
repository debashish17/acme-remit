import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

/**
 * Which simulator mode to run, decided once at startup and logged. A clean clone with no AWS
 * account and no API key must still run the whole demo, so the default is scripted unless a
 * language model is actually usable.
 */

export type SimMode = "scripted" | "bedrock";

export interface ModeInput {
  SIM_MODE?: SimMode | undefined;
  LLM_PROVIDER: "bedrock" | "openai_compatible";
  LLM_API_KEY?: string | undefined;
}

export interface ModeDecision {
  mode: SimMode;
  /** Why, in words for the startup log. */
  reason: string;
}

/**
 * SIM_MODE wins when set. Otherwise: an OpenAI-compatible provider is live when it has a key;
 * Bedrock is live when AWS credentials resolve. "bedrock" means the live model path through
 * LLM_PROVIDER (Bedrock by default).
 */
export function decideMode(cfg: ModeInput, awsCredentials: boolean): ModeDecision {
  if (cfg.SIM_MODE) return { mode: cfg.SIM_MODE, reason: "set by SIM_MODE" };
  if (cfg.LLM_PROVIDER === "openai_compatible") {
    return cfg.LLM_API_KEY
      ? { mode: "bedrock", reason: "LLM_PROVIDER=openai_compatible with LLM_API_KEY set" }
      : { mode: "scripted", reason: "LLM_PROVIDER=openai_compatible but LLM_API_KEY is not set" };
  }
  return awsCredentials
    ? { mode: "bedrock", reason: "AWS credentials found" }
    : { mode: "scripted", reason: "no AWS credentials found" };
}

/**
 * Whether the AWS SDK's default credential chain resolves (environment, profile, SSO, container
 * or instance role). No AWS request is made. Gives up after `timeoutMs` (the instance-metadata
 * probe can take a second on a laptop).
 */
export async function hasAwsCredentials(region: string, timeoutMs = 3000): Promise<boolean> {
  const client = new BedrockRuntimeClient({ region });
  try {
    const creds = await Promise.race([
      client.config.credentials(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), timeoutMs).unref(),
      ),
    ]);
    return Boolean(creds?.accessKeyId);
  } catch {
    return false;
  } finally {
    client.destroy();
  }
}
