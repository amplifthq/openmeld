import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { evaluateChannelSync } from "./cli-channel-sync.mjs";
import { buildProductionReleasePlan } from "./production-release.mjs";
import { assertProductionStageAdmission } from "./production-stage-admission.mjs";

// Preserve the actual request-contract evidence without requiring temporary
// candidate commits or a moving worktree at test time.
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/strict-request-context-rollout.json", import.meta.url),
    "utf8"
  )
);
const EXECUTION_INPUT =
  "packages/schemas/src/schemas/runtime/remote-agent-execution-input.ts";
const REQUEST_CONTEXT =
  "packages/schemas/src/schemas/daemon/profile-identity.ts";
const TURN_REQUEST_OWNERS = [
  "packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts",
  "services/core/src/remote-agent/application/turn-envelope.ts",
];
const EXECUTION_INPUT_OWNERS = [
  EXECUTION_INPUT,
  "services/core/src/space/transport/do/space.ts",
  "services/remote-agent/flue-adapter/execution-input.ts",
];
const GATEWAY_CONTEXT_OWNERS = [
  REQUEST_CONTEXT,
  "services/gateway/src/lib/openmeld-context.ts",
];
const FULL_SCOPE = "db,auth,core,remote-agent,gateway,web,website,docs,cli";
const SAFE_ORDER = [
  "db",
  "remote-agent",
  "auth",
  "core",
  "gateway",
  "web",
  "cli",
  "website",
  "docs",
];
const PENDING_REMOTE = /pending prerequisite remote-agent/u;
const PENDING_CORE = /pending prerequisite core/u;
const UNKNOWN_DIRECTION = /proven request or response direction/u;
const UNKNOWN_CONTEXT = /readable strict schema history/u;
const CONTRACT_CYCLE = /incompatible.*dependencies/iu;

function contractPlan(changedPaths, overrides = {}) {
  const base = overrides.base ?? fixture.provenance.productionBase;
  const sourceSha = overrides.sourceSha ?? fixture.provenance.combinedSource;
  return buildProductionReleasePlan({
    base,
    sourceSha,
    changedPaths,
    databaseBackend: "postgresql",
    scope: FULL_SCOPE,
    readGitFile: (ref, path) => {
      if (path === "services/remote-agent/agent-core/tools.ts") {
        // This historical fixture uses the legacy workspace caller.
        return 'const rpc = requireCoreRpc(input.coreWorker.centerAgentUpdateAgentProfileRuntimeSettings, "centerAgentUpdateAgentProfileRuntimeSettings");';
      }
      const source = fixture.schemaSources[path];
      if (!source) {
        throw new Error(`Unexpected contract source: ${path}`);
      }
      return ref === base ? source.before : source.after;
    },
    ...overrides,
  });
}

for (const candidate of ["timeOnly", "combined"]) {
  test(`orders the actual ${candidate} strict request diff without a Center Agent source edit`, () => {
    const paths = fixture.changedPaths[candidate];
    assert.equal(
      paths.includes("services/remote-agent/.flue/agents/center-agent.ts"),
      false
    );
    const plan = contractPlan(paths, {
      sourceSha:
        candidate === "timeOnly"
          ? fixture.provenance.timeSource
          : fixture.provenance.combinedSource,
    });
    assert.equal(plan.deployOrderProfile, "remote-agent-receiver-first");
    assert.deepEqual(plan.deployScopeOrder, SAFE_ORDER);
    assert.deepEqual(plan.compatibilityDependencies, [
      ["core", "gateway"],
      ["remote-agent", "core"],
      ["remote-agent", "cli"],
    ]);
    const core = plan.deploySteps.findIndex(
      (step) =>
        step.releaseScope === "core" &&
        step.args?.includes(
          "scripts/release/deploy-core-current-cli-projection.mjs"
        ) &&
        step.args.includes("--deployment-only")
    );
    const cli = plan.deploySteps.findIndex(
      (step) => step.internalOperation === "publish-cli"
    );
    assert.ok(core >= 0 && cli > core);
    assert.equal(plan.deploySteps[cli].releaseScope, "cli");
    assert.ok(plan.deploySteps[cli].receiptWorkerDeploymentArgs);
    assert.deepEqual(
      plan.compatibilityReceiverWitnesses.map(({ receiver, producer }) => [
        receiver,
        producer,
      ]),
      plan.compatibilityDependencies
    );
  });
}

test("keeps the published CLI projection when the strict request cloud stage excludes CLI", async () => {
  const channel = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/cli-manifest.production-snapshot.json",
        import.meta.url
      ),
      "utf8"
    )
  );
  channel.channels.stable.version = "0.3.249";
  channel.channels.stable.minRequiredCliVersion = "0.3.249";
  const sync = await evaluateChannelSync({
    manifestComponents: {
      cli: { packageVersion: "0.3.250" },
      service: { bundleVersion: "0.3.250" },
    },
    fetch: async () => Response.json(channel),
  });
  assert.equal(sync.outcome.kind, "behind");

  const plan = contractPlan(fixture.changedPaths.combined, {
    scope: "db,remote-agent,auth,core,gateway,web",
  });
  assert.equal(plan.deployOrderProfile, "remote-agent-receiver-first");
  assert.deepEqual(plan.deployScopeOrder, SAFE_ORDER.slice(0, 6));
  const core = plan.deploySteps.filter((step) => step.releaseScope === "core");
  assert.deepEqual(
    core.map((step) => step.args),
    ["--deployment-only", "--verify-only"].map((mode) => [
      "scripts/release/deploy-core-current-cli-projection.mjs",
      mode,
      "--release-sha",
      plan.sourceSha,
    ])
  );
  assert.ok(core[0].workerDeploymentArgs);
  assert.equal(core[0].completesReleaseScope, false);
  assert.equal(core[1].completesReleaseScope, true);
  for (const steps of [plan.preflightSteps, plan.verifySteps]) {
    assert.equal(
      steps.some(
        (step) => step.label === "Verify Core CLI channel compatibility"
      ),
      false
    );
  }
  assert.equal(
    plan.deploySteps.some((step) => step.internalOperation === "publish-cli"),
    false
  );
  assert.deepEqual(plan.compatibilityDependencies, [
    ["core", "gateway"],
    ["remote-agent", "core"],
    ["remote-agent", "cli"],
  ]);
});

test("stage admission blocks both Core and the CLI Core projection until Remote is verified", () => {
  const plan = contractPlan(fixture.changedPaths.combined);
  const components = SAFE_ORDER.map((scope) => ({
    scope,
    sha: fixture.provenance.productionBase,
    state: "pending",
    compatibilityDependencies: plan.compatibilityDependencies,
    compatibilityObligations: plan.compatibilityObligations,
    compatibilityReceiverWitnesses: plan.compatibilityReceiverWitnesses,
  }));
  const admit = (selectedScopes) =>
    assertProductionStageAdmission({
      components,
      selectedScopes,
      sourceSha: fixture.provenance.combinedSource,
    });
  assert.doesNotThrow(() => admit(["remote-agent"]));
  assert.throws(() => admit(["core"]), PENDING_REMOTE);
  assert.throws(() => admit(["cli"]), PENDING_REMOTE);
  assert.throws(() => admit(["gateway"]), PENDING_CORE);

  // A Core receipt does not protect a CLI stage that redeploys the candidate
  // Core producer while the Remote receiver is still pending.
  components.find((component) => component.scope === "core").state = "current";
  assert.throws(() => admit(["cli"]), PENDING_REMOTE);
  components.find((component) => component.scope === "remote-agent").state =
    "current";
  assert.doesNotThrow(() => admit(["core", "gateway", "cli"]));
});

test("recognizes each imported strict request owner independently", () => {
  for (const paths of [TURN_REQUEST_OWNERS, EXECUTION_INPUT_OWNERS]) {
    const plan = contractPlan(paths, { scope: "core,remote-agent,cli" });
    assert.equal(plan.deployOrderProfile, "remote-agent-receiver-first");
    assert.deepEqual(plan.deployScopeOrder, ["remote-agent", "core", "cli"]);
    assert.deepEqual(plan.compatibilityDependencies, [
      ["remote-agent", "core"],
      ["remote-agent", "cli"],
    ]);
  }
});

test("keeps response-only execution input in the Core reader direction", () => {
  const before = fixture.schemaSources[EXECUTION_INPUT].before;
  const after = before.replace(
    "receivedAtMs: z.number()",
    "receiptVersion: z.string().optional(),\n  receivedAtMs: z.number()"
  );
  assert.notEqual(after, before);
  const plan = contractPlan(EXECUTION_INPUT_OWNERS, {
    scope: "core,remote-agent",
    readGitFile: (ref) =>
      ref === fixture.provenance.productionBase ? before : after,
  });
  assert.equal(plan.deployOrderProfile, "default-auth-receiver-first");
  assert.deepEqual(plan.deployScopeOrder, ["core", "remote-agent"]);
  assert.deepEqual(plan.compatibilityDependencies, [["core", "remote-agent"]]);
});

test("does not infer a request expansion from imports or unrelated profile exports", () => {
  const paths = [...EXECUTION_INPUT_OWNERS, ...GATEWAY_CONTEXT_OWNERS];
  const plan = contractPlan(paths, {
    scope: "core,gateway,remote-agent,cli,web",
    readGitFile: (ref, path) => {
      const before = fixture.schemaSources[path].before;
      return ref === fixture.provenance.productionBase
        ? before
        : `// Unrelated import or earlier export changed.\n${before}`;
    },
  });
  assert.equal(plan.deployOrderProfile, "default-auth-receiver-first");
  assert.deepEqual(plan.compatibilityDependencies, []);
});

test("rejects unknown or mixed execution-input request and response changes", () => {
  assert.throws(
    () =>
      contractPlan(EXECUTION_INPUT_OWNERS, {
        readGitFile: () => {
          throw new Error("missing source history");
        },
      }),
    UNKNOWN_DIRECTION
  );
  assert.throws(
    () =>
      contractPlan(EXECUTION_INPUT_OWNERS, {
        readGitFile: (ref) => {
          const source = fixture.schemaSources[EXECUTION_INPUT];
          return ref === fixture.provenance.productionBase
            ? source.before
            : source.after.replace(
                "receivedAtMs: z.number()",
                "receiptVersion: z.string().optional(),\n  receivedAtMs: z.number()"
              );
        },
      }),
    UNKNOWN_DIRECTION
  );
});

test("requires Core before the changed Gateway request context without gating optional headers", () => {
  const plan = contractPlan(GATEWAY_CONTEXT_OWNERS, {
    scope: "core,gateway,web,cli",
  });
  assert.deepEqual(plan.compatibilityDependencies, [["core", "gateway"]]);
  assert.ok(
    plan.deployScopeOrder.indexOf("core") <
      plan.deployScopeOrder.indexOf("gateway")
  );
  const headersOnly = contractPlan([
    "packages/gateway-contract/src/headers.ts",
    "clients/openmeld-cli/src/config/request-headers.ts",
    "clients/web/src/lib/openmeld-api/client.ts",
    "services/gateway/src/middlewares/auth.ts",
  ]);
  assert.deepEqual(headersOnly.compatibilityDependencies, []);
  assert.throws(
    () =>
      contractPlan(GATEWAY_CONTEXT_OWNERS, {
        readGitFile: () => {
          throw new Error("missing source history");
        },
      }),
    UNKNOWN_CONTEXT
  );
});

test("preserves worker-response direction and rejects its cycle with a strict turn request", () => {
  const responseOwners = [
    "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
    "services/remote-agent/.flue/agents/center-agent.ts",
  ];
  const response = contractPlan(responseOwners, {
    scope: "core,remote-agent,gateway,web",
  });
  assert.deepEqual(response.compatibilityDependencies, [
    ["core", "remote-agent"],
    ["gateway", "remote-agent"],
    ["web", "remote-agent"],
  ]);
  assert.throws(
    () => contractPlan([...TURN_REQUEST_OWNERS, ...responseOwners]),
    CONTRACT_CYCLE
  );
});
