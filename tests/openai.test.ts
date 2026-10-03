import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ConverseCommandInput } from "@aws-sdk/client-bedrock-runtime";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCore, type Core } from "../src/core/index.js";
import { createApp } from "../src/server/app.js";
import { ChatService } from "../src/server/sim/chat.js";
import { DailyBudget } from "../src/server/sim/guards.js";
import {
  fromChatResponse,
  openAiCompatibleConverse,
  toChatMessages,
} from "../src/server/sim/openai.js";
import { McpRelay } from "../src/server/sim/relay.js";
import { liveFetch, seededDb, silentLogger, TEST_BEARER, testClock } from "./helpers.js";

describe("Converse <-> chat completions translation", () => {
  it("maps system, user text, tool uses and tool results", () => {
    const input = {
      modelId: "ignored",
      system: [{ text: "Be brief." }],
      messages: [
        { role: "user", content: [{ text: "What's the rupee at?" }] },
        {
          role: "assistant",
          content: [{ toolUse: { toolUseId: "call_1", name: "get_rate", input: { to: "INR" } } }],
        },
        {
          role: "user",
          content: [
            {
              toolResult: {
                toolUseId: "call_1",
                content: [{ json: { mid_rate: 26.23 } }],
                status: "success",
              },
            },
          ],
        },
      ],
    } as unknown as ConverseCommandInput;
    expect(toChatMessages(input)).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "What's the rupee at?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "get_rate", arguments: '{"to":"INR"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: '{"mid_rate":26.23}' },
    ]);
  });

  it("maps a tool call response to tool_use, and text to end_turn", () => {
    const withTool = fromChatResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: "c1", function: { name: "get_rate", arguments: "{}" } }],
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 5 },
    });
    expect(withTool.stopReason).toBe("tool_use");
    expect(
      withTool.output && "message" in withTool.output && withTool.output.message?.content,
    ).toEqual([{ toolUse: { toolUseId: "c1", name: "get_rate", input: {} } }]);
    expect(withTool.usage).toMatchObject({ inputTokens: 100, outputTokens: 5 });
    const text = fromChatResponse({ choices: [{ message: { content: "Hello" } }] });
    expect(text.stopReason).toBe("end_turn");
  });
});

describe("ChatService on an OpenAI-compatible endpoint", () => {
  let server: Server | undefined;
  let core: Core | undefined;
  afterEach(() => {
    server?.close();
    core?.db.close();
  });

  async function rig(fetchFn: typeof fetch) {
    core = createCore({
      db: seededDb(),
      ratesUrl: "https://rates.test/v1",
      fetch: liveFetch(),
      now: testClock(),
      logger: silentLogger,
    });
    let port = 0;
    const relay = new McpRelay({ url: () => `http://127.0.0.1:${port}/mcp`, bearer: TEST_BEARER });
    const budget = new DailyBudget(100);
    const chat = new ChatService({
      relay,
      converse: openAiCompatibleConverse({
        baseUrl: "https://llm.test/v1/",
        apiKey: "sk-test-secret",
        model: "test-model-1",
        fetch: fetchFn,
      }),
      modelId: "test-model-1",
      systemPrompt: "You are a test.",
      budget,
    });
    const app = createApp({
      bearerToken: TEST_BEARER,
      core,
      sim: {
        chat,
        relay,
        budget,
        accessCode: "code-123",
        reseed: () => undefined,
        mode: "bedrock",
      },
    });
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    port = (server.address() as AddressInfo).port;
    return app;
  }

  it("runs the tool loop: the model's tool call goes through POST /mcp, its answer comes back", async () => {
    const seen: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
    const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body });
      const messages = body.messages as { role: string; content: string | null }[];
      const toolTurn = messages.find((m) => m.role === "tool");
      const reply = toolTurn
        ? { content: `The rate is ${JSON.parse(toolTurn.content ?? "{}").customer_rate}.` }
        : {
            content: null,
            tool_calls: [{ id: "c1", function: { name: "get_rate", arguments: "{}" } }],
          };
      return new Response(
        JSON.stringify({
          choices: [{ message: reply }],
          usage: { prompt_tokens: 50, completion_tokens: 8 },
        }),
      );
    });
    const app = await rig(fake as unknown as typeof fetch);
    const res = await request(app)
      .post("/sim/chat")
      .set("x-sim-code", "code-123")
      .send({ text: "rate?" });
    expect(res.body.reply).toBe("The rate is 25.994.");
    expect(res.body.model).toBe("test-model-1");
    expect(res.body.tool_calls).toEqual([expect.objectContaining({ name: "get_rate" })]);
    expect(res.body.exchanges.map((x: { method: string }) => x.method)).toContain("tools/call");
    expect(seen[0]?.url).toBe("https://llm.test/v1/chat/completions");
    expect(seen[0]?.auth).toBe("Bearer sk-test-secret");
    expect(seen[0]?.body).toMatchObject({ model: "test-model-1", tool_choice: "auto" });
    expect((seen[0]?.body.tools as unknown[]).length).toBe(14);
  });

  it("reports a provider error without leaking the key", async () => {
    const app = await rig(
      (async () =>
        new Response("bad key sk-test-secret", { status: 401 })) as unknown as typeof fetch,
    );
    const res = await request(app)
      .post("/sim/chat")
      .set("x-sim-code", "code-123")
      .send({ text: "hi" });
    expect(res.body.error).toEqual({
      code: "LlmProviderError",
      message: "The model endpoint answered HTTP 401.",
    });
    expect(JSON.stringify(res.body)).not.toContain("sk-test-secret");
  });
});
