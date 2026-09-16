import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@openmeld/schemas": path.resolve(import.meta.dirname, "src/index.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
