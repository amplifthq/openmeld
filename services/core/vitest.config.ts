import path from "node:path";
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";
import { buildLazyRuntimeModules } from "./scripts/build-lazy-runtime-modules.mjs";

await buildLazyRuntimeModules();

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "../../packages/db/drizzle")
  );

  return {
    test: {
      fileParallelism: false,
      globals: true,
      include: ["src/__tests__/**/*.test.ts", "tests/**/*.test.ts"],
      setupFiles: ["./tests/apply-d1-migrations.ts"],
      poolOptions: {
        workers: {
          // WebSockets + Durable Objects are not supported with per-test
          // isolated storage (the RuntimeTransport stream tests hit SQLite WAL
          // sidecar assertions at storage-stack boundaries). Cloudflare's
          // documented workaround is shared storage; tests must use unique
          // fixture ids instead of relying on per-test resets.
          isolatedStorage: false,
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
            },
          },
          singleWorker: true,
          wrangler: {
            configPath: "./wrangler.test.jsonc",
          },
        },
      },
    },
  };
});
