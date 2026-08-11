import { applyD1Migrations, env } from "cloudflare:test";

const smokeEnv = env as unknown as {
  OPENMELD_DB: D1Database;
  TEST_MIGRATIONS: unknown[];
};

await applyD1Migrations(smokeEnv.OPENMELD_DB, smokeEnv.TEST_MIGRATIONS);
