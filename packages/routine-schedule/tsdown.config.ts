import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  outDir: "dist",
  format: "esm",
  platform: "neutral",
  target: "es2022",
  sourcemap: true,
  clean: false,
  outExtensions: () => ({ js: ".js" }),
});
