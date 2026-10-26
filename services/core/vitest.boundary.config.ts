import { defineConfig } from "vitest/config";
import { buildLazyRuntimeModules } from "./scripts/build-lazy-runtime-modules.mjs";

await buildLazyRuntimeModules();

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["tests-node/**/*.test.ts"],
    setupFiles: [
      "./test-support/reset-mocks.setup.ts",
      "./test-support/node-cloudflare-workers.setup.ts",
    ],
  },
});
