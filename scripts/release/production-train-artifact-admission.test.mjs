import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import {
  admitProductionTrainArtifacts,
  PRODUCTION_TRAIN_SCOPES_ENV,
  resolveProductionTrain,
} from "./production-train-artifact-admission.mjs";

const runProductionTrainAdmission = admitProductionTrainArtifacts;

import {
  artifactInputIdentity,
  artifactOutputIdentity,
  checkProductionArtifact,
  saveArtifactSnapshot,
} from "./production-artifact-check.mjs";
import { runProductionDbRelease } from "./production-db.mjs";
import {
  admissionIdentity,
  PARENT_ADMISSION_ENV,
} from "./production-train-admission-evidence.mjs";

const SOURCE_SHA = "a".repeat(40);
const OUTSIDE_TRAIN_RE = /outside the declared train: cli/u;
const SSR_FAILED_RE = /Workerd SSR failed/u;
const CHECKOUT_CHANGED_RE = /checkout changed/u;
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

test("requires an explicit train and uses the release plan source and scopes", () => {
  assert.throws(
    () =>
      resolveProductionTrain({
        env: {},
        selectedScopes: "db",
        sourceSha: SOURCE_SHA,
      }),
    new RegExp(PRODUCTION_TRAIN_SCOPES_ENV, "u")
  );
  const calls = [];
  assert.deepEqual(
    resolveProductionTrain(
      {
        env: { [PRODUCTION_TRAIN_SCOPES_ENV]: "db,cli,web" },
        selectedScopes: "db",
        sourceSha: SOURCE_SHA,
      },
      {
        buildPlan: (input) => {
          calls.push(input);
          return { scopes: ["db", "cli", "web"], sourceSha: SOURCE_SHA };
        },
      }
    ),
    {
      artifactScopes: ["cli", "web"],
      productionScopes: ["db", "cli", "web"],
      scopes: ["db", "cli", "web"],
      selectedScopes: ["db"],
      sourceSha: SOURCE_SHA,
    }
  );
  assert.deepEqual(calls, [
    {
      affectedPackages: [],
      changedPaths: [],
      scope: "db,cli,web",
      sourceSha: SOURCE_SHA,
    },
  ]);
});

test("rejects an entry scope outside the declared train", () => {
  assert.throws(
    () =>
      resolveProductionTrain({
        env: { [PRODUCTION_TRAIN_SCOPES_ENV]: "db" },
        selectedScopes: "cli",
        sourceSha: SOURCE_SHA,
      }),
    OUTSIDE_TRAIN_RE
  );
});

test("checks selected CLI, Desktop, then Web artifacts and skips all for a backend-only train", async () => {
  const checks = [];
  const dependencies = {
    buildPlan: ({ scope, sourceSha }) => ({
      scopes: scope.split(","),
      sourceSha,
    }),
    checkArtifact: (input) => checks.push(input),
    checkNpmArtifact: (input) => checks.push(input),
    readHeadSha: () => SOURCE_SHA,
  };
  assert.deepEqual(
    await admitProductionTrainArtifacts(
      {
        env: { [PRODUCTION_TRAIN_SCOPES_ENV]: "db" },
        root: "/release",
        selectedScopes: "db",
        sourceSha: SOURCE_SHA,
      },
      dependencies
    ),
    {
      artifactScopes: [],
      artifacts: {
        cli: "not_required",
        desktop: "not_required",
        web: "not_required",
      },
      productionScopes: ["db"],
      scopes: ["db"],
      selectedScopes: ["db"],
      sourceSha: SOURCE_SHA,
    }
  );
  assert.deepEqual(checks, []);

  assert.deepEqual(
    await admitProductionTrainArtifacts(
      {
        env: { [PRODUCTION_TRAIN_SCOPES_ENV]: "db,cli,web,desktop" },
        root: "/release",
        selectedScopes: "cli",
        sourceSha: SOURCE_SHA,
      },
      dependencies
    ),
    {
      artifactScopes: ["cli", "desktop", "web"],
      artifacts: { cli: "verified", desktop: "verified", web: "verified" },
      productionScopes: ["db", "cli", "web"],
      scopes: ["db", "cli", "web", "desktop"],
      selectedScopes: ["cli"],
      sourceSha: SOURCE_SHA,
    }
  );
  assert.deepEqual(checks, [
    {
      cwd: "/release",
      env: { [PRODUCTION_TRAIN_SCOPES_ENV]: "db,cli,web,desktop" },
      sourceSha: SOURCE_SHA,
    },
    { root: "/release", scope: "desktop", sourceSha: SOURCE_SHA },
    { root: "/release", scope: "web", sourceSha: SOURCE_SHA },
  ]);
});

test("the CLI admits an explicit selected scope at the checked-out source", () => {
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  const result = spawnSync(
    process.execPath,
    [
      "scripts/release/production-train-artifact-admission.mjs",
      "--source-sha",
      sourceSha,
      "--scope",
      "db",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        [PRODUCTION_TRAIN_SCOPES_ENV]: "db",
      },
    }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    artifactScopes: [],
    artifacts: {
      cli: "not_required",
      desktop: "not_required",
      web: "not_required",
    },
    productionScopes: ["db"],
    scopes: ["db"],
    selectedScopes: ["db"],
    sourceSha,
  });
});

async function coordinatedFixture() {
  // These fixtures hash tiny synthetic artifacts; CI's own Node heap is not a
  // renderer budget. Isolate both process.env consumers and spawned commands.
  const resourceEnv = {
    NODE_OPTIONS: "--max-old-space-size=512",
    OPENMELD_RENDERER_NODE_HEAP_MB: "512",
    OPENMELD_LOCAL_HEAVY_GIB: "1.5",
    OPENMELD_LOCAL_MEMORY_HEADROOM_GIB: "1",
  };
  const previousEnv = Object.fromEntries(
    Object.keys(resourceEnv).map((key) => [key, process.env[key]])
  );
  after(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  });
  Object.assign(process.env, resourceEnv);
  const root = await mkdtemp(path.join(tmpdir(), "train-admission-"));
  after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "--quiet");
  await mkdir(path.join(root, "clients/web"), { recursive: true });
  await writeFile(
    path.join(root, ".gitignore"),
    "dev-tmp/\nclients/web/dist/\nclients/web/.wrangler/\n"
  );
  await writeFile(
    path.join(root, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\n"
  );
  await writeFile(path.join(root, "clients/web/package.json"), "{}\n");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--quiet",
    "-m",
    "fixture"
  );
  const controlSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  const input = {
    root,
    sourceSha: git("rev-parse", "HEAD"),
    selectedScopes: "full",
    env: {
      ...process.env,
      GITHUB_REPOSITORY: "amplifthq/openmeld",
      GITHUB_WORKFLOW_REF:
        "amplifthq/openmeld/.github/workflows/release-on-main.yml@refs/heads/main",
      GITHUB_WORKFLOW_SHA: controlSha,
      GITHUB_SHA: controlSha,
      GITHUB_REF: "refs/heads/main",
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_JOB: "validate_release_source",
      GITHUB_RUN_ID: "1234",
      GITHUB_RUN_ATTEMPT: "1",
      [PRODUCTION_TRAIN_SCOPES_ENV]:
        "db,auth,cli,web,gateway,core,remote-agent,desktop",
      [PARENT_ADMISSION_ENV]: "",
      OPENMELD_PARENT_WEB_ARTIFACT_ID: "123",
    },
  };
  const checks = [];
  const dependencies = {
    checkNpmArtifact: () => {
      checks.push("cli");
      return {
        artifact: {
          integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
        },
      };
    },
    checkArtifact: async ({ scope, sourceSha }) => {
      checks.push(scope);
      const webRoot = path.join(root, "clients/web");
      await mkdir(path.join(webRoot, "dist"), { recursive: true });
      await mkdir(path.join(webRoot, ".wrangler/deploy"), { recursive: true });
      await writeFile(path.join(webRoot, "dist/index.js"), `bundle-${scope}`);
      await writeFile(path.join(webRoot, ".wrangler/deploy/config.json"), "{}");
      const identity = await artifactInputIdentity(root, scope, sourceSha);
      const artifactSha256 = await artifactOutputIdentity(webRoot);
      const receiptPath = path.join(
        root,
        "dev-tmp/release-artifact-check",
        `${scope}.json`
      );
      await saveArtifactSnapshot({
        receiptPath,
        webRoot,
        scope,
        identity,
        artifactSha256,
      });
      const receipt = {
        scope,
        sourceSha,
        inputIdentity: identity,
        artifactSha256,
        allowDirty: false,
        runtime: "local-workerd-disposable-cookie-key",
        ssr: { buildId: "fixture-build" },
      };
      await writeFile(receiptPath, JSON.stringify(receipt));
      // Match Vite 7 preview's documented source behavior in resolveConfig:
      // it initializes process.env.NODE_ENV when unset.
      process.env.NODE_ENV ??= "production";
      return receipt;
    },
  };
  const parent = await runProductionTrainAdmission(
    { ...input, issueParentEvidence: true },
    dependencies
  );
  input.env[PARENT_ADMISSION_ENV] = JSON.stringify(parent.parentEvidence);
  input.env.GITHUB_JOB = "deploy";
  return { input, parent, dependencies, checks };
}

test("one coordinated full train admits each artifact once and every child verifies without rebuilding", async () => {
  const { input, checks, dependencies } = await coordinatedFixture();
  assert.deepEqual(checks, ["cli", "desktop", "web"]);
  for (const scope of [
    "db",
    "core",
    "web",
    "auth",
    "gateway",
    "remote-agent",
  ]) {
    const result = await runProductionTrainAdmission(
      { ...input, selectedScopes: scope },
      dependencies
    );
    assert.equal(result.parentEvidenceVerified, true, scope);
  }
  assert.deepEqual(checks, ["cli", "desktop", "web"]);

  // The DB entrypoint has its own admission; exercise it before any DB command.
  const dbSteps = [];
  await runProductionDbRelease({
    cwd: input.root,
    env: input.env,
    adapters: {
      admitTrainArtifacts: (request) =>
        admitProductionTrainArtifacts(request, dependencies),
      runStep: (step) => dbSteps.push(step.label),
      runCommand: () => ({
        status: 0,
        stdout: "No migrations to apply!",
        stderr: "",
      }),
    },
    write: () => undefined,
  });
  assert.ok(dbSteps.includes("Verify the production database contract"));
  assert.deepEqual(checks, ["cli", "desktop", "web"]);

  // Exercise the command/output boundary without any build or mutation.
  const evidenceOutput = path.join(input.root, "dev-tmp/admission-output");
  const cliArgs = [
    path.join(
      REPO_ROOT,
      "scripts/release/production-train-artifact-admission.mjs"
    ),
    "--source-sha",
    input.sourceSha,
    "--scope",
    "db",
  ];
  const cliEnv = {
    ...input.env,
    [PARENT_ADMISSION_ENV]: "",
    [PRODUCTION_TRAIN_SCOPES_ENV]: "db",
    GITHUB_JOB: "validate_release_source",
    GITHUB_OUTPUT: evidenceOutput,
  };
  const issued = spawnSync(
    process.execPath,
    [...cliArgs, "--issue-parent-evidence"],
    { cwd: input.root, env: cliEnv, encoding: "utf8" }
  );
  assert.equal(issued.status, 0, issued.stderr);
  const output = await readFile(evidenceOutput, "utf8");
  const evidenceJson = output.split("\n")[0].split("=").slice(1).join("=");
  const verified = spawnSync(process.execPath, cliArgs, {
    cwd: input.root,
    env: {
      ...cliEnv,
      GITHUB_JOB: "deploy",
      [PARENT_ADMISSION_ENV]: evidenceJson,
    },
    encoding: "utf8",
  });
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).parentEvidenceVerified, true);

  // The Web child starts without live output, just like a separate runner.
  const webRoot = path.join(input.root, "clients/web");
  await rm(path.join(webRoot, "dist"), { recursive: true });
  await rm(path.join(webRoot, ".wrangler"), { recursive: true });
  await runProductionTrainAdmission(
    { ...input, selectedScopes: "web", restoreWebArtifact: true },
    dependencies
  );
  assert.equal(
    await readFile(path.join(webRoot, "dist/index.js"), "utf8"),
    "bundle-web"
  );
  const preflight = await checkProductionArtifact({
    root: input.root,
    scope: "web",
    sourceSha: input.sourceSha,
  });
  assert.equal(preflight.reused, true);
  assert.deepEqual(checks, ["cli", "desktop", "web"]);

  // Standalone callers still perform the entire declared train admission.
  const standalone = await runProductionTrainAdmission(
    {
      ...input,
      selectedScopes: "core",
      env: {
        ...input.env,
        GITHUB_WORKFLOW_REF:
          "amplifthq/openmeld/.github/workflows/standalone.yml@refs/heads/main",
        [PARENT_ADMISSION_ENV]: "",
      },
    },
    dependencies
  );
  assert.equal(standalone.parentEvidenceVerified, undefined);
  assert.deepEqual(checks, ["cli", "desktop", "web", "cli", "desktop", "web"]);
});

test("parent evidence fails closed on source, control, train, artifact, input, and same-run identity mismatches", async () => {
  const { input, parent, checks, dependencies } = await coordinatedFixture();
  const mutations = [
    [
      "source SHA",
      (e) => {
        e.sourceSha = "b".repeat(40);
      },
    ],
    [
      "control SHA",
      (e) => {
        e.producer.controlSha = "b".repeat(40);
      },
    ],
    [
      "Node runtime drift",
      (e) => {
        e.buildInputs.node = "v24.999.0";
      },
    ],
    [
      "workflow",
      (e) => {
        e.producer.workflowRef = "another-workflow";
      },
    ],
    [
      "repository",
      (e) => {
        e.producer.repository = "another/repo";
      },
    ],
    [
      "run",
      (e) => {
        e.producer.runId = "9999";
      },
    ],
    [
      "attempt",
      (e) => {
        e.producer.runAttempt = "2";
      },
    ],
    [
      "job",
      (e) => {
        e.producer.job = "deploy";
      },
    ],
    [
      "train",
      (e) => {
        e.scopes = ["core"];
      },
    ],
    [
      "artifact scopes",
      (e) => {
        e.artifactScopes = [];
      },
    ],
    [
      "missing artifact",
      (e) => {
        e.artifacts.pop();
      },
    ],
    [
      "duplicate artifact",
      (e) => {
        e.artifacts.push(e.artifacts[0]);
      },
    ],
    [
      "malformed hash",
      (e) => {
        e.artifacts[1].artifactSha256 = "invalid";
      },
    ],
    [
      "Workerd proof",
      (e) => {
        e.artifacts[1].runtime = "node";
      },
    ],
    [
      "build inputs",
      (e) => {
        e.buildInputs.lockSha256 = "b".repeat(64);
      },
    ],
    [
      "runtime",
      (e) => {
        e.buildInputs.node = "v20.0.0";
      },
    ],
  ];
  for (const [name, mutate] of mutations) {
    const evidence = structuredClone(parent.parentEvidence);
    mutate(evidence);
    await assert.rejects(
      runProductionTrainAdmission(
        {
          ...input,
          selectedScopes: "core",
          env: {
            ...input.env,
            [PARENT_ADMISSION_ENV]: JSON.stringify(evidence),
          },
        },
        dependencies
      ),
      undefined,
      name
    );
  }
  for (const value of ["", "{", "null", "{}"]) {
    await assert.rejects(
      runProductionTrainAdmission(
        {
          ...input,
          selectedScopes: "core",
          env: { ...input.env, [PARENT_ADMISSION_ENV]: value },
        },
        dependencies
      )
    );
  }
  for (const env of [
    { GITHUB_SHA: "b".repeat(40) },
    { GITHUB_WORKFLOW_SHA: "b".repeat(40) },
    {
      GITHUB_WORKFLOW_REF:
        "amplifthq/openmeld/.github/workflows/standalone.yml@refs/heads/main",
    },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { [PRODUCTION_TRAIN_SCOPES_ENV]: "cloud" },
  ]) {
    await assert.rejects(
      runProductionTrainAdmission(
        { ...input, selectedScopes: "core", env: { ...input.env, ...env } },
        dependencies
      )
    );
  }
  await assert.rejects(
    runProductionTrainAdmission(
      {
        ...input,
        selectedScopes: "web",
        env: { ...input.env, OPENMELD_PARENT_WEB_ARTIFACT_ID: "" },
      },
      dependencies
    )
  );
  assert.deepEqual(checks, ["cli", "desktop", "web"]);
});

test("Web handoff rejects missing or corrupt bytes and changed build inputs instead of rebuilding", async () => {
  const { input, parent, checks, dependencies } = await coordinatedFixture();
  const webInput = {
    ...input,
    selectedScopes: "web",
    restoreWebArtifact: true,
  };
  await assert.rejects(
    runProductionTrainAdmission(
      {
        ...webInput,
        env: { ...input.env, VITE_TEST_CHANGED_INPUT: "changed" },
      },
      dependencies
    )
  );
  const artifact = parent.parentEvidence.artifacts.find(
    ({ scope }) => scope === "web"
  );
  const bundle = path.join(
    input.root,
    "dev-tmp/release-artifact-check/artifacts/web",
    artifact.inputIdentity,
    "dist/index.js"
  );
  await writeFile(bundle, "corrupted");
  await assert.rejects(runProductionTrainAdmission(webInput, dependencies));
  await rm(bundle);
  await assert.rejects(runProductionTrainAdmission(webInput, dependencies));
  const receipt = path.join(
    input.root,
    "dev-tmp/release-artifact-check/web.json"
  );
  await writeFile(receipt, "{}");
  await assert.rejects(runProductionTrainAdmission(webInput, dependencies));
  await rm(receipt);
  await assert.rejects(runProductionTrainAdmission(webInput, dependencies));
  assert.deepEqual(checks, ["cli", "desktop", "web"]);
});

test("failed parent admission emits no reusable evidence and checks exact clean source again", async () => {
  const { input, dependencies } = await coordinatedFixture();
  const issuer = {
    ...input,
    issueParentEvidence: true,
    env: {
      ...input.env,
      GITHUB_JOB: "validate_release_source",
      [PARENT_ADMISSION_ENV]: "",
    },
  };
  await assert.rejects(
    runProductionTrainAdmission(issuer, {
      ...dependencies,
      checkArtifact: () => {
        throw new Error("Workerd SSR failed");
      },
    }),
    SSR_FAILED_RE
  );
  await writeFile(
    path.join(input.root, "clients/web/package.json"),
    '{"dirty":true}'
  );
  await assert.rejects(admissionIdentity(input), CHECKOUT_CHANGED_RE);
});
