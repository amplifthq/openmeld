import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProductionStageAdmission,
  runProductionStageAdmission,
} from "./production-stage-admission.mjs";

const SOURCE = "3".repeat(40);
const PREREQUISITE_ERROR =
  /ahead of pending prerequisite gateway.*Do not bypass.*latest CLI tag/su;
const RECOVERY_ERROR = /failed\/applied.*same guarded command/su;
const PENDING_TRAIN = /Receipt-based pending train: web/u;

test("uses each component receipt baseline while allowing R, R2 and R3", () => {
  const components = [
    component("db", "current", "1".repeat(40), []),
    component("auth", "current", "1".repeat(40), []),
    component("web", "current", SOURCE, []),
    component("gateway", "pending", "2".repeat(40), [
      "services/gateway/src/index.ts",
    ]),
    component("core", "current", "1".repeat(40), []),
    component("remote-agent", "current", "2".repeat(40), []),
    component("cli", "current", "1".repeat(40), []),
  ];
  assert.deepEqual(
    assertProductionStageAdmission({
      components,
      selectedScopes: ["gateway"],
      sourceSha: SOURCE,
    }),
    {
      pendingScopes: ["gateway"],
      prerequisiteScopes: [],
      selectedScopes: ["gateway"],
    }
  );
});

test("blocks a staged deployment until earlier pending receipts are verified", () => {
  const components = [
    component("db", "current", "1".repeat(40), []),
    component("cli", "current", "1".repeat(40), []),
    component("auth", "current", "1".repeat(40), []),
    component("web", "current", "1".repeat(40), []),
    component("gateway", "pending", "2".repeat(40), [
      "services/gateway/src/index.ts",
    ]),
    component("core", "pending", "1".repeat(40), [
      "services/core/src/index.ts",
    ]),
    component("remote-agent", "current", "1".repeat(40), []),
  ];
  assert.throws(
    () =>
      assertProductionStageAdmission({
        components,
        selectedScopes: ["core"],
        sourceSha: SOURCE,
      }),
    PREREQUISITE_ERROR
  );
});

test("fails closed with the retained receipt recovery guidance", () => {
  assert.throws(
    () =>
      assertProductionStageAdmission({
        components: [
          {
            reason:
              "Local release is failed/applied; rerun the same guarded command at the retained source.",
            scope: "web",
            state: "unknown",
          },
        ],
        selectedScopes: ["web"],
        sourceSha: SOURCE,
      }),
    RECOVERY_ERROR
  );
});

test("runs the whole train status before admitting a component", async () => {
  let output = "";
  const result = await runProductionStageAdmission({
    collectStatus: async () => ({
      blockers: [],
      components: [
        component("web", "pending", "2".repeat(40), [
          "clients/web/src/app.tsx",
        ]),
      ],
    }),
    scope: "web",
    sourceSha: SOURCE,
    write: (value) => {
      output += value;
    },
  });
  assert.deepEqual(result.pendingScopes, ["web"]);
  assert.match(output, PENDING_TRAIN);
});

function component(scope, state, sourceSha, changedPaths) {
  return {
    changedPaths,
    evidence: {
      artifact: `${scope}-artifact`,
      result: "verified",
      sourceSha,
      version: `${scope}-version`,
    },
    scope,
    sha: sourceSha,
    state,
  };
}
