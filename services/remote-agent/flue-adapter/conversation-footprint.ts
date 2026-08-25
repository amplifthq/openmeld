import { REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE } from "@openmeld/schemas";
import {
  REMOTE_AGENT_ESTIMATED_PROVIDER_BYTES_PER_TOKEN,
  type RemoteAgentProviderContextCapacity,
} from "./provider-context-capacity";

// The 128 MiB Durable Object isolate limit covers the full live object graph,
// not only Flue's serialized stream. Replay temporarily holds the SQL result,
// parsed events, reducer indexes, prompt/tool materialization, and provider
// payloads at the same time. These conservative thresholds leave roughly 10x
// headroom for that amplification while Core advances the logical conversation
// to a fresh runtime generation.
export const REMOTE_AGENT_CONVERSATION_SOFT_LIMIT_BYTES = 8 * 1024 * 1024;
export const REMOTE_AGENT_CONVERSATION_HARD_LIMIT_BYTES = 12 * 1024 * 1024;
const REMOTE_AGENT_CANONICAL_CONTEXT_BUDGET_RATIO = 0.85;

const FLUE_CONVERSATION_STREAMS_TABLE = "flue_conversation_streams";
const FLUE_CONVERSATION_STREAM_BATCHES_TABLE =
  "flue_conversation_stream_batches";
const FLUE_CONVERSATION_STREAM_TABLE_PREFIX = "flue_conversation_stream";
const FLUE_CONVERSATION_FOOTPRINT_SCHEMA_ERROR =
  "Remote Agent conversation footprint schema is incompatible with the pinned Flue runtime.";
const REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_DIAGNOSTIC_DETAIL =
  "Remote Agent rejected the turn before replay because its conversation history reached the safety limit.";

type SqlResult = {
  toArray(): Record<string, unknown>[];
};

type SqlStorage = {
  exec(query: string, ...bindings: unknown[]): SqlResult;
};

export type RemoteAgentConversationFootprint = {
  batchCount: number;
  canonicalBytes: number;
  largestBatchBytes: number;
  level: "hard_limit" | "normal" | "soft_limit";
};

export function assertRemoteAgentConversationFootprintSchema(
  sql: SqlStorage
): void {
  const flueTables = readFlueTables(sql);
  if (flueTables.length === 0) {
    throw new Error(FLUE_CONVERSATION_FOOTPRINT_SCHEMA_ERROR);
  }
  assertFlueConversationFootprintSchema(sql, flueTables);
}

export function readRemoteAgentConversationFootprint(
  sql: SqlStorage
): RemoteAgentConversationFootprint {
  const flueTables = readFlueTables(sql);
  if (flueTables.length === 0) {
    return {
      batchCount: 0,
      canonicalBytes: 0,
      largestBatchBytes: 0,
      level: "normal",
    };
  }
  assertFlueConversationFootprintSchema(sql, flueTables);

  const row = sql
    .exec(
      `
        SELECT
          COUNT(*) AS batch_count,
          COALESCE(SUM(LENGTH(CAST(data AS BLOB))), 0) AS canonical_bytes,
          COALESCE(MAX(LENGTH(CAST(data AS BLOB))), 0) AS largest_batch_bytes
        FROM flue_conversation_stream_batches
      `
    )
    .toArray()[0];
  const batchCount = parseAggregate(row?.batch_count);
  const canonicalBytes = parseAggregate(row?.canonical_bytes);
  const largestBatchBytes = parseAggregate(row?.largest_batch_bytes);

  return {
    batchCount,
    canonicalBytes,
    largestBatchBytes,
    level: resolveFootprintLevel(canonicalBytes),
  };
}

function readFlueTables(sql: SqlStorage): Record<string, unknown>[] {
  return sql
    .exec(
      `
        SELECT name
        FROM sqlite_schema
        WHERE type = 'table'
          AND name GLOB 'flue_*'
      `
    )
    .toArray();
}

function assertFlueConversationFootprintSchema(
  sql: SqlStorage,
  flueTables: Record<string, unknown>[]
): void {
  const tableNames = new Set(
    flueTables
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string")
  );
  const hasUnexpectedConversationStreamTable = [...tableNames].some(
    (name) =>
      name.startsWith(FLUE_CONVERSATION_STREAM_TABLE_PREFIX) &&
      name !== FLUE_CONVERSATION_STREAMS_TABLE &&
      name !== FLUE_CONVERSATION_STREAM_BATCHES_TABLE
  );
  if (
    hasUnexpectedConversationStreamTable ||
    !(
      tableNames.has(FLUE_CONVERSATION_STREAMS_TABLE) &&
      tableNames.has(FLUE_CONVERSATION_STREAM_BATCHES_TABLE)
    )
  ) {
    throw new Error(FLUE_CONVERSATION_FOOTPRINT_SCHEMA_ERROR);
  }

  const batchColumns = sql
    .exec(`PRAGMA table_info(${FLUE_CONVERSATION_STREAM_BATCHES_TABLE})`)
    .toArray();
  if (!batchColumns.some((column) => column.name === "data")) {
    throw new Error(FLUE_CONVERSATION_FOOTPRINT_SCHEMA_ERROR);
  }
}

export function resolveRemoteAgentConversationFootprintAdmission(
  footprint: RemoteAgentConversationFootprint,
  options: {
    automaticRolloverSupported?: boolean;
    providerContextCapacity?: RemoteAgentProviderContextCapacity;
  } = {}
): {
  message: string;
  reasonCode: "remote_agent.conversation_history_limit_exceeded";
} | null {
  const automaticRolloverLimitBytes =
    resolveRemoteAgentConversationAutomaticRolloverLimitBytes(
      options.providerContextCapacity
    );
  const automaticRolloverRequired = Boolean(
    options.automaticRolloverSupported &&
      footprint.canonicalBytes >= automaticRolloverLimitBytes
  );
  if (footprint.level !== "hard_limit" && !automaticRolloverRequired) {
    return null;
  }
  return {
    message: REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_DIAGNOSTIC_DETAIL,
    reasonCode: REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE,
  };
}

export function resolveRemoteAgentConversationAutomaticRolloverLimitBytes(
  providerContextCapacity?: RemoteAgentProviderContextCapacity
): number {
  if (!providerContextCapacity) {
    return REMOTE_AGENT_CONVERSATION_SOFT_LIMIT_BYTES;
  }
  return Math.min(
    REMOTE_AGENT_CONVERSATION_SOFT_LIMIT_BYTES,
    Math.floor(
      providerContextCapacity.inputTokenBudget *
        REMOTE_AGENT_ESTIMATED_PROVIDER_BYTES_PER_TOKEN *
        REMOTE_AGENT_CANONICAL_CONTEXT_BUDGET_RATIO
    )
  );
}

function parseAggregate(value: unknown): number {
  const parsed = Number(value);
  if (!(Number.isSafeInteger(parsed) && parsed >= 0)) {
    throw new Error("Remote Agent conversation footprint is invalid.");
  }
  return parsed;
}

function resolveFootprintLevel(
  canonicalBytes: number
): RemoteAgentConversationFootprint["level"] {
  if (canonicalBytes >= REMOTE_AGENT_CONVERSATION_HARD_LIMIT_BYTES) {
    return "hard_limit";
  }
  if (canonicalBytes >= REMOTE_AGENT_CONVERSATION_SOFT_LIMIT_BYTES) {
    return "soft_limit";
  }
  return "normal";
}
