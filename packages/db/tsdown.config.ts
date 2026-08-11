import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    auth: "src/auth.ts",
    core: "src/core.ts",
    "core-facts": "src/core-facts.ts",
    diagnostics: "src/diagnostics.ts",
    facts: "src/facts.ts",
    tooling: "src/tooling.ts",
  },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node18",
  sourcemap: true,
  clean: false,
  dts: true,
  outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
});
