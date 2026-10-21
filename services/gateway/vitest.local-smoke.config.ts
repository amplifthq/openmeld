import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "../../packages/db/drizzle")
  );

  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
          },
        },
        wrangler: {
          configPath: "./wrangler.local-smoke.jsonc",
        },
      }),
    ],
    test: {
      fileParallelism: false,
      include: ["tests/local-smoke/**/*.test.ts"],
      maxWorkers: 1,
      setupFiles: ["./tests/local-smoke/apply-d1-migrations.ts"],
    },
  };
});
