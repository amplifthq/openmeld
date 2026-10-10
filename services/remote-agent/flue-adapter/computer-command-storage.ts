import type { ComputerCommandRecord } from "./computer-command";
import { RemoteAgentSqlStorage } from "./storage";

export const COMPUTER_COMMAND_PREFIX =
  "openmeld:remote-agent:computer-command:";
const NEXT_ATTEMPT =
  "COALESCE(json_extract(value_json, '$.collection.nextAttemptAtMs'), 0)";
const COLLECTION_INDEX = "openmeld_computer_command_collection_idx";
// This index is a read projection of the existing receipt, not another queue.
// An absent collection field keeps historical receipts eligible. Explicit null
// pauses automatic collection only. collectable:false retains uncertain launch.
const ELIGIBLE = `key >= '${COMPUTER_COMMAND_PREFIX}'
  AND key < '${COMPUTER_COMMAND_PREFIX}\uffff'
  AND json_type(value_json, '$.collectable') IS NOT NULL
  AND COALESCE(json_extract(value_json, '$.completed'), 0) != 1
  AND COALESCE(json_extract(value_json, '$.observation.status'), '') != 'completed'
  AND json_extract(value_json, '$.loss') IS NULL
  AND json_extract(value_json, '$.observation.syncError') IS NULL
  AND COALESCE(json_extract(value_json, '$.lostDuringCleanup'), 0) != 1
  AND COALESCE(json_extract(value_json, '$.backend'), 'container') != 'worker-shell'
  AND json_type(value_json, '$.collection.nextAttemptAtMs') IS NOT 'null'`;

export class ComputerCommandSqlStorage extends RemoteAgentSqlStorage {
  constructor(sql: ConstructorParameters<typeof RemoteAgentSqlStorage>[0]) {
    super(sql);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS ${COLLECTION_INDEX}
      ON ${this.tableName}(${NEXT_ATTEMPT}, key) WHERE ${ELIGIBLE}`);
  }

  listDueCommands(
    nowMs: number,
    limit: number
  ): Promise<Map<string, ComputerCommandRecord>> {
    const rows = this.sql
      .exec(
        `SELECT key, value_json FROM ${this.tableName} INDEXED BY ${COLLECTION_INDEX}
      WHERE ${ELIGIBLE} AND ${NEXT_ATTEMPT} <= ?
      ORDER BY ${NEXT_ATTEMPT}, key LIMIT ?`,
        nowMs,
        limit
      )
      .toArray() as { key: string; value_json: string }[];
    return Promise.resolve(
      new Map(
        rows.map((row) => [
          row.key,
          JSON.parse(row.value_json) as ComputerCommandRecord,
        ])
      )
    );
  }

  nextCollectionAt(): Promise<number | null> {
    const row = this.sql
      .exec(`SELECT ${NEXT_ATTEMPT} AS next_attempt_at_ms
      FROM ${this.tableName} INDEXED BY ${COLLECTION_INDEX} WHERE ${ELIGIBLE}
      ORDER BY ${NEXT_ATTEMPT}, key LIMIT 1`)
      .toArray()[0];
    return Promise.resolve(row ? Number(row.next_attempt_at_ms) : null);
  }
}
