import { cpSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/server/index.ts" },
  tsconfig: "tsconfig.build.json",
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  // migrate.ts reads its SQL relative to itself; in the bundle that is dist/, so copy it there.
  onSuccess: async () => {
    cpSync("src/db/schema.sql", "dist/schema.sql");
    cpSync("src/db/migrations", "dist/migrations", { recursive: true });
    // The simulator page is served as static files from dist/simulator.
    cpSync("src/simulator", "dist/simulator", { recursive: true });
    // The MCP Apps view and the simulator's host bridge, built by scripts/build-ui.ts.
    cpSync(".generated/ui", "dist/ui", { recursive: true });
  },
});
