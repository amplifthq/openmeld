import { defineConfig } from "vitest/config";
import { OPENMELD_CLI_VITEST_WORKSPACE_ALIASES } from "./vitest.workspace-aliases";

export default defineConfig({
  resolve: {
    alias: OPENMELD_CLI_VITEST_WORKSPACE_ALIASES,
  },
  test: {
    // See vitest.config.ts: NO_COLOR must be set before the worker imports
    // picocolors so its bound formatters are identity and rendering is
    // deterministic across local and CI runs.
    env: {
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      OPENMELD_AUTH_URL: "https://auth.openmeld.invalid",
      OPENMELD_GATEWAY_URL: "https://gateway.openmeld.invalid",
    },
    environment: "node",
    include: ["tests/**/*.integration.test.ts"],
    setupFiles: ["./tests/setup-env.ts"],
    testTimeout: 30_000,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
  },
});
