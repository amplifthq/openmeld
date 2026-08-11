import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    exclude: ["tests/local-smoke/**/*.test.ts"],
    include: ["tests/**/*.test.ts"],
    // Each test file uses a Workers runtime. Keep the root test lane from
    // exhausting loopback sockets while other packages test in parallel.
    maxWorkers: 4,
    poolOptions: {
      workers: {
        wrangler: {
          configPath: "./wrangler.test.jsonc",
        },
      },
    },
  },
});
