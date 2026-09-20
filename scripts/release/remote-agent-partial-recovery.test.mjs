import assert from "node:assert/strict";
import test from "node:test";
import { executeWithProductionScopeLeases } from "./production-release.mjs";

import {
  assessRemoteAgentPartialRecovery,
  verifyRecoveredRemoteAgentTarget,
} from "./remote-agent-partial-recovery.mjs";

const SOURCE = "0612281ef08be6ed20757505e60244c4af1d4109";
const ATTEMPT = "70bdb4d1-c057-4868-89ec-1f9c5ed9a1b2";
const OPERATION =
  "353a9e1963092b123abfc471dced3fd0818b32e029b12f5344f079ce7063840e";
const VERSION = "2a12d6f6-bcd1-4dc1-8bb1-14c6fce3b80e";
const DEPLOYMENT = "77e23293-cea0-4237-b262-6189f8c7dfe3";
const CONTAINER = "a035a35d-8b87-4591-a1af-7f347f6318d0";
const OLD_IMAGE =
  "registry.cloudflare.com/account/openmeld-agent-computer@sha256:31ca19176819ec6fe82090a7867e9ed6749f7f8a67730506ffc88e1bffb39f5d";
const LEASE_HELD = /lease held/u;

function fixture() {
  const receipt = {
    attemptId: ATTEMPT,
    componentIndex: 4,
    operationKey: OPERATION,
    startedAt: "2026-09-20T15:20:26.361Z",
    status: "failed",
    application: "unknown",
  };
  return {
    sourceSha: SOURCE,
    attemptId: ATTEMPT,
    operationKey: OPERATION,
    current: {
      sha: SOURCE,
      recordedAt: "2026-09-20T15:22:12.913Z",
      receipt,
    },
    started: {
      sourceSha: SOURCE,
      receipt: { ...receipt, status: "started" },
    },
    deployments: [
      {
        id: "b7dfa0c2-3810-4dab-a2a8-7f4e4941d673",
        created_on: "2026-09-20T03:42:23.56295Z",
        versions: [
          {
            version_id: "c002a335-2a9d-45d8-8697-94c52fb428fe",
            percentage: 100,
          },
        ],
      },
      {
        id: DEPLOYMENT,
        created_on: "2026-09-20T15:21:09.762788Z",
        versions: [{ version_id: VERSION, percentage: 100 }],
      },
    ],
    container: {
      id: CONTAINER,
      name: "openmeld-agent-computer",
      version: 99,
      updated_at: "2026-09-20T03:53:34.692Z",
      configuration: { image: OLD_IMAGE },
      health: { errors: [], instances: { healthy: 7, failed: 0, starting: 0 } },
    },
    images: [{ name: "openmeld-agent-computer", tags: ["c002a335"] }],
    expectedDeploymentId: DEPLOYMENT,
    expectedWorkerVersionId: VERSION,
    expectedContainerId: CONTAINER,
    expectedContainerVersion: 99,
    expectedContainerImage: OLD_IMAGE,
  };
}

test("admits only one active Worker upload in the retained failed attempt window with the old container still effective", () => {
  const input = fixture();
  assert.deepEqual(assessRemoteAgentPartialRecovery(input), {
    workerDeploymentId: DEPLOYMENT,
    workerVersionId: VERSION,
    containerId: CONTAINER,
    containerVersion: 99,
    containerImage: OLD_IMAGE,
  });
  for (const changed of [
    { current: { ...input.current, sha: "b".repeat(40) } },
    { started: undefined },
    {
      current: {
        ...input.current,
        receipt: { ...input.current.receipt, status: "verified" },
      },
    },
    {
      started: {
        ...input.started,
        receipt: { ...input.started.receipt, operationKey: "b".repeat(64) },
      },
    },
    { expectedDeploymentId: "unrelated" },
    { expectedContainerImage: "unrelated" },
    { container: { ...input.container, version: 100 } },
    { images: [{ name: "openmeld-agent-computer", tags: ["2a12d6f6"] }] },
    {
      deployments: [
        ...input.deployments,
        {
          id: "another",
          created_on: "2026-09-20T15:21:30.000Z",
          versions: [{ version_id: "another", percentage: 100 }],
        },
      ],
    },
  ]) {
    assert.throws(() =>
      assessRemoteAgentPartialRecovery({ ...input, ...changed })
    );
  }
});

test("a competing production lease prevents any recovery work", async () => {
  let executed = false;
  await assert.rejects(
    executeWithProductionScopeLeases({
      owner: "local:test@localhost:1",
      scopes: ["remote-agent"],
      sourceSha: SOURCE,
      adapters: {
        acquireProductionScopeLease: () => {
          throw new Error("lease held");
        },
      },
      execute: () => {
        executed = true;
      },
    }),
    LEASE_HELD
  );
  assert.equal(executed, false);
});

test("requires the new target image, a newer healthy container version and no active old instance", () => {
  const baseline = assessRemoteAgentPartialRecovery(fixture());
  const target = {
    baseline,
    workerVersionId: "e19357b2-0000-4000-8000-123456789abc",
    container: {
      id: CONTAINER,
      name: "openmeld-agent-computer",
      version: 100,
      configuration: {
        image:
          "registry.cloudflare.com/account/openmeld-agent-computer@sha256:new",
      },
      health: { errors: [], instances: { healthy: 7, failed: 0, starting: 0 } },
    },
    images: [{ name: "openmeld-agent-computer", tags: ["e19357b2"] }],
    instances: [
      { state: "inactive", version: null },
      { state: "running", version: 100 },
    ],
  };
  assert.equal(verifyRecoveredRemoteAgentTarget(target).containerVersion, 100);
  assert.throws(() =>
    verifyRecoveredRemoteAgentTarget({
      ...target,
      instances: [{ state: "running", version: 99 }],
    })
  );
  assert.throws(() =>
    verifyRecoveredRemoteAgentTarget({
      ...target,
      images: [{ name: "openmeld-agent-computer", tags: [] }],
    })
  );
  assert.throws(() =>
    verifyRecoveredRemoteAgentTarget({
      ...target,
      container: { ...target.container, configuration: { image: OLD_IMAGE } },
    })
  );
});
