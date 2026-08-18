import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildProductionDeployStepSpecs,
  buildProductionPreflightStepSpecs,
  buildProductionReleasePlan,
  buildProductionVerifyStepSpecs,
  executeProductionDeploySteps,
  expandRequestedReleaseScopes,
  parseProductionReleaseArgs,
  resolveAutomaticReleaseScopes,
} from "./production-release.mjs";

const REMOTE_SOURCE_SHA = "79178c150dc976b13f05d84a7711465c44447e3c";
const CURRENT_WORKER_VERSION_RE =
  /11111111-1111-1111-1111-111111111111 \(100%\)/u;
const INBOX_SCOPE_ERROR_RE = /requires the Web, Gateway, and Core scopes/u;
const WRANGLER_RELEASE_STATE = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/wrangler-worker-release-state-4.110.0.json",
      import.meta.url
    ),
    "utf8"
  )
);

test("parses the local production release command", () => {
  assert.deepEqual(
    parseProductionReleaseArgs([
      "deploy",
      "--",
      "--scope",
      "web,core",
      "--base",
      "origin/main",
    ]),
    {
      base: "origin/main",
      command: "deploy",
      json: false,
      scope: "web,core",
    }
  );
});

test("parses an explicit deployment preflight", () => {
  assert.deepEqual(
    parseProductionReleaseArgs(["preflight", "--scope", "core"]),
    {
      base: "origin/main",
      command: "preflight",
      json: false,
      scope: "core",
    }
  );
});

test("keeps full cloud release separate from immutable CLI publishing", () => {
  assert.deepEqual(expandRequestedReleaseScopes("cloud"), [
    "auth",
    "web",
    "gateway",
    "core",
    "remote-agent",
  ]);
  assert.deepEqual(expandRequestedReleaseScopes("full"), [
    "db",
    "auth",
    "web",
    "gateway",
    "core",
    "remote-agent",
  ]);
  assert.deepEqual(expandRequestedReleaseScopes("cli"), ["cli"]);
});

test("plans against an explicit immutable remote source", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [],
    scope: "auto",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(plan.sourceSha, REMOTE_SOURCE_SHA);
});

test("derives deploy scopes from affected deployable packages", () => {
  assert.deepEqual(
    resolveAutomaticReleaseScopes({
      affectedPackages: [
        "@openmeld/api-client",
        "@openmeld/core",
        "@openmeld/gateway",
        "openmeld-web",
      ],
      changedPaths: ["packages/api-client/src/index.ts"],
    }),
    ["web", "gateway", "core"]
  );
});

test("adds the database only for schema and migration truth", () => {
  assert.deepEqual(
    resolveAutomaticReleaseScopes({
      affectedPackages: ["@openmeld/db", "@openmeld/core"],
      changedPaths: [
        "packages/db/drizzle/0038_example.sql",
        "packages/db/src/core/example.schema.ts",
      ],
    }),
    ["db", "core"]
  );
  assert.deepEqual(
    resolveAutomaticReleaseScopes({
      affectedPackages: ["@openmeld/db"],
      changedPaths: [
        "packages/db/drizzle/README.md",
        "packages/db/tests/shared-tooling.test.ts",
      ],
    }),
    []
  );
});

test("treats local component product changes as a CLI release", () => {
  assert.deepEqual(
    resolveAutomaticReleaseScopes({
      affectedPackages: ["openmeld"],
      changedPaths: ["clients/openmeld-cli/src/commands/space.ts"],
    }),
    ["cli"]
  );
  assert.deepEqual(
    resolveAutomaticReleaseScopes({
      affectedPackages: ["openmeld"],
      changedPaths: ["runtime/local-service/src/index.ts"],
    }),
    ["cli"]
  );
});

test("builds only scope-owned verification steps", () => {
  const labels = buildProductionVerifyStepSpecs({
    changedPaths: ["clients/web/src/routes/index.tsx"],
    scopes: ["web"],
  }).map((step) => step.label);

  assert.deepEqual(labels, [
    "Verify Cloudflare environment contracts",
    "Check retired identifiers",
    "Verify Web",
  ]);
});

test("builds Core service-binding dependencies before Auth and Gateway checks", () => {
  for (const scope of ["auth", "gateway"]) {
    const steps = buildProductionVerifyStepSpecs({
      changedPaths: [],
      scopes: [scope],
    });
    const contractBuildIndex = steps.findIndex(
      (step) => step.label === "Build Core service-binding dependencies"
    );
    const scopeCheckIndex = steps.findIndex(
      (step) =>
        step.label === `Verify ${scope === "auth" ? "Auth" : "Gateway"} Worker`
    );

    assert.ok(contractBuildIndex >= 0);
    assert.ok(scopeCheckIndex > contractBuildIndex);
    assert.deepEqual(steps[contractBuildIndex]?.args, [
      "turbo",
      "run",
      "build",
      "--filter=@openmeld/core^...",
    ]);
  }
});

test("fails fast on current CLI channel truth before expensive Core verification", () => {
  const steps = buildProductionVerifyStepSpecs({
    changedPaths: [],
    scopes: ["core"],
  });
  const channelStepIndex = steps.findIndex(
    (step) => step.label === "Verify Core CLI channel compatibility"
  );
  const coreVerificationIndex = steps.findIndex(
    (step) => step.label === "Verify Core Worker"
  );

  assert.ok(channelStepIndex >= 0);
  assert.ok(coreVerificationIndex > channelStepIndex);
  assert.deepEqual(steps[channelStepIndex]?.args, [
    "run",
    "verify:release-ready",
    "--",
    "--current",
    "--channel-sync-check",
  ]);
});

test("lets a selected CLI release publish its channel before the Core compatibility gate", () => {
  const verifySteps = buildProductionVerifyStepSpecs({
    changedPaths: [],
    scopes: ["cli", "core"],
  });
  const preflightSteps = buildProductionPreflightStepSpecs({
    changedPaths: [],
    scopes: ["cli", "core"],
  });

  assert.ok(
    verifySteps.some((step) => step.label === "Verify CLI release metadata")
  );
  assert.ok(
    !verifySteps.some(
      (step) => step.label === "Verify Core CLI channel compatibility"
    )
  );
  assert.ok(
    !preflightSteps.some(
      (step) => step.label === "Verify Core CLI channel compatibility"
    )
  );
});

test("keeps deployment preflight cheap while preserving release invariants", () => {
  assert.deepEqual(
    buildProductionPreflightStepSpecs({
      changedPaths: [],
      scopes: ["web"],
    }).map((step) => step.label),
    ["Verify Cloudflare environment contracts", "Check retired identifiers"]
  );

  const coreSteps = buildProductionPreflightStepSpecs({
    changedPaths: [],
    scopes: ["core"],
  });
  assert.deepEqual(
    coreSteps.map((step) => step.label),
    [
      "Verify Cloudflare environment contracts",
      "Check retired identifiers",
      "Verify production Core Queue resources",
      "Verify Core CLI channel compatibility",
    ]
  );
  assert.ok(!coreSteps.some((step) => step.label === "Verify Core Worker"));

  assert.deepEqual(
    buildProductionPreflightStepSpecs({
      changedPaths: [],
      scopes: ["cli"],
    }).map((step) => step.label),
    [
      "Verify Cloudflare environment contracts",
      "Check retired identifiers",
      "Verify production Core Queue resources",
    ]
  );

  assert.deepEqual(
    buildProductionPreflightStepSpecs({
      changedPaths: [],
      scopes: ["gateway"],
    }).map((step) => step.label),
    [
      "Verify Cloudflare environment contracts",
      "Check retired identifiers",
      "Verify production Gateway Queue resources",
    ]
  );
});

test("keeps full confidence verification separate from deploy preflight", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [],
    scope: "web",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.ok(plan.verifySteps.some((step) => step.label === "Verify Web"));
  assert.ok(!plan.preflightSteps.some((step) => step.label === "Verify Web"));
});

test("runs the production database once before selected cloud targets", () => {
  const steps = buildProductionDeployStepSpecs(["remote-agent", "db", "core"]);

  assert.deepEqual(
    steps.map((step) => step.label),
    [
      "Synchronize production database",
      "Deploy Core Worker",
      "Verify Core deployment is visible",
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
    ]
  );
});

test("lets CLI release own its required Core projection", () => {
  const steps = buildProductionDeployStepSpecs(["cli", "core"]);

  assert.deepEqual(
    steps.map((step) => step.label),
    [
      "Publish CLI and deploy its Core release projection",
      "Verify final R2/npm/Core alignment",
    ]
  );
  assert.deepEqual(
    steps.map((step) => step.args),
    [
      ["run", "release:cli", "--with-binary"],
      ["run", "release:cli", "--with-binary"],
    ]
  );
});

test("locks database, CLI channel, and Worker deploys into release order", () => {
  const steps = buildProductionDeployStepSpecs([
    "remote-agent",
    "web",
    "cli",
    "db",
    "core",
  ]);

  assert.deepEqual(
    steps.map((step) => step.label),
    [
      "Synchronize production database",
      "Publish CLI and deploy its Core release projection",
      "Deploy Web",
      "Verify Web health",
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
      "Verify final R2/npm/Core alignment",
    ]
  );
});

test("keeps the Center Agent Task CLI behind every cloud receiver", () => {
  const steps = buildProductionDeployStepSpecs(
    ["remote-agent", "web", "cli", "db", "core", "gateway"],
    {
      changedPaths: [
        "services/core/src/center-agent-tasks/application/center-agent-task-service.ts",
      ],
    }
  );

  assert.deepEqual(
    steps.map((step) => step.label),
    [
      "Synchronize production database",
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
      "Deploy Core with the current published CLI projection",
      "Verify Core deployment is visible",
      "Deploy Gateway Worker",
      "Verify Gateway Worker health",
      "Deploy Web",
      "Verify Web health",
      "Publish CLI and deploy its Core release projection",
      "Verify final R2/npm/Core alignment",
    ]
  );
});

test("deploys the Context Scope Plan receiver before Core and keeps the CLI last", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [
      "packages/schemas/src/schemas/http/center-agent-context-manifest.ts",
      "packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts",
      "services/core/src/center-agent/application/center-agent-context-manifest-service.ts",
      "services/gateway/src/routes/rpc-http.center-agent.ts",
      "clients/openmeld-cli/src/commands/center-agent.ts",
    ],
    scope: "db,auth,core,gateway,web,remote-agent,cli",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(plan.deployOrderProfile, "center-agent-cli-receiver-first");
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Synchronize production database",
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
      "Deploy Auth Worker",
      "Verify Auth Worker health",
      "Deploy Core with the current published CLI projection",
      "Verify Core deployment is visible",
      "Deploy Gateway Worker",
      "Verify Gateway Worker health",
      "Deploy Web",
      "Verify Web health",
      "Publish CLI and deploy its Core release projection",
      "Verify final R2/npm/Core alignment",
    ]
  );
  assert.deepEqual(plan.deploySteps[5]?.args, [
    "scripts/release/deploy-core-current-cli-projection.mjs",
  ]);
});

test("deploys a strict Local Service runtime receiver before publishing the CLI", () => {
  const changedPaths = [
    "packages/schemas/src/schemas/daemon/runtime-transport.ts",
    "services/core/src/runtime-transport/application/runtime-transport-dispatch-service.ts",
    "clients/openmeld-cli/src/local-service/adapters/resolve-daemon-capabilities.ts",
  ];
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths,
    scope: "auth,core,gateway,web,remote-agent,cli",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(
    plan.deployOrderProfile,
    "local-service-runtime-receiver-first"
  );
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Deploy Auth Worker",
      "Verify Auth Worker health",
      "Deploy Web",
      "Verify Web health",
      "Deploy Gateway Worker",
      "Verify Gateway Worker health",
      "Deploy Core with the current published CLI projection",
      "Verify Core deployment is visible",
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
      "Publish CLI and deploy its Core release projection",
      "Verify final R2/npm/Core alignment",
    ]
  );
});

test("rejects a strict Local Service runtime release without its Core receiver", () => {
  assert.throws(
    () =>
      buildProductionReleasePlan({
        affectedPackages: [],
        base: "previous-release",
        changedPaths: [
          "packages/schemas/src/schemas/daemon/runtime-transport.ts",
          "services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts",
          "clients/openmeld-cli/src/local-service/carrier/frame-router.ts",
        ],
        scope: "cli",
        sourceSha: REMOTE_SOURCE_SHA,
      }),
    /requires the Core scope before publishing CLI\/Service/u
  );
});

test("deploys the execution reconciliation receiver before its Core caller", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [
      "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
      "services/core/src/remote-agent/application/native-delivery-service.ts",
      "services/remote-agent/flue-adapter/execution-reconciliation.ts",
    ],
    scope: "core,remote-agent",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(plan.deployOrderProfile, "remote-agent-receiver-first");
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
      "Deploy Core Worker",
      "Verify Core deployment is visible",
    ]
  );
});

test("deploys an additive Remote Agent turn-request receiver before its Core producer", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [
      "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
      "services/core/src/remote-agent/application/remote-agent-conversation-continuity.ts",
      "services/core/src/remote-agent/application/remote-agent-worker-admission.ts",
      "services/remote-agent/.flue/agents/center-agent.ts",
    ],
    scope: "db,core,remote-agent",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(plan.deployOrderProfile, "remote-agent-receiver-first");
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Synchronize production database",
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
      "Deploy Core Worker",
      "Verify Core deployment is visible",
    ]
  );
});

test("deploys the Slack turn-envelope receiver before its Core producer", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [
      "packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts",
      "services/core/src/remote-agent/application/slack-signal-service.ts",
      "services/remote-agent/.flue/agents/center-agent.ts",
    ],
    scope: "db,core,remote-agent",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(plan.deployOrderProfile, "remote-agent-receiver-first");
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Synchronize production database",
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
      "Deploy Core Worker",
      "Verify Core deployment is visible",
    ]
  );
});

test("does not infer the Remote Agent receiver-first profile from bidirectional contract paths", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [
      "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
      "services/core/src/remote-agent/application/native-delivery-service.ts",
    ],
    scope: "core,remote-agent",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(plan.deployOrderProfile, "default-auth-receiver-first");
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Deploy Core Worker",
      "Verify Core deployment is visible",
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
    ]
  );
});

test("deploys Core's strict worker-response reader before PR 194's Remote Agent producer", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [
      "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
      "services/core/src/center-agent-tasks/application/center-agent-task-service.ts",
      "services/core/src/remote-agent/application/native-delivery-service.ts",
      "services/remote-agent/.flue/agents/center-agent.ts",
      "services/remote-agent/flue-adapter/conversation-footprint.ts",
    ],
    scope: "db,auth,core,gateway,web,remote-agent,cli",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(plan.deployOrderProfile, "core-worker-response-reader-first");
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Synchronize production database",
      "Deploy Auth Worker",
      "Verify Auth Worker health",
      "Deploy Core with the current published CLI projection",
      "Verify Core deployment is visible",
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
      "Deploy Gateway Worker",
      "Verify Gateway Worker health",
      "Deploy Web",
      "Verify Web health",
      "Publish CLI and deploy its Core release projection",
      "Verify final R2/npm/Core alignment",
    ]
  );
});

test("prints the current production Worker version before a harmless redeploy", () => {
  const sideEffects = [];
  const output = [];
  executeProductionDeploySteps({
    adapters: {
      runCommand: () => ({
        status: 0,
        stderr: "",
        stdout: JSON.stringify(WRANGLER_RELEASE_STATE.deployments),
      }),
      runStep: (step) => sideEffects.push(step.label),
    },
    steps: buildProductionDeployStepSpecs(["web"]).slice(0, 1),
    write: (value) => output.push(value),
  });

  assert.deepEqual(sideEffects, ["Deploy Web"]);
  assert.match(output.join(""), CURRENT_WORKER_VERSION_RE);
});

test("checks each selected component before moving to the next deploy", () => {
  assert.deepEqual(
    buildProductionDeployStepSpecs(["web", "gateway", "auth"]).map(
      (step) => step.label
    ),
    [
      "Deploy Auth Worker",
      "Verify Auth Worker health",
      "Deploy Web",
      "Verify Web health",
      "Deploy Gateway Worker",
      "Verify Gateway Worker health",
    ]
  );
});

test("uses the default Auth-receiver-first profile when Auth and Web are selected", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [],
    scope: "auth,web",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(plan.deployOrderProfile, "default-auth-receiver-first");
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Deploy Auth Worker",
      "Verify Auth Worker health",
      "Deploy Web",
      "Verify Web health",
    ]
  );
});

test("deploys Inbox Message Channel receivers before the Core writer", () => {
  const changedPaths = [
    "packages/schemas/src/schemas/http/inbox.ts",
    "packages/schemas/src/schemas/runtime/message-channel.ts",
    "services/core/src/remote-agent/application/native-delivery-inbox-producer.ts",
  ];
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths,
    scope: "web,gateway,core,cli",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(plan.deployOrderProfile, "inbox-message-channel-receiver-first");
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Deploy Web",
      "Verify Web health",
      "Deploy Gateway Worker",
      "Verify Gateway Worker health",
      "Deploy Core with the current published CLI projection",
      "Verify Core deployment is visible",
      "Publish CLI and deploy its Core release projection",
      "Verify final R2/npm/Core alignment",
    ]
  );
});

test("fails closed when an Inbox Message Channel release omits a strict receiver", () => {
  const changedPaths = [
    "packages/schemas/src/schemas/http/inbox.ts",
    "services/core/src/remote-agent/application/native-delivery-inbox-producer.ts",
  ];

  assert.throws(
    () =>
      buildProductionReleasePlan({
        affectedPackages: [],
        base: "previous-release",
        changedPaths,
        scope: "core",
        sourceSha: REMOTE_SOURCE_SHA,
      }),
    INBOX_SCOPE_ERROR_RE
  );
});

test("automatically includes every Inbox Message Channel strict receiver", () => {
  assert.deepEqual(
    resolveAutomaticReleaseScopes({
      affectedPackages: ["@openmeld/core"],
      changedPaths: [
        "packages/schemas/src/schemas/http/inbox.ts",
        "services/core/src/remote-agent/application/native-delivery-inbox-producer.ts",
      ],
    }),
    ["cli", "web", "gateway", "core"]
  );
});

test("composes Remote Agent and Inbox receiver-first constraints before Core", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [
      "packages/schemas/src/schemas/http/inbox.ts",
      "packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts",
      "services/core/src/remote-agent/application/native-delivery-inbox-producer.ts",
      "services/core/src/remote-agent/application/remote-agent-worker-admission.ts",
      "services/remote-agent/.flue/agents/center-agent.ts",
    ],
    scope: "web,gateway,core,remote-agent",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(
    plan.deployOrderProfile,
    "remote-agent-and-inbox-receivers-first"
  );
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
      "Deploy Web",
      "Verify Web health",
      "Deploy Gateway Worker",
      "Verify Gateway Worker health",
      "Deploy Core Worker",
      "Verify Core deployment is visible",
    ]
  );
});

test("fails closed when a combined receiver-first release omits Remote Agent", () => {
  const changedPaths = [
    "packages/schemas/src/schemas/http/inbox.ts",
    "packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts",
    "services/core/src/remote-agent/application/native-delivery-inbox-producer.ts",
    "services/core/src/remote-agent/application/remote-agent-worker-admission.ts",
    "services/remote-agent/.flue/agents/center-agent.ts",
  ];

  assert.throws(
    () =>
      buildProductionReleasePlan({
        affectedPackages: [],
        base: "previous-release",
        changedPaths,
        scope: "web,gateway,core",
        sourceSha: REMOTE_SOURCE_SHA,
      }),
    /requires the Remote Agent scope/u
  );
});

test("keeps Core before a response producer while retaining Inbox receiver-first order", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [
      "packages/schemas/src/schemas/http/inbox.ts",
      "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
      "services/core/src/remote-agent/application/native-delivery-inbox-producer.ts",
      "services/remote-agent/.flue/agents/center-agent.ts",
    ],
    scope: "web,gateway,core,remote-agent",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(plan.deployOrderProfile, "inbox-message-channel-receiver-first");
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Deploy Web",
      "Verify Web health",
      "Deploy Gateway Worker",
      "Verify Gateway Worker health",
      "Deploy Core Worker",
      "Verify Core deployment is visible",
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
    ]
  );
});
