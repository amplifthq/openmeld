import type {
  CloudComputerInvocationOwner,
  CloudComputerRecoveryQuery,
} from "@openmeld/schemas";
import type { ComputerCommandRecord } from "./computer-command";
import { RemoteAgentSqlStorage } from "./storage";

export const COMPUTER_COMMAND_PREFIX =
  "openmeld:remote-agent:computer-command:";
export const COMPUTER_INVOCATION_OWNER_PREFIX =
  "openmeld:computer-invocation-owner:";
const NEXT_ATTEMPT =
  "COALESCE(json_extract(value_json, '$.collection.nextAttemptAtMs'), 0)";
const COLLECTION_INDEX = "openmeld_computer_command_collection_v2_idx";
// Unlike the collection index, this includes foreground worker-shell calls,
// uncertain starts and paused collection. None is proof that a Computer is idle.
const UNFINISHED = `key >= '${COMPUTER_COMMAND_PREFIX}'
  AND key < '${COMPUTER_COMMAND_PREFIX}\uffff'
  AND COALESCE(json_extract(value_json, '$.completed'), 0) != 1
  AND COALESCE(json_extract(value_json, '$.observation.status'), '') != 'completed'
  AND COALESCE(json_extract(value_json, '$.observation.syncError'), '') != 'ESYNC_READ_ONLY'
  AND COALESCE(json_extract(value_json, '$.lossConfirmed'), 0) != 1`;
// This index is a read projection of the existing receipt, not another queue.
// An absent collection field keeps historical receipts eligible. Explicit null
// pauses automatic collection only. collectable:false retains uncertain launch.
const ELIGIBLE = `key >= '${COMPUTER_COMMAND_PREFIX}'
  AND key < '${COMPUTER_COMMAND_PREFIX}\uffff'
  AND json_type(value_json, '$.collectable') IS NOT NULL
  AND COALESCE(json_extract(value_json, '$.completed'), 0) != 1
  AND COALESCE(json_extract(value_json, '$.observation.status'), '') != 'completed'
  AND COALESCE(json_extract(value_json, '$.lossConfirmed'), 0) != 1
  AND COALESCE(json_extract(value_json, '$.loss'), '') != 'EEXEC_LOST'
  AND json_extract(value_json, '$.observation.syncError') IS NULL
  AND COALESCE(json_extract(value_json, '$.lostDuringCleanup'), 0) != 1
  AND COALESCE(json_extract(value_json, '$.backend'), 'container') != 'worker-shell'
  AND json_type(value_json, '$.collection.nextAttemptAtMs') IS NOT 'null'`;

export class ComputerCommandSqlStorage extends RemoteAgentSqlStorage {
  constructor(sql: ConstructorParameters<typeof RemoteAgentSqlStorage>[0]) {
    super(sql);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS ${COLLECTION_INDEX}
      ON ${this.tableName}(${NEXT_ATTEMPT}, key) WHERE ${ELIGIBLE}`);
    this.sql.exec(
      "DROP INDEX IF EXISTS openmeld_computer_command_collection_idx"
    );
    this.sql.exec(`CREATE INDEX IF NOT EXISTS openmeld_computer_unfinished_idx
      ON ${this.tableName}(key) WHERE ${UNFINISHED}`);
  }

  hasUnfinishedCommands(): boolean {
    return (
      this.sql
        .exec(`SELECT key FROM ${this.tableName}
      WHERE ${UNFINISHED} LIMIT 1`)
        .toArray().length !== 0
    );
  }

  listInvocationOwners(
    query: CloudComputerRecoveryQuery
  ): CloudComputerInvocationOwner[] {
    return this.sql
      .exec(
        `SELECT value_json FROM ${this.tableName}
      WHERE key >= ? AND key < ? AND key > ?
      AND json_extract(value_json, '$.organizationId') = ?
      AND json_extract(value_json, '$.spaceId') = ?
      AND json_extract(value_json, '$.agentProfileId') = ?
      ORDER BY key LIMIT 33`,
        COMPUTER_INVOCATION_OWNER_PREFIX,
        `${COMPUTER_INVOCATION_OWNER_PREFIX}\uffff`,
        COMPUTER_INVOCATION_OWNER_PREFIX +
          (query.cursor ? encodeURIComponent(query.cursor) : ""),
        query.organizationId,
        query.spaceId,
        query.agentProfileId
      )
      .toArray()
      .map(
        (row) =>
          JSON.parse(String(row.value_json)) as CloudComputerInvocationOwner
      );
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
