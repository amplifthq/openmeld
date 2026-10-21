import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { from as copyFrom } from "pg-copy-streams";
import {
  postgresqlD1MaintenanceCaptureSchema,
  postgresqlD1RemoteSourceSchema,
  postgresqlImportCompletionSchema,
} from "../../packages/schemas/src/schemas/release/postgresql-import.ts";
import {
  createHistoricalD1Database,
  fileSha256,
  orderD1Tables,
  readD1Catalog,
  requireEqual,
} from "./d1-snapshot.mjs";
import {
  connect,
  migrationLock,
  quoteIdentifier as quote,
  readMigrations,
  withSpaceMembershipBackfillScope,
} from "./database.mjs";
import { readCutoverTarget, verifyRemoteCredential } from "./remote-target.mjs";

// Reviewed additions after the frozen D1 journal. These have no source rows.
const postgresqlOnlyTables = [
  { name: "first_work_experiences" },
  { name: "cloud_computers" },
  { name: "account_deletion_requests" },
  { name: "space_task_project_links" },
  { name: "space_task_project_projection_states" },
  { name: "user_time_contexts" },
  { name: "conversation_history_deletions" },
  { name: "ai_free_grants" },
  { name: "organization_ai_credentials" },
  { name: "member_agents" },
  { name: "openMeldDaemon_runtime_harness_presence" },
  { name: "agent_profile_permission_mode_advisories" },
  { name: "center_agent_permission_mode_confirmations" },
  { name: "direct_message_session_states" },
  { name: "agent_access_requests" },
  { name: "agent_profile_access_grants" },
  { name: "sensitive_operation_confirmations" },
  { name: "sensitive_operation_audit_events" },
];

function csv(value) {
  if (value === null) {
    return "";
  }
  return `"${String(value).replaceAll('"', '""')}"`;
}

function sourceColumn(column) {
  if (column.source === "ended_interaction") {
    const ended =
      "source_kind = 'runtime_coordinator_interaction' AND attention = 'action_required' AND resolution_status = 'resolved' AND resolved_at_ms IS NOT NULL";
    const value = {
      read_at_ms: "coalesce(read_at_ms, resolved_at_ms)",
      title: "'Request ended'",
      preview: "'This request no longer needs a response.'",
    }[column.name];
    return `CASE WHEN ${ended} THEN ${value} ELSE ${quote(column.name)} END AS ${quote(column.name)}`;
  }
  if (column.source === "new_nullable") {
    return `NULL AS ${quote(column.name)}`;
  }
  if (column.source === "inbox_rowid") {
    return 'rowid AS "sequence"';
  }
  if (column.source === "new_zero") {
    return `0 AS ${quote(column.name)}`;
  }
  if (column.source === "new_empty_array") {
    return `'[]' AS ${quote(column.name)}`;
  }
  if (column.source === "routine_scope") {
    return `CASE WHEN agent_profile_id IS NULL THEN 'team' ELSE 'personal' END AS ${quote(column.name)}`;
  }
  if (column.source === "routine_executor") {
    return `CASE WHEN agent_profile_id IS NULL THEN 'center_agent' ELSE 'remote_agent' END AS ${quote(column.name)}`;
  }
  if (column.source === "routine_scope_snapshot") {
    return `(SELECT CASE WHEN routine.agent_profile_id IS NULL THEN 'team' ELSE 'personal' END FROM routines AS routine WHERE routine.id = routine_runs.routine_id AND routine.organization_id = routine_runs.organization_id) AS ${quote(column.name)}`;
  }
  if (column.source === "routine_creator_snapshot") {
    return `(SELECT routine.created_by_user_id FROM routines AS routine WHERE routine.id = routine_runs.routine_id AND routine.organization_id = routine_runs.organization_id) AS ${quote(column.name)}`;
  }
  return quote(column.name);
}

function sourceRows(database, table, columns, ordered = false) {
  const keys = table.key.map((name) =>
    table.columns.find((column) => column.name === name)
  );
  if (!keys.length) {
    throw new Error(`Missing migration key: ${table.name}`);
  }
  const statement = database.prepare(
    `SELECT ${columns.map(sourceColumn).join(",")} FROM ${quote(table.name)} ORDER BY ${ordered ? keys.map((column) => `${quote(column.name)}${column.type === "TEXT" ? " COLLATE BINARY" : ""}`).join(",") : "rowid"}`
  );
  statement.setReadBigInts(true);
  return statement.iterate();
}

function reconcileRow(row, original, table, columns) {
  if (original.done) {
    throw new Error(`Unexpected imported row: ${table.name}`);
  }
  for (const column of columns) {
    const value = original.value[column.name];
    if (row[column.name] !== (value === null ? null : String(value))) {
      throw new Error(`Imported value mismatch: ${table.name}.${column.name}`);
    }
  }
}

async function reconcileTable(client, database, table, columns) {
  const keys = table.key.map((name) =>
    table.columns.find((column) => column.name === name)
  );
  const order = keys
    .map(
      (column) =>
        `source.${quote(column.name)}${column.type === "TEXT" ? ' COLLATE "C"' : ""}`
    )
    .join(",");
  await client.query(
    `DECLARE migration_rows NO SCROLL CURSOR FOR SELECT ${columns.map((column) => `${quote(column.name)}::text AS ${quote(column.name)}`).join(",")} FROM openmeld.${quote(table.name)} AS source ${table.name === "inbox_items" ? "WHERE source.kind <> 'space_joined'" : ""} ORDER BY ${order}`
  );
  const expected = sourceRows(database, table, columns, true);
  let count = 0;
  try {
    while (true) {
      const { rows } = await client.query(
        "FETCH FORWARD 256 FROM migration_rows"
      );
      if (!rows.length) {
        break;
      }
      for (const row of rows) {
        reconcileRow(row, expected.next(), table, columns);
        count += 1;
      }
    }
    if (!expected.next().done) {
      throw new Error(`Missing imported row: ${table.name}`);
    }
    return count;
  } finally {
    expected.return?.();
    await client.query("CLOSE migration_rows");
  }
}

export async function verifyNativeTarget(client, migrationsDirectory, remote) {
  return verifyNativeTargetWithMigrations(
    client,
    await readMigrations(migrationsDirectory),
    remote
  );
}

export async function verifyNativeTargetWithMigrations(
  client,
  migrations,
  remote
) {
  let identity;
  if (remote) {
    const observed = (
      await client.query(
        "SELECT current_database() AS database, current_user AS role"
      )
    ).rows[0];
    requireEqual(
      observed,
      { database: remote.target.database, role: remote.migrationRole },
      "Connected PostgreSQL identity differs from the registered target"
    );
    identity = remote.target;
  } else {
    const directory = (await client.query("SHOW data_directory")).rows[0]
      .data_directory;
    if (!path.basename(path.dirname(directory)).startsWith("openmeld-pg-")) {
      throw new Error("Target must belong to a fresh pg:local cluster");
    }
    identity = await importTargetIdentity(client, directory);
  }
  const applied = (
    await client.query(
      "SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at,id"
    )
  ).rows;
  requireEqual(
    applied,
    migrations.map((entry) => ({
      hash: entry.hash,
      created_at: String(entry.folderMillis),
    })),
    "Target native journal mismatch"
  );
  return { migrations, identity };
}

async function readNativeImportLayout(client, catalog) {
  const columns = (
    await client.query(
      "SELECT table_name,column_name,data_type,is_generated FROM information_schema.columns WHERE table_schema='openmeld' ORDER BY table_name,ordinal_position"
    )
  ).rows;
  requireEqual(
    [...new Set(columns.map((column) => column.table_name))].sort(),
    [...catalog, ...postgresqlOnlyTables].map(({ name }) => name).sort(),
    "Native table inventory mismatch"
  );
  const identities = (
    await client.query(
      "SELECT c.relname AS table_name,a.attname AS column_name,pg_get_serial_sequence(format('%I.%I',n.nspname,c.relname),a.attname) AS sequence FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='openmeld' AND a.attidentity<>'' ORDER BY c.relname,a.attname"
    )
  ).rows;
  const importedTables = new Set(catalog.map(({ name }) => name));
  return {
    columns,
    identities: identities.filter(({ table_name }) =>
      importedTables.has(table_name)
    ),
  };
}

async function importTargetIdentity(client, directory) {
  const identity = (
    await client.query(
      'SELECT system_identifier::text AS "systemIdentifier",d.oid::text AS "databaseOid",current_database() AS database FROM pg_control_system(),pg_database d WHERE d.datname=current_database()'
    )
  ).rows[0];
  return { ...identity, dataDirectory: directory };
}

async function readCompletion(client, expected, migrations) {
  const { rows } = await client.query(
    "SELECT record FROM openmeld_migration.d1_import_completion"
  );
  if (!rows.length) {
    return null;
  }
  const parsed = postgresqlImportCompletionSchema.safeParse(rows[0].record);
  if (rows.length !== 1 || !parsed.success) {
    throw new Error("Invalid D1 import completion record; preserve the target");
  }
  const {
    importId: _importId,
    identities: _identities,
    nativeJournal,
    ...binding
  } = parsed.data;
  requireEqual(
    binding,
    expected,
    "D1 import completion binding mismatch; preserve the target"
  );
  // Completion describes the import at that time. Canonical later migrations
  // may change application tables/identities; they must not rewrite this proof.
  // The prefix must include the migration that introduced completion evidence.
  if (
    !nativeJournal.some(({ name }) => name === "0013_d1_import_completion.sql")
  ) {
    throw new Error(
      "D1 import completion journal is incomplete; preserve the target"
    );
  }
  requireEqual(
    nativeJournal,
    migrations
      .slice(0, nativeJournal.length)
      .map(({ name, checksum }) => ({ name, checksum })),
    "D1 import completion journal mismatch; preserve the target"
  );
  return parsed.data;
}

async function lockMigrationTarget(client) {
  if (
    !(
      await client.query("SELECT pg_try_advisory_xact_lock($1) AS acquired", [
        migrationLock,
      ])
    ).rows[0].acquired
  ) {
    throw new Error("Another migration owns the target lock");
  }
}

async function lockEmptyTarget(client, catalog) {
  await lockMigrationTarget(client);
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query(
    `LOCK TABLE ${catalog.map((table) => `openmeld.${quote(table.name)}`).join(",")} IN ACCESS EXCLUSIVE MODE`
  );
  for (const table of catalog) {
    if (
      (
        await client.query(
          `SELECT EXISTS(SELECT 1 FROM openmeld.${quote(table.name)}) AS populated`
        )
      ).rows[0].populated
    ) {
      throw new Error(`Import target is not empty: ${table.name}`);
    }
  }
}

function newNullableIntegerColumns(table) {
  return (
    {
      // No historical session is known to be CLI-held. The first Bearer use
      // marks it (member-agent-program.md §4.7).
      sessions: ["cli_credential_at"],
      // Historical receipts predate credit holds and count only a reported
      // cost (migration 0048).
      ai_usage_records: ["credit_hold_nano_usd", "credit_hold_admitted_at_ms"],
    }[table.name] ?? []
  );
}

function nativeColumns(table, targetColumns) {
  const newNullableColumns = {
    plugin_action_requests: ["continuation_json"],
    center_agent_connector_action_operations: [
      "linear_issue_receipt_json",
      "github_issue_observation_json",
    ],
    space_index_spaces: ["recent_message_previews_json"],
    // NULL falls back to the receipt's stored funding source (migration 0048).
    ai_usage_records: ["funding_source"],
  };
  const columns = [
    ...table.columns,
    ...(newNullableColumns[table.name] ?? []).map((name) => ({
      name,
      type: "TEXT",
      hidden: 0,
      source: "new_nullable",
    })),
    ...newNullableIntegerColumns(table).map((name) => ({
      name,
      type: "INTEGER",
      hidden: 0,
      source: "new_nullable",
    })),
  ];
  if (table.name === "openmeld_profiles") {
    // Historical avatars retain their style; appearance options remain unset.
    columns.push({
      name: "avatar_options",
      type: "JSONB",
      hidden: 0,
      source: "new_nullable",
    });
    // A historical null does not prove that the owner never cleared Project.
    columns.push({
      name: "default_project_revision",
      type: "INTEGER",
      hidden: 0,
      source: "new_nullable",
    });
    // Historical Profiles start unassigned; the MemberAgent backfill groups them.
    columns.push({
      name: "member_agent_id",
      type: "TEXT",
      hidden: 0,
      source: "new_nullable",
    });
  }
  if (table.name === "openMeldDaemon_dispatch_ledger") {
    // Historical dispatches predate request chains; their root stays unset.
    columns.push({
      name: "request_chain_root_profile_id",
      type: "TEXT",
      hidden: 0,
      source: "new_nullable",
    });
  }
  if (table.name === "projects") {
    // Historical Projects retain their repository and identity. Workflow
    // preferences begin unset; importing data never grants new access.
    columns.push(
      ...[
        "issue_destination_json",
        "issue_destination_updated_by_user_id",
        "repository_settings_updated_by_user_id",
        "common_agents_updated_by_user_id",
      ].map((name) => ({
        name,
        type: "TEXT",
        hidden: 0,
        source: "new_nullable",
      })),
      ...[
        "issue_destination_updated_at_ms",
        "repository_settings_updated_at_ms",
        "common_agents_updated_at_ms",
      ].map((name) => ({
        name,
        type: "INTEGER",
        hidden: 0,
        source: "new_nullable",
      })),
      ...[
        "issue_destination_revision",
        "repository_settings_revision",
        "common_agents_revision",
      ].map((name) => ({
        name,
        type: "INTEGER",
        hidden: 0,
        source: "new_zero",
      })),
      ...[
        "additional_repository_urls_json",
        "common_agent_profile_ids_json",
      ].map((name) => ({
        name,
        type: "TEXT",
        hidden: 0,
        source: "new_empty_array",
      }))
    );
  }
  if (table.name === "openMeldDaemon_pre_head_failure_publication_outbox") {
    // Import keeps the historical publication state. Attribution is reviewed
    // by the owning recovery command, never inferred by the migration.
    columns.push({
      name: "recovery_blocker_reason",
      type: "TEXT",
      hidden: 0,
      source: "new_nullable",
    });
  }
  // Historical accounts and Organizations have not requested deletion.
  const deletionColumn = {
    users: "deleted_at",
    organizations: "deletion_requested_at",
  }[table.name];
  if (deletionColumn) {
    columns.push({
      name: deletionColumn,
      type: "INTEGER",
      hidden: 0,
      source: "new_nullable",
    });
  }
  if (table.name === "inbox_items") {
    // Match native migration 0023 when historical rows arrive after migrations.
    for (const name of ["read_at_ms", "title", "preview"]) {
      const index = columns.findIndex((column) => column.name === name);
      columns[index] = { ...columns[index], source: "ended_interaction" };
    }
    columns.push({
      name: "sequence",
      type: "INTEGER",
      hidden: 0,
      source: "inbox_rowid",
    });
  }
  if (table.name === "routines") {
    columns.push(
      { name: "scope", type: "TEXT", hidden: 0, source: "routine_scope" },
      {
        name: "executor_kind",
        type: "TEXT",
        hidden: 0,
        source: "routine_executor",
      }
    );
  }
  if (table.name === "routine_runs") {
    // Deleted legacy definitions leave ownership unknown. Do not invent access
    // or an execution receipt for historical runs.
    columns.push(
      {
        name: "scope_snapshot",
        type: "TEXT",
        hidden: 0,
        source: "routine_scope_snapshot",
      },
      {
        name: "created_by_user_id_snapshot",
        type: "TEXT",
        hidden: 0,
        source: "routine_creator_snapshot",
      },
      ...["source_signal_id", "local_submission_json"].map((name) => ({
        name,
        type: "TEXT",
        hidden: 0,
        source: "new_nullable",
      })),
      {
        name: "local_last_checked_at_ms",
        type: "INTEGER",
        hidden: 0,
        source: "new_zero",
      }
    );
  }
  if (table.name === "openMeldRemoteAgent_native_delivery_ledger") {
    // Native-only submission mutexes have no historical owner to import.
    // NULL neither acquires a claim nor changes execution/publication state.
    columns.push(
      {
        name: "worker_submit_claim_id",
        type: "TEXT",
        hidden: 0,
        source: "new_nullable",
      },
      {
        name: "worker_submit_claim_expires_at_ms",
        type: "INTEGER",
        hidden: 0,
        source: "new_nullable",
      }
    );
  }
  const target = targetColumns.filter(
    (column) => column.table_name === table.name
  );
  requireEqual(
    target.map((column) => column.column_name).sort(),
    columns.map((column) => column.name).sort(),
    `Native column inventory mismatch: ${table.name}`
  );
  for (const column of columns) {
    const native = target.find(
      (candidate) => candidate.column_name === column.name
    );
    let valid = ["integer", "bigint"].includes(native.data_type);
    if (column.type === "JSONB") {
      valid = native.data_type === "jsonb";
    } else if (column.type === "TEXT") {
      valid = native.data_type === "text";
    }
    if (
      !valid ||
      (native.is_generated === "ALWAYS") !== (column.hidden === 3)
    ) {
      throw new Error(`Unreviewed native type: ${table.name}.${column.name}`);
    }
  }
  return columns;
}

function* copyRows(database, table, columns) {
  for (const row of sourceRows(database, table, columns)) {
    for (const column of columns) {
      const value = row[column.name];
      if (
        typeof value === "bigint" &&
        (value > BigInt(Number.MAX_SAFE_INTEGER) ||
          value < BigInt(Number.MIN_SAFE_INTEGER))
      ) {
        throw new Error(
          `Integer exceeds the product safe range: ${table.name}.${column.name}`
        );
      }
      if (typeof value === "string" && value.includes("\0")) {
        throw new Error(
          `PostgreSQL cannot preserve NUL text: ${table.name}.${column.name}`
        );
      }
    }
    yield `${columns.map((column) => csv(row[column.name])).join(",")}\n`;
  }
}

async function reconcileIdentities(client, manifest, importData, identities) {
  for (const identity of identities) {
    const max = BigInt(
      (
        await client.query(
          `SELECT coalesce(max(${quote(identity.column_name)}),0)::text AS maximum FROM openmeld.${quote(identity.table_name)}`
        )
      ).rows[0].maximum
    );
    const prior = BigInt(
      manifest.sequences.find(
        (sequence) => sequence.name === identity.table_name
      )?.seq ?? "0"
    );
    // Inbox rowid has no sqlite_sequence. A retained page/selection can observe
    // a now-deleted tail; new arrivals must remain outside that old cutoff.
    const observed =
      identity.table_name === "inbox_items"
        ? BigInt(
            (
              await client.query(
                "SELECT coalesce(max(through_row_id),0)::text AS maximum FROM openmeld.inbox_feed_snapshots"
              )
            ).rows[0].maximum
          )
        : 0n;
    const highWater = [0n, max, prior, observed].reduce((a, b) =>
      a > b ? a : b
    );
    const next = highWater + 1n;
    if (next > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(
        `Identity exceeds the product safe range: ${identity.table_name}`
      );
    }
    if (importData) {
      // ALTER ... RESTART participates in this transaction; setval does not.
      await client.query(
        `ALTER SEQUENCE ${identity.sequence} RESTART WITH ${next}`
      );
    } else {
      const state = (
        await client.query(
          `SELECT last_value::text AS value,is_called FROM ${identity.sequence}`
        )
      ).rows[0];
      if (state.is_called || state.value !== String(next)) {
        throw new Error(`Imported identity differs: ${identity.table_name}`);
      }
    }
  }
  return identities;
}

/** Direct connection, one transaction, existing native constraints, empty target. */
export function importD1Snapshot(input) {
  return processD1Snapshot(input, "import");
}

/** Inspect actual target equality. This never reconstructs an import receipt or opens admission. */
export function reconcileD1Snapshot(input) {
  return processD1Snapshot(input, "reconcile");
}

/** Read committed evidence only; never infer completion from current business rows. */
export function readD1ImportCompletion(input) {
  return processD1Snapshot(input, "completion");
}

async function reconcileTables({
  client,
  database,
  catalog,
  target,
  manifest,
  importData,
}) {
  const tables = [];
  for (const table of orderD1Tables(catalog)) {
    const columns = nativeColumns(table, target.columns);
    if (importData) {
      const writable = columns.filter((column) => column.hidden === 0);
      await pipeline(
        Readable.from(copyRows(database, table, writable)),
        client.query(
          copyFrom(
            `COPY openmeld.${quote(table.name)} (${writable.map((column) => quote(column.name)).join(",")}) FROM STDIN WITH (FORMAT csv, ON_ERROR stop)`
          )
        )
      );
    }
    const count = await reconcileTable(client, database, table, columns);
    if (
      String(count) !==
      manifest.tables.find((entry) => entry.name === table.name).rows
    ) {
      throw new Error(`Imported count mismatch: ${table.name}`);
    }
    tables.push({ table: table.name, rows: count });
  }
  return tables;
}

export async function readD1SnapshotManifest(snapshot) {
  const manifest = JSON.parse(await readFile(`${snapshot}.json`, "utf8"));
  if (
    manifest.maintenance !== undefined &&
    !postgresqlD1MaintenanceCaptureSchema.safeParse(manifest.maintenance)
      .success
  ) {
    throw new Error("Invalid D1 maintenance capture evidence");
  }
  if (
    manifest.version !== 1 ||
    !(
      manifest.identity.kind === "local-synthetic" ||
      (postgresqlD1RemoteSourceSchema.safeParse(manifest.identity).success &&
        manifest.maintenance)
    ) ||
    manifest.snapshotSha256 !== (await fileSha256(snapshot))
  ) {
    throw new Error("Unverified or unsupported D1 snapshot");
  }
  return manifest;
}

async function resolveImportDestination({
  destination,
  manifest,
  connectionString,
  migrationsDirectory,
}) {
  if (!["local", "production"].includes(destination)) {
    throw new Error("Unknown D1 import destination");
  }
  if (destination === "local" && process.env.OPENMELD_PG_ISOLATED !== "1") {
    throw new Error("Only isolated local D1 import is enabled");
  }
  const remote =
    destination === "production" ? await readCutoverTarget() : null;
  if (remote) {
    if (migrationsDirectory) {
      throw new Error("Remote import uses only the committed native journal");
    }
    verifyRemoteCredential(connectionString, remote);
    requireEqual(
      manifest.identity,
      remote.source,
      "Capture belongs to a different D1 source"
    );
  }
  return remote;
}

async function processD1Snapshot(
  { snapshot, connectionString, migrationsDirectory, destination = "local" },
  mode
) {
  const importData = mode === "import";
  const manifest = await readD1SnapshotManifest(snapshot);
  const remote = await resolveImportDestination({
    destination,
    manifest,
    connectionString,
    migrationsDirectory,
  });
  const reference = await createHistoricalD1Database();
  let catalog;
  try {
    catalog = readD1Catalog(reference.database);
  } finally {
    reference.database.close();
  }
  if (manifest.historySha256 !== reference.historySha256) {
    throw new Error("D1 snapshot history differs from this source");
  }
  const database = new DatabaseSync(snapshot, { readOnly: true });
  let client;
  let transaction = false;
  try {
    requireEqual(
      readD1Catalog(database),
      catalog,
      "Snapshot schema differs from reviewed history"
    );
    requireEqual(
      manifest.tables.map(({ name }) => name).sort(),
      catalog.map(({ name }) => name).sort(),
      "Snapshot receipt omits a table"
    );
    client = await connect(connectionString, !remote);
    await client.query(
      importData ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
    );
    transaction = true;
    const target = await verifyNativeTarget(
      client,
      migrationsDirectory,
      remote
    );
    if (importData) {
      await lockEmptyTarget(client, [...catalog, ...postgresqlOnlyTables]);
    } else {
      await lockMigrationTarget(client);
    }
    const binding = {
      version: 1,
      status: "committed_and_reconciled",
      snapshotSha256: manifest.snapshotSha256,
      captureReceiptSha256: await fileSha256(`${snapshot}.json`),
      sourceSchemaSha256: manifest.sourceSchemaSha256,
      historySha256: manifest.historySha256,
      target: target.identity,
      tables: orderD1Tables(catalog).map(({ name }) => ({
        table: name,
        rows: Number(manifest.tables.find((entry) => entry.name === name).rows),
      })),
    };
    if (mode === "completion") {
      const record = await readCompletion(client, binding, target.migrations);
      await client.query("COMMIT");
      transaction = false;
      return record;
    }
    const layout = await readNativeImportLayout(client, catalog);
    const imported = await reconcileTables({
      client,
      database,
      catalog,
      target: layout,
      manifest,
      importData,
    });
    await reconcileIdentities(client, manifest, importData, layout.identities);
    if (importData) {
      // Native migrations precede the frozen import. Baseline its historical
      // membership generations after the original rows have been reconciled.
      const baseline = (
        await readFile(
          new URL(
            "../../packages/db/postgresql/migrations/0033_space_joined_inbox.sql",
            import.meta.url
          ),
          "utf8"
        )
      )
        .split("--> statement-breakpoint")
        .at(-1);
      if (!baseline) {
        throw new Error("Missing Space membership baseline");
      }
      await withSpaceMembershipBackfillScope(client, () =>
        client.query(baseline)
      );
      // Derived Inbox baseline rows consume native identities after the import.
      // Re-establish an uncalled next identity before the receipt is committed.
      await reconcileIdentities(client, manifest, true, layout.identities);
    }
    const receipt = {
      ...binding,
      tables: imported,
      nativeJournal: target.migrations.map(({ name, checksum }) => ({
        name,
        checksum,
      })),
      identities: layout.identities.map(({ table_name, column_name }) => ({
        table: table_name,
        column: column_name,
      })),
      ...(importData
        ? { importId: randomUUID() }
        : {
            status: "snapshot_reconciled",
            inspectionOnly: true,
            promotionAllowed: false,
            businessWriteHistory: "not_proven",
            retainedDoR2Effects: "not_inspected",
          }),
    };
    if (importData) {
      const parsed = postgresqlImportCompletionSchema.safeParse(receipt);
      if (!parsed.success) {
        throw new Error("Invalid D1 import completion evidence");
      }
      // Unique commit truth: COPY, reconciliation, transactional sequence restart
      // and this record succeed together. External JSON is only its projection.
      await client.query(
        "INSERT INTO openmeld_migration.d1_import_completion(record) VALUES($1::jsonb)",
        [JSON.stringify(parsed.data)]
      );
    }
    await client.query("COMMIT");
    transaction = false;
    return receipt;
  } catch (error) {
    if (transaction) {
      await client.query("ROLLBACK");
    }
    // PostgreSQL COPY errors may include a credential-bearing row in detail.
    if (error.severity) {
      throw new Error(
        `Native import rejected: ${error.code}; constraint=${error.constraint ?? "unspecified"}`
      );
    }
    throw error;
  } finally {
    database.close();
    await client?.end();
  }
}
