import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    exclude: ["tests/local-smoke/**/*.test.ts"],
    include: ["tests/**/*.test.ts"],
    unstubGlobals: true,
    unstubEnvs: true,
    poolOptions: {
      workers: {
        // This Workers pool starts a runtime per file despite Vitest's worker
        // limits. Share one runtime and module cache to bound loopback imports;
        // isolated storage remains enabled between tests.
        singleWorker: true,
        wrangler: {
          configPath: "./wrangler.test.jsonc",
        },
      },
    },
  },
});
