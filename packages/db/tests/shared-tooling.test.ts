import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CORE_DB_SCHEMA_DEFINITION_PATH } from "../src/core/fact-metadata.ts";
import {
  AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH,
  AUTH_DB_DRIZZLE_CONFIG_PATH,
  AUTH_DB_MIGRATIONS_PATH,
  D1_LOCAL_DB_PATH_ENV_NAME,
  SHARED_DB_SCHEMA_ENTRYPOINT_PATH,
} from "../src/index";
import { LATEST_SHARED_MIGRATION_ID } from "../src/shared/fact-metadata.ts";
import {
  buildSharedToolingDbFactSnapshot,
  getRepoRootDirectoryPath,
  resolveSharedDrizzleConfigInput,
  runSharedDbCheck,
  runSharedDbGenerate,
  runSharedDbInspect,
  runSharedDbMigrate,
  runSharedDbVerify,
} from "../src/tooling";
import { SHARED_DB_EXECUTION_MODE_ENV_NAME } from "../src/tooling/db-execution-mode.ts";
import {
  buildUnsupportedLegacyCoreDispatchTableNames,
  UNSUPPORTED_LEGACY_CORE_DISPATCH_SCHEMA_SHAPE_BLOCKED_REASON,
} from "../src/tooling/shared-db-unsupported-legacy-shape.ts";
import { DEV_WRANGLER_STATE_DIRECTORY_ENV_NAME } from "../src/tooling/wrangler-d1-target.ts";
import {
  captureDbToolingEnv,
  restoreDbToolingEnv,
} from "./helpers/db-tooling-env.ts";
import { createSharedPhysicalContractRunner } from "./helpers/shared-physical-contract-runner.ts";
import {
  applySharedMigrationChain,
  type BetterSqliteDatabase,
  createCanonicalSharedLocalFixture,
  createSharedLocalFixture,
  DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS,
} from "./helpers/shared-sqlite-fixture.ts";

const originalDbToolingEnv = captureDbToolingEnv();
type SqliteIndexNameRow = { name: string };
type SqliteIndexListRow = {
  name: string;
  origin?: string;
  pk?: number;
  unique: number;
};
type SqliteIndexXInfoRow = {
  desc?: number;
  key: number;
  name: string;
  seqno: number;
};
type SqliteTableInfoRow = { name: string; pk: number };

beforeEach(async () => {
  // This suite runs synchronous Wrangler and SQLite child processes. Yield
  // between tests so Vitest can acknowledge worker updates even when a busy CI
  // runner stretches the full file beyond its internal RPC timeout.
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
});

afterEach(() => {
  restoreDbToolingEnv(originalDbToolingEnv);
});

const readNonPrimaryKeyUniqueConstraintKeys = (
  database: BetterSqliteDatabase,
  tableName: string
): string[] => {
  const primaryKeyKey = database
    .prepare<[], SqliteTableInfoRow>(`PRAGMA table_info('${tableName}');`)
    .all()
    .filter((row) => Number(row.pk) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map((row) => row.name.trim().toLowerCase())
    .join("|");

  return database
    .prepare<[], SqliteIndexListRow>(`PRAGMA index_list('${tableName}');`)
    .all()
    .filter((row) => Number(row.unique) === 1)
    .map((row) => {
      return database
        .prepare<[], SqliteIndexXInfoRow>(`PRAGMA index_xinfo('${row.name}');`)
        .all()
        .filter((column) => Number(column.key) === 1)
        .sort((left, right) => Number(left.seqno) - Number(right.seqno))
        .map((column) => column.name.trim().toLowerCase())
        .join("|");
    })
    .filter((constraintKey: string) => constraintKey.length > 0)
    .filter((constraintKey: string) => constraintKey !== primaryKeyKey)
    .sort();
};

const readNamedUniqueIndexNames = (
  database: BetterSqliteDatabase,
  tableName: string
): string[] => {
  return database
    .prepare<[], SqliteIndexListRow>(`PRAGMA index_list('${tableName}');`)
    .all()
    .filter((row) => Number(row.unique) === 1)
    .filter((row) => String(row.origin ?? "").trim() === "c")
    .map((row) => String(row.name).trim())
    .sort();
};

const readTableColumnNames = (
  database: BetterSqliteDatabase,
  tableName: string
): string[] => {
  return database
    .prepare<[], SqliteIndexNameRow>(`PRAGMA table_info('${tableName}');`)
    .all()
    .map((row) => row.name.trim().toLowerCase());
};

const readDispatchColumnsByTableName = (
  database: BetterSqliteDatabase
): Map<string, string[]> => {
  const columnsByTableName = new Map<string, string[]>();

  for (const tableName of [
    "openMeldDaemon_dispatch_attempts",
    "openMeldDaemon_dispatch_results",
    "openMeldDaemon_dispatch_ledger",
  ]) {
    const columnNames = readTableColumnNames(database, tableName);
    if (columnNames.length > 0) {
      columnsByTableName.set(tableName, columnNames);
    }
  }

  return columnsByTableName;
};

const seedLegacyCoreDispatchTables = (database: BetterSqliteDatabase) => {
  database.exec(`
    CREATE TABLE openMeldDaemon_dispatch_attempts (
      attempt_id TEXT PRIMARY KEY NOT NULL,
      dispatch_id TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL,
      attempt_no INTEGER NOT NULL,
      status TEXT NOT NULL,
      daemon_session_id TEXT,
      lease_epoch INTEGER,
      created_at_ms INTEGER NOT NULL,
      started_at_ms INTEGER,
      finished_at_ms INTEGER,
      error_code TEXT,
      error_message TEXT
    );

    INSERT INTO openMeldDaemon_dispatch_attempts (
      attempt_id,
      dispatch_id,
      idempotency_key,
      attempt_no,
      status,
      daemon_session_id,
      lease_epoch,
      created_at_ms,
      started_at_ms,
      finished_at_ms,
      error_code,
      error_message
    ) VALUES (
      'attempt-1',
      'dispatch-1',
      'idem-1',
      1,
      'queued',
      'daemon-1',
      7,
      1000,
      1010,
      1020,
      NULL,
      NULL
    );

    CREATE TABLE openMeldDaemon_dispatch_results (
      result_ref TEXT PRIMARY KEY NOT NULL,
      dispatch_id TEXT NOT NULL UNIQUE,
      space_id TEXT NOT NULL,
      actor_profile_id TEXT NOT NULL,
      reply_to_signal_id TEXT,
      result_kind TEXT NOT NULL,
      final_text TEXT,
      status_type TEXT,
      preview_text TEXT,
      public_outcome TEXT NOT NULL,
      published_signal_id TEXT,
      created_at_ms INTEGER NOT NULL
    );

    INSERT INTO openMeldDaemon_dispatch_results (
      result_ref,
      dispatch_id,
      space_id,
      actor_profile_id,
      reply_to_signal_id,
      result_kind,
      final_text,
      status_type,
      preview_text,
      public_outcome,
      published_signal_id,
      created_at_ms
    ) VALUES (
      'result-1',
      'dispatch-1',
      'space-1',
      'profile-1',
      'signal-1',
      'reply',
      'done',
      'ok',
      'preview',
      'published',
      'published-signal-1',
      2000
    );

    CREATE TABLE openMeldDaemon_dispatch_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      dispatch_id TEXT NOT NULL,
      space_id TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      target_profile_id TEXT NOT NULL,
      status TEXT NOT NULL,
      first_seen_at_ms INTEGER NOT NULL,
      last_attempt_at_ms INTEGER NOT NULL,
      attempt_count INTEGER NOT NULL
    );

    INSERT INTO openMeldDaemon_dispatch_ledger (
      id,
      idempotency_key,
      dispatch_id,
      space_id,
      source_event_id,
      target_profile_id,
      status,
      first_seen_at_ms,
      last_attempt_at_ms,
      attempt_count
    ) VALUES (
      1,
      'idem-1',
      'dispatch-1',
      'space-1',
      'source-1',
      'profile-1',
      'queued',
      3000,
      3010,
      1
    );
  `);
};

const seedCurrentSharedCoreDispatchTables = (
  database: BetterSqliteDatabase
) => {
  applySharedMigrationChain(database);

  database.exec(`
    INSERT INTO openMeldDaemon_dispatch_attempts (
      attempt_id,
      dispatch_id,
      idempotency_key,
      attempt_no,
      status,
      daemon_session_id,
      connection_generation,
      lease_epoch,
      created_at_ms,
      started_at_ms,
      finished_at_ms,
      error_code,
      error_message
    ) VALUES (
      'attempt-1',
      'dispatch-1',
      'idem-1',
      1,
      'queued',
      'daemon-1',
      9,
      7,
      1000,
      1010,
      1020,
      NULL,
      NULL
    );

    INSERT INTO openMeldDaemon_dispatch_results (
      result_ref,
      dispatch_id,
      space_id,
      actor_profile_id,
      actor_name,
      reply_to_signal_id,
      result_kind,
      final_text,
      message_envelope_json,
      status_type,
      preview_text,
      public_outcome,
      published_signal_id,
      created_at_ms
    ) VALUES (
      'result-1',
      'dispatch-1',
      'space-1',
      'profile-1',
      'Agent One',
      'signal-1',
      'reply',
      'done',
      '{"kind":"message"}',
      'ok',
      'preview',
      'published',
      'published-signal-1',
      2000
    );

    INSERT INTO openMeldDaemon_dispatch_ledger (
      id,
      idempotency_key,
      dispatch_id,
      space_id,
      source_event_id,
      target_profile_id,
      status,
      first_seen_at_ms,
      last_attempt_at_ms,
      attempt_count,
      latest_attempt_id,
      reply_hint_sent_at_ms,
      final_reply_sent_at_ms
    ) VALUES (
      1,
      'idem-1',
      'dispatch-1',
      'space-1',
      'source-1',
      'profile-1',
      'queued',
      3000,
      3010,
      1,
      'attempt-1',
      3020,
      3030
    );
  `);
};

const createLegacySharedLocalFixture = (
  label: string
): { cleanup: () => void; sqlitePath: string } => {
  return createSharedLocalFixture(label, (database) => {
    applySharedMigrationChain(database);
    database.exec(`
      DROP TABLE openMeldDaemon_dispatch_attempts;
      DROP TABLE openMeldDaemon_dispatch_results;
      DROP TABLE openMeldDaemon_dispatch_ledger;
    `);
    seedLegacyCoreDispatchTables(database);
  });
};

const buildObjectShapePhysicalContractRunner = () => {
  const baseRunner = createSharedPhysicalContractRunner();

  return ({ args }: { args: string[] }) => {
    const result = baseRunner({ args });
    if (!(args.includes("execute") && args.includes("--json"))) {
      return result;
    }

    if (result.stdout.trim().length === 0) {
      return result;
    }

    const parsed = JSON.parse(result.stdout) as Array<{ results?: unknown[] }>;
    if (parsed.length > 1) {
      return result;
    }

    const firstEntry = parsed[0] ?? {};
    return {
      ...result,
      stdout: JSON.stringify(firstEntry),
    };
  };
};

describe("shared db tooling", () => {
  it("builds a shared tooling snapshot from the shared OPENMELD_DB metadata", () => {
    const snapshot = buildSharedToolingDbFactSnapshot();

    expect(snapshot.subject).toBe("shared");
    expect(snapshot.schemaSources.map((item) => item.path)).toEqual(
      expect.arrayContaining([
        SHARED_DB_SCHEMA_ENTRYPOINT_PATH,
        AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH,
        AUTH_DB_DRIZZLE_CONFIG_PATH,
        CORE_DB_SCHEMA_DEFINITION_PATH,
      ])
    );
    expect(snapshot.migrationSources.map((item) => item.path)).toEqual([
      AUTH_DB_MIGRATIONS_PATH,
    ]);
  });

  it("resolves a shared drizzle config that points at the shared schema entrypoint", () => {
    process.env.NODE_ENV = "development";
    process.env[D1_LOCAL_DB_PATH_ENV_NAME] = "/tmp/openmeld-shared.sqlite";

    const config = resolveSharedDrizzleConfigInput("/tmp");

    expect(config.schema).toEqual([
      path.resolve(
        getRepoRootDirectoryPath(),
        SHARED_DB_SCHEMA_ENTRYPOINT_PATH
      ),
    ]);
    expect(config.out).toBe(
      path.relative(
        path.resolve(getRepoRootDirectoryPath(), "packages/db"),
        path.resolve(getRepoRootDirectoryPath(), AUTH_DB_MIGRATIONS_PATH)
      )
    );
    expect(config.dbCredentials).toEqual({
      url: path.resolve("/tmp/openmeld-shared.sqlite"),
    });
  });

  it(
    "returns no_diff when shared db:check sees a clean shared schema state",
    () => {
      const fixture = createCanonicalSharedLocalFixture("check-no-diff");
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;

      try {
        const summary = runSharedDbCheck({
          runner: ({ args }) => {
            if (args.includes("check")) {
              return {
                status: 0,
                stdout: "Everything's fine\n",
                stderr: "",
              };
            }

            return {
              status: 0,
              stdout: "",
              stderr: "",
            };
          },
        });

        expect(summary.subject).toBe("shared");
        expect(summary.phase).toBe("migration_phase");
        expect(summary.cwd).toBe(process.cwd());
        expect(summary.result).toBe("no_diff");
        expect(summary.snapshot.subject).toBe("shared");
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it("runs shared db:check against the prod target when the shared DB execution mode is prod", () => {
    process.env[SHARED_DB_EXECUTION_MODE_ENV_NAME] = "prod";
    process.env.CLOUDFLARE_ACCOUNT_ID = "acc";
    process.env.CLOUDFLARE_D1_DATABASE_ID = "db";
    process.env.CLOUDFLARE_API_TOKEN = "token";

    const observedCalls: Array<{ args: string[]; cwd: string }> = [];
    const summary = runSharedDbCheck({
      runner: ({ args, cwd }) => {
        observedCalls.push({ args, cwd });
        return {
          status: 0,
          stdout: "Everything's fine\n",
          stderr: "",
        };
      },
    });

    expect(summary.result).toBe("no_diff");
    expect(summary.phase).toBe("migration_phase");
    expect(summary.cwd).toBe(process.cwd());
    expect(summary.snapshot.target.targetKind).toBe("d1_http");
    expect(summary.snapshot.target.databaseId).toBe("db");
    expect(summary.snapshot.target.databaseName).toBe("openmeld-db-prod");
    expect(summary.snapshot.target.resolvedFrom).toBe("cloudflare_env");
    expect(observedCalls).toEqual([
      {
        args: ["exec", "drizzle-kit", "check", "--config", "drizzle.config.ts"],
        cwd: path.resolve(getRepoRootDirectoryPath(), "packages/db"),
      },
    ]);
  });

  it("passes an explicit shared db:check mode to the Drizzle subprocess", () => {
    process.env[SHARED_DB_EXECUTION_MODE_ENV_NAME] = "prod";

    let observedExecutionMode: string | undefined;
    const summary = runSharedDbCheck({
      mode: "dev",
      runner: ({ env }) => {
        observedExecutionMode = env?.[SHARED_DB_EXECUTION_MODE_ENV_NAME];
        return {
          status: 0,
          stdout: "Everything's fine\n",
          stderr: "",
        };
      },
    });

    expect(summary.result).toBe("no_diff");
    expect(summary.snapshot.target.targetKind).toBe("d1_local_sqlite");
    expect(observedExecutionMode).toBe("dev");
  });

  it(
    "keeps shared db:check focused on committed migration drift only",
    () => {
      const fixture = createCanonicalSharedLocalFixture("check-drift");
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;

      const database = new Database(fixture.sqlitePath);
      database.exec(
        "DROP INDEX idx_openMeldDaemon_dispatch_results_actor_created;"
      );
      database.close();

      try {
        const summary = runSharedDbCheck({
          runner: ({ args }) => {
            if (args.includes("check")) {
              return {
                status: 0,
                stdout: "Everything's fine\n",
                stderr: "",
              };
            }

            return {
              status: 0,
              stdout: "",
              stderr: "",
            };
          },
        });

        expect(summary.subject).toBe("shared");
        expect(summary.phase).toBe("migration_phase");
        expect(summary.result).toBe("no_diff");
        expect(summary.blockedReason).toBeNull();
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it(
    "reports a missing local worker database as migratable drift",
    () => {
      const stateDirectoryPath = fs.mkdtempSync(
        path.join(os.tmpdir(), "openmeld-shared-db-missing-")
      );
      const previousStateDirectory =
        process.env[DEV_WRANGLER_STATE_DIRECTORY_ENV_NAME];
      Reflect.deleteProperty(process.env, D1_LOCAL_DB_PATH_ENV_NAME);
      process.env[DEV_WRANGLER_STATE_DIRECTORY_ENV_NAME] = stateDirectoryPath;

      try {
        const summary = runSharedDbVerify({
          mode: "dev",
          runner: () => ({
            status: 0,
            stdout: "",
            stderr: "",
          }),
        });

        expect(summary.command).toBe("db:verify:dev");
        expect(summary.result).toBe("diff_detected");
        expect(summary.blockedReason).toContain(
          "local OPENMELD_DB has not been initialized"
        );
      } finally {
        fs.rmSync(stateDirectoryPath, { force: true, recursive: true });
        if (typeof previousStateDirectory === "undefined") {
          Reflect.deleteProperty(
            process.env,
            DEV_WRANGLER_STATE_DIRECTORY_ENV_NAME
          );
        } else {
          process.env[DEV_WRANGLER_STATE_DIRECTORY_ENV_NAME] =
            previousStateDirectory;
        }
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it(
    "recognizes generated columns in the local physical contract",
    () => {
      const fixture = createCanonicalSharedLocalFixture(
        "verify-generated-columns"
      );
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;

      try {
        const summary = runSharedDbVerify({
          mode: "dev",
          runner: () => ({
            status: 0,
            stdout: "",
            stderr: "",
          }),
        });

        expect(summary.command).toBe("db:verify:dev");
        expect(summary.result).toBe("no_diff");
        expect(summary.blockedReason).toBeNull();
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it(
    "returns diff_detected when shared db:verify sees a local worker OPENMELD_DB physical contract drift",
    () => {
      const fixture = createCanonicalSharedLocalFixture("verify-drift");
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;

      const database = new Database(fixture.sqlitePath);
      database.exec(
        "DROP INDEX idx_openMeldDaemon_dispatch_results_actor_created;"
      );
      database.close();

      try {
        const summary = runSharedDbVerify({
          mode: "dev",
          runner: () => ({
            status: 0,
            stdout: "",
            stderr: "",
          }),
        });

        expect(summary.command).toBe("db:verify:dev");
        expect(summary.phase).toBe("migration_phase");
        expect(summary.result).toBe("diff_detected");
        expect(summary.blockedReason).toContain("auth local OPENMELD_DB");
        expect(summary.blockedReason).toContain(
          "required index idx_openMeldDaemon_dispatch_results_actor_created"
        );
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it(
    "returns diff_detected when the local worker database has not applied the latest shared migration",
    () => {
      const fixture = createCanonicalSharedLocalFixture(
        "verify-applied-migration-drift"
      );
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;

      const database = new Database(fixture.sqlitePath);
      database.exec(
        `DELETE FROM d1_migrations WHERE id = ${LATEST_SHARED_MIGRATION_ID};`
      );
      database.close();

      try {
        const summary = runSharedDbVerify({
          mode: "dev",
          runner: () => ({
            status: 0,
            stdout: "",
            stderr: "",
          }),
        });

        expect(summary.command).toBe("db:verify:dev");
        expect(summary.result).toBe("diff_detected");
        expect(summary.blockedReason).toContain("auth local OPENMELD_DB");
        expect(summary.blockedReason).toContain(
          `applied migration id ${LATEST_SHARED_MIGRATION_ID - 1}`
        );
        expect(summary.blockedReason).toContain(
          `expected migration id ${LATEST_SHARED_MIGRATION_ID}`
        );
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it(
    "returns diff_detected when shared db:verify sees a diagnostics physical contract drift",
    () => {
      const fixture = createCanonicalSharedLocalFixture(
        "verify-diagnostics-drift"
      );
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;

      const database = new Database(fixture.sqlitePath);
      database.exec(
        "DROP TABLE openMeldDaemon_space_diagnostic_report_wake_pointers;"
      );
      database.close();

      try {
        const summary = runSharedDbVerify({
          mode: "dev",
          runner: () => ({
            status: 0,
            stdout: "",
            stderr: "",
          }),
        });

        expect(summary.command).toBe("db:verify:dev");
        expect(summary.phase).toBe("migration_phase");
        expect(summary.result).toBe("diff_detected");
        expect(summary.blockedReason).toContain("auth local OPENMELD_DB");
        expect(summary.blockedReason).toContain(
          "required table openMeldDaemon_space_diagnostic_report_wake_pointers"
        );
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it(
    "returns ready when shared db:inspect sees a canonical target shape",
    () => {
      const fixture = createCanonicalSharedLocalFixture("inspect-ready");
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;

      try {
        const summary = runSharedDbInspect({
          runner: () => {
            return {
              status: 0,
              stdout: "",
              stderr: "",
            };
          },
        });

        expect(summary.command).toBe("db:inspect:dev");
        expect(summary.subject).toBe("shared");
        expect(summary.mode).toBe("dev");
        expect(summary.result).toBe("ready");
        expect(summary.blockedReason).toBeNull();
        expect(summary.checks.legacyCoreDispatchShape.status).toBe("ok");
        expect(summary.checks.sharedCoreDispatchPhysicalContract.status).toBe(
          "ok"
        );
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it(
    "returns drift_detected when shared db:inspect sees an unsupported legacy dispatch shape",
    () => {
      const fixture = createLegacySharedLocalFixture("inspect-legacy");
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;

      try {
        const summary = runSharedDbInspect({
          runner: () => {
            return {
              status: 0,
              stdout: "",
              stderr: "",
            };
          },
        });

        expect(summary.result).toBe("drift_detected");
        expect(summary.blockedReason).toBeNull();
        expect(summary.checks.legacyCoreDispatchShape.status).toBe(
          "drift_detected"
        );
        expect(summary.checks.legacyCoreDispatchShape.detail).toContain(
          `auth local OPENMELD_DB: ${UNSUPPORTED_LEGACY_CORE_DISPATCH_SCHEMA_SHAPE_BLOCKED_REASON}`
        );
        expect(summary.checks.legacyCoreDispatchShape.detail).toContain(
          "unsupported tables: openMeldDaemon_dispatch_attempts, openMeldDaemon_dispatch_results, openMeldDaemon_dispatch_ledger"
        );
        expect(summary.checks.sharedCoreDispatchPhysicalContract.status).toBe(
          "drift_detected"
        );
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it("prefers the blocked check detail when only one inspect check is blocked", () => {
    const canonicalRunner = createSharedPhysicalContractRunner();
    const observedSqlCounts = new Map<string, number>();

    process.env[SHARED_DB_EXECUTION_MODE_ENV_NAME] = "prod";
    process.env.CLOUDFLARE_ACCOUNT_ID = "acc";
    process.env.CLOUDFLARE_D1_DATABASE_ID = "db";
    process.env.CLOUDFLARE_API_TOKEN = "token";

    const summary = runSharedDbInspect({
      mode: "prod",
      runner: ({ args }) => {
        if (!(args.includes("execute") && args.includes("--json"))) {
          return {
            status: 0,
            stdout: "",
            stderr: "",
          };
        }

        const sql = args[args.indexOf("--command") + 1] ?? "";
        const callCount = (observedSqlCounts.get(sql) ?? 0) + 1;
        observedSqlCounts.set(sql, callCount);

        if (
          sql.includes(
            "PRAGMA table_info('openMeldDaemon_dispatch_attempts')"
          ) &&
          callCount === 1
        ) {
          return {
            status: 0,
            stdout:
              '[{"results":[{"name":"attempt_id","type":"TEXT","notnull":1,"pk":1},{"name":"dispatch_id","type":"TEXT","notnull":1,"pk":0}],"success":true}]',
            stderr: "",
          };
        }
        if (sql.toLowerCase().includes("pragma_index_list")) {
          return {
            status: 1,
            stdout: "",
            stderr: "physical contract inspection failed",
          };
        }

        return canonicalRunner({ args });
      },
    });

    expect(summary.result).toBe("blocked");
    expect(summary.checks.legacyCoreDispatchShape.status).toBe(
      "drift_detected"
    );
    expect(summary.checks.sharedCoreDispatchPhysicalContract.status).toBe(
      "blocked"
    );
    expect(summary.blockedReason).toContain(
      "physical contract inspection failed"
    );
    expect(summary.blockedReason).not.toContain("unsupported tables:");
  });

  it(
    "returns no_diff when shared db:generate sees no new migration artifacts",
    () => {
      const fixture = createCanonicalSharedLocalFixture("generate-no-diff");
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;
      const tempDirectoryPath = fs.mkdtempSync(
        path.join(os.tmpdir(), "openmeld-shared-db-generate-no-diff-")
      );
      const migrationDirectoryPath = path.join(tempDirectoryPath, "drizzle");
      fs.mkdirSync(migrationDirectoryPath, { recursive: true });
      fs.writeFileSync(
        path.join(migrationDirectoryPath, "_journal.json"),
        "{}"
      );

      try {
        const summary = runSharedDbGenerate({
          migrationDirectoryPath,
          packagesDbDirectoryPath: tempDirectoryPath,
          runner: ({ args }) => {
            if (args.includes("check")) {
              return { status: 0, stdout: "", stderr: "" };
            }

            return { status: 0, stdout: "", stderr: "" };
          },
        });

        expect(summary.subject).toBe("shared");
        expect(summary.phase).toBe("migration_phase");
        expect(summary.result).toBe("no_diff");
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it(
    "returns applied when shared db:generate writes a migration artifact",
    () => {
      const fixture = createCanonicalSharedLocalFixture("generate-applied");
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;
      const tempDirectoryPath = fs.mkdtempSync(
        path.join(os.tmpdir(), "openmeld-shared-db-generate-applied-")
      );
      const migrationDirectoryPath = path.join(tempDirectoryPath, "drizzle");
      fs.mkdirSync(migrationDirectoryPath, { recursive: true });
      fs.writeFileSync(
        path.join(migrationDirectoryPath, "_journal.json"),
        "{}"
      );

      try {
        const summary = runSharedDbGenerate({
          migrationDirectoryPath,
          packagesDbDirectoryPath: tempDirectoryPath,
          runner: ({ args }) => {
            if (args.includes("check")) {
              return { status: 0, stdout: "", stderr: "" };
            }

            if (args.includes("generate")) {
              fs.writeFileSync(
                path.join(migrationDirectoryPath, "0005_shared_gate.sql"),
                "-- migration"
              );
            }

            return { status: 0, stdout: "", stderr: "" };
          },
        });

        expect(summary.subject).toBe("shared");
        expect(summary.phase).toBe("migration_phase");
        expect(summary.result).toBe("applied");
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it(
    "returns applied when auth codegen changes the canonical generated schema file",
    () => {
      const fixture = createCanonicalSharedLocalFixture("generate-codegen");
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;
      const tempDirectoryPath = fs.mkdtempSync(
        path.join(os.tmpdir(), "openmeld-shared-db-generate-generated-schema-")
      );
      const migrationDirectoryPath = path.join(tempDirectoryPath, "drizzle");
      const generatedSchemaPath = path.join(
        tempDirectoryPath,
        "src",
        "auth",
        "auth.schema.ts"
      );
      fs.mkdirSync(migrationDirectoryPath, { recursive: true });
      fs.mkdirSync(path.dirname(generatedSchemaPath), { recursive: true });
      fs.writeFileSync(
        path.join(migrationDirectoryPath, "_journal.json"),
        "{}"
      );
      fs.writeFileSync(generatedSchemaPath, "// before\n");

      try {
        const summary = runSharedDbGenerate({
          generatedSchemaPath,
          migrationDirectoryPath,
          packagesDbDirectoryPath: tempDirectoryPath,
          runner: ({ args }) => {
            if (args.includes("check")) {
              return { status: 0, stdout: "", stderr: "" };
            }

            if (args.includes("auth:generate")) {
              fs.writeFileSync(generatedSchemaPath, "// after\n");
            }

            return { status: 0, stdout: "", stderr: "" };
          },
        });

        expect(summary.subject).toBe("shared");
        expect(summary.phase).toBe("migration_phase");
        expect(summary.result).toBe("applied");
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it(
    "allows shared db:generate to emit core migration SQL now that core is versioned",
    () => {
      const fixture = createCanonicalSharedLocalFixture(
        "generate-core-migration"
      );
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;
      const tempDirectoryPath = fs.mkdtempSync(
        path.join(os.tmpdir(), "openmeld-shared-db-generate-core-migration-")
      );
      const migrationDirectoryPath = path.join(tempDirectoryPath, "drizzle");
      const generatedMigrationPath = path.join(
        migrationDirectoryPath,
        "0006_core_dispatch.sql"
      );
      fs.mkdirSync(migrationDirectoryPath, { recursive: true });
      fs.writeFileSync(
        path.join(migrationDirectoryPath, "_journal.json"),
        "{}"
      );

      try {
        const summary = runSharedDbGenerate({
          migrationDirectoryPath,
          packagesDbDirectoryPath: tempDirectoryPath,
          runner: ({ args }) => {
            if (args.includes("check")) {
              return { status: 0, stdout: "", stderr: "" };
            }

            if (args.includes("generate")) {
              fs.writeFileSync(
                generatedMigrationPath,
                "CREATE TABLE `openMeldDaemon_dispatch_results` (`id` text PRIMARY KEY);"
              );
            }

            return { status: 0, stdout: "", stderr: "" };
          },
        });

        expect(summary.subject).toBe("shared");
        expect(summary.phase).toBe("migration_phase");
        expect(summary.result).toBe("applied");
        expect(summary.blockedReason).toBeNull();
        expect(fs.existsSync(generatedMigrationPath)).toBe(true);
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it(
    "keeps the greenfield baseline aligned with Core retry semantics",
    () => {
      const sqlitePath = path.join(
        os.tmpdir(),
        `openmeld-shared-core-physical-${Date.now()}.sqlite`
      );
      const database = new Database(sqlitePath);

      try {
        applySharedMigrationChain(database);

        expect(
          readNonPrimaryKeyUniqueConstraintKeys(
            database,
            "openMeldDaemon_dispatch_attempts"
          )
        ).toEqual([]);
        expect(
          readNonPrimaryKeyUniqueConstraintKeys(
            database,
            "openMeldDaemon_dispatch_ledger"
          )
        ).toEqual(["idempotency_key"]);
        expect(
          readNonPrimaryKeyUniqueConstraintKeys(
            database,
            "openMeldDaemon_dispatch_results"
          )
        ).toEqual(["dispatch_id"]);
        expect(
          readNamedUniqueIndexNames(database, "openMeldDaemon_dispatch_ledger")
        ).toEqual(["openMeldDaemon_dispatch_ledger_idempotency_key_unique"]);
        expect(
          database
            .prepare<[], SqliteIndexNameRow>(
              `PRAGMA index_list('openMeldDaemon_dispatch_ledger');`
            )
            .all()
            .map((row) => row.name.trim())
            .filter((name) =>
              name.startsWith("idx_openMeldDaemon_dispatch_ledger_")
            )
            .sort()
        ).toEqual([
          "idx_openMeldDaemon_dispatch_ledger_dispatch_id",
          "idx_openMeldDaemon_dispatch_ledger_space_client_message_target",
          "idx_openMeldDaemon_dispatch_ledger_space_source_target",
          "idx_openMeldDaemon_dispatch_ledger_status_last_attempt",
        ]);
        expect(
          readNamedUniqueIndexNames(database, "openMeldDaemon_dispatch_results")
        ).toEqual(["openMeldDaemon_dispatch_results_dispatch_id_unique"]);
      } finally {
        database.close();
        fs.rmSync(sqlitePath, { force: true });
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it("treats pre-unification dispatch tables as an unsupported legacy shape", () => {
    const sqlitePath = path.join(
      os.tmpdir(),
      `openmeld-shared-core-legacy-shape-${Date.now()}.sqlite`
    );
    const database = new Database(sqlitePath);

    try {
      seedLegacyCoreDispatchTables(database);
      expect(
        buildUnsupportedLegacyCoreDispatchTableNames({
          columnsByTableName: readDispatchColumnsByTableName(database),
        })
      ).toEqual([
        "openMeldDaemon_dispatch_attempts",
        "openMeldDaemon_dispatch_results",
        "openMeldDaemon_dispatch_ledger",
      ]);
    } finally {
      database.close();
      fs.rmSync(sqlitePath, { force: true });
    }
  });

  it("stores current Core dispatch data on the greenfield baseline", () => {
    const sqlitePath = path.join(
      os.tmpdir(),
      `openmeld-shared-core-current-upgrade-${Date.now()}.sqlite`
    );
    const database = new Database(sqlitePath);

    try {
      seedCurrentSharedCoreDispatchTables(database);

      expect(
        database
          .prepare<
            [],
            {
              connection_generation: number | null;
              dispatch_id: string;
              lease_epoch: number | null;
            }
          >(
            "SELECT dispatch_id, lease_epoch, connection_generation FROM openMeldDaemon_dispatch_attempts WHERE attempt_id = 'attempt-1';"
          )
          .all()[0]
      ).toEqual({
        connection_generation: 9,
        dispatch_id: "dispatch-1",
        lease_epoch: 7,
      });

      expect(
        database
          .prepare<
            [],
            {
              actor_name: string | null;
              dispatch_id: string;
              final_text: string | null;
              message_envelope_json: string | null;
            }
          >(
            "SELECT dispatch_id, actor_name, message_envelope_json, final_text FROM openMeldDaemon_dispatch_results WHERE result_ref = 'result-1';"
          )
          .all()[0]
      ).toEqual({
        actor_name: "Agent One",
        dispatch_id: "dispatch-1",
        final_text: "done",
        message_envelope_json: '{"kind":"message"}',
      });

      expect(
        database
          .prepare<
            [],
            {
              attempt_count: number;
              dispatch_id: string;
              final_reply_sent_at_ms: number | null;
              latest_attempt_id: string | null;
              reply_hint_sent_at_ms: number | null;
            }
          >(
            "SELECT dispatch_id, latest_attempt_id, reply_hint_sent_at_ms, final_reply_sent_at_ms, attempt_count FROM openMeldDaemon_dispatch_ledger WHERE id = 1;"
          )
          .all()[0]
      ).toEqual({
        attempt_count: 1,
        dispatch_id: "dispatch-1",
        final_reply_sent_at_ms: 3030,
        latest_attempt_id: "attempt-1",
        reply_hint_sent_at_ms: 3020,
      });

      expect(
        readNonPrimaryKeyUniqueConstraintKeys(
          database,
          "openMeldDaemon_dispatch_attempts"
        )
      ).toEqual([]);
      expect(
        readNonPrimaryKeyUniqueConstraintKeys(
          database,
          "openMeldDaemon_dispatch_ledger"
        )
      ).toEqual(["idempotency_key"]);
      expect(
        readNonPrimaryKeyUniqueConstraintKeys(
          database,
          "openMeldDaemon_dispatch_results"
        )
      ).toEqual(["dispatch_id"]);
      expect(
        readNamedUniqueIndexNames(database, "openMeldDaemon_dispatch_ledger")
      ).toEqual(["openMeldDaemon_dispatch_ledger_idempotency_key_unique"]);
      expect(
        database
          .prepare<[], SqliteIndexNameRow>(
            `PRAGMA index_list('openMeldDaemon_dispatch_ledger');`
          )
          .all()
          .map((row) => row.name.trim())
          .filter((name) =>
            name.startsWith("idx_openMeldDaemon_dispatch_ledger_")
          )
          .sort()
      ).toEqual([
        "idx_openMeldDaemon_dispatch_ledger_dispatch_id",
        "idx_openMeldDaemon_dispatch_ledger_space_client_message_target",
        "idx_openMeldDaemon_dispatch_ledger_space_source_target",
        "idx_openMeldDaemon_dispatch_ledger_status_last_attempt",
      ]);
      expect(
        readNamedUniqueIndexNames(database, "openMeldDaemon_dispatch_results")
      ).toEqual(["openMeldDaemon_dispatch_results_dispatch_id_unique"]);
    } finally {
      database.close();
      fs.rmSync(sqlitePath, { force: true });
    }
  });

  it(
    "returns diff_detected when shared db:verify sees an unsupported legacy dispatch shape",
    () => {
      const fixture = createLegacySharedLocalFixture("migrate-legacy-shape");
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;

      try {
        const summary = runSharedDbVerify({
          mode: "dev",
          runner: () => {
            return {
              status: 0,
              stdout: "",
              stderr: "",
            };
          },
        });

        expect(summary.command).toBe("db:verify:dev");
        expect(summary.result).toBe("diff_detected");
        expect(summary.blockedReason).toContain(
          `auth local OPENMELD_DB: ${UNSUPPORTED_LEGACY_CORE_DISPATCH_SCHEMA_SHAPE_BLOCKED_REASON}`
        );
        expect(summary.blockedReason).toContain(
          "unsupported tables: openMeldDaemon_dispatch_attempts, openMeldDaemon_dispatch_results, openMeldDaemon_dispatch_ledger"
        );
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it("does not emit pre-apply schema mutation statements before shared db:migrate applies migrations", () => {
    const fixture = createCanonicalSharedLocalFixture(
      "migrate-no-preapply-sql"
    );
    process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;
    const observedSqlStatements: string[] = [];
    let migrationApplyCallCount = 0;
    const observedMigrationConfigs: string[] = [];

    try {
      const summary = runSharedDbMigrate({
        mode: "dev",
        runner: ({ args }) => {
          const sql = args[args.indexOf("--command") + 1] ?? "";

          if (args.includes("execute") && !args.includes("--json")) {
            observedSqlStatements.push(sql);
            return {
              status: 0,
              stdout: "",
              stderr: "",
            };
          }

          if (args.includes("migrations") && args.includes("apply")) {
            migrationApplyCallCount += 1;
            observedMigrationConfigs.push(
              String(args[args.indexOf("--config") + 1] ?? "")
            );
            return {
              status: 0,
              stdout: "",
              stderr: "",
            };
          }

          return {
            status: 0,
            stdout: "",
            stderr: "",
          };
        },
      });

      expect(summary.result).toBe("applied");
      expect(migrationApplyCallCount).toBe(2);
      expect(observedMigrationConfigs).toEqual(
        expect.arrayContaining([
          expect.stringContaining("services/auth/wrangler.jsonc"),
          expect.stringContaining("services/core/wrangler.jsonc"),
        ])
      );
      expect(observedSqlStatements).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it(
    "returns diff_detected when shared db:verify sees Core physical schema drift",
    () => {
      const fixture = createCanonicalSharedLocalFixture("migrate-drift");
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;
      const database = new Database(fixture.sqlitePath);
      database.exec(
        "DROP INDEX idx_openMeldDaemon_dispatch_results_actor_created;"
      );
      database.close();

      try {
        const summary = runSharedDbVerify({
          mode: "dev",
          runner: () => {
            return {
              status: 0,
              stdout: "",
              stderr: "",
            };
          },
        });

        expect(summary.subject).toBe("shared");
        expect(summary.result).toBe("diff_detected");
        expect(summary.blockedReason).toContain(
          "required index idx_openMeldDaemon_dispatch_results_actor_created"
        );
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it(
    "returns diff_detected when shared db:verify sees an unexpected unique constraint on dispatch attempts",
    () => {
      const fixture = createCanonicalSharedLocalFixture(
        "migrate-unexpected-unique"
      );
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;
      const database = new Database(fixture.sqlitePath);
      database.exec(
        "CREATE UNIQUE INDEX idx_unexpected_dispatch_attempts_dispatch_id ON openMeldDaemon_dispatch_attempts(dispatch_id);"
      );
      database.close();

      try {
        const summary = runSharedDbVerify({
          mode: "dev",
          runner: () => {
            return {
              status: 0,
              stdout: "",
              stderr: "",
            };
          },
        });

        expect(summary.subject).toBe("shared");
        expect(summary.phase).toBe("migration_phase");
        expect(summary.result).toBe("diff_detected");
        expect(summary.blockedReason).toContain(
          "unexpected unique constraint on openMeldDaemon_dispatch_attempts(dispatch_id)"
        );
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it(
    "returns diff_detected when shared db:verify sees duplicate unique constraints on dispatch ledger",
    () => {
      const fixture = createCanonicalSharedLocalFixture(
        "migrate-duplicate-ledger"
      );
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;
      const database = new Database(fixture.sqlitePath);
      database.exec(
        "CREATE UNIQUE INDEX idx_duplicate_dispatch_ledger_idempotency ON openMeldDaemon_dispatch_ledger(idempotency_key);"
      );
      database.close();

      try {
        const summary = runSharedDbVerify({
          mode: "dev",
          runner: () => {
            return {
              status: 0,
              stdout: "",
              stderr: "",
            };
          },
        });

        expect(summary.subject).toBe("shared");
        expect(summary.phase).toBe("migration_phase");
        expect(summary.result).toBe("diff_detected");
        expect(summary.blockedReason).toContain(
          "duplicate unique constraints on openMeldDaemon_dispatch_ledger(idempotency_key)"
        );
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it(
    "returns diff_detected when shared db:verify sees duplicate unique constraints on dispatch results",
    () => {
      const fixture = createCanonicalSharedLocalFixture(
        "migrate-duplicate-results"
      );
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;
      const database = new Database(fixture.sqlitePath);
      database.exec(
        "CREATE UNIQUE INDEX idx_duplicate_dispatch_results_dispatch_id ON openMeldDaemon_dispatch_results(dispatch_id);"
      );
      database.close();

      try {
        const summary = runSharedDbVerify({
          mode: "dev",
          runner: () => {
            return {
              status: 0,
              stdout: "",
              stderr: "",
            };
          },
        });

        expect(summary.subject).toBe("shared");
        expect(summary.phase).toBe("migration_phase");
        expect(summary.result).toBe("diff_detected");
        expect(summary.blockedReason).toContain(
          "duplicate unique constraints on openMeldDaemon_dispatch_results(dispatch_id)"
        );
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it(
    "accepts object-shaped wrangler d1 execute JSON when shared db:verify checks the physical contract",
    () => {
      process.env[SHARED_DB_EXECUTION_MODE_ENV_NAME] = "prod";

      const summary = runSharedDbVerify({
        mode: "prod",
        runner: ({ args }) =>
          buildObjectShapePhysicalContractRunner()({ args }),
      });

      expect(summary.subject).toBe("shared");
      expect(summary.phase).toBe("migration_phase");
      expect(summary.command).toBe("db:verify:prod");
      expect(summary.result).toBe("no_diff");
      expect(summary.blockedReason).toBeNull();
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it("runs shared db:verify:prod through Wrangler without Cloudflare API env", () => {
    process.env[SHARED_DB_EXECUTION_MODE_ENV_NAME] = "prod";
    Reflect.deleteProperty(process.env, "CLOUDFLARE_ACCOUNT_ID");
    Reflect.deleteProperty(process.env, "CLOUDFLARE_D1_DATABASE_ID");
    Reflect.deleteProperty(process.env, "CLOUDFLARE_API_TOKEN");

    const observedArgs: string[][] = [];
    const canonicalRunner = createSharedPhysicalContractRunner();
    const summary = runSharedDbVerify({
      mode: "prod",
      runner: ({ args }) => {
        observedArgs.push(args);
        return canonicalRunner({ args });
      },
    });

    const executeCalls = observedArgs.filter((args) =>
      args.includes("execute")
    );

    expect(summary.subject).toBe("shared");
    expect(summary.phase).toBe("migration_phase");
    expect(summary.command).toBe("db:verify:prod");
    expect(summary.result).toBe("no_diff");
    expect(summary.blockedReason).toBeNull();
    expect(summary.snapshot.target.resolvedFrom).toBe("wrangler_config");
    expect(summary.snapshot.target.targetKind).toBe("d1_http");
    expect(executeCalls.length).toBeGreaterThan(0);
    expect(executeCalls.every((args) => args.includes("--remote"))).toBe(true);
    expect(executeCalls.every((args) => args.includes("--json"))).toBe(true);
    expect(executeCalls.every((args) => args.includes("--env"))).toBe(true);
    expect(observedArgs.some((args) => args.includes("drizzle-kit"))).toBe(
      false
    );
  });

  it(
    "returns diff_detected when shared db:verify sees only an autoindex-backed unique constraint on dispatch ledger",
    () => {
      const fixture = createCanonicalSharedLocalFixture(
        "migrate-ledger-index-missing"
      );
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;
      const database = new Database(fixture.sqlitePath);
      database.exec(
        "DROP INDEX openMeldDaemon_dispatch_ledger_idempotency_key_unique;"
      );
      database.exec(
        "CREATE UNIQUE INDEX idx_alt_dispatch_ledger_idempotency ON openMeldDaemon_dispatch_ledger(idempotency_key);"
      );
      database.close();

      try {
        const summary = runSharedDbVerify({
          mode: "dev",
          runner: () => {
            return {
              status: 0,
              stdout: "",
              stderr: "",
            };
          },
        });

        expect(summary.subject).toBe("shared");
        expect(summary.result).toBe("diff_detected");
        expect(summary.blockedReason).toContain(
          "required index openMeldDaemon_dispatch_ledger_idempotency_key_unique"
        );
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it("keeps the shared db gate action on the single production release command", () => {
    const source = fs.readFileSync(
      path.resolve(
        getRepoRootDirectoryPath(),
        ".github/actions/shared-db-gate/action.yml"
      ),
      "utf8"
    );

    expect(source).toContain("run: pnpm run db:release:prod");
    expect(source).not.toContain("run: pnpm db:check");
    expect(source).not.toContain("run: pnpm db:generate");
    expect(source).not.toContain("run: pnpm db:migrate:prod");
    expect(source).not.toContain("run: pnpm db:verify:prod");
    expect(source).not.toContain("run: pnpm db:optimize:prod");
    expect(source).toContain("OPENMELD_DB_EXECUTION_MODE: prod");
  });

  it("keeps @openmeld/db/tooling free of auth-only db command exports", () => {
    const source = fs.readFileSync(
      path.resolve(getRepoRootDirectoryPath(), "packages/db/src/tooling.ts"),
      "utf8"
    );

    expect(source).not.toContain("runAuthDbCheck");
    expect(source).not.toContain("runAuthDbGenerate");
    expect(source).not.toContain("runAuthDbMigrate");
    expect(source).not.toContain("runAuthDbVerify");
    expect(source).not.toContain("runAuthDbOptimize");
  });
});
