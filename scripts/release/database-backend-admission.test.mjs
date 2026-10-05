import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseJsoncObject } from "../../packages/db/src/tooling/parse-jsonc.ts";
import { readCutoverTarget } from "../../tooling/postgresql/remote-target.mjs";
import {
  admitPostgresqlProductRelease,
  assertHostedProductDatabaseReleaseSupported,
  restoreProductCrons,
  verifyHostedPostgresqlCliDatabase,
  verifyProductCrons,
  verifyProductHyperdrive,
} from "./database-backend-admission.mjs";
import {
  buildProductionDeployStepSpecs,
  buildProductionReleasePlan,
  parseProductionReleaseArgs,
} from "./production-release.mjs";

const CUTOVER_UNAVAILABLE_PATTERN =
  /PostgreSQL product cutover is unavailable/u;
const MISSING_COMMAND_PATTERN = /ENOENT|not found/u;
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/u;
const DEPLOYED_POSTGRESQL_CONTRACT_PATTERN = /deployed PostgreSQL contract/u;

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

test("hosted CLI reuses only the deployed PostgreSQL contract and current live services", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "hosted-pg-cli-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  try {
    for (const name of [
      "release/database-backend.json",
      "packages/db/postgresql",
      "tooling/postgresql/resources.json",
      "tooling/postgresql/database.mjs",
      "tooling/postgresql/remote-target.mjs",
      "tooling/postgresql/cutover.mjs",
      "services/auth/wrangler.jsonc",
      "services/core/wrangler.jsonc",
    ]) {
      mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
      cpSync(path.join(root, name), path.join(cwd, name), { recursive: true });
    }
    git("init", "--quiet");
    git("add", ".");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--quiet",
      "-m",
      "Applied PostgreSQL contract"
    );
    const deployedSha = git("rev-parse", "HEAD");
    const receipts = new Map(
      ["db", "auth", "core"].map((scope) => [
        scope,
        {
          sha: deployedSha,
          receipt: {
            status: "verified",
            identity:
              scope === "db"
                ? { kind: "release-source" }
                : {
                    kind: "worker-deployment",
                    sourceSha: deployedSha,
                    workerName: `openmeld-${scope}-prod`,
                  },
          },
        },
      ])
    );
    const input = {
      root: cwd,
      sourceSha: deployedSha,
      readReceipts: () => receipts,
      verifyDeployment: () => Promise.resolve(),
      verifyHyperdrive: () => Promise.resolve(),
      verifyCrons: () => Promise.resolve(),
    };
    assert.equal(
      (await verifyHostedPostgresqlCliDatabase(input)).status,
      "current"
    );
    for (const scope of ["db", "auth", "core"]) {
      const saved = receipts.get(scope);
      receipts.delete(scope);
      await assert.rejects(verifyHostedPostgresqlCliDatabase(input), {
        message:
          scope === "db"
            ? "Hosted CLI requires a verified PostgreSQL database release. Complete the guarded local database release first."
            : `PostgreSQL ${scope} has no verified active deployment receipt. Complete or recover its guarded release before continuing.`,
      });
      receipts.set(scope, {
        ...saved,
        receipt: { ...saved.receipt, status: "failed" },
      });
      await assert.rejects(verifyHostedPostgresqlCliDatabase(input));
      receipts.set(scope, saved);
    }
    for (const guard of [
      "verifyDeployment",
      "verifyHyperdrive",
      "verifyCrons",
    ]) {
      await assert.rejects(
        verifyHostedPostgresqlCliDatabase({
          ...input,
          [guard]: () => Promise.reject(new Error(`Changed ${guard}`)),
        }),
        { message: `Changed ${guard}` }
      );
    }
    // A real Git change to native migration input must not be mistaken for a
    // publication-only release, even when all earlier receipts remain green.
    writeFileSync(
      path.join(cwd, "packages/db/postgresql/migrations/9999_pending.sql"),
      "CREATE TABLE pending_release (id bigint);\n"
    );
    git("add", ".");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--quiet",
      "-m",
      "Pending native migration"
    );
    await assert.rejects(
      verifyHostedPostgresqlCliDatabase({
        ...input,
        sourceSha: git("rev-parse", "HEAD"),
      }),
      DEPLOYED_POSTGRESQL_CONTRACT_PATTERN
    );
    // Applying an additive migration does not change either deployed Worker.
    // Only the database receipt advances; active Worker identity and bindings
    // still pass through their independent live admission checks.
    const migratedSha = git("rev-parse", "HEAD");
    receipts.set("db", { ...receipts.get("db"), sha: migratedSha });
    assert.equal(
      (
        await verifyHostedPostgresqlCliDatabase({
          ...input,
          sourceSha: migratedSha,
        })
      ).status,
      "current"
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
test("the PostgreSQL candidate blocks unsupported release lanes before external commands", () => {
  assert.doesNotThrow(() =>
    assertHostedProductDatabaseReleaseSupported(root, [
      "web",
      "website",
      "gateway",
      "remote-agent",
    ])
  );
  for (const args of [
    ["scripts/release/production-db.mjs"],
    ["scripts/release/staging-release.mjs", "deploy"],
    [
      "scripts/release/hosted-production-preflight.mjs",
      "--release-source",
      root,
      "--release-sha",
      "a".repeat(40),
      "--scope",
      "auth",
    ],
  ]) {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env: { ...process.env, PATH: "" },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, CUTOVER_UNAVAILABLE_PATTERN);
    assert.doesNotMatch(result.stderr, MISSING_COMMAND_PATTERN);
  }
});

test("cutover preparation reports the native target without executable promotion or acceptance", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/release/production-release.mjs",
      "plan",
      "--database-cutover",
      "--base",
      "HEAD",
      "--json",
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        POSTGRESQL_OPENMELD_MIGRATION_URL: "must-not-connect",
        POSTGRESQL_OPENMELD_RUNTIME_URL: "must-not-connect",
      },
    }
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.databaseCutover.mode, "preparation_only");
  assert.equal(plan.databaseCutover.target.backend, "postgresql");
  assert.equal(plan.databaseCutover.target.majorVersion, "18");
  assert.equal(
    plan.databaseCutover.target.database,
    "openmeld-postgresql-prod"
  );
  assert.equal(plan.databaseCutover.promotionAllowed, false);
  assert.equal(
    plan.databaseCutover.executor,
    "production-release.mjs deploy --database-cutover-snapshot <snapshot>"
  );
  assert.equal(plan.databaseCutover.evidenceStatus, "not_evaluated");
  assert.equal(plan.compatibilityEvidence.basis, "source_comparison_only");
  assert.equal(
    plan.compatibilityEvidence.deployedComponentReceipts,
    "not_inspected"
  );
  assert.ok(plan.databaseCutover.nativeMigrations.length > 0);
  for (const migration of plan.databaseCutover.nativeMigrations) {
    assert.match(migration.checksum, CHECKSUM_PATTERN);
  }
  assert.deepEqual(plan.deploySteps, []);
  assert.deepEqual(plan.preflightSteps, []);
  assert.deepEqual(plan.verifySteps, []);
  assert.deepEqual(plan.deployScopeOrder, []);
  for (const scope of [
    "db",
    "auth",
    "core",
    "gateway",
    "web",
    "remote-agent",
  ]) {
    assert.ok(plan.coordinatedScopeReview.includes(scope));
  }
});

const cutoverScopes = ["db", "auth", "core"];
const coordinationRequired = /coordinated db,auth,core/u;
const activeDeploymentRequired = /no verified active deployment receipt/u;
const hyperdriveMismatch = /Hyperdrive target/u;
const cutoverOptionError = /cutover snapshot applies only/u;
const cronMismatch = /Cron configuration differs/u;
const restorationMismatch = /Cron restoration requires/u;

test("local PostgreSQL health recovery requires the selected exact source and every active-service check", async () => {
  const sourceSha = "a".repeat(40);
  const receipts = new Map(
    ["auth", "core"].map((scope) => [
      scope,
      {
        sha: sourceSha,
        receipt: {
          attemptId: "00000000-0000-4000-8000-000000000001",
          componentIndex: 0,
          operationKey: "b".repeat(64),
          startedAt: "2026-10-05T10:00:00.000Z",
          status: "verified",
          application: "applied",
          identity: {
            kind: "worker-deployment",
            sourceSha,
            workerName: `openmeld-${scope}-prod`,
            environment: "prod",
            deploymentId: `${scope}-deployment`,
            versionId: `${scope}-version`,
            proof: "command-output",
          },
        },
      },
    ])
  );
  const checks = [];
  const input = {
    root,
    sourceSha,
    readReceipts: () => receipts,
    readGitFile: (sha, name) => {
      assert.equal(sha, sourceSha);
      return readFileSync(path.join(root, name), "utf8");
    },
    verifyDeployment: ({ expected }) => checks.push(expected.workerName),
    verifyHyperdrive: () => checks.push("hyperdrive"),
    verifyCrons: ({ paused }) => {
      assert.equal(paused, false);
      checks.push("crons");
    },
    runData: () => {
      throw new Error("recovery must not import or migrate data");
    },
  };
  for (const scope of ["auth", "core"]) {
    const saved = receipts.get(scope);
    for (const status of ["applied", "failed"]) {
      const retained = { ...saved, receipt: { ...saved.receipt, status } };
      receipts.set(scope, retained);
      checks.length = 0;
      assert.deepEqual(
        await admitPostgresqlProductRelease({ ...input, scopes: [scope] }),
        {
          mode: "native_postgresql_release",
        }
      );
      assert.deepEqual(checks, [
        "openmeld-auth-prod",
        "openmeld-core-prod",
        "hyperdrive",
        "crons",
      ]);
      assert.deepEqual(
        receipts.get(scope),
        retained,
        "database admission cannot promote the receipt"
      );
    }
    receipts.set(scope, saved);
  }
  const core = receipts.get("core");
  receipts.set("core", {
    ...core,
    receipt: { ...core.receipt, status: "failed" },
  });
  const recovery = { ...input, scopes: ["core"] };
  for (const denied of [
    { scopes: ["web"] },
    { scopes: ["auth"] },
    { sourceSha: "c".repeat(40) },
    { restoreCrons: true },
  ]) {
    await assert.rejects(
      admitPostgresqlProductRelease({ ...recovery, ...denied }),
      activeDeploymentRequired
    );
  }
  for (const receipt of [
    {
      ...core.receipt,
      status: "failed",
      application: "unknown",
      identity: undefined,
    },
    { ...core.receipt, status: "failed", operationKey: undefined },
    {
      ...core.receipt,
      status: "failed",
      identity: { ...core.receipt.identity, workerName: "openmeld-auth-prod" },
    },
  ]) {
    receipts.set("core", { ...core, receipt });
    await assert.rejects(
      admitPostgresqlProductRelease(recovery),
      activeDeploymentRequired
    );
  }
  receipts.set("core", {
    ...core,
    receipt: { ...core.receipt, status: "failed" },
  });
  for (const guard of ["verifyDeployment", "verifyHyperdrive", "verifyCrons"]) {
    await assert.rejects(
      admitPostgresqlProductRelease({
        ...recovery,
        [guard]: () => {
          throw new Error(`Changed ${guard}`);
        },
      }),
      { message: `Changed ${guard}` }
    );
  }
  await assert.rejects(
    admitPostgresqlProductRelease({
      ...recovery,
      readGitFile: () =>
        JSON.stringify({
          env: {
            prod: {
              hyperdrive: [
                { binding: "OPENMELD_POSTGRESQL", id: "wrong-target" },
              ],
            },
          },
        }),
    }),
    {
      message:
        "Auth and Core must use only the registered PostgreSQL Hyperdrive binding",
    }
  );
});

test("cutover admission reads committed import and full reconciliation between two frozen-source checks", async () => {
  const calls = [];
  const input = {
    root,
    scopes: cutoverScopes,
    snapshot: "/private/capture.sqlite",
    readSnapshot: () => ({ maintenance: { maintenanceId: "frozen-window" } }),
    runData: (args) => {
      calls.push(args);
      return { importId: "committed-import", snapshotSha256: "a".repeat(64) };
    },
    verifyHyperdrive: () => calls.push(["hyperdrive"]),
    verifyCrons: () => calls.push(["crons-paused"]),
  };
  const result = await admitPostgresqlProductRelease(input);
  assert.equal(result.importId, "committed-import");
  assert.deepEqual(calls, [
    ["inspect-barrier", "frozen-window"],
    ["completion", input.snapshot],
    ["reconcile", input.snapshot],
    ["verify"],
    ["hyperdrive"],
    ["crons-paused"],
    ["inspect-barrier", "frozen-window"],
  ]);
  for (const failure of [
    "inspect-barrier",
    "completion",
    "reconcile",
    "verify",
  ]) {
    await assert.rejects(
      admitPostgresqlProductRelease({
        ...input,
        runData: (args) => {
          if (args[0] === failure) {
            throw new Error(`blocked ${failure}`);
          }
          return { importId: "committed-import" };
        },
      }),
      { message: `blocked ${failure}` }
    );
  }
  await assert.rejects(
    admitPostgresqlProductRelease({ ...input, scopes: ["core"] }),
    coordinationRequired
  );
  await assert.rejects(
    admitPostgresqlProductRelease({
      root,
      scopes: ["core"],
      readReceipts: () => new Map(),
    }),
    activeDeploymentRequired
  );
});

test("guarded cutover uses native verification and never schedules legacy D1 migration", () => {
  const options = parseProductionReleaseArgs([
    "deploy",
    "--scope",
    "db,auth,core",
    "--database-cutover-snapshot",
    "/capture.sqlite",
  ]);
  const steps = buildProductionDeployStepSpecs(cutoverScopes, {
    databaseBackend: "postgresql",
    databaseCutoverSnapshot: options.databaseCutoverSnapshot,
  });
  assert.deepEqual(
    steps.filter((step) => step.releaseScope === "db").map(({ args }) => args),
    [["tooling/postgresql/cutover.mjs", "verify"]]
  );
  assert.equal(
    steps.some(({ args }) => args?.includes("db:release:prod")),
    false
  );
  for (const command of ["plan", "verify"]) {
    assert.throws(
      () =>
        parseProductionReleaseArgs([
          command,
          "--database-cutover-snapshot",
          "/capture.sqlite",
        ]),
      cutoverOptionError
    );
  }
});

test("Hyperdrive inspection rejects cache, target and runtime role drift", async () => {
  const registered = await readCutoverTarget();
  const previous = process.env.CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN;
  process.env.CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN = "synthetic";
  // Cloudflare Hyperdrive configuration API fields, also observed in the
  // isolated probe. https://developers.cloudflare.com/api/resources/hyperdrive/subresources/configs/methods/get/
  const configuration = {
    id: registered.hyperdriveId,
    caching: { disabled: true },
    origin: {
      scheme: "postgres",
      host: registered.target.host,
      port: 5432,
      database: "postgres",
      user: `${registered.runtimeRole}.${registered.target.branchId}`,
    },
  };
  try {
    await verifyProductHyperdrive(registered, () =>
      Response.json({ success: true, result: configuration })
    );
    for (const change of [
      { caching: { disabled: false } },
      { origin: { ...configuration.origin, host: "wrong.pg.psdb.cloud" } },
      { origin: { ...configuration.origin, user: "migration-role" } },
    ]) {
      await assert.rejects(
        verifyProductHyperdrive(registered, () =>
          Response.json({
            success: true,
            result: { ...configuration, ...change },
          })
        ),
        hyperdriveMismatch
      );
    }
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(
        process.env,
        "CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN"
      );
    } else {
      process.env.CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN = previous;
    }
  }
});

test("ordinary PostgreSQL releases cannot resume paused crons and explicit restoration requires the exact deployed candidate", async () => {
  const sourceSha = "a".repeat(40);
  const planInput = {
    base: "previous-release",
    sourceSha,
    scope: "auth,core",
    changedPaths: ["services/core/src/index.ts"],
    affectedPackages: [],
    databaseBackend: "postgresql",
  };
  const ordinary = buildProductionReleasePlan(planInput);
  assert.ok(
    ordinary.preflightSteps.some((step) =>
      step.args.includes("--channel-sync-check")
    )
  );
  const restoration = buildProductionReleasePlan({
    ...planInput,
    databaseCutoverRestoreCrons: true,
  });
  assert.deepEqual(
    restoration.preflightSteps.map((step) => step.controlPath),
    [
      "scripts/cloudflare/verify-worker-env-contract.mjs",
      "scripts/ci/check-retired-identifiers.sh",
    ]
  );
  const receipts = new Map(
    ["auth", "core"].map((scope) => [
      scope,
      {
        sha: sourceSha,
        receipt: {
          status: "verified",
          identity: {
            kind: "worker-deployment",
            sourceSha,
            workerName: `openmeld-${scope}-prod`,
          },
        },
      },
    ])
  );
  const input = {
    root,
    sourceSha,
    scopes: ["auth", "core"],
    readReceipts: () => receipts,
    readGitFile: (_, name) => readFileSync(path.join(root, name), "utf8"),
    verifyDeployment: () => undefined,
    verifyHyperdrive: () => undefined,
    verifyCrons: ({ paused }) => {
      assert.equal(paused, false);
      throw new Error(
        "Cron configuration differs from the requested maintenance state"
      );
    },
  };
  await assert.rejects(admitPostgresqlProductRelease(input), cronMismatch);
  assert.equal(
    (await admitPostgresqlProductRelease({ ...input, restoreCrons: true }))
      .mode,
    "native_postgresql_release"
  );
  await assert.rejects(
    admitPostgresqlProductRelease({
      ...input,
      restoreCrons: true,
      sourceSha: "b".repeat(40),
    }),
    restorationMismatch
  );
  await assert.rejects(
    admitPostgresqlProductRelease({
      ...input,
      restoreCrons: true,
      verifyDeployment: () => {
        throw new Error("Active Worker differs from its receipt");
      },
    }),
    { message: "Active Worker differs from its receipt" }
  );
});

test("explicit Cron restoration uses the accepted source and fails when platform readback remains paused", async () => {
  const registered = await readCutoverTarget();
  const previous = process.env.CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN;
  process.env.CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN = "synthetic";
  let restored = false;
  const visited = [];
  // Official Worker Schedules response. Removing schedules is not proof that
  // previously scheduled executions have stopped.
  // https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/get/
  const request = (url) => {
    const scope = url.includes("openmeld-auth-prod") ? "auth" : "core";
    visited.push(scope);
    const config = parseJsoncObject(
      readFileSync(path.join(root, `services/${scope}/wrangler.jsonc`), "utf8")
    );
    return Response.json({
      success: true,
      result: {
        schedules: restored
          ? config.env.prod.triggers.crons.map((cron) => ({ cron }))
          : [],
      },
    });
  };
  const commands = [];
  const restore = () =>
    restoreProductCrons({
      root,
      runData: (args) => assert.deepEqual(args, ["verify"]),
      runStep: (step) => commands.push(step.args),
      verifyCrons: (input) => verifyProductCrons({ ...input, request }),
    });
  try {
    await verifyProductCrons({ root, registered, paused: true, request });
    await assert.rejects(restore(), cronMismatch);
    assert.deepEqual(
      commands,
      ["auth", "core"].map((scope) => [
        "exec",
        "wrangler",
        "triggers",
        "deploy",
        "--config",
        `services/${scope}/wrangler.jsonc`,
        "--env",
        "prod",
      ])
    );
    restored = true;
    visited.length = 0;
    await restore();
    assert.deepEqual(visited, ["auth", "core"]);
    await assert.rejects(
      verifyProductCrons({ root, registered, paused: true, request }),
      cronMismatch
    );
    assert.equal(
      parseProductionReleaseArgs([
        "deploy",
        "--scope",
        "auth,core",
        "--database-cutover-restore-crons",
      ]).databaseCutoverRestoreCrons,
      true
    );
    assert.throws(
      () =>
        parseProductionReleaseArgs([
          "deploy",
          "--scope",
          "core",
          "--database-cutover-restore-crons",
        ]),
      restorationMismatch
    );
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(
        process.env,
        "CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN"
      );
    } else {
      process.env.CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN = previous;
    }
  }
});
