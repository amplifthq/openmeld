import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": path.resolve(
        import.meta.dirname,
        "./tests/support/cloudflare-workers.stub.ts"
      ),
    },
  },
  test: {
    environment: "node",
    exclude: ["tests/**/*.worker.test.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.mjs"],
  },
});
