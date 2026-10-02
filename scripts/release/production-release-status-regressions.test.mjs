import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveLatestSuccessfulReleaseSources,
  runProductionReleaseStatus,
} from "./production-release-status.mjs";
import { assertProductionStageAdmission } from "./production-stage-admission.mjs";

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
async function report(overrides = {}, realPlans = false) {
  let output = "";
  const headSha = "1".repeat(40);
  const baseSha = "2".repeat(40);
  const treeSha = "3".repeat(40);
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
    readAssociatedPullRequests: async () => [
      {
        base: { ref: "main", sha: baseSha },
        head: { sha: headSha },
        html_url: "fixture://pull/1",
        merge_commit_sha: TARGET,
        merged_at: "2026-09-18T10:00:00Z",
        number: 1,
      },
    ],
    readCommitStatuses: async () => ({
      statuses: [
        {
          context: "OpenMeld Final Candidate",
          description: `Passed standard @ ${headSha.slice(0, 12)} on ${baseSha.slice(0, 12)}`,
          state: "success",
        },
      ],
    }),
    readGitCommit: async (_repo, sha) =>
      sha === TARGET
        ? {
            parents: [{ sha: baseSha }],
            tree: { sha: treeSha },
          }
        : { parents: [], tree: { sha: treeSha } },
    ...(realPlans
      ? {}
      : {
          buildPlan: () => ({ scopes: ["web"], changedPaths: [] }),
          buildImpact: (input) => adapters.buildPlan(input),
        }),
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

for (const [stage, admissionError] of [
  ["before-core", /pending prerequisite core, gateway, web/u],
  ["after-core", /pending prerequisite gateway, web/u],
  ["after-receivers", null],
]) {
  test(`classifies verified component receipts without ordering an unrelated historical release train: ${stage}`, async () => {
    const target = "98446ed175a0f4769827f6be7d6aed6884521095";
    const deployedCloud = "e050cded8d7017b9438b7171fb5b225725baa907";
    const deployedRuntime = "e4454cf165b96c7f918e420f28205c2b2ed3c575";
    const cloud = stage === "after-receivers" ? target : deployedCloud;
    const core = stage === "before-core" ? deployedRuntime : target;
    const { result } = await report(
      {
        resolveRef: () => target,
        readReleaseRuns: async () => [first],
        readReleaseJobs: async () => [
          ...["Deploy Web", "Deploy Gateway Worker", "Deploy Auth Worker"].map(
            (name) => job(name, cloud, "2026-10-02T01:30:00Z")
          ),
          job("Deploy Core Worker", core, "2026-10-02T05:50:00Z"),
          job(
            "Deploy Remote Agent Worker",
            deployedRuntime,
            "2026-10-01T01:30:00Z"
          ),
        ],
        readPushChecks: async () => [
          {
            workflowName: "Push Guard",
            status: "completed",
            conclusion: "success",
          },
        ],
      },
      true
    );
    for (const scope of ["web", "gateway", "auth", "core", "remote-agent"]) {
      const component = result.components.find(
        (entry) => entry.scope === scope
      );
      const baseline =
        { core, "remote-agent": deployedRuntime }[scope] ?? cloud;
      assert.equal(
        component.state,
        baseline === target ? "current" : "pending",
        `${stage} ${scope}: ${component.reason}`
      );
      assert.equal(component.sha, baseline);
    }
    assert.ok(
      result.components
        .find((entry) => entry.scope === "remote-agent")
        .compatibilityDependencies.some(
          ([receiver, producer]) =>
            receiver === "core" && producer === "remote-agent"
        )
    );
    const admitRemote = () =>
      assertProductionStageAdmission({
        components: result.components,
        selectedScopes: ["remote-agent"],
        sourceSha: target,
      });
    if (admissionError) {
      assert.throws(admitRemote, admissionError);
    } else {
      assert.doesNotThrow(admitRemote);
    }
  });
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

test("uses verified Database history when unrelated historical contracts cannot compose", async () => {
  const { code, result } = await report({
    readReleaseJobs: async () => [
      job("Release Production Database", OLD, "2026-09-18T12:00:00Z"),
    ],
    buildPlan: ({ base }) => {
      if (base === OLD) {
        throw new Error("historical cross-service order conflict");
      }
      return { scopes: ["db"], changedPaths: [] };
    },
    buildImpact: () => ({
      scopes: ["db"],
      changedPaths: ["packages/db/drizzle/0182_grey_captain_marvel.sql"],
    }),
  });
  assert.equal(code, 0);
  const database = result.components.find(
    (component) => component.scope === "db"
  );
  assert.equal(database.sha, OLD);
  assert.equal(database.state, "pending");
  assert.deepEqual(database.compatibilityDependencies, []);
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
    buildPlan: () => ({
      scopes: ["web"],
      changedPaths: [],
      compatibilityDependencies: [["core", "web"]],
    }),
  });
  assert.equal(code, 0);
  assert.equal(result.components.find((c) => c.scope === "web").sha, WEB);
  assert.deepEqual(
    result.components.find((c) => c.scope === "web").compatibilityDependencies,
    [["core", "web"]]
  );
  assert.equal(result.history.complete, false);
  assert.equal(result.history.issues.length, 1);
});

test("proves a pending receiver contract from its verified historical source", async () => {
  const receiverPath =
    "services/remote-agent/flue-adapter/execution-reconciliation.ts";
  const { code, result } = await report({
    readReleaseRuns: async () => [first],
    readReleaseJobs: async () => [
      job("Deploy Core Worker", OLD, "2026-09-18T11:00:00Z"),
      job("Deploy Remote Agent Worker", WEB, "2026-09-18T12:00:00Z"),
    ],
    buildPlan: ({ base }) => {
      if (base === OLD) {
        return {
          changedPaths: [],
          compatibilityDependencies: [["remote-agent", "core"]],
          compatibilityReceiverWitnesses: [
            {
              producer: "core",
              receiver: "remote-agent",
              receiverPaths: [receiverPath],
            },
          ],
          scopes: ["core"],
        };
      }
      return {
        changedPaths:
          base === WEB ? ["services/remote-agent/src/unrelated-log.ts"] : [],
        scopes: base === WEB ? ["remote-agent"] : [],
      };
    },
    compareGitPathContents: ({ fromSha, paths, toSha }) => {
      assert.equal(fromSha, WEB);
      assert.deepEqual(paths, [receiverPath]);
      assert.equal(toSha, TARGET);
      return true;
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(
    result.components.find((component) => component.scope === "core")
      .compatibilityReceiverWitnesses[0].evidence,
    {
      baselineSha: WEB,
      result: "match",
      targetSha: TARGET,
    }
  );
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

test("reports only exact applied Worker receipts as guarded health resume candidates", async () => {
  const operationKey = "4".repeat(64);
  const attemptId = "00000000-0000-4000-8000-000000000004";
  const { code, result } = await report({
    readLocalReleaseSources: async () =>
      new Map([
        [
          "web",
          {
            sha: TARGET,
            recordedAt: "2026-09-18T13:00:00Z",
            source: "guarded-local",
            receipt: {
              application: "applied",
              attemptId,
              componentIndex: 0,
              identity: {
                deploymentId: "deployment-r3",
                environment: "prod",
                kind: "worker-deployment",
                proof: "command-output",
                sourceSha: TARGET,
                versionId: "version-r3",
                workerName: "openmeld-web-prod",
              },
              operationKey,
              startedAt: "2026-09-18T12:59:00.000Z",
              status: "failed",
            },
          },
        ],
      ]),
  });

  assert.equal(code, 1);
  const web = result.components.find((component) => component.scope === "web");
  assert.equal(web.state, "unknown");
  assert.deepEqual(web.recovery, {
    admission: "candidate",
    attemptId,
    componentIndex: 0,
    kind: "guarded-health-resume",
    operationKey,
    sourceSha: TARGET,
  });
  assert.deepEqual(
    result.blockers.find((blocker) => blocker.scope === "web").scopes,
    ["web"]
  );
});
