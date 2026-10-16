import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    "setup-node-runtime": "src/setup-node-runtime.ts",
    index: "src/index.ts",
    testing: "src/testing/index.ts",
  },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node18",
  sourcemap: true,
  clean: false,
  outExtensions: () => ({ js: ".js" }),
});
