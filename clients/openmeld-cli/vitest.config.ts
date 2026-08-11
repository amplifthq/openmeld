import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@openmeld\/agent-runtime$/,
        replacement: path.resolve(
          import.meta.dirname,
          "../../packages/agent-runtime/src/index.ts"
        ),
      },
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
        find: /^@openmeld\/routine-schedule$/,
        replacement: path.resolve(
          import.meta.dirname,
          "../../packages/routine-schedule/src/index.ts"
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
    // Pin a no-color environment before any module loads. picocolors binds its
    // formatters (pc.cyan, pc.dim, ...) to colorizing-or-identity at import
    // time based on ambient env, and CI runners set `CI`, which picocolors
    // treats as color-capable. Setting NO_COLOR here — before the worker
    // imports picocolors — makes those bound formatters identity, so terminal
    // rendering is deterministic across local and CI runs. (A per-test
    // isColorSupported override cannot fix this: it changes the property, not
    // the already-bound formatter functions.)
    env: { FORCE_COLOR: "0", NO_COLOR: "1" },
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.integration.test.ts"],
    setupFiles: ["./tests/setup-env.ts"],
    testTimeout: 30_000,
  },
});
