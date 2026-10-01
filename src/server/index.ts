import { ConfigError, loadConfig, type Config } from "../config.js";
import { createCore } from "../core/index.js";
import { openDb } from "../db/connection.js";
import { migrate } from "../db/migrate.js";
import { seed } from "../db/seed.js";
import { createApp } from "./app.js";
import { startJobs } from "./jobs.js";

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

const db = openDb(config.DB_PATH);
const applied = migrate(db);
if (applied.length) console.log(`db: applied ${applied.join(", ")}`);
const users = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
if (users === 0) {
  // A fresh container has an empty database; load the demo data so the endpoint works at once.
  console.log("db: empty, loading demo seed", seed(db));
}

const core = createCore({ db, ratesUrl: config.RATES_URL, stepMs: config.TICKER_MS });
const stopJobs = startJobs(core, config.TICKER_MS);

const app = createApp({ bearerToken: config.MCP_BEARER_TOKEN, core });
const httpServer = app.listen(config.PORT, (err) => {
  if (err) {
    console.error(`Failed to listen on port ${config.PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`acme-remit listening on :${config.PORT} (POST /mcp, GET /health)`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopJobs();
    httpServer.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
