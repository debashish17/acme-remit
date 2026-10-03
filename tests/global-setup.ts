import { buildUi } from "../scripts/build-ui.js";

/** Vitest global setup: the MCP Apps view must exist before resources/read can serve it. */
export default async function setup(): Promise<void> {
  await buildUi();
}
