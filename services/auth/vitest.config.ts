import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "#": path.resolve(import.meta.dirname, "../../clients/web/src"),
      "cloudflare:workers": path.resolve(
        import.meta.dirname,
        "./tests/support/cloudflare-workers.stub.ts"
      ),
    },
  },
  test: {
    environment: "node",
    exclude: ["tests/**/*.worker.test.ts"],
    globalSetup: ["./tests/support/build-lazy-runtime.global-setup.mjs"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.mjs"],
  },
});
