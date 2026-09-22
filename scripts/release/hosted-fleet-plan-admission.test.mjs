import assert from "node:assert/strict";
import test from "node:test";
import { admitHostedFleetPlan } from "./hosted-fleet-plan-admission.mjs";

const SHA = "b".repeat(40);
const BEFORE_MUTATION = /before any Production mutation/u;
const input = {
  releaseSha: SHA,
  releaseSource: "/release-source",
  scope: "cloud",
};
const components = [
  {
    scope: "web",
    state: "pending",
    sha: "a".repeat(40),
    changedPaths: ["clients/web/src/routes/index.tsx"],
  },
];
function dependencies(overrides = {}) {
  return {
    readHeadSha: () => SHA,
    collectStatus: async () => ({ blockers: [], components }),
    checkArtifact: () => Promise.resolve(),
    ...overrides,
  };
}
test("fleet uses component receipts and runs its artifact before admission completes", async () => {
  const calls = [];
  const result = await admitHostedFleetPlan(
    input,
    dependencies({
      checkArtifact: (request) => {
        calls.push(request);
        return Promise.resolve();
      },
    })
  );
  assert.equal(result.releaseSha, SHA);
  assert.equal("baseRef" in result, false);
  assert.deepEqual(calls, [
    { root: input.releaseSource, scope: "web", sourceSha: SHA },
  ]);
});
test("artifact failure blocks the whole fleet before component mutation", async () => {
  await assert.rejects(
    admitHostedFleetPlan(
      input,
      dependencies({
        checkArtifact: () => Promise.reject(new Error("Workerd SSR failed")),
      })
    ),
    { message: "Workerd SSR failed" }
  );
});
test("unknown component receipts fail closed before artifact execution", async () => {
  let built = false;
  await assert.rejects(
    admitHostedFleetPlan(
      input,
      dependencies({
        collectStatus: async () => ({
          blockers: [],
          components: [{ scope: "core", state: "unknown" }],
        }),
        checkArtifact: () => {
          built = true;
          return Promise.resolve();
        },
      })
    )
  );
  assert.equal(built, false);
});
test("receiver-first order incompatible with the hosted job graph is rejected", async () => {
  await assert.rejects(
    admitHostedFleetPlan(
      input,
      dependencies({
        collectStatus: async () => ({
          blockers: [],
          components: [
            {
              scope: "core",
              state: "pending",
              changedPaths: [
                "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
                "services/core/src/remote-agent/application/native-delivery-service.ts",
                "services/remote-agent/flue-adapter/execution-reconciliation.ts",
              ],
            },
          ],
        }),
      })
    ),
    BEFORE_MUTATION
  );
});
test("exact source mismatch and missing validation evidence are rejected", async () => {
  await assert.rejects(
    admitHostedFleetPlan(
      input,
      dependencies({ readHeadSha: () => "c".repeat(40) })
    )
  );
  await assert.rejects(
    admitHostedFleetPlan(
      input,
      dependencies({
        collectStatus: async () => ({
          blockers: [{ name: "Source", detail: "missing FC" }],
          components,
        }),
      })
    )
  );
});
