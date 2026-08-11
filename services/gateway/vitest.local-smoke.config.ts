import path from "node:path";
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "../../packages/db/drizzle")
  );

  return {
    test: {
      fileParallelism: false,
      include: ["tests/local-smoke/**/*.test.ts"],
      setupFiles: ["./tests/local-smoke/apply-d1-migrations.ts"],
      poolOptions: {
        workers: {
          isolatedStorage: false,
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
            },
          },
          singleWorker: true,
          wrangler: {
            configPath: "./wrangler.local-smoke.jsonc",
          },
        },
      },
    },
  };
});
