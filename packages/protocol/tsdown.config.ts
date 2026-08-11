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
  clean: true,
  outExtensions: () => ({ js: ".js" }),
});
