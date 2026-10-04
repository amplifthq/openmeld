import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseJsoncObject } from "../../packages/db/src/tooling/parse-jsonc.ts";
import { readCutoverTarget } from "../../tooling/postgresql/remote-target.mjs";
import {
  admitPostgresqlProductRelease,
  assertHostedProductDatabaseReleaseSupported,
  restoreProductCrons,
  verifyProductCrons,
  verifyProductHyperdrive,
} from "./database-backend-admission.mjs";
import {
  buildProductionDeployStepSpecs,
  parseProductionReleaseArgs,
} from "./production-release.mjs";

const CUTOVER_UNAVAILABLE_PATTERN =
  /PostgreSQL product cutover is unavailable/u;
const MISSING_COMMAND_PATTERN = /ENOENT|not found/u;
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/u;

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
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
    ["scripts/release/hosted-cli-release.mjs"],
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
const initialCutoverRequired = /First PostgreSQL release/u;
const hyperdriveMismatch = /Hyperdrive target/u;
const cutoverOptionError = /cutover snapshot applies only/u;
const cronMismatch = /Cron configuration differs/u;
const restorationMismatch = /Cron restoration requires/u;

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
    initialCutoverRequired
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
