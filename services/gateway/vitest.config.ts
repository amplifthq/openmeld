import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.test.jsonc",
      },
    }),
  ],
  test: {
    exclude: ["tests/local-smoke/**/*.test.ts"],
    include: ["tests/**/*.test.ts"],
    // The Workers pool retains transformed modules per runtime. Run one
    // runtime at a time to bound loopback imports; storage stays isolated
    // per test file.
    maxWorkers: 1,
    setupFiles: ["./tests/reset-mocks.setup.ts"],
    unstubGlobals: true,
    unstubEnvs: true,
  },
});
