import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FIXTURE_VERSION,
  fixtureWorkerTarget,
  workerDeploymentResponse,
  writeDeploymentOutput,
} from "./fixtures/worker-deployment-output.mjs";
import {
  buildProductionDeployStepSpecs,
  executeProductionDeploySteps,
} from "./production-release.mjs";
import {
  publishGuardedLocalReleaseEvidence,
  readGuardedLocalReleaseSources,
} from "./production-release-evidence.mjs";
import { executeRecordedProductionDeploySteps } from "./production-release-receipts.mjs";

const PARTIAL_RECOVERY_ERROR = /failed partial|original|attempt/iu;
const FAILED_UNKNOWN_EVENT = /"status":"failed","application":"unknown"/u;
const VERIFIED_APPLIED_EVENT = /"status":"verified","application":"applied"/u;

test("publishes exact guarded local release sources for later status checks", () => {
  const fixture = createGitFixture();
  try {
    publishGuardedLocalReleaseEvidence({
      cwd: fixture.repository,
      now: "2026-08-30T17:00:00.000Z",
      remote: fixture.remote,
      scopes: ["cli", "core"],
      sourceSha: fixture.sourceSha,
    });

    assert.deepEqual(
      Object.fromEntries(
        readGuardedLocalReleaseSources({
          cwd: fixture.repository,
          remote: fixture.remote,
        })
      ),
      {
        cli: {
          recordedAt: "2026-08-30T17:00:00.000Z",
          sha: fixture.sourceSha,
          source: "guarded-local",
          url: undefined,
        },
        core: {
          recordedAt: "2026-08-30T17:00:00.000Z",
          sha: fixture.sourceSha,
          source: "guarded-local",
          url: undefined,
        },
      }
    );
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test("records a later successful redeploy of the same source SHA", () => {
  const fixture = createGitFixture();
  try {
    publishGuardedLocalReleaseEvidence({
      cwd: fixture.repository,
      now: "2026-08-30T17:00:00.000Z",
      remote: fixture.remote,
      scopes: ["web"],
      sourceSha: fixture.sourceSha,
    });
    const redeploy = publishGuardedLocalReleaseEvidence({
      cwd: fixture.repository,
      now: "2026-08-30T17:01:00.000Z",
      remote: fixture.remote,
      scopes: ["web"],
      sourceSha: fixture.sourceSha,
    });

    assert.equal(redeploy.published, true);
    assert.deepEqual(
      readGuardedLocalReleaseSources({
        cwd: fixture.repository,
        remote: fixture.remote,
      }).get("web"),
      {
        recordedAt: "2026-08-30T17:01:00.000Z",
        sha: fixture.sourceSha,
        source: "guarded-local",
        url: undefined,
      }
    );
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test("records an intentional rollback as the latest guarded local release", () => {
  const fixture = createGitFixture();
  try {
    const firstPublish = publishGuardedLocalReleaseEvidence({
      cwd: fixture.repository,
      now: "2026-08-30T17:00:00.000Z",
      remote: fixture.remote,
      scopes: ["web"],
      sourceSha: fixture.sourceSha,
    });
    const repeatedPublish = publishGuardedLocalReleaseEvidence({
      cwd: fixture.repository,
      now: "2026-08-30T17:01:00.000Z",
      remote: fixture.remote,
      scopes: ["web"],
      sourceSha: fixture.sourceSha,
    });
    const nextSourceSha = fixture.commit("next release evidence\n");
    const nextPublish = publishGuardedLocalReleaseEvidence({
      cwd: fixture.repository,
      now: "2026-08-30T17:02:00.000Z",
      remote: fixture.remote,
      scopes: ["web"],
      sourceSha: nextSourceSha,
    });

    assert.equal(firstPublish.published, true);
    assert.equal(repeatedPublish.published, true);
    assert.equal(nextPublish.published, true);
    const rollbackPublish = publishGuardedLocalReleaseEvidence({
      cwd: fixture.repository,
      now: "2026-08-30T17:03:00.000Z",
      remote: fixture.remote,
      scopes: ["web"],
      sourceSha: fixture.sourceSha,
    });
    assert.equal(rollbackPublish.published, true);
    assert.equal(
      readGuardedLocalReleaseSources({
        cwd: fixture.repository,
        remote: fixture.remote,
      }).get("web")?.sha,
      fixture.sourceSha
    );
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

const PERSIST_ERROR = /persist|fixture health/u;
const UNRESOLVED_ERROR = /unresolved|reconcil/iu;
const RECEIPT_ATTEMPT = "00000000-0000-4000-8000-000000000001";
const RECEIPT_ERROR = /cannot|older|requires|invalid|Completed|cover exactly/u;
const DEPLOY_ERROR = /fixture deploy failed/u;
const RECOVERY_BASELINE_ERROR = /original attempt or baseline/u;

test("extends legacy receipts, retries the same event idempotently and rejects changed or backward events", () => {
  const fixture = createGitFixture();
  const common = {
    cwd: fixture.repository,
    remote: fixture.remote,
    scopes: ["web"],
    sourceSha: fixture.sourceSha,
  };
  const read = () => readGuardedLocalReleaseSources(common).get("web");
  try {
    publishGuardedLocalReleaseEvidence({
      ...common,
      now: "2026-09-18T10:00:00.000Z",
    });
    assert.equal(read().receipt, undefined);
    const receipt = {
      attemptId: RECEIPT_ATTEMPT,
      componentIndex: 0,
      status: "started",
      application: "unknown",
    };
    publishGuardedLocalReleaseEvidence({
      ...common,
      receipts: { web: receipt },
      now: "2026-09-18T11:00:00.000Z",
    });
    const started = read();
    assert.equal(started.receipt.status, "started");
    publishGuardedLocalReleaseEvidence({
      ...common,
      receipts: { web: receipt },
      now: "2026-09-18T11:01:00.000Z",
    });
    assert.equal(read().evidenceSha, started.evidenceSha);
    const applied = {
      ...receipt,
      status: "applied",
      application: "applied",
      identity: {
        kind: "worker",
        versions: [{ versionId: "worker-1", percentage: 100 }],
      },
    };
    publishGuardedLocalReleaseEvidence({
      ...common,
      receipts: { web: applied },
      now: "2026-09-18T11:02:00.000Z",
    });
    const changed = {
      ...applied,
      identity: {
        kind: "worker",
        versions: [{ versionId: "wrong-worker", percentage: 100 }],
      },
    };
    assert.throws(
      () =>
        publishGuardedLocalReleaseEvidence({
          ...common,
          receipts: { web: changed },
          now: "2026-09-18T11:03:00.000Z",
        }),
      RECEIPT_ERROR
    );
    const verified = { ...applied, status: "verified" };
    publishGuardedLocalReleaseEvidence({
      ...common,
      receipts: { web: verified },
      now: "2026-09-18T11:04:00.000Z",
    });
    assert.throws(
      () =>
        publishGuardedLocalReleaseEvidence({
          ...common,
          receipts: { web: receipt },
          now: "2026-09-18T11:05:00.000Z",
        }),
      RECEIPT_ERROR
    );
    assert.equal(read().receipt.status, "verified");
    assert.throws(
      () =>
        publishGuardedLocalReleaseEvidence({
          ...common,
          receipts: {},
          now: "2026-09-18T11:06:00.000Z",
        }),
      RECEIPT_ERROR
    );
    assert.throws(
      () =>
        publishGuardedLocalReleaseEvidence({
          ...common,
          receipts: { web: { ...verified, identity: undefined } },
          now: "2026-09-18T11:06:00.000Z",
        }),
      RECEIPT_ERROR
    );
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test("a partial release remains reconstructable from real isolated Git receipts", async () => {
  const fixture = createGitFixture();
  let tick = 0;
  try {
    await assert.rejects(
      () =>
        executeRecordedProductionDeploySteps({
          sourceSha: fixture.sourceSha,
          steps: buildProductionDeployStepSpecs(["auth", "web"]),
          resolveWorkerTarget: fixtureWorkerTarget,
          readEvidence: () =>
            readGuardedLocalReleaseSources({
              cwd: fixture.repository,
              remote: fixture.remote,
            }),
          executeSteps: executeProductionDeploySteps,
          runCommand: () => workerDeploymentResponse(),
          executionAdapters: {
            runCommand: () => ({ status: 0, stdout: "[]" }),
            runStep: (step) => {
              if (step.label === "Deploy Web") {
                throw new Error("fixture deploy failed");
              }
              writeDeploymentOutput(step, fixture.sourceSha);
            },
          },
          publishEvidence: (event) =>
            publishGuardedLocalReleaseEvidence({
              ...event,
              cwd: fixture.repository,
              remote: fixture.remote,
            }),
          now: () =>
            new Date(Date.UTC(2026, 8, 18, 12, 0, tick++)).toISOString(),
          write: () => undefined,
        }),
      DEPLOY_ERROR
    );
    const state = readGuardedLocalReleaseSources({
      cwd: fixture.repository,
      remote: fixture.remote,
    });
    assert.equal(state.get("auth").receipt.status, "verified");
    assert.equal(state.get("auth").receipt.identity.versionId, FIXTURE_VERSION);
    assert.equal(state.get("web").receipt.status, "failed");
    assert.equal(state.get("web").receipt.application, "unknown");
    assert.equal(state.get("auth").sha, fixture.sourceSha);
    assert.equal(state.get("web").sha, fixture.sourceSha);
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

for (const failureStage of ["receipt", "health"]) {
  test(`fresh invocation recovers ${failureStage} failure without deploying again`, async () => {
    const fixture = createGitFixture();
    const common = {
      cwd: fixture.repository,
      remote: fixture.remote,
      scopes: ["web"],
      sourceSha: fixture.sourceSha,
    };
    const effects = [];
    let failVerified = true;
    const run = (options = {}) =>
      executeRecordedProductionDeploySteps({
        sourceSha: fixture.sourceSha,
        resolveWorkerTarget: fixtureWorkerTarget,
        steps: buildProductionDeployStepSpecs(["web"]),
        executeSteps: executeProductionDeploySteps,
        readEvidence: () => readGuardedLocalReleaseSources(common),
        runCommand: () => workerDeploymentResponse(),
        executionAdapters: {
          runCommand: () => ({ status: 0, stdout: "[]" }),
          runStep: (step) => {
            effects.push(step.label);
            writeDeploymentOutput(step, fixture.sourceSha);
            if (
              failureStage === "health" &&
              failVerified &&
              step.label === "Verify Web health"
            ) {
              failVerified = false;
              throw new Error("fixture health check failed");
            }
          },
        },
        publishEvidence: (event) => {
          if (
            failureStage === "receipt" &&
            event.receipts.web.status === "verified" &&
            failVerified
          ) {
            failVerified = false;
            throw new Error("fixture receipt unavailable");
          }
          return publishGuardedLocalReleaseEvidence({ ...event, ...common });
        },
        write: () => undefined,
        ...options,
      });
    try {
      await assert.rejects(run, PERSIST_ERROR);
      const retained = readGuardedLocalReleaseSources(common).get("web");
      assert.equal(
        retained.receipt.status,
        failureStage === "receipt" ? "applied" : "failed"
      );
      await assert.rejects(
        () => run({ sourceSha: "b".repeat(40) }),
        UNRESOLVED_ERROR
      );
      await assert.rejects(
        () =>
          run({
            resolveWorkerTarget: (input) => ({
              ...fixtureWorkerTarget(input),
              projectionTag: "another-projection",
            }),
          }),
        UNRESOLVED_ERROR
      );
      await assert.rejects(
        () =>
          run({
            runCommand: () =>
              workerDeploymentResponse({ versionId: "unrelated" }),
          }),
        UNRESOLVED_ERROR
      );
      assert.deepEqual(effects, ["Deploy Web", "Verify Web health"]);
      assert.equal(
        readGuardedLocalReleaseSources(common).get("web").evidenceSha,
        retained.evidenceSha
      );
      assert.throws(
        () =>
          publishGuardedLocalReleaseEvidence({
            ...common,
            receipts: {
              web: {
                attemptId: "00000000-0000-4000-8000-000000000099",
                componentIndex: 0,
                operationKey: retained.receipt.operationKey,
                startedAt: retained.receipt.startedAt,
                status: "started",
                application: "unknown",
              },
            },
          }),
        UNRESOLVED_ERROR
      );
      await run();
      const completed = readGuardedLocalReleaseSources(common).get("web");
      assert.equal(completed.receipt.status, "verified");
      assert.equal(completed.receipt.attemptId, retained.receipt.attemptId);
      assert.deepEqual(effects, [
        "Deploy Web",
        "Verify Web health",
        "Verify Web health",
      ]);
      await run();
      assert.equal(
        effects.length,
        3,
        "acknowledgement loss must not redeploy verified work"
      );
      await run({ redeploy: true });
      assert.equal(
        effects.filter((effect) => effect === "Deploy Web").length,
        2,
        "explicit later redeploy remains possible"
      );
      assert.notEqual(
        readGuardedLocalReleaseSources(common).get("web").receipt.attemptId,
        retained.receipt.attemptId
      );
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });
}

test("appends a linked partial recovery without rewriting the failed attempt", () => {
  const fixture = createGitFixture();
  const attemptId = "70bdb4d1-c057-4868-89ec-1f9c5ed9a1b2";
  const base = {
    attemptId,
    componentIndex: 4,
    operationKey: "a".repeat(64),
    startedAt: "2026-09-20T15:20:26.361Z",
    application: "unknown",
  };
  const publish = (receipt, recordedAt) =>
    publishGuardedLocalReleaseEvidence({
      cwd: fixture.repository,
      remote: fixture.remote,
      sourceSha: fixture.sourceSha,
      scopes: ["remote-agent"],
      receipts: { "remote-agent": receipt },
      now: recordedAt,
    });
  const read = () =>
    readGuardedLocalReleaseSources({
      cwd: fixture.repository,
      remote: fixture.remote,
    }).get("remote-agent");
  try {
    publish({ ...base, status: "started" }, "2026-09-20T15:20:33.062Z");
    publish({ ...base, status: "failed" }, "2026-09-20T15:22:12.913Z");
    const failed = read();
    const recovery = {
      id: "00000000-0000-4000-8000-000000000002",
      originalEvidenceSha: failed.evidenceSha,
      startedAt: "2026-09-20T16:00:00.000Z",
      baseline: {
        workerDeploymentId: "old-deployment",
        workerVersionId: "old-version",
        containerId: "container-id",
        containerVersion: 99,
        containerImage: "registry.cloudflare.com/example@sha256:old",
      },
    };
    assert.throws(
      () =>
        publish(
          {
            ...base,
            status: "started",
            recovery: { ...recovery, originalEvidenceSha: "b".repeat(40) },
          },
          "2026-09-20T16:00:01.000Z"
        ),
      PARTIAL_RECOVERY_ERROR
    );
    publish(
      { ...base, status: "started", recovery },
      "2026-09-20T16:00:02.000Z"
    );
    assert.throws(
      () =>
        publish(
          {
            ...base,
            status: "applied",
            application: "applied",
            identity: {
              kind: "worker-deployment",
              workerName: "openmeld-remote-agent-prod",
              environment: "prod",
              deploymentId: "new-deployment",
              versionId: "new-version",
              sourceSha: fixture.sourceSha,
              proof: "command-output",
            },
            recovery: {
              ...recovery,
              baseline: { ...recovery.baseline, containerVersion: 100 },
              completed: {
                containerVersion: 101,
                containerImage: "registry.cloudflare.com/example@sha256:new",
              },
            },
          },
          "2026-09-20T16:00:03.000Z"
        ),
      RECOVERY_BASELINE_ERROR
    );
    const identity = {
      kind: "worker-deployment",
      workerName: "openmeld-remote-agent-prod",
      environment: "prod",
      deploymentId: "new-deployment",
      versionId: "new-version",
      sourceSha: fixture.sourceSha,
      proof: "command-output",
    };
    const complete = {
      ...recovery,
      completed: {
        containerVersion: 100,
        containerImage: "registry.cloudflare.com/example@sha256:new",
      },
    };
    publish(
      {
        ...base,
        status: "applied",
        application: "applied",
        identity,
        recovery: complete,
      },
      "2026-09-20T16:01:00.000Z"
    );
    publish(
      {
        ...base,
        status: "verified",
        application: "applied",
        identity,
        recovery: complete,
      },
      "2026-09-20T16:01:01.000Z"
    );
    const verified = read();
    assert.equal(verified.receipt.status, "verified");
    assert.equal(verified.receipt.attemptId, attemptId);
    assert.equal(
      verified.receipt.recovery.originalEvidenceSha,
      failed.evidenceSha
    );
    const parentChain = execFileSync(
      "git",
      ["log", "-4", "--format=%s", verified.evidenceSha],
      { cwd: fixture.repository, encoding: "utf8" }
    );
    assert.match(parentChain, FAILED_UNKNOWN_EVENT);
    assert.match(parentChain, VERIFIED_APPLIED_EVENT);
    const nextAttempt = {
      attemptId: "00000000-0000-4000-8000-000000000003",
      componentIndex: 0,
      operationKey: "c".repeat(64),
      startedAt: "2026-09-20T16:02:00.000Z",
      status: "started",
      application: "unknown",
    };
    publish(nextAttempt, "2026-09-20T16:02:01.000Z");
    assert.deepEqual(read().receipt, nextAttempt);
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

function createGitFixture() {
  const root = mkdtempSync(
    path.join(tmpdir(), "openmeld-production-release-evidence-")
  );
  const repository = path.join(root, "repository");
  const remote = path.join(root, "remote.git");
  const git = (cwd, ...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  git(root, "init", "--bare", "--quiet", remote);
  git(root, "init", "--initial-branch=main", "--quiet", repository);
  git(repository, "config", "user.email", "release-evidence@test.openmeld.ai");
  git(repository, "config", "user.name", "OpenMeld Release Evidence Test");
  writeFileSync(path.join(repository, "README.md"), "release evidence\n");
  git(repository, "add", "README.md");
  git(repository, "commit", "--quiet", "-m", "seed release evidence");
  git(repository, "remote", "add", "origin", remote);
  git(repository, "push", "--quiet", "-u", "origin", "main");

  return {
    commit(contents) {
      writeFileSync(path.join(repository, "README.md"), contents);
      git(repository, "add", "README.md");
      git(repository, "commit", "--quiet", "-m", "advance release evidence");
      git(repository, "push", "--quiet", "origin", "main");
      return git(repository, "rev-parse", "HEAD");
    },
    remote,
    repository,
    root,
    sourceSha: git(repository, "rev-parse", "HEAD"),
  };
}
