import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@openmeld/db/auth": path.resolve(
        import.meta.dirname,
        "../db/src/auth/index.ts"
      ),
      "@openmeld/protocol": path.resolve(
        import.meta.dirname,
        "../protocol/src/index.ts"
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
