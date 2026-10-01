/**
 * The simulator's MCP client: real JSON-RPC over HTTP to this server's own POST /mcp, exactly as
 * Alexa+ would call it (SPEC "Simulated Alexa+ client"). Every request and response is recorded
 * for the protocol panel. Tokens are cut to a prefix in what the page sees; the model gets the
 * full result, or it could not confirm.
 */

export interface Exchange {
  id: number;
  method: string;
  at: string;
  ms: number;
  status: number;
  request: unknown;
  response: unknown;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolOutcome {
  structured: Record<string, unknown>;
  isError: boolean;
}

export interface RelayOptions {
  url: string | (() => string);
  bearer: string;
  protocolVersion?: string;
  fetch?: typeof fetch;
}

const TOKEN = /\b(c[tx]_)([A-Za-z0-9_-]{5})[A-Za-z0-9_-]{20,}/g;

/** Replaces every confirmation or cancel token with its prefix, e.g. "ct_9b2eQ…". */
export function redactTokens<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replace(TOKEN, "$1$2…")) as T;
}

export class McpRelay {
  private nextId = 1;
  private tools: McpTool[] | undefined;
  private negotiated: string | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly version: string;

  constructor(private readonly opts: RelayOptions) {
    this.fetchFn = opts.fetch ?? fetch;
    this.version = opts.protocolVersion ?? "2025-11-25";
  }

  get protocolVersion(): string | undefined {
    return this.negotiated;
  }

  /** initialize then tools/list, once; later calls return the cached list. */
  async listTools(log: Exchange[]): Promise<McpTool[]> {
    if (this.tools) return this.tools;
    const init = (await this.rpc(
      "initialize",
      {
        protocolVersion: this.version,
        capabilities: {},
        clientInfo: { name: "acme-remit-simulator", version: "1.0.0" },
      },
      log,
    )) as { protocolVersion?: string };
    this.negotiated = init.protocolVersion;
    const list = (await this.rpc("tools/list", {}, log)) as { tools?: McpTool[] };
    this.tools = list.tools ?? [];
    return this.tools;
  }

  async callTool(name: string, args: unknown, log: Exchange[]): Promise<ToolOutcome> {
    const result = (await this.rpc("tools/call", { name, arguments: args }, log)) as {
      structuredContent?: Record<string, unknown>;
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    const text = result.content?.find((c) => c.type === "text")?.text;
    return {
      structured: result.structuredContent ?? { text: text ?? "" },
      isError: result.isError === true,
    };
  }

  /** Forget cached tools (after a reset or redeploy). */
  reset(): void {
    this.tools = undefined;
  }

  private async rpc(method: string, params: unknown, log: Exchange[]): Promise<unknown> {
    const body = { jsonrpc: "2.0", id: this.nextId++, method, params };
    const url = typeof this.opts.url === "function" ? this.opts.url() : this.opts.url;
    const started = performance.now();
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.opts.bearer}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": this.version,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      result?: unknown;
      error?: { code: number; message: string };
    };
    log.push({
      id: body.id,
      method,
      at: new Date().toISOString(),
      ms: Math.round((performance.now() - started) * 10) / 10,
      status: res.status,
      request: redactTokens(body),
      response: redactTokens(json),
    });
    if (!res.ok || json.error) {
      throw new Error(`MCP ${method} failed: ${json.error?.message ?? `HTTP ${res.status}`}`);
    }
    return json.result;
  }
}
