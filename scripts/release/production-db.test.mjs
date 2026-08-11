import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductionDbStepSpecs,
  executeProductionDbSteps,
} from "./production-db.mjs";

const ALREADY_DONE_RE = /SKIP \(already done/u;

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
