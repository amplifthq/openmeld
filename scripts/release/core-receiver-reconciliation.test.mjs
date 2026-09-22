import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assessCoreReceiverProvenance,
  CORE_RECEIVER_INCIDENT as incident,
  reconcileCoreReceiverEvidence,
} from "./core-receiver-reconciliation.mjs";

const REFUSED = /reconciliation refused/u;
const ALIGNMENT = /alignment failed/u;
const CATALOG = /catalog:/u;
function evidence() {
  return {
    ...JSON.parse(
      readFileSync(
        new URL("./fixtures/core-receiver-35752925516.json", import.meta.url)
      )
    ),
    archiveSha256: incident.artifactSha256,
    projection: {
      channelVersion: "0.3.217",
      tagName: "v0.3.217",
      tagCommitSha: incident.stableSourceSha,
      expectedCoreTag: incident.projectionTag,
      releaseManifestSha256: incident.manifestSha256,
    },
    remoteTagSha: incident.stableSourceSha,
  };
}
function fixture() {
  const events = [];
  let retained = {
    evidenceSha: incident.supersededReceiptSha,
    sha: incident.supersededSourceSha,
    recordedAt: "2026-09-20T18:06:43.275Z",
    receipt: { status: "failed", application: "unknown" },
  };
  const input = {
    provenance: evidence(),
    operationKey: "f".repeat(64),
    readEvidence: () => new Map(retained ? [["core", retained]] : []),
    verifyLive: () => ({
      kind: "worker-deployment",
      sourceSha: incident.sourceSha,
      workerName: incident.workerName,
      environment: "prod",
      deploymentId: incident.deploymentId,
      versionId: incident.versionId,
      projectionTag: incident.projectionTag,
      proof: "reconciled-hosted",
    }),
    verifyAlignment: () => ({
      npm: { portabilityIssue: "dependencies.zod=catalog:" },
    }),
    publishEvidence: (event) => {
      retained = {
        ...retained,
        sha: event.sourceSha,
        receipt: event.receipts.core,
        reconciliation: event.reconciliation?.core ?? retained?.reconciliation,
      };
      events.push(event);
    },
  };
  return { input, events };
}

test("reconciles the captured incident only after independent provenance and active identity agree", async () => {
  const f = fixture();
  await reconcileCoreReceiverEvidence({ ...f.input, verifyOnly: true });
  assert.deepEqual(f.events, []);
  const result = await reconcileCoreReceiverEvidence(f.input);
  assert.equal(result.mode, "reconciled");
  assert.equal(result.reconciliation.runAttempt, 1);
  assert.match(result.alignment.npm.portabilityIssue, CATALOG);
  assert.deepEqual(
    f.events.map((event) => event.receipts.core.status),
    ["applied", "verified"]
  );
  assert.equal(f.events[0].receipts.core.identity.proof, "reconciled-hosted");
  assert.ok(
    Date.parse(f.events[0].receipts.core.startedAt) >
      Date.parse(incident.deployedAt)
  );
  await reconcileCoreReceiverEvidence(f.input);
  assert.equal(
    f.events.length,
    2,
    "repeated verification must not mint another receipt attempt"
  );
});

test("retains applied failure and resumes the same reconciliation after alignment recovers", async () => {
  const f = fixture();
  await assert.rejects(
    reconcileCoreReceiverEvidence({
      ...f.input,
      verifyAlignment: () => {
        throw new Error("alignment failed");
      },
    }),
    ALIGNMENT
  );
  assert.deepEqual(
    f.events.map((event) => event.receipts.core.status),
    ["applied", "failed"]
  );
  await reconcileCoreReceiverEvidence(f.input);
  assert.deepEqual(
    f.events.map((event) => event.receipts.core.status),
    ["applied", "failed", "verified"]
  );
  assert.equal(
    new Set(f.events.map((event) => event.receipts.core.attemptId)).size,
    1
  );
});

test("wrong historical or live identity fails closed before any evidence write", async () => {
  const changes = [
    (e) => {
      e.supersedingRun.conclusion = "failure";
    },
    (e) => {
      e.run.id += 1;
    },
    (e) => {
      e.run.run_attempt = 2;
    },
    (e) => {
      e.run.head_sha = "a".repeat(40);
    },
    (e) => {
      e.job.run_attempt = 2;
    },
    (e) => {
      e.job.steps.find(
        (s) => s.name === "Run current-stable Core recovery preflight"
      ).conclusion = "failure";
    },
    (e) => {
      e.artifact.workflow_run.id += 1;
    },
    (e) => {
      e.archiveSha256 = "a".repeat(64);
    },
    (e) => {
      e.startup.releaseSha = "a".repeat(40);
    },
    (e) => {
      e.startup.versionId = "other";
    },
    (e) => {
      e.startup.decision = "rejected";
    },
    (e) => {
      e.remoteTagSha = "a".repeat(40);
    },
    (e) => {
      e.projection.releaseManifestSha256 = "a".repeat(64);
    },
    (e) => {
      e.version.annotations["workers/tag"] = "other";
    },
    (e) => {
      e.deployments.find(
        (d) => d.id === incident.deploymentId
      ).versions[0].percentage = 50;
    },
    (e) => {
      e.deployments.push({
        id: "newer",
        created_on: "2026-09-22T16:33:00Z",
        versions: [],
      });
    },
    (e) => {
      e.deployments.push({
        id: "intervening",
        created_on: "2026-09-22T16:32:37Z",
        versions: [],
      });
    },
  ];
  for (const change of changes) {
    const f = fixture();
    change(f.input.provenance);
    await assert.rejects(reconcileCoreReceiverEvidence(f.input), REFUSED);
    assert.deepEqual(f.events, []);
  }
  for (const field of [
    "sourceSha",
    "projectionTag",
    "deploymentId",
    "versionId",
  ]) {
    const f = fixture();
    const original = f.input.verifyLive;
    f.input.verifyLive = () => ({ ...original(), [field]: "wrong" });
    await assert.rejects(reconcileCoreReceiverEvidence(f.input), REFUSED);
    assert.deepEqual(f.events, []);
  }
  assert.equal(
    assessCoreReceiverProvenance(evidence()).kind,
    "reconciled-hosted-core-receiver"
  );
});
