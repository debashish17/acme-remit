import express, { type Express } from "express";
import type { Core } from "../core/index.js";
import { bearerAuth } from "./auth.js";
import { mcpPostHandler, methodNotAllowed } from "./mcp.js";
import { devRouter, simRouter, type SimDeps } from "./sim/routes.js";

export interface AppOptions {
  bearerToken: string;
  core: Core;
  /** The simulator relay and dev controls; omitted in pure MCP tests. */
  sim?: Omit<SimDeps, "core">;
}

export function createApp({ bearerToken, core, sim }: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  // App Runner terminates TLS in front of the container; trust its one hop for req.ip.
  app.set("trust proxy", 1);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Streamable HTTP on POST /mcp only. Legacy GET /sse is intentionally not served (CLAUDE.md rule 7).
  app.use("/mcp", bearerAuth(bearerToken));
  app.post("/mcp", express.json({ limit: "1mb" }), mcpPostHandler(core));
  app.all("/mcp", methodNotAllowed);

  if (sim) {
    app.use("/sim", simRouter({ ...sim, core }));
    app.use("/dev", devRouter({ ...sim, core }));
  }

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return app;
}
