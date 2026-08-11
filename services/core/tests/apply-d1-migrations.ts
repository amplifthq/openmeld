import { applyD1Migrations, env } from "cloudflare:test";

// Bring the test D1 database to the real production schema before any test
// file runs. `applyD1Migrations` records applied migrations, so repeated
// setup runs are no-ops.
await applyD1Migrations(env.OPENMELD_DB, env.TEST_MIGRATIONS);
