import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveLatestSuccessfulReleaseSources,
  runProductionReleaseStatus,
} from "./production-release-status.mjs";

const TARGET = "a".repeat(40),
  OLD = "b".repeat(40),
  BASE = "c".repeat(40),
  WEB = "d".repeat(40);
const run = (id) => ({
  databaseId: id,
  createdAt: `2026-09-18T0${id}:00:00Z`,
  workflowName: "Scoped Production Release",
  url: `fixture://run/${id}`,
});
const job = (name, releaseSha, completedAt) => ({
  id: name + completedAt,
  name,
  releaseSha,
  conclusion: "success",
  completed_at: completedAt,
});
const first = run(2),
  second = run(1);
async function report(overrides = {}) {
  let output = "";
  const adapters = {
    resolveRepo: () => "fixture/repo",
    resolveRef: (r) => (r === "base" ? BASE : TARGET),
    sourceIsAncestor: () => true,
    readReleaseRuns: async () => [first, second],
    readReleaseJobs: async (id) =>
      id === 2
        ? [job("Deploy Web", WEB, "2026-09-18T11:00:00Z")]
        : [job("Deploy Core Worker", OLD, "2026-09-18T12:00:00Z")],
    readJobReleaseSha: async (j) => j.releaseSha,
    readLocalReleaseSources: async () => new Map(),
    readPushChecks: async () => [],
    buildPlan: () => ({ scopes: ["web"], changedPaths: [] }),
    ...overrides,
  };
  const code = await runProductionReleaseStatus({
    argv: ["--ref", "target", "--change-base", "base", "--json"],
    adapters,
    write: (s) => {
      output += s;
    },
  });
  return { code, result: JSON.parse(output) };
}
test("selects actual completion rather than workflow creation order", () => {
  const jobsByRunId = new Map([
    [2, [job("Deploy Web", WEB, "2026-09-18T11:00:00Z")]],
    [1, [job("Deploy Web", OLD, "2026-09-18T12:00:00Z")]],
  ]);
  for (const runs of [
    [first, second],
    [second, first],
  ]) {
    assert.equal(
      resolveLatestSuccessfulReleaseSources({
        runs,
        jobsByRunId,
        sourceIsAncestor: () => true,
      }).get("web").sha,
      OLD
    );
  }
});
test("retains scoped JSON when unrelated historical planning fails", async () => {
  const { code, result } = await report({
    buildPlan: ({ base }) => {
      if (base === OLD) {
        throw new Error("historical contract conflict");
      }
      return { scopes: ["web"], changedPaths: [] };
    },
  });
  assert.equal(code, 0);
  assert.equal(result.globalState, "blocked");
  assert.equal(
    result.components.find((c) => c.scope === "core").state,
    "unknown"
  );
});
test("does not silently hide a newer successful deployment with unreadable source", async () => {
  const { code, result } = await report({
    readReleaseJobs: async (id) => [
      job(
        "Deploy Web",
        id === 2 ? undefined : WEB,
        id === 2 ? "2026-09-18T12:00:00Z" : "2026-09-18T11:00:00Z"
      ),
    ],
    buildPlan: () => ({ scopes: ["web"], changedPaths: [] }),
  });
  assert.equal(code, 1);
  assert.equal(
    result.components.find((c) => c.scope === "web").state,
    "unknown"
  );
});

test("keeps ties, missing completion times, current conflicts and API failures blocked", async () => {
  for (const scenario of [
    "tie",
    "missing-time",
    "current-conflict",
    "api-failure",
  ]) {
    const { code, result } = await report({
      readReleaseJobs: async (id) => [
        job(
          "Deploy Web",
          id === 2 ? WEB : OLD,
          scenario === "missing-time" ? undefined : "2026-09-18T12:00:00Z"
        ),
      ],
      ...(scenario === "api-failure"
        ? {
            readReleaseRuns: () => {
              throw new Error("API unavailable");
            },
          }
        : {}),
      buildPlan: ({ base }) => {
        if (scenario === "current-conflict" && base === BASE) {
          throw new Error("Current rollout is incompatible");
        }
        return { scopes: ["web"], changedPaths: [] };
      },
    });
    assert.equal(code, 1, scenario);
    assert.equal(result.state, "blocked", scenario);
  }
});

test("older unavailable source does not override a newer known completed deployment", async () => {
  const { code, result } = await report({
    readReleaseJobs: async (id) => [
      job(
        "Deploy Web",
        id === 2 ? WEB : undefined,
        id === 2 ? "2026-09-18T12:00:00Z" : "2026-09-18T11:00:00Z"
      ),
    ],
    buildPlan: () => ({ scopes: ["web"], changedPaths: [] }),
  });
  assert.equal(code, 0);
  assert.equal(result.components.find((c) => c.scope === "web").sha, WEB);
  assert.equal(result.history.complete, false);
  assert.equal(result.history.issues.length, 1);
});

test("unverified local deployment replaces older hosted success without appearing current", async () => {
  const { code, result } = await report({
    readLocalReleaseSources: async () =>
      new Map([
        [
          "web",
          {
            sha: TARGET,
            recordedAt: "2026-09-18T13:00:00Z",
            source: "guarded-local",
            receipt: { status: "failed" },
          },
        ],
      ]),
  });
  assert.equal(code, 1);
  const web = result.components.find((c) => c.scope === "web");
  assert.equal(web.state, "unknown");
  assert.equal(web.receipt.status, "failed");
});
