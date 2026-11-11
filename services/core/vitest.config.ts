import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { initializePostgresTests } from "../../tooling/postgresql/tests.mjs";
import { buildLazyRuntimeModules } from "./scripts/build-lazy-runtime-modules.mjs";

await buildLazyRuntimeModules();

export default defineConfig(async () => {
  const database = await initializePostgresTests({
    legacyBindingFixtures: true,
  });
  const { ownerGuardsAndLater, preGuardTemplateName } = database;
  if (ownerGuardsAndLater === undefined || preGuardTemplateName === undefined) {
    throw new Error("Core Worker tests require legacy PostgreSQL fixtures.");
  }
  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          bindings: {
            TEST_POSTGRESQL_OWNER: { connectionString: database.owner },
            TEST_POSTGRESQL_TEMPLATE: database.templateName,
            TEST_POSTGRESQL_PRE_GUARD_TEMPLATE: preGuardTemplateName,
            TEST_POSTGRESQL_OWNER_GUARDS_AND_LATER: ownerGuardsAndLater,
          },
          hyperdrives: { OPENMELD_POSTGRESQL: database.runtime },
        },
        wrangler: { configPath: "./wrangler.test.jsonc" },
      }),
    ],
    test: {
      fileParallelism: false,
      globals: true,
      include: ["src/__tests__/**/*.test.ts", "tests/**/*.test.ts"],
      maxWorkers: 1,
      setupFiles: [
        "./test-support/reset-mocks.setup.ts",
        "./test-support/seed-published-local-components-release.setup.ts",
      ],
    },
  };
});
