import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildProductionDeployStepSpecs,
  buildProductionReleasePlan,
  resolveAutomaticReleaseScopes,
  resolveProductionCompatibilityDependencies,
  resolveProductionCompatibilityObligations,
  resolveProductionCompatibilityReceiverWitnesses,
} from "./production-release.mjs";
import { assertProductionStageAdmission } from "./production-stage-admission.mjs";

const FOLDER_RECOVERY = [
  "packages/schemas/src/working-folder-recovery.ts",
  "services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts",
  "clients/openmeld-cli/src/local-service/continuation/working-folder-recovery.ts",
];
const NPM_SETUP = [
  "scripts/release/npm-cli-artifact.mjs",
  "clients/openmeld-cli/package.json",
  "clients/web/src/lib/setup-bootstrap-script.ts",
];
const WINDOWS_PREVIEW_PATHS = [
  ...NPM_SETUP,
  "clients/web/src/lib/setup-bootstrap-windows-binary.ts",
  "scripts/release/publish-windows-internal-preview.mjs",
];
const PENDING_RECEIVER = /pending prerequisite/u;
const INBOX_SOURCE_TARGET_SCOPE_REQUIRED =
  /requires the Web, Gateway, and Core scopes/u;
const inboxMembershipFixture = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/inbox-membership-opt-in-increment.json",
      import.meta.url
    ),
    "utf8"
  )
);
const INBOX_MEMBERSHIP_OPT_IN = {
  contract: "inbox-membership-opt-in",
  receiver: "core",
  producer: "gateway",
};
// Captured real request calls identify an obligation only, never a witness.
function inboxMembershipContext(sourceSha) {
  const reads = [];
  return {
    sourceSha,
    reads,
    readGitFile(ref, file) {
      reads.push([ref, file]);
      if (
        ref !== sourceSha ||
        file !== inboxMembershipFixture.callers.target.path
      ) {
        throw new Error("Read the explicit product caller, not control HEAD.");
      }
      const caller = Object.values(inboxMembershipFixture.callers).find(
        (item) => item.sha === ref
      );
      if (!caller) {
        throw new Error("Read a captured exact source.");
      }
      return caller.source;
    },
  };
}

test("Inbox membership opt-in real increment requires Core before Gateway", () => {
  const context = inboxMembershipContext(inboxMembershipFixture.sourceSha);
  assert.deepEqual(
    resolveProductionCompatibilityObligations(
      inboxMembershipFixture.changedPaths,
      false,
      context
    ),
    [INBOX_MEMBERSHIP_OPT_IN]
  );
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(
      inboxMembershipFixture.changedPaths,
      false,
      context
    ),
    [["core", "gateway"]]
  );
  const steps = buildProductionDeployStepSpecs(["core", "gateway"], {
    changedPaths: inboxMembershipFixture.changedPaths,
    compatibilityContext: context,
    databaseBackend: "postgresql",
  });
  const coreComplete = steps.findIndex(
    (step) => step.releaseScope === "core" && step.completesReleaseScope
  );
  const gatewayFirst = steps.findIndex(
    (step) => step.releaseScope === "gateway"
  );
  assert.ok(coreComplete >= 0 && coreComplete < gatewayFirst);
  assert.ok(context.reads.length > 0);
  assert.ok(
    context.reads.every(
      ([ref, file]) =>
        ref === inboxMembershipFixture.sourceSha &&
        file === inboxMembershipFixture.callers.target.path
    )
  );
});

test("Inbox membership opt-in caller-only uses target source and preserves unknown prerequisites", () => {
  const paths = [inboxMembershipFixture.callers.target.path];
  for (const context of [
    inboxMembershipContext(inboxMembershipFixture.sourceSha),
    {},
    {
      sourceSha: inboxMembershipFixture.sourceSha,
      readGitFile() {
        throw new Error("unreadable product caller");
      },
    },
  ]) {
    assert.deepEqual(
      resolveProductionCompatibilityObligations(paths, false, context),
      [INBOX_MEMBERSHIP_OPT_IN]
    );
  }
  assert.deepEqual(
    resolveProductionCompatibilityObligations(
      paths,
      false,
      inboxMembershipContext(inboxMembershipFixture.callers.legacy.sha)
    ),
    []
  );
  assert.deepEqual(
    resolveProductionCompatibilityObligations(
      ["clients/website/src/components/footer.tsx"],
      false,
      {}
    ),
    []
  );
});

test("Inbox membership opt-in actual Gateway stage rejects pending Core and another contract witness", () => {
  for (const paths of [
    inboxMembershipFixture.changedPaths,
    [inboxMembershipFixture.callers.target.path],
  ]) {
    const context = inboxMembershipContext(inboxMembershipFixture.sourceSha);
    const sourceSha = inboxMembershipFixture.sourceSha;
    const receiver = {
      scope: "core",
      state: "pending",
      sha: "96cb28b5a32f3757c6fd2b78ede81044a45a5a6b",
    };
    const producer = {
      scope: "gateway",
      state: "pending",
      sha: inboxMembershipFixture.callers.legacy.sha,
      compatibilityObligations: resolveProductionCompatibilityObligations(
        paths,
        false,
        context
      ),
      compatibilityDependencies: resolveProductionCompatibilityDependencies(
        paths,
        false,
        context
      ),
      compatibilityReceiverWitnesses: [
        {
          receiver: "core",
          producer: "gateway",
          contracts: ["profile-workspace-read"],
          evidence: {
            result: "match",
            baselineSha: receiver.sha,
            targetSha: sourceSha,
          },
        },
      ],
    };
    const stage = {
      sourceSha,
      selectedScopes: ["gateway"],
      components: [receiver, producer],
    };
    // A scoped step describes intent. The actual stage needs receiver receipt.
    const steps = buildProductionDeployStepSpecs(["gateway"], {
      changedPaths: paths,
      compatibilityContext: context,
    });
    assert.ok(steps.some((step) => step.releaseScope === "gateway"));
    assert.throws(
      () => assertProductionStageAdmission(stage),
      PENDING_RECEIVER
    );
    receiver.state = "unknown";
    assert.throws(
      () => assertProductionStageAdmission(stage),
      UNRESOLVED_RECEIVER
    );
    receiver.state = "current";
    receiver.sha = sourceSha;
    assert.doesNotThrow(() => assertProductionStageAdmission(stage));
    assert.deepEqual(
      resolveProductionCompatibilityReceiverWitnesses(paths, context),
      [],
      "registration must not create an Inbox compatibility witness"
    );
  }
});

test("Inbox membership opt-in does not remove source-target scope protection", () => {
  assert.throws(
    () =>
      buildProductionDeployStepSpecs(["core"], {
        changedPaths: [
          "packages/schemas/src/schemas/http/inbox.ts",
          "services/core/src/remote-agent/application/native-delivery-service.ts",
        ],
        compatibilityContext: inboxMembershipContext(
          inboxMembershipFixture.sourceSha
        ),
      }),
    INBOX_SOURCE_TARGET_SCOPE_REQUIRED
  );
});
// The eight changed paths from the safe-workspace named receiver increment.
const SAFE_WORKSPACE_INCREMENT = [
  "changelog/entries/agent-setup-recovery.md",
  "developing/architecture/shared-contracts.md",
  "services/core/src/index.ts",
  "services/core/src/rpc/methods.ts",
  "services/core/tests/center-agent-people-computers.integration.test.ts",
  "services/remote-agent/agent-core/callback-context.ts",
  "services/remote-agent/agent-core/tools.ts",
  "services/remote-agent/tests/tools.test.ts",
];
const SAFE_WORKSPACE_OBLIGATION = {
  contract: "center-agent-safe-workspace",
  receiver: "core",
  producer: "remote-agent",
};

test("registers the named workspace receiver from product source, not control source", () => {
  const products = new Map([
    [
      "1".repeat(40),
      'const rpcName = "centerAgentUpdateAgentProfileRuntimeSettings";',
    ],
    [
      "2".repeat(40),
      'const rpcName = payload.workspaceMode === undefined ? "centerAgentUpdateAgentProfileRuntimeSettings" : "centerAgentUpdateAgentProfileRuntimeSettingsWithSafeWorkspace";',
    ],
  ]);
  const readGitFile = (ref, file) => {
    assert.ok(products.has(ref), "must use the explicit product SHA");
    return file === "services/remote-agent/agent-core/tools.ts"
      ? products.get(ref)
      : "// Historical product without Default Project initializer or Binding precondition.";
  };
  assert.deepEqual(
    resolveProductionCompatibilityObligations(SAFE_WORKSPACE_INCREMENT, false, {
      sourceSha: "2".repeat(40),
      readGitFile,
    }),
    [SAFE_WORKSPACE_OBLIGATION]
  );
  assert.deepEqual(
    resolveProductionCompatibilityObligations(SAFE_WORKSPACE_INCREMENT, false, {
      sourceSha: "1".repeat(40),
      readGitFile,
    }),
    []
  );
  for (const context of [
    {},
    {
      sourceSha: "2".repeat(40),
      readGitFile() {
        throw new Error("missing product source");
      },
    },
  ]) {
    const obligations = resolveProductionCompatibilityObligations(
      SAFE_WORKSPACE_INCREMENT,
      false,
      context
    );
    assert.ok(
      obligations.some((o) => o.contract === "center-agent-safe-workspace")
    );
    assert.ok(
      obligations.some(
        (o) => o.contract === "agent-profile-default-project-initializer"
      )
    );
    assert.ok(
      obligations.some(
        (o) => o.contract === "agent-profile-binding-precondition"
      )
    );
  }
});

test("an old usage witness cannot admit the required workspace receiver", () => {
  const sourceSha = "2".repeat(40);
  const baselineSha = "1".repeat(40);
  const producer = {
    scope: "remote-agent",
    state: "pending",
    sha: baselineSha,
    compatibilityObligations: [
      SAFE_WORKSPACE_OBLIGATION,
      {
        contract: "remote-ai-usage",
        receiver: "core",
        producer: "remote-agent",
      },
    ],
    compatibilityDependencies: [["core", "remote-agent"]],
    compatibilityReceiverWitnesses: [
      {
        receiver: "core",
        producer: "remote-agent",
        contracts: ["remote-ai-usage"],
        evidence: { baselineSha, targetSha: sourceSha, result: "match" },
      },
    ],
  };
  const receiver = {
    scope: "core",
    state: "pending",
    sha: baselineSha,
    evidence: { result: "verified" },
  };
  const input = {
    components: [receiver, producer],
    selectedScopes: ["remote-agent"],
    sourceSha,
  };
  assert.throws(() => assertProductionStageAdmission(input), PENDING_CORE);
  receiver.state = "current";
  receiver.sha = sourceSha;
  assert.doesNotThrow(() => assertProductionStageAdmission(input));
  receiver.state = "unknown";
  assert.throws(
    () => assertProductionStageAdmission(input),
    UNRESOLVED_RECEIVER
  );
});

const PENDING_DB = /pending prerequisite db/u;
const PENDING_CORE = /pending prerequisite core/u;
const UNRESOLVED_RECEIVER = /evidence is unresolved/u;
const PENDING_REMOTE = /pending prerequisite remote-agent/u;
const PENDING_AUTH = /pending prerequisite auth/u;
const UNKNOWN_COMPUTER_CONTRACT =
  /Personal cloud Computer release requires proven unchanged native/u;
const CONTRACT_CYCLE = /incompatible.*dependencies/iu;
const REMOTE_AI_USAGE = [
  "packages/schemas/src/schemas/ai-usage.ts",
  "services/core/src/usage/ai-usage-rpc.ts",
  "services/remote-agent/agent-core/ai-usage.ts",
];

// The bridge witnesses this exact historical source, not the moving checkout.
// Final Candidate already requires complete Git history. Keep the production
// digest and drift fence intact instead of re-blessing later protocol changes.
const REVIEWED_SOURCE_SHA = "b660a196af4f24c6a4f4cf3a38cf4ef83b90431b";
const reviewedSources = new Map();
function readReviewedSource(path) {
  if (!reviewedSources.has(path)) {
    reviewedSources.set(
      path,
      execFileSync("git", ["show", `${REVIEWED_SOURCE_SHA}:${path}`], {
        cwd: new URL("../../", import.meta.url),
        encoding: "utf8",
      })
    );
  }
  return reviewedSources.get(path);
}

const requestContextFixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/strict-request-context-rollout.json", import.meta.url),
    "utf8"
  )
);

const COMPUTER_SOURCE = "46c1d3a78e23f1f96ae4532f5e1ee6ab98b10fbc";
const COMPUTER_CORE_BASE = "c6ba8899f8f97491bdf129749af7f5333f8be975";
const COMPUTER_REMOTE_BASE = "d799f3f66b6465564f4a9f11709a16292541db2d";
const computerSources = new Map();
function readComputerSource(ref, path) {
  const key = `${ref}:${path}`;
  if (!computerSources.has(key)) {
    computerSources.set(
      key,
      execFileSync("git", ["show", key], {
        cwd: new URL("../../", import.meta.url),
        encoding: "utf8",
      })
    );
  }
  return computerSources.get(key);
}

function computerPlan(base, scope, readGitFile = readComputerSource) {
  return buildProductionReleasePlan({
    base,
    changedPaths: execFileSync(
      "git",
      ["diff", "--name-only", base, COMPUTER_SOURCE],
      { cwd: new URL("../../", import.meta.url), encoding: "utf8" }
    )
      .trim()
      .split("\n"),
    databaseBackend: "postgresql",
    scope,
    sourceSha: COMPUTER_SOURCE,
    readGitFile,
  });
}

test("admits personal Computers through deployed database, Core and Remote receivers before CLI publication", () => {
  const scopes = [
    "db",
    "auth",
    "core",
    "remote-agent",
    "gateway",
    "web",
    "cli",
  ];
  const plan = computerPlan(COMPUTER_CORE_BASE, scopes.join(","));
  assert.deepEqual(plan.deployScopeOrder, scopes);
  assert.equal(
    plan.compatibilityBridges[0].kind,
    "additive-personal-cloud-computer"
  );
  const coreStage = computerPlan(COMPUTER_CORE_BASE, "core");
  assert.ok(
    coreStage.deploySteps.some(
      (step) =>
        step.args?.includes(
          "scripts/release/deploy-core-current-cli-projection.mjs"
        ) && step.args.includes("--deployment-only")
    )
  );
  assert.equal(
    coreStage.preflightSteps.some(
      (step) => step.label === "Verify Core CLI channel compatibility"
    ),
    false
  );
  const components = scopes.map((scope) => {
    const sha = scope === "core" ? COMPUTER_CORE_BASE : COMPUTER_REMOTE_BASE;
    return {
      scope,
      sha,
      state: "pending",
      compatibilityDependencies: computerPlan(sha, scopes.join(","))
        .compatibilityDependencies,
    };
  });
  const admit = (selectedScopes) =>
    assertProductionStageAdmission({
      components,
      selectedScopes,
      sourceSha: COMPUTER_SOURCE,
    });
  assert.throws(() => admit(["core"]), PENDING_DB);
  assert.doesNotThrow(() => admit(["db", "auth"]));
  for (const scope of ["db", "auth"]) {
    components.find((component) => component.scope === scope).state = "current";
  }
  assert.doesNotThrow(() => admit(["core"]));
  assert.throws(() => admit(["core", "remote-agent"]), PENDING_CORE);
  assert.throws(() => admit(["gateway"]), PENDING_REMOTE);
  assert.throws(() => admit(["cli"]), PENDING_RECEIVER);
  components.find((component) => component.scope === "core").state = "current";
  assert.doesNotThrow(() => admit(["remote-agent", "gateway", "web"]));
  assert.throws(() => admit(["cli"]), PENDING_RECEIVER);
  for (const scope of ["remote-agent", "gateway", "web"]) {
    components.find((component) => component.scope === scope).state = "current";
  }
  assert.doesNotThrow(() => admit(["cli"]));
  components.find((component) => component.scope === "auth").state = "pending";
  assert.throws(() => admit(["cli"]), PENDING_AUTH);
});

for (const fault of [
  "native_request",
  "remote_entrypoint",
  "center_receiver",
  "missing_history",
]) {
  test(`rejects the personal Computer release after ${fault}`, () => {
    assert.throws(
      () =>
        computerPlan(COMPUTER_CORE_BASE, "core,remote-agent", (ref, path) => {
          if (fault === "missing_history") {
            throw new Error("missing receipt baseline");
          }
          const source = readComputerSource(ref, path);
          const driftPath = {
            native_request:
              "services/core/src/remote-agent/application/native-delivery-service.ts",
            remote_entrypoint: "services/remote-agent/.flue/cloudflare.ts",
            center_receiver:
              "services/remote-agent/.flue/agents/center-agent.ts",
          }[fault];
          return ref === COMPUTER_SOURCE && path === driftPath
            ? `${source}\n// Unreviewed owner change.\n`
            : source;
        }),
      UNKNOWN_COMPUTER_CONTRACT
    );
  });
}

test("admits the reviewed Core request bridge while retaining the metering receiver dependency", () => {
  const base = "e4454cf165b96c7f918e420f28205c2b2ed3c575";
  const sourceSha = REVIEWED_SOURCE_SHA;
  const readGitFile = (ref, path) =>
    ref === base
      ? "// Core before the metering receiver was introduced."
      : readReviewedSource(path);
  const paths = [
    ...REMOTE_AI_USAGE,
    "services/remote-agent/.flue/cloudflare.ts",
    "packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts",
    "services/core/src/remote-agent/application/remote-agent-worker-admission.ts",
    "services/remote-agent/.flue/agents/center-agent.ts",
  ];
  const plan = buildProductionReleasePlan({
    base,
    sourceSha,
    changedPaths: paths,
    scope: "core,remote-agent",
    readGitFile,
  });
  assert.deepEqual(plan.deployScopeOrder, ["core", "remote-agent"]);
  assert.deepEqual(plan.compatibilityDependencies, [["core", "remote-agent"]]);
  assert.equal(
    plan.compatibilityBridges[0].kind,
    "negotiated-remote-task-attribution"
  );
  assert.equal(plan.compatibilityBridges[0].baselineSha, base);
  const components = [
    { scope: "core", state: "pending", sha: base, ...plan },
    { scope: "remote-agent", state: "pending", sha: base, ...plan },
  ];
  assert.doesNotThrow(() =>
    assertProductionStageAdmission({
      components,
      sourceSha,
      selectedScopes: ["core"],
    })
  );
  assert.throws(
    () =>
      assertProductionStageAdmission({
        components,
        sourceSha,
        selectedScopes: ["remote-agent"],
      }),
    PENDING_RECEIVER
  );
});

for (const withGatewayContext of [false, true]) {
  test(`keeps separate execution-input receivers outside the native request bridge${withGatewayContext ? " with Gateway context" : ""}`, () => {
    const base = "e4454cf165b96c7f918e420f28205c2b2ed3c575";
    const sourceSha = REVIEWED_SOURCE_SHA;
    const paths = [
      "packages/schemas/src/schemas/runtime/remote-agent-execution-input.ts",
      "services/core/src/space/transport/do/space.ts",
      "services/remote-agent/flue-adapter/execution-input.ts",
      ...(withGatewayContext
        ? [
            "packages/schemas/src/schemas/daemon/profile-identity.ts",
            "services/gateway/src/lib/openmeld-context.ts",
          ]
        : []),
    ];
    const plan = buildProductionReleasePlan({
      base,
      sourceSha,
      changedPaths: paths,
      scope: "core,remote-agent,cli,gateway",
      readGitFile: (ref, path) => {
        // Keep every previously reviewed owner byte-identical to its archived
        // digest. Only these separate request contracts expand in the candidate.
        const source = requestContextFixture.schemaSources[path];
        if (source) {
          return ref === base ? source.before : source.after;
        }
        return ref === base
          ? "// Published native-request baseline."
          : readReviewedSource(path);
      },
    });
    assert.equal(
      plan.compatibilityBridges[0].kind,
      "negotiated-remote-task-attribution"
    );
    assert.deepEqual(plan.compatibilityDependencies, [
      ...(withGatewayContext ? [["core", "gateway"]] : []),
      ["remote-agent", "core"],
      ["remote-agent", "cli"],
    ]);
    const components = ["core", "remote-agent", "gateway", "cli"].map(
      (scope) => ({ ...plan, scope, sha: base, state: "pending" })
    );
    const admit = (selectedScopes) =>
      assertProductionStageAdmission({ components, selectedScopes, sourceSha });
    assert.throws(() => admit(["core"]), PENDING_REMOTE);
    assert.throws(() => admit(["cli"]), PENDING_REMOTE);
    if (withGatewayContext) {
      assert.throws(() => admit(["gateway"]), PENDING_CORE);
    }
    components.find((component) => component.scope === "core").state =
      "current";
    assert.throws(() => admit(["cli"]), PENDING_REMOTE);
    components.find((component) => component.scope === "remote-agent").state =
      "current";
    assert.doesNotThrow(() => admit(["cli", "gateway"]));
  });
}

for (const fault of ["source_drift", "missing_history", "unknown_baseline"]) {
  test(`refuses to reuse the request bridge after ${fault}`, () => {
    const base =
      fault === "unknown_baseline"
        ? "b".repeat(40)
        : "e4454cf165b96c7f918e420f28205c2b2ed3c575";
    assert.throws(
      () =>
        buildProductionReleasePlan({
          base,
          sourceSha: "a".repeat(40),
          scope: "core,remote-agent",
          changedPaths: [
            ...REMOTE_AI_USAGE,
            "services/remote-agent/.flue/cloudflare.ts",
          ],
          readGitFile: (_ref, path) => {
            if (fault === "missing_history") {
              throw new Error("missing source");
            }
            const source = readReviewedSource(path);
            return fault === "source_drift" &&
              path.endsWith("remote-agent-worker.ts")
              ? `${source}\n// different contract`
              : source;
          },
        }),
      CONTRACT_CYCLE
    );
  });
}

test("does not invent a protocol cycle from Core receiver and persistence edits", () => {
  const plan = buildProductionReleasePlan({
    changedPaths: [
      "services/core/src/usage/ai-usage-rpc.ts",
      "services/core/src/center-agent/center-agent-context-manifest-repository.ts",
    ],
    sourceSha: "a".repeat(40),
    scope: "core,remote-agent",
  });
  assert.deepEqual(plan.compatibilityDependencies, []);
  assert.equal(plan.deployScopeOrder.length, 2);
  for (const signal of plan.compatibilityPathSignals) {
    assert.deepEqual(signal.matchedPaths, []);
    assert.equal(signal.nonTriggerPaths.length, 1);
  }
});

for (const receiverPath of [
  "services/remote-agent/.flue/cloudflare.ts",
  "services/core/src/center-agent/application/center-agent-context-manifest-service.ts",
]) {
  test(`does not hide the Core metering receiver behind ${receiverPath}`, () => {
    const paths = [...REMOTE_AI_USAGE, receiverPath];
    const edges = resolveProductionCompatibilityDependencies(paths);
    assert.ok(
      edges.some(
        ([receiver, producer]) =>
          receiver === "core" && producer === "remote-agent"
      )
    );
    assert.ok(
      edges.some(
        ([receiver, producer]) =>
          receiver === "remote-agent" && producer === "core"
      )
    );
    assert.throws(
      () =>
        buildProductionReleasePlan({
          changedPaths: paths,
          sourceSha: "a".repeat(40),
          scope: "core,remote-agent",
        }),
      CONTRACT_CYCLE
    );
  });
}
const INBOX_OBSERVATIONS = [
  "packages/schemas/src/schemas/http/inbox.ts",
  "services/core/src/inbox/application/inbox-notification-observations.ts",
  "services/gateway/src/routes/rpc-http.inbox.ts",
  "clients/web/src/lib/inbox/notification-observer.ts",
];

test("keeps Inbox readers before a new target writer during a storage migration", () => {
  const plan = buildProductionReleasePlan({
    changedPaths: [
      "packages/schemas/src/schemas/http/inbox.ts",
      "services/core/src/inbox/application/inbox-notification-observations.ts",
      "services/core/src/remote-agent/application/native-delivery-service.ts",
      "services/gateway/src/routes/rpc-http.inbox.ts",
      "clients/web/src/components/inbox/inbox-page.tsx",
    ],
    ...inboxMembershipContext(inboxMembershipFixture.callers.legacy.sha),
    scope: "web,gateway,core,cli",
  });
  assert.deepEqual(plan.deployScopeOrder, ["web", "gateway", "core", "cli"]);
  assert.deepEqual(plan.compatibilityDependencies, [
    ["web", "core"],
    ["gateway", "core"],
  ]);
});

for (const remoteReceiver of [false, true]) {
  test(`preserves the published CLI during an Inbox cloud stage${remoteReceiver ? " with a Remote receiver" : ""}`, () => {
    const sourceSha = "a".repeat(40);
    const plan = buildProductionReleasePlan({
      changedPaths: [
        "packages/schemas/src/schemas/http/inbox.ts",
        "services/core/src/remote-agent/application/native-delivery-service.ts",
        "release/local-components.json",
        "clients/openmeld-cli/package.json",
        ...(remoteReceiver
          ? ["services/remote-agent/.flue/cloudflare.ts"]
          : []),
      ],
      sourceSha,
      readGitFile: () =>
        "// Historical native receiver without Cloud Computer.",
      scope: `db,auth,web,gateway,core${remoteReceiver ? ",remote-agent" : ""}`,
    });
    assert.deepEqual(plan.deployScopeOrder, [
      "db",
      ...(remoteReceiver ? ["remote-agent"] : []),
      "auth",
      "web",
      "gateway",
      "core",
    ]);
    const core = plan.deploySteps.filter(
      (step) => step.releaseScope === "core"
    );
    assert.deepEqual(
      core.map((step) => step.args),
      [
        [
          "scripts/release/deploy-core-current-cli-projection.mjs",
          "--deployment-only",
          "--release-sha",
          sourceSha,
        ],
        [
          "scripts/release/deploy-core-current-cli-projection.mjs",
          "--verify-only",
          "--release-sha",
          sourceSha,
        ],
      ]
    );
    assert.equal(core[0].completesReleaseScope, false);
    assert.equal(core[1].completesReleaseScope, true);
    assert.ok(
      !plan.deploySteps.some((step) => step.internalOperation === "publish-cli")
    );
    for (const steps of [plan.preflightSteps, plan.verifySteps]) {
      assert.ok(
        !steps.some(
          (step) => step.label === "Verify Core CLI channel compatibility"
        )
      );
    }
    assert.ok(
      plan.preflightSteps.some(
        (step) => step.label === "Admit receipt-based Production train stage"
      )
    );
    assert.ok(
      plan.preflightSteps.some(
        (step) => step.label === "Verify declared Production train artifacts"
      )
    );
  });
}

test("deploys Inbox observation receivers before callers, composed with Remote titles", () => {
  const plan = buildProductionReleasePlan({
    changedPaths: [
      ...INBOX_OBSERVATIONS,
      "services/remote-agent/.flue/cloudflare.ts",
    ],
    sourceSha: "a".repeat(40),
    readGitFile: () => "// Historical native receiver without Cloud Computer.",
    scope: "web,gateway,core,remote-agent",
  });
  assert.deepEqual(plan.deployScopeOrder, [
    "remote-agent",
    "core",
    "gateway",
    "web",
  ]);
  assert.ok(
    plan.compatibilityDependencies.some(
      ([receiver, producer]) => receiver === "core" && producer === "gateway"
    )
  );
  assert.ok(
    plan.compatibilityDependencies.some(
      ([receiver, producer]) => receiver === "gateway" && producer === "web"
    )
  );
  const automatic = resolveAutomaticReleaseScopes({
    changedPaths: INBOX_OBSERVATIONS,
    affectedPackages: [],
  });
  assert.ok(
    ["core", "gateway", "web"].every((scope) => automatic.includes(scope))
  );
  const components = ["core", "gateway", "web"].map((scope) => ({
    scope,
    state: "pending",
    sha: "b".repeat(40),
    compatibilityDependencies: plan.compatibilityDependencies,
  }));
  const admit = (scope) =>
    assertProductionStageAdmission({
      components,
      selectedScopes: [scope],
      sourceSha: "a".repeat(40),
    });
  assert.throws(() => admit("gateway"), PENDING_RECEIVER);
  assert.throws(() => admit("web"), PENDING_RECEIVER);
  components[0].state = "current";
  assert.doesNotThrow(() => admit("gateway"));
  assert.throws(() => admit("web"), PENDING_RECEIVER);
  components[1].state = "current";
  assert.doesNotThrow(() => admit("web"));
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(
      [INBOX_OBSERVATIONS[0], "clients/web/src/routes/unrelated.tsx"],
      false,
      inboxMembershipContext(inboxMembershipFixture.callers.legacy.sha)
    ),
    []
  );
});

const legacyFolderRecoverySource = {
  sourceSha: "a".repeat(40),
  readGitFile: () =>
    "// Historical folder recovery without saved-workspace reads.",
};

test("deploys the cancellation receiver before CLI and verified npm before Web", () => {
  const plan = buildProductionReleasePlan({
    changedPaths: [...FOLDER_RECOVERY, ...NPM_SETUP],
    ...legacyFolderRecoverySource,
    scope: "core,cli,web",
  });
  assert.deepEqual(plan.compatibilityDependencies, [
    ["core", "cli"],
    ["cli", "web"],
  ]);
  assert.deepEqual(plan.deployScopeOrder, ["core", "cli", "web"]);
  const core = plan.deploySteps.findIndex(
    (step) =>
      step.label === "Deploy Core with the current published CLI projection"
  );
  const cli = plan.deploySteps.findIndex(
    (step) => step.internalOperation === "publish-cli"
  );
  const web = plan.deploySteps.findIndex((step) => step.label === "Deploy Web");
  assert.ok(core >= 0 && cli > core && web > cli);
  const coreOnly = buildProductionReleasePlan({
    changedPaths: FOLDER_RECOVERY,
    ...legacyFolderRecoverySource,
    scope: "core",
  });
  assert.ok(
    coreOnly.deploySteps.some(
      (step) =>
        step.label === "Deploy Core with the current published CLI projection"
    )
  );
  assert.ok(
    !coreOnly.preflightSteps.some(
      (step) => step.label === "Verify Core CLI channel compatibility"
    )
  );
});

test("does not make the reviewed Windows binary preview wait for an npm CLI release", () => {
  const base = "7b8741ea2b096a8c36c5245d5d8810a8c568fc89";
  const sourceSha = "472c771fc5b74a7cf6b327abc61c85d66ee16172";
  const plan = buildProductionReleasePlan({
    base,
    changedPaths: WINDOWS_PREVIEW_PATHS,
    sourceSha,
    scope: "web",
  });
  assert.deepEqual(plan.compatibilityDependencies, []);
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(WINDOWS_PREVIEW_PATHS),
    [["cli", "web"]]
  );
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(WINDOWS_PREVIEW_PATHS, false, {
      base,
      sourceSha,
      readBlobSha: () => "changed-later",
    }),
    [["cli", "web"]]
  );
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(NPM_SETUP, false, {
      base,
      sourceSha,
    }),
    [["cli", "web"]]
  );
});

test("staged recovery and npm rollout require receipts, not unrelated backlog", () => {
  const dependencies = resolveProductionCompatibilityDependencies(
    [...FOLDER_RECOVERY, ...NPM_SETUP],
    false,
    legacyFolderRecoverySource
  );
  const components = ["core", "cli", "web", "gateway"].map((scope) => ({
    scope,
    state: "pending",
    sha: "b".repeat(40),
    compatibilityDependencies: dependencies,
  }));
  const admit = (scope) =>
    assertProductionStageAdmission({
      components,
      selectedScopes: [scope],
      sourceSha: "a".repeat(40),
    });
  assert.throws(() => admit("cli"), PENDING_RECEIVER);
  assert.throws(() => admit("web"), PENDING_RECEIVER);
  components[0].state = "current";
  assert.doesNotThrow(() => admit("cli"));
  assert.throws(() => admit("web"), PENDING_RECEIVER);
  components[1].state = "current";
  assert.doesNotThrow(() => admit("web"));
});

test("refuses opposite cancellation and caller-context dependencies", () => {
  assert.throws(
    () =>
      buildProductionReleasePlan({
        changedPaths: [
          ...FOLDER_RECOVERY,
          "packages/schemas/src/schemas/protocol/space-caller-context.ts",
          "services/core/src/space/transport/do/space.ts",
          "clients/openmeld-cli/src/local-service/dispatch/parse-dispatch-task.ts",
        ],
        sourceSha: "a".repeat(40),
        scope: "auth,remote-agent,core,cli",
      }),
    CONTRACT_CYCLE
  );
});

test("accepts an already deployed folder-recovery receiver only with matching evidence", () => {
  const sourceSha = "a".repeat(40);
  const baselineSha = "b".repeat(40);
  const witnesses =
    resolveProductionCompatibilityReceiverWitnesses(FOLDER_RECOVERY);
  const witness = witnesses.find(
    ({ receiver, producer }) => receiver === "core" && producer === "cli"
  );
  assert.ok(witness);
  assert.ok(
    witness.receiverPaths.includes(
      "packages/schemas/src/working-folder-recovery.ts"
    )
  );
  assert.ok(
    witness.receiverPaths.includes(
      "services/core/src/runtime-transport/application/local-agent-stream.ts"
    )
  );
  const components = [
    { scope: "core", state: "pending", sha: baselineSha },
    {
      scope: "cli",
      state: "pending",
      sha: baselineSha,
      compatibilityDependencies: [["core", "cli"]],
      compatibilityObligations: resolveProductionCompatibilityObligations(
        FOLDER_RECOVERY,
        false,
        legacyFolderRecoverySource
      ),
      compatibilityReceiverWitnesses: [
        {
          ...witness,
          evidence: { baselineSha, targetSha: sourceSha, result: "match" },
        },
      ],
    },
  ];
  const admit = () =>
    assertProductionStageAdmission({
      components,
      selectedScopes: ["cli"],
      sourceSha,
    });
  assert.doesNotThrow(admit);
  components[1].compatibilityReceiverWitnesses[0].evidence.result = "mismatch";
  assert.throws(admit, PENDING_RECEIVER);
  components[1].compatibilityReceiverWitnesses[0].evidence.result = "match";
  components[0].sha = "c".repeat(40);
  assert.throws(admit, PENDING_RECEIVER);
});

const SPACE_TASK_RECEIVERS = [
  "packages/schemas/src/schemas/http/space-tasks.ts",
  "services/core/src/rpc/methods.ts",
  "services/core/src/space/transport/do/space.ts",
];
const DEVICE_WAIT_RECEIVERS = [
  "packages/schemas/src/schemas/protocol/wake-device-wait.ts",
  "services/core/src/space/transport/do/space.ts",
  "services/gateway/src/routes/rpc-http.signals.ts",
];
const PEOPLE_COMPUTERS_RECEIVERS = [
  "packages/schemas/src/schemas/http/people-computers.ts",
  "services/core/src/people-computers/projection.ts",
  "services/gateway/src/routes/rpc-http.people-computers.ts",
];
const SPACE_INVITATION_RECEIVERS = [
  "packages/schemas/src/space-invitation.ts",
  "services/core/src/organizations/space-invitations.ts",
  "services/auth/src/lib/hono/space-invitation-routes.ts",
];

test("keeps default scheduling and unrelated pending scopes out of the dependency graph", () => {
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(
      ["services/core/src/index.ts", "clients/web/src/routes/index.tsx"],
      false,
      { sourceSha: "1".repeat(40), readGitFile: () => "// legacy caller" }
    ),
    []
  );
});

test("adds only the Space Task dependency for the changed caller", () => {
  const context = {
    sourceSha: "1".repeat(40),
    readGitFile: () => "// legacy caller",
  };
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(
      [
        ...SPACE_TASK_RECEIVERS,
        "services/remote-agent/agent-core/tools.ts",
        "clients/web/src/routes/unrelated.tsx",
      ],
      false,
      context
    ),
    [["core", "remote-agent"]]
  );
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(
      [
        ...SPACE_TASK_RECEIVERS,
        "clients/openmeld-cli/src/space/dispatch-task.ts",
      ],
      false,
      context
    ),
    [
      ["core", "gateway"],
      ["gateway", "cli"],
    ]
  );
});

test("retains all contracts on a deduplicated receiver/producer edge", () => {
  const changedPaths = [
    ...REMOTE_AI_USAGE,
    "packages/schemas/src/schemas/runtime/personal-remote-agent.ts",
    "services/core/src/remote-agent/application/remote-agent-tool-caller.ts",
    "services/remote-agent/agent-core/personal-remote-agent-tools.ts",
    ...SPACE_TASK_RECEIVERS,
    "services/remote-agent/agent-core/tools.ts",
  ];
  const context = {
    sourceSha: "1".repeat(40),
    readGitFile: (_ref, file) =>
      file === "services/remote-agent/agent-core/tools.ts"
        ? "centerAgentUpdateAgentProfileRuntimeSettingsWithSafeWorkspace"
        : "// Historical product without initializer or Binding precondition.",
  };
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(changedPaths, false, context),
    [["core", "remote-agent"]]
  );
  assert.deepEqual(
    resolveProductionCompatibilityObligations(changedPaths, false, context).map(
      ({ contract }) => contract
    ),
    [
      "center-agent-safe-workspace",
      "remote-ai-usage",
      "space-task",
      "personal-remote-tools",
    ]
  );
  const witnesses =
    resolveProductionCompatibilityReceiverWitnesses(changedPaths);
  assert.deepEqual(
    witnesses.map(({ contracts }) => contracts),
    [["remote-ai-usage"]]
  );
});

test("keeps optional Device Wait and People Computers callers independent", () => {
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(DEVICE_WAIT_RECEIVERS),
    [["core", "gateway"]]
  );
  assert.deepEqual(
    resolveProductionCompatibilityDependencies([
      ...DEVICE_WAIT_RECEIVERS,
      "clients/web/src/components/spaces/space-composer-device-wait.ts",
    ]),
    [
      ["core", "gateway"],
      ["gateway", "web"],
    ]
  );
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(
      PEOPLE_COMPUTERS_RECEIVERS,
      false,
      {
        sourceSha: "1".repeat(40),
        readGitFile: () =>
          "// Historical People Computers without Binding precondition.",
      }
    ),
    [["core", "gateway"]]
  );
});

test("requires the signed caller-context Service before its Core producer", () => {
  assert.deepEqual(
    resolveProductionCompatibilityDependencies([
      "packages/schemas/src/schemas/protocol/space-caller-context.ts",
      "services/core/src/space/transport/do/space.ts",
      "clients/openmeld-cli/src/local-service/dispatch/parse-dispatch-task.ts",
    ]),
    [
      ["auth", "cli"],
      ["remote-agent", "cli"],
      ["cli", "core"],
    ]
  );
});

test("requires every strict worker-response reader before the Remote producer", () => {
  assert.deepEqual(
    resolveProductionCompatibilityDependencies([
      "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
      "services/remote-agent/.flue/agents/center-agent.ts",
    ]),
    [
      ["core", "remote-agent"],
      ["gateway", "remote-agent"],
      ["web", "remote-agent"],
    ]
  );
});

test("does not invent a worker-response change for the reviewed hosted progress bridge", () => {
  const before = [
    "export const reasons = {",
    '  TURN_FAILED: "remote_agent.turn.failed",',
    "};",
    "export const callbacks = z.union([",
    '  z.strictObject({ kind: z.literal("text") }),',
    "]);",
    "",
  ].join("\n");
  const after = before
    .replace(
      '  TURN_FAILED: "remote_agent.turn.failed",\n',
      '  TURN_OUTPUT_LIMIT_EXCEEDED: "remote_agent.turn.output_limit_exceeded",\n  TURN_FAILED: "remote_agent.turn.failed",\n'
    )
    .replace(
      '  z.strictObject({ kind: z.literal("text") }),\n',
      [
        '  z.strictObject({ kind: z.literal("text") }),',
        "  z.strictObject({",
        "    ...typedRemoteAgentStreamDeltaCallbackIdentitySchema,",
        '    kind: z.literal("progress"),',
        '    source: z.literal("hosted.public_progress"),',
        "  }),",
        "",
      ].join("\n")
    );
  const changedPaths = [
    "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
    "services/core/src/remote-agent/application/native-delivery-service.ts",
    "services/remote-agent/.flue/agents/center-agent.ts",
    "services/remote-agent/.flue/cloudflare.ts",
    "services/remote-agent/flue-adapter/streaming.ts",
  ];
  const streamSource = [
    'response.reasonCode === "agent_stream.invalid"',
    "state.sequence = previousSequence",
    "transientState.progressUnsupported = true",
  ].join("\n");
  const planWith = (schemaAfter, streamAfter = streamSource) =>
    buildProductionReleasePlan({
      affectedPackages: [],
      base: "b".repeat(40),
      changedPaths,
      readGitFile: (ref, path) => {
        if (path.endsWith("streaming.ts")) {
          return streamAfter;
        }
        return ref === "b".repeat(40) ? before : schemaAfter;
      },
      scope: "core,remote-agent",
      sourceSha: "a".repeat(40),
    });

  const bridge = planWith(after);
  assert.equal(bridge.deployOrderProfile, "remote-agent-receiver-first");
  assert.deepEqual(bridge.deployScopeOrder, ["remote-agent", "core"]);
  assert.deepEqual(bridge.compatibilityDependencies, [
    ["remote-agent", "core"],
  ]);
  assert.equal(bridge.changedPaths.includes(changedPaths[0]), true);

  const responseChange = planWith(`${after}export const newResponse = true;\n`);
  assert.equal(
    responseChange.compatibilityDependencies.some(
      ([receiver, producer]) =>
        receiver === "core" && producer === "remote-agent"
    ),
    true
  );
  const missingBridge = planWith(after, "no compatibility bridge");
  assert.equal(
    missingBridge.compatibilityDependencies.some(
      ([receiver, producer]) =>
        receiver === "core" && producer === "remote-agent"
    ),
    true
  );
});

test("preserves proven retirement direction instead of reclassifying its schema", () => {
  const paths = [
    "packages/schemas/src/schemas/http/inbox.ts",
    "services/core/src/remote-agent/application/native-delivery-inbox-producer.ts",
  ];
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(
      paths,
      false,
      inboxMembershipContext(inboxMembershipFixture.callers.legacy.sha)
    ),
    [
      ["web", "core"],
      ["gateway", "core"],
    ]
  );
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(
      paths,
      true,
      inboxMembershipContext(inboxMembershipFixture.callers.legacy.sha)
    ),
    [
      ["core", "gateway"],
      ["core", "web"],
    ]
  );
});

test("adds invitation callers only when their producer path changes", () => {
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(SPACE_INVITATION_RECEIVERS),
    [["core", "auth"]]
  );
  assert.deepEqual(
    resolveProductionCompatibilityDependencies([
      ...SPACE_INVITATION_RECEIVERS,
      "clients/openmeld-cli/src/space/invitations-command.ts",
      "clients/web/src/lib/organizations/space-invitations.ts",
    ]),
    [
      ["core", "auth"],
      ["auth", "cli"],
      ["auth", "web"],
    ]
  );
});

test("composes independent receiver contracts without duplicate edges", () => {
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(
      [
        "packages/schemas/src/schemas/http/center-agent-memory-search.ts",
        "services/core/src/index.ts",
        "services/remote-agent/agent-core/tools.ts",
        "packages/schemas/src/schemas/runtime/personal-remote-agent.ts",
        "services/core/src/remote-agent/application/remote-agent-tool-caller.ts",
        "services/remote-agent/agent-core/personal-remote-agent-tools.ts",
      ],
      false,
      {
        sourceSha: "1".repeat(40),
        readGitFile: (_ref, file) =>
          file === "services/remote-agent/agent-core/tools.ts"
            ? "centerAgentUpdateAgentProfileRuntimeSettingsWithSafeWorkspace"
            : "// Historical product without Binding precondition.",
      }
    ),
    [["core", "remote-agent"]]
  );
});

test("attaches exact Remote receiver content witnesses and preserves reviewed combinations", () => {
  const executionReconciliation = [
    "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
    "services/core/src/remote-agent/application/native-delivery-service.ts",
    "services/remote-agent/flue-adapter/execution-reconciliation.ts",
  ];
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(executionReconciliation),
    [["remote-agent", "core"]]
  );
  assert.deepEqual(
    resolveProductionCompatibilityReceiverWitnesses(executionReconciliation),
    [
      {
        producer: "core",
        receiver: "remote-agent",
        contracts: ["remote-agent-request"],
        receiverPaths: [
          "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
          "services/remote-agent/flue-adapter/execution-reconciliation.ts",
        ],
      },
    ]
  );

  const callerContextAndInvitation = [
    "packages/schemas/src/schemas/protocol/space-caller-context.ts",
    "services/core/src/space/transport/do/space.ts",
    "clients/openmeld-cli/src/local-service/dispatch/parse-dispatch-task.ts",
    ...SPACE_INVITATION_RECEIVERS,
  ];
  assert.deepEqual(
    resolveProductionCompatibilityDependencies(callerContextAndInvitation),
    [
      ["auth", "cli"],
      ["remote-agent", "cli"],
      ["cli", "core"],
    ]
  );
});

const reliabilityFixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/reliability-receiver-increments.json", import.meta.url),
    "utf8"
  )
);
const RELIABILITY_TARGET = "2".repeat(40);
const RELIABILITY_LEGACY = "1".repeat(40);
// Minimal product source inputs for obligation registration only. They cannot
// prove receiver compatibility. The paths are preserved from real PR increments;
// the method and field names come from the required product RPC/wire contracts.
const reliabilityFeatureSources = new Map([
  [
    "packages/auth/src/profiles/profile-repository.ts",
    "defaultProjectRevision: 0",
  ],
  [
    "services/core/src/projects/agent-profile-default-project-service.ts",
    "authWorker.initializeAgentProfileDefaultProjectInOrganization(request)",
  ],
  [
    "packages/schemas/src/schemas/http/agent-profile-binding.ts",
    "export const agentProfileBindingTargetSchema = z.strictObject({ bindingId, agentControllerRef, agentControllerConversationId, openMeldServiceRuntimeId });",
  ],
  [
    "packages/schemas/src/schemas/runtime/cloud-computer.ts",
    "export const cloudComputerCommandReferenceSchema = z.strictObject({ invocationId, key, id, backend }); const list = z.strictObject({ action: z.literal('list'), includeReceiptDetails: z.boolean().optional() });",
  ],
]);
function readReliabilityProduct(ref, file) {
  if (
    ![
      RELIABILITY_TARGET,
      RELIABILITY_LEGACY,
      ...reliabilityFixture.increments.map((i) => i.sourceSha),
    ].includes(ref)
  ) {
    throw new Error("Read the explicit product source, never control HEAD.");
  }
  return ref === RELIABILITY_LEGACY
    ? "// Known historical source without these features."
    : (reliabilityFeatureSources.get(file) ??
        "// Unchanged native request and legacy workspace caller.");
}
const reliabilityContext = {
  sourceSha: RELIABILITY_TARGET,
  readGitFile: readReliabilityProduct,
};
const BINDING_PRECONDITIONS = [
  {
    contract: "agent-profile-binding-precondition",
    receiver: "core",
    producer: "gateway",
  },
  {
    contract: "agent-profile-binding-precondition",
    receiver: "gateway",
    producer: "web",
  },
];
const CLOUD_RECEIPT_OPT_IN = [
  {
    contract: "cloud-command-receipt-opt-in",
    receiver: "core",
    producer: "gateway",
  },
  {
    contract: "cloud-command-receipt-opt-in",
    receiver: "remote-agent",
    producer: "gateway",
  },
  {
    contract: "cloud-command-receipt-opt-in",
    receiver: "gateway",
    producer: "cli",
  },
];
const DEFAULT_PROJECT_INITIALIZER = {
  contract: "agent-profile-default-project-initializer",
  receiver: "auth",
  producer: "core",
};
const DEFAULT_PROJECT_REVISION = {
  contract: "agent-profile-default-project-revision",
  receiver: "db",
  producer: "auth",
};
const RELIABILITY_OBLIGATIONS = [
  DEFAULT_PROJECT_REVISION,
  DEFAULT_PROJECT_INITIALIZER,
  ...BINDING_PRECONDITIONS,
  ...CLOUD_RECEIPT_OPT_IN,
];
const reliabilityChangedPaths = [
  ...new Set(reliabilityFixture.increments.flatMap((i) => i.changedPaths)),
];

test("registers required receivers from real initializer, Binding and Cloud increment paths", () => {
  const obligations = resolveProductionCompatibilityObligations(
    reliabilityChangedPaths,
    false,
    reliabilityContext
  );
  for (const obligation of RELIABILITY_OBLIGATIONS) {
    assert.ok(
      obligations.some((o) => JSON.stringify(o) === JSON.stringify(obligation))
    );
  }
  assert.equal(
    obligations.some(
      (o) =>
        o.contract === "cloud-command-receipt-opt-in" && o.producer === "core"
    ),
    false,
    "Core relays requests; it does not introduce new opt-in fields before Gateway"
  );
  for (const increment of reliabilityFixture.increments) {
    const result = resolveProductionCompatibilityObligations(
      increment.changedPaths,
      false,
      {
        sourceSha: increment.sourceSha,
        readGitFile: readReliabilityProduct,
      }
    );
    let required = CLOUD_RECEIPT_OPT_IN;
    if (increment.name.startsWith("auth")) {
      required = [DEFAULT_PROJECT_REVISION, DEFAULT_PROJECT_INITIALIZER];
    } else if (increment.name.startsWith("binding")) {
      required = BINDING_PRECONDITIONS;
    }
    for (const obligation of required) {
      assert.ok(
        result.some((o) => JSON.stringify(o) === JSON.stringify(obligation)),
        increment.name
      );
    }
  }
});

test("orders the real Binding and Cloud increments by their receivers", () => {
  const cases = [
    {
      increment: reliabilityFixture.increments[1],
      scope: "core,gateway,web",
      order: ["core", "gateway", "web"],
    },
    {
      increment: reliabilityFixture.increments[2],
      scope: "core,remote-agent,gateway,cli",
      order: ["core", "remote-agent", "gateway", "cli"],
    },
  ];
  for (const { increment, scope, order } of cases) {
    const plan = buildProductionReleasePlan({
      ...increment,
      scope,
      readGitFile: readReliabilityProduct,
      databaseBackend: "postgresql",
    });
    assert.deepEqual(plan.deployScopeOrder, order);
  }
});

test("caller-only changes retain required contracts; known legacy sources do not", () => {
  const callers = [
    [
      "services/core/src/projects/agent-profile-default-project-service.ts",
      DEFAULT_PROJECT_INITIALIZER,
    ],
    [
      "packages/auth/src/profiles/profile-repository.ts",
      DEFAULT_PROJECT_REVISION,
    ],
    [
      "services/gateway/src/routes/rpc-http.people-computers.ts",
      BINDING_PRECONDITIONS[0],
    ],
    [
      "clients/web/src/lib/profiles/update-profile-workspace.ts",
      BINDING_PRECONDITIONS[1],
    ],
    [
      "clients/openmeld-cli/src/commands/cloud-computer.ts",
      CLOUD_RECEIPT_OPT_IN[2],
    ],
    ["packages/api-client/src/cloud-computer.ts", CLOUD_RECEIPT_OPT_IN[2]],
  ];
  for (const [file, expectedObligation] of callers) {
    for (const input of [
      reliabilityContext,
      {},
      {
        sourceSha: RELIABILITY_TARGET,
        readGitFile() {
          throw new Error("unreadable product source");
        },
      },
    ]) {
      const obligations = resolveProductionCompatibilityObligations(
        [file],
        false,
        input
      );
      assert.ok(
        obligations.some(
          (o) => JSON.stringify(o) === JSON.stringify(expectedObligation)
        ),
        file
      );
    }
    assert.deepEqual(
      resolveProductionCompatibilityObligations([file], false, {
        sourceSha: RELIABILITY_LEGACY,
        readGitFile: readReliabilityProduct,
      }),
      []
    );
  }
});

test("pending and unresolved receivers block callers; verified current receivers admit them", () => {
  for (const obligation of RELIABILITY_OBLIGATIONS) {
    const producer = {
      scope: obligation.producer,
      state: "pending",
      sha: RELIABILITY_LEGACY,
      compatibilityObligations: [obligation],
      compatibilityDependencies: [[obligation.receiver, obligation.producer]],
      // A matching older contract on the same pair cannot substitute for this one.
      compatibilityReceiverWitnesses: [
        {
          receiver: obligation.receiver,
          producer: obligation.producer,
          contracts: ["older-unrelated-contract"],
          evidence: {
            result: "match",
            baselineSha: RELIABILITY_LEGACY,
            targetSha: RELIABILITY_TARGET,
          },
        },
      ],
    };
    const receiver = {
      scope: obligation.receiver,
      state: "pending",
      sha: RELIABILITY_LEGACY,
      evidence: { result: "verified" },
    };
    const input = {
      sourceSha: RELIABILITY_TARGET,
      selectedScopes: [obligation.producer],
      components: [receiver, producer],
    };
    assert.throws(
      () => assertProductionStageAdmission(input),
      PENDING_RECEIVER
    );
    receiver.state = "unknown";
    assert.throws(
      () => assertProductionStageAdmission(input),
      UNRESOLVED_RECEIVER
    );
    receiver.state = "current";
    receiver.sha = RELIABILITY_TARGET;
    assert.doesNotThrow(() => assertProductionStageAdmission(input));
  }
});

const savedWorkspaceReadIncrement = reliabilityFixture.profileWorkspaceRead;
const workspaceInitializeIncrement = reliabilityFixture.increments[0];
const WORKSPACE_INITIALIZE = {
  contract: "profile-workspace-initialize",
  receiver: "core",
  producer: "cli",
};
const workspaceInitializeFeatureSources = new Map([
  [
    "packages/schemas/src/schemas/daemon/runtime-transport.ts",
    "localAgentControl: z.strictObject({ initializeProfileWorkspace: z.literal(true).optional() })",
  ],
  [
    "clients/openmeld-cli/src/local-service/adapters/resolve-daemon-capabilities.ts",
    "localAgentControl: { initializeProfileWorkspace: true }",
  ],
  [
    "services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts",
    'capability: parsed.data.onlyIfUnconfigured ? "initializeProfileWorkspace" : "setProfileWorkspace"',
  ],
]);
const INITIALIZE_PARENT = savedWorkspaceReadIncrement.base;
function readWorkspaceCapabilities(ref, file) {
  if (ref === RELIABILITY_LEGACY) {
    return "// Known legacy without either capability.";
  }
  if (
    ![
      workspaceInitializeIncrement.sourceSha,
      INITIALIZE_PARENT,
      savedWorkspaceReadIncrement.sourceSha,
    ].includes(ref)
  ) {
    throw new Error(
      "Read the explicit initialization product, never control HEAD."
    );
  }
  const initializer = workspaceInitializeFeatureSources.get(file);
  const read =
    ref === savedWorkspaceReadIncrement.sourceSha
      ? savedWorkspaceFeatureSources.get(file)
      : undefined;
  return (
    [initializer, read].filter(Boolean).join("\n") ||
    "// Unchanged other contract."
  );
}
const initializeContext = {
  sourceSha: INITIALIZE_PARENT,
  readGitFile: readWorkspaceCapabilities,
};
const initializeObligations = (paths, context = initializeContext) =>
  resolveProductionCompatibilityObligations(paths, false, context).filter(
    (o) => o.contract === "profile-workspace-initialize"
  );

test("workspace-initialize real original increment and current source retain a distinct Core receiver", () => {
  for (const increment of [
    workspaceInitializeIncrement,
    savedWorkspaceReadIncrement,
  ]) {
    const context = {
      sourceSha: increment.sourceSha,
      readGitFile: readWorkspaceCapabilities,
    };
    assert.deepEqual(initializeObligations(increment.changedPaths, context), [
      WORKSPACE_INITIALIZE,
    ]);
    const obligations = resolveProductionCompatibilityObligations(
      increment.changedPaths,
      false,
      context
    );
    assert.ok(
      obligations.some(
        (o) =>
          o.contract === "local-service-runtime" &&
          o.receiver === "core" &&
          o.producer === "cli"
      )
    );
    assert.equal(
      obligations.some(
        (o) =>
          o.contract === "profile-workspace-initialize" && o.receiver === "cli"
      ),
      false
    );
  }
  const oldIncrement = initializeObligations(
    workspaceInitializeIncrement.changedPaths,
    {
      sourceSha: RELIABILITY_LEGACY,
      readGitFile: readWorkspaceCapabilities,
    }
  );
  assert.deepEqual(oldIncrement, []);
});

test("workspace-initialize sender-only changes read target source and fail closed on unknown", () => {
  const sender =
    "clients/openmeld-cli/src/local-service/adapters/resolve-daemon-capabilities.ts";
  for (const context of [
    initializeContext,
    {},
    {
      sourceSha: INITIALIZE_PARENT,
      readGitFile() {
        throw new Error("unreadable");
      },
    },
  ]) {
    assert.deepEqual(initializeObligations([sender], context), [
      WORKSPACE_INITIALIZE,
    ]);
  }
  const obligations = resolveProductionCompatibilityObligations(
    [sender],
    false,
    initializeContext
  );
  assert.equal(
    obligations.some((o) => o.contract === "profile-workspace-read"),
    false,
    "initialize-only source does not prove read"
  );
  assert.equal(
    obligations.some(
      (o) => o.contract === "agent-profile-default-project-initializer"
    ),
    false,
    "Service initialization is not Auth initialization"
  );
  assert.equal(
    obligations.some((o) => o.contract === "local-service-runtime"),
    false,
    "the historical multi-path classifier misses this real isolated sender path"
  );
  assert.deepEqual(
    initializeObligations([sender], {
      sourceSha: RELIABILITY_LEGACY,
      readGitFile: readWorkspaceCapabilities,
    }),
    []
  );
  assert.deepEqual(
    initializeObligations(["clients/web/src/routes/unrelated.tsx"]),
    []
  );
});

test("workspace-initialize, read and older runtime witnesses cannot replace each other", () => {
  const sourceSha = savedWorkspaceReadIncrement.sourceSha;
  const contracts = [
    "profile-workspace-initialize",
    "profile-workspace-read",
    "local-service-runtime",
  ];
  const obligations = resolveProductionCompatibilityObligations(
    savedWorkspaceReadIncrement.changedPaths,
    false,
    {
      sourceSha,
      readGitFile: readWorkspaceCapabilities,
    }
  ).filter(
    (o) =>
      o.receiver === "core" &&
      o.producer === "cli" &&
      contracts.includes(o.contract)
  );
  const receiver = {
    scope: "core",
    sha: INITIALIZE_PARENT,
    state: "pending",
    evidence: { result: "verified" },
  };
  const producer = {
    scope: "cli",
    sha: INITIALIZE_PARENT,
    state: "pending",
    compatibilityObligations: obligations,
    compatibilityDependencies: [["core", "cli"]],
    compatibilityReceiverWitnesses: [
      {
        receiver: "core",
        producer: "cli",
        contracts: [],
        evidence: {
          result: "match",
          baselineSha: INITIALIZE_PARENT,
          targetSha: sourceSha,
        },
      },
    ],
  };
  const input = {
    sourceSha,
    selectedScopes: ["cli"],
    components: [receiver, producer],
  };
  for (const missing of contracts) {
    producer.compatibilityReceiverWitnesses[0].contracts = contracts.filter(
      (c) => c !== missing
    );
    assert.throws(
      () => assertProductionStageAdmission(input),
      PENDING_RECEIVER,
      missing
    );
  }
  receiver.state = "unknown";
  assert.throws(
    () => assertProductionStageAdmission(input),
    UNRESOLVED_RECEIVER
  );
  receiver.state = "current";
  receiver.sha = sourceSha;
  assert.doesNotThrow(() => assertProductionStageAdmission(input));
});
const SAVED_WORKSPACE_READ = [
  { contract: "profile-workspace-read", receiver: "core", producer: "cli" },
  { contract: "profile-workspace-read", receiver: "core", producer: "gateway" },
  { contract: "profile-workspace-read", receiver: "gateway", producer: "web" },
];
const SAVED_WORKSPACE_SOURCE = "3".repeat(40);
const savedWorkspaceFeatureSources = new Map([
  [
    "packages/schemas/src/schemas/daemon/runtime-transport.ts",
    "const localAgentControl = z.strictObject({ readProfileWorkspace: z.literal(true).optional() });",
  ],
  [
    "clients/openmeld-cli/src/local-service/adapters/resolve-daemon-capabilities.ts",
    "localAgentControl: { readProfileWorkspace: true }",
  ],
  [
    "services/core/src/index.ts",
    "getCurrentAgentProfileWorkspace(input) { return rpcGetCurrentAgentProfileWorkspace(input); } getPeopleComputerAgentProfileWorkspace(input) { return rpcGetCurrentAgentProfileWorkspace(input); }",
  ],
  [
    "packages/api-client/src/current-device/api.ts",
    "getCurrentAgentProfileWorkspace: async (input) => client.requestJson({ method: 'GET' })",
  ],
]);
function readSavedWorkspaceProduct(ref, file) {
  if (
    ![
      SAVED_WORKSPACE_SOURCE,
      savedWorkspaceReadIncrement.sourceSha,
      RELIABILITY_LEGACY,
    ].includes(ref)
  ) {
    throw new Error("Read the explicit product source, never control HEAD.");
  }
  return ref === RELIABILITY_LEGACY
    ? "// Known legacy source without saved-workspace reads."
    : (savedWorkspaceFeatureSources.get(file) ??
        "// Unchanged other contract.");
}
const savedWorkspaceContext = {
  sourceSha: SAVED_WORKSPACE_SOURCE,
  readGitFile: readSavedWorkspaceProduct,
};
const savedWorkspaceObligations = (paths, context = savedWorkspaceContext) =>
  resolveProductionCompatibilityObligations(paths, false, context).filter(
    (o) => o.contract === "profile-workspace-read"
  );

test("saved-workspace real increment retains its registration, RPC and HTTP receiver obligations", () => {
  assert.deepEqual(
    savedWorkspaceObligations(savedWorkspaceReadIncrement.changedPaths, {
      sourceSha: savedWorkspaceReadIncrement.sourceSha,
      readGitFile: readSavedWorkspaceProduct,
    }),
    SAVED_WORKSPACE_READ
  );
  const plan = buildProductionReleasePlan({
    ...savedWorkspaceReadIncrement,
    readGitFile: readSavedWorkspaceProduct,
    scope: "core,cli,gateway,web",
    databaseBackend: "postgresql",
  });
  for (const { receiver, producer } of SAVED_WORKSPACE_READ) {
    assert.ok(
      plan.deployScopeOrder.indexOf(receiver) <
        plan.deployScopeOrder.indexOf(producer),
      `${receiver} must precede ${producer}`
    );
  }
  assert.equal(
    plan.compatibilityObligations.some(
      (o) =>
        o.contract === "profile-workspace-read" &&
        o.receiver === "cli" &&
        o.producer === "core"
    ),
    false,
    "the Core read negotiates Service support; old Service refuses before the read frame"
  );
});

test("saved-workspace sender-only and caller-only changes use target source; unknown sources retain obligations", () => {
  const paths = [
    "clients/openmeld-cli/src/local-service/adapters/resolve-daemon-capabilities.ts",
    "services/core/src/dispatch/infrastructure/runtime-transport/runtime-transport-client.ts",
    "services/core/src/index.ts",
    "services/gateway/src/routes/rpc-http.current-device.ts",
    "services/gateway/src/routes/rpc-http.people-computers.ts",
    "packages/api-client/src/current-device/api.ts",
    "clients/web/src/lib/profiles/update-profile-workspace.ts",
  ];
  for (const file of paths) {
    for (const context of [
      savedWorkspaceContext,
      {},
      {
        sourceSha: SAVED_WORKSPACE_SOURCE,
        readGitFile() {
          throw new Error("unreadable product source");
        },
      },
    ]) {
      assert.deepEqual(
        savedWorkspaceObligations([file], context),
        SAVED_WORKSPACE_READ,
        file
      );
    }
    assert.deepEqual(
      savedWorkspaceObligations([file], {
        sourceSha: RELIABILITY_LEGACY,
        readGitFile: readSavedWorkspaceProduct,
      }),
      [],
      file
    );
  }
  assert.deepEqual(
    savedWorkspaceObligations(["clients/web/src/routes/unrelated.tsx"]),
    []
  );
  // A new writer or HTTP caller still requires its receiver when the product
  // schema has not yet acquired the capability. Names only register obligations.
  for (const [featureFile, featureSource] of [
    ...savedWorkspaceFeatureSources,
  ].slice(1)) {
    assert.deepEqual(
      savedWorkspaceObligations([featureFile], {
        sourceSha: SAVED_WORKSPACE_SOURCE,
        readGitFile: (ref, file) => {
          assert.equal(ref, SAVED_WORKSPACE_SOURCE);
          return file === featureFile
            ? featureSource
            : "// Known legacy feature owner.";
        },
      }),
      SAVED_WORKSPACE_READ
    );
  }
});

test("saved-workspace cannot reuse older same-pair witnesses; pending or unknown receivers refuse", () => {
  const obligations = savedWorkspaceObligations(
    savedWorkspaceReadIncrement.changedPaths
  );
  for (const obligation of SAVED_WORKSPACE_READ) {
    const oldContract =
      obligation.producer === "cli"
        ? "local-service-runtime"
        : "agent-profile-binding-precondition";
    const producer = {
      scope: obligation.producer,
      sha: RELIABILITY_LEGACY,
      state: "pending",
      compatibilityDependencies: [[obligation.receiver, obligation.producer]],
      compatibilityObligations: [
        { ...obligation, contract: oldContract },
        ...obligations.filter(
          (o) =>
            o.receiver === obligation.receiver &&
            o.producer === obligation.producer
        ),
      ],
      compatibilityReceiverWitnesses: [
        {
          receiver: obligation.receiver,
          producer: obligation.producer,
          contracts: [oldContract],
          evidence: {
            result: "match",
            baselineSha: RELIABILITY_LEGACY,
            targetSha: SAVED_WORKSPACE_SOURCE,
          },
        },
      ],
    };
    const receiver = {
      scope: obligation.receiver,
      sha: RELIABILITY_LEGACY,
      state: "pending",
      evidence: { result: "verified" },
    };
    const input = {
      sourceSha: SAVED_WORKSPACE_SOURCE,
      selectedScopes: [obligation.producer],
      components: [receiver, producer],
    };
    assert.throws(
      () => assertProductionStageAdmission(input),
      PENDING_RECEIVER
    );
    producer.compatibilityReceiverWitnesses[0].contracts = [
      "profile-workspace-read",
    ];
    assert.throws(
      () => assertProductionStageAdmission(input),
      PENDING_RECEIVER,
      "read evidence must not replace the older runtime or Binding obligation"
    );
    receiver.state = "unknown";
    assert.throws(
      () => assertProductionStageAdmission(input),
      UNRESOLVED_RECEIVER
    );
    receiver.state = "current";
    receiver.sha = SAVED_WORKSPACE_SOURCE;
    assert.doesNotThrow(() => assertProductionStageAdmission(input));
  }
});
