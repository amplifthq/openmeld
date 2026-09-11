import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

type SqliteBindValue = number | string | null;

const RUN_IN_TRANSACTION = Symbol("runInTransaction");
const CREATE_TABLE_NAME_PATTERN =
  /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`([^`]+)`/i;
const SQL_LINE_COMMENT_PATTERN = /^\s*--.*$/gm;
const MUTATED_TABLE_NAME_PATTERN =
  /^(?:INSERT(?: OR \w+)? INTO|UPDATE|ALTER TABLE|DROP TABLE(?: IF EXISTS)?)\s+`([^`]+)`/i;
const INDEX_OR_TRIGGER_TABLE_NAME_PATTERN =
  /^CREATE(?: UNIQUE)? (?:INDEX|TRIGGER)\s[\s\S]*?\bON\s+`([^`]+)`/i;

type TestPreparedStatement = D1PreparedStatement & {
  [RUN_IN_TRANSACTION]: () => unknown;
};

const repoRootDirectoryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);

const PREPARE_SESSION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS openMeldDaemon_prepare_sessions (
    prepare_session_id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    human_profile_id TEXT,
    device_id TEXT,
    runtime_lane TEXT,
    target_space_id TEXT,
    creation_idempotency_key TEXT,
    lifecycle_status TEXT NOT NULL,
    phase TEXT NOT NULL,
    session_revision INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    diagnostic_correlation_id TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    completed_at_ms INTEGER,
    expires_at_ms INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_openMeldDaemon_prepare_sessions_owner_status_updated
    ON openMeldDaemon_prepare_sessions (owner_user_id, lifecycle_status, updated_at_ms DESC);
  CREATE INDEX IF NOT EXISTS idx_openMeldDaemon_prepare_sessions_device_status_updated
    ON openMeldDaemon_prepare_sessions (owner_user_id, device_id, lifecycle_status, updated_at_ms DESC);
  CREATE INDEX IF NOT EXISTS idx_openMeldDaemon_prepare_sessions_expires
    ON openMeldDaemon_prepare_sessions (expires_at_ms);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_openMeldDaemon_prepare_sessions_owner_creation_idempotency
    ON openMeldDaemon_prepare_sessions (owner_user_id, creation_idempotency_key);
  CREATE TABLE IF NOT EXISTS openMeldDaemon_prepare_session_tokens (
    token_digest TEXT PRIMARY KEY,
    prepare_session_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    issued_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    revoked_at_ms INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_openMeldDaemon_prepare_session_tokens_session_active
    ON openMeldDaemon_prepare_session_tokens (prepare_session_id, revoked_at_ms);
  CREATE INDEX IF NOT EXISTS idx_openMeldDaemon_prepare_session_tokens_owner_issued
    ON openMeldDaemon_prepare_session_tokens (owner_user_id, issued_at_ms DESC);
  CREATE TABLE IF NOT EXISTS openMeldDaemon_prepare_session_events (
    event_id TEXT PRIMARY KEY,
    prepare_session_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    session_revision INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    event_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_openMeldDaemon_prepare_session_events_session_created
    ON openMeldDaemon_prepare_session_events (prepare_session_id, created_at_ms);
  CREATE INDEX IF NOT EXISTS idx_openMeldDaemon_prepare_session_events_owner_created
    ON openMeldDaemon_prepare_session_events (owner_user_id, created_at_ms DESC);
`;

const CURRENT_DEVICE_TARGET_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS openMeldDaemon_current_device_targets (
    owner_user_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    runtime_lane TEXT,
    updated_at_ms INTEGER NOT NULL
  );
`;

const FORGOTTEN_DEVICE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS openMeldDaemon_forgotten_devices (
    owner_user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    forgotten_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (owner_user_id, device_id)
  );
`;

const OWNED_DEVICE_REGISTRY_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS openMeldDaemon_owned_devices (
    owner_user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    connected_computer_id TEXT,
    observed_display_name TEXT,
    user_display_name TEXT,
    platform_family TEXT,
    os_version TEXT,
    device_type TEXT,
    first_seen_at_ms INTEGER NOT NULL,
    last_observed_at_ms INTEGER,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (owner_user_id, device_id)
  );
`;

const CONNECTED_COMPUTER_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS openMeldDaemon_connected_computers (
    owner_user_id TEXT NOT NULL,
    connected_computer_id TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (owner_user_id, connected_computer_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS openMeldDaemon_connected_computers_owner_computer_unique
    ON openMeldDaemon_connected_computers (owner_user_id, connected_computer_id);
`;

export function createSqliteD1Harness(): {
  close(): void;
  db: D1Database;
  run(input: { params?: readonly SqliteBindValue[]; sql: string }): void;
  queryAll<TRow extends Record<string, unknown>>(input: {
    params?: readonly SqliteBindValue[];
    sql: string;
  }): TRow[];
  queryFirst<TRow extends Record<string, unknown>>(input: {
    params?: readonly SqliteBindValue[];
    sql: string;
  }): TRow | null;
} {
  const database = new DatabaseSync(":memory:");
  database.exec(PREPARE_SESSION_TABLE_SQL);
  database.exec(CURRENT_DEVICE_TARGET_TABLE_SQL);
  database.exec(FORGOTTEN_DEVICE_TABLE_SQL);
  database.exec(OWNED_DEVICE_REGISTRY_TABLE_SQL);
  database.exec(CONNECTED_COMPUTER_TABLE_SQL);

  return {
    db: createD1Database(database),
    close: () => {
      database.close();
    },
    run: (input) => {
      database.prepare(input.sql).run(...(input.params ?? []));
    },
    queryAll: <TRow extends Record<string, unknown>>(input: {
      params?: readonly SqliteBindValue[];
      sql: string;
    }) => database.prepare(input.sql).all(...(input.params ?? [])) as TRow[],
    queryFirst: <TRow extends Record<string, unknown>>(input: {
      params?: readonly SqliteBindValue[];
      sql: string;
    }) =>
      (database.prepare(input.sql).get(...(input.params ?? [])) as
        | TRow
        | undefined) ?? null,
  };
}

export function createFaultInjectingD1Database(input: {
  db: D1Database;
  failureCount?: number;
  matches: (sql: string, operation: "all" | "first" | "run") => boolean;
}): D1Database {
  let failuresRemaining = input.failureCount ?? 1;
  const delegateByStatement = new WeakMap<object, D1PreparedStatement>();
  const wrap = (
    delegate: D1PreparedStatement,
    sql: string
  ): D1PreparedStatement => {
    const failIfMatched = (operation: "all" | "first" | "run"): void => {
      if (failuresRemaining > 0 && input.matches(sql, operation)) {
        failuresRemaining -= 1;
        throw new Error("injected D1 operation failure");
      }
    };
    const wrapped = {
      all: async <TRow>() => {
        failIfMatched("all");
        return await delegate.all<TRow>();
      },
      bind: (...values: unknown[]) => wrap(delegate.bind(...values), sql),
      first: async <TRow>(columnName?: string) => {
        failIfMatched("first");
        return columnName === undefined
          ? await delegate.first<TRow>()
          : await delegate.first<TRow>(columnName);
      },
      run: async () => {
        failIfMatched("run");
        return await delegate.run();
      },
    } as D1PreparedStatement;
    delegateByStatement.set(wrapped, delegate);
    return wrapped;
  };

  return {
    batch: async (statements: D1PreparedStatement[]) =>
      await input.db.batch(
        statements.map(
          (statement) => delegateByStatement.get(statement) ?? statement
        )
      ),
    prepare: (sql: string) => wrap(input.db.prepare(sql), sql),
  } as D1Database;
}

export function createBeforeMatchingBatchD1Database(input: {
  beforeBatch(): void;
  db: D1Database;
  matches(sql: string): boolean;
}): D1Database {
  const delegateByStatement = new WeakMap<object, D1PreparedStatement>();
  const sqlByStatement = new WeakMap<object, string>();
  let beforeBatchRan = false;
  const wrap = (
    delegate: D1PreparedStatement,
    sql: string
  ): D1PreparedStatement => {
    const wrapped = {
      all: <TRow>() => delegate.all<TRow>(),
      bind: (...values: unknown[]) => wrap(delegate.bind(...values), sql),
      first: <TRow>(columnName?: string) =>
        columnName === undefined
          ? delegate.first<TRow>()
          : delegate.first<TRow>(columnName),
      run: () => delegate.run(),
    } as D1PreparedStatement;
    delegateByStatement.set(wrapped, delegate);
    sqlByStatement.set(wrapped, sql);
    return wrapped;
  };

  return {
    batch: async (statements: D1PreparedStatement[]) => {
      if (
        !beforeBatchRan &&
        statements.some((statement) =>
          input.matches(sqlByStatement.get(statement) ?? "")
        )
      ) {
        beforeBatchRan = true;
        input.beforeBatch();
      }
      return await input.db.batch(
        statements.map(
          (statement) => delegateByStatement.get(statement) ?? statement
        )
      );
    },
    prepare: (sql: string) => wrap(input.db.prepare(sql), sql),
  } as D1Database;
}

export function createDuplicateMatchingBatchD1Database(input: {
  db: D1Database;
  matches(sql: string): boolean;
}): D1Database {
  const delegateByStatement = new WeakMap<object, D1PreparedStatement>();
  const sqlByStatement = new WeakMap<object, string>();
  let duplicated = false;
  const wrap = (
    delegate: D1PreparedStatement,
    sql: string
  ): D1PreparedStatement => {
    const wrapped = {
      all: <TRow>() => delegate.all<TRow>(),
      bind: (...values: unknown[]) => wrap(delegate.bind(...values), sql),
      first: <TRow>(columnName?: string) =>
        columnName === undefined
          ? delegate.first<TRow>()
          : delegate.first<TRow>(columnName),
      run: () => delegate.run(),
    } as D1PreparedStatement;
    delegateByStatement.set(wrapped, delegate);
    sqlByStatement.set(wrapped, sql);
    return wrapped;
  };

  return {
    batch: async (statements: D1PreparedStatement[]) => {
      const delegates = statements.map(
        (statement) => delegateByStatement.get(statement) ?? statement
      );
      const results = await input.db.batch(delegates);
      if (
        !duplicated &&
        statements.some((statement) =>
          input.matches(sqlByStatement.get(statement) ?? "")
        )
      ) {
        duplicated = true;
        await input.db.batch(delegates);
      }
      return results;
    },
    prepare: (sql: string) => wrap(input.db.prepare(sql), sql),
  } as D1Database;
}

export function createAfterMatchingBatchD1Database(input: {
  afterBatch(): void;
  db: D1Database;
  matches(sql: string): boolean;
}): D1Database {
  const delegateByStatement = new WeakMap<object, D1PreparedStatement>();
  const sqlByStatement = new WeakMap<object, string>();
  let afterBatchRan = false;
  const wrap = (
    delegate: D1PreparedStatement,
    sql: string
  ): D1PreparedStatement => {
    const wrapped = {
      all: <TRow>() => delegate.all<TRow>(),
      bind: (...values: unknown[]) => wrap(delegate.bind(...values), sql),
      first: <TRow>(columnName?: string) =>
        columnName === undefined
          ? delegate.first<TRow>()
          : delegate.first<TRow>(columnName),
      run: () => delegate.run(),
    } as D1PreparedStatement;
    delegateByStatement.set(wrapped, delegate);
    sqlByStatement.set(wrapped, sql);
    return wrapped;
  };

  return {
    batch: async (statements: D1PreparedStatement[]) => {
      const shouldRunAfterBatch =
        !afterBatchRan &&
        statements.some((statement) =>
          input.matches(sqlByStatement.get(statement) ?? "")
        );
      const results = await input.db.batch(
        statements.map(
          (statement) => delegateByStatement.get(statement) ?? statement
        )
      );
      if (shouldRunAfterBatch) {
        afterBatchRan = true;
        input.afterBatch();
      }
      return results;
    },
    prepare: (sql: string) => wrap(input.db.prepare(sql), sql),
  } as D1Database;
}

export type SplitDomain =
  | "openmeld-identity"
  | "openmeld-local-state"
  | "openmeld-wake-evidence"
  | "openmeld-projections";

const SPLIT_DOMAIN_SCHEMA_OVERLAY_PATHS: Readonly<
  Partial<Record<SplitDomain, readonly string[]>>
> = {
  "openmeld-local-state": ["packages/db/drizzle/0086_mushy_wolverine.sql"],
};

/**
 * Physical DB split routing gate (node side, physical-db-split.md Stage B).
 * Load exactly ONE domain's production baseline and its later canonical schema
 * migrations into an isolated in-memory D1.
 * Binding this as the per-domain handle (e.g. OPENMELD_LOCAL_STATE_DB) with NO
 * OPENMELD_DB fallback means a wired call site that misroutes to a different domain
 * hits a database that lacks the table — table names are disjoint across the
 * four baselines, so `no such table` is raised iff the routing is wrong.
 */
export function createSplitDomainD1Harness(domain: SplitDomain): {
  close(): void;
  db: D1Database;
  database: DatabaseSync;
} {
  const baselinePath = path.resolve(
    repoRootDirectoryPath,
    `packages/db/split/${domain}/0000_baseline.sql`
  );
  const database = new DatabaseSync(":memory:");
  database.exec(fs.readFileSync(baselinePath, "utf8"));
  for (const overlayPath of SPLIT_DOMAIN_SCHEMA_OVERLAY_PATHS[domain] ?? []) {
    database.exec(
      fs.readFileSync(path.resolve(repoRootDirectoryPath, overlayPath), "utf8")
    );
  }
  return {
    database,
    db: createD1Database(database),
    close: () => {
      database.close();
    },
  };
}

export function applyDrizzleMigrationForTable(
  harness: Pick<ReturnType<typeof createSqliteD1Harness>, "run">,
  tableName: string
): void {
  for (const statement of readDrizzleMigrationStatementsForTables([
    tableName,
  ])) {
    try {
      harness.run({ sql: statement });
    } catch (cause) {
      throw new Error(
        `Focused migration failed for ${tableName}: ${statement}`,
        { cause }
      );
    }
  }
}

export function applyDrizzleMigrationsForTables(
  harness: Pick<ReturnType<typeof createSqliteD1Harness>, "run">,
  tableNames: readonly string[]
): void {
  for (const statement of readDrizzleMigrationStatementsForTables(tableNames)) {
    try {
      harness.run({ sql: statement });
    } catch (cause) {
      throw new Error(
        `Focused migration failed for ${tableNames.join(", ")}: ${statement}`,
        { cause }
      );
    }
  }
}

function readDrizzleMigrationStatementsForTables(
  tableNames: readonly string[]
): readonly string[] {
  if (tableNames.length === 0) {
    return [];
  }
  const expandedTableNames = new Set(tableNames);
  if (expandedTableNames.has("center_agent_tasks")) {
    // Inbox reads now authorize Task-backed items through the Task-owned
    // projection. Keep focused Task fixtures structurally honest without
    // coupling every Inbox-only fixture to the Task schema.
    expandedTableNames.add("center_agent_task_authorized_readers");
  }
  // These focused repository fixtures read each aggregate's dependent records.
  // Declare that scope explicitly instead of accidentally importing every table
  // whose foreign keys mention a requested parent.
  if (expandedTableNames.has("openMeldRemoteAgent_native_delivery_ledger")) {
    expandedTableNames.add("openMeldRemoteAgent_work_loop_attempts");
  }
  if (
    expandedTableNames.has(
      "openMeldRemoteAgent_lark_platform_channel_connections"
    )
  ) {
    expandedTableNames.add(
      "openMeldRemoteAgent_lark_platform_channel_credentials"
    );
    expandedTableNames.add("openMeldRemoteAgent_lark_platform_identity_links");
    expandedTableNames.add("openMeldRemoteAgent_lark_platform_context_cursors");
  }
  if (expandedTableNames.has("center_agent_member_research_batches")) {
    expandedTableNames.add("center_agent_member_research_tasks");
  }
  const focusedTableNames = [...expandedTableNames];
  const migrationDirectoryPath = path.resolve(
    repoRootDirectoryPath,
    "packages/db/drizzle"
  );
  const migrationStatements = fs
    .readdirSync(migrationDirectoryPath)
    .filter((entry) => entry.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))
    .flatMap((entry) => {
      const source = fs.readFileSync(
        path.resolve(migrationDirectoryPath, entry),
        "utf8"
      );
      return source
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
    });
  const creationIndexes = focusedTableNames.map((tableName) => {
    const tableCreationPattern = new RegExp(
      String.raw`\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?\`${escapeRegExp(tableName)}\``,
      "i"
    );
    const creationIndex = migrationStatements.findIndex((statement) =>
      tableCreationPattern.test(statement)
    );
    if (creationIndex === -1) {
      throw new Error(`${tableName} migration SQL was not found`);
    }
    return creationIndex;
  });
  const firstCreationIndex = Math.min(...creationIndexes);
  const requestedTableNames = new Set(
    focusedTableNames.flatMap((tableName) => [tableName, `__new_${tableName}`])
  );
  return migrationStatements.slice(firstCreationIndex).filter((statement) => {
    // Cross-table backfills are covered by full migration-history tests.
    if (statement.includes("-- full-shared-schema-only")) {
      return false;
    }
    const requiredFocusedTableNames = [
      ...statement.matchAll(/-- focused-fixture-requires:\s*([A-Za-z0-9_]+)/gu),
    ]
      .map((match) => match[1])
      .filter((tableName): tableName is string => tableName !== undefined);
    if (
      requiredFocusedTableNames.some(
        (tableName) => !expandedTableNames.has(tableName)
      )
    ) {
      return false;
    }
    const createdTableName = readCreatedTableName(statement);
    const sql = statement.replace(SQL_LINE_COMMENT_PATTERN, "").trim();
    const ownedTableName =
      createdTableName ??
      sql.match(MUTATED_TABLE_NAME_PATTERN)?.[1] ??
      sql.match(INDEX_OR_TRIGGER_TABLE_NAME_PATTERN)?.[1];
    if (ownedTableName && !requestedTableNames.has(ownedTableName)) {
      // A foreign-key reference does not make the referencing table part of
      // this fixture. This applies to original tables as well as rebuilds:
      // admitting an unrelated child can make a later DROP require its other
      // foreign-key dependencies even when the child is empty.
      return false;
    }
    return focusedTableNames.some((tableName) => {
      const temporaryTableName = `__new_${tableName}`;
      return (
        statement.includes(`\`${tableName}\``) ||
        statement.includes(`DROP INDEX \`${tableName}_`) ||
        statement.includes(`DROP TRIGGER \`${tableName}_`) ||
        statement.includes(`\`${temporaryTableName}\``) ||
        statement.includes(`_${tableName}_`)
      );
    });
  });
}

function readCreatedTableName(statement: string): string | null {
  const match = statement
    .replace(SQL_LINE_COMMENT_PATTERN, "")
    .trim()
    .match(CREATE_TABLE_NAME_PATTERN);
  return match?.[1] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createD1Database(database: DatabaseSync): D1Database {
  return {
    batch: (statements: D1PreparedStatement[]) => {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) =>
          runPreparedStatementInTransaction(statement)
        );
        database.exec("COMMIT");
        return Promise.resolve(results as D1Result[]);
      } catch (error) {
        database.exec("ROLLBACK");
        return Promise.reject(error);
      }
    },
    prepare: (sql: string) =>
      createPreparedStatement(database.prepare(sql), []) as D1PreparedStatement,
  } as D1Database;
}

function createPreparedStatement(
  statement: StatementSync,
  params: readonly SqliteBindValue[]
): TestPreparedStatement {
  return {
    bind: (...nextParams: unknown[]) =>
      createPreparedStatement(
        statement,
        nextParams as readonly SqliteBindValue[]
      ) as D1PreparedStatement,
    first: <TRow>(columnName?: string) => {
      const row = statement.get(...params) as
        | Record<string, unknown>
        | undefined;
      if (!row) {
        return Promise.resolve(null as TRow | null);
      }
      if (columnName) {
        return Promise.resolve((row[columnName] as TRow | undefined) ?? null);
      }
      return Promise.resolve(row as TRow);
    },
    all: <TRow>() =>
      Promise.resolve({
        results: statement.all(...params) as TRow[],
        success: true,
      }),
    run: async () => toD1RunResult(statement.run(...params)),
    // D1 batch SELECTs return rows (verified by tests/d1-read-batch.test.ts).
    // Keep the existing mutation path and change-count semantics intact.
    [RUN_IN_TRANSACTION]: () =>
      statement.sourceSQL.trimStart().toLowerCase().startsWith("select")
        ? {
            ...toD1RunResult({ changes: 0 }),
            results: statement.all(...params),
          }
        : toD1RunResult(statement.run(...params)),
  } as TestPreparedStatement;
}

function runPreparedStatementInTransaction(
  statement: D1PreparedStatement
): unknown {
  const candidate = statement as Partial<TestPreparedStatement>;
  if (typeof candidate[RUN_IN_TRANSACTION] !== "function") {
    throw new Error("sqlite D1 harness received an unknown prepared statement");
  }

  return candidate[RUN_IN_TRANSACTION]();
}

function toD1RunResult(
  result: Pick<{ changes: number | bigint }, "changes">
): D1Result {
  return {
    success: true,
    meta: {
      changes: Number(result.changes),
    },
  } as D1Result;
}
