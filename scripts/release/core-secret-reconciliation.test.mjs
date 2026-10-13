import assert from "node:assert/strict";
import test from "node:test";

const REFUSED = /reconciliation refused/u;
const HEALTH = /health failed/u;
const RETAINED = /unchanged retained attempt/u;

import {
  assessCoreSecretSuccessor,
  reconcileCoreSecretEvidence,
} from "./core-secret-reconciliation.mjs";

// Sanitized projections of the production versions/deployments responses from
// 2026-10-13. Secret values are not returned by this Cloudflare API.
function fixture() {
  const source = "a".repeat(40);
  const baseline = {
    sha: source,
    evidenceSha: "b".repeat(40),
    recordedAt: "2026-01-01T00:01:00Z",
    receipt: {
      status: "verified",
      identity: {
        kind: "worker-deployment",
        workerName: "openmeld-core-prod",
        environment: "prod",
        sourceSha: source,
        deploymentId: "old-deployment",
        versionId: "old-version",
        projectionTag: "stable-tag",
        proof: "command-output",
      },
    },
  };
  const before = {
    id: "old-version",
    annotations: {
      "workers/tag": "stable-tag",
      "workers/triggered_by": "version_upload",
    },
    resources: {
      script: { etag: "c".repeat(64), handlers: ["fetch"] },
      script_runtime: {
        compatibility_date: "2026-01-01",
        compatibility_flags: ["nodejs_compat"],
      },
      bindings: [
        { name: "EXISTING_SECRET", type: "secret_text" },
        { name: "MODE", type: "plain_text", text: "production" },
      ],
    },
  };
  const after = structuredClone(before);
  after.id = "new-version";
  after.annotations = { "workers/triggered_by": "secret" };
  after.resources.bindings.push({ name: "ADDED_SECRET", type: "secret_text" });
  const deployments = [
    {
      id: "new-deployment",
      created_on: "2026-01-01T00:02:00Z",
      annotations: { "workers/triggered_by": "secret" },
      versions: [{ version_id: "new-version", percentage: 100 }],
    },
    {
      id: "old-deployment",
      created_on: "2026-01-01T00:00:00Z",
      versions: [{ version_id: "old-version", percentage: 100 }],
    },
  ];
  return {
    baseline,
    before,
    after,
    deployments,
    deploymentId: "new-deployment",
    versionId: "new-version",
    addedSecret: "ADDED_SECRET",
    controlSha: "d".repeat(40),
  };
}

test("secret addition proves inherited code without pretending the new version retained its tag", () => {
  const proof = assessCoreSecretSuccessor(fixture());
  assert.equal(proof.inheritedProjectionTag, "stable-tag");
  assert.equal(proof.tagDroppedBySecretUpdate, true);
  assert.equal(proof.secretValuesUnobservable, true);
});

test("secret reconciliation refuses unrelated or ambiguous deployment changes", () => {
  const cases = [
    (x) => {
      x.after.resources.script.etag = "e".repeat(64);
    },
    (x) => {
      x.after.resources.script_runtime.compatibility_date = "2026-02-01";
    },
    (x) => {
      x.after.resources.bindings[1].text = "changed";
    },
    (x) => {
      x.after.resources.bindings.push({
        name: "OTHER_SECRET",
        type: "secret_text",
      });
    },
    (x) => {
      x.after.resources.bindings.shift();
    },
    (x) => {
      x.after.annotations["workers/tag"] = "another-release";
    },
    (x) => {
      x.before.annotations["workers/tag"] = "another-release";
    },
    (x) => {
      x.deployments[0].versions[0].percentage = 50;
    },
    (x) => {
      x.deployments.splice(1, 0, {
        ...x.deployments[0],
        id: "intervening-deployment",
        created_on: "2026-01-01T00:01:30Z",
      });
    },
    (x) => {
      x.after.annotations["workers/triggered_by"] = "version_upload";
    },
    (x) => {
      x.baseline.receipt.status = "failed";
    },
    (x) => {
      x.after.id = "unrelated-version";
    },
  ];
  for (const change of cases) {
    const data = fixture();
    change(data);
    assert.throws(() => assessCoreSecretSuccessor(data), REFUSED);
  }
});

test("evidence-only recovery retains a failed attempt and resumes without a second application", async () => {
  const data = fixture();
  const proof = assessCoreSecretSuccessor(data);
  const identity = {
    ...data.baseline.receipt.identity,
    deploymentId: "new-deployment",
    versionId: "new-version",
    proof: "reconciled-secret-addition",
  };
  identity.projectionTag = undefined;
  let previous = data.baseline;
  let fail = false;
  const events = [];
  const input = {
    readEvidence: () => previous,
    verifyProvenance: () => proof,
    verifyLive: () => identity,
    verifyAlignment: () => {
      if (fail) {
        throw new Error("health failed");
      }
    },
    publishEvidence: (event) => {
      events.push(event);
      previous = {
        ...previous,
        receipt: event.receipts.core,
        reconciliation: event.reconciliation?.core ?? previous.reconciliation,
      };
    },
  };
  await reconcileCoreSecretEvidence({ ...input, verifyOnly: true });
  assert.equal(events.length, 0);
  fail = true;
  await assert.rejects(reconcileCoreSecretEvidence(input), HEALTH);
  assert.deepEqual(
    events.map((x) => x.receipts.core.status),
    ["applied", "failed"]
  );
  fail = false;
  await reconcileCoreSecretEvidence(input);
  assert.deepEqual(
    events.map((x) => x.receipts.core.status),
    ["applied", "failed", "verified"]
  );
  assert.equal(new Set(events.map((x) => x.receipts.core.attemptId)).size, 1);
  await reconcileCoreSecretEvidence(input);
  assert.equal(events.length, 3);
  await assert.rejects(
    reconcileCoreSecretEvidence({
      ...input,
      verifyLive: () => ({ ...identity, deploymentId: "changed" }),
    }),
    RETAINED
  );
});
