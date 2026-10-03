import { existsSync } from "node:fs";
import express, { type Express } from "express";
import { uiDir } from "./apps.js";
import type { Core } from "../core/index.js";
import { bearerAuth } from "./auth.js";
import { mcpPostHandler, methodNotAllowed } from "./mcp.js";
import { devRouter, simRouter, type SimDeps } from "./sim/routes.js";
import { securityHeaders, simulatorDir, simulatorStatic } from "./web.js";

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
  app.use(securityHeaders);

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
    // The page's MCP Apps host (AppBridge), built with the view by scripts/build-ui.ts.
    app.get("/js/app-host.js", (_req, res) => {
      const ui = uiDir();
      if (!ui || !existsSync(`${ui}app-host.js`)) {
        res.status(404).json({ error: "not_built", message: "Run pnpm build:ui." });
        return;
      }
      res.setHeader("Cache-Control", "no-cache");
      // .generated is a dot-directory, which send() ignores by default (FRICTION_LOG.md).
      res.sendFile(`${ui}app-host.js`, { dotfiles: "allow" });
    });
    // The simulator page at "/". Its API is /sim/*; the page never holds the Bearer secret.
    const dir = simulatorDir();
    if (dir) app.use(simulatorStatic(dir));
  }

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return app;
}
