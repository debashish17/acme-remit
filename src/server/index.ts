import { ConfigError, loadConfig, type Config } from "../config.js";
import { createApp } from "./app.js";

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const app = createApp({ bearerToken: config.MCP_BEARER_TOKEN });
const httpServer = app.listen(config.PORT, (err) => {
  if (err) {
    console.error(`Failed to listen on port ${config.PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`acme-remit listening on :${config.PORT} (POST /mcp, GET /health)`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    httpServer.close(() => process.exit(0));
  });
}
