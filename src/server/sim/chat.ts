import { randomUUID } from "node:crypto";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ConverseCommandInput,
  type ConverseCommandOutput,
  type Message,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";
import type { DailyBudget } from "./guards.js";
import type { Exchange, McpRelay, McpTool } from "./relay.js";

/**
 * POST /sim/chat: the Bedrock Converse tool-use loop. Conversations live here, server-side and in
 * memory (tool calls included), so the page sends only the new turn. Each tool call is a real
 * round trip through McpRelay.
 */

export type ConverseFn = (input: ConverseCommandInput) => Promise<ConverseCommandOutput>;

export function bedrockConverse(region: string): ConverseFn {
  const client = new BedrockRuntimeClient({ region, maxAttempts: 2 });
  return (input) => client.send(new ConverseCommand(input));
}

export interface ChatOptions {
  relay: McpRelay;
  converse: ConverseFn;
  modelId: string;
  systemPrompt: string;
  budget: DailyBudget;
  maxToolRounds?: number;
  maxTokens?: number;
  ttlMs?: number;
  maxConversations?: number;
  maxMessages?: number;
  now?: () => number;
}

export interface ToolCallSummary {
  name: string;
  ms: number;
  refused?: string;
  error?: boolean;
}

export interface ChatReply {
  conversation_id: string;
  reply: string;
  tool_calls: ToolCallSummary[];
  exchanges: Exchange[];
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  error?: { code: string; message: string };
}

interface Conversation {
  messages: Message[];
  updatedAt: number;
}

const MSG = {
  budget: "The demo has used today's assistant allowance. Please try again tomorrow.",
  unavailable: "Sorry, the assistant is unavailable right now. Please try again in a moment.",
  rounds: "Sorry, I couldn't finish that. Could you say it again, a bit more simply?",
};

/** Bedrock tool specs from the MCP tools/list result. */
export function toBedrockTools(tools: McpTool[]): Tool[] {
  return tools.map((t) => {
    // Bedrock wants the bare JSON Schema object, without the draft marker.
    const schema: Record<string, unknown> = { ...t.inputSchema };
    delete schema.$schema;
    return {
      toolSpec: {
        name: t.name,
        description: t.description ?? t.name,
        inputSchema: { json: schema as Record<string, never> },
      },
    };
  });
}

export class ChatService {
  private readonly conversations = new Map<string, Conversation>();
  private readonly maxToolRounds: number;
  private readonly maxTokens: number;
  private readonly ttlMs: number;
  private readonly maxConversations: number;
  private readonly maxMessages: number;
  private readonly now: () => number;

  constructor(private readonly opts: ChatOptions) {
    this.maxToolRounds = opts.maxToolRounds ?? 6;
    this.maxTokens = opts.maxTokens ?? 600;
    this.ttlMs = opts.ttlMs ?? 30 * 60_000;
    this.maxConversations = opts.maxConversations ?? 200;
    this.maxMessages = opts.maxMessages ?? 40;
    this.now = opts.now ?? Date.now;
  }

  clear(): void {
    this.conversations.clear();
  }

  async send(conversationId: string | undefined, text: string): Promise<ChatReply> {
    this.expire();
    const id =
      conversationId && this.conversations.has(conversationId) ? conversationId : randomUUID();
    const convo = this.conversations.get(id) ?? { messages: [], updatedAt: this.now() };
    this.conversations.set(id, convo);
    const turnStart = convo.messages.length;
    convo.messages.push({ role: "user", content: [{ text }] });
    // An aborted turn is dropped whole, so the stored history keeps alternating user/assistant.
    const abort = (r: string, error: NonNullable<ChatReply["error"]>) => {
      convo.messages.length = turnStart;
      return reply(r, error);
    };

    const exchanges: Exchange[] = [];
    const toolCalls: ToolCallSummary[] = [];
    const usage = { input_tokens: 0, output_tokens: 0 };
    const reply = (r: string, error?: ChatReply["error"]): ChatReply => {
      convo.updatedAt = this.now();
      this.trim(convo);
      return {
        conversation_id: id,
        reply: r,
        tool_calls: toolCalls,
        exchanges,
        model: this.opts.modelId,
        usage,
        ...(error ? { error } : {}),
      };
    };

    let tools: Tool[];
    try {
      tools = toBedrockTools(await this.opts.relay.listTools(exchanges));
    } catch (err) {
      console.error(`sim: tools/list failed: ${errMessage(err)}`);
      return abort(MSG.unavailable, { code: "MCP_UNAVAILABLE", message: errMessage(err) });
    }

    for (let round = 0; round < this.maxToolRounds; round++) {
      if (!this.opts.budget.take()) {
        return abort(MSG.budget, {
          code: "DAILY_BUDGET",
          message: "Daily Bedrock call limit reached.",
        });
      }
      let out: ConverseCommandOutput;
      try {
        out = await this.opts.converse({
          modelId: this.opts.modelId,
          system: [{ text: this.opts.systemPrompt }],
          messages: convo.messages,
          toolConfig: { tools },
          inferenceConfig: { maxTokens: this.maxTokens, temperature: 0.2 },
        });
      } catch (err) {
        const code = err instanceof Error ? err.name : "BedrockError";
        console.error(`sim: Bedrock ${code}: ${errMessage(err)}`);
        return abort(MSG.unavailable, { code, message: errMessage(err) });
      }
      usage.input_tokens += out.usage?.inputTokens ?? 0;
      usage.output_tokens += out.usage?.outputTokens ?? 0;

      const message = out.output && "message" in out.output ? out.output.message : undefined;
      const content: ContentBlock[] = message?.content ?? [];
      convo.messages.push({ role: "assistant", content });

      const uses = content.flatMap((b) => (b.toolUse ? [b.toolUse] : []));
      if (out.stopReason !== "tool_use" || uses.length === 0) {
        const textOut = content
          .flatMap((b) => (b.text ? [b.text] : []))
          .join(" ")
          .trim();
        return reply(textOut || MSG.rounds);
      }

      const results: ContentBlock[] = [];
      for (const use of uses) {
        const before = exchanges.length;
        try {
          const outcome = await this.opts.relay.callTool(
            use.name ?? "",
            use.input ?? {},
            exchanges,
          );
          const refused = (outcome.structured.refused as { code?: string } | undefined)?.code;
          toolCalls.push({
            name: use.name ?? "",
            ms: exchanges.slice(before).reduce((sum, e) => sum + e.ms, 0),
            ...(refused ? { refused } : {}),
            ...(outcome.isError ? { error: true } : {}),
          });
          results.push({
            toolResult: {
              toolUseId: use.toolUseId,
              content: [{ json: outcome.structured as Record<string, never> }],
              status: outcome.isError ? "error" : "success",
            },
          });
        } catch (err) {
          toolCalls.push({ name: use.name ?? "", ms: 0, error: true });
          results.push({
            toolResult: {
              toolUseId: use.toolUseId,
              content: [{ text: `The tool could not be reached: ${errMessage(err)}` }],
              status: "error",
            },
          });
        }
      }
      convo.messages.push({ role: "user", content: results });
    }
    return abort(MSG.rounds, {
      code: "TOOL_ROUNDS",
      message: `Stopped after ${this.maxToolRounds} tool rounds.`,
    });
  }

  /** Keeps the last maxMessages, cutting only before a user text turn so tool pairs stay whole. */
  private trim(convo: Conversation): void {
    if (convo.messages.length <= this.maxMessages) return;
    let start = convo.messages.length - this.maxMessages;
    while (start < convo.messages.length) {
      const m = convo.messages[start];
      if (m?.role === "user" && m.content?.some((b) => b.text !== undefined)) break;
      start++;
    }
    convo.messages.splice(0, start);
  }

  private expire(): void {
    const t = this.now();
    for (const [id, c] of this.conversations) {
      if (t - c.updatedAt > this.ttlMs) this.conversations.delete(id);
    }
    while (this.conversations.size >= this.maxConversations) {
      const oldest = this.conversations.keys().next().value;
      if (oldest === undefined) break;
      this.conversations.delete(oldest);
    }
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
