import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node18",
  sourcemap: true,
  // Keep dist stable during parallel test prebuilds (CLI + gateway).
  clean: false,
  outExtensions: () => ({ js: ".js" }),
});
