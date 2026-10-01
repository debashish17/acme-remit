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
});
