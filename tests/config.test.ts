import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../src/config.js";

const TOKEN = "test-token-0123456789abcdef";

describe("parseConfig", () => {
  it("applies defaults when only the bearer token is set", () => {
    const cfg = parseConfig({ MCP_BEARER_TOKEN: TOKEN });
    expect(cfg).toEqual({
      PORT: 3000,
      MCP_BEARER_TOKEN: TOKEN,
      BEDROCK_MODEL_ID: "amazon.nova-2-lite-v1:0",
      AWS_REGION: "us-east-1",
      RATES_URL: "https://api.frankfurter.app",
      DB_PATH: "./data/acme-remit.db",
      TICKER_MS: 15000,
    });
  });

  it("coerces numeric variables", () => {
    const cfg = parseConfig({ MCP_BEARER_TOKEN: TOKEN, PORT: "8080", TICKER_MS: "500" });
    expect(cfg.PORT).toBe(8080);
    expect(cfg.TICKER_MS).toBe(500);
  });

  it("fails fast when the bearer token is missing", () => {
    expect(() => parseConfig({})).toThrow(ConfigError);
    expect(() => parseConfig({})).toThrow(/MCP_BEARER_TOKEN: is required/);
  });

  it("lists every invalid variable and never echoes the token", () => {
    const short = "short-secret";
    let message = "";
    try {
      parseConfig({ MCP_BEARER_TOKEN: short, PORT: "abc", RATES_URL: "not a url" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/MCP_BEARER_TOKEN/);
    expect(message).toMatch(/PORT/);
    expect(message).toMatch(/RATES_URL/);
    expect(message).not.toContain(short);
  });

  it("treats empty strings as unset", () => {
    expect(parseConfig({ MCP_BEARER_TOKEN: TOKEN, PORT: "" }).PORT).toBe(3000);
  });
});
