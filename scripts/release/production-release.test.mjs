import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertProcessRestarted,
  assertProductionSignatureDetails,
  assertReceiptMatchesTarget,
  compareStableVersions,
  PRODUCTION_EXECUTABLE,
  parseInstallReceipt,
  parseSmokeArgs,
  processListHasProductionApp,
  productionProcessPids,
} from "../e2e/desktop-macos-production-update-smoke.mjs";

import {
  assertProductionReleaseSource,
  buildCoreCurrentCliProjectionPreflightStepSpecs,
  buildProductionDeployStepSpecs,
  buildProductionPreflightStepSpecs,
  buildProductionReleaseImpact,
  buildProductionReleasePlan,
  buildProductionVerifyStepSpecs,
  executeProductionDeploySteps,
  executeWithProductionScopeLeases,
  expandRequestedReleaseScopes,
  parseProductionReleaseArgs,
  resolveAutomaticReleaseScopes,
  resolveLocalReleaseOwner,
  resolveProductionCompatibilityDependencies,
  resumeProductionRelease,
  runHostedRelease,
} from "./production-release.mjs";
import { assertProductionStageAdmission } from "./production-stage-admission.mjs";

function assertReceiptGatedStage(
  scopes,
  changedPaths,
  compatibilityContext = {}
) {
  buildProductionDeployStepSpecs(scopes, {
    changedPaths,
    compatibilityContext,
  });
  const dependencies = resolveProductionCompatibilityDependencies(
    changedPaths,
    false,
    compatibilityContext
  );
  const components = [
    "db",
    "cli",
    "auth",
    "web",
    "gateway",
    "core",
    "remote-agent",
  ].map((scope) => ({
    scope,
    state: "pending",
    compatibilityDependencies: dependencies,
  }));
  const input = {
    components,
    selectedScopes: scopes,
    sourceSha: "a".repeat(40),
  };
  // biome-ignore lint/suspicious/noMisplacedAssertion: Invoked synchronously inside contract tests below.
  assert.throws(
    () => assertProductionStageAdmission(input),
    "undeployed receivers must block the stage"
  );
  // biome-ignore lint/suspicious/noMisplacedAssertion: Invoked synchronously inside contract tests below.
  assert.doesNotThrow(
    () =>
      assertProductionStageAdmission({
        ...input,
        components: components.map((component) => ({
          ...component,
          state: scopes.includes(component.scope) ? "pending" : "current",
        })),
      }),
    "verified receivers need not be redeployed in the same plan"
  );
}

test("hosted publication waits for the exact run and reuses an active run after interruption", () => {
  const sourceSha = "a".repeat(40);
  for (const { active, artifactRunId } of [
    { active: false, artifactRunId: undefined },
    { active: true, artifactRunId: undefined },
    { active: false, artifactRunId: "  " },
    { active: false, artifactRunId: " 38155840353 " },
    { active: true, artifactRunId: "38155840353" },
  ]) {
    const dispatched = [];
    let watched;
    runHostedRelease("cli", sourceSha, ["cli", "core", "web"], {
      env: { WINDOWS_ARTIFACT_RUN_ID: artifactRunId },
      capture(args) {
        if (args[0] === "run") {
          return JSON.stringify(
            active
              ? [
                  {
                    databaseId: 38_141_004_288,
                    displayTitle: `CLI Release @ ${sourceSha}`,
                    status: "in_progress",
                  },
                ]
              : []
          );
        }
        dispatched.push(args);
        return "https://github.com/amplifthq/openmeld/actions/runs/38141004288";
      },
      watch(args) {
        watched = args;
      },
    });
    assert.equal(dispatched.length, active ? 0 : 1);
    if (!active) {
      assert.ok(dispatched[0].includes(`release_sha=${sourceSha}`));
      assert.ok(dispatched[0].includes("production_train_scopes=cli,core,web"));
      assert.ok(dispatched[0].includes("cli-release.yml"));
      const pinArgument = dispatched[0].find((arg) =>
        arg.startsWith("windows_artifact_run_id=")
      );
      assert.equal(
        pinArgument,
        artifactRunId?.trim()
          ? `windows_artifact_run_id=${artifactRunId.trim()}`
          : undefined
      );
      if (pinArgument) {
        assert.equal(
          dispatched[0][dispatched[0].indexOf(pinArgument) - 1],
          "--raw-field"
        );
      }
    }
    assert.ok(watched.includes("38141004288"));
    assert.ok(watched.includes("--exit-status"));
  }
  assert.throws(
    () =>
      runHostedRelease("web", sourceSha, ["web"], {
        capture: (args) => (args[0] === "run" ? "[]" : ""),
        watch: () =>
          assert.fail("must not guess a run after ambiguous dispatch"),
      }),
    (error) => error.message.includes("without a run URL")
  );
  assert.throws(
    () =>
      runHostedRelease("web", sourceSha, ["web"], {
        capture: (args) =>
          args[0] === "run"
            ? "[]"
            : "https://github.com/amplifthq/openmeld/actions/runs/38155840353",
        watch: () => {
          throw new Error("release failed");
        },
      }),
    { message: "release failed" }
  );
});

test("hosted CLI artifact pins reject invalid run IDs without dispatching and do not affect other scopes", () => {
  for (const pin of [
    "https://github.com/example/repo/actions/runs/123",
    "12x",
    "1 2",
    "0",
  ]) {
    assert.throws(
      () =>
        runHostedRelease("cli", "a".repeat(40), ["cli"], {
          env: { WINDOWS_ARTIFACT_RUN_ID: pin },
          capture: () =>
            assert.fail("invalid artifact pin must not reach GitHub"),
          watch: () =>
            assert.fail("invalid artifact pin must not start waiting"),
        }),
      { message: "WINDOWS_ARTIFACT_RUN_ID must be a numeric run ID." }
    );
  }
  const calls = [];
  runHostedRelease("web", "a".repeat(40), ["web"], {
    env: { WINDOWS_ARTIFACT_RUN_ID: "unrelated-to-web" },
    capture(args) {
      calls.push(args);
      return args[0] === "run"
        ? "[]"
        : "https://github.com/amplifthq/openmeld/actions/runs/38155840353";
    },
    watch: () => undefined,
  });
  const dispatch = calls.find((args) => args[0] === "workflow");
  assert.ok(dispatch.includes("scope=web"));
  assert.equal(
    dispatch.some((arg) => arg.startsWith("windows_artifact_run_id=")),
    false
  );
});

test("CLI continuation respects its implicit Core write and Core receiver prerequisites", async () => {
  const sourceSha = "a".repeat(40);
  const baseSha = "b".repeat(40);
  const plan = buildProductionReleasePlan({
    changedPaths: [
      "services/core/src/center-agent/application/center-agent-context-manifest-service.ts",
      "services/remote-agent/agent-core/context.ts",
      "clients/openmeld-cli/src/main.ts",
    ],
    affectedPackages: ["@openmeld/core", "@openmeld/remote-agent", "openmeld"],
    scope: "auto",
    sourceSha,
  });
  for (const coreBeforeCli of [false, true]) {
    const current = new Set();
    const calls = [];
    const dependencies = [
      ...plan.compatibilityDependencies,
      ...(coreBeforeCli ? [["core", "cli"]] : []),
    ];
    await resumeProductionRelease({
      sourceSha,
      baseSha,
      collectStatus: async () => ({
        sourceSha,
        sourceValidationBlockers: [],
        currentChange: { baseSha, scopes: plan.scopes },
        components: plan.scopes.map((scope) => ({
          scope,
          state: current.has(scope) ? "current" : "pending",
          compatibilityDependencies: dependencies,
        })),
      }),
      deployScope: (scope) => {
        calls.push(scope);
        current.add(scope);
        if (scope === "cli") {
          current.add("core");
        }
      },
      write: () => undefined,
    });
    assert.deepEqual(
      calls,
      coreBeforeCli ? ["remote-agent", "core", "cli"] : ["remote-agent", "cli"]
    );
  }
});

test("resumes only unfinished components and waits for their verified receipts", async () => {
  const sourceSha = "a".repeat(40);
  const baseSha = "b".repeat(40);
  const component = (scope, state, dependencies = []) => ({
    scope,
    state,
    compatibilityDependencies: dependencies,
  });
  const snapshot = (components) => ({
    sourceSha,
    sourceValidationBlockers: [],
    currentChange: { baseSha, scopes: ["core", "remote-agent", "web"] },
    components,
  });
  const initial = snapshot([
    component("core", "current"),
    component("web", "pending", [["remote-agent", "web"]]),
    component("remote-agent", "pending", [["core", "remote-agent"]]),
  ]);
  const calls = [];
  const states = [
    initial,
    snapshot([
      component("core", "current"),
      component("remote-agent", "current"),
      component("web", "pending", [["remote-agent", "web"]]),
    ]),
    snapshot([
      component("core", "current"),
      component("remote-agent", "current"),
      component("web", "current"),
    ]),
  ];
  await resumeProductionRelease({
    sourceSha,
    baseSha,
    collectStatus: async () => states.shift(),
    deployScope: async (scope) => calls.push(scope),
    write: () => undefined,
  });
  assert.deepEqual(calls, ["remote-agent", "web"]);
  let waiting = true;
  const selectedOutput = [];
  await resumeProductionRelease({
    sourceSha,
    baseSha,
    scopes: ["web"],
    collectStatus: async () =>
      snapshot([
        component("core", "pending"),
        component("remote-agent", "current"),
        component("web", waiting ? "unknown" : "current"),
      ]),
    waitForActiveRelease: () => {
      waiting = false;
      return true;
    },
    deployScope: () => assert.fail("an existing run owns the deployment"),
    write: (line) => selectedOutput.push(line),
  });
  assert.ok(
    selectedOutput.at(-1).startsWith("Selected components complete: web.")
  );
  const unresolved = snapshot([
    component("core", "current"),
    component("remote-agent", "pending"),
    component("web", "unknown"),
  ]);
  for (const [unchanged, expectedAttempts] of [
    [initial, 1],
    [unresolved, 0],
    [
      {
        ...initial,
        currentChange: {
          ...initial.currentChange,
          orderingError: "Ambiguous request owner",
        },
      },
      0,
    ],
  ]) {
    const attempted = [];
    await assert.rejects(
      resumeProductionRelease({
        sourceSha,
        baseSha,
        collectStatus: async () => unchanged,
        deployScope: async (scope) => attempted.push(scope),
        write: () => undefined,
      })
    );
    assert.equal(
      attempted.length,
      expectedAttempts,
      "unknown evidence stops before mutation; missing completion never repeats a deployment"
    );
  }
  const concurrentCalls = [];
  const concurrentStates = [
    initial,
    snapshot([
      component("core", "current"),
      component("remote-agent", "current"),
      component("web", "current"),
    ]),
  ];
  await resumeProductionRelease({
    sourceSha,
    baseSha,
    collectStatus: async () => concurrentStates.shift(),
    deployScope: async (scope) => concurrentCalls.push(scope),
    write: () => undefined,
  });
  assert.deepEqual(
    concurrentCalls,
    ["remote-agent"],
    "fresh receipts skip work completed by another release owner"
  );
  await assert.rejects(
    resumeProductionRelease({
      sourceSha,
      baseSha,
      collectStatus: async () => ({ ...initial, sourceSha: "c".repeat(40) }),
      deployScope: () => assert.fail("source drift must stop before mutation"),
      write: () => undefined,
    })
  );
});

// These tests exercise historical target expansion/retirement, before membership
// opt-in. An unavailable caller is now correctly unknown, so name its captured
// actual legacy product source instead of borrowing the current checkout.
const legacyInboxCaller = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/inbox-membership-opt-in-increment.json",
      import.meta.url
    ),
    "utf8"
  )
).callers.legacy;
const historicalInboxTargetSource = {
  readGitFile(ref, file) {
    return file === legacyInboxCaller.path
      ? legacyInboxCaller.source
      : execFileSync("git", ["show", `${ref}:${file}`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
  },
};

const REMOTE_SOURCE_SHA = "79178c150dc976b13f05d84a7711465c44447e3c";
const IMAGE_GEOMETRY_PATHS = [
  "packages/schemas/src/schemas/http/space-files.ts",
  "services/core/src/space/application/space-file-image-metadata.ts",
  "services/core/src/space/transport/do/space.ts",
];
const EVIDENCE_PATHS = [
  "packages/schemas/src/schemas/http/center-agent-memory-search.ts",
  "services/core/src/index.ts",
  "services/remote-agent/agent-core/tools.ts",
];
const SPACE_MESSAGE_SEARCH_PATHS = [
  "packages/schemas/src/schemas/http/space-message-search.ts",
  "services/core/src/space/infrastructure/sql/space-message-search-repo.ts",
  "services/gateway/src/routes/rpc-http.message-search.ts",
  "clients/web/src/components/search/message-search.tsx",
];
const FULL_BACKLOG_PATHS = [
  "packages/db/drizzle/0181_loud_dark_beast.sql",
  ...SPACE_MESSAGE_SEARCH_PATHS,
  "clients/openmeld-cli/src/local-service/carrier/run-socket-session.ts",
  "packages/schemas/src/compatibility/legacy-space-files-origin-wire.ts",
  "services/core/src/routes/spaces.ts",
  "services/gateway/src/routes/rpc-http.space-files.ts",
  ...EVIDENCE_PATHS,
  "runtime/adapters/antigravity/src/transport/antigravity-cli-transport.ts",
  ...IMAGE_GEOMETRY_PATHS,
  "clients/web/src/components/spaces/space-reading-header.tsx",
];
const INCOMPATIBLE_DEPENDENCIES = /incompatible.*dependencies/iu;
const PENDING_CORE_RECEIVER = /pending prerequisite core/u;
const PENDING_TASK_RECEIVER = /pending prerequisite/u;
const UNRESOLVED_RECEIVER = /evidence is unresolved/u;

test("orders the October product backlog without treating a proxy export as a request change", () => {
  const base = "20425528edfe6aec5b11700e52cef34735e284aa";
  const sourceSha = "064d93ae1af570ecc0ced8aa212bff5e27ba60b2";
  const changedPaths = execFileSync(
    "git",
    ["diff", "--name-only", base, sourceSha],
    {
      encoding: "utf8",
    }
  )
    .trim()
    .split("\n");
  const plan = buildProductionReleasePlan({
    base,
    sourceSha,
    changedPaths,
    scope: "auth,core,gateway,web,remote-agent,cli",
  });
  assert.deepEqual(plan.deployScopeOrder, [
    "auth",
    "core",
    "gateway",
    "web",
    "remote-agent",
    "cli",
  ]);
  assert.ok(
    plan.compatibilityDependencies.some(
      ([a, b]) => a === "core" && b === "remote-agent"
    )
  );
  assert.ok(
    !plan.compatibilityDependencies.some(
      ([a, b]) => a === "remote-agent" && b === "core"
    )
  );
  assert.throws(
    () =>
      buildProductionReleasePlan({
        base,
        sourceSha,
        changedPaths,
        scope: "auth,core,gateway,web,remote-agent,cli",
        readGitFile: (ref, file) =>
          execFileSync("git", ["show", `${ref}:${file}`], {
            encoding: "utf8",
          }) +
          (ref === sourceSha &&
          file === "services/remote-agent/.flue/cloudflare.ts"
            ? "\n// unknown receiver edit\n"
            : ""),
      }),
    INCOMPATIBLE_DEPENDENCIES
  );
});

test("independent Website and Docs impact does not require unrelated historical App compatibility", () => {
  const changedPaths = execFileSync(
    "git",
    [
      "diff",
      "--name-only",
      "d799f3f66b6465564f4a9f11709a16292541db2d",
      "064d93ae1af570ecc0ced8aa212bff5e27ba60b2",
    ],
    { encoding: "utf8" }
  )
    .trim()
    .split("\n");
  for (const componentScope of ["website", "docs"]) {
    const impact = buildProductionReleaseImpact({
      base: "d799f3f66b6465564f4a9f11709a16292541db2d",
      sourceSha: "064d93ae1af570ecc0ced8aa212bff5e27ba60b2",
      componentScope,
      changedPaths,
      affectedPackages: [`openmeld-${componentScope}`],
    });
    assert.deepEqual(impact.scopes, [componentScope]);
    assert.deepEqual(impact.compatibilityDependencies, []);
  }
});

test("local execution honors control interpreter, arguments, and product root", async () => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "openmeld-control-step-"))
  );
  const script = path.join(root, "control.mjs");
  const output = path.join(root, "observed.json");
  try {
    writeFileSync(path.join(root, "package.json"), '{"private":true}\n');
    // This script is deliberately not executable. Its declared Node interpreter
    // must run it, with control arguments rather than a package-script alias.
    writeFileSync(
      script,
      `import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], JSON.stringify({
  args: process.argv.slice(3),
  execArgv: process.execArgv,
  cwd: process.cwd(),
  verificationRoot: process.env.OPENMELD_VERIFICATION_ROOT,
}));`
    );
    await executeProductionDeploySteps({
      cwd: root,
      steps: [
        {
          command: "pnpm",
          args: ["run", "source-alias-must-not-run"],
          controlCommand: process.execPath,
          controlPath: path.relative(
            path.resolve(import.meta.dirname, "../.."),
            script
          ),
          controlNodeArgs: ["--no-warnings"],
          controlArgs: [output, "--profile", "production"],
          label: "Exercise the declared trusted control command",
        },
      ],
    });
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), {
      args: ["--profile", "production"],
      execArgv: ["--no-warnings"],
      cwd: root,
      verificationRoot: root,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("orders the complete backlog by its real receiver and producer boundaries", () => {
  const plan = buildProductionReleasePlan({
    base: "previous-release",
    sourceSha: REMOTE_SOURCE_SHA,
    scope: "auto",
    readGitFile: () => "// Historical backlog without saved-workspace reads.",
    changedPaths: FULL_BACKLOG_PATHS,
    affectedPackages: [
      "@openmeld/auth-worker",
      "@openmeld/core",
      "@openmeld/gateway",
      "@openmeld/remote-agent",
      "openmeld",
      "openmeld-web",
    ],
  });
  assert.equal(
    plan.deployOrderProfile,
    "space-message-search-and-evidence-receivers-first"
  );
  assert.deepEqual(plan.deployScopeOrder, [
    "db",
    "auth",
    "cli",
    "core",
    "gateway",
    "web",
    "remote-agent",
  ]);
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Synchronize production database",
      "Deploy Auth Worker",
      "Verify Auth Worker health",
      "Publish CLI and deploy its Core release projection",
      "Deploy Gateway Worker",
      "Verify Gateway Worker health",
      "Deploy Web",
      "Verify Web health",
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
      "Verify final R2/npm/Core alignment",
    ]
  );
});

test("keeps image geometry capability-negotiated instead of imposing a deploy direction", () => {
  const plan = buildProductionReleasePlan({
    base: "previous-release",
    sourceSha: REMOTE_SOURCE_SHA,
    scope: "auto",
    changedPaths: IMAGE_GEOMETRY_PATHS,
    affectedPackages: [],
  });
  assert.equal(plan.deployOrderProfile, "default-auth-receiver-first");
  assert.deepEqual(plan.scopes, ["cli", "web", "gateway", "core"]);
  for (const scope of ["core", "cli", "web", "gateway"]) {
    assert.doesNotThrow(() =>
      buildProductionDeployStepSpecs([scope], {
        changedPaths: IMAGE_GEOMETRY_PATHS,
      })
    );
  }
});

test("requires short-query receivers when the new Web caller is selected", () => {
  for (const scopes of [["web"], ["gateway", "web"], ["core", "web"]]) {
    assertReceiptGatedStage(scopes, SPACE_MESSAGE_SEARCH_PATHS);
  }
  assert.deepEqual(
    buildProductionDeployStepSpecs(["core", "gateway", "web"], {
      changedPaths: SPACE_MESSAGE_SEARCH_PATHS,
    }).map((step) => step.label),
    [
      "Deploy Core Worker",
      "Verify Core deployment is visible",
      "Deploy Gateway Worker",
      "Verify Gateway Worker health",
      "Deploy Web",
      "Verify Web health",
    ]
  );
});

test("recognizes Space message search direction only from every real boundary", () => {
  for (const omitted of SPACE_MESSAGE_SEARCH_PATHS) {
    const plan = buildProductionReleasePlan({
      affectedPackages: [],
      base: "previous-release",
      changedPaths: SPACE_MESSAGE_SEARCH_PATHS.filter(
        (file) => file !== omitted
      ),
      scope: "core,gateway,web",
      sourceSha: REMOTE_SOURCE_SHA,
    });
    assert.equal(plan.deployOrderProfile, "default-auth-receiver-first");
  }
});

test("evidence direction requires real schema, Core receiver, and Remote Agent caller changes", () => {
  const paths = EVIDENCE_PATHS;
  const plan = buildProductionReleasePlan({
    base: "previous-release",
    sourceSha: REMOTE_SOURCE_SHA,
    scope: "core,remote-agent",
    changedPaths: paths,
  });
  assert.equal(
    plan.deployOrderProfile,
    "center-agent-evidence-receivers-first"
  );
  assert.deepEqual(plan.deployScopeOrder, ["core", "remote-agent"]);
  for (const omitted of paths) {
    const unrelated = buildProductionReleasePlan({
      base: "previous-release",
      sourceSha: REMOTE_SOURCE_SHA,
      scope: "core,remote-agent",
      changedPaths: paths.filter((file) => file !== omitted),
    });
    assert.equal(unrelated.deployOrderProfile, "default-auth-receiver-first");
  }
});
const SPACE_TASK_PATHS = [
  "packages/schemas/src/schemas/http/space-tasks.ts",
  "services/core/src/rpc/methods.ts",
  "services/core/src/space/transport/do/space.ts",
  "services/gateway/src/routes/rpc-http.space-tasks.ts",
  "clients/openmeld-cli/src/space/dispatch-task.ts",
  "services/remote-agent/agent-core/tools.ts",
];
const SPACE_TASK_CONFLICT_ERROR = /Space Task receivers.*conflict/u;
const DESKTOP_SMOKE_NEWER_ERROR_RE = /must be newer/u;
const DESKTOP_SMOKE_STABLE_ERROR_RE = /stable/u;
const DESKTOP_SMOKE_TEAM_ID_ERROR_RE = /Team ID/u;
const DESKTOP_SMOKE_STILL_RUNNING_ERROR_RE = /still running/u;
const DESKTOP_SMOKE_NOT_RUNNING_ERROR_RE = /not running/u;
const DESKTOP_SMOKE_APPLICATION_STARTED_ERROR_RE = /application_started/u;
const DESKTOP_SMOKE_VERSION_MISMATCH_ERROR_RE = /not 0\.1\.6/u;
const DESKTOP_SMOKE_MALFORMED_ERROR_RE = /malformed/u;

test("deploys Space Task RPC and HTTP receivers before their real callers", () => {
  const plan = buildProductionReleasePlan({
    base: "previous-release",
    sourceSha: REMOTE_SOURCE_SHA,
    scope: "web,cli,gateway,core,remote-agent",
    changedPaths: SPACE_TASK_PATHS,
  });
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Deploy Core with the current published CLI projection",
      "Verify Core receiver stable identity alignment",
      "Deploy Gateway Worker",
      "Verify Gateway Worker health",
      "Deploy Web",
      "Verify Web health",
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
      "Publish CLI and deploy its Core release projection",
      "Verify final R2/npm/Core alignment",
    ]
  );
  assert.deepEqual(plan.deploySteps[0].args, [
    "scripts/release/deploy-core-current-cli-projection.mjs",
    "--deployment-only",
    "--release-sha",
    REMOTE_SOURCE_SHA,
  ]);
  const automatic = resolveAutomaticReleaseScopes({
    affectedPackages: ["openmeld-web"],
    changedPaths: SPACE_TASK_PATHS,
  });
  assert.ok(
    ["core", "gateway", "cli", "web"].every((scope) =>
      automatic.includes(scope)
    )
  );
});

test("allows a Space Task receiver stage with the immutable published CLI projection", () => {
  for (const scope of ["core", "core,gateway", "core,remote-agent"]) {
    const plan = buildProductionReleasePlan({
      base: "previous-release",
      sourceSha: REMOTE_SOURCE_SHA,
      scope,
      changedPaths: SPACE_TASK_PATHS,
    });
    assert.equal(
      plan.deploySteps[0].label,
      "Deploy Core with the current published CLI projection"
    );
    assert.equal(
      plan.deploySteps[1].label,
      "Verify Core receiver stable identity alignment"
    );
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
        (step) => step.label === "Verify production Core Queue resources"
      )
    );
  }
});

test("plans only Remote after its Core receiver is verified, without weakening admission", () => {
  for (const changedPaths of [EVIDENCE_PATHS, SPACE_TASK_PATHS]) {
    const plan = buildProductionReleasePlan({
      base: "previous-release",
      sourceSha: REMOTE_SOURCE_SHA,
      scope: "remote-agent",
      changedPaths,
    });
    assert.deepEqual(plan.deployScopeOrder, ["remote-agent"]);
    assert.deepEqual(
      plan.deploySteps.map((step) => step.label),
      [
        "Deploy Remote Agent Worker",
        "Verify Remote Agent deployment is visible",
      ]
    );
    assert.equal(
      plan.preflightSteps[0].controlPath,
      "scripts/release/production-stage-admission.mjs"
    );
    const components = [
      { scope: "core", state: "current" },
      {
        scope: "remote-agent",
        state: "pending",
        compatibilityDependencies:
          resolveProductionCompatibilityDependencies(changedPaths),
      },
    ];
    const input = {
      components,
      selectedScopes: plan.deployScopeOrder,
      sourceSha: REMOTE_SOURCE_SHA,
    };
    assert.deepEqual(assertProductionStageAdmission(input).selectedScopes, [
      "remote-agent",
    ]);
    components[0].state = "pending";
    assert.throws(
      () => assertProductionStageAdmission(input),
      PENDING_CORE_RECEIVER
    );
    assert.throws(
      () =>
        assertProductionStageAdmission({
          ...input,
          selectedScopes: ["core", "remote-agent"],
        }),
      PENDING_CORE_RECEIVER
    );
    components[0].state = "unknown";
    assert.throws(
      () => assertProductionStageAdmission(input),
      UNRESOLVED_RECEIVER
    );
  }
});

test("admits separate Task HTTP caller stages only after their receiver receipts", () => {
  const changedPaths = [
    ...SPACE_TASK_PATHS,
    "packages/api-client/src/space/tasks.ts",
  ];
  const compatibilityDependencies =
    resolveProductionCompatibilityDependencies(changedPaths);
  for (const scope of ["gateway", "web", "cli"]) {
    const plan = buildProductionReleasePlan({
      base: "previous-release",
      sourceSha: REMOTE_SOURCE_SHA,
      scope,
      changedPaths,
    });
    const components = ["core", "gateway", "web", "cli"].map((item) => ({
      scope: item,
      state: "pending",
      compatibilityDependencies,
    }));
    const input = {
      components,
      selectedScopes: plan.deployScopeOrder,
      sourceSha: REMOTE_SOURCE_SHA,
    };
    assert.throws(
      () => assertProductionStageAdmission(input),
      PENDING_TASK_RECEIVER
    );
    components[0].state = "current";
    if (scope !== "gateway") {
      assert.throws(
        () => assertProductionStageAdmission(input),
        PENDING_TASK_RECEIVER
      );
      components[1].state = "current";
    }
    assert.deepEqual(assertProductionStageAdmission(input).selectedScopes, [
      scope,
    ]);
  }
});

test("composes Project and Task receivers before local v4 and Web controls", () => {
  const paths = [
    ...SPACE_TASK_PATHS,
    "packages/schemas/src/schemas/daemon/runtime-transport.ts",
    "services/core/src/runtime-transport/application/runtime-transport-dispatch-service.ts",
    "clients/openmeld-cli/src/local-service/adapters/resolve-daemon-capabilities.ts",
    "services/core/src/projects/project-issue-action-routing.ts",
    "services/remote-agent/agent-core/project-issue-routing.ts",
    "clients/web/src/components/projects/project-issue-routing-section.tsx",
    "clients/openmeld-cli/src/local-service/projects/local-project-discovery.ts",
    "clients/web/src/components/projects/project-computer-section.tsx",
  ];
  const plan = buildProductionReleasePlan({
    base: "previous-release",
    sourceSha: REMOTE_SOURCE_SHA,
    scope: "db,auth,core,gateway,remote-agent,cli,web",
    changedPaths: paths,
  });
  const order = plan.deployScopeOrder;
  for (const [receiver, producer] of [
    ["db", "core"],
    ["core", "gateway"],
    ["core", "remote-agent"],
    ["core", "cli"],
    ["gateway", "cli"],
    ["remote-agent", "web"],
    ["cli", "web"],
  ]) {
    assert.ok(
      order.indexOf(receiver) < order.indexOf(producer),
      `${receiver} before ${producer}`
    );
  }
  assert.equal(plan.deployOrderProfile, "space-task-receivers-first");
  assert.ok(
    plan.deploySteps.some(
      (step) =>
        step.label === "Deploy Core with the current published CLI projection"
    )
  );
});

test("rejects opposing Space Task receiver orders instead of overriding existing constraints", () => {
  for (const otherPaths of [
    ["services/remote-agent/.flue/cloudflare.ts"],
    [
      "packages/schemas/src/schemas/http/auth-device-authorization.ts",
      "clients/web/src/lib/cli-entry-command.ts",
      "clients/openmeld-cli/src/openmeld.ts",
    ],
    [
      "packages/schemas/src/schemas/http/space-wake-progress.ts",
      "clients/openmeld-cli/src/space/wake-control-command.ts",
    ],
  ]) {
    assert.throws(
      () =>
        buildProductionDeployStepSpecs(
          ["core", "gateway", "web", "remote-agent", "cli"],
          {
            changedPaths: [...SPACE_TASK_PATHS, ...otherPaths],
          }
        ),
      SPACE_TASK_CONFLICT_ERROR
    );
  }
  for (const omitted of SPACE_TASK_PATHS.slice(0, 3)) {
    const plan = buildProductionReleasePlan({
      base: "previous-release",
      sourceSha: REMOTE_SOURCE_SHA,
      scope: "core",
      changedPaths: SPACE_TASK_PATHS.filter((file) => file !== omitted),
      readGitFile: () =>
        "// Historical source without other receiver contracts.",
    });
    assert.equal(plan.deploySteps[0].label, "Deploy Core Worker");
    assert.ok(
      plan.preflightSteps.some(
        (step) => step.label === "Verify Core CLI channel compatibility"
      )
    );
  }
});
const DEVICE_WAIT_ORDER_ERROR =
  /Device wait requires Core before Gateway and Web/u;
const PERSONAL_RECEIVER_CONFLICT_ERROR = /conflict with/u;
const PERSONAL_TOOLS_PATHS = [
  "packages/schemas/src/schemas/runtime/personal-remote-agent.ts",
  "services/core/src/remote-agent/application/remote-agent-tool-caller.ts",
  "services/remote-agent/agent-core/personal-remote-agent-tools.ts",
  "services/remote-agent/.flue/cloudflare.ts",
];

test("installs Inbox readers and Core tool authorization before personal Remote tools", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    sourceSha: REMOTE_SOURCE_SHA,
    readGitFile: () => "// Historical personal tools without Cloud Computer.",
    scope: "web,gateway,core,remote-agent",
    changedPaths: [
      ...PERSONAL_TOOLS_PATHS,
      "packages/schemas/src/schemas/http/inbox.ts",
      "services/core/src/remote-agent/application/native-delivery-inbox-producer.ts",
    ],
  });
  assert.deepEqual(plan.deployScopeOrder, [
    "web",
    "gateway",
    "core",
    "remote-agent",
  ]);
  assert.ok(
    plan.deploySteps.some(
      (step) =>
        step.label === "Deploy Core with the current published CLI projection"
    )
  );
  assert.ok(
    !plan.preflightSteps.some(
      (step) => step.label === "Verify Core CLI channel compatibility"
    )
  );
});

test("rejects personal Remote tool rollout without its Core receiver", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    sourceSha: REMOTE_SOURCE_SHA,
    scope: "remote-agent",
    changedPaths: PERSONAL_TOOLS_PATHS,
  });
  assertReceiptGatedStage(plan.scopes, plan.changedPaths);
});

test("rejects opposing Remote request and personal tool rollout dependencies", () => {
  assert.throws(
    () =>
      buildProductionReleasePlan({
        affectedPackages: [],
        base: "previous-release",
        sourceSha: REMOTE_SOURCE_SHA,
        scope: "core,remote-agent",
        changedPaths: [
          ...PERSONAL_TOOLS_PATHS,
          "packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts",
          "services/core/src/remote-agent/application/remote-agent-worker-admission.ts",
          "services/remote-agent/.flue/agents/center-agent.ts",
        ],
      }),
    PERSONAL_RECEIVER_CONFLICT_ERROR
  );
});
const SPACE_INVITATION_ORDER_ERROR = /Space invitation/u;
const PEOPLE_COMPUTERS_ORDER_ERROR =
  /PeopleComputers receiver order conflicts/u;
const CURRENT_WORKER_VERSION_RE =
  /11111111-1111-1111-1111-111111111111 \(100%\)/u;
const MIXED_INBOX_RETIREMENT_ERROR_RE = /Mixed Inbox expansion/u;
const INBOX_RETIREMENT_PRODUCER_ERROR_RE = /remove its producer/u;
const CORE_GATEWAY_HTTP_CONNECT_COMBINATION_ERROR_RE =
  /Connect Computer and Wake Progress opt-in receiver-first contracts cannot ship in one release/u;
const CORE_GATEWAY_HTTP_REMOTE_AGENT_COMBINATION_ERROR_RE =
  /Remote Agent receiver-first and worker-response contracts cannot ship with a Wake Progress opt-in contract/u;
const CONNECT_COMPUTER_INBOX_COMBINATION_ERROR_RE =
  /Connect Computer and Inbox receiver-first contracts cannot ship in one release/u;
const CONNECT_COMPUTER_CENTER_AGENT_COMBINATION_ERROR_RE =
  /Connect Computer and Center Agent CLI receiver-first contracts cannot ship in one release/u;
const LOCAL_MAINLINE_RELEASE_ERROR_PATTERN = /main first-parent chain/u;
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
      lane: "local",
      json: false,
      scope: "web,core",
    }
  );
  assert.equal(
    parseProductionReleaseArgs(["plan", "--database-cutover"]).databaseCutover,
    true
  );
  for (const command of ["deploy", "preflight", "verify"]) {
    assert.throws(
      () => parseProductionReleaseArgs([command, "--database-cutover"]),
      { message: "Unknown production release option: --database-cutover" }
    );
  }
});

test("identifies a local release owner across computers", () => {
  assert.equal(
    resolveLocalReleaseOwner({
      hostname: "build-mac-07.local",
      pid: 4242,
      user: "agent-a",
    }),
    "local:agent-a@build-mac-07.local:4242"
  );
});

test("parses an explicit deployment preflight", () => {
  assert.deepEqual(
    parseProductionReleaseArgs(["preflight", "--scope", "core"]),
    {
      base: "origin/main",
      command: "preflight",
      lane: "local",
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
    "website",
    "docs",
  ]);
  assert.deepEqual(expandRequestedReleaseScopes("full"), [
    "db",
    "auth",
    "web",
    "gateway",
    "core",
    "remote-agent",
    "website",
    "docs",
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

test("local production release accepts only current main first-parent sources", () => {
  const repositoryPath = mkdtempSync(
    path.join(tmpdir(), "openmeld-local-release-mainline-")
  );
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repositoryPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const commit = (fileName, contents, message) => {
    writeFileSync(path.join(repositoryPath, fileName), contents);
    git("add", fileName);
    git("commit", "--quiet", "-m", message);
    return git("rev-parse", "HEAD");
  };

  try {
    git("init", "--initial-branch=main", "--quiet");
    git("config", "user.email", "local-release@test.openmeld.ai");
    git("config", "user.name", "OpenMeld Local Release Test");
    commit("base.txt", "base\n", "base");
    git("checkout", "--quiet", "-b", "side");
    const sideBranchSha = commit("side.txt", "side\n", "side branch");
    git("checkout", "--quiet", "main");
    const firstParentSha = commit("main.txt", "main\n", "main update");
    git("merge", "--no-ff", "--quiet", "side", "-m", "merge side");
    const mergeSha = git("rev-parse", "HEAD");

    assert.doesNotThrow(() =>
      assertProductionReleaseSource({
        cwd: repositoryPath,
        mainRef: "main",
        sourceSha: firstParentSha,
      })
    );
    assert.doesNotThrow(() =>
      assertProductionReleaseSource({
        cwd: repositoryPath,
        mainRef: "main",
        sourceSha: mergeSha,
      })
    );
    assert.throws(
      () =>
        assertProductionReleaseSource({
          cwd: repositoryPath,
          mainRef: "main",
          sourceSha: sideBranchSha,
        }),
      LOCAL_MAINLINE_RELEASE_ERROR_PATTERN
    );
  } finally {
    rmSync(repositoryPath, { force: true, recursive: true });
  }
});

test("local deploy holds shared CLI and Core leases and releases in reverse order", async () => {
  const operations = [];
  const result = await executeWithProductionScopeLeases({
    adapters: {
      acquireProductionScopeLease: ({ scope, sourceSha }) => {
        operations.push(`acquire:${scope}:${sourceSha}`);
        return {
          leaseSha: scope.padEnd(40, "0").slice(0, 40),
          metadata: { scope },
        };
      },
      releaseProductionScopeLease: ({ scope }) => {
        operations.push(`release:${scope}`);
      },
    },
    execute: () => {
      operations.push("deploy");
      return "released";
    },
    owner: "local:test",
    scopes: ["cli"],
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(result, "released");
  assert.deepEqual(operations, [
    `acquire:cli:${REMOTE_SOURCE_SHA}`,
    `acquire:core:${REMOTE_SOURCE_SHA}`,
    "deploy",
    "release:core",
    "release:cli",
  ]);
});

test("local deploy publishes exact completion evidence before releasing its leases", async () => {
  const operations = [];
  await executeWithProductionScopeLeases({
    adapters: {
      acquireProductionScopeLease: ({ scope }) => ({
        leaseSha: scope.padEnd(40, "0").slice(0, 40),
        metadata: { scope },
      }),
      releaseProductionScopeLease: ({ scope }) => {
        operations.push(`release:${scope}`);
      },
    },
    afterSuccess: ({ scopes, sourceSha }) => {
      operations.push(`evidence:${scopes.join(",")}:${sourceSha}`);
    },
    execute: () => {
      operations.push("deploy");
    },
    owner: "local:test",
    scopes: ["cli"],
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.deepEqual(operations, [
    "deploy",
    `evidence:cli,core:${REMOTE_SOURCE_SHA}`,
    "release:core",
    "release:cli",
  ]);
});

test("the guarded local lane invokes the internal CLI publisher while both leases are held", async () => {
  const operations = [];
  await executeWithProductionScopeLeases({
    adapters: {
      acquireProductionScopeLease: ({ scope }) => {
        operations.push(`acquire:${scope}`);
        return {
          leaseSha: scope.padEnd(40, "0").slice(0, 40),
          metadata: { scope },
        };
      },
      releaseProductionScopeLease: ({ scope }) => {
        operations.push(`release:${scope}`);
      },
    },
    execute: async () => {
      await executeProductionDeploySteps({
        adapters: {
          publishCliRelease: () => {
            operations.push("publish-cli");
          },
        },
        steps: buildProductionDeployStepSpecs(["cli"]).slice(0, 1),
      });
    },
    owner: "local:test",
    scopes: ["cli"],
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.deepEqual(operations, [
    "acquire:cli",
    "acquire:core",
    "publish-cli",
    "release:core",
    "release:cli",
  ]);
});

test("includes the CLI for an affected packaged Service dependency", () => {
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
    ["cli", "web", "gateway", "core"]
  );
});

test("includes Gateway and Core for the Wake Progress opt-in contract", () => {
  assert.deepEqual(
    resolveAutomaticReleaseScopes({
      affectedPackages: [],
      changedPaths: [
        "clients/openmeld-cli/src/space/wake-control-command.ts",
        "packages/schemas/src/schemas/http/space-wake-progress.ts",
        "services/core/src/space/transport/do/space.ts",
      ],
    }),
    ["cli", "gateway", "core"]
  );
});

test("includes every receiver before publishing the Space history query caller", () => {
  assert.deepEqual(
    resolveAutomaticReleaseScopes({
      affectedPackages: [],
      changedPaths: ["packages/schemas/src/schemas/http/list-signals-query.ts"],
    }),
    ["cli", "gateway", "core"]
  );
});

test("deploys Space history query receivers before its CLI caller", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: ["packages/schemas/src/schemas/http/list-signals-query.ts"],
    scope: "gateway,core,cli",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(plan.deployOrderProfile, "space-history-query-receivers-first");
  assert.deepEqual(plan.deployScopeOrder, ["gateway", "core", "cli"]);
});

test("rejects a Space history query CLI release without its receivers", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: ["packages/schemas/src/schemas/http/list-signals-query.ts"],
    scope: "cli",
    sourceSha: REMOTE_SOURCE_SHA,
  });
  assertReceiptGatedStage(plan.scopes, plan.changedPaths);
});

test("deploys the Wake Progress opt-in receiver chain before its CLI caller", () => {
  const changedPaths = [
    "clients/openmeld-cli/src/space/wake-control-command.ts",
    "packages/schemas/src/schemas/http/space-wake-progress.ts",
    "services/core/src/space/transport/do/space.ts",
  ];
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths,
    scope: "gateway,core,cli",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(plan.deployOrderProfile, "wake-progress-opt-in-receivers-first");
  assert.deepEqual(plan.deployScopeOrder, ["gateway", "core", "cli"]);
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Deploy Gateway Worker",
      "Verify Gateway Worker health",
      "Deploy Core with the current published CLI projection",
      "Verify Core receiver stable identity alignment",
      "Publish CLI and deploy its Core release projection",
      "Verify final R2/npm/Core alignment",
    ]
  );
});

test("rejects a Wake Progress opt-in release without every receiver", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [
      "clients/openmeld-cli/src/space/wake-control-command.ts",
      "packages/schemas/src/schemas/http/space-wake-progress.ts",
      "services/core/src/space/transport/do/space.ts",
    ],
    scope: "cli",
    sourceSha: REMOTE_SOURCE_SHA,
  });
  assertReceiptGatedStage(plan.scopes, plan.changedPaths);
});

test("composes Remote Agent request and Wake Progress opt-in receiver order", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [
      "clients/openmeld-cli/src/space/wake-control-command.ts",
      "packages/schemas/src/schemas/http/space-wake-progress.ts",
      "packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts",
      "services/core/src/remote-agent/application/remote-agent-worker-admission.ts",
      "services/core/src/space/transport/do/space.ts",
      "services/remote-agent/.flue/agents/center-agent.ts",
    ],
    scope: "remote-agent,gateway,core,cli",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(
    plan.deployOrderProfile,
    "remote-agent-and-wake-progress-opt-in-receivers-first"
  );
  assert.deepEqual(plan.deployScopeOrder, [
    "remote-agent",
    "gateway",
    "core",
    "cli",
  ]);
});

test("composes Core worker response and Wake Progress opt-in receiver order", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [
      "clients/openmeld-cli/src/space/wake-control-command.ts",
      "packages/schemas/src/schemas/http/space-wake-progress.ts",
      "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
      "services/core/src/space/transport/do/space.ts",
      "services/remote-agent/.flue/agents/center-agent.ts",
    ],
    scope: "gateway,core,remote-agent,cli",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(
    plan.deployOrderProfile,
    "core-worker-response-and-wake-progress-opt-in-receivers-first"
  );
  assert.deepEqual(plan.deployScopeOrder, [
    "gateway",
    "core",
    "remote-agent",
    "cli",
  ]);
});

test("rejects conflicting Remote Agent request directions in a Wake Progress opt-in release", () => {
  assert.throws(
    () =>
      buildProductionReleasePlan({
        affectedPackages: [],
        base: "previous-release",
        changedPaths: [
          "clients/openmeld-cli/src/space/wake-control-command.ts",
          "packages/schemas/src/schemas/http/space-wake-progress.ts",
          "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
          "services/core/src/remote-agent/application/remote-agent-worker-admission.ts",
          "services/core/src/space/transport/do/space.ts",
          "services/remote-agent/.flue/agents/center-agent.ts",
        ],
        scope: "remote-agent,gateway,core,cli",
        sourceSha: REMOTE_SOURCE_SHA,
      }),
    CORE_GATEWAY_HTTP_REMOTE_AGENT_COMBINATION_ERROR_RE
  );
});

test("rejects conflicting Connect Computer and Wake Progress opt-in release order", () => {
  assert.throws(
    () =>
      buildProductionReleasePlan({
        affectedPackages: [],
        base: "previous-release",
        changedPaths: [
          "clients/openmeld-cli/src/openmeld.ts",
          "clients/openmeld-cli/src/space/wake-control-command.ts",
          "clients/web/src/lib/cli-entry-command.ts",
          "packages/schemas/src/schemas/http/auth-device-authorization.ts",
          "packages/schemas/src/schemas/http/space-wake-progress.ts",
          "services/core/src/space/transport/do/space.ts",
        ],
        scope: "web,gateway,core,cli",
        sourceSha: REMOTE_SOURCE_SHA,
      }),
    CORE_GATEWAY_HTTP_CONNECT_COMBINATION_ERROR_RE
  );
});

test("rejects a generic Remote Agent receiver combined with its worker response producer", () => {
  assert.throws(
    () =>
      buildProductionReleasePlan({
        affectedPackages: [],
        base: "previous-release",
        changedPaths: [
          "clients/openmeld-cli/src/space/wake-control-command.ts",
          "packages/schemas/src/schemas/http/space-wake-progress.ts",
          "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
          "services/core/src/space/transport/do/space.ts",
          "services/remote-agent/flue-adapter/cloudflare-entrypoint.ts",
          "services/remote-agent/.flue/agents/center-agent.ts",
        ],
        scope: "remote-agent,gateway,core,cli",
        sourceSha: REMOTE_SOURCE_SHA,
      }),
    CORE_GATEWAY_HTTP_REMOTE_AGENT_COMBINATION_ERROR_RE
  );
});

test("rejects a Center Agent CLI receiver combined with its worker response producer", () => {
  assert.throws(
    () =>
      buildProductionReleasePlan({
        affectedPackages: [],
        base: "previous-release",
        changedPaths: [
          "clients/openmeld-cli/src/space/wake-control-command.ts",
          "packages/schemas/src/schemas/http/center-agent-context-manifest.ts",
          "packages/schemas/src/schemas/http/space-wake-progress.ts",
          "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
          "services/core/src/space/transport/do/space.ts",
          "services/remote-agent/.flue/agents/center-agent.ts",
        ],
        scope: "remote-agent,gateway,core,cli",
        sourceSha: REMOTE_SOURCE_SHA,
      }),
    CORE_GATEWAY_HTTP_REMOTE_AGENT_COMBINATION_ERROR_RE
  );
});

test("does not expand production scope through dev-only workspace dependencies", () => {
  const plan = buildProductionReleasePlan({
    base: "origin/main",
    changedPaths: ["services/core/src/space/transport/do/space.ts"],
    scope: "auto",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.deepEqual(plan.affectedPackages, ["@openmeld/core"]);
  assert.deepEqual(plan.scopes, ["core"]);
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

test("releases the live model catalog through Core without a CLI release", () => {
  assert.deepEqual(
    resolveAutomaticReleaseScopes({
      affectedPackages: [],
      changedPaths: [
        "changelog/entries/opencode-ox-alpha-free.md",
        "packages/schemas/tests/config/model-catalog.test.ts",
        "release/vendor-models.json",
      ],
    }),
    ["core"]
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

test("uses current trusted control for PostgreSQL recovery without changing operation identity", () => {
  const steps = buildProductionDeployStepSpecs(["db"], {
    databaseBackend: "postgresql",
  });
  assert.deepEqual(
    steps.map(({ command, args }) => ({ command, args })),
    ["migrate", "grant-runtime", "verify"].map((operation) => ({
      command: "node",
      args: ["tooling/postgresql/cutover.mjs", operation],
    }))
  );
  for (const step of steps) {
    assert.equal(step.controlPath, "tooling/postgresql/cutover.mjs");
  }
});

test("gives every hosted-eligible preflight step a trusted control path", () => {
  for (const scope of ["auth", "core", "gateway", "remote-agent", "web"]) {
    const steps = buildProductionPreflightStepSpecs({
      changedPaths: [],
      releaseSha: REMOTE_SOURCE_SHA,
      scopes: [scope],
    });
    for (const step of steps) {
      assert.ok(
        typeof step.controlPath === "string" && step.controlPath.length > 0,
        `Hosted production preflight step has no trusted control path: ${step.label}`
      );
    }
  }
});

test("runs the Core CLI channel compatibility gate through the trusted control checkout", () => {
  const step = buildProductionPreflightStepSpecs({
    changedPaths: [],
    releaseSha: REMOTE_SOURCE_SHA,
    scopes: ["core"],
  }).find((entry) => entry.label === "Verify Core CLI channel compatibility");

  assert.equal(step?.controlCommand, "node");
  assert.equal(step?.controlPath, "scripts/release/verify-release-ready.mjs");
  assert.deepEqual(step?.controlArgs, ["--current", "--channel-sync-check"]);
});

test("lets a selected CLI release publish its channel before the Core compatibility gate", () => {
  const verifySteps = buildProductionVerifyStepSpecs({
    changedPaths: [],
    scopes: ["cli", "core"],
  });
  const preflightSteps = buildProductionPreflightStepSpecs({
    changedPaths: [],
    releaseSha: REMOTE_SOURCE_SHA,
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
  const webSteps = buildProductionPreflightStepSpecs({
    changedPaths: [],
    releaseSha: REMOTE_SOURCE_SHA,
    scopes: ["web"],
  });
  assert.deepEqual(
    webSteps.map((step) => step.label),
    [
      "Admit receipt-based Production train stage",
      "Verify declared Production train artifacts",
      "Verify signed CLI Skill content",
      "Verify Cloudflare environment contracts",
      "Check retired identifiers",
    ]
  );
  assert.deepEqual(webSteps[3]?.args, [
    "run",
    "verify:cloudflare:env-contract",
    "--",
    "--profile",
    "production",
  ]);
  assert.deepEqual(webSteps[3]?.controlArgs, ["--profile", "production"]);
  assert.equal(
    webSteps[0]?.controlPath,
    "scripts/release/production-stage-admission.mjs"
  );
  assert.equal(
    webSteps[1]?.controlPath,
    "scripts/release/production-train-artifact-admission.mjs"
  );
  assert.equal(webSteps[2]?.controlPath, "scripts/release/cli-skill-check.mjs");

  const coreSteps = buildProductionPreflightStepSpecs({
    changedPaths: [],
    releaseSha: REMOTE_SOURCE_SHA,
    scopes: ["core"],
  });
  assert.deepEqual(
    coreSteps.map((step) => step.label),
    [
      "Admit receipt-based Production train stage",
      "Verify declared Production train artifacts",
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
      releaseSha: REMOTE_SOURCE_SHA,
      scopes: ["cli"],
    }).map((step) => step.label),
    [
      "Admit receipt-based Production train stage",
      "Verify declared Production train artifacts",
      "Verify Cloudflare environment contracts",
      "Check retired identifiers",
      "Verify production Core Queue resources",
    ]
  );

  assert.deepEqual(
    buildProductionPreflightStepSpecs({
      changedPaths: [],
      releaseSha: REMOTE_SOURCE_SHA,
      scopes: ["gateway"],
    }).map((step) => step.label),
    [
      "Admit receipt-based Production train stage",
      "Verify declared Production train artifacts",
      "Verify Cloudflare environment contracts",
      "Check retired identifiers",
      "Verify production Gateway Queue resources",
    ]
  );
});

test("preflights current-stable Core recovery without comparing the checked-in future projection", () => {
  const steps = buildCoreCurrentCliProjectionPreflightStepSpecs(
    [],
    REMOTE_SOURCE_SHA
  );

  assert.deepEqual(
    steps.map((step) => step.label),
    [
      "Admit receipt-based Production train stage",
      "Verify declared Production train artifacts",
      "Verify Cloudflare environment contracts",
      "Check retired identifiers",
      "Verify production Core Queue resources",
    ]
  );
  assert.ok(
    !steps.some(
      (step) => step.label === "Verify Core CLI channel compatibility"
    )
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
    steps.map((step) => step.internalOperation),
    ["publish-cli", "publish-cli"]
  );
});

test("publishes the Connect Computer CLI receiver and Core projection before Web", () => {
  const changedPaths = [
    "packages/schemas/src/schemas/http/auth-device-authorization.ts",
    "clients/openmeld-cli/src/openmeld.ts",
    "clients/web/src/lib/cli-entry-command.ts",
  ];
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths,
    scope: "auth,cli,core,web",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(plan.deployOrderProfile, "connect-computer-cli-receiver-first");
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Deploy Auth Worker",
      "Verify Auth Worker health",
      "Publish CLI and deploy its Core release projection",
      "Deploy Web",
      "Verify Web health",
      "Verify final R2/npm/Core alignment",
    ]
  );
});

test("fails closed instead of dropping Inbox ordering from a Connect Computer release", () => {
  assert.throws(
    () =>
      buildProductionReleasePlan({
        affectedPackages: [],
        base: "previous-release",
        changedPaths: [
          "packages/schemas/src/schemas/http/auth-device-authorization.ts",
          "clients/openmeld-cli/src/openmeld.ts",
          "clients/web/src/lib/cli-entry-command.ts",
          "packages/schemas/src/schemas/http/inbox.ts",
          "services/core/src/remote-agent/application/native-delivery-inbox-producer.ts",
        ],
        scope: "cli,web,gateway,core",
        sourceSha: REMOTE_SOURCE_SHA,
      }),
    CONNECT_COMPUTER_INBOX_COMBINATION_ERROR_RE
  );
});

test("composes the Remote Agent receiver before Connect Computer CLI and Web producers", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [
      "packages/schemas/src/schemas/http/auth-device-authorization.ts",
      "clients/openmeld-cli/src/openmeld.ts",
      "clients/web/src/lib/cli-entry-command.ts",
      "packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts",
      "services/core/src/remote-agent/application/remote-agent-worker-admission.ts",
      "services/remote-agent/.flue/agents/center-agent.ts",
    ],
    scope: "remote-agent,cli,core,web",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(
    plan.deployOrderProfile,
    "remote-agent-and-connect-computer-receivers-first"
  );
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
      "Publish CLI and deploy its Core release projection",
      "Deploy Web",
      "Verify Web health",
      "Verify final R2/npm/Core alignment",
    ]
  );
});

test("fails closed instead of dropping Center Agent CLI ordering from a Connect Computer release", () => {
  assert.throws(
    () =>
      buildProductionReleasePlan({
        affectedPackages: [],
        base: "previous-release",
        changedPaths: [
          "packages/schemas/src/schemas/http/auth-device-authorization.ts",
          "clients/openmeld-cli/src/openmeld.ts",
          "clients/web/src/lib/cli-entry-command.ts",
          "services/core/src/center-agent-tasks/application/center-agent-task-service.ts",
        ],
        scope: "cli,web,core",
        sourceSha: REMOTE_SOURCE_SHA,
      }),
    CONNECT_COMPUTER_CENTER_AGENT_COMBINATION_ERROR_RE
  );
});

test("composes Core's response reader with Connect Computer receiver-first ordering", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [
      "packages/schemas/src/schemas/http/auth-device-authorization.ts",
      "clients/openmeld-cli/src/openmeld.ts",
      "clients/web/src/lib/cli-entry-command.ts",
      "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
      "services/remote-agent/.flue/agents/center-agent.ts",
    ],
    scope: "auth,cli,core,web,remote-agent",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(
    plan.deployOrderProfile,
    "core-worker-response-and-connect-computer-receivers-first"
  );
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Deploy Auth Worker",
      "Verify Auth Worker health",
      "Publish CLI and deploy its Core release projection",
      "Deploy Web",
      "Verify Web health",
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
      "Verify final R2/npm/Core alignment",
    ]
  );
});

test("automatically includes both sides of the Connect Computer command contract", () => {
  assert.deepEqual(
    resolveAutomaticReleaseScopes({
      affectedPackages: [],
      changedPaths: [
        "packages/schemas/src/schemas/http/auth-device-authorization.ts",
        "clients/openmeld-cli/src/openmeld.ts",
        "clients/web/src/lib/cli-entry-command.ts",
      ],
    }),
    ["cli", "web"]
  );
});

test("rejects a Connect Computer Web deploy without its CLI receiver", () => {
  assertReceiptGatedStage(
    ["web"],
    [
      "packages/schemas/src/schemas/http/auth-device-authorization.ts",
      "clients/openmeld-cli/src/openmeld.ts",
      "clients/web/src/lib/cli-entry-command.ts",
    ]
  );
});

test("publishes the required caller-context Service before Core begins producing it", () => {
  const changedPaths = [
    "packages/schemas/src/schemas/protocol/space-caller-context.ts",
    "services/core/src/space/transport/do/space.ts",
    "clients/openmeld-cli/src/local-service/dispatch/parse-dispatch-task.ts",
    "packages/schemas/src/space-invitation.ts",
    "services/core/src/organizations/space-invitations.ts",
    "services/auth/src/lib/hono/space-invitation-routes.ts",
  ];
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    sourceSha: REMOTE_SOURCE_SHA,
    scope: "db,auth,remote-agent,cli,core,gateway,web",
    changedPaths,
  });
  assert.deepEqual(plan.deployScopeOrder, [
    "db",
    "auth",
    "remote-agent",
    "cli",
    "core",
    "gateway",
    "web",
  ]);
  assert.ok(
    !plan.deploySteps.some(
      (step) =>
        step.label === "Deploy Core with the current published CLI projection"
    )
  );
  for (const scopes of [["core"], ["cli"], ["core", "auth"]]) {
    assertReceiptGatedStage(scopes, changedPaths);
  }
});

test("stages Space invitation receivers before publishing the CLI caller", () => {
  const changedPaths = [
    "packages/schemas/src/space-invitation.ts",
    "services/core/src/organizations/space-invitations.ts",
    "services/auth/src/lib/hono/space-invitation-routes.ts",
    "clients/openmeld-cli/src/space/invitations-command.ts",
  ];
  for (const scopes of [
    ["db", "core", "auth"],
    ["db", "core", "auth", "cli"],
  ]) {
    const labels = buildProductionDeployStepSpecs(scopes, { changedPaths }).map(
      (step) => step.label
    );
    assert.deepEqual(labels.slice(0, 5), [
      "Synchronize production database",
      "Deploy Core with the current published CLI projection",
      "Verify Core receiver stable identity alignment",
      "Deploy Auth Worker",
      "Verify Auth Worker health",
    ]);
    if (scopes.includes("cli")) {
      assert.equal(
        labels[5],
        "Publish CLI and deploy its Core release projection"
      );
    }
  }
  assertReceiptGatedStage(["cli"], changedPaths);
  assertReceiptGatedStage(["auth"], changedPaths);
});

test("combines invitation and Service receivers while keeping conflicting writers blocked", () => {
  const invitations = [
    "packages/schemas/src/space-invitation.ts",
    "services/core/src/organizations/space-invitations.ts",
    "services/auth/src/lib/hono/space-invitation-routes.ts",
  ];
  const changedPaths = [
    ...invitations,
    "packages/schemas/src/schemas/daemon/runtime-transport.ts",
    "services/core/src/runtime-transport/application/runtime-transport-dispatch-service.ts",
    "clients/openmeld-cli/src/local-service/adapters/resolve-daemon-capabilities.ts",
    "packages/schemas/src/schemas/local-components.ts",
    "clients/openmeld-cli/src/local-components/manifest.ts",
    "services/core/src/local-components/update-projection.ts",
  ];
  const labels = buildProductionDeployStepSpecs(
    ["db", "core", "auth", "gateway", "web", "cli"],
    { changedPaths }
  ).map((step) => step.label);
  assert.deepEqual(labels, [
    "Synchronize production database",
    "Deploy Core with the current published CLI projection",
    "Verify Core receiver stable identity alignment",
    "Deploy Auth Worker",
    "Verify Auth Worker health",
    "Deploy Gateway Worker",
    "Verify Gateway Worker health",
    "Deploy Web",
    "Verify Web health",
    "Publish CLI and deploy its Core release projection",
    "Verify final R2/npm/Core alignment",
  ]);
  assertReceiptGatedStage(["core", "auth", "cli"], changedPaths);
  assert.throws(
    () =>
      buildProductionDeployStepSpecs(
        ["web", "gateway", "core", "auth", "cli"],
        {
          changedPaths: [
            ...changedPaths,
            "packages/schemas/src/schemas/http/inbox.ts",
            "services/core/src/remote-agent/application/native-delivery-inbox-producer.ts",
          ],
        }
      ),
    SPACE_INVITATION_ORDER_ERROR
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

test("binds Web health to the exact preflight artifact receipt", () => {
  const sourceSha = "f".repeat(40);
  const health = buildProductionDeployStepSpecs(["web"], {
    releaseSha: sourceSha,
  }).find((step) => step.label === "Verify Web health");

  assert.deepEqual(health.args, [
    "scripts/release/production-web-health.mjs",
    "--scope",
    "web",
    "--url",
    "https://app.openmeld.ai",
    "--source-sha",
    sourceSha,
    "--artifact-receipt",
    "dev-tmp/release-artifact-check/web.json",
  ]);
});

for (const [scope, label, url] of [
  ["website", "Website", "https://openmeld.ai"],
  ["docs", "Docs", "https://docs.openmeld.ai"],
]) {
  test(`a ${label}-only source change deploys and verifies its Worker without touching the App`, () => {
    const plan = buildProductionReleasePlan({
      affectedPackages: [`openmeld-${scope}`],
      changedPaths: [`clients/${scope}/src/routes/index.tsx`],
      sourceSha: REMOTE_SOURCE_SHA,
      scope: "auto",
      base: "previous-release",
    });
    assert.deepEqual(plan.scopes, [scope]);
    assert.deepEqual(
      plan.deploySteps.map((step) => step.label),
      [`Deploy ${label}`, `Verify ${label} health`]
    );
    assert.equal(plan.deploySteps[0].args.includes(`openmeld-${scope}`), true);
    assert.equal(plan.deploySteps[1].args.includes(url), true);
    assert.equal(
      plan.deploySteps[1].args.includes(
        `dev-tmp/release-artifact-check/${scope}.json`
      ),
      true
    );
  });
}

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
      "Verify Core receiver stable identity alignment",
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
      "Verify Core receiver stable identity alignment",
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
    "--deployment-only",
    "--release-sha",
    REMOTE_SOURCE_SHA,
  ]);
});

for (const changedPaths of [
  [
    "packages/schemas/src/schemas/http/people-computers.ts",
    "services/core/src/people-computers/projection.ts",
    "services/gateway/src/routes/rpc-http.people-computers.ts",
  ],
  [
    "packages/schemas/src/schemas/daemon/service-connection-evidence.ts",
    "services/core/src/computers/service-connection-evidence-rpc.ts",
    "services/gateway/src/routes/rpc-http.service-connection-evidence.ts",
  ],
]) {
  test(`deploys computer receivers before callers and preserves the stable CLI during staged Core delivery: ${changedPaths[0]}`, () => {
    const input = {
      affectedPackages: [],
      base: "previous-release",
      changedPaths,
      sourceSha: REMOTE_SOURCE_SHA,
    };
    const plan = buildProductionReleasePlan({
      ...input,
      scope: "core,gateway,web,remote-agent,cli",
    });
    assert.equal(plan.deployOrderProfile, "people-computers-receivers-first");
    assert.deepEqual(
      plan.deploySteps.map((step) => step.label),
      [
        "Deploy Core with the current published CLI projection",
        "Verify Core receiver stable identity alignment",
        "Deploy Gateway Worker",
        "Verify Gateway Worker health",
        "Deploy Web",
        "Verify Web health",
        "Deploy Remote Agent Worker",
        "Verify Remote Agent deployment is visible",
        "Publish CLI and deploy its Core release projection",
        "Verify final R2/npm/Core alignment",
      ]
    );
    const staged = buildProductionReleasePlan({ ...input, scope: "core" });
    assert.equal(
      staged.deploySteps[0].args[0],
      "scripts/release/deploy-core-current-cli-projection.mjs"
    );
    assert.deepEqual(
      buildProductionPreflightStepSpecs({
        scopes: ["core"],
        changedPaths,
        releaseSha: REMOTE_SOURCE_SHA,
      }),
      buildCoreCurrentCliProjectionPreflightStepSpecs(
        changedPaths,
        REMOTE_SOURCE_SHA
      )
    );
    assert.throws(
      () =>
        buildProductionReleasePlan({
          ...input,
          changedPaths: [
            ...changedPaths,
            "services/remote-agent/.flue/cloudflare.ts",
          ],
          scope: "cloud",
        }),
      PEOPLE_COMPUTERS_ORDER_ERROR
    );
  });
}

test("routes a local Core release through startup admission at the exact source SHA", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [],
    scope: "core",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.deepEqual(plan.deploySteps[0], {
    args: [
      "scripts/release/deploy-core-worker.mjs",
      "--release-sha",
      REMOTE_SOURCE_SHA,
    ],
    command: "node",
    label: "Deploy Core Worker",
    releaseScope: "core",
    completesReleaseScope: false,
    workerDeploymentArgs: [
      "--config",
      "services/core/wrangler.jsonc",
      "--env",
      "prod",
    ],
  });
});

test("deploys a strict Local Service runtime receiver before publishing the CLI", () => {
  for (const producerPath of [
    "clients/openmeld-cli/src/local-service/adapters/resolve-daemon-capabilities.ts",
    "runtime/adapters/antigravity/src/transport/antigravity-cli-transport.ts",
  ]) {
    const changedPaths = [
      "packages/schemas/src/schemas/daemon/runtime-transport.ts",
      "services/core/src/runtime-transport/application/runtime-transport-dispatch-service.ts",
      producerPath,
    ];
    const plan = buildProductionReleasePlan({
      affectedPackages: [],
      base: "previous-release",
      changedPaths,
      scope: "auth,core,gateway,web,remote-agent,cli",
      sourceSha: REMOTE_SOURCE_SHA,
      readGitFile: () => "// Historical runtime before saved-workspace reads.",
    });

    assert.equal(
      plan.deployOrderProfile,
      "local-service-runtime-receiver-first"
    );
    assert.deepEqual(plan.compatibilityDependencies, [["core", "cli"]]);
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
        "Verify Core receiver stable identity alignment",
        "Deploy Remote Agent Worker",
        "Verify Remote Agent deployment is visible",
        "Publish CLI and deploy its Core release projection",
        "Verify final R2/npm/Core alignment",
      ]
    );
    const staged = buildProductionReleasePlan({
      affectedPackages: [],
      base: "previous-release",
      changedPaths,
      scope: "core,gateway",
      sourceSha: REMOTE_SOURCE_SHA,
      readGitFile: () => "// Historical runtime before saved-workspace reads.",
    });
    assert.ok(
      staged.deploySteps.some(
        (step) =>
          step.label === "Deploy Core with the current published CLI projection"
      )
    );
    for (const steps of [staged.verifySteps, staged.preflightSteps]) {
      assert.equal(
        steps.some(
          (step) => step.label === "Verify Core CLI channel compatibility"
        ),
        false
      );
    }
    const afterRemoteReceiver = buildProductionReleasePlan({
      affectedPackages: [],
      base: "previous-release",
      changedPaths: [
        ...changedPaths,
        "services/remote-agent/.flue/cloudflare.ts",
      ],
      scope: "core,gateway",
      sourceSha: REMOTE_SOURCE_SHA,
      readGitFile: () => "// Historical runtime before saved-workspace reads.",
    });
    assert.equal(
      afterRemoteReceiver.deploySteps[0].args[0],
      "scripts/release/deploy-core-current-cli-projection.mjs"
    );
  }
});

test("publishes independent Skill report receivers and public content before the bridge CLI", () => {
  const changedPaths = [
    "packages/schemas/src/schemas/local-components.ts",
    "clients/openmeld-cli/src/local-components/manifest.ts",
    "services/core/src/local-components/update-projection.ts",
  ];
  const input = {
    affectedPackages: [],
    base: "previous-release",
    changedPaths,
    sourceSha: REMOTE_SOURCE_SHA,
  };
  const plan = buildProductionReleasePlan({
    ...input,
    scope: "core,gateway,web,cli",
  });
  assert.equal(plan.deployOrderProfile, "local-service-runtime-receiver-first");
  const labels = plan.deploySteps.map((step) => step.label);
  assert.ok(
    labels.indexOf("Deploy Gateway Worker") <
      labels.indexOf("Publish CLI and deploy its Core release projection")
  );
  assert.ok(
    labels.indexOf("Deploy Web") <
      labels.indexOf("Publish CLI and deploy its Core release projection")
  );
  assertReceiptGatedStage(["core", "cli"], changedPaths);
  assert.deepEqual(
    resolveAutomaticReleaseScopes({
      affectedPackages: [],
      changedPaths: ["release/openmeld-cli-skill/SKILL.md"],
    }),
    ["web"]
  );
});

test("rejects a strict Local Service runtime release without its Core receiver", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [
      "packages/schemas/src/schemas/daemon/runtime-transport.ts",
      "services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts",
      "clients/openmeld-cli/src/local-service/execution-host/frame-router.ts",
    ],
    scope: "cli",
    sourceSha: REMOTE_SOURCE_SHA,
  });
  assertReceiptGatedStage(plan.scopes, plan.changedPaths);
});

test("deploys Core response readers before execution reconciliation", () => {
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

  assert.equal(plan.deployOrderProfile, "core-worker-response-reader-first");
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Deploy Core with the current published CLI projection",
      "Verify Core receiver stable identity alignment",
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
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
      "Deploy Core with the current published CLI projection",
      "Verify Core receiver stable identity alignment",
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
      "Deploy Core with the current published CLI projection",
      "Verify Core receiver stable identity alignment",
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

test("deploys worker-response and activity readers before the Remote Agent producer", () => {
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [
      "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
      "services/core/src/center-agent-tasks/application/center-agent-task-service.ts",
      "services/remote-agent/.flue/agents/center-agent.ts",
      "services/remote-agent/flue-adapter/conversation-footprint.ts",
      "packages/schemas/src/schemas/protocol/agent-stream.ts",
    ],
    scope: "db,auth,core,gateway,web,remote-agent,cli",
    sourceSha: REMOTE_SOURCE_SHA,
  });

  assert.equal(plan.deployOrderProfile, "core-worker-response-reader-first");
  const receiver = buildProductionReleasePlan({
    base: "previous-release",
    changedPaths: plan.changedPaths,
    scope: "core",
    sourceSha: REMOTE_SOURCE_SHA,
  });
  assert.deepEqual(
    receiver.deploySteps.map((step) => step.label),
    [
      "Deploy Core with the current published CLI projection",
      "Verify Core receiver stable identity alignment",
    ]
  );
  assert.ok(
    !receiver.preflightSteps.some(
      (step) => step.label === "Verify Core CLI channel compatibility"
    )
  );
  assert.ok(
    !receiver.verifySteps.some(
      (step) => step.label === "Verify Core CLI channel compatibility"
    )
  );
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Synchronize production database",
      "Deploy Auth Worker",
      "Verify Auth Worker health",
      "Deploy Core with the current published CLI projection",
      "Verify Core receiver stable identity alignment",
      "Deploy Gateway Worker",
      "Verify Gateway Worker health",
      "Deploy Web",
      "Verify Web health",
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
      "Publish CLI and deploy its Core release projection",
      "Verify final R2/npm/Core alignment",
    ]
  );
});

const AMBIGUOUS_NATIVE_DELIVERY_ORDER = /Split Core\/CLI and Remote Agent/;

test("rejects ambiguous native delivery rollouts but permits reviewed single-side stages", () => {
  const input = {
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [
      "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
      "services/core/src/remote-agent/application/native-delivery-service.ts",
      "services/remote-agent/.flue/agents/center-agent.ts",
    ],
    sourceSha: REMOTE_SOURCE_SHA,
  };
  for (const scope of ["core,remote-agent", "cli,remote-agent"]) {
    assert.throws(
      () => buildProductionReleasePlan({ ...input, scope }),
      AMBIGUOUS_NATIVE_DELIVERY_ORDER
    );
  }
  for (const scope of ["core", "remote-agent"]) {
    assert.deepEqual(
      buildProductionReleasePlan({ ...input, scope }).deployScopeOrder,
      [scope]
    );
  }
});

test("accepts only the reviewed provider-connection response addition as Core-first", () => {
  const schemaPath =
    "packages/schemas/src/schemas/runtime/remote-agent-worker.ts";
  const addition =
    '  PROVIDER_CONNECTION_MISSING: "remote_agent.provider.connection_missing",\n';
  const before =
    '  PROVIDER_AUTHENTICATION_FAILED: "remote_agent.provider.authentication_failed",\n' +
    '  PROVIDER_FAILED: "remote_agent.provider.failed",\n';
  const input = {
    affectedPackages: [],
    base: "previous-release",
    changedPaths: [
      schemaPath,
      "services/core/src/remote-agent/application/native-delivery-service.ts",
      "services/remote-agent/.flue/agents/center-agent.ts",
    ],
    readGitFile: (ref, path) => {
      assert.equal(path, schemaPath);
      return ref === "previous-release"
        ? before
        : before.replace(
            '  PROVIDER_FAILED: "remote_agent.provider.failed",\n',
            `${addition}  PROVIDER_FAILED: "remote_agent.provider.failed",\n`
          );
    },
    scope: "db,auth,core,gateway,web,remote-agent,cli",
    sourceSha: REMOTE_SOURCE_SHA,
  };

  assert.equal(
    buildProductionReleasePlan(input).deployOrderProfile,
    "core-worker-response-reader-first"
  );
  assert.throws(
    () =>
      buildProductionReleasePlan({
        ...input,
        changedPaths: [
          ...input.changedPaths,
          "packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts",
        ],
      }),
    AMBIGUOUS_NATIVE_DELIVERY_ORDER
  );
  assert.throws(
    () =>
      buildProductionReleasePlan({
        ...input,
        readGitFile: (ref, path) => {
          const content = input.readGitFile(ref, path);
          return ref === REMOTE_SOURCE_SHA
            ? `${content}// other change\n`
            : content;
        },
      }),
    AMBIGUOUS_NATIVE_DELIVERY_ORDER
  );
});

test("prints the current production Worker version before a harmless redeploy", async () => {
  const sideEffects = [];
  const output = [];
  await executeProductionDeploySteps({
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
    ...historicalInboxTargetSource,
  });

  assert.equal(plan.deployOrderProfile, "inbox-source-target-receiver-first");
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Deploy Web",
      "Verify Web health",
      "Deploy Gateway Worker",
      "Verify Gateway Worker health",
      "Deploy Core with the current published CLI projection",
      "Verify Core receiver stable identity alignment",
      "Publish CLI and deploy its Core release projection",
      "Verify final R2/npm/Core alignment",
    ]
  );
});

test("deploys Agent Interaction Inbox receivers before the Core writer", () => {
  const changedPaths = [
    "packages/schemas/src/schemas/http/inbox.ts",
    "services/core/src/runtime-transport/application/runtime-coordinator-interaction-inbox-producer.ts",
  ];
  const plan = buildProductionReleasePlan({
    affectedPackages: [],
    base: "previous-release",
    changedPaths,
    scope: "web,gateway,core,cli",
    sourceSha: REMOTE_SOURCE_SHA,
    ...historicalInboxTargetSource,
  });

  assert.equal(plan.deployOrderProfile, "inbox-source-target-receiver-first");
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Deploy Web",
      "Verify Web health",
      "Deploy Gateway Worker",
      "Verify Gateway Worker health",
      "Deploy Core with the current published CLI projection",
      "Verify Core receiver stable identity alignment",
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

  assertReceiptGatedStage(["core"], changedPaths);
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
    ...historicalInboxTargetSource,
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
      "Deploy Core with the current published CLI projection",
      "Verify Core receiver stable identity alignment",
    ]
  );
});

test("plans Task Inbox retirement from real Git content separately from expansion", () => {
  const repositoryPath = mkdtempSync(
    path.join(tmpdir(), "openmeld-inbox-retirement-")
  );
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repositoryPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const schemaPath = "packages/schemas/src/schemas/http/inbox.ts";
  const producerPath =
    "services/core/src/center-agent-tasks/application/center-agent-task-inbox-producer.ts";
  // Captured shapes of the three retired declarations; current members stay intact.
  const before = `export const inboxItemKindSchema = z.enum([
  "center_agent_update",
  "center_agent_task",
]);
export const inboxSourceKindSchema = z.enum([
  "remote_agent_native_delivery",
  "center_agent_task_event",
]);
export const inboxSourceTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("center_agent_task"),
    taskId: identifierSchema,
  }),
  centerAgentInboxSourceTargetSchema,
]);
`;
  const after = `export const inboxItemKindSchema = z.enum([
  "center_agent_update",
]);
export const inboxSourceKindSchema = z.enum([
  "remote_agent_native_delivery",
]);
export const inboxSourceTargetSchema = z.discriminatedUnion("kind", [
  centerAgentInboxSourceTargetSchema,
]);
`;
  const write = (file, content) => {
    const target = path.join(repositoryPath, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  const remotePaths = [
    "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
    "services/remote-agent/.flue/agents/center-agent.ts",
    "services/core/src/remote-agent/application/remote-agent-worker-admission.ts",
    "services/core/src/remote-agent/application/native-delivery-service.ts",
  ];
  const plan = (
    scope = "db,remote-agent,core,auth,gateway,web,cli",
    sourceSha = null,
    includeSteps = false
  ) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
    process.argv[1] = "readonly-plan-test";
    const { buildProductionReleasePlan } = await import(${JSON.stringify(new URL("./production-release.mjs", import.meta.url).href)});
    try {
      const plan = buildProductionReleasePlan({ base: "retirement-base", scope: ${JSON.stringify(scope)}, sourceSha: ${JSON.stringify(sourceSha)} });
      console.log(JSON.stringify({ profile: plan.deployOrderProfile, order: plan.deployScopeOrder, ...(${includeSteps} ? { deploy: plan.deploySteps.map(step => step.label), preflight: plan.preflightSteps.map(step => step.label), verify: plan.verifySteps.map(step => step.label) } : {}) }));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message }));
    }
  `,
        ],
        { cwd: repositoryPath, encoding: "utf8" }
      )
    );
  try {
    git("init", "--quiet");
    git("config", "user.email", "release-test@openmeld.ai");
    git("config", "user.name", "Release test");
    write(schemaPath, before);
    write(legacyInboxCaller.path, legacyInboxCaller.source);
    write(producerPath, "old Task producer\n");
    for (const file of remotePaths) {
      write(file, "before\n");
    }
    git("add", ".");
    git("commit", "--quiet", "-m", "base contracts");
    git("tag", "retirement-base");
    for (const file of remotePaths) {
      write(file, "after\n");
    }
    write(schemaPath, after);
    git("rm", "--quiet", producerPath);
    git("add", ".");
    git("commit", "--quiet", "-m", "retire Task and add personal Remote");
    const retirementSha = git("rev-parse", "HEAD");
    const assertStagedCoreProjection = () => {
      const staged = plan("db,remote-agent,core,auth,gateway,web", null, true);
      assert.ok(
        staged.deploy.includes(
          "Deploy Core with the current published CLI projection"
        )
      );
      assert.ok(!staged.deploy.includes("Deploy Core Worker"));
      assert.ok(
        !staged.deploy.includes(
          "Publish CLI and deploy its Core release projection"
        )
      );
      assert.ok(
        !staged.preflight.includes("Verify Core CLI channel compatibility")
      );
      assert.ok(
        !staged.verify.includes("Verify Core CLI channel compatibility")
      );
      return staged;
    };
    assert.equal(
      assertStagedCoreProjection().profile,
      "remote-agent-and-inbox-task-retirement-first"
    );
    const producerFirstSteps = buildProductionDeployStepSpecs(
      ["core", "auth", "gateway", "web"],
      { changedPaths: [], taskInboxRetired: true }
    );
    assert.ok(
      producerFirstSteps.some(
        (step) =>
          step.label === "Deploy Core with the current published CLI projection"
      )
    );
    assert.deepEqual(plan(), {
      profile: "remote-agent-and-inbox-task-retirement-first",
      order: ["db", "remote-agent", "core", "auth", "gateway", "web", "cli"],
    });
    assert.deepEqual(plan("core,auth,gateway,web,cli").order, [
      "core",
      "auth",
      "gateway",
      "web",
      "cli",
    ]);
    assert.deepEqual(plan("remote-agent,core").order, ["remote-agent", "core"]);

    // A new kind alongside removal is not silently classified as retirement.
    write(
      schemaPath,
      after.replace(
        '  "center_agent_update",',
        '  "center_agent_update",\n  "new_kind",'
      )
    );
    assert.match(plan().error, MIXED_INBOX_RETIREMENT_ERROR_RE);

    write(schemaPath, before.replace('  "center_agent_task",\n', ""));
    assert.match(plan().error, MIXED_INBOX_RETIREMENT_ERROR_RE);

    // Expansion preserves the old producer and old Task variants: readers first.
    write(producerPath, "old Task producer\n");
    write(
      schemaPath,
      before.replace(
        '  "center_agent_update",',
        '  "center_agent_update",\n  "new_kind",'
      )
    );
    assert.deepEqual(plan(), {
      profile: "remote-agent-and-inbox-receivers-first",
      order: ["db", "remote-agent", "auth", "web", "gateway", "core", "cli"],
    });
    // An immutable release must not borrow the current checkout's different contract.
    assert.deepEqual(plan(undefined, retirementSha), {
      profile: "remote-agent-and-inbox-task-retirement-first",
      order: ["db", "remote-agent", "core", "auth", "gateway", "web", "cli"],
    });

    // Deleting only the client contract cannot certify retirement of its writer.
    write(schemaPath, after);
    assert.match(plan().error, INBOX_RETIREMENT_PRODUCER_ERROR_RE);
  } finally {
    rmSync(repositoryPath, { recursive: true, force: true });
  }
});

test("fails closed when a combined receiver-first release omits Remote Agent", () => {
  const changedPaths = [
    "packages/schemas/src/schemas/http/inbox.ts",
    "packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts",
    "services/core/src/remote-agent/application/native-delivery-inbox-producer.ts",
    "services/core/src/remote-agent/application/remote-agent-worker-admission.ts",
    "services/remote-agent/.flue/agents/center-agent.ts",
  ];

  assertReceiptGatedStage(["web", "gateway", "core"], changedPaths, {
    sourceSha: REMOTE_SOURCE_SHA,
    ...historicalInboxTargetSource,
  });
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
    ...historicalInboxTargetSource,
  });

  assert.equal(plan.deployOrderProfile, "inbox-source-target-receiver-first");
  assert.deepEqual(
    plan.deploySteps.map((step) => step.label),
    [
      "Deploy Web",
      "Verify Web health",
      "Deploy Gateway Worker",
      "Verify Gateway Worker health",
      "Deploy Core with the current published CLI projection",
      "Verify Core receiver stable identity alignment",
      "Deploy Remote Agent Worker",
      "Verify Remote Agent deployment is visible",
    ]
  );
});

test("installs device-wait receivers before browser callers and Service publication", () => {
  const changedPaths = [
    "packages/schemas/src/schemas/protocol/wake-device-wait.ts",
    "services/core/src/space/transport/do/space.ts",
    "services/gateway/src/routes/rpc-http.signals.ts",
    "packages/schemas/src/schemas/daemon/runtime-transport.ts",
    "services/core/src/runtime-transport/transport/do/runtime-coordinator.ts",
    "clients/openmeld-cli/src/local-service/service-daemon.ts",
  ];
  const input = {
    affectedPackages: [],
    base: "previous-release",
    sourceSha: REMOTE_SOURCE_SHA,
    changedPaths,
  };
  const plan = buildProductionReleasePlan({
    ...input,
    scope: "db,auth,core,gateway,web,remote-agent,cli",
  });
  assert.equal(plan.deployOrderProfile, "device-wait-receivers-first");
  assert.deepEqual(plan.deployScopeOrder, [
    "db",
    "auth",
    "core",
    "gateway",
    "web",
    "remote-agent",
    "cli",
  ]);
  const staged = buildProductionReleasePlan({ ...input, scope: "core" });
  assert.equal(
    staged.deploySteps[0].args[0],
    "scripts/release/deploy-core-current-cli-projection.mjs"
  );
  assert.deepEqual(
    buildProductionPreflightStepSpecs({
      scopes: ["core"],
      changedPaths,
      releaseSha: REMOTE_SOURCE_SHA,
    }),
    buildCoreCurrentCliProjectionPreflightStepSpecs(
      changedPaths,
      REMOTE_SOURCE_SHA
    )
  );
  assert.throws(
    () =>
      buildProductionReleasePlan({
        ...input,
        scope: "cloud",
        changedPaths: [
          ...changedPaths,
          "services/remote-agent/.flue/cloudflare.ts",
        ],
      }),
    DEVICE_WAIT_ORDER_ERROR
  );
});

test("Desktop macOS A-to-B smoke parses thin before/after phases", () => {
  assert.deepEqual(parseSmokeArgs(["before", "0.1.4", "0.1.5"]), {
    phase: "before",
    currentVersion: "0.1.4",
    targetVersion: "0.1.5",
  });
  assert.deepEqual(parseSmokeArgs(["after", "0.1.5"]), {
    phase: "after",
    targetVersion: "0.1.5",
  });
  assert.throws(
    () => parseSmokeArgs(["before", "0.1.5", "0.1.5"]),
    DESKTOP_SMOKE_NEWER_ERROR_RE
  );
  assert.throws(
    () => parseSmokeArgs(["before", "0.1", "0.1.5"]),
    DESKTOP_SMOKE_STABLE_ERROR_RE
  );
});

test("Desktop macOS A-to-B smoke compares stable versions numerically", () => {
  assert.equal(compareStableVersions("0.1.9", "0.1.10"), -1);
  assert.equal(compareStableVersions("0.2.0", "0.1.99"), 1);
  assert.equal(compareStableVersions("1.0.0", "1.0.0"), 0);
});

test("Desktop macOS A-to-B smoke requires the production Apple signing identity", () => {
  const valid = [
    "Identifier=sh.openmeld.desktop",
    "Authority=Developer ID Application: SOPHIAPRO PTE. LTD. (38FFHDPA3B)",
    "TeamIdentifier=38FFHDPA3B",
  ].join("\n");
  assert.doesNotThrow(() => assertProductionSignatureDetails(valid));
  assert.throws(
    () =>
      assertProductionSignatureDetails(
        valid.replace("TeamIdentifier=38FFHDPA3B", "TeamIdentifier=OTHER")
      ),
    DESKTOP_SMOKE_TEAM_ID_ERROR_RE
  );
});

test("Desktop macOS A-to-B smoke matches the production executable and requires restart", () => {
  const output = [
    "101 /bin/zsh",
    `202 ${PRODUCTION_EXECUTABLE}`,
    "303 /usr/bin/open /tmp/Other.app",
  ].join("\n");
  assert.deepEqual(productionProcessPids(output), [202]);
  assert.equal(processListHasProductionApp(output), true);
  assert.equal(
    processListHasProductionApp(
      "404 /Applications/OpenMeld Desktop.app/Contents/MacOS/OpenMeld\n"
    ),
    false
  );
  assert.doesNotThrow(() => assertProcessRestarted([101], [202]));
  assert.throws(
    () => assertProcessRestarted([101], [101]),
    DESKTOP_SMOKE_STILL_RUNNING_ERROR_RE
  );
  assert.throws(
    () => assertProcessRestarted([101], []),
    DESKTOP_SMOKE_NOT_RUNNING_ERROR_RE
  );
});

test("Desktop macOS A-to-B smoke validates bounded updater receipt evidence", () => {
  const receipt = parseInstallReceipt(
    [
      "state=application_started",
      "sourceVersion=0.1.4",
      "targetVersion=0.1.5",
      "sourceBundle=OpenMeld.app",
      "targetBundle=OpenMeld.app",
      "",
    ].join("\n")
  );
  assert.doesNotThrow(() => assertReceiptMatchesTarget(receipt, "0.1.5"));
  assert.throws(
    () =>
      assertReceiptMatchesTarget(
        { ...receipt, state: "install_requested" },
        "0.1.5"
      ),
    DESKTOP_SMOKE_APPLICATION_STARTED_ERROR_RE
  );
  assert.throws(
    () => assertReceiptMatchesTarget(receipt, "0.1.6"),
    DESKTOP_SMOKE_VERSION_MISMATCH_ERROR_RE
  );
  assert.throws(
    () =>
      parseInstallReceipt(
        [
          "state=application_started",
          "sourceVersion=0.1.4",
          "targetVersion=0.1.5",
          "sourceBundle=OpenMeld.app",
          "targetBundle=OpenMeld.app",
          "unexpected=user-content",
        ].join("\n")
      ),
    DESKTOP_SMOKE_MALFORMED_ERROR_RE
  );
});
