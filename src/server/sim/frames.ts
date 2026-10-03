import { randomBytes } from "node:crypto";

/**
 * Frames for MCP Apps views in the simulator (SPEC "MCP Apps view"). The page can't use srcdoc or
 * a blob: URL for the iframe, because those inherit the page's own CSP (no inline script), so the
 * HTML the relay read with resources/read is parked here under a random id and served once, within
 * a minute, with the CSP the host builds from the resource's `_meta.ui.csp`. The id is the only
 * credential: the iframe's navigation can't carry the x-sim-code header.
 */

export interface ResourceCsp {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
}

interface Frame {
  html: string;
  csp: string;
  expiresAt: number;
}

/** Only https origins (or http on localhost) may be added to a view's CSP. */
const ORIGIN = /^(https:\/\/[a-z0-9.-]+(:\d+)?|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/i;

const origins = (list: unknown): string[] =>
  Array.isArray(list)
    ? list.filter((d): d is string => typeof d === "string" && ORIGIN.test(d)).slice(0, 20)
    : [];

/**
 * The view's CSP, per the MCP Apps spec: nothing from the network unless the resource declares
 * the domain. Inline script and style are the view itself. Only this server's pages may frame it.
 */
export function viewCsp(declared: unknown): string {
  const d = (typeof declared === "object" && declared !== null ? declared : {}) as ResourceCsp;
  const res = origins(d.resourceDomains);
  const connect = origins(d.connectDomains);
  const frames = origins(d.frameDomains);
  const base = origins(d.baseUriDomains);
  const list = (xs: string[], none = "'none'") => (xs.length ? xs.join(" ") : none);
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${res.join(" ")}`.trim(),
    `style-src 'unsafe-inline' ${res.join(" ")}`.trim(),
    `img-src data: ${res.join(" ")}`.trim(),
    `font-src data: ${res.join(" ")}`.trim(),
    `media-src data: ${res.join(" ")}`.trim(),
    `connect-src ${list(connect)}`,
    `frame-src ${list(frames)}`,
    `base-uri ${list(base)}`,
    "form-action 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
}

export class FrameStore {
  private readonly frames = new Map<string, Frame>();

  constructor(
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now,
    private readonly max = 50,
  ) {}

  /** Parks a view's HTML; returns the id for /sim/app-frame/:id. */
  put(html: string, csp: string): string {
    this.sweep();
    while (this.frames.size >= this.max) {
      const oldest = this.frames.keys().next().value;
      if (oldest === undefined) break;
      this.frames.delete(oldest);
    }
    const id = randomBytes(18).toString("base64url");
    this.frames.set(id, { html, csp, expiresAt: this.now() + this.ttlMs });
    return id;
  }

  /** The frame, once: a second request for the same id finds nothing. */
  take(id: string): { html: string; csp: string } | undefined {
    const frame = this.frames.get(id);
    this.frames.delete(id);
    if (!frame || frame.expiresAt <= this.now()) return undefined;
    return { html: frame.html, csp: frame.csp };
  }

  private sweep(): void {
    for (const [id, f] of this.frames) if (f.expiresAt <= this.now()) this.frames.delete(id);
  }
}
