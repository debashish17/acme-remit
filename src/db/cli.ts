import { loadConfig } from "../config.js";
import { openDb } from "./connection.js";
import { migrate } from "./migrate.js";
import { seed } from "./seed.js";

/**
 * `pnpm db:migrate` and `pnpm db:seed`. Kept apart from migrate.ts and seed.ts so importing those
 * (the server bundles both) never runs a command: a bundled "am I the entry script?" check would
 * be true for every module in dist/index.js and re-seed the database on each start.
 */
const command = process.argv[2];
if (command !== "migrate" && command !== "seed") {
  console.error("usage: tsx src/db/cli.ts <migrate|seed>");
  process.exit(2);
}

const { DB_PATH } = loadConfig();
const db = openDb(DB_PATH);
try {
  const applied = migrate(db);
  if (command === "migrate") {
    console.log(
      applied.length ? `Applied ${applied.join(", ")} to ${DB_PATH}` : `${DB_PATH} is up to date`,
    );
  } else {
    console.log(`Seeded ${DB_PATH}:`, seed(db));
  }
} finally {
  db.close();
}
