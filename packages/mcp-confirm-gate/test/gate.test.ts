import { describe, expect, it, vi } from "vitest";
import { ConfirmGate, MemoryStore, tokenPrefix, type StepUpContext } from "../src/index.js";

const ALICE = "user:alice";
const BOB = "user:bob";

function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms: number) => {
    t += ms;
  };
  return now;
}

describe("ConfirmGate without step-up", () => {
  it("a token works once, for its caller, before it expires", async () => {
    const now = clock();
    const gate = new ConfirmGate({ now });
    const { token, expiresAt } = await gate.issue("transfer:q1", ALICE);
    expect(token).toMatch(/^ct_[A-Za-z0-9_-]{43}$/);
    expect(expiresAt).toBe(now() + 5 * 60_000);
    expect(await gate.consume(token, BOB)).toEqual({ ok: false, code: "TOKEN_UNKNOWN" });
    expect(await gate.consume(token, ALICE)).toEqual({ ok: true, target: "transfer:q1" });
    expect(await gate.consume(token, ALICE)).toEqual({ ok: false, code: "TOKEN_USED" });
  });

  it("expires, honours notAfter, and refuses a token of another kind", async () => {
    const now = clock();
    const gate = new ConfirmGate({ now });
    const a = await gate.issue("t", ALICE);
    const b = await gate.issue("u", ALICE, { notAfter: now() + 1000 });
    expect(b.expiresAt).toBe(now() + 1000);
    now.advance(5 * 60_000);
    expect(await gate.consume(a.token, ALICE)).toEqual({ ok: false, code: "TOKEN_EXPIRED" });
    expect(await gate.consume(b.token, ALICE)).toEqual({ ok: false, code: "TOKEN_EXPIRED" });
    expect(await gate.consume(a.token.replace("ct_", "cx_"), ALICE)).toMatchObject({
      code: "TOKEN_UNKNOWN",
    });
  });

  it("a newer token for the same target replaces the older one", async () => {
    const gate = new ConfirmGate({ now: clock() });
    const first = await gate.issue("transfer:q1", ALICE);
    const second = await gate.issue("transfer:q1", ALICE);
    expect(await gate.consume(first.token, ALICE)).toEqual({ ok: false, code: "TOKEN_EXPIRED" });
    expect(await gate.consume(second.token, ALICE)).toMatchObject({ ok: true });
  });

  it("of two concurrent spends, exactly one wins", async () => {
    const gate = new ConfirmGate({ now: clock() });
    const { token } = await gate.issue("t", ALICE);
    const results = await Promise.all([gate.consume(token, ALICE), gate.consume(token, ALICE)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("peek checks without spending", async () => {
    const gate = new ConfirmGate({ now: clock() });
    const { token } = await gate.issue("t", ALICE);
    expect(await gate.peek(token, ALICE)).toMatchObject({ ok: true, target: "t" });
    expect(await gate.consume(token, ALICE)).toMatchObject({ ok: true });
  });

  it("stores only hashes and logs only a prefix", async () => {
    const store = new MemoryStore();
    const gate = new ConfirmGate({ store, now: clock() });
    const { token } = await gate.issue("t", ALICE);
    expect(JSON.stringify(store.dump())).not.toContain(token.slice(3));
    expect(tokenPrefix(token)).toBe(`${token.slice(0, 8)}…`);
  });
});

describe("ConfirmGate with step-up", () => {
  function stepped(now = clock()) {
    const sent: { code: string; ctx: StepUpContext }[] = [];
    const store = new MemoryStore();
    const gate = new ConfirmGate({
      store,
      now,
      stepUp: { send: vi.fn((code: string, ctx: StepUpContext) => void sent.push({ code, ctx })) },
    });
    return { gate, sent, store, now };
  }

  it("first sends a code and refuses; the code is never in the result", async () => {
    const { gate, sent } = stepped();
    const { token } = await gate.issue("transfer:q1", ALICE);
    const r = await gate.confirm(token, ALICE);
    expect(r).toMatchObject({ ok: false, code: "STEP_UP_REQUIRED", attemptsLeft: 3 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.code).toMatch(/^\d{6}$/);
    expect(sent[0]?.ctx).toMatchObject({ target: "transfer:q1", caller: ALICE });
    expect(JSON.stringify(r)).not.toContain(sent[0]?.code);
    // consume() also insists on the code when step-up is on.
    expect(await gate.consume(token, ALICE)).toMatchObject({ code: "STEP_UP_REQUIRED" });
  });

  it("the right code, as spoken with spaces, spends the token once", async () => {
    const { gate, sent } = stepped();
    const { token } = await gate.issue("t", ALICE);
    await gate.confirm(token, ALICE);
    const code = sent[0]?.code ?? "";
    expect(await gate.confirm(token, ALICE, code.split("").join(" "))).toEqual({
      ok: true,
      target: "t",
    });
    expect(await gate.confirm(token, ALICE, code)).toMatchObject({ code: "TOKEN_USED" });
  });

  it("wrong codes count down and the last one voids the token", async () => {
    const { gate, sent } = stepped();
    const { token } = await gate.issue("t", ALICE);
    await gate.confirm(token, ALICE);
    const right = sent[0]?.code ?? "";
    const wrong = right === "000000" ? "111111" : "000000";
    expect(await gate.confirm(token, ALICE, wrong)).toMatchObject({
      code: "OTP_INVALID",
      attemptsLeft: 2,
    });
    expect(await gate.confirm(token, ALICE, "12345")).toMatchObject({
      code: "OTP_INVALID",
      attemptsLeft: 1,
    });
    expect(await gate.confirm(token, ALICE, wrong)).toMatchObject({ code: "OTP_LOCKED" });
    expect(await gate.confirm(token, ALICE, right)).toMatchObject({ code: "TOKEN_EXPIRED" });
  });

  it("a code expires, never outlives its token, and a new one replaces it", async () => {
    const now = clock();
    const { gate, sent } = stepped(now);
    const { token, expiresAt } = await gate.issue("t", ALICE, { notAfter: clock()() + 60_000 });
    const first = await gate.confirm(token, ALICE);
    expect(first).toMatchObject({ expiresAt });
    await gate.confirm(token, ALICE); // a second code
    expect(await gate.confirm(token, ALICE, sent[0]?.code)).toMatchObject({ code: "OTP_INVALID" });
    now.advance(61_000);
    expect(await gate.confirm(token, ALICE, sent[1]?.code)).toMatchObject({
      code: "TOKEN_EXPIRED",
    });
  });

  it("an expired code is refused even when right", async () => {
    const now = clock();
    const sent: string[] = [];
    const gate = new ConfirmGate({
      now,
      ttlMs: 10 * 60_000,
      stepUp: { send: (c) => void sent.push(c), ttlMs: 60_000 },
    });
    const { token } = await gate.issue("t", ALICE);
    await gate.confirm(token, ALICE);
    now.advance(61_000);
    expect(await gate.confirm(token, ALICE, sent[0])).toEqual({ ok: false, code: "OTP_EXPIRED" });
  });

  it("caps the codes sent per token, and refuses a code before any was sent", async () => {
    const { gate, sent } = stepped();
    const { token } = await gate.issue("t", ALICE);
    expect(await gate.confirm(token, ALICE, "123456")).toMatchObject({ code: "OTP_INVALID" });
    for (let i = 0; i < 3; i++) await gate.confirm(token, ALICE);
    expect(await gate.confirm(token, ALICE)).toEqual({ ok: false, code: "OTP_LOCKED" });
    expect(sent).toHaveLength(3);
  });

  it("never stores a code in the clear", async () => {
    const { gate, sent, store } = stepped();
    const { token } = await gate.issue("t", ALICE);
    await gate.confirm(token, ALICE);
    expect(JSON.stringify(store.dump())).not.toContain(sent[0]?.code);
  });
});
