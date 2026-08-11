import { openMeldDaemonTaskResultEnvelopeSchema } from "@openmeld/schemas";
import type { OpenMeldDaemonTaskResultEnvelope } from "@openmeld/schemas/types";

export type DispatchResultInboxPublishState =
  | "result_accepted"
  | "late_result_available"
  | "reply_published"
  | "reply_suppressed_stopped"
  | "reply_publication_failed"
  | "invalid_space_action"
  | "legacy_result_quarantined";

export type DispatchResultInboxRecord = {
  acceptedAtMs: number;
  attemptId: string;
  daemonSessionId: string;
  dispatchId: string;
  executionTokenFingerprint: string | null;
  executionTokenRunId: string | null;
  leaseEpoch: number;
  publishState: DispatchResultInboxPublishState;
  publishedSignalId: string | null;
  publicationErrorCode: string | null;
  resultKey: string;
  runtimeCoordinatorExecutionId: string | null;
  submittedConnectionGeneration: number;
  targetProfileId: string;
  taskId: string;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
  updatedAtMs: number;
};

type DispatchResultInboxRow = {
  accepted_at_ms: number;
  attempt_id: string;
  daemon_session_id: string;
  dispatch_id: string;
  execution_token_fingerprint: string | null;
  execution_token_run_id: string | null;
  lease_epoch: number;
  publication_error_code: string | null;
  publish_state: string;
  published_signal_id: string | null;
  result_key: string;
  result_payload_json: string;
  runtime_coordinator_execution_id: string | null;
  submitted_connection_generation: number;
  target_profile_id: string;
  task_id: string;
  updated_at_ms: number;
};

export type AcceptDispatchResultInboxInput = {
  acceptedAtMs: number;
  attemptId: string;
  daemonSessionId: string;
  dispatchId: string;
  executionTokenFingerprint: string | null;
  executionTokenRunId: string | null;
  leaseEpoch: number;
  runtimeCoordinatorExecutionId: string | null;
  submittedConnectionGeneration: number;
  targetProfileId: string;
  taskId: string;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
  publishState?: "result_accepted" | "late_result_available";
};

export type AcceptDispatchResultInboxResult =
  | {
      ok: true;
      status: "accepted" | "already_accepted";
    }
  | {
      ok: false;
      status: "rejected_terminal";
      reasonCode: "daemon.result.conflict";
    }
  | {
      ok: false;
      status: "retry_later";
      reasonCode: "daemon.result.inbox_unavailable";
    };

export type UpdateDispatchResultInboxPublishStateResult =
  | {
      status: "updated";
    }
  | {
      status: "unchanged_terminal";
    }
  | {
      status: "missing";
    };

export const acceptDispatchResultInboxRecord = async (
  db: D1Database,
  input: AcceptDispatchResultInboxInput
): Promise<AcceptDispatchResultInboxResult> => {
  const resultKey = buildDispatchResultInboxKey(input);
  const resultPayloadJson = JSON.stringify(input.taskResult);
  try {
    const existing = await readDispatchResultInboxRow(db, resultKey);
    if (existing) {
      return existing.result_payload_json === resultPayloadJson
        ? { ok: true, status: "already_accepted" }
        : {
            ok: false,
            reasonCode: "daemon.result.conflict",
            status: "rejected_terminal",
          };
    }

    await db
      .prepare(
        `
          INSERT INTO openMeldDaemon_dispatch_result_inbox (
            result_key,
            dispatch_id,
            attempt_id,
            task_id,
            target_profile_id,
            daemon_session_id,
            lease_epoch,
            submitted_connection_generation,
            runtime_coordinator_execution_id,
            execution_token_run_id,
            execution_token_fingerprint,
            result_payload_json,
            accepted_at_ms,
            publish_state,
            published_signal_id,
            publication_error_code,
            updated_at_ms
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .bind(
        resultKey,
        input.dispatchId,
        input.attemptId,
        input.taskId,
        input.targetProfileId,
        input.daemonSessionId,
        input.leaseEpoch,
        input.submittedConnectionGeneration,
        input.runtimeCoordinatorExecutionId,
        input.executionTokenRunId,
        input.executionTokenFingerprint,
        resultPayloadJson,
        input.acceptedAtMs,
        input.publishState ?? "result_accepted",
        null,
        null,
        input.acceptedAtMs
      )
      .run();
  } catch (error) {
    const replayed = await readDispatchResultInboxRow(db, resultKey).catch(
      () => null
    );
    if (replayed) {
      return replayed.result_payload_json === resultPayloadJson
        ? { ok: true, status: "already_accepted" }
        : {
            ok: false,
            reasonCode: "daemon.result.conflict",
            status: "rejected_terminal",
          };
    }
    console.warn("[core.runtime_transport.result_inbox_write_failed]", {
      dispatchId: input.dispatchId,
      attemptId: input.attemptId,
      reasonCode: "daemon.result.inbox_unavailable",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      reasonCode: "daemon.result.inbox_unavailable",
      status: "retry_later",
    };
  }

  return { ok: true, status: "accepted" };
};

export const readDispatchResultInboxRecord = async (
  db: D1Database,
  input: {
    attemptId: string;
    dispatchId: string;
  }
): Promise<DispatchResultInboxRecord | null> => {
  const row = await readDispatchResultInboxRow(
    db,
    buildDispatchResultInboxKey(input)
  );
  return row ? mapDispatchResultInboxRow(row) : null;
};

export const updateDispatchResultInboxPublishState = async (
  db: D1Database,
  input: {
    attemptId: string;
    dispatchId: string;
    publicationErrorCode?: string | null;
    publishedSignalId?: string | null;
    publishState: Exclude<DispatchResultInboxPublishState, "result_accepted">;
    updatedAtMs: number;
  }
): Promise<UpdateDispatchResultInboxPublishStateResult> => {
  const resultKey = buildDispatchResultInboxKey(input);
  const write = await db
    .prepare(
      `
        UPDATE openMeldDaemon_dispatch_result_inbox
        SET
          publish_state = ?,
          published_signal_id = ?,
          publication_error_code = ?,
          updated_at_ms = ?
        WHERE result_key = ?
          AND publish_state <> 'reply_published'
      `
    )
    .bind(
      input.publishState,
      input.publishedSignalId ?? null,
      input.publicationErrorCode ?? null,
      input.updatedAtMs,
      resultKey
    )
    .run();
  if (didWriteRows(write)) {
    return { status: "updated" };
  }
  const existing = await readDispatchResultInboxRow(db, resultKey);
  return existing?.publish_state === "reply_published"
    ? { status: "unchanged_terminal" }
    : { status: "missing" };
};

export const buildDispatchResultInboxKey = (input: {
  attemptId: string;
  dispatchId: string;
}): string => {
  return `${input.dispatchId}::${input.attemptId}`;
};

const readDispatchResultInboxRow = async (
  db: D1Database,
  resultKey: string
): Promise<DispatchResultInboxRow | null> => {
  return await db
    .prepare(
      `
        SELECT
          result_key,
          dispatch_id,
          attempt_id,
          task_id,
          target_profile_id,
          daemon_session_id,
          lease_epoch,
          submitted_connection_generation,
          runtime_coordinator_execution_id,
          execution_token_run_id,
          execution_token_fingerprint,
          result_payload_json,
          accepted_at_ms,
          publish_state,
          published_signal_id,
          publication_error_code,
          updated_at_ms
        FROM openMeldDaemon_dispatch_result_inbox
        WHERE result_key = ?
        LIMIT 1
      `
    )
    .bind(resultKey)
    .first<DispatchResultInboxRow>();
};

const mapDispatchResultInboxRow = (
  row: DispatchResultInboxRow
): DispatchResultInboxRecord => {
  const parsedTaskResult = openMeldDaemonTaskResultEnvelopeSchema.safeParse(
    JSON.parse(row.result_payload_json)
  );
  if (!parsedTaskResult.success) {
    throw new Error("dispatch result inbox row has invalid task result");
  }

  return {
    acceptedAtMs: row.accepted_at_ms,
    attemptId: row.attempt_id,
    daemonSessionId: row.daemon_session_id,
    dispatchId: row.dispatch_id,
    executionTokenFingerprint: row.execution_token_fingerprint,
    executionTokenRunId: row.execution_token_run_id,
    leaseEpoch: row.lease_epoch,
    publishState: parsePublishState(row.publish_state),
    publishedSignalId: row.published_signal_id,
    publicationErrorCode: row.publication_error_code,
    resultKey: row.result_key,
    runtimeCoordinatorExecutionId: row.runtime_coordinator_execution_id,
    submittedConnectionGeneration: row.submitted_connection_generation,
    targetProfileId: row.target_profile_id,
    taskId: row.task_id,
    taskResult: parsedTaskResult.data,
    updatedAtMs: row.updated_at_ms,
  };
};

const parsePublishState = (value: string): DispatchResultInboxPublishState => {
  switch (value) {
    case "result_accepted":
    case "late_result_available":
    case "reply_published":
    case "reply_suppressed_stopped":
    case "reply_publication_failed":
    case "invalid_space_action":
    case "legacy_result_quarantined":
      return value;
    default:
      throw new Error(`invalid dispatch result inbox publish state: ${value}`);
  }
};

const didWriteRows = (result: unknown): boolean => {
  if (!(result && typeof result === "object" && "meta" in result)) {
    return false;
  }
  const changes = (result as { meta?: { changes?: unknown } }).meta?.changes;
  return typeof changes === "number" && changes > 0;
};
