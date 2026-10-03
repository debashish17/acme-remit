import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCore, type Core } from "../src/core/index.js";
import { createApp } from "../src/server/app.js";
import { ChatService } from "../src/server/sim/chat.js";
import { DailyBudget } from "../src/server/sim/guards.js";
import { McpRelay } from "../src/server/sim/relay.js";
import { byteToIndex, parseMarks, TtsService, type Synthesize } from "../src/server/sim/tts.js";
import { liveFetch, seededDb, silentLogger, TEST_BEARER, testClock } from "./helpers.js";

/** Speech marks as Polly returns them: JSON lines with UTF-8 byte offsets. */
function marksFor(text: string): string {
  const enc = new TextEncoder();
  return [...text.matchAll(/\S+/g)]
    .map((m, i) => {
      const start = enc.encode(text.slice(0, m.index)).length;
      const end = start + enc.encode(m[0]).length;
      return JSON.stringify({ time: i * 300, type: "word", start, end, value: m[0] });
    })
    .join("\n");
}
const fakePolly = () =>
  vi.fn<Synthesize>(async (text) => ({
    audio: new TextEncoder().encode(`mp3:${text}`),
    marks: marksFor(text),
  }));

describe("speech marks", () => {
  it("maps UTF-8 byte offsets to string indexes, past multi-byte characters", () => {
    const text = "Mum receives ₹51,598 — guaranteed 👍 today";
    const at = byteToIndex(text);
    const enc = new TextEncoder();
    for (const word of ["receives", "₹51,598", "guaranteed", "👍", "today"]) {
      const i = text.indexOf(word);
      expect(at(enc.encode(text.slice(0, i)).length), word).toBe(i);
    }
  });

  it("parses Polly's word marks into times and string positions", () => {
    const text = "Send ₹500 now";
    expect(parseMarks(text, marksFor(text))).toEqual([
      { time: 0, start: 0, end: 4, value: "Send" },
      { time: 300, start: 5, end: 9, value: "₹500" },
      { time: 600, start: 10, end: 13, value: "now" },
    ]);
  });
});

describe("TtsService", () => {
  it("returns base64 audio with marks, and serves a repeated line from the cache", async () => {
    const polly = fakePolly();
    const tts = new TtsService({
      synthesize: polly,
      voice: "Kajal",
      engine: "neural",
      dailyChars: 1000,
    });
    const a = await tts.speak("Shall I go ahead?");
    expect(a).toMatchObject({ voice: "Kajal", engine: "neural" });
    expect(Buffer.from(a?.audio ?? "", "base64").toString()).toBe("mp3:Shall I go ahead?");
    expect(a?.marks.map((m) => m.value)).toEqual(["Shall", "I", "go", "ahead?"]);
    await tts.speak("Shall I go ahead?");
    expect(polly).toHaveBeenCalledTimes(1);
    expect(tts.charsLeftToday).toBe(1000 - 17 * 2);
  });

  it("stops at the daily character cap, counting audio and marks, and resets the next day", async () => {
    let now = new Date("2026-10-03T10:00:00Z");
    const tts = new TtsService({
      synthesize: fakePolly(),
      voice: "Kajal",
      engine: "neural",
      dailyChars: 50,
      now: () => now,
    });
    expect(await tts.speak("x".repeat(20))).not.toBeNull(); // bills 40
    expect(await tts.speak("y".repeat(10))).toBeNull(); // would bill 60 in all
    now = new Date("2026-10-04T00:00:01Z");
    expect(await tts.speak("y".repeat(10))).not.toBeNull();
  });
});

describe("POST /sim/speak", () => {
  let core: Core | undefined;
  afterEach(() => core?.db.close());

  function app(tts?: TtsService) {
    core = createCore({
      db: seededDb(),
      ratesUrl: "https://rates.test/v1",
      fetch: liveFetch(),
      now: testClock(),
      logger: silentLogger,
    });
    const relay = new McpRelay({ url: "http://127.0.0.1:1/mcp", bearer: TEST_BEARER });
    const budget = new DailyBudget(10);
    const chat = new ChatService({
      relay,
      converse: async () => {
        throw new Error("not used");
      },
      modelId: "test-model",
      systemPrompt: "",
      budget,
    });
    return createApp({
      bearerToken: TEST_BEARER,
      core,
      sim: { chat, relay, budget, accessCode: "code-123", reseed: () => undefined, tts },
    });
  }
  const speak = (a: ReturnType<typeof app>, text: string) =>
    request(a).post("/sim/speak").set("x-sim-code", "code-123").send({ text });

  it("speaks with Polly, behind the access code", async () => {
    const a = app(
      new TtsService({
        synthesize: fakePolly(),
        voice: "Kajal",
        engine: "neural",
        dailyChars: 1000,
      }),
    );
    const res = await speak(a, "Hello Priya");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      voice: "Kajal",
      marks: [{ value: "Hello" }, { value: "Priya" }],
    });
    expect((await request(a).post("/sim/speak").send({ text: "hi" })).status).toBe(401);
  });

  it("tells the page to use the browser's voice when Polly is off, over budget or failing", async () => {
    expect((await speak(app(), "Hello")).status).toBe(503);

    const tight = app(
      new TtsService({ synthesize: fakePolly(), voice: "Kajal", engine: "neural", dailyChars: 4 }),
    );
    expect((await speak(tight, "Hello")).body).toMatchObject({ error: "tts_budget" });

    const broken = app(
      new TtsService({
        synthesize: async () => {
          throw new Error("ThrottlingException");
        },
        voice: "Kajal",
        engine: "neural",
        dailyChars: 1000,
      }),
    );
    const res = await speak(broken, "Hello");
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "tts_failed", message: "The voice service is unavailable." });
  });

  it("rejects an empty or oversized line", async () => {
    const a = app(
      new TtsService({
        synthesize: fakePolly(),
        voice: "Kajal",
        engine: "neural",
        dailyChars: 9999,
      }),
    );
    expect((await speak(a, "")).status).toBe(400);
    expect((await speak(a, "x".repeat(1501))).status).toBe(400);
  });
});
