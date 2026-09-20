import { defineConfig } from "vitest/config";
import { OPENMELD_CLI_VITEST_WORKSPACE_ALIASES } from "./vitest.workspace-aliases";

export default defineConfig({
  // Related-test discovery follows Bun-only embedded skill and native-addon
  // imports too. These files are assets, not JavaScript modules.
  assetsInclude: ["**/*.md", "**/*.node"],
  resolve: {
    alias: OPENMELD_CLI_VITEST_WORKSPACE_ALIASES,
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
