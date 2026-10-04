import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  buildProductionReleasePlan,
  resolveAutomaticReleaseScopes,
  resolveProductionCompatibilityDependencies,
  resolveProductionCompatibilityReceiverWitnesses,
} from "./production-release.mjs";
import { assertProductionStageAdmission } from "./production-stage-admission.mjs";

const FOLDER_RECOVERY = [
  "packages/schemas/src/working-folder-recovery.ts",
  "services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts",
  "clients/openmeld-cli/src/local-service/continuation/working-folder-recovery.ts",
];
const NPM_SETUP = [
  "scripts/release/npm-cli-artifact.mjs",
  "clients/openmeld-cli/package.json",
  "clients/web/src/lib/setup-bootstrap-script.ts",
];
const WINDOWS_PREVIEW_PATHS = [
  ...NPM_SETUP,
  "clients/web/src/lib/setup-bootstrap-windows-binary.ts",
  "scripts/release/publish-windows-internal-preview.mjs",
];
const PENDING_RECEIVER = /pending prerequisite/u;
const CONTRACT_CYCLE = /incompatible.*dependencies/iu;
const REMOTE_AI_USAGE = [
  "packages/schemas/src/schemas/ai-usage.ts",
  "services/core/src/usage/ai-usage-rpc.ts",
  "services/remote-agent/agent-core/ai-usage.ts",
];

// The bridge witnesses this exact historical source, not the moving checkout.
// Final Candidate already requires complete Git history. Keep the production
// digest and drift fence intact instead of re-blessing later protocol changes.
const REVIEWED_SOURCE_SHA = "b660a196af4f24c6a4f4cf3a38cf4ef83b90431b";
const reviewedSources = new Map();
function readReviewedSource(path) {
  if (!reviewedSources.has(path)) {
    reviewedSources.set(
      path,
      execFileSync("git", ["show", `${REVIEWED_SOURCE_SHA}:${path}`], {
        cwd: new URL("../../", import.meta.url),
        encoding: "utf8",
      })
    );
  }
  return reviewedSources.get(path);
}

test("admits the reviewed Core request bridge while retaining the metering receiver dependency", () => {
  const base = "e4454cf165b96c7f918e420f28205c2b2ed3c575";
  const sourceSha = REVIEWED_SOURCE_SHA;
  const readGitFile = (ref, path) =>
    ref === base
      ? "// Core before the metering receiver was introduced."
      : readReviewedSource(path);
  const paths = [
    ...REMOTE_AI_USAGE,
    "services/remote-agent/.flue/cloudflare.ts",
  ];
  const plan = buildProductionReleasePlan({
    base,
    sourceSha,
    changedPaths: paths,
    scope: "core,remote-agent",
    readGitFile,
  });
  assert.deepEqual(plan.deployScopeOrder, ["core", "remote-agent"]);
  assert.deepEqual(plan.compatibilityDependencies, [["core", "remote-agent"]]);
  assert.equal(
    plan.compatibilityBridges[0].kind,
    "negotiated-remote-task-attribution"
  );
  assert.equal(plan.compatibilityBridges[0].baselineSha, base);
  const components = [
    { scope: "core", state: "pending", sha: base, ...plan },
    { scope: "remote-agent", state: "pending", sha: base, ...plan },
  ];
  assert.doesNotThrow(() =>
    assertProductionStageAdmission({
      components,
      sourceSha,
      selectedScopes: ["core"],
    })
  );
  assert.throws(
    () =>
      assertProductionStageAdmission({
        components,
        sourceSha,
        selectedScopes: ["remote-agent"],
      }),
    PENDING_RECEIVER
  );
});

for (const fault of ["source_drift", "missing_history", "unknown_baseline"]) {
  test(`refuses to reuse the request bridge after ${fault}`, () => {
    const base =
      fault === "unknown_baseline"
        ? "b".repeat(40)
        : "e4454cf165b96c7f918e420f28205c2b2ed3c575";
    assert.throws(
      () =>
        buildProductionReleasePlan({
          base,
          sourceSha: "a".repeat(40),
          scope: "core,remote-agent",
          changedPaths: [
            ...REMOTE_AI_USAGE,
            "services/remote-agent/.flue/cloudflare.ts",
          ],
          readGitFile: (_ref, path) => {
            if (fault === "missing_history") {
              throw new Error("missing source");
            }
            const source = readReviewedSource(path);
            return fault === "source_drift" &&
              path.endsWith("remote-agent-worker.ts")
              ? `${source}\n// different contract`
              : source;
          },
        }),
      CONTRACT_CYCLE
    );
  });
}

test("does not invent a protocol cycle from Core receiver and persistence edits", () => {
  const plan = buildProductionReleasePlan({
    changedPaths: [
      "services/core/src/usage/ai-usage-rpc.ts",
      "services/core/src/center-agent/center-agent-context-manifest-repository.ts",
    ],
    sourceSha: "a".repeat(40),
    scope: "core,remote-agent",
  });
  assert.deepEqual(plan.compatibilityDependencies, []);
  assert.equal(plan.deployScopeOrder.length, 2);
  for (const signal of plan.compatibilityPathSignals) {
    assert.deepEqual(signal.matchedPaths, []);
    assert.equal(signal.nonTriggerPaths.length, 1);
  }
});

for (const receiverPath of [
  "services/remote-agent/.flue/cloudflare.ts",
  "services/core/src/center-agent/application/center-agent-context-manifest-service.ts",
]) {
  test(`does not hide the Core metering receiver behind ${receiverPath}`, () => {
    const paths = [...REMOTE_AI_USAGE, receiverPath];
    const edges = resolveProductionCompatibilityDependencies(paths);
    assert.ok(
      edges.some(
        ([receiver, producer]) =>
          receiver === "core" && producer === "remote-agent"
      )
    );
    assert.ok(
      edges.some(
        ([receiver, producer]) =>
          receiver === "remote-agent" && producer === "core"
      )
    );
    assert.throws(
      () =>
        buildProductionReleasePlan({
          changedPaths: paths,
          sourceSha: "a".repeat(40),
          scope: "core,remote-agent",
        }),
      CONTRACT_CYCLE
    );
  });
}
const INBOX_OBSERVATIONS = [
  "packages/schemas/src/schemas/http/inbox.ts",
  "services/core/src/inbox/application/inbox-notification-observations.ts",
  "services/gateway/src/routes/rpc-http.inbox.ts",
  "clients/web/src/lib/inbox/notification-observer.ts",
];

test("keeps Inbox readers before a new target writer during a storage migration", () => {
  const plan = buildProductionReleasePlan({
    changedPaths: [
      "packages/schemas/src/schemas/http/inbox.ts",
      "services/core/src/inbox/application/inbox-notification-observations.ts",
      "services/core/src/remote-agent/application/native-delivery-service.ts",
      "services/gateway/src/routes/rpc-http.inbox.ts",
      "clients/web/src/components/inbox/inbox-page.tsx",
    ],
    sourceSha: "a".repeat(40),
    scope: "web,gateway,core,cli",
  });
  assert.deepEqual(plan.deployScopeOrder, ["web", "gateway", "core", "cli"]);
  assert.deepEqual(plan.compatibilityDependencies, [
    ["web", "core"],
    ["gateway", "core"],
  ]);
});

test("deploys Inbox observation receivers before callers, composed with Remote titles", () => {
  const plan = buildProductionReleasePlan({
    changedPaths: [
      ...INBOX_OBSERVATIONS,
      "services/remote-agent/.flue/cloudflare.ts",
    ],
    sourceSha: "a".repeat(40),
    scope: "web,gateway,core,remote-agent",
  });
  assert.deepEqual(plan.deployScopeOrder, [
    "remote-agent",
    "core",
    "gateway",
    "web",
  ]);
  assert.ok(
    plan.compatibilityDependencies.some(
      ([receiver, producer]) => receiver === "core" && producer === "gateway"
    )
  );
  assert.ok(
    plan.compatibilityDependencies.some(
      ([receiver, producer]) => receiver === "gateway" && producer === "web"
    )
  );
  const automatic = resolveAutomaticReleaseScopes({
    changedPaths: INBOX_OBSERVATIONS,
    affectedPackages: [],
  });
  assert.ok(
    ["core", "gateway", "web"].every((scope) => automatic.includes(scope))
  );
  const components = ["core", "gateway", "web"].map((scope) => ({
    scope,
    state: "pending",
    sha: "b".repeat(40),
    compatibilityDependencies: plan.compatibilityDependencies,
  }));
  const admit = (scope) =>
    assertProductionStageAdmission({
      components,
      selectedScopes: [scope],
      sourceSha: "a".repeat(40),
    });
  assert.throws(() => admit("gateway"), PENDING_RECEIVER);
  assert.throws(() => admit("web"), PENDING_RECEIVER);
  components[0].state = "current";
  assert.doesNotThrow(() => admit("gateway"));
  assert.throws(() => admit("web"), PENDING_RECEIVER);
  components[1].state = "current";
  assert.doesNotThrow(() => admit("web"));
  assert.deepEqual(
    resolveProductionCompatibilityDependencies([
      INBOX_OBSERVATIONS[0],
      "clients/web/src/routes/unrelated.tsx",
    ]),
    []
  );
});

test("deploys the cancellation receiver before CLI and verified npm before Web", () => {
  const plan = buildProductionReleasePlan({
    changedPaths: [...FOLDER_RECOVERY, ...NPM_SETUP],
    sourceSha: "a".repeat(40),
    scope: "core,cli,web",
  });
  assert.deepEqual(plan.compatibilityDependencies, [
    ["core", "cli"],
    ["cli", "web"],
  ]);
  assert.deepEqual(plan.deployScopeOrder, ["core", "cli", "web"]);
  const core = plan.deploySteps.findIndex(
    (step) =>
      step.label === "Deploy Core with the current published CLI projection"
  );
  const cli = plan.deploySteps.findIndex(
    (step) => step.internalOperation === "publish-cli"
  );
  const web = plan.deploySteps.findIndex((step) => step.label === "Deploy Web");
  assert.ok(core >= 0 && cli > core && web > cli);
  const coreOnly = buildProductionReleasePlan({
    changedPaths: FOLDER_RECOVERY,
    sourceSha: "a".repeat(40),
    scope: "core",
  });
  assert.ok(
    coreOnly.deploySteps.some(
      (step) =>
        step.label === "Deploy Core with the current published CLI projection"
    )
  );
  assert.ok(
    !coreOnly.preflightSteps.some(
      (step) => step.label === "Verify Core CLI channel compatibility"
    )
  );
});

test("does not make the reviewed Windows binary preview wait for an npm CLI release", () => {
  const base = "7b8741ea2b096a8c36c5245d5d8810a8c568fc89";
  const sourceSha = "472c771fc5b74a7cf6b327abc61c85d66ee16172";
  const plan = buildProductionReleasePlan({
    base,
    changedPaths: WINDOWS_PREVIEW_PATHS,
    sourceSha,
    scope: "web",
  });
  assert.deepEqual(plan.compatibilityDependencies, []);
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(WINDOWS_PREVIEW_PATHS),
    [["cli", "web"]]
  );
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(WINDOWS_PREVIEW_PATHS, false, {
      base,
      sourceSha,
      readBlobSha: () => "changed-later",
    }),
    [["cli", "web"]]
  );
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(NPM_SETUP, false, {
      base,
      sourceSha,
    }),
    [["cli", "web"]]
  );
});

test("staged recovery and npm rollout require receipts, not unrelated backlog", () => {
  const dependencies = resolveProductionCompatibilityDependencies([
    ...FOLDER_RECOVERY,
    ...NPM_SETUP,
  ]);
  const components = ["core", "cli", "web", "gateway"].map((scope) => ({
    scope,
    state: "pending",
    sha: "b".repeat(40),
    compatibilityDependencies: dependencies,
  }));
  const admit = (scope) =>
    assertProductionStageAdmission({
      components,
      selectedScopes: [scope],
      sourceSha: "a".repeat(40),
    });
  assert.throws(() => admit("cli"), PENDING_RECEIVER);
  assert.throws(() => admit("web"), PENDING_RECEIVER);
  components[0].state = "current";
  assert.doesNotThrow(() => admit("cli"));
  assert.throws(() => admit("web"), PENDING_RECEIVER);
  components[1].state = "current";
  assert.doesNotThrow(() => admit("web"));
});

test("refuses opposite cancellation and caller-context dependencies", () => {
  assert.throws(
    () =>
      buildProductionReleasePlan({
        changedPaths: [
          ...FOLDER_RECOVERY,
          "packages/schemas/src/schemas/protocol/space-caller-context.ts",
          "services/core/src/space/transport/do/space.ts",
          "clients/openmeld-cli/src/local-service/dispatch/parse-dispatch-task.ts",
        ],
        sourceSha: "a".repeat(40),
        scope: "auth,remote-agent,core,cli",
      }),
    CONTRACT_CYCLE
  );
});

test("accepts an already deployed folder-recovery receiver only with matching evidence", () => {
  const sourceSha = "a".repeat(40);
  const baselineSha = "b".repeat(40);
  const witnesses =
    resolveProductionCompatibilityReceiverWitnesses(FOLDER_RECOVERY);
  const witness = witnesses.find(
    ({ receiver, producer }) => receiver === "core" && producer === "cli"
  );
  assert.ok(witness);
  assert.ok(
    witness.receiverPaths.includes(
      "packages/schemas/src/working-folder-recovery.ts"
    )
  );
  assert.ok(
    witness.receiverPaths.includes(
      "services/core/src/runtime-transport/application/local-agent-stream.ts"
    )
  );
  const components = [
    { scope: "core", state: "pending", sha: baselineSha },
    {
      scope: "cli",
      state: "pending",
      sha: baselineSha,
      compatibilityDependencies: [["core", "cli"]],
      compatibilityReceiverWitnesses: [
        {
          ...witness,
          evidence: { baselineSha, targetSha: sourceSha, result: "match" },
        },
      ],
    },
  ];
  const admit = () =>
    assertProductionStageAdmission({
      components,
      selectedScopes: ["cli"],
      sourceSha,
    });
  assert.doesNotThrow(admit);
  components[1].compatibilityReceiverWitnesses[0].evidence.result = "mismatch";
  assert.throws(admit, PENDING_RECEIVER);
  components[1].compatibilityReceiverWitnesses[0].evidence.result = "match";
  components[0].sha = "c".repeat(40);
  assert.throws(admit, PENDING_RECEIVER);
});

const SPACE_TASK_RECEIVERS = [
  "packages/schemas/src/schemas/http/space-tasks.ts",
  "services/core/src/rpc/methods.ts",
  "services/core/src/space/transport/do/space.ts",
];
const DEVICE_WAIT_RECEIVERS = [
  "packages/schemas/src/schemas/protocol/wake-device-wait.ts",
  "services/core/src/space/transport/do/space.ts",
  "services/gateway/src/routes/rpc-http.signals.ts",
];
const PEOPLE_COMPUTERS_RECEIVERS = [
  "packages/schemas/src/schemas/http/people-computers.ts",
  "services/core/src/people-computers/projection.ts",
  "services/gateway/src/routes/rpc-http.people-computers.ts",
];
const SPACE_INVITATION_RECEIVERS = [
  "packages/schemas/src/space-invitation.ts",
  "services/core/src/organizations/space-invitations.ts",
  "services/auth/src/lib/hono/space-invitation-routes.ts",
];

test("keeps default scheduling and unrelated pending scopes out of the dependency graph", () => {
  assert.deepEqual(
    resolveProductionCompatibilityDependencies([
      "services/core/src/index.ts",
      "clients/web/src/routes/index.tsx",
    ]),
    []
  );
});

test("adds only the Space Task dependency for the changed caller", () => {
  assert.deepEqual(
    resolveProductionCompatibilityDependencies([
      ...SPACE_TASK_RECEIVERS,
      "services/remote-agent/agent-core/tools.ts",
      "clients/web/src/routes/unrelated.tsx",
    ]),
    [["core", "remote-agent"]]
  );
  assert.deepEqual(
    resolveProductionCompatibilityDependencies([
      ...SPACE_TASK_RECEIVERS,
      "clients/openmeld-cli/src/space/dispatch-task.ts",
    ]),
    [
      ["core", "gateway"],
      ["gateway", "cli"],
    ]
  );
});

test("keeps optional Device Wait and People Computers callers independent", () => {
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(DEVICE_WAIT_RECEIVERS),
    [["core", "gateway"]]
  );
  assert.deepEqual(
    resolveProductionCompatibilityDependencies([
      ...DEVICE_WAIT_RECEIVERS,
      "clients/web/src/components/spaces/space-composer-device-wait.ts",
    ]),
    [
      ["core", "gateway"],
      ["gateway", "web"],
    ]
  );
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(PEOPLE_COMPUTERS_RECEIVERS),
    [["core", "gateway"]]
  );
});

test("requires the signed caller-context Service before its Core producer", () => {
  assert.deepEqual(
    resolveProductionCompatibilityDependencies([
      "packages/schemas/src/schemas/protocol/space-caller-context.ts",
      "services/core/src/space/transport/do/space.ts",
      "clients/openmeld-cli/src/local-service/dispatch/parse-dispatch-task.ts",
    ]),
    [
      ["auth", "cli"],
      ["remote-agent", "cli"],
      ["cli", "core"],
    ]
  );
});

test("requires every strict worker-response reader before the Remote producer", () => {
  assert.deepEqual(
    resolveProductionCompatibilityDependencies([
      "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
      "services/remote-agent/.flue/agents/center-agent.ts",
    ]),
    [
      ["core", "remote-agent"],
      ["gateway", "remote-agent"],
      ["web", "remote-agent"],
    ]
  );
});

test("does not invent a worker-response change for the reviewed hosted progress bridge", () => {
  const before = [
    "export const reasons = {",
    '  TURN_FAILED: "remote_agent.turn.failed",',
    "};",
    "export const callbacks = z.union([",
    '  z.strictObject({ kind: z.literal("text") }),',
    "]);",
    "",
  ].join("\n");
  const after = before
    .replace(
      '  TURN_FAILED: "remote_agent.turn.failed",\n',
      '  TURN_OUTPUT_LIMIT_EXCEEDED: "remote_agent.turn.output_limit_exceeded",\n  TURN_FAILED: "remote_agent.turn.failed",\n'
    )
    .replace(
      '  z.strictObject({ kind: z.literal("text") }),\n',
      [
        '  z.strictObject({ kind: z.literal("text") }),',
        "  z.strictObject({",
        "    ...typedRemoteAgentStreamDeltaCallbackIdentitySchema,",
        '    kind: z.literal("progress"),',
        '    source: z.literal("hosted.public_progress"),',
        "  }),",
        "",
      ].join("\n")
    );
  const changedPaths = [
    "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
    "services/core/src/remote-agent/application/native-delivery-service.ts",
    "services/remote-agent/.flue/agents/center-agent.ts",
    "services/remote-agent/.flue/cloudflare.ts",
    "services/remote-agent/flue-adapter/streaming.ts",
  ];
  const streamSource = [
    'response.reasonCode === "agent_stream.invalid"',
    "state.sequence = previousSequence",
    "transientState.progressUnsupported = true",
  ].join("\n");
  const planWith = (schemaAfter, streamAfter = streamSource) =>
    buildProductionReleasePlan({
      affectedPackages: [],
      base: "b".repeat(40),
      changedPaths,
      readGitFile: (ref, path) => {
        if (path.endsWith("streaming.ts")) {
          return streamAfter;
        }
        return ref === "b".repeat(40) ? before : schemaAfter;
      },
      scope: "core,remote-agent",
      sourceSha: "a".repeat(40),
    });

  const bridge = planWith(after);
  assert.equal(bridge.deployOrderProfile, "remote-agent-receiver-first");
  assert.deepEqual(bridge.deployScopeOrder, ["remote-agent", "core"]);
  assert.deepEqual(bridge.compatibilityDependencies, [
    ["remote-agent", "core"],
  ]);
  assert.equal(bridge.changedPaths.includes(changedPaths[0]), true);

  const responseChange = planWith(`${after}export const newResponse = true;\n`);
  assert.equal(
    responseChange.compatibilityDependencies.some(
      ([receiver, producer]) =>
        receiver === "core" && producer === "remote-agent"
    ),
    true
  );
  const missingBridge = planWith(after, "no compatibility bridge");
  assert.equal(
    missingBridge.compatibilityDependencies.some(
      ([receiver, producer]) =>
        receiver === "core" && producer === "remote-agent"
    ),
    true
  );
});

test("preserves proven retirement direction instead of reclassifying its schema", () => {
  const paths = [
    "packages/schemas/src/schemas/http/inbox.ts",
    "services/core/src/remote-agent/application/native-delivery-inbox-producer.ts",
  ];
  assert.deepEqual(resolveProductionCompatibilityDependencies(paths), [
    ["web", "core"],
    ["gateway", "core"],
  ]);
  assert.deepEqual(resolveProductionCompatibilityDependencies(paths, true), [
    ["core", "gateway"],
    ["core", "web"],
  ]);
});

test("adds invitation callers only when their producer path changes", () => {
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(SPACE_INVITATION_RECEIVERS),
    [["core", "auth"]]
  );
  assert.deepEqual(
    resolveProductionCompatibilityDependencies([
      ...SPACE_INVITATION_RECEIVERS,
      "clients/openmeld-cli/src/space/invitations-command.ts",
      "clients/web/src/lib/organizations/space-invitations.ts",
    ]),
    [
      ["core", "auth"],
      ["auth", "cli"],
      ["auth", "web"],
    ]
  );
});

test("composes independent receiver contracts without duplicate edges", () => {
  assert.deepEqual(
    resolveProductionCompatibilityDependencies([
      "packages/schemas/src/schemas/http/center-agent-memory-search.ts",
      "services/core/src/index.ts",
      "services/remote-agent/agent-core/tools.ts",
      "packages/schemas/src/schemas/runtime/personal-remote-agent.ts",
      "services/core/src/remote-agent/application/remote-agent-tool-caller.ts",
      "services/remote-agent/agent-core/personal-remote-agent-tools.ts",
    ]),
    [["core", "remote-agent"]]
  );
});

test("attaches exact Remote receiver content witnesses and preserves reviewed combinations", () => {
  const executionReconciliation = [
    "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
    "services/core/src/remote-agent/application/native-delivery-service.ts",
    "services/remote-agent/flue-adapter/execution-reconciliation.ts",
  ];
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(executionReconciliation),
    [["remote-agent", "core"]]
  );
  assert.deepEqual(
    resolveProductionCompatibilityReceiverWitnesses(executionReconciliation),
    [
      {
        producer: "core",
        receiver: "remote-agent",
        receiverPaths: [
          "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
          "services/remote-agent/flue-adapter/execution-reconciliation.ts",
        ],
      },
    ]
  );

  const callerContextAndInvitation = [
    "packages/schemas/src/schemas/protocol/space-caller-context.ts",
    "services/core/src/space/transport/do/space.ts",
    "clients/openmeld-cli/src/local-service/dispatch/parse-dispatch-task.ts",
    ...SPACE_INVITATION_RECEIVERS,
  ];
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(callerContextAndInvitation),
    [
      ["auth", "cli"],
      ["remote-agent", "cli"],
      ["cli", "core"],
    ]
  );
});
