import assert from "node:assert/strict";
import test from "node:test";
import { productionComponentReceiptSchema } from "../../packages/schemas/src/schemas/release/production-release-evidence.ts";
import {
  buildProductionDeployStepSpecs,
  executeProductionDeploySteps,
  executeWithProductionScopeLeases,
} from "./production-release.mjs";
import { executeRecordedProductionDeploySteps } from "./production-release-receipts.mjs";

const UNRESOLVED_ERROR = /unresolved|reconcil/iu;
const SOURCE = "a".repeat(40);
const ATTEMPT = "00000000-0000-4000-8000-000000000001";
const WORKER_VERSION = "23863082-db0f-4cfe-a91b-69c570ee1578";
const FAILURE = /fixture failure|persist|boundary|Worker|completion|executor/u;

function fixture(options = {}) {
  const receipts = [],
    effects = [],
    latest = new Map(),
    released = [];
  const workerResponse = {
    status: 0,
    stdout: JSON.stringify([
      {
        id: "fixture-deployment",
        created_on: "2026-09-18T12:00:00Z",
        versions: [{ version_id: WORKER_VERSION, percentage: 100 }],
      },
    ]),
  };
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
          sourceSha: SOURCE,
          attemptId: ATTEMPT,
          readEvidence: () =>
            new Map(
              [...latest].map(([scope, receipt]) => [
                scope,
                { sha: SOURCE, receipt },
              ])
            ),
          steps: options.steps ?? steps,
          executeSteps: executeProductionDeploySteps,
          runCommand: () =>
            options.identityFailure ? { status: 1 } : workerResponse,
          executionAdapters: {
            runCommand: () => workerResponse,
            runStep: (step) => {
              effects.push(step.label);
              if (step.label === options.failureAt) {
                throw new Error("fixture failure");
              }
            },
            publishCliRelease: () => {
              effects.push("publish-cli");
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
            }
            receipts.push(event);
          },
          write: () => undefined,
        }),
    });
  return { run, receipts, effects, latest, released };
}

test("keeps verified components visible when a later component fails, with all leases released", async () => {
  const result = fixture({ failureAt: "Deploy Remote Agent Worker" });
  await assert.rejects(result.run, FAILURE);
  for (const scope of ["auth", "web", "gateway", "core"]) {
    assert.equal(result.latest.get(scope).status, "verified", scope);
    assert.equal(
      result.latest.get(scope).identity.versions[0].versionId,
      WORKER_VERSION
    );
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
  assert.equal(
    result.latest.get("web").identity.versions[0].versionId,
    WORKER_VERSION
  );
  assert.equal(result.latest.has("gateway"), false);
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
  assert.equal(result.latest.get("cli").identity.kind, "release-source");
  assert.equal(
    result.latest.get("core").identity.versions[0].versionId,
    WORKER_VERSION
  );
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

test("rejects an incomplete component boundary before receipts or deployment", async () => {
  const result = fixture({
    scopes: ["web"],
    steps: buildProductionDeployStepSpecs(["web"]).slice(0, 1),
  });
  await assert.rejects(result.run, FAILURE);
  assert.equal(result.receipts.length, 0);
  assert.equal(result.effects.length, 0);
});
