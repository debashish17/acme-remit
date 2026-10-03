import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    environment: "node",
    // Builds the MCP Apps view first: resources/read serves it (scripts/build-ui.ts).
    globalSetup: ["tests/global-setup.ts"],
  },
});
