import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveProductionCompatibilityDependencies,
  resolveProductionCompatibilityReceiverWitnesses,
} from "./production-release.mjs";

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
