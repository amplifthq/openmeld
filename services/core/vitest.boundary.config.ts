import { defineConfig } from "vitest/config";
import { buildLazyRuntimeModules } from "./scripts/build-lazy-runtime-modules.mjs";

await buildLazyRuntimeModules();

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests-node/**/*.test.ts"],
  },
});
