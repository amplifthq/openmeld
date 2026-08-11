import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@openmeld\/api-client$/,
        replacement: path.resolve(
          import.meta.dirname,
          "../../packages/api-client/src/index.ts"
        ),
      },
      {
        find: /^@openmeld\/gateway-contract$/,
        replacement: path.resolve(
          import.meta.dirname,
          "../../packages/gateway-contract/src/index.ts"
        ),
      },
      {
        find: /^@openmeld\/protocol$/,
        replacement: path.resolve(
          import.meta.dirname,
          "../../packages/protocol/src/index.ts"
        ),
      },
      {
        find: /^@openmeld\/start$/,
        replacement: path.resolve(
          import.meta.dirname,
          "../../packages/start/src/index.ts"
        ),
      },
      {
        find: /^@openmeld\/space$/,
        replacement: path.resolve(
          import.meta.dirname,
          "../../packages/space/src/index.ts"
        ),
      },
      {
        find: /^@openmeld\/utils$/,
        replacement: path.resolve(
          import.meta.dirname,
          "../../packages/utils/src/index.ts"
        ),
      },
    ],
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
