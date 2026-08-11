import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@openmeld/schemas/schemas": path.resolve(
        import.meta.dirname,
        "../schemas/src/schemas/index.ts"
      ),
      "@openmeld/schemas/types": path.resolve(
        import.meta.dirname,
        "../schemas/src/types/index.ts"
      ),
      "@openmeld/schemas/testing": path.resolve(
        import.meta.dirname,
        "../schemas/src/testing/space-members.ts"
      ),
      "@openmeld/gateway-contract": path.resolve(
        import.meta.dirname,
        "../gateway-contract/src/index.ts"
      ),
      "@openmeld/protocol": path.resolve(
        import.meta.dirname,
        "../protocol/src/index.ts"
      ),
      "@openmeld/schemas": path.resolve(
        import.meta.dirname,
        "../schemas/src/index.ts"
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
