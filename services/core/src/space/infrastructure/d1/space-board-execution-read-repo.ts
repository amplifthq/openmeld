import { runtimeCoordinatorTerminalOutcomeSchema } from "@openmeld/schemas";
import type {
  RuntimeCoordinatorTerminalOutcome,
  SpaceBoardOutcome,
} from "@openmeld/schemas/types";

const RECENT_OUTCOME_LIMIT = 10;

type SpaceBoardWorkingRow = {
  started_at_ms?: unknown;
  status?: unknown;
  target_profile_id?: unknown;
};

type SpaceBoardOutcomeRow = {
  public_outcome?: unknown;
  status?: unknown;
  target_profile_id?: unknown;
  terminal_outcome_json?: unknown;
  updated_at_ms?: unknown;
};

export type SpaceBoardExecutionProjection = {
  workingNow: Array<{
    profileId: string;
    startedAt: string;
  }>;
  recentOutcomes: Array<{
    at: string;
    profileId: string;
    outcome: SpaceBoardOutcome;
  }>;
};

export async function readSpaceBoardExecutionProjection(input: {
  db: D1Database;
  spaceId: string;
}): Promise<SpaceBoardExecutionProjection> {
  const [workingResult, outcomeResult] = await Promise.all([
    input.db
      .prepare(
        `
          SELECT
            execution.target_profile_id,
            execution.status,
            running_event.started_at_ms
          FROM openMeldDaemon_runtime_coordinator_executions AS execution
          INNER JOIN (
            SELECT
              runtime_coordinator_execution_id,
              MIN(observed_at_ms) AS started_at_ms
            FROM openMeldDaemon_runtime_coordinator_execution_events
            WHERE event_type = 'lifecycle_running'
            GROUP BY runtime_coordinator_execution_id
          ) AS running_event
            ON running_event.runtime_coordinator_execution_id =
              execution.runtime_coordinator_execution_id
          WHERE execution.space_id = ?
            AND execution.status = 'running'
          ORDER BY running_event.started_at_ms ASC
        `
      )
      .bind(input.spaceId)
      .all<SpaceBoardWorkingRow>(),
    input.db
      .prepare(
        `
          SELECT
            execution.target_profile_id,
            execution.status,
            execution.terminal_outcome_json,
            execution.updated_at_ms,
            result.public_outcome
          FROM openMeldDaemon_runtime_coordinator_executions AS execution
          LEFT JOIN openMeldDaemon_dispatch_results AS result
            ON result.dispatch_id = execution.dispatch_id
          WHERE execution.space_id = ?
            AND execution.status IN ('reply_published', 'failed_terminal', 'cancelled')
            AND (
              execution.status <> 'reply_published'
              OR result.public_outcome IN ('post_message', 'raw_context_sharing', 'system_notice')
            )
          ORDER BY execution.updated_at_ms DESC
          LIMIT ?
        `
      )
      .bind(input.spaceId, RECENT_OUTCOME_LIMIT)
      .all<SpaceBoardOutcomeRow>(),
  ]);

  return {
    workingNow: (workingResult.results ?? []).flatMap(mapWorkingExecutionRow),
    recentOutcomes: (outcomeResult.results ?? []).flatMap(mapOutcomeRow),
  };
}

function mapWorkingExecutionRow(
  row: SpaceBoardWorkingRow
): SpaceBoardExecutionProjection["workingNow"] {
  // Defense in depth for stale/mocked query layers: queued and delivery states
  // are not working, even if they are accidentally returned by the database.
  if (row.status !== "running") {
    return [];
  }

  return [
    {
      profileId: readRequiredText(row.target_profile_id, "target_profile_id"),
      startedAt: timestampMsToIso(row.started_at_ms, "started_at_ms"),
    },
  ];
}

function mapOutcomeRow(
  row: SpaceBoardOutcomeRow
): SpaceBoardExecutionProjection["recentOutcomes"] {
  const outcome = mapTerminalStatusToBoardOutcome(row);
  if (!outcome) {
    return [];
  }

  const terminalOutcome = parseTerminalOutcome(row.terminal_outcome_json);
  return [
    {
      at: timestampMsToIso(
        terminalOutcome?.observedAtMs ?? row.updated_at_ms,
        terminalOutcome ? "terminal_outcome.observedAtMs" : "updated_at_ms"
      ),
      profileId: readRequiredText(row.target_profile_id, "target_profile_id"),
      outcome:
        row.status === "failed_terminal" &&
        terminalOutcome?.kind === "timed_out"
          ? "timed_out"
          : outcome,
    },
  ];
}

function mapTerminalStatusToBoardOutcome(
  row: SpaceBoardOutcomeRow
): SpaceBoardOutcome | null {
  switch (row.status) {
    case "reply_published":
      return mapPublishedResultToBoardOutcome(row.public_outcome);
    case "failed_terminal":
      return "failed";
    case "cancelled":
      return "stopped";
    default:
      return null;
  }
}

function mapPublishedResultToBoardOutcome(
  publicOutcome: unknown
): SpaceBoardOutcome | null {
  switch (publicOutcome) {
    case "post_message":
    case "raw_context_sharing":
      return "replied";
    case "system_notice":
      return "failed";
    default:
      // A reply_published execution only tells us that Space published a final
      // signal. Without the Dispatch Result's public outcome, calling that
      // signal an Agent reply would turn missing evidence into a false fact.
      return null;
  }
}

function parseTerminalOutcome(
  rawValue: unknown
): RuntimeCoordinatorTerminalOutcome | null {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }
  if (typeof rawValue !== "string") {
    throw new Error("Space Board terminal outcome JSON must be text");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawValue) as unknown;
  } catch (error) {
    throw new Error("Space Board terminal outcome JSON is invalid", {
      cause: error,
    });
  }

  const parsed = runtimeCoordinatorTerminalOutcomeSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error("Space Board terminal outcome projection is invalid", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function readRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Space Board execution row has invalid ${field}`);
  }
  return value.trim();
}

function timestampMsToIso(value: unknown, field: string): string {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Space Board execution row has invalid ${field}`);
  }

  try {
    return new Date(value).toISOString();
  } catch (error) {
    throw new Error(`Space Board execution row has invalid ${field}`, {
      cause: error,
    });
  }
}
