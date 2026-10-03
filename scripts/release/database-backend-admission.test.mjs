import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CUTOVER_UNAVAILABLE_PATTERN =
  /PostgreSQL product cutover is unavailable/u;
const MISSING_COMMAND_PATTERN = /ENOENT|not found/u;
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/u;

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
test("the PostgreSQL candidate blocks product deployment and D1 writes before external commands", () => {
  for (const args of [
    ["scripts/release/production-release.mjs", "deploy", "--scope", "core"],
    ["scripts/release/production-db.mjs"],
    ["scripts/release/staging-release.mjs", "deploy"],
  ]) {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env: { ...process.env, PATH: "" },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, CUTOVER_UNAVAILABLE_PATTERN);
    assert.doesNotMatch(result.stderr, MISSING_COMMAND_PATTERN);
  }
});

test("cutover preparation reports the native target without executable promotion or acceptance", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/release/production-release.mjs",
      "plan",
      "--database-cutover",
      "--base",
      "HEAD",
      "--json",
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        POSTGRESQL_OPENMELD_MIGRATION_URL: "must-not-connect",
        POSTGRESQL_OPENMELD_RUNTIME_URL: "must-not-connect",
      },
    }
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.databaseCutover.mode, "preparation_only");
  assert.equal(plan.databaseCutover.target.backend, "postgresql");
  assert.equal(plan.databaseCutover.target.majorVersion, "18");
  assert.equal(
    plan.databaseCutover.target.database,
    "openmeld-postgresql-prod"
  );
  assert.equal(plan.databaseCutover.promotionAllowed, false);
  assert.equal(plan.databaseCutover.executor, "unavailable");
  assert.equal(plan.databaseCutover.evidenceStatus, "not_evaluated");
  assert.equal(plan.compatibilityEvidence.basis, "source_comparison_only");
  assert.equal(
    plan.compatibilityEvidence.deployedComponentReceipts,
    "not_inspected"
  );
  assert.ok(plan.databaseCutover.nativeMigrations.length > 0);
  for (const migration of plan.databaseCutover.nativeMigrations) {
    assert.match(migration.checksum, CHECKSUM_PATTERN);
  }
  assert.deepEqual(plan.deploySteps, []);
  assert.deepEqual(plan.preflightSteps, []);
  assert.deepEqual(plan.verifySteps, []);
  assert.deepEqual(plan.deployScopeOrder, []);
  for (const scope of [
    "db",
    "auth",
    "core",
    "gateway",
    "web",
    "remote-agent",
  ]) {
    assert.ok(plan.coordinatedScopeReview.includes(scope));
  }
});
