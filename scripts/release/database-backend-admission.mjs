import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseJsoncObject } from "../../packages/db/src/tooling/parse-jsonc.ts";
import { readCutoverTarget } from "../../tooling/postgresql/remote-target.mjs";
import { readGuardedLocalReleaseSources } from "./production-release-evidence.mjs";
import { describeGuardedReceiptRecoveryCandidate } from "./production-release-receipts.mjs";
import { verifyWorkerDeployment } from "./worker-deployment-evidence.mjs";

const EXACT_SHA_PATTERN = /^[a-f0-9]{40}$/u;

function readBackendManifest(root) {
  return JSON.parse(
    readFileSync(path.join(root, "release/database-backend.json"), "utf8")
  );
}

// Hosted Workers cannot perform the private maintenance-window cutover. The
// CLI publisher separately proves that PostgreSQL is already deployed.
export function assertHostedProductDatabaseReleaseSupported(root, scopes) {
  if (
    scopes.some((scope) => ["db", "auth", "core"].includes(scope)) &&
    existsSync(path.join(root, "release/database-backend.json")) &&
    readBackendManifest(root).backend === "postgresql"
  ) {
    throw new Error(
      "PostgreSQL product cutover is unavailable through hosted release commands. Use the guarded local release lane and its maintenance admission."
    );
  }
}

// Trusted release control installs only schema-parser dependencies. Native
// database drivers belong to the candidate's data operation, not module loading.
async function runCutoverDataCommand(args) {
  const owner = await import("../../tooling/postgresql/cutover.mjs");
  return owner.runCutoverDataCommand(args);
}

/** Legacy D1 and shared-staging commands cannot deploy this PostgreSQL candidate. */
export function assertProductDatabaseReleaseSupported(root = process.cwd()) {
  const manifest = readBackendManifest(root);
  if (manifest.backend === "postgresql") {
    throw new Error(
      "PostgreSQL product cutover is unavailable through legacy D1 or shared-staging commands. Use the guarded production release and its frozen import evidence."
    );
  }
  throw new Error(
    "Product database release support must be defined by the reviewed cutover control plane."
  );
}

export function assertPostgresqlProductBinding(config, registered) {
  const bindings = config.env?.prod?.hyperdrive;
  if (
    config.env?.prod?.d1_databases?.length ||
    bindings?.length !== 1 ||
    bindings[0].binding !== "OPENMELD_POSTGRESQL" ||
    bindings[0].id !== registered.hyperdriveId
  ) {
    throw new Error(
      "Auth and Core must use only the registered PostgreSQL Hyperdrive binding"
    );
  }
}

function requireCandidatePostgresqlBindings(root, registered) {
  for (const scope of ["auth", "core"]) {
    const config = parseJsoncObject(
      readFileSync(path.join(root, `services/${scope}/wrangler.jsonc`), "utf8")
    );
    assertPostgresqlProductBinding(config, registered);
  }
}

export async function verifyProductHyperdrive(
  registered,
  request = fetch,
  env = process.env
) {
  const token = env.CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN;
  if (!token) {
    throw new Error(
      "Missing scoped Cloudflare release token for Hyperdrive inspection"
    );
  }
  const response = await request(
    `https://api.cloudflare.com/client/v4/accounts/${registered.source.accountId}/hyperdrive/configs/${registered.hyperdriveId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
    }
  );
  if (!response.ok) {
    throw new Error(`Hyperdrive inspection failed (HTTP ${response.status})`);
  }
  const body = await response.json();
  const configuration = body?.result;
  if (
    body?.success !== true ||
    configuration?.id !== registered.hyperdriveId ||
    configuration.caching?.disabled !== true ||
    configuration.origin?.scheme !== "postgres" ||
    configuration.origin.host !== registered.target.host ||
    configuration.origin.port !== 5432 ||
    configuration.origin.database !== registered.target.database ||
    configuration.origin.user !==
      `${registered.runtimeRole}.${registered.target.branchId}`
  ) {
    throw new Error(
      "Hyperdrive target, runtime role or disabled-cache contract changed"
    );
  }
}

async function requireActivePostgresqlReceipts(input, registered) {
  const receipts = await (input.readReceipts ?? readGuardedLocalReleaseSources)(
    { cwd: input.root, gitEnvironment: input.gitEnvironment }
  );
  for (const scope of ["auth", "core"]) {
    const source = receipts.get(scope);
    const identity = source?.receipt?.identity;
    if (input.restoreCrons && source?.sha !== input.sourceSha) {
      throw new Error(
        "Cron restoration requires Auth and Core receipts for this exact candidate"
      );
    }
    if (
      !(
        source?.receipt?.status === "verified" ||
        (isSameSourceGuardedRecovery(source, input.sourceSha) &&
          ((input.hostedCli && scope === "core") ||
            (!(input.hostedCli || input.restoreCrons) &&
              input.scopes?.includes(scope))))
      ) ||
      identity?.kind !== "worker-deployment" ||
      identity.sourceSha !== source.sha ||
      identity.workerName !== `openmeld-${scope}-prod`
    ) {
      throw new Error(
        `PostgreSQL ${scope} has no verified active deployment receipt. Complete or recover its guarded release before continuing.`
      );
    }
    const file = `services/${scope}/wrangler.jsonc`;
    const content = (
      input.readGitFile ??
      ((sha, name) =>
        execFileSync("git", ["show", `${sha}:${name}`], {
          cwd: input.root,
          encoding: "utf8",
        }))
    )(source.sha, file);
    assertPostgresqlProductBinding(parseJsoncObject(content), registered);
    await (input.verifyDeployment ?? verifyWorkerDeployment)({
      cwd: input.root,
      sourceSha: source.sha,
      expected: identity,
      target: {
        workerName: identity.workerName,
        args: ["--config", file, "--env", "prod"],
      },
      env: input.env,
      runCommand: (command) =>
        spawnSync(command.command, command.args, {
          cwd: command.cwd,
          env: command.env,
          encoding: "utf8",
        }),
    });
  }
}

// Existing verified receipts prove which native database contract was applied.
// Hosted CLI publication can reuse that contract, but cannot migrate it or read
// private import data. Active Worker/Hyperdrive checks still run for every call.
export async function verifyHostedPostgresqlCliDatabase(input) {
  const root = input.root ?? process.cwd();
  if (readBackendManifest(root).backend !== "postgresql") {
    throw new Error(
      "Hosted PostgreSQL verification requires the PostgreSQL backend"
    );
  }
  const readObject = (sha, name) =>
    execFileSync("git", ["rev-parse", "--verify", `${sha}:${name}`], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  const sourceSha = input.sourceSha;
  if (!EXACT_SHA_PATTERN.test(sourceSha ?? "")) {
    throw new Error(
      "Hosted CLI database verification requires an exact source SHA"
    );
  }
  const receipts = await (input.readReceipts ?? readGuardedLocalReleaseSources)(
    {
      cwd: root,
      gitEnvironment: input.gitEnvironment,
    }
  );
  requireMatchingPostgresqlContract(receipts, sourceSha, readObject);
  const registered = await (input.readTarget ?? readCutoverTarget)();
  requireCandidatePostgresqlBindings(root, registered);
  const env = { ...(input.env ?? process.env) };
  for (const name of [
    "GH_TOKEN",
    "OPENMELD_TRUSTED_GIT_GITHUB_TOKEN",
    "OPENMELD_TRUSTED_GIT_GITHUB_SERVER_URL",
    "OPENMELD_PRODUCTION_LEASE_GITHUB_TOKEN",
    "OPENMELD_PRODUCTION_LEASE_GITHUB_SERVER_URL",
    "OPENMELD_PRODUCTION_LEASE_GITHUB_REPOSITORY",
  ]) {
    Reflect.deleteProperty(env, name);
  }
  await requireActivePostgresqlReceipts(
    { ...input, root, env, hostedCli: true, readReceipts: () => receipts },
    registered
  );
  await (input.verifyHyperdrive ?? verifyProductHyperdrive)(
    registered,
    fetch,
    env
  );
  await (input.verifyCrons ?? verifyProductCrons)({
    root,
    registered,
    paused: false,
    env,
  });
  return {
    status: "current",
    reason:
      "verified PostgreSQL database and active Worker releases match the CLI database contract",
  };
}

function requireMatchingPostgresqlContract(receipts, sourceSha, readObject) {
  const database = receipts.get("db");
  if (
    database?.receipt?.status !== "verified" ||
    database.receipt.identity?.kind !== "release-source"
  ) {
    throw new Error(
      "Hosted CLI requires a verified PostgreSQL database release. Complete the guarded local database release first."
    );
  }
  const contractPaths = [
    "release/database-backend.json",
    "packages/db/postgresql",
    "tooling/postgresql/resources.json",
    "tooling/postgresql/database.mjs",
    "tooling/postgresql/remote-target.mjs",
    "tooling/postgresql/cutover.mjs",
  ];
  for (const name of contractPaths) {
    if (readObject(database.sha, name) !== readObject(sourceSha, name)) {
      throw new Error(
        `Hosted CLI requires the deployed PostgreSQL contract: db differs at ${name}. Complete the guarded database release first.`
      );
    }
  }
}

function isSameSourceGuardedRecovery(source, sourceSha) {
  return (
    source?.sha === sourceSha &&
    describeGuardedReceiptRecoveryCandidate(source) !== null
  );
}

// Called under the existing production scope leases. The committed import row
// and existing Worker receipts remain the only completion/publication records.
export async function admitPostgresqlProductRelease(input) {
  const root = input.root ?? process.cwd();
  const registered = await (input.readTarget ?? readCutoverTarget)();
  requireCandidatePostgresqlBindings(root, registered);
  const runData = input.runData ?? runCutoverDataCommand;
  if (!input.snapshot) {
    await requireActivePostgresqlReceipts({ ...input, root }, registered);
    await (input.verifyHyperdrive ?? verifyProductHyperdrive)(registered);
    if (!input.restoreCrons) {
      await (input.verifyCrons ?? verifyProductCrons)({
        root,
        registered,
        paused: false,
      });
    }
    // A database stage may still need to apply new native migrations. Core's
    // existing startup guard verifies the exact journal after that stage.
    return { mode: "native_postgresql_release" };
  }
  if (!["db", "auth", "core"].every((scope) => input.scopes.includes(scope))) {
    throw new Error(
      "First PostgreSQL release requires coordinated db,auth,core scopes"
    );
  }
  const readSnapshot =
    input.readSnapshot ??
    (await import("../../tooling/postgresql/d1-import.mjs"))
      .readD1SnapshotManifest;
  const manifest = await readSnapshot(input.snapshot);
  if (!manifest.maintenance?.maintenanceId) {
    throw new Error("Cutover snapshot requires frozen D1 maintenance evidence");
  }
  const inspection = ["inspect-barrier", manifest.maintenance.maintenanceId];
  await runData(inspection);
  const completion = await runData(["completion", input.snapshot]);
  await runData(["reconcile", input.snapshot]);
  await runData(["verify"]);
  await (input.verifyHyperdrive ?? verifyProductHyperdrive)(registered);
  await (input.verifyCrons ?? verifyProductCrons)({
    root,
    registered,
    paused: true,
  });
  await runData(inspection);
  return {
    mode: "frozen_d1_cutover",
    importId: completion.importId,
    snapshotSha256: completion.snapshotSha256,
  };
}

export async function verifyProductCrons({
  root = process.cwd(),
  registered,
  paused,
  request = fetch,
  env = process.env,
}) {
  const token = env.CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN;
  if (!token) {
    throw new Error(
      "Missing scoped Cloudflare release token for Cron inspection"
    );
  }
  for (const scope of ["auth", "core"]) {
    const config = parseJsoncObject(
      readFileSync(path.join(root, `services/${scope}/wrangler.jsonc`), "utf8")
    );
    const response = await request(
      `https://api.cloudflare.com/client/v4/accounts/${registered.source.accountId}/workers/scripts/${config.env.prod.name ?? `${config.name}-prod`}/schedules`,
      { headers: { Authorization: `Bearer ${token}` }, redirect: "error" }
    );
    if (!response.ok) {
      throw new Error(
        `${scope} Cron inspection failed (HTTP ${response.status})`
      );
    }
    const body = await response.json();
    const schedules = body?.result?.schedules;
    const expected = paused ? [] : config.env.prod.triggers.crons;
    if (
      body?.success !== true ||
      !Array.isArray(schedules) ||
      !isDeepStrictEqual(
        schedules.map(({ cron }) => cron).sort(),
        [...expected].sort()
      )
    ) {
      throw new Error(
        `${scope} Cron configuration differs from the requested maintenance state`
      );
    }
  }
}

export async function restoreProductCrons({
  root = process.cwd(),
  runStep,
  runData = runCutoverDataCommand,
  verifyCrons = verifyProductCrons,
}) {
  await runData(["verify"]);
  const registered = await readCutoverTarget();
  for (const scope of ["auth", "core"]) {
    await runStep({
      command: "pnpm",
      args: [
        "exec",
        "wrangler",
        "triggers",
        "deploy",
        "--config",
        `services/${scope}/wrangler.jsonc`,
        "--env",
        "prod",
      ],
      label: `Restore ${scope} triggers from the accepted candidate`,
    });
  }
  await verifyCrons({ root, registered, paused: false });
}

// This is preparation output inside the existing release owner, never an
// executor or an admission receipt. It reads tracked inventory, not cloud state.
export async function readPostgresqlCutoverPreparation(root = process.cwd()) {
  const manifest = readBackendManifest(root);
  if (
    manifest.backend !== "postgresql" ||
    manifest.productCutover !== "guarded"
  ) {
    throw new Error(
      "Cutover preparation requires the guarded PostgreSQL candidate manifest."
    );
  }
  const resources = JSON.parse(
    readFileSync(path.join(root, "tooling/postgresql/resources.json"), "utf8")
  );
  const target = resources.environments.production;
  if (
    resources.engine !== "postgresql" ||
    target.majorVersion !== "18" ||
    !(
      target.databaseId &&
      target.branchId &&
      target.host &&
      target.hyperdriveId
    )
  ) {
    throw new Error("The registered PostgreSQL 18 target is incomplete.");
  }
  const { readMigrations } = await import(
    "../../tooling/postgresql/database.mjs"
  );
  const migrations = await readMigrations(
    path.join(root, "packages/db/postgresql/migrations")
  );
  return {
    mode: "preparation_only",
    promotionAllowed: false,
    reasonCode: "postgresql_cutover_requires_frozen_import",
    inventorySource: "tracked configuration; live provider state not inspected",
    target: {
      backend: resources.engine,
      majorVersion: target.majorVersion,
      organization: resources.organization,
      database: target.database,
      databaseId: target.databaseId,
      branchId: target.branchId,
      host: target.host,
      hyperdriveId: target.hyperdriveId,
    },
    nativeMigrations: migrations.map(({ name, checksum }) => ({
      name,
      checksum,
    })),
    requiredBeforePromotion: [
      "Reviewed immutable source, authorized maintenance owner and existing release scope leases.",
      "Live target identity, capacity, direct migration role, runtime grants and cache-disabled Hyperdrive verified.",
      "Every ingress producer, scheduler, queue, workflow, socket, DO alarm, outbox and operator writer inventoried and frozen or safely converged.",
      "Real active workstation execution observed in RuntimeCoordinator; new admission denied while accepted work reaches its authoritative final outcome and visible Space publication.",
      "Globally stable D1 capture, complete native import and full-field/identity reconciliation with no dual relational writer.",
      "Retained DO/R2 IDs, messages, file bodies, permissions and effects reconciled with the target database.",
      "Mixed-component and installed CLI/Service compatibility resolved; maintenance does not waive receiver-first dependencies.",
      "Cloud product login, retained sessions, permissions, real Wake and restart/recovery acceptance proven.",
      "Interrupted-maintenance recovery rehearsed on both sides of the first new PostgreSQL write.",
    ],
    maintenanceSequence: [
      "Before admission closes: review source/target identity, restore evidence, capacity and complete writer inventory.",
      "Close new admission at its owning entries; retain accepted work and let its authoritative owners converge, or use explicit normal stop.",
      "After convergence: freeze remaining writers, establish a consistent source and capture its complete manifest.",
      "Import into the empty native target, reconcile every field and generator, then verify retained DO/R2 references while writes stay closed.",
      "Only through a separately reviewed executor: promote the coordinated bindings/components under the existing release leases and validate the product.",
      "Reopen admission only after acceptance and recovery gates pass; retain source and migration evidence for the reviewed recovery period.",
    ],
    recovery: {
      beforeFirstPostgresqlWrite:
        "Keep admission closed. Restore the coherent source/bindings to the unchanged frozen D1 authority, reconcile retained DO/R2 effects and validate before reopening.",
      afterFirstPostgresqlWrite:
        "Freeze again and preserve/reconcile new PostgreSQL writes plus DO/R2 effects, or forward-fix. Never point writers back to the stale D1 snapshot.",
    },
    evidenceStatus: "not_evaluated",
    executor:
      "production-release.mjs deploy --database-cutover-snapshot <snapshot>",
  };
}
