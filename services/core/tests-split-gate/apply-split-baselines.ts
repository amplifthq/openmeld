import { env } from "cloudflare:test";
import { beforeAll } from "vitest";

import localStateBaseline from "../../../packages/db/split/openmeld-local-state/0000_baseline.sql?raw";
import projectionsBaseline from "../../../packages/db/split/openmeld-projections/0000_baseline.sql?raw";
import wakeEvidenceBaseline from "../../../packages/db/split/openmeld-wake-evidence/0000_baseline.sql?raw";

const CREATE_TABLE_PREFIX_REGEX = /^CREATE TABLE /iu;
const CREATE_UNIQUE_INDEX_PREFIX_REGEX = /^CREATE UNIQUE INDEX /iu;
const CREATE_INDEX_PREFIX_REGEX = /^CREATE INDEX /iu;

// Seed a per-domain D1 with its baseline schema. The baselines are raw prod
// `sqlite_master` DDL (mixed quoting: "x", `x`, bare x). singleWorker +
// shared storage means setupFiles run once per test file, so the CREATE
// statements are made idempotent before they run.
async function applyBaseline(db: D1Database, sql: string): Promise<void> {
  // Strip `-- ` annotation lines first: the baseline header comment would
  // otherwise survive the `;` split as a statement-less chunk and D1 rejects
  // it ("SQL code did not contain a statement").
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const statements = withoutComments
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .map(toIdempotentCreateStatement);
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}

function toIdempotentCreateStatement(statement: string): string {
  return statement
    .replace(CREATE_TABLE_PREFIX_REGEX, "CREATE TABLE IF NOT EXISTS ")
    .replace(
      CREATE_UNIQUE_INDEX_PREFIX_REGEX,
      "CREATE UNIQUE INDEX IF NOT EXISTS "
    )
    .replace(CREATE_INDEX_PREFIX_REGEX, "CREATE INDEX IF NOT EXISTS ");
}

beforeAll(async () => {
  if (
    !(
      env.OPENMELD_LOCAL_STATE_DB &&
      env.OPENMELD_WAKE_EVIDENCE_DB &&
      env.OPENMELD_PROJECTIONS_DB
    )
  ) {
    throw new Error(
      "split-gate requires OPENMELD_LOCAL_STATE_DB, OPENMELD_WAKE_EVIDENCE_DB and OPENMELD_PROJECTIONS_DB bindings"
    );
  }
  await applyBaseline(env.OPENMELD_LOCAL_STATE_DB, localStateBaseline);
  await applyBaseline(env.OPENMELD_WAKE_EVIDENCE_DB, wakeEvidenceBaseline);
  await applyBaseline(env.OPENMELD_PROJECTIONS_DB, projectionsBaseline);
  // OPENMELD_DB is deliberately left empty — it is the misroute/unrewired trap.
});
