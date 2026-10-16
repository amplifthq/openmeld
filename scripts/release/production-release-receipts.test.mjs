import assert from "node:assert/strict";
import test from "node:test";
import { productionComponentReceiptSchema } from "../../packages/schemas/src/schemas/release/production-release-evidence.ts";
import {
  cliProjectionResult,
  FIXTURE_DEPLOYMENT,
  fixtureWorkerTarget,
  workerDeploymentResponse,
  writeDeploymentOutput,
} from "./fixtures/worker-deployment-output.mjs";
import {
  buildProductionDeployStepSpecs,
  executeProductionDeploySteps,
  executeWithProductionScopeLeases,
} from "./production-release.mjs";
import {
  describeGuardedReceiptRecoveryCandidate,
  executeRecordedProductionDeploySteps,
  groupReleaseSteps,
  readPostgresqlRollbackBaseline,
  releaseComponentOperationKey,
} from "./production-release-receipts.mjs";
import { runProductionStageAdmission } from "./production-stage-admission.mjs";

const IDENTITY_ERROR = /output|correlat|identity|Worker|target/iu;
const BASELINE_ERROR = /baseline/iu;
const UNRESOLVED_ERROR = /unresolved|reconcil/iu;
const POSTGRESQL_RETRY_ERROR = /unresolved|baseline|reconcile/iu;
const SOURCE = "a".repeat(40);
const ATTEMPT = "00000000-0000-4000-8000-000000000001";
const WORKER_VERSION = "23863082-db0f-4cfe-a91b-69c570ee1578";
const CLI_ARTIFACT_SHA = "b".repeat(64);
const FAILURE = /fixture failure|persist|boundary|Worker|completion|executor/u;
const NATIVE_DRIFT = /native drift/u;
const RECEIPT_CAUSE = /Could not persist.*Cause: fixture receipt failure/u;

function fixture(options = {}) {
  const receipts = [],
    effects = [],
    latest = new Map(),
    sources = new Map(),
    released = [];
  const workerResponse = workerDeploymentResponse(options);
  let workerVerificationRead = 0;
  const scopes = options.scopes ?? [
    "auth",
    "web",
    "gateway",
    "core",
    "remote-agent",
  ];
  const steps = buildProductionDeployStepSpecs(scopes);
  const run = () =>
    executeWithProductionScopeLeases({
      sourceSha: SOURCE,
      scopes,
      owner: "test-only",
      adapters: {
        acquireProductionScopeLease: ({ scope }) => ({
          leaseSha: SOURCE,
          metadata: { scope },
        }),
        releaseProductionScopeLease: ({ scope }) => {
          released.push(scope);
        },
      },
      execute: () =>
        executeRecordedProductionDeploySteps({
          sourceSha: options.sourceSha ?? SOURCE,
          retainContainers: options.retainContainers,
          readRetainedContainer: options.readRetainedContainer,
          verifyNativeCompletion: options.verifyNativeCompletion,
          attemptId: options.attemptId ?? ATTEMPT,
          sourceIsAncestor: options.sourceIsAncestor,
          compareGitPathContents: options.compareGitPathContents,
          resolveWorkerTarget: fixtureWorkerTarget,
          readCliCompletion: () => cliProjectionResult(SOURCE),
          readEvidence: () => {
            if (options.readFailure) {
              throw new Error("fixture receipt read failed");
            }
            return new Map(
              [...latest].map(([scope, receipt]) => [
                scope,
                {
                  sha: sources.get(scope) ?? SOURCE,
                  evidenceSha: options.evidenceSha,
                  receipt,
                  verifiedHistoryBaseline: options.baseline,
                },
              ])
            );
          },
          steps: options.steps ?? steps,
          executeSteps: executeProductionDeploySteps,
          runCommand: (input) => {
            if (input.args?.[1] === "verify-retry-baseline") {
              return {
                status: options.baselineProofFailure ? 1 : 0,
                stdout: JSON.stringify(options.baselineProof),
              };
            }
            return options.identityFailure
              ? { status: 1 }
              : (options.workerVerificationResponses?.[
                  workerVerificationRead++
                ] ?? workerResponse);
          },
          executionAdapters: {
            runCommand: () =>
              options.baselineFailure
                ? { status: 1, stderr: "fixture baseline unavailable" }
                : workerDeploymentResponse({ deployments: [] }),
            runStep: (step) => {
              effects.push(step.label);
              if (step.label === options.failureAt) {
                throw new Error("fixture failure");
              }
              writeDeploymentOutput(step, SOURCE, options);
            },
            publishCliRelease: () => {
              effects.push("publish-cli");
              return {
                ...cliProjectionResult(SOURCE),
                receiptIdentity: {
                  artifact: {
                    archiveFormat: "gzip",
                    archiveSha256: "c".repeat(64),
                    archiveSizeBytes: 50,
                    archiveUrl:
                      "https://openmeld.ai/cli/openmeld-cli-darwin-arm64-0.3.217.gz",
                    platform: "darwin-arm64",
                    sha256: CLI_ARTIFACT_SHA,
                    sizeBytes: 100,
                    url: "https://openmeld.ai/cli/openmeld-cli-darwin-arm64-0.3.217",
                  },
                  kind: "cli-release",
                  npmPackage: "openmeld",
                  tagName: "v0.3.217",
                  version: "0.3.217",
                },
              };
            },
          },
          publishEvidence: (event) => {
            if (
              Object.values(event.receipts).some(
                (receipt) => receipt.status === options.receiptFailure
              )
            ) {
              throw new Error("fixture receipt failure");
            }
            for (const [scope, receipt] of Object.entries(event.receipts)) {
              productionComponentReceiptSchema.parse(receipt);
              latest.set(scope, receipt);
              sources.set(scope, event.sourceSha);
            }
            receipts.push(event);
          },
          write: () => undefined,
        }),
    });
  return { run, receipts, effects, latest, released, sources };
}

for (const [failure, baseline] of [
  ["none", "active"],
  ["none", "empty"],
  ["container-drift", "empty"],
  ["worker-drift", "active"],
  ["receipt-write", "active"],
]) {
  test(`Worker-only release retains native provenance through explicit rollout (${failure}, ${baseline})`, async () => {
    const native = {
      id: "app",
      name: "openmeld-agent-computer",
      version: 124,
      image: `registry.cloudflare.com/account/openmeld-agent-computer@sha256:${"d".repeat(64)}`,
      configurationHash: "c".repeat(64),
      instances:
        baseline === "empty" ? [] : [{ id: "original-instance", version: 124 }],
    };
    let nativeChecks = 0;
    const options = {
      scopes: ["remote-agent"],
      evidenceSha: "e".repeat(40),
      retainContainers: true,
      steps: buildProductionDeployStepSpecs(["remote-agent"], {
        retainContainers: true,
      }),
      readRetainedContainer: (_input, expected) => {
        if (expected) {
          assert.deepEqual(expected, native);
          if (failure === "container-drift") {
            throw new Error("native drift");
          }
        }
        return native;
      },
      verifyNativeCompletion: (_input, retained, identity) => {
        assert.deepEqual(retained, native);
        assert.equal(identity.sourceSha, SOURCE);
        nativeChecks += 1;
        options.identityFailure = failure === "worker-drift";
      },
    };
    const result = fixture(options);
    result.latest.set("remote-agent", {
      attemptId: "00000000-0000-4000-8000-000000000002",
      componentIndex: 0,
      operationKey: "f".repeat(64),
      startedAt: "2026-01-01T00:00:00Z",
      status: "verified",
      application: "applied",
      identity: {
        kind: "worker-deployment",
        workerName: "openmeld-remote-agent-prod",
        environment: "prod",
        deploymentId: FIXTURE_DEPLOYMENT,
        versionId: WORKER_VERSION,
        sourceSha: "b".repeat(40),
        proof: "command-output",
      },
    });
    result.sources.set("remote-agent", "b".repeat(40));
    if (failure === "container-drift") {
      await assert.rejects(result.run, NATIVE_DRIFT);
      const failed = result.latest.get("remote-agent");
      assert.equal(failed.status, "failed");
      assert.equal(failed.application, "applied");
      assert.equal(failed.identity.versionId, WORKER_VERSION);
      assert.equal(failed.remoteAgent.phase, "worker-only");
      assert.equal(nativeChecks, 0);
      assert.deepEqual(result.effects, ["Deploy Remote Agent Worker"]);
      assert.deepEqual(result.released, ["remote-agent"]);
      return;
    }
    await result.run();
    const partial = result.latest.get("remote-agent");
    assert.equal(partial.status, "applied");
    assert.equal(partial.remoteAgent.phase, "retained");
    assert.deepEqual(partial.remoteAgent.container, native);
    assert.equal(partial.remoteAgent.baselineSourceSha, "b".repeat(40));
    assert.equal(nativeChecks, 0);
    const effects = result.effects.length;
    await result.run();
    assert.equal(
      result.effects.length,
      effects,
      "repeated Worker-only release must not deploy again"
    );
    options.readRetainedContainer = () => {
      throw new Error("native drift");
    };
    options.retainContainers = false;
    options.steps = buildProductionDeployStepSpecs(["remote-agent"]);
    await assert.rejects(result.run, NATIVE_DRIFT);
    assert.equal(result.effects.length, effects);
    options.readRetainedContainer = () => native;
    if (failure === "worker-drift") {
      await assert.rejects(result.run, IDENTITY_ERROR);
      assert.equal(result.latest.get("remote-agent").status, "failed");
      assert.equal(nativeChecks, 1);
      return;
    }
    if (failure === "receipt-write") {
      options.receiptFailure = "verified";
      await assert.rejects(result.run, RECEIPT_CAUSE);
      const applied = result.latest.get("remote-agent");
      assert.equal(applied.status, "applied");
      assert.equal(applied.remoteAgent.phase, "rollout");
      const deployedEffects = result.effects.length;
      options.receiptFailure = undefined;
      options.readRetainedContainer = () =>
        assert.fail("must not require the replaced native version");
      options.verifyNativeCompletion = () => {
        throw new Error("native drift");
      };
      await assert.rejects(result.run, NATIVE_DRIFT);
      assert.deepEqual(result.latest.get("remote-agent"), applied);
      options.verifyNativeCompletion = () => {
        options.identityFailure = true;
      };
      await assert.rejects(result.run, IDENTITY_ERROR);
      assert.deepEqual(result.latest.get("remote-agent"), applied);
      options.identityFailure = false;
      options.verifyNativeCompletion = (_input, retained, identity) => {
        assert.deepEqual(retained, native);
        assert.deepEqual(identity, applied.identity);
      };
      await result.run();
      assert.equal(
        result.effects.length,
        deployedEffects,
        "verification must not deploy or replay any step"
      );
      assert.equal(
        result.latest.get("remote-agent").startedAt,
        applied.startedAt
      );
    } else {
      await result.run();
    }
    const complete = result.latest.get("remote-agent");
    assert.equal(complete.status, "verified");
    assert.equal(complete.remoteAgent.phase, "complete");
    assert.equal(complete.attemptId, partial.attemptId);
    assert.equal(complete.operationKey, partial.operationKey);
    assert.equal(nativeChecks, 1);
    assert.throws(() =>
      productionComponentReceiptSchema.parse({ ...partial, status: "verified" })
    );
  });
}

test("keeps verified components visible when a later component fails, with all leases released", async () => {
  const result = fixture({ failureAt: "Deploy Remote Agent Worker" });
  await assert.rejects(result.run, FAILURE);
  for (const scope of ["auth", "web", "gateway", "core"]) {
    assert.equal(result.latest.get(scope).status, "verified", scope);
    assert.equal(result.latest.get(scope).identity.versionId, WORKER_VERSION);
  }
  assert.equal(result.latest.get("remote-agent").status, "failed");
  assert.equal(result.latest.get("remote-agent").application, "unknown");
  assert.equal(result.latest.get("remote-agent").identity, undefined);
  assert.equal(new Set(result.released).size, 5);
  assert.equal(
    result.effects.includes("Verify Remote Agent deployment is visible"),
    false
  );
});

test("records health failure after application without claiming the version was never applied", async () => {
  const result = fixture({
    scopes: ["web", "gateway"],
    failureAt: "Verify Web health",
  });
  await assert.rejects(result.run, FAILURE);
  assert.equal(result.latest.get("web").status, "failed");
  assert.equal(result.latest.get("web").application, "applied");
  assert.equal(result.latest.get("web").identity.versionId, WORKER_VERSION);
  assert.equal(result.latest.has("gateway"), false);
});

test("retries rejected Core under the original attempt only while the prior deployment is unchanged", async () => {
  const options = { scopes: ["core"] };
  const result = fixture(options);
  await result.run();
  options.baseline = {
    sha: SOURCE,
    recordedAt: "2026-01-01T00:00:00.000Z",
    receipt: result.latest.get("core"),
  };
  const rejected = {
    ...result.latest.get("core"),
    status: "failed",
    application: "unknown",
    identity: undefined,
  };
  result.latest.set("core", rejected);
  const priorEffects = result.effects.length;
  for (const override of [
    { operationKey: "b".repeat(64) },
    { startedAt: "2025-01-01T00:00:00.000Z" },
  ]) {
    result.latest.set("core", { ...rejected, ...override });
    await assert.rejects(result.run, UNRESOLVED_ERROR);
    assert.equal(result.effects.length, priorEffects);
  }
  result.latest.set("core", rejected);
  options.identityFailure = true;
  await assert.rejects(result.run, IDENTITY_ERROR);
  assert.equal(result.effects.length, priorEffects);
  options.identityFailure = false;
  options.workerVerificationResponses = new Array(20).fill(
    workerDeploymentResponse({
      deploymentId: "changed-deployment-even-with-the-same-version",
    })
  );
  await assert.rejects(result.run, IDENTITY_ERROR);
  assert.equal(result.effects.length, priorEffects);
  options.workerVerificationResponses = undefined;
  const priorEvents = result.receipts.length;
  await result.run();
  assert.deepEqual(
    result.receipts.slice(priorEvents).map((e) => e.receipts.core.status),
    ["applied", "verified"]
  );
  assert.equal(result.latest.get("core").attemptId, rejected.attemptId);
  assert.equal(result.latest.get("core").startedAt, rejected.startedAt);
  assert.equal(result.latest.get("core").operationKey, rejected.operationKey);
});

test("native database recovery verifies the journal and grants without repeating mutations", async () => {
  const options = {
    scopes: ["db"],
    steps: buildProductionDeployStepSpecs(["db"], {
      databaseBackend: "postgresql",
    }),
    failureAt: "PostgreSQL database: migrate",
  };
  const result = fixture(options);
  await assert.rejects(result.run, FAILURE);
  const original = { ...result.latest.get("db") };
  const recovery = describeGuardedReceiptRecoveryCandidate(
    { sha: SOURCE, receipt: original },
    "db"
  );
  assert.equal(recovery.kind, "guarded-health-resume");

  options.failureAt = "PostgreSQL database: verify";
  await assert.rejects(result.run, FAILURE);
  assert.deepEqual(result.latest.get("db"), original);

  options.failureAt = undefined;
  await result.run();
  assert.deepEqual(result.effects, [
    "PostgreSQL database: migrate",
    "PostgreSQL database: verify",
    "PostgreSQL database: verify",
  ]);
  assert.deepEqual(result.latest.get("db"), {
    ...original,
    status: "verified",
    application: "applied",
    identity: { kind: "release-source" },
  });
  assert.equal(result.released.filter((scope) => scope === "db").length, 3);
});

test("native database recovery rejects a different operation before verification", async () => {
  const options = {
    scopes: ["db"],
    steps: buildProductionDeployStepSpecs(["db"], {
      databaseBackend: "postgresql",
    }),
    failureAt: "PostgreSQL database: migrate",
  };
  const result = fixture(options);
  await assert.rejects(result.run, FAILURE);
  result.latest.get("db").operationKey = "0".repeat(64);
  options.failureAt = undefined;
  await assert.rejects(result.run, UNRESOLVED_ERROR);
  assert.deepEqual(result.effects, ["PostgreSQL database: migrate"]);
});

function postgresqlRetryOptions() {
  const steps = buildProductionDeployStepSpecs(["db"], {
    databaseBackend: "postgresql",
  });
  const group = groupReleaseSteps(steps)[0];
  const baselineSha = "b".repeat(40);
  return {
    scopes: ["db"],
    steps,
    failureAt: "PostgreSQL database: migrate",
    evidenceSha: "c".repeat(40),
    sourceIsAncestor: () => true,
    compareGitPathContents: () => true,
    baselineProof: {
      baselineSourceSha: baselineSha,
      runtimeGrantsVerified: true,
    },
    baseline: {
      sha: baselineSha,
      evidenceSha: "d".repeat(40),
      recordedAt: "2026-01-01T00:00:00.000Z",
      receipt: {
        attemptId: "00000000-0000-4000-8000-000000000002",
        componentIndex: 0,
        operationKey: releaseComponentOperationKey({
          sourceSha: baselineSha,
          group,
          target: null,
        }),
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "verified",
        application: "applied",
        identity: { kind: "release-source" },
      },
    },
  };
}

test("a proved PostgreSQL rollback starts a new-source attempt while retaining the old failure", async () => {
  const options = postgresqlRetryOptions();
  const result = fixture(options);
  await assert.rejects(result.run, FAILURE);
  const original = structuredClone(result.receipts.at(-1));
  options.sourceSha = "e".repeat(40);
  options.attemptId = "00000000-0000-4000-8000-000000000003";
  options.failureAt = undefined;
  await result.run();
  assert.deepEqual(result.effects, [
    "PostgreSQL database: migrate",
    "PostgreSQL database: migrate",
    "PostgreSQL database: grant-runtime",
    "PostgreSQL database: verify",
  ]);
  assert.deepEqual(result.receipts[1], original);
  const start = result.receipts[2];
  assert.equal(start.sourceSha, options.sourceSha);
  assert.equal(start.receipts.db.status, "started");
  assert.equal(start.reconciliation.db.supersededReceipt.sourceSha, SOURCE);
  assert.equal(
    start.reconciliation.db.baselineReceipt.sourceSha,
    options.baseline.sha
  );
  assert.equal(result.latest.get("db").status, "verified");
  assert.notEqual(
    result.latest.get("db").attemptId,
    original.receipts.db.attemptId
  );
});

test("PostgreSQL forward retry refuses missing, changed, or unproved baseline before any new effect", async () => {
  for (const change of [
    (options) => {
      options.baseline = undefined;
    },
    (options) => {
      options.baseline.receipt.status = "failed";
    },
    (options) => {
      options.baseline.receipt.operationKey = "0".repeat(64);
    },
    (options) => {
      options.compareGitPathContents = () => false;
    },
    (options) => {
      options.sourceIsAncestor = () => false;
    },
    (options) => {
      options.baselineProofFailure = true;
    },
    (options) => {
      options.steps[0].internalOperation = "fixture-unexpected-operation";
    },
    (options) => {
      options.baselineProof.baselineSourceSha = SOURCE;
    },
  ]) {
    const options = postgresqlRetryOptions();
    const result = fixture(options);
    await assert.rejects(result.run, FAILURE);
    const before = structuredClone(result.receipts);
    options.sourceSha = "e".repeat(40);
    options.failureAt = undefined;
    change(options);
    await assert.rejects(result.run, POSTGRESQL_RETRY_ERROR);
    assert.deepEqual(result.effects, ["PostgreSQL database: migrate"]);
    assert.deepEqual(result.receipts, before);
  }
});

test("PostgreSQL retry admission stays narrow for applied or malformed retained attempts", () => {
  const options = postgresqlRetryOptions();
  const group = groupReleaseSteps(options.steps)[0];
  const source = {
    sha: SOURCE,
    evidenceSha: options.evidenceSha,
    verifiedHistoryBaseline: options.baseline,
    receipt: {
      ...options.baseline.receipt,
      status: "failed",
      application: "unknown",
      identity: undefined,
      operationKey: releaseComponentOperationKey({
        sourceSha: SOURCE,
        group,
        target: null,
      }),
    },
  };
  const input = { ...options, sourceSha: "e".repeat(40) };
  assert.equal(readPostgresqlRollbackBaseline(source, input), options.baseline);
  assert.equal(
    describeGuardedReceiptRecoveryCandidate(source, "db", input).sourceSha,
    input.sourceSha
  );
  for (const receipt of [
    {
      ...source.receipt,
      status: "applied",
      application: "applied",
      identity: { kind: "release-source" },
    },
    { ...source.receipt, operationKey: "0".repeat(64) },
    { ...source.receipt, status: "started" },
  ]) {
    assert.equal(
      readPostgresqlRollbackBaseline({ ...source, receipt }, input),
      null
    );
  }
});

test("a failed applied receipt resumes health under the same lease without redeploying", async () => {
  const options = { scopes: ["web"], failureAt: "Verify Web health" };
  const result = fixture(options);

  await assert.rejects(result.run, FAILURE);
  const failedSource = {
    receipt: result.latest.get("web"),
    sha: SOURCE,
  };
  const recovery = describeGuardedReceiptRecoveryCandidate(failedSource);
  assert.deepEqual(recovery, {
    admission: "candidate",
    attemptId: ATTEMPT,
    componentIndex: 0,
    kind: "guarded-health-resume",
    operationKey: failedSource.receipt.operationKey,
    sourceSha: SOURCE,
  });
  await admitRecovery(recovery);

  options.failureAt = undefined;
  await result.run();

  assert.equal(
    result.effects.filter((effect) => effect === "Deploy Web").length,
    1
  );
  assert.equal(
    result.effects.filter((effect) => effect === "Verify Web health").length,
    2
  );
  assert.equal(result.latest.get("web").status, "verified");
  assert.equal(result.released.filter((scope) => scope === "web").length, 2);
});

test("health recovery rejects operation drift before any second-run effect", async () => {
  const options = { scopes: ["web"], failureAt: "Verify Web health" };
  const result = fixture(options);
  await assert.rejects(result.run, FAILURE);
  const effectsAfterFailure = [...result.effects];
  await admitRecovery(
    describeGuardedReceiptRecoveryCandidate({
      receipt: result.latest.get("web"),
      sha: SOURCE,
    })
  );

  options.failureAt = undefined;
  options.steps = buildProductionDeployStepSpecs(["web"]).map((step) =>
    step.label === "Verify Web health"
      ? { ...step, args: [...step.args, "--operation-drift"] }
      : step
  );
  await assert.rejects(result.run, UNRESOLVED_ERROR);

  assert.deepEqual(result.effects, effectsAfterFailure);
  assert.equal(result.latest.get("web").status, "failed");
});

async function admitRecovery(recovery) {
  return await runProductionStageAdmission({
    collectStatus: async () => ({
      blockers: [
        {
          detail: "retained failed/applied receipt",
          name: "web deployment evidence",
          scope: "web",
          scopes: ["web"],
        },
      ],
      components: [
        {
          reason: "retained failed/applied receipt",
          recovery,
          scope: "web",
          state: "unknown",
        },
      ],
      sourceValidationBlockers: [],
    }),
    scope: "web",
    sourceSha: SOURCE,
    write: () => undefined,
  });
}

test("recovery candidates require exact applied Worker receipt identity", () => {
  const receipt = {
    application: "applied",
    attemptId: ATTEMPT,
    componentIndex: 0,
    identity: {
      deploymentId: "deployment",
      environment: "prod",
      kind: "worker-deployment",
      proof: "command-output",
      sourceSha: SOURCE,
      versionId: "version",
      workerName: "openmeld-web-prod",
    },
    operationKey: "d".repeat(64),
    startedAt: "2026-09-22T00:00:00.000Z",
    status: "failed",
  };
  for (const source of [
    { sha: "short", receipt },
    { sha: SOURCE, receipt: { ...receipt, application: "unknown" } },
    { sha: SOURCE, receipt: { ...receipt, identity: undefined } },
    {
      sha: SOURCE,
      receipt: {
        ...receipt,
        identity: { ...receipt.identity, sourceSha: "b".repeat(40) },
      },
    },
  ]) {
    assert.equal(describeGuardedReceiptRecoveryCandidate(source), null);
  }
});

test("stops safely on receipt or identity failure, retaining the last durable event", async () => {
  for (const receiptFailure of ["started", "applied", "verified"]) {
    const result = fixture({ scopes: ["web", "gateway"], receiptFailure });
    await assert.rejects(result.run, FAILURE);
    assert.equal(
      result.latest.get("web")?.status,
      { started: undefined, applied: "started", verified: "applied" }[
        receiptFailure
      ]
    );
    assert.equal(result.latest.has("gateway"), false);
    assert.equal(
      result.effects.length,
      { started: 0, applied: 1, verified: 2 }[receiptFailure]
    );
    assert.equal(result.released.length, 2);
  }
  const unknown = fixture({ scopes: ["web"], identityFailure: true });
  await assert.rejects(unknown.run, FAILURE);
  assert.equal(unknown.latest.get("web").status, "failed");
  assert.equal(unknown.latest.get("web").application, "applied");
  assert.equal(unknown.latest.get("web").identity, undefined);
});

test("records CLI and its Core projection together without changing guarded publication steps", async () => {
  const result = fixture({ scopes: ["cli"] });
  await result.run();
  assert.deepEqual(result.effects, ["publish-cli", "publish-cli"]);
  assert.deepEqual(result.released, ["core", "cli"]);
  assert.equal(result.latest.get("cli").status, "verified");
  assert.deepEqual(result.latest.get("cli").identity, {
    artifact: {
      archiveFormat: "gzip",
      archiveSha256: "c".repeat(64),
      archiveSizeBytes: 50,
      archiveUrl:
        "https://openmeld.ai/cli/openmeld-cli-darwin-arm64-0.3.217.gz",
      platform: "darwin-arm64",
      sha256: CLI_ARTIFACT_SHA,
      sizeBytes: 100,
      url: "https://openmeld.ai/cli/openmeld-cli-darwin-arm64-0.3.217",
    },
    kind: "cli-release",
    npmPackage: "openmeld",
    tagName: "v0.3.217",
    version: "0.3.217",
  });
  assert.equal(result.latest.get("core").identity.versionId, WORKER_VERSION);
  assert.equal(
    result.receipts.every((event) => event.scopes.join(",") === "cli,core"),
    true
  );
  assert.equal(result.latest.get("core").componentIndex, 1);
});

test("a retained unresolved attempt and unreadable receipts stop all new effects", async () => {
  for (const status of ["started", "applied", "failed"]) {
    const result = fixture({ scopes: ["web"] });
    result.latest.set("web", {
      attemptId: ATTEMPT,
      componentIndex: 0,
      status,
      application: "unknown",
    });
    await assert.rejects(result.run, UNRESOLVED_ERROR);
    assert.equal(result.effects.length, 0);
    assert.equal(result.receipts.length, 0);
    assert.deepEqual(result.released, ["web"]);
  }
});

test("CLI/Core applied receipts are reconciled through read-only completion without publishing twice", async () => {
  const options = { scopes: ["cli"], receiptFailure: "verified" };
  const result = fixture(options);
  await assert.rejects(result.run, FAILURE);
  options.receiptFailure = undefined;
  await result.run();
  assert.deepEqual(result.effects, ["publish-cli"]);
  assert.equal(result.latest.get("cli").status, "verified");
  assert.equal(result.latest.get("core").status, "verified");
});

test("unreadable prior receipts fail closed before attempts or side effects", async () => {
  const result = fixture({ scopes: ["web"], readFailure: true });
  await assert.rejects(result.run);
  assert.equal(result.effects.length, 0);
  assert.equal(result.receipts.length, 0);
  assert.deepEqual(result.released, ["web"]);
});

test("unreadable deployment baseline stops before receipts or deployment", async () => {
  const result = fixture({ scopes: ["web"], baselineFailure: true });
  await assert.rejects(result.run, BASELINE_ERROR);
  assert.equal(result.effects.length, 0);
  assert.equal(result.receipts.length, 0);
  assert.equal(result.latest.size, 0);
});

test("does not certify a current version without the deployment command's identity", async () => {
  const result = fixture({ scopes: ["web"], omitOutput: true });
  await assert.rejects(result.run, IDENTITY_ERROR);
  assert.notEqual(result.latest.get("web")?.status, "verified");
});

test("does not verify a deployment replaced during health checks", async () => {
  const replacementId = "00000000-0000-4000-8000-000000000999";
  const result = fixture({
    scopes: ["web"],
    workerVerificationResponses: [
      workerDeploymentResponse(),
      workerDeploymentResponse({ deploymentId: replacementId }),
    ],
  });
  await assert.rejects(result.run, IDENTITY_ERROR);
  assert.equal(result.latest.get("web").status, "failed");
  assert.equal(result.latest.get("web").application, "applied");
  assert.notEqual(result.latest.get("web").status, "verified");
});

test("rejects stale output, wrong Worker/environment, wrong live version and wrong Core projection", async () => {
  for (const options of [
    { event: { timestamp: "2025-01-01T00:00:00.000Z" } },
    { event: { worker_name: "another-worker" } },
    { event: { wrangler_environment: "stg" } },
    { versionId: "unrelated-version" },
    { scopes: ["core"], event: { source_sha: "b".repeat(40) } },
    {
      scopes: ["core"],
      event: { projection_tag: "same-source-different-projection" },
    },
  ]) {
    const result = fixture({ scopes: ["web"], ...options });
    await assert.rejects(result.run, IDENTITY_ERROR);
    assert.equal(
      [...result.latest.values()].some(
        (receipt) => receipt.status === "verified"
      ),
      false
    );
  }
});

test("rejects an incomplete component boundary before receipts or deployment", async () => {
  const result = fixture({
    scopes: ["web"],
    steps: buildProductionDeployStepSpecs(["web"]).slice(0, 1),
  });
  await assert.rejects(result.run, FAILURE);
  assert.equal(result.receipts.length, 0);
  assert.equal(result.effects.length, 0);
});
