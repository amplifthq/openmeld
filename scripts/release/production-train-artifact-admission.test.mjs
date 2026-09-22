import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  admitProductionTrainArtifacts,
  PRODUCTION_TRAIN_SCOPES_ENV,
  resolveProductionTrain,
} from "./production-train-artifact-admission.mjs";

const SOURCE_SHA = "a".repeat(40);
const OUTSIDE_TRAIN_RE = /outside the declared train: cli/u;
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

test("requires an explicit train and uses the release plan source and scopes", () => {
  assert.throws(
    () =>
      resolveProductionTrain({
        env: {},
        selectedScopes: "db",
        sourceSha: SOURCE_SHA,
      }),
    new RegExp(PRODUCTION_TRAIN_SCOPES_ENV, "u")
  );
  const calls = [];
  assert.deepEqual(
    resolveProductionTrain(
      {
        env: { [PRODUCTION_TRAIN_SCOPES_ENV]: "db,cli,web" },
        selectedScopes: "db",
        sourceSha: SOURCE_SHA,
      },
      {
        buildPlan: (input) => {
          calls.push(input);
          return { scopes: ["db", "cli", "web"], sourceSha: SOURCE_SHA };
        },
      }
    ),
    {
      artifactScopes: ["web"],
      productionScopes: ["db", "cli", "web"],
      scopes: ["db", "cli", "web"],
      selectedScopes: ["db"],
      sourceSha: SOURCE_SHA,
    }
  );
  assert.deepEqual(calls, [
    {
      affectedPackages: [],
      changedPaths: [],
      scope: "db,cli,web",
      sourceSha: SOURCE_SHA,
    },
  ]);
});

test("rejects an entry scope outside the declared train", () => {
  assert.throws(
    () =>
      resolveProductionTrain({
        env: { [PRODUCTION_TRAIN_SCOPES_ENV]: "db" },
        selectedScopes: "cli",
        sourceSha: SOURCE_SHA,
      }),
    OUTSIDE_TRAIN_RE
  );
});

test("checks selected Desktop then Web artifacts and skips both for a backend-only train", async () => {
  const checks = [];
  const dependencies = {
    buildPlan: ({ scope, sourceSha }) => ({
      scopes: scope.split(","),
      sourceSha,
    }),
    checkArtifact: (input) => checks.push(input),
    readHeadSha: () => SOURCE_SHA,
  };
  assert.deepEqual(
    await admitProductionTrainArtifacts(
      {
        env: { [PRODUCTION_TRAIN_SCOPES_ENV]: "db" },
        root: "/release",
        selectedScopes: "db",
        sourceSha: SOURCE_SHA,
      },
      dependencies
    ),
    {
      artifactScopes: [],
      artifacts: { desktop: "not_required", web: "not_required" },
      productionScopes: ["db"],
      scopes: ["db"],
      selectedScopes: ["db"],
      sourceSha: SOURCE_SHA,
    }
  );
  assert.deepEqual(checks, []);

  assert.deepEqual(
    await admitProductionTrainArtifacts(
      {
        env: { [PRODUCTION_TRAIN_SCOPES_ENV]: "db,cli,web,desktop" },
        root: "/release",
        selectedScopes: "cli",
        sourceSha: SOURCE_SHA,
      },
      dependencies
    ),
    {
      artifactScopes: ["desktop", "web"],
      artifacts: { desktop: "verified", web: "verified" },
      productionScopes: ["db", "cli", "web"],
      scopes: ["db", "cli", "web", "desktop"],
      selectedScopes: ["cli"],
      sourceSha: SOURCE_SHA,
    }
  );
  assert.deepEqual(checks, [
    { root: "/release", scope: "desktop", sourceSha: SOURCE_SHA },
    { root: "/release", scope: "web", sourceSha: SOURCE_SHA },
  ]);
});

test("the CLI admits an explicit selected scope at the checked-out source", () => {
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  const result = spawnSync(
    process.execPath,
    [
      "scripts/release/production-train-artifact-admission.mjs",
      "--source-sha",
      sourceSha,
      "--scope",
      "db",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        [PRODUCTION_TRAIN_SCOPES_ENV]: "db",
      },
    }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    artifactScopes: [],
    artifacts: { desktop: "not_required", web: "not_required" },
    productionScopes: ["db"],
    scopes: ["db"],
    selectedScopes: ["db"],
    sourceSha,
  });
});
