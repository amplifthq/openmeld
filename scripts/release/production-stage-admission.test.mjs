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
const UNRESOLVED = /evidence is unresolved/u;
const SOURCE_PROOF = /Missing exact source proof/u;
const CORE_PREREQUISITE = /pending prerequisite core/u;

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

test("does not turn default ordering or unrelated unknown receipts into dependencies", () => {
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
    component("remote-agent", "unknown", "1".repeat(40), []),
  ];
  assert.doesNotThrow(() =>
    assertProductionStageAdmission({
      components,
      selectedScopes: ["core"],
      sourceSha: SOURCE,
    })
  );
});

test("requires the actual compatibility receiver, accepting its verified receipt", () => {
  const components = [
    component("gateway", "pending", "2".repeat(40), [
      "services/gateway/src/index.ts",
    ]),
    component("core", "pending", "1".repeat(40), [
      "packages/schemas/src/schemas/http/space-wake-progress.ts",
      "clients/openmeld-cli/src/space/wake-control-command.ts",
      "services/core/src/rpc/methods.ts",
    ]),
  ];
  const input = { components, selectedScopes: ["core"], sourceSha: SOURCE };
  components[1].compatibilityDependencies = [["gateway", "core"]];
  assert.throws(
    () => assertProductionStageAdmission(input),
    PREREQUISITE_ERROR
  );
  components[0].state = "current";
  assert.doesNotThrow(() => assertProductionStageAdmission(input));
});

test("accepts a pending Remote receiver only with a matching content witness", () => {
  const components = [
    component("remote-agent", "pending", "2".repeat(40), [
      "services/remote-agent/src/unrelated-log.ts",
    ]),
    {
      ...component("core", "pending", "1".repeat(40), []),
      compatibilityDependencies: [["remote-agent", "core"]],
      compatibilityReceiverWitnesses: [
        {
          producer: "core",
          receiver: "remote-agent",
          receiverPaths: [
            "services/remote-agent/flue-adapter/execution-reconciliation.ts",
          ],
          evidence: {
            baselineSha: "2".repeat(40),
            result: "match",
            targetSha: SOURCE,
          },
        },
      ],
    },
  ];
  const input = { components, selectedScopes: ["core"], sourceSha: SOURCE };
  assert.doesNotThrow(() => assertProductionStageAdmission(input));
  components[1].compatibilityReceiverWitnesses[0].evidence.result = "mismatch";
  assert.throws(() => assertProductionStageAdmission(input));
  components[1].compatibilityReceiverWitnesses[0].evidence.result = "unknown";
  assert.throws(() => assertProductionStageAdmission(input));
  components[1].compatibilityReceiverWitnesses[0].evidence.result = "match";
  components[0].state = "unknown";
  assert.throws(() => assertProductionStageAdmission(input));
  components[0].state = "pending";
  components[1].compatibilityReceiverWitnesses[0].evidence.targetSha =
    "4".repeat(40);
  assert.throws(() => assertProductionStageAdmission(input));
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

test("preserves a proven retirement direction instead of inferring expansion from paths", () => {
  const components = [
    {
      ...component("core", "pending", "1".repeat(40), []),
      compatibilityDependencies: [["core", "web"]],
    },
    {
      ...component("web", "pending", "2".repeat(40), [
        "packages/schemas/src/schemas/http/inbox.ts",
      ]),
      compatibilityDependencies: [["core", "web"]],
    },
  ];
  assert.doesNotThrow(() =>
    assertProductionStageAdmission({
      components,
      selectedScopes: ["core"],
      sourceSha: SOURCE,
    })
  );
  assert.throws(
    () =>
      assertProductionStageAdmission({
        components,
        selectedScopes: ["web"],
        sourceSha: SOURCE,
      }),
    CORE_PREREQUISITE
  );
  components[0].state = "current";
  assert.doesNotThrow(() =>
    assertProductionStageAdmission({
      components,
      selectedScopes: ["web"],
      sourceSha: SOURCE,
    })
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

test("admits only exact-source health recovery while preserving source validation blockers", async () => {
  const status = {
    blockers: [{ name: "Web", detail: "Retained failed/applied receipt" }],
    sourceValidationBlockers: [],
    components: [
      {
        scope: "web",
        state: "unknown",
        recovery: {
          kind: "guarded-health-resume",
          admission: "candidate",
          sourceSha: SOURCE,
        },
      },
    ],
  };
  const input = {
    collectStatus: async () => status,
    scope: "web",
    sourceSha: SOURCE,
    write: () => undefined,
  };
  await runProductionStageAdmission(input);
  status.components[0].recovery.sourceSha = "4".repeat(40);
  await assert.rejects(runProductionStageAdmission(input), UNRESOLVED);
  status.components[0].recovery.sourceSha = SOURCE;
  status.sourceValidationBlockers.push({
    name: "Final Candidate",
    detail: "Missing exact source proof",
  });
  await assert.rejects(runProductionStageAdmission(input), SOURCE_PROOF);
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
