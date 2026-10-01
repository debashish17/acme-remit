import express, { type Express } from "express";
import { bearerAuth } from "./auth.js";
import type { Core } from "../core/index.js";
import { mcpPostHandler, methodNotAllowed } from "./mcp.js";

export interface AppOptions {
  bearerToken: string;
  core: Core;
}

export function createApp({ bearerToken, core }: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Streamable HTTP on POST /mcp only. Legacy GET /sse is intentionally not served (CLAUDE.md rule 7).
  app.use("/mcp", bearerAuth(bearerToken));
  app.post("/mcp", express.json({ limit: "1mb" }), mcpPostHandler(core));
  app.all("/mcp", methodNotAllowed);

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return app;
}
