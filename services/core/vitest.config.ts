import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import { initializePostgresTests } from "../../tooling/postgresql/tests.mjs";
import { buildLazyRuntimeModules } from "./scripts/build-lazy-runtime-modules.mjs";

await buildLazyRuntimeModules();

export default defineWorkersConfig(async () => {
  const database = await initializePostgresTests({
    legacyBindingFixtures: true,
  });
  return {
    test: {
      fileParallelism: false,
      globals: true,
      include: ["src/__tests__/**/*.test.ts", "tests/**/*.test.ts"],
      poolOptions: {
        workers: {
          // Durable Object stream tests share storage and use unique fixture ids.
          isolatedStorage: false,
          singleWorker: true,
          miniflare: {
            bindings: {
              TEST_POSTGRESQL_OWNER: { connectionString: database.owner },
              TEST_POSTGRESQL_TEMPLATE: database.templateName,
              TEST_POSTGRESQL_PRE_GUARD_TEMPLATE: database.preGuardTemplateName,
              TEST_POSTGRESQL_OWNER_GUARDS_AND_LATER:
                database.ownerGuardsAndLater,
            },
            hyperdrives: { OPENMELD_POSTGRESQL: database.runtime },
          },
          wrangler: { configPath: "./wrangler.test.jsonc" },
        },
      },
    },
  };
});
