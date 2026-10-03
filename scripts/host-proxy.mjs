#!/usr/bin/env node
/* global process, console, URL */
/**
 * Local testing only: lets a browser-based MCP Apps host reach this server. Some hosts, such as the
 * official reference host (ext-apps examples/basic-host), connect from the browser: they can't send
 * the Bearer header, and the browser needs CORS headers, which /mcp doesn't send (Alexa+ calls it
 * server to server). This proxy adds both and forwards everything to the server.
 *
 * Usage: MCP_BEARER_TOKEN=... node scripts/host-proxy.mjs
 * Env:   PROXY_PORT (default 3001), MCP_TARGET (default http://127.0.0.1:3000)
 */

import http from "node:http";

const token = process.env.MCP_BEARER_TOKEN;
if (!token) {
  console.error("Set MCP_BEARER_TOKEN (the value in your .env).");
  process.exit(2);
}
const target = new URL(process.env.MCP_TARGET ?? "http://127.0.0.1:3000");
const port = Number(process.env.PROXY_PORT ?? 3001);

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
  "access-control-allow-headers":
    "content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};

http
  .createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    const headers = { ...req.headers, host: target.host, authorization: `Bearer ${token}` };
    delete headers.origin;
    const upstream = http.request(
      { host: target.hostname, port: target.port, path: req.url, method: req.method, headers },
      (r) => {
        res.writeHead(r.statusCode ?? 502, { ...r.headers, ...cors });
        r.pipe(res);
      },
    );
    upstream.on("error", (err) => {
      res.writeHead(502, cors);
      res.end(`Upstream unavailable: ${err.message}`);
    });
    req.pipe(upstream);
  })
  .listen(port, "127.0.0.1", () => {
    console.log(
      `MCP host proxy on http://127.0.0.1:${port}/mcp -> ${target.origin} (Bearer added, CORS on)`,
    );
  });
