import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductionDbStepSpecs,
  executeProductionDbSteps,
  runProductionDbRelease,
} from "./production-db.mjs";

const ALREADY_DONE_RE = /SKIP \(already done/u;
const WEB_ARTIFACT_REJECTED_RE = /Web artifact rejected/u;
const NPM_ARTIFACT_REJECTED_RE = /isolated npm consumer rejected/u;

test("keeps the production database sequence minimal and fail closed", () => {
  assert.deepEqual(
    buildProductionDbStepSpecs().map((step) => step.label),
    [
      "Build database code generation dependencies",
      "Generate database artifacts",
      "Check committed database schema and migration truth",
      "Apply production migrations with read-only preflight",
      "Verify the production database contract",
      "Optimize query planner statistics after schema synchronization",
    ]
  );
});

test("keeps schema generation local and uses production only for remote database stages", () => {
  assert.deepEqual(
    buildProductionDbStepSpecs().map((step) => [
      step.label,
      step.databaseExecutionMode,
    ]),
    [
      ["Build database code generation dependencies", "dev"],
      ["Generate database artifacts", "dev"],
      ["Check committed database schema and migration truth", "dev"],
      ["Apply production migrations with read-only preflight", "prod"],
      ["Verify the production database contract", "prod"],
      [
        "Optimize query planner statistics after schema synchronization",
        "prod",
      ],
    ]
  );
});

test("skips only completed D1 migration application and preserves later database checks", () => {
  const sideEffects = [];
  const observedModes = [];
  const output = [];
  executeProductionDbSteps({
    adapters: {
      runCommand: ({ env }) => {
        observedModes.push(["probe", env.OPENMELD_DB_EXECUTION_MODE]);
        return {
          status: 0,
          stderr: "",
          stdout: "No migrations to apply.\n",
        };
      },
      runStep: (step, env) => {
        sideEffects.push(step.label);
        observedModes.push([step.label, env.OPENMELD_DB_EXECUTION_MODE]);
      },
    },
    env: { OPENMELD_DB_EXECUTION_MODE: "wrong-ambient-value" },
    steps: buildProductionDbStepSpecs(),
    write: (value) => output.push(value),
  });

  assert.deepEqual(sideEffects, [
    "Build database code generation dependencies",
    "Generate database artifacts",
    "Check committed database schema and migration truth",
    "Verify the production database contract",
    "Optimize query planner statistics after schema synchronization",
  ]);
  assert.deepEqual(observedModes, [
    ["Build database code generation dependencies", "dev"],
    ["Generate database artifacts", "dev"],
    ["Check committed database schema and migration truth", "dev"],
    ["probe", "prod"],
    ["Verify the production database contract", "prod"],
    ["Optimize query planner statistics after schema synchronization", "prod"],
  ]);
  assert.match(output.join(""), ALREADY_DONE_RE);
});

test("the database entry admits a train Web artifact before any database mutation", async () => {
  const mutations = [];
  await assert.rejects(
    runProductionDbRelease({
      adapters: {
        assertCleanWorktree: () => undefined,
        checkNpmArtifact: () => undefined,
        checkArtifact: () => {
          throw new Error("Web artifact rejected");
        },
        readHeadSha: () => "a".repeat(40),
        runStep: (step) => mutations.push(step.label),
      },
      cwd: "/release-source",
      env: { OPENMELD_PRODUCTION_TRAIN_SCOPES: "db,cli,web" },
      write: () => undefined,
    }),
    WEB_ARTIFACT_REJECTED_RE
  );
  assert.deepEqual(mutations, []);
});

test("the database entry rejects a bad CLI package before any database mutation", async () => {
  const mutations = [];
  const admissions = [];
  await assert.rejects(
    runProductionDbRelease({
      adapters: {
        assertCleanWorktree: () => undefined,
        checkArtifact: () => admissions.push("web"),
        checkNpmArtifact: () => {
          admissions.push("npm");
          throw new Error("isolated npm consumer rejected");
        },
        readHeadSha: () => "a".repeat(40),
        runStep: (step) => mutations.push(step.label),
      },
      cwd: "/release-source",
      env: { OPENMELD_PRODUCTION_TRAIN_SCOPES: "db,core,cli,web" },
      write: () => undefined,
    }),
    NPM_ARTIFACT_REJECTED_RE
  );
  assert.deepEqual(admissions, ["npm"]);
  assert.deepEqual(mutations, []);
});
