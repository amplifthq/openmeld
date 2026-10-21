import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { initializePostgresTests } from "../../tooling/postgresql/tests.mjs";
import { buildLazyRuntimeModules } from "./scripts/build-lazy-runtime-modules.mjs";

await buildLazyRuntimeModules();

export default defineConfig(async () => {
  const database = await initializePostgresTests();
  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          bindings: {
            TEST_POSTGRESQL_OWNER: { connectionString: database.owner },
            TEST_POSTGRESQL_TEMPLATE: database.templateName,
          },
          hyperdrives: { OPENMELD_POSTGRESQL: database.runtime },
        },
        wrangler: { configPath: "./wrangler.test.jsonc" },
      }),
    ],
    test: {
      fileParallelism: false,
      globals: true,
      include: ["tests-postgresql-owner/**/*.test.ts"],
      maxWorkers: 1,
    },
  };
});
