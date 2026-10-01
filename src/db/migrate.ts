import { existsSync, readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { openDb, type Db } from "./connection.js";

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const SCHEMA_URL = new URL("./schema.sql", import.meta.url);
const MIGRATIONS_URL = new URL("./migrations/", import.meta.url);

/**
 * schema.sql is migration 1 (the baseline from docs/SPEC.md). Later changes go in
 * migrations/NNNN_description.sql with NNNN >= 2. The applied version is tracked in
 * PRAGMA user_version, so no bookkeeping table is added to the schema.
 */
export function loadMigrations(): Migration[] {
  const migrations: Migration[] = [
    { version: 1, name: "schema.sql", sql: readFileSync(SCHEMA_URL, "utf8") },
  ];
  if (existsSync(MIGRATIONS_URL)) {
    for (const file of readdirSync(MIGRATIONS_URL).sort()) {
      const match = /^(\d{4})_[\w-]+\.sql$/.exec(file);
      if (!match) continue;
      const version = Number(match[1]);
      if (version < 2) throw new Error(`Migration ${file}: version must be >= 2`);
      migrations.push({
        version,
        name: file,
        sql: readFileSync(new URL(file, MIGRATIONS_URL), "utf8"),
      });
    }
  }
  return migrations;
}

/** Applies pending migrations in order, each in its own transaction. Returns the names applied. */
export function migrate(db: Db): string[] {
  const current = db.pragma("user_version", { simple: true }) as number;
  const applied: string[] = [];
  for (const m of loadMigrations()) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
    })();
    applied.push(m.name);
  }
  return applied;
}

const isCli =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const { loadConfig } = await import("../config.js");
  const { DB_PATH } = loadConfig();
  const db = openDb(DB_PATH);
  const applied = migrate(db);
  db.close();
  console.log(
    applied.length ? `Applied ${applied.join(", ")} to ${DB_PATH}` : `${DB_PATH} is up to date`,
  );
}
