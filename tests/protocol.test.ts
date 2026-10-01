import { readFileSync } from "node:fs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";

const TOKEN = "protocol-test-token-0123456789";
const PROTOCOL = "2025-11-25";
const app = createApp({ bearerToken: TOKEN });

/** The `description` column for a tool in the docs/SPEC.md tool contract table. */
function specDescription(tool: string): string {
  const spec = readFileSync(new URL("../docs/SPEC.md", import.meta.url), "utf8");
  const row = spec.split("\n").find((l) => l.includes(`| \`${tool}\` |`));
  const cell = row?.split("|")[3]?.trim();
  if (!cell) throw new Error(`No SPEC.md row for ${tool}`);
  return cell.replaceAll("\\_", "_");
}

function rpc(method: string, params?: unknown, id = 1) {
  return request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${TOKEN}`)
    .set("Accept", "application/json, text/event-stream")
    .set("MCP-Protocol-Version", PROTOCOL)
    .send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
}

const initParams = (protocolVersion: string) => ({
  protocolVersion,
  capabilities: {},
  clientInfo: { name: "protocol-test", version: "0.0.0" },
});

describe("initialize", () => {
  it(`negotiates ${PROTOCOL}`, async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams(PROTOCOL) });
    expect(res.status).toBe(200);
    expect(res.body.result.protocolVersion).toBe(PROTOCOL);
    expect(res.body.result.serverInfo.name).toBe("acme-remit");
    expect(res.body.result.capabilities.tools).toBeDefined();
  });

  it("is stateless: no Mcp-Session-Id is issued", async () => {
    const res = await rpc("initialize", initParams(PROTOCOL));
    expect(res.headers["mcp-session-id"]).toBeUndefined();
  });

  it(`answers an unknown client version with ${PROTOCOL}`, async () => {
    const res = await rpc("initialize", initParams("1999-01-01"));
    expect(res.body.result.protocolVersion).toBe(PROTOCOL);
  });
});

describe("tools/list", () => {
  it("returns get_rate with the SPEC description and JSON schemas", async () => {
    const res = await rpc("tools/list");
    expect(res.status).toBe(200);
    const tools = res.body.result.tools as Record<string, unknown>[];
    expect(tools.map((t) => t.name)).toEqual(["get_rate"]);
    const [tool] = tools;
    expect(tool?.description).toBe(specDescription("get_rate"));
    expect(tool?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        from: { type: "string", const: "AED", default: "AED" },
        to: { type: "string", const: "INR", default: "INR" },
      },
    });
    expect(tool?.outputSchema).toMatchObject({ type: "object" });
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });
});

describe("tools/call", () => {
  const expected = {
    corridor: "AE-IN",
    pair: "AED/INR",
    customer_rate: 23.21,
    mid_rate: 23.42,
    fx_margin_pct: 0.9,
    week_high: 23.55,
    week_low: 23.1,
    trend: "rupee weakened 0.6% this week",
    as_of: "2026-10-01T09:15:00Z",
    source: "ECB via Frankfurter, cached",
  };

  it("get_rate returns structured content and a matching text block", async () => {
    const res = await rpc("tools/call", {
      name: "get_rate",
      arguments: { from: "AED", to: "INR" },
    });
    expect(res.status).toBe(200);
    const result = res.body.result;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(expected);
    expect(JSON.parse(result.content[0].text)).toEqual(expected);
  });

  it("get_rate defaults from/to when omitted", async () => {
    const res = await rpc("tools/call", { name: "get_rate", arguments: {} });
    expect(res.body.result.structuredContent).toEqual(expected);
  });

  it("rejects an unsupported currency as a tool error, not a transport failure", async () => {
    const res = await rpc("tools/call", { name: "get_rate", arguments: { from: "USD" } });
    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBe(true);
  });
});

describe("auth and routes", () => {
  it("missing bearer returns 401 without WWW-Authenticate", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams(PROTOCOL) });
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBeUndefined();
    expect(res.body.error.code).toBe(-32001);
  });

  it("wrong bearer returns 401", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer not-the-token")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBeUndefined();
  });

  it("legacy GET /sse is not served", async () => {
    expect((await request(app).get("/sse")).status).toBe(404);
    expect((await request(app).get("/sse").set("Authorization", `Bearer ${TOKEN}`)).status).toBe(
      404,
    );
  });

  it("GET /mcp returns 405 in stateless mode", async () => {
    const res = await request(app).get("/mcp").set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("POST");
  });

  it("GET /health is open", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
