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
  clean: false,
  // Inferred schema responses include Zod's recursive JSON type in declarations.
  inlineOnly: ["zod"],
  outExtensions: () => ({ js: ".js" }),
});
