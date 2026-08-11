import type {
  RemoteAgentReadableStorage,
  RemoteAgentStorage,
  RemoteAgentWritableStorage,
} from "../agent-core/callback-context";

type SqlResult = {
  rowsWritten?: number;
  toArray(): Record<string, unknown>[];
};

type SqlStorage = {
  exec(query: string, ...bindings: unknown[]): SqlResult;
};

const TABLE_NAME = "openmeld_remote_agent_adapter_kv";

export class RemoteAgentSqlStorage
  implements RemoteAgentReadableStorage, RemoteAgentWritableStorage
{
  private readonly sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.sql = sql;
    this.ensureTable();
  }

  compareAndSet<T>(
    key: string,
    expectedValue: T,
    nextValue: T
  ): Promise<boolean> {
    const updated = this.sql.exec(
      `
        UPDATE ${TABLE_NAME}
        SET value_json = ?, updated_at_ms = ?, expires_at_ms = NULL
        WHERE key = ? AND value_json = ?
      `,
      JSON.stringify(nextValue),
      Date.now(),
      key,
      JSON.stringify(expectedValue)
    );
    return Promise.resolve((updated.rowsWritten ?? 0) > 0);
  }

  delete(key: string): Promise<boolean> {
    const deleted = this.sql.exec(
      `DELETE FROM ${TABLE_NAME} WHERE key = ?`,
      key
    );
    return Promise.resolve((deleted.rowsWritten ?? 0) > 0);
  }

  deleteExpired(input: {
    limit: number;
    nowMs: number;
    prefix: string;
  }): Promise<{ deleted: number; nextExpiresAtMs: number | null }> {
    const deleted = this.sql.exec(
      `
        DELETE FROM ${TABLE_NAME}
        WHERE key IN (
          SELECT key
          FROM ${TABLE_NAME}
          WHERE key >= ?
            AND key < ?
            AND expires_at_ms IS NOT NULL
            AND expires_at_ms <= ?
          ORDER BY expires_at_ms ASC, key ASC
          LIMIT ?
        )
      `,
      input.prefix,
      `${input.prefix}\uffff`,
      input.nowMs,
      input.limit
    );
    const next = this.sql
      .exec(
        `
          SELECT MIN(expires_at_ms) AS next_expires_at_ms
          FROM ${TABLE_NAME}
          WHERE key >= ?
            AND key < ?
            AND expires_at_ms IS NOT NULL
        `,
        input.prefix,
        `${input.prefix}\uffff`
      )
      .toArray()[0] as { next_expires_at_ms?: number | null } | undefined;
    return Promise.resolve({
      deleted: deleted.rowsWritten ?? 0,
      nextExpiresAtMs: next?.next_expires_at_ms ?? null,
    });
  }

  get<T = unknown>(key: string): Promise<T | undefined> {
    const row = this.sql
      .exec(`SELECT value_json FROM ${TABLE_NAME} WHERE key = ? LIMIT 1`, key)
      .toArray()[0] as { value_json?: string } | undefined;
    return Promise.resolve(
      row?.value_json === undefined
        ? undefined
        : (JSON.parse(row.value_json) as T)
    );
  }

  list<T = unknown>(
    options?: DurableObjectListOptions
  ): Promise<Map<string, T>> {
    const prefix = options?.prefix ?? "";
    const rows = this.sql
      .exec(
        `
          SELECT key, value_json
          FROM ${TABLE_NAME}
          WHERE key >= ? AND key < ?
          ORDER BY key ASC
        `,
        prefix,
        `${prefix}\uffff`
      )
      .toArray() as { key: string; value_json: string }[];
    const records = new Map<string, T>();
    for (const row of rows) {
      records.set(row.key, JSON.parse(row.value_json) as T);
    }
    return Promise.resolve(records);
  }

  put<T>(key: string, value: T): Promise<void> {
    this.putRecord(key, value, null);
    return Promise.resolve();
  }

  putExpiring<T>(key: string, value: T, expiresAtMs: number): Promise<void> {
    this.putRecord(key, value, expiresAtMs);
    return Promise.resolve();
  }

  putIfAbsent<T>(key: string, value: T): Promise<boolean> {
    return this.putIfAbsentRecord(key, value, null);
  }

  putIfAbsentExpiring<T>(
    key: string,
    value: T,
    expiresAtMs: number
  ): Promise<boolean> {
    return this.putIfAbsentRecord(key, value, expiresAtMs);
  }

  takeUnexpired<T = unknown>(
    key: string,
    nowMs: number
  ): Promise<T | undefined> {
    const row = this.sql
      .exec(
        `SELECT value_json, expires_at_ms FROM ${TABLE_NAME} WHERE key = ? LIMIT 1`,
        key
      )
      .toArray()[0] as
      | { expires_at_ms?: number | null; value_json?: string }
      | undefined;
    if (row?.value_json === undefined) {
      return Promise.resolve(undefined);
    }
    const deleted = this.sql.exec(
      `DELETE FROM ${TABLE_NAME} WHERE key = ?`,
      key
    );
    if (
      (deleted.rowsWritten ?? 0) === 0 ||
      (row.expires_at_ms !== null &&
        row.expires_at_ms !== undefined &&
        row.expires_at_ms <= nowMs)
    ) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(JSON.parse(row.value_json) as T);
  }

  private ensureTable(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER
      )
    `);
    const columns = this.sql
      .exec(`PRAGMA table_info(${TABLE_NAME})`)
      .toArray() as { name?: string }[];
    if (!columns.some((column) => column.name === "expires_at_ms")) {
      this.sql.exec(
        `ALTER TABLE ${TABLE_NAME} ADD COLUMN expires_at_ms INTEGER`
      );
    }
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS openmeld_remote_agent_adapter_kv_expiry_idx
      ON ${TABLE_NAME}(expires_at_ms, key)
      WHERE expires_at_ms IS NOT NULL
    `);
  }

  private putIfAbsentRecord<T>(
    key: string,
    value: T,
    expiresAtMs: number | null
  ): Promise<boolean> {
    const inserted = this.sql.exec(
      `
        INSERT OR IGNORE INTO ${TABLE_NAME} (
          key,
          value_json,
          updated_at_ms,
          expires_at_ms
        )
        VALUES (?, ?, ?, ?)
      `,
      key,
      JSON.stringify(value),
      Date.now(),
      expiresAtMs
    );
    return Promise.resolve((inserted.rowsWritten ?? 0) > 0);
  }

  private putRecord<T>(
    key: string,
    value: T,
    expiresAtMs: number | null
  ): void {
    this.sql.exec(
      `
        INSERT INTO ${TABLE_NAME} (
          key,
          value_json,
          updated_at_ms,
          expires_at_ms
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at_ms = excluded.updated_at_ms,
          expires_at_ms = excluded.expires_at_ms
      `,
      key,
      JSON.stringify(value),
      Date.now(),
      expiresAtMs
    );
  }
}

export function createRemoteAgentSqlStorage(
  sql: SqlStorage
): RemoteAgentStorage {
  return new RemoteAgentSqlStorage(sql);
}
