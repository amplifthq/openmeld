import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  executeProductionDeploySteps,
  executeWithProductionScopeLeases,
} from "./production-release.mjs";
import {
  publishGuardedLocalReleaseEvidence,
  readGuardedLocalReleaseSources,
} from "./production-release-evidence.mjs";

import {
  assessRemoteAgentPartialRecovery,
  executeRemoteAgentRecovery,
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
const NEW_DIGEST = `sha256:${"a".repeat(64)}`;
const LEASE_HELD = /lease held/u;
const ROLLOUT_UNVERIFIED = /healthy container rollout/u;
const RECEIPT_PUBLICATION_FAILED = /receipt publication failed/u;

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
      instances: 7,
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

test("requires registry tag digest, settled rollout and complete instance observation", () => {
  const baseline = assessRemoteAgentPartialRecovery(fixture());
  const target = {
    baseline,
    workerVersionId: "e19357b2-0000-4000-8000-123456789abc",
    imageDigest: NEW_DIGEST,
    container: {
      id: CONTAINER,
      name: "openmeld-agent-computer",
      version: 100,
      instances: 7,
      configuration: {
        image: `registry.cloudflare.com/account/openmeld-agent-computer@${NEW_DIGEST}`,
      },
      health: {
        errors: [],
        instances: {
          active: 1,
          assigned: 0,
          // Captured Cloudflare shape: one active instance plus six healthy
          // idle instances account for the seven configured instances.
          healthy: 6,
          failed: 0,
          starting: 0,
          stopped: 0,
          scheduling: 0,
        },
      },
    },
    images: [{ name: "openmeld-agent-computer", tags: ["e19357b2"] }],
    instancesPage: {
      instances: [
        { state: "inactive", version: null },
        { state: "running", version: 100 },
      ],
      result_info: { per_page: 100, page_token: null, next_page_token: null },
    },
  };
  assert.equal(verifyRecoveredRemoteAgentTarget(target).containerVersion, 100);
  assert.throws(() =>
    verifyRecoveredRemoteAgentTarget({
      ...target,
      instancesPage: {
        ...target.instancesPage,
        instances: [{ state: "running", version: 99 }],
      },
    })
  );
  assert.throws(() =>
    verifyRecoveredRemoteAgentTarget({
      ...target,
      container: {
        ...target.container,
        configuration: {
          image: `registry.cloudflare.com/account/openmeld-agent-computer@sha256:${"b".repeat(64)}`,
        },
      },
    })
  );
  assert.throws(() =>
    verifyRecoveredRemoteAgentTarget({
      ...target,
      container: { ...target.container, active_rollout_id: "still-rolling" },
    })
  );
  assert.throws(() =>
    verifyRecoveredRemoteAgentTarget({
      ...target,
      instancesPage: { ...target.instancesPage, instances: [] },
    })
  );
  assert.throws(() =>
    verifyRecoveredRemoteAgentTarget({
      ...target,
      instancesPage: {
        ...target.instancesPage,
        result_info: {
          per_page: 100,
          page_token: null,
          next_page_token: "more",
        },
      },
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

test("recovery execution records verified only after a matching image and settled rollout", async () => {
  for (const mode of ["wrong-digest", "success", "receipt-failure"]) {
    const wrongDigest = mode === "wrong-digest";
    const root = mkdtempSync(path.join(tmpdir(), "openmeld-remote-recovery-"));
    const repository = path.join(root, "repository");
    const remote = path.join(root, "remote.git");
    const git = (cwd, ...args) =>
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    try {
      git(root, "init", "--bare", "--quiet", remote);
      git(root, "init", "--initial-branch=main", "--quiet", repository);
      git(repository, "config", "user.email", "test@openmeld.ai");
      git(repository, "config", "user.name", "Recovery Test");
      writeFileSync(path.join(repository, "README.md"), "recovery fixture\n");
      git(repository, "add", "README.md");
      git(repository, "commit", "--quiet", "-m", "seed source");
      const sourceSha = git(repository, "rev-parse", "HEAD");
      git(repository, "remote", "add", "origin", remote);
      git(repository, "push", "--quiet", "-u", "origin", "main");
      const receipt = {
        attemptId: ATTEMPT,
        componentIndex: 4,
        operationKey: OPERATION,
        startedAt: "2026-09-20T15:20:26.361Z",
        status: "started",
        application: "unknown",
      };
      const publish = (next, recovery, now) =>
        publishGuardedLocalReleaseEvidence({
          cwd: repository,
          remote,
          sourceSha,
          scopes: ["remote-agent"],
          receipts: { "remote-agent": next },
          ...(recovery
            ? { recoveryProof: { "remote-agent": { ...next, recovery } } }
            : {}),
          now,
        });
      const read = () =>
        readGuardedLocalReleaseSources({ cwd: repository, remote }).get(
          "remote-agent"
        );
      publish(receipt, undefined, "2026-09-20T15:20:33.062Z");
      publish(
        { ...receipt, status: "failed" },
        undefined,
        "2026-09-20T15:22:12.913Z"
      );
      const original = read();
      const baseline = assessRemoteAgentPartialRecovery(fixture());
      const recovery = {
        id: "00000000-0000-4000-8000-000000000002",
        originalEvidenceSha: original.evidenceSha,
        startedAt: "2026-09-20T16:00:00.000Z",
        baseline,
      };
      const identity = {
        kind: "worker-deployment",
        workerName: "openmeld-remote-agent-prod",
        environment: "prod",
        deploymentId: "new-deployment",
        versionId: "e19357b2-0000-4000-8000-123456789abc",
        sourceSha,
        proof: "command-output",
      };
      const target = {
        baseline,
        workerVersionId: identity.versionId,
        imageDigest: NEW_DIGEST,
        container: {
          id: CONTAINER,
          name: "openmeld-agent-computer",
          version: 100,
          instances: 7,
          configuration: {
            image: `registry.cloudflare.com/account/openmeld-agent-computer@sha256:${(wrongDigest ? "b" : "a").repeat(64)}`,
          },
          health: {
            errors: [],
            instances: {
              active: 0,
              assigned: 0,
              healthy: 7,
              failed: 0,
              starting: 0,
              stopped: 0,
              scheduling: 0,
            },
          },
        },
        images: [{ name: "openmeld-agent-computer", tags: ["e19357b2"] }],
        instancesPage: {
          instances: [{ state: "inactive", version: null }],
          result_info: {
            per_page: 100,
            page_token: null,
            next_page_token: null,
          },
        },
      };
      let deployed = false;
      let attemptedVerified = false;
      const execute = () =>
        executeRemoteAgentRecovery({
          recovery,
          runDeploy: () =>
            executeProductionDeploySteps({
              cwd: repository,
              steps: [
                {
                  command: "pnpm",
                  args: ["mock"],
                  label: "Deploy Remote Agent Worker",
                },
              ],
              adapters: {
                runStep: () => {
                  deployed = true;
                },
              },
            }),
          verifyWorker: () => {
            assert.equal(deployed, true);
            return identity;
          },
          verifyContainer: async () => verifyRecoveredRemoteAgentTarget(target),
          observeFailure: () => ({
            workerDeploymentId: "new-deployment",
            workerVersionId: identity.versionId,
            containerVersion: 100,
            containerImage: target.container.configuration.image,
            observedAt: "2026-09-20T16:01:00.000Z",
          }),
          record: (status, application, appliedIdentity) => {
            if (status === "verified") {
              attemptedVerified = true;
              if (mode === "receipt-failure") {
                throw new Error("receipt publication failed");
              }
            }
            return publish(
              {
                ...receipt,
                status,
                application,
                ...(appliedIdentity ? { identity: appliedIdentity } : {}),
              },
              recovery,
              "2026-09-20T16:02:00.000Z"
            );
          },
        });
      if (mode === "wrong-digest") {
        await assert.rejects(execute(), ROLLOUT_UNVERIFIED);
        assert.equal(read().receipt.status, "failed");
        assert.equal(read().receipt.application, "unknown");
        assert.equal(attemptedVerified, false);
      } else if (mode === "receipt-failure") {
        await assert.rejects(execute(), RECEIPT_PUBLICATION_FAILED);
        assert.equal(attemptedVerified, true);
        assert.equal(read().receipt.status, "failed");
        assert.equal(read().receipt.application, "unknown");
      } else {
        await execute();
        assert.equal(read().receipt.status, "verified");
        assert.equal(read().receipt.attemptId, ATTEMPT);
        assert.equal(read().receipt.identity.versionId, identity.versionId);
      }
      const parents = git(
        repository,
        "rev-list",
        "--parents",
        "-n",
        "1",
        read().evidenceSha
      ).split(" ");
      assert.equal(parents[1], original.evidenceSha);
      assert.equal(parents.length, 3);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
});
