import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  D1_MAINTENANCE_CATALOG_QUERY,
  inspectD1MaintenanceBarrier,
  prepareD1MaintenanceMigration,
  readD1MaintenanceSource,
} from "../../scripts/release/d1-maintenance-barrier.mjs";
import {
  importD1Snapshot,
  readD1ImportCompletion,
  reconcileD1Snapshot,
  verifyNativeTarget,
  verifyNativeTargetWithMigrations,
} from "./d1-import.mjs";
import { createRemoteD1Source } from "./d1-remote.mjs";
import { captureD1Snapshot } from "./d1-snapshot.mjs";
import {
  closeMigrationClient,
  connect,
  grantRuntime,
  migrate,
  readMigrationsAtSource,
} from "./database.mjs";
import { backfillMemberAgents } from "./member-agent-backfill.mjs";
import { readCutoverTarget, verifyRemoteCredential } from "./remote-target.mjs";

export function formatCutoverDataFailure(error) {
  const sqlState = error.code ?? error.cause?.code;
  return sqlState
    ? `Cutover data operation failed (${sqlState}); preserve source and target`
    : error.message;
}

function readCommand(program, args) {
  const result = spawnSync(program, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${program} failed; credential-bearing output suppressed`);
  }
  return result.stdout.trim();
}

export function migrationCredential(registered) {
  const databasePath = `organizations/${registered.target.organization}/databases/${registered.databaseName}`;
  const database = JSON.parse(
    readCommand("pscale", [
      "api",
      databasePath,
      "--org",
      "amplift",
      "--format",
      "json",
    ])
  );
  if (
    database.id !== registered.target.databaseId ||
    database.kind !== "postgresql" ||
    database.cloudflare_uid !== registered.source.accountId
  ) {
    throw new Error(
      "Registered PlanetScale database or Cloudflare account changed"
    );
  }
  const branch = JSON.parse(
    readCommand("pscale", [
      "api",
      `${databasePath}/branches/${registered.branchName}`,
      "--org",
      "amplift",
      "--format",
      "json",
    ])
  );
  if (branch.id !== registered.target.branchId || !branch.ready) {
    throw new Error(
      "Registered PlanetScale branch is absent, changed or not ready"
    );
  }
  const value = readCommand("doppler", [
    "secrets",
    "get",
    "POSTGRESQL_OPENMELD_MIGRATION_URL",
    "--plain",
    "--project",
    "openmeld-release",
    "--config",
    "prd",
    "--silent",
  ]);
  verifyRemoteCredential(value, registered);
  return value;
}

// Explicit maintenance-window operations. This is the existing capture/import
// owner, not a deployment or a declaration that runtime writers have stopped.
export async function runCutoverDataCommand([command, ...args]) {
  const registered = await readCutoverTarget();
  if (command === "plan" && args.length === 0) {
    return {
      ...registered,
      operations: [
        "prepare-barrier <maintenance-id> <new-directory>",
        "inspect-barrier <maintenance-id>",
        "capture <maintenance-id> <new-snapshot>",
        "migrate",
        "verify",
        "verify-retry-baseline <exact-verified-source>",
        "import <snapshot>",
        "reconcile <snapshot>",
        "completion <snapshot>",
        "grant-runtime",
        "backfill-member-agents [--dry-run]",
      ],
      productionOperationExecuted: false,
    };
  }
  if (
    (command === "prepare-barrier" && args.length === 2) ||
    (command === "inspect-barrier" && args.length === 1)
  ) {
    const [maintenanceId, root] = args;
    const source = createRemoteD1Source({
      identity: registered.source,
      token: process.env.CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN,
    });
    const catalog = (
      await source.prepare(D1_MAINTENANCE_CATALOG_QUERY).bind().all()
    ).results;
    const history = await readD1MaintenanceSource(
      fileURLToPath(new URL("../../", import.meta.url))
    );
    if (command === "inspect-barrier") {
      return inspectD1MaintenanceBarrier({
        source: history,
        catalog,
        maintenanceId,
        state: "frozen",
      });
    }
    return prepareD1MaintenanceMigration({
      root,
      source: history,
      catalog,
      maintenanceId,
      operationId: randomUUID(),
      operation: "install",
      target: {
        databaseName: registered.sourceDatabaseName,
        databaseId: registered.source.databaseId,
        accountId: registered.source.accountId,
      },
    });
  }
  if (command === "capture" && args.length === 2) {
    const [maintenanceId, destination] = args;
    const token = process.env.CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN;
    const source = createRemoteD1Source({ identity: registered.source, token });
    return captureD1Snapshot({
      source,
      identity: registered.source,
      maintenanceId,
      destination,
    });
  }
  const imports = {
    import: importD1Snapshot,
    reconcile: reconcileD1Snapshot,
    completion: readD1ImportCompletion,
  };
  if (Object.hasOwn(imports, command) && args.length === 1) {
    return imports[command]({
      snapshot: args[0],
      destination: "production",
      connectionString: migrationCredential(registered),
    });
  }
  if (
    (["migrate", "verify", "grant-runtime"].includes(command) &&
      args.length === 0) ||
    (command === "verify-retry-baseline" && args.length === 1) ||
    (command === "backfill-member-agents" &&
      (args.length === 0 || (args.length === 1 && args[0] === "--dry-run")))
  ) {
    return runNativeDataCommand(command, args, registered);
  }
  throw new Error(
    "Usage: cutover.mjs plan | prepare-barrier <maintenance-id> <new-directory> | inspect-barrier <maintenance-id> | capture <maintenance-id> <new-snapshot> | <migrate|verify|grant-runtime> | verify-retry-baseline <exact-verified-source> | backfill-member-agents [--dry-run] | <import|reconcile|completion> <snapshot>"
  );
}

async function runNativeDataCommand(command, args, registered) {
  const client = await connect(migrationCredential(registered));
  try {
    if (command === "migrate") {
      return await migrate(client);
    }
    if (command === "grant-runtime") {
      await grantRuntime(client, registered.runtimeRole);
      return { runtimeGrantsApplied: true };
    }
    if (command === "backfill-member-agents") {
      return await backfillMemberAgents(client, {
        dryRun: args[0] === "--dry-run",
      });
    }
    await client.query("BEGIN READ ONLY");
    const target =
      command === "verify-retry-baseline"
        ? await verifyNativeTargetWithMigrations(
            client,
            readMigrationsAtSource(args[0]),
            registered
          )
        : await verifyNativeTarget(client, undefined, registered);
    await verifyRuntimeGrants(client, registered.runtimeRole);
    await client.query("COMMIT");
    return {
      target: target.identity,
      nativeJournal: target.migrations.map(({ name, checksum }) => ({
        name,
        checksum,
      })),
      runtimeGrantsVerified: true,
      ...(command === "verify-retry-baseline"
        ? { baselineSourceSha: args[0] }
        : {}),
    };
  } finally {
    await closeMigrationClient(client);
  }
}

export async function verifyRuntimeGrants(client, role) {
  const result = (
    await client.query(
      `
    SELECT current_setting('server_version_num')::int / 10000 = 18 AS version,
      NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AS restricted,
      NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = pg_roles.oid) AS no_inheritance,
      has_schema_privilege($1, 'openmeld', 'USAGE') AND NOT has_schema_privilege($1, 'openmeld', 'CREATE') AS schema,
      NOT has_schema_privilege($1, 'drizzle', 'USAGE') AND NOT has_schema_privilege($1, 'openmeld_migration', 'USAGE') AS private_ledgers,
      (SELECT bool_and(has_table_privilege($1, c.oid, 'SELECT') AND has_table_privilege($1, c.oid, 'INSERT')
        AND has_table_privilege($1, c.oid, 'UPDATE') AND has_table_privilege($1, c.oid, 'DELETE')
        AND NOT has_table_privilege($1, c.oid, 'TRUNCATE'))
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='openmeld' AND c.relkind='r') AS tables,
      (SELECT bool_and(has_sequence_privilege($1, c.oid, 'USAGE') AND has_sequence_privilege($1, c.oid, 'SELECT'))
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='openmeld' AND c.relkind='S') AS sequences
    FROM pg_roles WHERE rolname=$1`,
      [role]
    )
  ).rows[0];
  if (!result || Object.values(result).some((value) => value !== true)) {
    throw new Error(
      "PostgreSQL version or runtime grants differ from the native product contract"
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = await runCutoverDataCommand(process.argv.slice(2));
    if (process.env.OPENMELD_PG_RECEIPT_PATH) {
      await writeFile(
        process.env.OPENMELD_PG_RECEIPT_PATH,
        `${JSON.stringify(result, null, 2)}\n`,
        { flag: "wx", mode: 0o600 }
      );
    }
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(formatCutoverDataFailure(error));
    process.exitCode = 1;
  }
}
