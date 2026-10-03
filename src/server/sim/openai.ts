import type {
  ContentBlock,
  ConverseCommandInput,
  ConverseCommandOutput,
  Message,
} from "@aws-sdk/client-bedrock-runtime";
import type { ConverseFn } from "./chat.js";

/**
 * LLM_PROVIDER=openai_compatible: the simulator's tool loop against any OpenAI-compatible
 * /chat/completions endpoint (OpenAI, OpenRouter, Groq, a local Ollama, ...). ChatService speaks
 * Bedrock Converse shapes; this adapter translates the request and the response, so the loop, the
 * consent guard and the relay to /mcp stay exactly the same. Plain fetch: no extra dependency.
 */

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface OpenAiResponse {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class LlmProviderError extends Error {
  override name = "LlmProviderError";
}

/** Converse messages -> chat messages: tool uses become tool_calls, tool results become "tool" turns. */
export function toChatMessages(input: ConverseCommandInput): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  const system = (input.system ?? []).flatMap((b) => ("text" in b && b.text ? [b.text] : []));
  if (system.length) out.push({ role: "system", content: system.join("\n") });
  for (const m of input.messages ?? ([] as Message[])) {
    const blocks: ContentBlock[] = m.content ?? [];
    const text = blocks.flatMap((b) => (b.text ? [b.text] : [])).join("\n");
    if (m.role === "assistant") {
      const uses = blocks.flatMap((b) => (b.toolUse ? [b.toolUse] : []));
      out.push({
        role: "assistant",
        content: text || null,
        ...(uses.length
          ? {
              tool_calls: uses.map((u) => ({
                id: u.toolUseId ?? "",
                type: "function" as const,
                function: { name: u.name ?? "", arguments: JSON.stringify(u.input ?? {}) },
              })),
            }
          : {}),
      });
      continue;
    }
    for (const b of blocks) {
      if (!b.toolResult) continue;
      const parts = (b.toolResult.content ?? []).map((c) =>
        c.json !== undefined ? JSON.stringify(c.json) : (c.text ?? ""),
      );
      out.push({
        role: "tool",
        tool_call_id: b.toolResult.toolUseId ?? "",
        content: parts.join("\n"),
      });
    }
    if (text) out.push({ role: "user", content: text });
  }
  return out;
}

/** The chat completion -> a Converse output the tool loop understands. */
export function fromChatResponse(res: OpenAiResponse): ConverseCommandOutput {
  const msg = res.choices?.[0]?.message;
  const content: ContentBlock[] = [];
  if (msg?.content) content.push({ text: msg.content });
  for (const call of msg?.tool_calls ?? []) {
    let input: unknown;
    try {
      input = JSON.parse(call.function?.arguments || "{}");
    } catch {
      input = {}; // the tool's own input validation answers a malformed call
    }
    content.push({
      toolUse: { toolUseId: call.id, name: call.function?.name ?? "", input: input as never },
    });
  }
  const usesTools = content.some((b) => b.toolUse);
  return {
    output: { message: { role: "assistant", content } },
    stopReason: usesTools ? "tool_use" : "end_turn",
    usage: {
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
      totalTokens: (res.usage?.prompt_tokens ?? 0) + (res.usage?.completion_tokens ?? 0),
    },
    metrics: { latencyMs: 0 },
    $metadata: {},
  } as ConverseCommandOutput;
}

export function openAiCompatibleConverse(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): ConverseFn {
  const fetchFn = opts.fetch ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return async (input) => {
    const tools = (input.toolConfig?.tools ?? []).flatMap((t) =>
      t.toolSpec
        ? [
            {
              type: "function" as const,
              function: {
                name: t.toolSpec.name,
                description: t.toolSpec.description,
                parameters: t.toolSpec.inputSchema?.json ?? { type: "object", properties: {} },
              },
            },
          ]
        : [],
    );
    const res = await fetchFn(url, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        messages: toChatMessages(input),
        ...(tools.length ? { tools, tool_choice: "auto" } : {}),
        max_tokens: input.inferenceConfig?.maxTokens,
        temperature: input.inferenceConfig?.temperature,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
    if (!res.ok) {
      // The status only: provider error bodies can echo request details.
      throw new LlmProviderError(`The model endpoint answered HTTP ${res.status}.`);
    }
    return fromChatResponse((await res.json()) as OpenAiResponse);
  };
}
