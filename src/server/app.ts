import express, { type Express } from "express";
import { bearerAuth } from "./auth.js";
import { handleMcpPost, methodNotAllowed } from "./mcp.js";

export interface AppOptions {
  bearerToken: string;
}

export function createApp({ bearerToken }: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Streamable HTTP on POST /mcp only. Legacy GET /sse is intentionally not served (CLAUDE.md rule 7).
  app.use("/mcp", bearerAuth(bearerToken));
  app.post("/mcp", express.json({ limit: "1mb" }), handleMcpPost);
  app.all("/mcp", methodNotAllowed);

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return app;
}
