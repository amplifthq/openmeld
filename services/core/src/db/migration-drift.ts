import { LATEST_SHARED_MIGRATION_ID } from "@openmeld/db/facts";
import { toErrorMessage } from "@openmeld/gateway-contract";
import { type CoreBindings, identityDb } from "../lib/bindings";

const DEV_LOCAL_WORKER_ENVIRONMENT = "local";

let sharedDbMigrationDriftChecked = false;

type SharedDbMigrationDriftEnv = Pick<
  CoreBindings,
  "OPENMELD_DB" | "OPENMELD_WORKER_ENVIRONMENT"
>;

/**
 * Builds the loud dev warning shown when the local shared OPENMELD_DB is behind
 * the migration history the running Core worker was built against. Returns null
 * when the local database is at or ahead of the expected migration id.
 */
export const evaluateSharedDbMigrationDrift = (
  appliedMigrationId: number
): string | null => {
  if (appliedMigrationId >= LATEST_SHARED_MIGRATION_ID) {
    return null;
  }

  const divider = "=".repeat(72);
  return [
    "",
    divider,
    "[OPENMELD_DB migration drift] Local shared D1 is behind the running schema.",
    `  applied migration id:  ${appliedMigrationId}`,
    `  expected migration id: ${LATEST_SHARED_MIGRATION_ID}`,
    "  Run `pnpm db:migrate:dev` (or restart `pnpm dev`) to apply pending",
    "  migrations to the shared .wrangler-dev-state before continuing.",
    divider,
    "",
  ].join("\n");
};

const readAppliedSharedMigrationId = async (
  db: D1Database
): Promise<number> => {
  const row = await db
    .prepare("SELECT MAX(id) AS maxId FROM d1_migrations")
    .first<{ maxId: number | null }>();
  return Number(row?.maxId ?? 0);
};

const runSharedDbMigrationDriftCheck = async (
  db: D1Database
): Promise<void> => {
  try {
    const warning = evaluateSharedDbMigrationDrift(
      await readAppliedSharedMigrationId(db)
    );
    if (warning) {
      console.warn(warning);
    }
  } catch (error) {
    // Fail open: the drift probe is a dev convenience and must never surface as
    // a request error or hide a real failure.
    console.warn(
      `[OPENMELD_DB migration drift] Could not read local d1_migrations state: ${toErrorMessage(error)}`
    );
  }
};

/**
 * Dev-only guard: once per Core worker isolate, on the `local` worker
 * environment, compare the applied shared-D1 migration id against the migration
 * history the worker was built against and emit a loud warning when the local
 * database is behind. This catches the silent local drift that happens when a
 * schema change merges but the dev database was never re-migrated. No-op outside
 * dev-local; never blocks the request (fire-and-forget via waitUntil).
 */
export const warnOnSharedDbMigrationDriftOnce = (
  env: SharedDbMigrationDriftEnv,
  waitUntil?: (promise: Promise<unknown>) => void
): void => {
  if (sharedDbMigrationDriftChecked) {
    return;
  }
  if (env.OPENMELD_WORKER_ENVIRONMENT !== DEV_LOCAL_WORKER_ENVIRONMENT) {
    return;
  }
  sharedDbMigrationDriftChecked = true;

  const db = identityDb(env);
  if (!db) {
    return;
  }

  const check = runSharedDbMigrationDriftCheck(db);
  if (waitUntil) {
    waitUntil(check);
    return;
  }
  // No execution context to defer with: run detached. The check fails open
  // internally, so the no-op catch only guards against unexpected rejections.
  check.catch(() => undefined);
};

/**
 * Test-only hook to reset the once-per-isolate guard between cases.
 */
export const resetSharedDbMigrationDriftCheckForTests = (): void => {
  sharedDbMigrationDriftChecked = false;
};
