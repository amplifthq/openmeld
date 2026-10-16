import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  executeProductionDeploySteps,
  executeWithProductionScopeLeases,
} from "./production-release.mjs";
import {
  publishGuardedLocalReleaseEvidence,
  readGuardedLocalReleaseSources,
} from "./production-release-evidence.mjs";
import { describeRemoteContainerConfiguration } from "./remote-agent-container-evidence.mjs";

import {
  assertRemoteVerificationSelectors,
  assertRetainedPreUploadContainer,
  assessRemoteAgentPartialRecovery,
  executeRemoteAgentRecovery,
  proveNativeBaseline,
  publishRemoteAgentRecoveryEvidence,
  readNativeHistoryBaseline,
  readRemoteAgentRecoveryHistory,
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
const SELECTOR_MISMATCH = /selectors do not match/u;
const TARGET_BOUNDARY = /fixture target boundary reached/u;
const PREFLIGHT_BLOCKED = /failed with exit code 19/u;
const REGISTRY_UNAVAILABLE = /Registry unavailable/u;

test("recovery CLI reserves deployment preflight for recovery that deploys", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-recovery-entry-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.name", "Release Test");
    git("config", "user.email", "release-test@openmeld.ai");
    writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
    git("add", ".gitignore");
    git("commit", "--quiet", "-m", "fixture");
    git("remote", "add", "origin", root);
    const sourceSha = git("rev-parse", "HEAD");
    const capture = path.join(root, ".git", "preflight-call.json");
    const preload = path.join(root, ".git", "command-boundary.mjs");
    writeFileSync(
      preload,
      `
import childProcess from "node:child_process";
import { writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const original = childProcess.spawnSync;
childProcess.spawnSync = (command, args, options) => {
  if (command === "git") return original(command, args, options);
  if (command === "node" && args[0].endsWith("/production-train-artifact-admission.mjs")) {
    writeFileSync(${JSON.stringify(capture)}, JSON.stringify(args));
    return { status: 19, stdout: null, stderr: null };
  }
  throw new Error("Unexpected external command: " + command);
};
syncBuiltinESMExports();
`
    );
    // Stop at the next external boundary, before any lease or Cloudflare read.
    // No Wrangler API response is fabricated; importing the target reader fails.
    const target = path.join(root, "node_modules", "wrangler");
    mkdirSync(target, { recursive: true });
    writeFileSync(
      path.join(target, "package.json"),
      JSON.stringify({ main: "index.cjs" })
    );
    writeFileSync(
      path.join(target, "index.cjs"),
      'throw new Error("fixture target boundary reached");\n'
    );
    const selectors = [
      "--source-dir",
      root,
      "--source-sha",
      sourceSha,
      "--attempt",
      ATTEMPT,
      "--expected-deployment",
      DEPLOYMENT,
      "--expected-worker-version",
      VERSION,
      "--container-id",
      CONTAINER,
      "--container-version",
      "125",
      "--container-image",
      OLD_IMAGE,
    ];
    for (const mode of ["verify", "partial", "before-upload"]) {
      const verifyOnly = mode === "verify";
      writeFileSync(capture, "null");
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          preload,
          fileURLToPath(
            new URL("./remote-agent-partial-recovery.mjs", import.meta.url)
          ),
          ...selectors,
          ...(verifyOnly ? ["--verify-only", "true"] : ["--base", sourceSha]),
          ...(mode === "before-upload" ? ["--before-upload", "true"] : []),
        ],
        { cwd: root, encoding: "utf8", timeout: 10_000 }
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      const preflight = JSON.parse(readFileSync(capture, "utf8"));
      if (verifyOnly) {
        assert.equal(
          preflight,
          null,
          "verification must not run deployment preflight"
        );
        assert.match(result.stderr, TARGET_BOUNDARY);
      } else {
        assert.equal(
          preflight[0],
          fileURLToPath(
            new URL(
              "./production-train-artifact-admission.mjs",
              import.meta.url
            )
          )
        );
        assert.equal(preflight.at(-1), sourceSha);
        assert.match(result.stderr, PREFLIGHT_BLOCKED);
        assert.doesNotMatch(
          result.stderr,
          TARGET_BOUNDARY,
          "failed preflight must stop deployment recovery"
        );
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verification-only recovery requires exact original source, attempt, Worker and native baseline selectors", () => {
  const latest = {
    sha: SOURCE,
    receipt: {
      attemptId: ATTEMPT,
      identity: { deploymentId: DEPLOYMENT, versionId: VERSION },
      remoteAgent: {
        container: { id: CONTAINER, version: 125, image: OLD_IMAGE },
      },
    },
  };
  const options = {
    "--source-sha": SOURCE,
    "--attempt": ATTEMPT,
    "--expected-deployment": DEPLOYMENT,
    "--expected-worker-version": VERSION,
    "--container-id": CONTAINER,
    "--container-version": "125",
    "--container-image": OLD_IMAGE,
  };
  assertRemoteVerificationSelectors(latest, options);
  for (const key of Object.keys(options)) {
    assert.throws(
      () =>
        assertRemoteVerificationSelectors(latest, {
          ...options,
          [key]: "changed",
        }),
      SELECTOR_MISMATCH
    );
  }
});

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
      health: {
        errors: [],
        instances: { healthy: 7, active: 0, failed: 0, starting: 0 },
      },
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

test("pre-upload recovery requires an unchanged pre-attempt deployment and complete Container evidence", () => {
  const input = fixture();
  input.beforeUpload = true;
  input.container.health.instances = {
    healthy: 6,
    active: 1,
    failed: 0,
    starting: 0,
    stopped: 0,
    scheduling: 0,
    assigned: 0,
  };
  input.deployments = input.deployments.slice(0, 1);
  input.expectedDeploymentId = input.deployments[0].id;
  input.expectedWorkerVersionId = input.deployments[0].versions[0].version_id;
  input.instancesPage = {
    instances: [{ id: "instance-1", state: "running", version: 99 }],
    result_info: { per_page: 100, page_token: null, next_page_token: null },
  };
  assert.equal(
    assessRemoteAgentPartialRecovery(input).workerDeploymentId,
    input.expectedDeploymentId
  );
  for (const changed of [
    { beforeUpload: false },
    { started: undefined },
    { expectedWorkerVersionId: VERSION },
    { deployments: fixture().deployments },
    { deployments: [{ ...input.deployments[0], created_on: "invalid" }] },
    {
      deployments: [
        ...input.deployments,
        { ...input.deployments[0], id: "unknown", created_on: "invalid" },
      ],
    },
    {
      deployments: [
        { ...input.deployments[0], created_on: "2026-09-20T16:00:00Z" },
      ],
    },
    {
      deployments: [
        {
          ...input.deployments[0],
          versions: [
            { version_id: input.expectedWorkerVersionId, percentage: 50 },
          ],
        },
      ],
    },
    { container: { ...input.container, updated_at: input.current.recordedAt } },
    { container: { ...input.container, active_rollout_id: "rollout" } },
    { instancesPage: undefined },
    {
      container: {
        ...input.container,
        health: {
          errors: [],
          instances: {
            ...input.container.health.instances,
            active: 0,
            healthy: 7,
          },
        },
      },
    },
    {
      instancesPage: {
        ...input.instancesPage,
        result_info: { next_page_token: "more", page_token: null },
      },
    },
    {
      instancesPage: {
        ...input.instancesPage,
        instances: [{ id: "instance-1", state: "running", version: 98 }],
      },
    },
  ]) {
    assert.throws(() =>
      assessRemoteAgentPartialRecovery({ ...input, ...changed })
    );
  }
  const retained = {
    ...describeRemoteContainerConfiguration(input.container),
    instances: [{ id: "instance-1", version: 99 }],
  };
  assertRetainedPreUploadContainer(
    retained,
    input.container,
    input.instancesPage
  );
  const baseline = assessRemoteAgentPartialRecovery(input);
  const retry = {
    ...input,
    recovery: {
      startedAt: "2026-09-20T15:30:00.000Z",
      baseline,
      observedContainer: retained,
      observedAfterFailure: {
        ...baseline,
        observedAt: "2026-09-20T15:31:00.000Z",
      },
    },
  };
  assert.deepEqual(assessRemoteAgentPartialRecovery(retry), baseline);
  const interruptedPartial = { ...retry, beforeUpload: false };
  assert.deepEqual(
    assessRemoteAgentPartialRecovery(interruptedPartial),
    baseline
  );
  for (const recovery of [
    undefined,
    { ...retry.recovery, observedContainer: undefined },
    {
      ...retry.recovery,
      baseline: { ...baseline, workerDeploymentId: "different" },
    },
    {
      ...retry.recovery,
      observedAfterFailure: {
        ...retry.recovery.observedAfterFailure,
        workerDeploymentId: "different",
      },
    },
  ]) {
    assert.throws(() =>
      assessRemoteAgentPartialRecovery({ ...interruptedPartial, recovery })
    );
  }
  assert.throws(() =>
    assessRemoteAgentPartialRecovery({
      ...retry,
      recovery: { ...retry.recovery, observedContainer: undefined },
    })
  );
  assert.throws(() =>
    assertRetainedPreUploadContainer(
      retained,
      {
        ...input.container,
        configuration: { ...input.container.configuration, changed: true },
      },
      input.instancesPage
    )
  );
  assert.throws(() =>
    assertRetainedPreUploadContainer(retained, input.container, {
      ...input.instancesPage,
      instances: [],
    })
  );
});

test("resumes only the exact linked recovery failure and rejects altered Git evidence or live selectors", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-recovery-history-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.name", "Recovery Test");
    git("config", "user.email", "release-test@openmeld.ai");
    git("commit", "--allow-empty", "--quiet", "-m", "source");
    const sourceSha = git("rev-parse", "HEAD");
    const input = fixture();
    input.sourceSha = sourceSha;
    input.current.sha = sourceSha;
    input.started.sourceSha = sourceSha;
    const metadata = (receipt, recordedAt, schemaVersion = 3) => ({
      kind: "openmeld-guarded-local-release-evidence",
      evidenceId: "00000000-0000-4000-8000-000000000001",
      scope: "remote-agent",
      sourceSha,
      recordedAt,
      schemaVersion,
      receipt,
    });
    const commit = (value, parents, tree = `${sourceSha}^{tree}`) =>
      execFileSync(
        "git",
        ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent])],
        { cwd: root, encoding: "utf8", input: JSON.stringify(value) }
      ).trim();
    const started = metadata(input.started.receipt, "2026-09-20T15:20:33.062Z");
    const startedSha = commit(started, [sourceSha]);
    const failed = metadata(input.current.receipt, input.current.recordedAt);
    const failedSha = commit(failed, [startedSha]);
    const baseline = assessRemoteAgentPartialRecovery(input);
    const native = {
      evidenceSha: "b".repeat(40),
      sourceSha: "c".repeat(40),
      workerVersionId: VERSION,
      container: {
        id: CONTAINER,
        name: "openmeld-agent-computer",
        version: baseline.containerVersion,
        image: OLD_IMAGE,
        configurationHash: describeRemoteContainerConfiguration(input.container)
          .configurationHash,
      },
    };
    const recovery = {
      id: "00000000-0000-4000-8000-000000000002",
      originalEvidenceSha: failedSha,
      startedAt: "2026-09-20T16:00:00.000Z",
      baseline,
      nativeProvenance: native,
      observedAfterFailure: {
        workerDeploymentId: "recovery-deployment",
        workerVersionId: "e19357b2-0000-4000-8000-123456789abc",
        containerVersion: baseline.containerVersion,
        containerImage: OLD_IMAGE,
        observedAt: "2026-09-20T16:01:00.000Z",
      },
    };
    const proof = metadata(
      { ...failed.receipt, recovery },
      "2026-09-20T16:02:00.000Z",
      4
    );
    const recovered = metadata(failed.receipt, proof.recordedAt);
    const makeLatest = (
      proofValue = proof,
      previous = failedSha,
      proofParents = [previous],
      tree = undefined
    ) => {
      const proofSha = commit(proofValue, proofParents, tree);
      return {
        sha: sourceSha,
        evidenceSha: commit(recovered, [previous, proofSha]),
        recordedAt: recovered.recordedAt,
        receipt: recovered.receipt,
      };
    };
    const latest = makeLatest();
    const history = readRemoteAgentRecoveryHistory(root, latest);
    assert.deepEqual(history, { started, recovery });
    assert.deepEqual(
      readRemoteAgentRecoveryHistory(root, {
        ...input.current,
        evidenceSha: failedSha,
      }),
      { started, recovery: undefined }
    );
    const resumed = {
      ...input,
      ...history,
      current: latest,
      expectedDeploymentId: recovery.observedAfterFailure.workerDeploymentId,
      expectedWorkerVersionId: recovery.observedAfterFailure.workerVersionId,
      deployments: [
        ...input.deployments,
        {
          id: recovery.observedAfterFailure.workerDeploymentId,
          created_on: "2026-09-20T16:00:30.000Z",
          versions: [
            {
              version_id: recovery.observedAfterFailure.workerVersionId,
              percentage: 100,
            },
          ],
        },
      ],
      instancesPage: {
        instances: [],
        result_info: { page_token: null, next_page_token: null },
      },
    };
    assert.deepEqual(assessRemoteAgentPartialRecovery(resumed), {
      ...baseline,
      workerDeploymentId: resumed.expectedDeploymentId,
      workerVersionId: resumed.expectedWorkerVersionId,
    });
    for (const change of [
      { expectedDeploymentId: DEPLOYMENT },
      { expectedWorkerVersionId: VERSION },
      { expectedContainerVersion: 100 },
      { container: { ...input.container, active_rollout_id: "in-progress" } },
      {
        container: {
          ...input.container,
          configuration: { image: OLD_IMAGE, changed: true },
        },
      },
      {
        instancesPage: {
          ...resumed.instancesPage,
          result_info: { page_token: null, next_page_token: "next" },
        },
      },
      {
        deployments: [
          ...resumed.deployments,
          {
            ...resumed.deployments.at(-1),
            id: "later-deployment",
            created_on: "2026-09-20T16:03:00.000Z",
          },
        ],
      },
      {
        deployments: [
          ...resumed.deployments,
          {
            ...resumed.deployments.at(-1),
            id: "changed-baseline",
            created_on: "2026-09-20T15:59:00.000Z",
            versions: [{ version_id: "changed-version", percentage: 100 }],
          },
        ],
      },
    ]) {
      assert.throws(() =>
        assessRemoteAgentPartialRecovery({ ...resumed, ...change })
      );
    }
    for (const change of [
      { originalEvidenceSha: startedSha },
      { startedAt: "2026-09-20T15:21:00.000Z" },
      { observedAfterFailure: undefined },
      {
        observedAfterFailure: {
          ...recovery.observedAfterFailure,
          observedAt: "2026-09-20T16:03:00.000Z",
        },
      },
      {
        observedAfterFailure: {
          ...recovery.observedAfterFailure,
          containerVersion: 100,
        },
      },
    ]) {
      assert.throws(() =>
        readRemoteAgentRecoveryHistory(
          root,
          makeLatest({
            ...proof,
            receipt: { ...proof.receipt, recovery: { ...recovery, ...change } },
          })
        )
      );
    }
    for (const changed of [
      { ...proof, sourceSha: "a".repeat(40) },
      { ...proof, receipt: { ...proof.receipt, operationKey: "a".repeat(64) } },
      {
        ...proof,
        receipt: {
          ...proof.receipt,
          attemptId: "00000000-0000-4000-8000-000000000009",
        },
      },
      { ...proof, recordedAt: "2026-09-20T16:01:59.000Z" },
    ]) {
      assert.throws(() =>
        readRemoteAgentRecoveryHistory(root, makeLatest(changed))
      );
    }
    assert.throws(() =>
      readRemoteAgentRecoveryHistory(
        root,
        makeLatest(proof, failedSha, [startedSha])
      )
    );
    const unlinked = commit(failed, [failedSha]);
    assert.throws(() =>
      readRemoteAgentRecoveryHistory(root, {
        ...latest,
        evidenceSha: unlinked,
        recordedAt: failed.recordedAt,
      })
    );
    writeFileSync(path.join(root, "different.txt"), "different source tree\n");
    git("add", "different.txt");
    const wrongTree = git("write-tree");
    assert.throws(() =>
      readRemoteAgentRecoveryHistory(
        root,
        makeLatest(proof, failedSha, [failedSha], wrongTree)
      )
    );
    const validProofSha = commit(proof, [failedSha]);
    assert.throws(() =>
      readRemoteAgentRecoveryHistory(root, {
        ...latest,
        evidenceSha: commit(recovered, [failedSha, validProofSha], wrongTree),
      })
    );
    for (const changed of [
      { ...recovered, scope: "core" },
      { ...recovered, sourceSha: "a".repeat(40) },
      { ...recovered, recordedAt: "2026-09-20T16:02:01.000Z" },
      { ...recovered, receipt: { ...recovered.receipt, componentIndex: 99 } },
    ]) {
      assert.throws(() =>
        readRemoteAgentRecoveryHistory(root, {
          ...latest,
          evidenceSha: commit(changed, [failedSha, validProofSha]),
        })
      );
    }

    // A second failure links to the previous canonical event, not back to the
    // first failure. Its window and baseline advance; the attempt never does.
    const nextRecovery = {
      ...recovery,
      id: "00000000-0000-4000-8000-000000000003",
      originalEvidenceSha: latest.evidenceSha,
      startedAt: "2026-09-20T17:00:00.000Z",
      baseline: assessRemoteAgentPartialRecovery(resumed),
      observedAfterFailure: {
        ...recovery.observedAfterFailure,
        workerDeploymentId: "second-recovery",
        workerVersionId: "second-version",
        observedAt: "2026-09-20T17:01:00.000Z",
      },
    };
    const nextProof = metadata(
      { ...failed.receipt, recovery: nextRecovery },
      "2026-09-20T17:02:00.000Z",
      4
    );
    const nextProofSha = commit(nextProof, [latest.evidenceSha]);
    const next = metadata(failed.receipt, nextProof.recordedAt);
    const nextLatest = {
      ...latest,
      recordedAt: next.recordedAt,
      evidenceSha: commit(next, [latest.evidenceSha, nextProofSha]),
    };
    assert.deepEqual(readRemoteAgentRecoveryHistory(root, nextLatest), {
      started,
      recovery: nextRecovery,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
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

for (const mode of [
  "wrong-digest",
  "success",
  "receipt-failure",
  "unchanged",
  "unchanged-resume",
  "retained-wrong-digest",
  "retained-receipt-failure",
  "retained-success",
]) {
  test(`recovery execution records verified only after a matching image and settled rollout (${mode})`, async () => {
    const wrongDigest = mode.endsWith("wrong-digest");
    const receiptFailure = mode.endsWith("receipt-failure");
    const retained = mode.startsWith("retained-");
    const unchanged = mode.startsWith("unchanged");
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
      if (retained) {
        // Shape captured after a Worker-only release's native continuation
        // failed on 2026-10-14. IDs and image/configuration hashes are replaced.
        receipt.remoteAgent = {
          phase: "rollout",
          container: {
            id: CONTAINER,
            name: "openmeld-agent-computer",
            version: 99,
            image: OLD_IMAGE,
            configurationHash: "f".repeat(64),
            instances: [],
          },
          baselineEvidenceSha: "b".repeat(40),
          baselineSourceSha: "c".repeat(40),
          workerIdentity: {
            kind: "worker-deployment",
            workerName: "openmeld-remote-agent-prod",
            environment: "prod",
            sourceSha,
            deploymentId: DEPLOYMENT,
            versionId: VERSION,
            proof: "command-output",
          },
        };
      }
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
      if (unchanged) {
        publish(
          {
            ...receipt,
            attemptId: "00000000-0000-4000-8000-000000000009",
            status: "verified",
            application: "applied",
            identity: {
              kind: "worker-deployment",
              workerName: "openmeld-remote-agent-prod",
              environment: "prod",
              sourceSha,
              deploymentId: DEPLOYMENT,
              versionId: VERSION,
              proof: "command-output",
            },
          },
          undefined,
          "2026-09-20T15:00:00.000Z"
        );
      }
      publish(receipt, undefined, "2026-09-20T15:20:33.062Z");
      publish(
        { ...receipt, status: "failed" },
        undefined,
        "2026-09-20T15:22:12.913Z"
      );
      let original = read();
      const baseline = assessRemoteAgentPartialRecovery(fixture());
      const recovery = {
        id: "00000000-0000-4000-8000-000000000002",
        originalEvidenceSha: original.evidenceSha,
        startedAt: "2026-09-20T16:00:00.000Z",
        baseline,
        ...(unchanged || retained
          ? {}
          : {
              observedContainer: {
                ...describeRemoteContainerConfiguration(fixture().container),
                instances: [],
              },
            }),
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
      if (unchanged) {
        target.container.version = baseline.containerVersion;
        target.container.configuration.image = OLD_IMAGE;
        target.imageDigest = OLD_IMAGE.split("@")[1];
        target.images[0].tags = [VERSION.slice(0, 8)];
        target.nativeProvenance = proveNativeBaseline({
          ...target,
          verifiedHistoryBaseline: original.verifiedHistoryBaseline,
          startedAt: receipt.startedAt,
        });
        recovery.nativeProvenance = target.nativeProvenance;
        assert.throws(() =>
          verifyRecoveredRemoteAgentTarget({
            ...target,
            nativeProvenance: undefined,
          })
        );
        assert.throws(() =>
          proveNativeBaseline({ ...target, startedAt: receipt.startedAt })
        );
        assert.throws(() =>
          verifyRecoveredRemoteAgentTarget({
            ...target,
            imageDigest: NEW_DIGEST,
          })
        );
        assert.throws(() =>
          verifyRecoveredRemoteAgentTarget({
            ...target,
            container: {
              ...target.container,
              configuration: {
                ...target.container.configuration,
                env: [{ name: "changed", value: "true" }],
              },
            },
          })
        );
      }
      let attemptedVerified = false;
      let registryUnavailable = mode === "unchanged-resume";
      let recordedAt = "2026-09-20T16:02:00.000Z";
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
          verifyContainer: () => {
            if (registryUnavailable) {
              throw new Error("Registry unavailable");
            }
            return verifyRecoveredRemoteAgentTarget(target);
          },
          observeFailure: () => ({
            workerDeploymentId: "new-deployment",
            workerVersionId: identity.versionId,
            containerVersion: target.container.version,
            containerImage: target.container.configuration.image,
            observedAt: "2026-09-20T16:01:00.000Z",
          }),
          record: (status, application, appliedIdentity) => {
            if (status === "verified") {
              attemptedVerified = true;
              if (receiptFailure) {
                throw new Error("receipt publication failed");
              }
            }
            return publishRemoteAgentRecoveryEvidence({
              cwd: repository,
              sourceSha,
              receipt: original.receipt,
              status,
              application,
              identity: appliedIdentity,
              recovery,
              now: recordedAt,
            });
          },
        });
      if (registryUnavailable) {
        await assert.rejects(execute(), REGISTRY_UNAVAILABLE);
        const failedRecovery = read();
        assert.equal(failedRecovery.receipt.status, "failed");
        assert.deepEqual(
          failedRecovery.verifiedHistoryBaseline,
          original.verifiedHistoryBaseline
        );
        assert.deepEqual(
          readNativeHistoryBaseline(
            repository,
            failedRecovery.verifiedHistoryBaseline
          ),
          original.verifiedHistoryBaseline
        );
        const history = readRemoteAgentRecoveryHistory(
          repository,
          failedRecovery
        );
        assert.deepEqual(history.recovery, recovery);
        assert.deepEqual(history.started.receipt, receipt);
        original = failedRecovery;
        recovery.originalEvidenceSha = failedRecovery.evidenceSha;
        recovery.startedAt = "2026-09-20T16:03:00.000Z";
        recovery.baseline = {
          ...baseline,
          workerDeploymentId: identity.deploymentId,
          workerVersionId: identity.versionId,
        };
        recovery.observedAfterFailure = undefined;
        recordedAt = "2026-09-20T16:04:00.000Z";
        registryUnavailable = false;
      }
      if (wrongDigest) {
        await assert.rejects(execute(), ROLLOUT_UNVERIFIED);
        assert.equal(read().receipt.status, "failed");
        assert.equal(read().receipt.application, "unknown");
        assert.equal(attemptedVerified, false);
      } else if (receiptFailure) {
        await assert.rejects(execute(), RECEIPT_PUBLICATION_FAILED);
        assert.equal(attemptedVerified, true);
        assert.equal(read().receipt.status, "failed");
        assert.equal(read().receipt.application, "unknown");
      } else {
        await execute();
        assert.equal(read().receipt.status, "verified");
        assert.equal(read().receipt.attemptId, ATTEMPT);
        assert.equal(read().receipt.identity.versionId, identity.versionId);
        if (unchanged) {
          assert.deepEqual(
            readNativeHistoryBaseline(repository, read()),
            original.verifiedHistoryBaseline
          );
        }
      }
      if (retained) {
        assert.deepEqual(read().receipt.remoteAgent, {
          ...original.receipt.remoteAgent,
          phase: wrongDigest || receiptFailure ? "rollout" : "complete",
        });
      } else {
        assert.equal(read().receipt.remoteAgent, undefined);
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
  });
}
