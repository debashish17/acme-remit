import { ConfigError, loadConfig, type Config } from "../config.js";
import { createCore } from "../core/index.js";
import { openDb } from "../db/connection.js";
import { migrate } from "../db/migrate.js";
import { seed } from "../db/seed.js";
import { createApp } from "./app.js";
import { startJobs } from "./jobs.js";
import { bedrockConverse, ChatService } from "./sim/chat.js";
import { DailyBudget } from "./sim/guards.js";
import { SYSTEM_PROMPT } from "./sim/prompt.js";
import { McpRelay } from "./sim/relay.js";

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

// The simulator relay calls this same server over loopback HTTP: a real /mcp round trip.
const relay = new McpRelay({
  url: `http://127.0.0.1:${config.PORT}/mcp`,
  bearer: config.MCP_BEARER_TOKEN,
});
const budget = new DailyBudget(config.SIM_DAILY_BEDROCK_CALLS);
const chat = new ChatService({
  relay,
  converse: bedrockConverse(config.AWS_REGION),
  modelId: config.BEDROCK_MODEL_ID,
  systemPrompt: SYSTEM_PROMPT,
  budget,
});

const app = createApp({
  bearerToken: config.MCP_BEARER_TOKEN,
  core,
  sim: {
    chat,
    relay,
    budget,
    accessCode: config.SIM_ACCESS_CODE,
    devCode: config.DEV_CONTROLS_CODE,
    reseed: () => {
      seed(db);
      chat.clear();
      relay.reset();
      console.log("dev: demo seed reloaded");
    },
  },
});
const httpServer = app.listen(config.PORT, (err) => {
  if (err) {
    console.error(`Failed to listen on port ${config.PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`acme-remit listening on :${config.PORT} (POST /mcp, GET /health)`);
  console.log(
    `simulator ${config.SIM_ACCESS_CODE ? "on" : "off (set SIM_ACCESS_CODE)"}; dev controls ${config.DEV_CONTROLS_CODE ? "on" : "off"}; model ${config.BEDROCK_MODEL_ID}`,
  );
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
