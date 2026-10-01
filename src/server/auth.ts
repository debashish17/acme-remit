import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * Requires `Authorization: Bearer <token>`. On failure returns 401 with a JSON-RPC error body and
 * deliberately no WWW-Authenticate header: there is no OAuth flow for clients to discover.
 * Never logs the presented or expected token.
 */
export function bearerAuth(expectedToken: string): RequestHandler {
  const expected = digest(expectedToken);
  return (req, res, next) => {
    const header = req.get("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    // Compare fixed-length digests so timing does not leak the token or its length.
    if (match?.[1] && timingSafeEqual(digest(match[1].trim()), expected)) {
      next();
      return;
    }
    console.warn(`auth: rejected ${req.method} ${req.path} (${header ? "bad token" : "no token"})`);
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized: missing or invalid bearer token" },
      id: null,
    });
  };
}
