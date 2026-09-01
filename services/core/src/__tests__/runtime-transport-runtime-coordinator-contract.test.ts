import {
  buildAgentTaskKey,
  buildRuntimeCoordinatorExecutionId,
  buildRuntimeCoordinatorFinalizationCommandId,
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
  projectTargetWakeLifecycleIdentity,
  RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION,
  RUNTIME_COORDINATOR_FINALIZATION_COMMAND_MODEL_VERSION,
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
} from "@openmeld/schemas";
import type {
  AgentControllerInterfaceSnapshot,
  DaemonRuntimeAdapterCapabilitySnapshot,
  OpenMeldDaemonAcceptedDispatchSnapshot,
  RuntimeCoordinatorExecutionTokenAuthorityRecord,
  RuntimeCoordinatorExecutionTokenEnvelope,
  RuntimeCoordinatorFailurePublicationCommand,
  RuntimeCoordinatorFailurePublicationOutcome,
  RuntimeCoordinatorFinalizationCommand,
  RuntimeCoordinatorFinalizationOutcome,
  RuntimeTransportDispatchInteractionDeliveredRequest,
  RuntimeTransportDispatchInteractionRequest,
  RuntimeTransportDispatchLifecycleRequest,
  RuntimeTransportDispatchRuntimeEvidenceRequest,
  RuntimeTransportDispatchToolActivityRequest,
  RuntimeTransportRuntimeCoordinatorDecisionRequest,
  RuntimeTransportRuntimeCoordinatorHeadAcceptRequest,
  RuntimeTransportRuntimeCoordinatorHeadNoExecutionRequest,
  RuntimeTransportRuntimeCoordinatorHeadPreAgentStopRequest,
  RuntimeTransportRuntimeCoordinatorHeadWaitingRequest,
  RuntimeTransportRuntimeCoordinatorWakeStopRequest,
  RuntimeTransportSubmitTaskResultRequest,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { handleDispatchQueueBatch } from "../dispatch/transport/queue/dispatch-queue-consumer";
import type { CoreBindings } from "../lib/bindings";
import {
  advanceRuntimeCoordinatorAgentProfileExecutionIndexRepair,
  runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys,
} from "../runtime-transport/application/agent-profile-execution-admission";
import type {
  AgentProfileWorkCoordinatorItem,
  AgentProfileWorkRecoveryGate,
} from "../runtime-transport/application/agent-profile-work-coordinator";
import {
  buildAgentProfileWorkRecoveryInboxProjectionIntent,
  buildAgentProfileWorkRecoveryInboxProjectionStorageKey,
  parseAgentProfileWorkRecoveryInboxProjectionIntent,
} from "../runtime-transport/application/agent-profile-work-recovery-inbox-projection";
import { upsertRuntimeCoordinatorAgentTaskObservationDelivery } from "../runtime-transport/application/runtime-coordinator-agent-task-observation-delivery";
import {
  buildRuntimeCoordinatorFinalizationOutcomeStorageKey,
  buildRuntimeCoordinatorHeadLifecycleStorageKey,
  RUNTIME_COORDINATOR_FINALIZATION_COMMAND_STORAGE_KEY_PREFIX,
  RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY,
  RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
  RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS,
  RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY,
  RUNTIME_COORDINATOR_WAKE_STOPPED_NOTICE_PUBLICATION_MODEL_VERSION,
  type RuntimeCoordinatorHeadLifecycleRecord,
  type RuntimeCoordinatorRunCommandState,
} from "../runtime-transport/application/runtime-coordinator-authority";
import { retireRuntimeCoordinatorTokenRun } from "../runtime-transport/application/runtime-coordinator-execution-token";
import {
  buildDispatchAttemptKey,
  type CompletedDispatchResultState,
  createRuntimeTransportMutableState,
  type PendingDispatchState,
  type RuntimeTransportMutableState,
} from "../runtime-transport/application/runtime-transport-state";
import { listActiveRuntimeCoordinatorExecutionWakeProgressSelectorsBySpace } from "../runtime-transport/infrastructure/d1/runtime-coordinator-execution-repo";
import { RuntimeTransportHub } from "../runtime-transport/transport/do/runtime-transport-hub";

const RUNTIME_COORDINATOR_EXECUTION_ID = "rce-dispatch-1";
const WRONG_RUNTIME_COORDINATOR_EXECUTION_ID = "rce-wrong-dispatch";
const HEX_SPACE_ID = "a".repeat(64);
const TARGET_AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const EXECUTION_TOKEN_PATTERN = /^rcet_v1_[a-f0-9]{64}$/;
const RUN_ID_PATTERN = /^rctr_/;
const SQL_SELECT_PATTERN = /^\s*SELECT\b/i;
const TOKEN_FINGERPRINT_PATTERN = /^etfp_v1_[a-f0-9]{32}$/;
const TOKEN_VALIDATION_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

const deliveryExecutionIdentity = {
  authority: "core_runtime_registry_binding_route" as const,
  core: {
    modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
    spaceId: HEX_SPACE_ID,
    dispatchId: "dispatch-1",
    targetProfileId: TARGET_AGENT_PROFILE_ID,
    openMeldServiceRuntimeId: {
      source: "runtime_registry_authority" as const,
      value: "runtime-1",
    },
    bindingId: "binding-1",
    agentControllerRef: "builtin:codex",
  },
};

const codexRuntimeAdapterCapability: DaemonRuntimeAdapterCapabilitySnapshot = {
  adapterId: "codex",
  capabilityDeclaration: {
    continuationCapability: "standard",
    preparationRequirement: "none",
    runtimeWorkingDirectoryMode: "spawn_cwd",
    streamingCapability: "final_only",
    workspaceResumeBehavior: "transparent",
  },
  transportModes: ["local-cli"],
};

type RecordingD1Call = {
  params: unknown[];
  query: string;
};

type RecordingDispatchAttemptAcceptanceRow = Record<string, unknown>;
type RecordingRuntimeCoordinatorExecutionRow = Record<string, unknown>;
type RecordingRuntimeAgentControllerReportRow = Record<string, unknown>;
type RecordingAgentProfileRow = Record<string, unknown>;

const createRecordingD1 = (input?: {
  agentProfileRow?: RecordingAgentProfileRow | null;
  agentControllerReportRow?: RecordingRuntimeAgentControllerReportRow | null;
  attemptAcceptanceRow?: RecordingDispatchAttemptAcceptanceRow | null;
  executionRow?: RecordingRuntimeCoordinatorExecutionRow | null;
  interactionInboxResolveFailures?: number;
  interactionInboxWriteFailures?: number;
  readinessImpactWriteError?: Error | null;
  replyPublishedProjectionWriteFailures?: number;
  taskNeedsAttentionObservationWriteFailures?: number;
  taskTerminalOutcomeReadFailures?: number;
  taskTerminalOutcomeWriteFailures?: number;
  terminalProjectionWriteFailures?: number;
}) => {
  const calls: RecordingD1Call[] = [];
  const eventRows = new Map<string, Record<string, unknown>>();
  const inboxRows = new Map<string, Record<string, unknown>>();
  const interactionInboxRows = new Map<string, Record<string, unknown>>();
  const taskNeedsAttentionObservationRows = new Map<
    string,
    Record<string, unknown>
  >();
  const taskTerminalOutcomeRows = new Map<string, Record<string, unknown>>();
  let remainingTaskNeedsAttentionObservationWriteFailures =
    input?.taskNeedsAttentionObservationWriteFailures ?? 0;
  let remainingInteractionInboxResolveFailures =
    input?.interactionInboxResolveFailures ?? 0;
  let remainingInteractionInboxWriteFailures =
    input?.interactionInboxWriteFailures ?? 0;
  let remainingTaskTerminalOutcomeWriteFailures =
    input?.taskTerminalOutcomeWriteFailures ?? 0;
  let remainingTaskTerminalOutcomeReadFailures =
    input?.taskTerminalOutcomeReadFailures ?? 0;
  let remainingReplyPublishedProjectionWriteFailures =
    input?.replyPublishedProjectionWriteFailures ?? 0;
  let remainingTerminalProjectionWriteFailures =
    input?.terminalProjectionWriteFailures ?? 0;
  let projectionReadFailureCountdown: number | null = null;
  const projectionRows = new Map<
    string,
    RecordingRuntimeCoordinatorExecutionRow
  >();
  if (input?.executionRow) {
    projectionRows.set(
      String(input.executionRow.runtime_coordinator_execution_id),
      input.executionRow
    );
  }
  const db = {
    batch: vi.fn(async (statements: D1PreparedStatement[]) => {
      const results: D1Result<unknown>[] = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      return results;
    }),
    prepare: vi.fn((query: string) => ({
      bind: vi.fn((...params: unknown[]) => {
        calls.push({ params, query });
        return {
          all: vi.fn(() => {
            if (
              query.includes(
                "FROM openMeldDaemon_runtime_coordinator_executions AS executions"
              )
            ) {
              const spaceId = String(params[0] ?? "");
              const activeStatuses = new Set(params.map(String));
              return {
                results: [...projectionRows.values()]
                  .filter(
                    (row) =>
                      row.space_id === spaceId &&
                      activeStatuses.has(String(row.status))
                  )
                  .map((row) => ({
                    dispatch_id: row.dispatch_id,
                    runtime_coordinator_execution_id:
                      row.runtime_coordinator_execution_id,
                    source_client_message_id: row.source_client_message_id,
                    source_event_id: "signal-1",
                    status: row.status,
                    target_profile_id: row.target_profile_id,
                    updated_at_ms: row.updated_at_ms,
                  })),
              };
            }
            return { results: [] };
          }),
          first: vi.fn(() => {
            if (query.includes("FROM openmeld_profiles")) {
              return {
                managed_role: null,
                organization_id: "org-one",
                owner_user_id: "owner-1",
                profile_kind: "agent",
                profile_name: "Codex Agent",
              };
            }
            if (
              query.includes("organization_id,") &&
              query.includes("owner_user_id,") &&
              query.includes("profile_name,") &&
              query.includes("managed_role") &&
              query.includes("FROM openmeld_profiles")
            ) {
              return input?.agentProfileRow ?? null;
            }
            if (
              query.includes("FROM space_index_spaces AS space") &&
              query.includes("LEFT JOIN space_index_memberships AS membership")
            ) {
              return {
                has_active_membership: 1,
                membership_count: 1,
                space_status: "active",
              };
            }
            if (query.includes("FROM space_index_spaces")) {
              return {
                organization_id: "org-one",
                organization_visibility: "private",
                space_id: String(params[0]),
              };
            }
            if (
              query.includes("FROM inbox_items") &&
              query.includes("recipient_user_id = ?")
            ) {
              const key = params.map(String).join("::");
              return interactionInboxRows.get(key) ?? null;
            }
            if (
              query.includes("FROM agent_task_needs_attention_observations")
            ) {
              const taskKey = String(params[0]);
              const eventId =
                typeof params[1] === "string" ? String(params[1]) : null;
              if (eventId) {
                return (
                  taskNeedsAttentionObservationRows.get(
                    `${taskKey}::${eventId}`
                  ) ?? null
                );
              }
              return (
                [...taskNeedsAttentionObservationRows.values()]
                  .filter((row) => row.task_key === taskKey)
                  .sort(
                    (left, right) =>
                      Number(right.occurred_at_ms) - Number(left.occurred_at_ms)
                  )[0] ?? null
              );
            }
            if (
              query.includes("SELECT *") &&
              query.includes("FROM agent_task_terminal_outcomes")
            ) {
              if (remainingTaskTerminalOutcomeReadFailures > 0) {
                remainingTaskTerminalOutcomeReadFailures -= 1;
                throw new Error("agent task terminal outcome read unavailable");
              }
              return taskTerminalOutcomeRows.get(String(params[0])) ?? null;
            }
            if (query.includes("openMeldDaemon_dispatch_result_inbox")) {
              return inboxRows.get(String(params[0])) ?? null;
            }
            if (
              query.includes(
                "FROM openMeldDaemon_runtime_coordinator_execution_events"
              )
            ) {
              const [runtimeCoordinatorExecutionId, eventType, reasonCode] =
                params;
              return (
                [...eventRows.values()].find(
                  (row) =>
                    row.runtime_coordinator_execution_id ===
                      runtimeCoordinatorExecutionId &&
                    row.event_type === eventType &&
                    row.reason_code === reasonCode
                ) ?? null
              );
            }
            if (
              query.includes("FROM openMeldDaemon_dispatch_ledger") &&
              query.includes("latest_attempt_id AS latestAttemptId")
            ) {
              return { latestAttemptId: "attempt-1" };
            }
            if (
              query.includes(
                "FROM openMeldDaemon_runtime_agent_controller_reports"
              )
            ) {
              return input?.agentControllerReportRow ?? null;
            }
            if (
              query.includes("FROM openMeldDaemon_dispatch_attempts") &&
              query.includes("execution_binding_id AS bindingId")
            ) {
              return {
                agentControllerRef: "builtin:codex",
                attemptId: "attempt-1",
                openMeldServiceRuntimeId: "runtime-1",
                bindingId: "binding-1",
                dispatchId: "dispatch-1",
                targetProfileId: TARGET_AGENT_PROFILE_ID,
                taskId: "task-1",
              };
            }
            if (query.includes("attempts.status AS attemptStatus")) {
              return input?.attemptAcceptanceRow ?? null;
            }
            if (
              query.includes("openMeldDaemon_dispatch_ledger") &&
              query.includes("openMeldDaemon_dispatch_attempts")
            ) {
              return {
                attemptId: params[2],
                dispatchId: params[0],
                dispatchOwnerId: "owner-1",
                dispatchOwnerKind: "owner_account",
                firstSeenAtMs: 1_700_000_000_000,
                idempotencyKey: "idempotency-1",
                sourceClientMessageId: "client-message-1",
                sourceEventId: "signal-1",
                spaceId: params[1],
                targetProfileId: TARGET_AGENT_PROFILE_ID,
                taskId: "task-1",
              };
            }
            if (
              query.includes("openMeldDaemon_runtime_coordinator_executions")
            ) {
              if (
                query.includes("WHERE runtime_coordinator_execution_id = ?")
              ) {
                if (projectionReadFailureCountdown !== null) {
                  if (projectionReadFailureCountdown === 0) {
                    projectionReadFailureCountdown = null;
                    throw new Error(
                      "runtime coordinator projection reread unavailable"
                    );
                  }
                  projectionReadFailureCountdown -= 1;
                }
                return projectionRows.get(String(params[0])) ?? null;
              }
              if (
                query.includes(
                  "WHERE space_id = ? AND dispatch_id = ? AND target_profile_id = ?"
                )
              ) {
                return (
                  [...projectionRows.values()].find(
                    (row) =>
                      row.space_id === params[0] &&
                      row.dispatch_id === params[1] &&
                      row.target_profile_id === params[2]
                  ) ?? null
                );
              }
              return null;
            }
            return null;
          }),
          run: vi.fn(() => {
            if (query.includes("INSERT INTO inbox_items")) {
              if (remainingInteractionInboxWriteFailures > 0) {
                remainingInteractionInboxWriteFailures -= 1;
                throw new Error("interaction Inbox write unavailable");
              }
              const [
                id,
                organizationId,
                recipientUserId,
                kind,
                attention,
                importance,
                title,
                preview,
                contextLabel,
                sourceKind,
                sourceKey,
                sourceTargetJson,
                resolutionStatus,
                occurredAtMs,
                createdAtMs,
                updatedAtMs,
              ] = params;
              const key = [
                organizationId,
                recipientUserId,
                sourceKind,
                sourceKey,
              ]
                .map(String)
                .join("::");
              const existing = interactionInboxRows.get(key);
              interactionInboxRows.set(key, {
                attention,
                context_label: contextLabel,
                created_at_ms: existing?.created_at_ms ?? createdAtMs,
                id,
                importance,
                kind,
                occurred_at_ms: occurredAtMs,
                organization_id: organizationId,
                preview,
                recipient_user_id: recipientUserId,
                resolution_status:
                  existing?.resolution_status ?? resolutionStatus,
                source_key: sourceKey,
                source_kind: sourceKind,
                source_target_json: sourceTargetJson,
                title,
                updated_at_ms: updatedAtMs,
              });
              return { meta: { changes: 1 } };
            }
            if (
              query.includes("UPDATE inbox_items") &&
              query.includes("resolution_status = 'resolved'")
            ) {
              if (remainingInteractionInboxResolveFailures > 0) {
                remainingInteractionInboxResolveFailures -= 1;
                throw new Error("interaction Inbox resolution unavailable");
              }
              const [
                resolvedAtMs,
                updatedAtMs,
                organizationId,
                sourceKind,
                sourceKey,
              ] = params;
              let changes = 0;
              for (const [key, row] of interactionInboxRows) {
                if (
                  row.organization_id === organizationId &&
                  row.source_kind === sourceKind &&
                  row.source_key === sourceKey &&
                  row.attention === "action_required" &&
                  row.resolution_status === "open"
                ) {
                  interactionInboxRows.set(key, {
                    ...row,
                    resolution_status: "resolved",
                    resolved_at_ms: resolvedAtMs,
                    updated_at_ms: updatedAtMs,
                  });
                  changes += 1;
                }
              }
              return { meta: { changes } };
            }
            if (
              query.includes(
                "INSERT INTO agent_task_needs_attention_observations"
              )
            ) {
              if (remainingTaskNeedsAttentionObservationWriteFailures > 0) {
                remainingTaskNeedsAttentionObservationWriteFailures -= 1;
                throw new Error(
                  "agent task needs-attention observation unavailable"
                );
              }
              const [
                taskKey,
                eventId,
                taskHandleJson,
                status,
                observationJson,
                occurredAtMs,
                observedAtMs,
              ] = params;
              const rowKey = `${String(taskKey)}::${String(eventId)}`;
              if (!taskNeedsAttentionObservationRows.has(rowKey)) {
                taskNeedsAttentionObservationRows.set(rowKey, {
                  event_id: eventId,
                  observation_json: observationJson,
                  observed_at_ms: observedAtMs,
                  occurred_at_ms: occurredAtMs,
                  status,
                  task_handle_json: taskHandleJson,
                  task_key: taskKey,
                });
              }
            }
            if (query.includes("INSERT INTO agent_task_terminal_outcomes")) {
              if (remainingTaskTerminalOutcomeWriteFailures > 0) {
                remainingTaskTerminalOutcomeWriteFailures -= 1;
                throw new Error("agent task terminal outcome unavailable");
              }
              const [
                taskKey,
                taskHandleJson,
                status,
                eventId,
                outcomeJson,
                occurredAtMs,
                observedAtMs,
              ] = params;
              if (!taskTerminalOutcomeRows.has(String(taskKey))) {
                taskTerminalOutcomeRows.set(String(taskKey), {
                  event_id: eventId,
                  observed_at_ms: observedAtMs,
                  occurred_at_ms: occurredAtMs,
                  outcome_json: outcomeJson,
                  status,
                  task_handle_json: taskHandleJson,
                  task_key: taskKey,
                });
              }
            }
            if (
              query.includes(
                "INSERT INTO openMeldDaemon_agent_execution_readiness_impacts"
              ) &&
              input?.readinessImpactWriteError
            ) {
              throw input.readinessImpactWriteError;
            }
            if (
              query.includes("INSERT INTO openMeldDaemon_dispatch_result_inbox")
            ) {
              const [
                resultKey,
                dispatchId,
                attemptId,
                taskId,
                targetProfileId,
                daemonSessionId,
                leaseEpoch,
                submittedConnectionGeneration,
                runtimeCoordinatorExecutionId,
                executionTokenRunId,
                executionTokenFingerprint,
                resultPayloadJson,
                acceptedAtMs,
                publishState,
                publishedSignalId,
                publicationErrorCode,
                updatedAtMs,
              ] = params;
              inboxRows.set(String(resultKey), {
                accepted_at_ms: acceptedAtMs,
                attempt_id: attemptId,
                daemon_session_id: daemonSessionId,
                dispatch_id: dispatchId,
                execution_token_fingerprint: executionTokenFingerprint,
                execution_token_run_id: executionTokenRunId,
                lease_epoch: leaseEpoch,
                publication_error_code: publicationErrorCode,
                publish_state: publishState,
                published_signal_id: publishedSignalId,
                result_key: resultKey,
                result_payload_json: resultPayloadJson,
                runtime_coordinator_execution_id: runtimeCoordinatorExecutionId,
                submitted_connection_generation: submittedConnectionGeneration,
                target_profile_id: targetProfileId,
                task_id: taskId,
                updated_at_ms: updatedAtMs,
              });
            }
            if (query.includes("UPDATE openMeldDaemon_dispatch_result_inbox")) {
              const [
                publishState,
                publishedSignalId,
                publicationErrorCode,
                updatedAtMs,
                resultKey,
              ] = params;
              const existing = inboxRows.get(String(resultKey));
              if (existing) {
                inboxRows.set(String(resultKey), {
                  ...existing,
                  publication_error_code: publicationErrorCode,
                  publish_state: publishState,
                  published_signal_id: publishedSignalId,
                  updated_at_ms: updatedAtMs,
                });
              }
            }
            if (
              query.includes(
                "INSERT INTO openMeldDaemon_runtime_coordinator_executions"
              )
            ) {
              const [
                runtimeCoordinatorExecutionId,
                modelVersion,
                spaceId,
                dispatchId,
                targetProfileId,
                sourceClientMessageId,
                openMeldServiceRuntimeIdSource,
                openMeldServiceRuntimeId,
                bindingId,
                agentControllerRef,
                status,
                terminalOutcomeJson,
                attemptId,
                claimLeaseId,
                daemonSessionId,
                connectionGeneration,
                leaseEpoch,
                createdAtMs,
                updatedAtMs,
              ] = params;
              if (
                status === "failed_terminal" &&
                remainingTerminalProjectionWriteFailures > 0
              ) {
                remainingTerminalProjectionWriteFailures -= 1;
                throw new Error("runtime coordinator projection unavailable");
              }
              if (
                status === "reply_published" &&
                remainingReplyPublishedProjectionWriteFailures > 0
              ) {
                remainingReplyPublishedProjectionWriteFailures -= 1;
                throw new Error(
                  "runtime coordinator reply projection unavailable"
                );
              }
              projectionRows.set(String(runtimeCoordinatorExecutionId), {
                attempt_id: attemptId,
                binding_id: bindingId,
                agent_controller_ref: agentControllerRef,
                claim_lease_id: claimLeaseId,
                connection_generation: connectionGeneration,
                created_at_ms: createdAtMs,
                daemon_session_id: daemonSessionId,
                dispatch_id: dispatchId,
                lease_epoch: leaseEpoch,
                model_version: modelVersion,
                runtime_coordinator_execution_id: runtimeCoordinatorExecutionId,
                openmeld_service_runtime_id: openMeldServiceRuntimeId,
                openmeld_service_runtime_id_source:
                  openMeldServiceRuntimeIdSource,
                source_client_message_id: sourceClientMessageId,
                space_id: spaceId,
                status,
                target_profile_id: targetProfileId,
                terminal_outcome_json: terminalOutcomeJson,
                updated_at_ms: updatedAtMs,
              });
            }
            if (
              query.includes(
                "INTO openMeldDaemon_runtime_coordinator_execution_events"
              )
            ) {
              const [
                eventId,
                runtimeCoordinatorExecutionId,
                eventType,
                statusAfter,
                reasonCode,
                observedAtMs,
                idempotencyKey,
                payloadJson,
              ] = params;
              if (
                query.includes("ON CONFLICT(event_id) DO UPDATE") ||
                !eventRows.has(String(eventId))
              ) {
                eventRows.set(String(eventId), {
                  event_id: eventId,
                  event_type: eventType,
                  idempotency_key: idempotencyKey,
                  observed_at_ms: observedAtMs,
                  payload_json: payloadJson,
                  reason_code: reasonCode,
                  runtime_coordinator_execution_id:
                    runtimeCoordinatorExecutionId,
                  status_after: statusAfter,
                });
              }
            }
            if (
              query.includes(
                "UPDATE openMeldDaemon_runtime_coordinator_executions"
              )
            ) {
              const [
                modelVersion,
                spaceId,
                dispatchId,
                targetProfileId,
                sourceClientMessageId,
                openMeldServiceRuntimeIdSource,
                openMeldServiceRuntimeId,
                bindingId,
                agentControllerRef,
                status,
                terminalOutcomeJson,
                attemptId,
                claimLeaseId,
                daemonSessionId,
                connectionGeneration,
                leaseEpoch,
                updatedAtMs,
                runtimeCoordinatorExecutionId,
              ] = params;
              if (
                status === "failed_terminal" &&
                remainingTerminalProjectionWriteFailures > 0
              ) {
                remainingTerminalProjectionWriteFailures -= 1;
                throw new Error("runtime coordinator projection unavailable");
              }
              if (
                status === "reply_published" &&
                remainingReplyPublishedProjectionWriteFailures > 0
              ) {
                remainingReplyPublishedProjectionWriteFailures -= 1;
                throw new Error(
                  "runtime coordinator reply projection unavailable"
                );
              }
              const existing =
                projectionRows.get(String(runtimeCoordinatorExecutionId)) ?? {};
              const existingStatus = String(existing.status ?? "");
              if (
                ["cancelled", "failed_terminal", "reply_published"].includes(
                  existingStatus
                ) &&
                existingStatus !== status
              ) {
                return { meta: { changes: 0 } };
              }
              projectionRows.set(String(runtimeCoordinatorExecutionId), {
                ...existing,
                attempt_id: attemptId,
                binding_id: bindingId,
                agent_controller_ref: agentControllerRef,
                claim_lease_id: claimLeaseId,
                connection_generation: connectionGeneration,
                daemon_session_id: daemonSessionId,
                dispatch_id: dispatchId,
                lease_epoch: leaseEpoch,
                model_version: modelVersion,
                runtime_coordinator_execution_id: runtimeCoordinatorExecutionId,
                openmeld_service_runtime_id: openMeldServiceRuntimeId,
                openmeld_service_runtime_id_source:
                  openMeldServiceRuntimeIdSource,
                source_client_message_id: sourceClientMessageId,
                space_id: spaceId,
                status,
                target_profile_id: targetProfileId,
                terminal_outcome_json: terminalOutcomeJson,
                updated_at_ms: updatedAtMs,
              });
            }
            return { meta: { changes: 1 } };
          }),
        };
      }),
    })),
  } as unknown as D1Database;

  return {
    calls,
    db,
    eventRows,
    failProjectionReadAfter: (successfulReads: number) => {
      projectionReadFailureCountdown = successfulReads;
    },
    inboxRows,
    interactionInboxRows,
    projectionRows,
    taskNeedsAttentionObservationRows,
    taskTerminalOutcomeRows,
  };
};

const createHarness = (input?: {
  agentProfileRow?: RecordingAgentProfileRow | null;
  agentControllerReportRow?: RecordingRuntimeAgentControllerReportRow | null;
  attemptAcceptanceRow?: RecordingDispatchAttemptAcceptanceRow | null;
  exhaustionAuthorityProjectionRaceStatus?:
    | "cancelled"
    | "failed_terminal_other"
    | "reply_published";
  exhaustionAuthorityWriteFailures?: number;
  exhaustionProjectionRereadError?: boolean;
  executionRow?: RecordingRuntimeCoordinatorExecutionRow | null;
  interactionInboxResolveFailures?: number;
  interactionInboxWriteFailures?: number;
  maxStorageGetKeys?: number;
  promotionRedriveStatus?: "enqueued" | "retry_scheduled";
  readinessImpactWriteError?: Error | null;
  replyPublishedAuthorityWriteFailures?: number;
  replyPublishedProjectionWriteFailures?: number;
  storageSetAlarmFailures?: number;
  storageRecords?: Map<string, unknown>;
  taskTerminalOutcomeReadFailures?: number;
  taskTerminalOutcomeWriteFailures?: number;
  taskNeedsAttentionObservationWriteFailures?: number;
  terminalProjectionWriteFailures?: number;
}) => {
  const state = createRuntimeTransportMutableState();
  state.pendingDispatches.set(
    buildDispatchAttemptKey("dispatch-1", "attempt-1"),
    buildPendingDispatch()
  );

  const recordingD1 = createRecordingD1({
    agentProfileRow: input?.agentProfileRow ?? null,
    agentControllerReportRow: input?.agentControllerReportRow ?? null,
    attemptAcceptanceRow: input?.attemptAcceptanceRow ?? null,
    executionRow: input?.executionRow ?? null,
    interactionInboxResolveFailures:
      input?.interactionInboxResolveFailures ?? 0,
    interactionInboxWriteFailures: input?.interactionInboxWriteFailures ?? 0,
    readinessImpactWriteError: input?.readinessImpactWriteError ?? null,
    replyPublishedProjectionWriteFailures:
      input?.replyPublishedProjectionWriteFailures ?? 0,
    taskTerminalOutcomeReadFailures:
      input?.taskTerminalOutcomeReadFailures ?? 0,
    taskNeedsAttentionObservationWriteFailures:
      input?.taskNeedsAttentionObservationWriteFailures ?? 0,
    taskTerminalOutcomeWriteFailures:
      input?.taskTerminalOutcomeWriteFailures ?? 0,
    terminalProjectionWriteFailures:
      input?.terminalProjectionWriteFailures ?? 0,
  });
  const appliedFinalizationCommands: RuntimeCoordinatorFinalizationCommand[] =
    [];
  const appliedFailurePublicationCommands: RuntimeCoordinatorFailurePublicationCommand[] =
    [];
  const spaceFetchRequests: Array<{ body: unknown; path: string }> = [];
  const spaceStub = {
    fetch: vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      const body = await request.json();
      spaceFetchRequests.push({
        body,
        path: url.pathname,
      });
      if (url.pathname.startsWith("/internal/dispatches/")) {
        return Response.json({
          dispatchId: url.pathname.split("/").at(3) ?? "dispatch-1",
          ok: true,
          status: input?.promotionRedriveStatus ?? "enqueued",
          targetProfileId:
            typeof (body as { targetProfileId?: unknown }).targetProfileId ===
            "string"
              ? (body as { targetProfileId: string }).targetProfileId
              : TARGET_AGENT_PROFILE_ID,
        });
      }
      return Response.json({
        v: 1,
        id: "signal-delivery-expired-1",
        spaceId: HEX_SPACE_ID,
        ts: 1_700_000_031_000,
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.system_notice",
        data: {
          noticeType: "terminal_failure",
          actorProfileId: TARGET_AGENT_PROFILE_ID,
          actorName: "Codex Agent",
          dispatchId: "dispatch-1",
          generatedBy: "openmeld",
          reason: "runtime_coordinator.delivery_expired",
          text: "Codex Agent did not receive this Wake before it expired. Wake the agent again when the local OpenMeld Service is online.",
        },
      });
    }),
    rpcPostSystemNoticeSignal: vi.fn(
      (input: {
        data: unknown;
        finalOutcomeAuthority?: unknown;
        profile: unknown;
        threadContext?: unknown;
      }) => {
        spaceFetchRequests.push({
          path: "/rpc/signals/system-notice",
          body: {
            profile: input.profile,
            data: input.data,
            ...(input.finalOutcomeAuthority
              ? { finalOutcomeAuthority: input.finalOutcomeAuthority }
              : {}),
            ...(input.threadContext
              ? { threadContext: input.threadContext }
              : {}),
          },
        });
        return Promise.resolve({
          v: 1,
          id: "signal-delivery-expired-1",
          spaceId: HEX_SPACE_ID,
          ts: 1_700_000_031_000,
          profile: {
            kind: "system",
            profileId: "openmeld-system",
            profileName: "OpenMeld System",
          },
          type: "signal.system_notice",
          data: {
            noticeType: "terminal_failure",
            actorProfileId: TARGET_AGENT_PROFILE_ID,
            actorName: "Codex Agent",
            dispatchId: "dispatch-1",
            generatedBy: "openmeld",
            reason: "runtime_coordinator.delivery_expired",
            text: "Codex Agent did not receive this Wake before it expired. Wake the agent again when the local OpenMeld Service is online.",
          },
        });
      }
    ),
    rpcPostExecutionRecoveryNoticeSignal: vi.fn(
      (input: { data: unknown; profile: unknown; threadContext?: unknown }) => {
        spaceFetchRequests.push({
          path: "/rpc/signals/execution-recovery",
          body: {
            profile: input.profile,
            data: input.data,
            ...(input.threadContext
              ? { threadContext: input.threadContext }
              : {}),
          },
        });
        return Promise.resolve({
          publishedSignalId: "execution-recovery:space-1:dispatch-1::attempt-1",
          status: "published" as const,
        });
      }
    ),
    rpcApplyRuntimeCoordinatorFinalizationCommand: vi.fn(
      (
        command: RuntimeCoordinatorFinalizationCommand
      ): RuntimeCoordinatorFinalizationOutcome => {
        appliedFinalizationCommands.push(command);
        return {
          finalMessageKind: "success_reply" as const,
          finalizationCommandId: command.finalizationCommandId,
          ok: true as const,
          publicationErrorCode: null,
          publishedSignalId: "signal-final-1",
          publishState: "reply_published" as const,
          status: "finalized" as const,
        };
      }
    ),
    rpcReadRuntimeCoordinatorFinalizationClaimOutcome: vi.fn(
      (_command: RuntimeCoordinatorFinalizationCommand) =>
        Promise.resolve({
          status: "unresolved" as const,
        })
    ),
    rpcApplyRuntimeCoordinatorPublicationExhaustionCommand: vi.fn(
      (_command: RuntimeCoordinatorFinalizationCommand) =>
        Promise.resolve({
          publishedSignalId: "signal-publication-failed-1",
          status: "publication_failed_visible" as const,
        })
    ),
    rpcApplyAgentStreamPart: vi.fn((input: { sequence: number }) =>
      Promise.resolve({
        status: "accepted" as const,
        lastSequence: input.sequence,
      })
    ),
    rpcCloseAgentStream: vi.fn(() => Promise.resolve(null)),
    rpcApplyRuntimeCoordinatorFailurePublicationCommand: vi.fn(
      (
        command: RuntimeCoordinatorFailurePublicationCommand
      ): RuntimeCoordinatorFailurePublicationOutcome => {
        appliedFailurePublicationCommands.push(command);
        return {
          failurePublicationCommandId: command.failurePublicationCommandId,
          finalMessageKind: "failure_notice" as const,
          ok: true as const,
          publicationAction: "created" as const,
          publicationErrorCode: null,
          publishedSignalId: "signal-head-failure-1",
          status: "failure_published" as const,
        };
      }
    ),
  };
  const sentFrames: unknown[] = [];
  const storageRecords = input?.storageRecords ?? new Map<string, unknown>();
  let remainingReplyPublishedAuthorityWriteFailures =
    input?.replyPublishedAuthorityWriteFailures ?? 0;
  let remainingExhaustionAuthorityWriteFailures =
    input?.exhaustionAuthorityWriteFailures ?? 0;
  const storagePut = vi.fn((key: string, value: unknown) => {
    const terminalOutcome = (
      value as {
        terminalOutcome?: { reasonCode?: unknown; status?: unknown } | null;
      }
    )?.terminalOutcome;
    if (
      key.includes("runtime-coordinator:execution-token-authority:") &&
      terminalOutcome?.status === "reply_published" &&
      remainingReplyPublishedAuthorityWriteFailures > 0
    ) {
      remainingReplyPublishedAuthorityWriteFailures -= 1;
      return Promise.reject(
        new Error("runtime coordinator reply authority unavailable")
      );
    }
    if (
      key.includes("runtime-coordinator:execution-token-authority:") &&
      terminalOutcome?.status === "failed_terminal" &&
      terminalOutcome.reasonCode ===
        "runtime_coordinator.publication_retry_exhausted"
    ) {
      if (remainingExhaustionAuthorityWriteFailures > 0) {
        remainingExhaustionAuthorityWriteFailures -= 1;
        return Promise.reject(
          new Error("runtime coordinator exhaustion authority unavailable")
        );
      }
      if (!input?.exhaustionAuthorityProjectionRaceStatus) {
        storageRecords.set(key, value);
        return Promise.resolve();
      }
      const existingProjection = recordingD1.projectionRows.get(
        RUNTIME_COORDINATOR_EXECUTION_ID
      );
      if (existingProjection) {
        const raceStatus = input.exhaustionAuthorityProjectionRaceStatus;
        const status =
          raceStatus === "failed_terminal_other"
            ? "failed_terminal"
            : raceStatus;
        recordingD1.projectionRows.set(RUNTIME_COORDINATOR_EXECUTION_ID, {
          ...existingProjection,
          status,
          terminal_outcome_json: JSON.stringify({
            kind: status,
            observedAtMs: Date.now(),
            reasonCode: "test.concurrent_terminal_projection",
          }),
          updated_at_ms:
            raceStatus === "failed_terminal_other"
              ? Date.now() + 1
              : Date.now(),
        });
        if (input.exhaustionProjectionRereadError) {
          recordingD1.failProjectionReadAfter(1);
        }
      }
      storageRecords.set(key, value);
      return Promise.resolve();
    }
    storageRecords.set(key, value);
    return Promise.resolve();
  });
  let remainingStorageSetAlarmFailures = input?.storageSetAlarmFailures ?? 0;
  const storageSetAlarm = vi.fn(() => {
    if (remainingStorageSetAlarmFailures > 0) {
      remainingStorageSetAlarmFailures -= 1;
      return Promise.reject(new Error("durable object alarm unavailable"));
    }
    return Promise.resolve();
  });
  let maxStorageGetKeys = input?.maxStorageGetKeys;
  let activeArrayStorageGetCount = 0;
  let maxConcurrentArrayStorageGetCount = 0;
  const storageGet = vi.fn(async (key: string | string[]) => {
    const isArrayRead = Array.isArray(key);
    if (isArrayRead) {
      activeArrayStorageGetCount += 1;
      maxConcurrentArrayStorageGetCount = Math.max(
        maxConcurrentArrayStorageGetCount,
        activeArrayStorageGetCount
      );
      await Promise.resolve();
    }
    try {
      if (
        isArrayRead &&
        maxStorageGetKeys !== undefined &&
        key.length > maxStorageGetKeys
      ) {
        throw new Error(
          `Durable Object storage.get exceeded ${maxStorageGetKeys} keys`
        );
      }
      return isArrayRead
        ? new Map(
            key.flatMap((entry) =>
              storageRecords.has(entry)
                ? ([[entry, storageRecords.get(entry)]] as const)
                : []
            )
          )
        : storageRecords.get(key);
    } finally {
      if (isArrayRead) {
        activeArrayStorageGetCount -= 1;
      }
    }
  });
  const storageDelete = vi.fn(async (key: string) =>
    storageRecords.delete(key)
  );
  const storageList = vi.fn(
    async (
      options: { limit?: number; prefix?: string; startAfter?: string } = {}
    ) =>
      new Map(
        [...storageRecords.entries()]
          .filter(([key]) =>
            options.prefix ? key.startsWith(options.prefix) : true
          )
          .filter(([key]) =>
            options.startAfter ? key > options.startAfter : true
          )
          .sort(([left], [right]) => left.localeCompare(right))
          .slice(0, options.limit)
      )
  );
  const storageTransactionPut = vi.fn(
    async (keyOrEntries: string | Record<string, unknown>, value?: unknown) => {
      if (typeof keyOrEntries === "string") {
        await storagePut(keyOrEntries, value);
        return;
      }
      for (const [key, entry] of Object.entries(keyOrEntries)) {
        await storagePut(key, entry);
      }
    }
  );
  const storageTransaction = vi.fn(
    async <T>(
      operation: (transaction: DurableObjectTransaction) => Promise<T>
    ) =>
      await operation({
        delete: storageDelete,
        get: storageGet,
        list: storageList,
        put: storageTransactionPut,
        setAlarm: storageSetAlarm,
      } as unknown as DurableObjectTransaction)
  );
  const waitUntilTasks: Promise<unknown>[] = [];
  const queuedObservationRedrives: unknown[] = [];
  const queueSend = vi.fn((message: unknown) => {
    queuedObservationRedrives.push(message);
    return Promise.resolve();
  });
  let socketAttachment: unknown = {
    connectionGeneration: 1,
    daemonSessionId: "daemon-session-1",
    verifiedOwnerUserId: "owner-1",
  };
  const socket = {
    deserializeAttachment: vi.fn(() => socketAttachment),
    send: vi.fn((message: string) => {
      sentFrames.push(JSON.parse(message));
    }),
    serializeAttachment: vi.fn((value: unknown) => {
      socketAttachment = value;
    }),
  } as unknown as WebSocket;

  const hub = Object.create(
    RuntimeTransportHub.prototype
  ) as RuntimeTransportHub & {
    ctx: DurableObjectState;
    env: CoreBindings;
    sendFrame: (
      webSocket: WebSocket,
      input: { code: string; payload: Record<string, unknown> }
    ) => void;
    cleanupCompletedResults: (nowMs: number) => void;
    cleanupExpiredPendingDispatches: (nowMs: number) => void;
    reapExpiredLeases: (nowMs: number) => void;
    persistRuntimeRecords: () => void;
    resolvePendingResultWaiters: (
      dispatchAttemptKey: string,
      response: unknown
    ) => void;
    state: RuntimeTransportMutableState;
  };
  Object.defineProperty(hub, "state", { value: state });
  Object.defineProperty(hub, "env", {
    value: {
      OPENMELD_DB: recordingD1.db,
      OPENMELD_DAEMON_DISPATCH_QUEUE: {
        send: queueSend,
      },
      OPENMELD_SPACES: {
        get: vi.fn(() => spaceStub),
        idFromString: vi.fn((spaceId: string) => spaceId),
      },
    } as unknown as CoreBindings,
  });
  Object.defineProperty(hub, "ctx", {
    value: {
      storage: {
        delete: storageDelete,
        deleteAlarm: vi.fn(async () => undefined),
        get: storageGet,
        getAlarm: vi.fn(async () => null),
        list: storageList,
        put: storagePut,
        setAlarm: storageSetAlarm,
        transaction: storageTransaction,
      },
      waitUntil: vi.fn((task: Promise<unknown>) => {
        waitUntilTasks.push(task);
      }),
    },
  });
  Object.defineProperty(hub, "scheduledHousekeepingAlarmAtMs", {
    value: null,
    writable: true,
  });
  Object.defineProperty(hub, "routeCatalogReconciliationSignalsBySessionKey", {
    value: new Map(),
  });
  Object.defineProperty(hub, "pendingAgentReadinessInvalidationsByReason", {
    value: new Map(),
    writable: true,
  });
  Object.defineProperty(hub, "agentReadinessInvalidationFlushTimer", {
    value: null,
    writable: true,
  });
  Object.defineProperty(
    hub,
    "expectedRouteReconciliationReadCacheBySessionKey",
    {
      value: new Map(),
    }
  );
  Object.defineProperty(hub, "orderedDispatchFrameTails", {
    value: new Map(),
  });
  Object.defineProperty(hub, "runtimeCoordinatorFinalizationTails", {
    value: new Map(),
  });
  Object.defineProperty(hub, "runtimeCoordinatorFinalizationRecoveryTails", {
    value: new Map(),
  });
  Object.defineProperty(hub, "sendFrame", {
    value: (
      webSocket: WebSocket,
      input: { code: string; payload: Record<string, unknown> }
    ) => {
      webSocket.send(
        JSON.stringify({
          code: input.code,
          payload: input.payload,
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        })
      );
    },
  });
  Object.defineProperty(hub, "cleanupCompletedResults", {
    value: vi.fn(),
  });
  Object.defineProperty(hub, "cleanupExpiredPendingDispatches", {
    value: vi.fn(),
  });
  Object.defineProperty(hub, "reapExpiredLeases", {
    value: vi.fn(),
  });
  Object.defineProperty(hub, "persistRuntimeRecords", {
    value: vi.fn(),
  });
  Object.defineProperty(hub, "resolvePendingResultWaiters", {
    value: vi.fn(),
  });

  return {
    hub,
    appliedFailurePublicationCommands,
    appliedFinalizationCommands,
    recordingD1,
    getMaxConcurrentArrayStorageGets: () => maxConcurrentArrayStorageGetCount,
    queuedObservationRedrives,
    queueSend,
    sentFrames,
    resetArrayStorageGetConcurrency: () => {
      activeArrayStorageGetCount = 0;
      maxConcurrentArrayStorageGetCount = 0;
    },
    setMaxStorageGetKeys: (value: number | undefined) => {
      maxStorageGetKeys = value;
    },
    spaceFetchRequests,
    socket,
    spaceStub,
    state,
    storageGet,
    storageList,
    storageSetAlarm,
    storageTransaction,
    storagePut,
    storageRecords,
    waitUntilTasks,
  };
};

const beginExecutionIndexGenerationRepair = (
  storageRecords: Map<string, unknown>,
  nowMs = Date.now()
): void => {
  const activeProfileIndexKey = [...storageRecords.keys()].find((key) =>
    key.includes("agent-profile-active-index")
  );
  const currentIndex = storageRecords.get(
    runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.index
  ) as
    | {
        generation: number;
        modelVersion: string;
        ownerUserId: string;
      }
    | undefined;
  const currentActiveProfileIndex = activeProfileIndexKey
    ? (storageRecords.get(activeProfileIndexKey) as
        | { modelVersion: string }
        | undefined)
    : undefined;
  if (!(activeProfileIndexKey && currentIndex && currentActiveProfileIndex)) {
    throw new Error("Expected ready execution index state.");
  }
  const generation = currentIndex.generation + 1;
  storageRecords.set(
    runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.index,
    {
      cursor: null,
      failureCount: 0,
      generation,
      modelVersion: currentIndex.modelVersion,
      ownerUserId: currentIndex.ownerUserId,
      phase: "head_lifecycles",
      repairRequested: true,
      status: "rebuilding",
      updatedAtMs: nowMs,
    }
  );
  storageRecords.set(activeProfileIndexKey, {
    generation,
    modelVersion: currentActiveProfileIndex.modelVersion,
    targetProfileIds: [],
  });
};

const finishExecutionIndexGenerationRepair = async (
  hub: unknown,
  nowMs = Date.now()
): Promise<void> => {
  const storage = (hub as { ctx: { storage: DurableObjectStorage } }).ctx
    .storage;
  for (let step = 0; step < 8; step += 1) {
    const status =
      await advanceRuntimeCoordinatorAgentProfileExecutionIndexRepair({
        nowMs,
        storage,
      });
    if (status === "ready") {
      return;
    }
  }
  throw new Error("Expected execution index repair to finish.");
};

async function deliverAgentTaskObservationRedriveThroughQueue(input: {
  body: unknown;
  db: D1Database;
  hub: RuntimeTransportHub;
}): Promise<void> {
  const ack = vi.fn();
  const retry = vi.fn();
  const message = {
    ack,
    attempts: 1,
    body: input.body,
    id: `observation-redrive:${crypto.randomUUID()}`,
    retry,
    timestamp: new Date(),
  };
  await handleDispatchQueueBatch({
    batch: {
      messages: [message],
      queue: "openmeld-daemon-dispatch",
    } as unknown as MessageBatch<unknown>,
    ctx: {
      waitUntil: vi.fn(),
    },
    env: {
      OPENMELD_DB: input.db,
      OPENMELD_LOCAL_STATE_DB: input.db,
      OPENMELD_RUNTIME_TRANSPORT: {
        get: vi.fn(() => input.hub),
        idFromName: vi.fn((ownerUserId: string) => ownerUserId),
      },
      OPENMELD_SPACES: {},
    } as unknown as CoreBindings,
  });
  if (ack.mock.calls.length !== 1 || retry.mock.calls.length !== 0) {
    throw new Error(
      "Agent Task observation redrive must ACK once without retrying."
    );
  }
}

const buildPendingDispatch = (): PendingDispatchState => ({
  acceptedLocalAtMs: null,
  attemptId: "attempt-1",
  completedLocalAtMs: null,
  connectionGeneration: 1,
  createdAtMs: 1_700_000_000_000,
  daemonSessionId: "daemon-session-1",
  dispatchId: "dispatch-1",
  executionIdentity: deliveryExecutionIdentity,
  lastLifecycleAtMs: 1_700_000_000_000,
  leaseEpoch: 2,
  phase: "starting",
  profileId: TARGET_AGENT_PROFILE_ID,
  runningAtMs: null,
  runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
  sourceClientMessageId: "client-message-1",
  sourceSignalId: "signal-1",
  spaceAccess: {} as PendingDispatchState["spaceAccess"],
  spaceId: HEX_SPACE_ID,
  targetProfileName: "Codex Agent",
  taskId: "task-1",
});

const buildResultRequest = (
  overrides: Partial<RuntimeTransportSubmitTaskResultRequest> = {}
): RuntimeTransportSubmitTaskResultRequest => ({
  v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
  connectionGeneration: 1,
  daemonSessionId: "daemon-session-1",
  dispatchId: "dispatch-1",
  executionIdentityEcho: {
    core: deliveryExecutionIdentity.core,
    echoSource: "daemon_delivery_context",
  },
  leaseEpoch: 2,
  taskResult: {
    v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
    code: "service.task_result",
    payload: {
      agentId: TARGET_AGENT_PROFILE_ID,
      attemptId: "attempt-1",
      deduped: false,
      output: "done",
      sourceEventId: "signal-1",
      status: "success",
      taskId: "task-1",
    },
  },
  ...overrides,
  attemptId: overrides.attemptId ?? "attempt-1",
});

const buildSuccessfulPostMessageTaskResult =
  (): RuntimeTransportSubmitTaskResultRequest["taskResult"] => ({
    code: "service.task_result",
    payload: {
      agentId: TARGET_AGENT_PROFILE_ID,
      attemptId: "attempt-1",
      deduped: false,
      output: "done",
      sourceEventId: "signal-1",
      spaceAction: {
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "done",
        },
        type: "post_message",
      },
      status: "success",
      taskId: "task-1",
    },
    v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
  });

const buildSuccessfulInternalOnlyTaskResult =
  (): RuntimeTransportSubmitTaskResultRequest["taskResult"] => ({
    code: "service.task_result",
    payload: {
      agentId: TARGET_AGENT_PROFILE_ID,
      attemptId: "attempt-1",
      deduped: false,
      output: "No public reply is needed.",
      sourceEventId: "signal-1",
      status: "success",
      suppressPublicOutcome: true,
      taskId: "task-1",
    },
    v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
  });

const buildSuccessfulStaySilentTaskResult =
  (): RuntimeTransportSubmitTaskResultRequest["taskResult"] => ({
    code: "service.task_result",
    payload: {
      agentId: TARGET_AGENT_PROFILE_ID,
      attemptId: "attempt-1",
      deduped: false,
      output: "No public reply is needed.",
      sourceEventId: "signal-1",
      spaceAction: {
        reason: "The Wake does not need a reply.",
        type: "stay_silent",
      },
      status: "success",
      taskId: "task-1",
    },
    v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
  });

const buildFailedVisibleTaskResult =
  (): RuntimeTransportSubmitTaskResultRequest["taskResult"] => ({
    code: "service.task_result",
    payload: {
      agentId: TARGET_AGENT_PROFILE_ID,
      attemptId: "attempt-1",
      deduped: false,
      errorCode: "quota.exceeded",
      errorMessage: "Provider quota exhausted.",
      errorType: "adapter",
      sourceEventId: "signal-1",
      status: "failed",
      taskId: "task-1",
    },
    v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
  });

const buildOwnerConflictTaskResult =
  (): RuntimeTransportSubmitTaskResultRequest["taskResult"] => ({
    v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
    code: "service.task_result",
    payload: {
      agentId: TARGET_AGENT_PROFILE_ID,
      attemptId: "attempt-1",
      deduped: false,
      errorCode: "runtime.task.local_owner_conflict",
      errorMessage: "local task owner conflict",
      errorType: "policy",
      sourceEventId: "signal-1",
      status: "failed",
      suppressPublicOutcome: true,
      taskId: "task-1",
    },
  });

const buildLifecycleRequest = (
  overrides: Partial<RuntimeTransportDispatchLifecycleRequest> = {}
): RuntimeTransportDispatchLifecycleRequest => ({
  v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
  attemptId: "attempt-1",
  connectionGeneration: 1,
  daemonSessionId: "daemon-session-1",
  dispatchId: "dispatch-1",
  leaseEpoch: 2,
  lifecycleAtMs: 1_700_000_000_100,
  phase: "running",
  ...overrides,
});

const buildRuntimeEvidenceRequest = (
  overrides: Partial<RuntimeTransportDispatchRuntimeEvidenceRequest> = {}
): RuntimeTransportDispatchRuntimeEvidenceRequest => ({
  v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
  attemptId: "attempt-1",
  connectionGeneration: 1,
  daemonSessionId: "daemon-session-1",
  dispatchId: "dispatch-1",
  evidenceAtMs: 1_700_000_000_100,
  executionIdentityEcho: {
    core: deliveryExecutionIdentity.core,
    echoSource: "daemon_delivery_context",
  },
  leaseEpoch: 2,
  phase: "runtime_started",
  sourceSignalId: "signal-1",
  spaceId: HEX_SPACE_ID,
  targetProfileId: TARGET_AGENT_PROFILE_ID,
  taskId: "task-1",
  ...overrides,
});

const buildToolActivityRequest = (
  overrides: Partial<RuntimeTransportDispatchToolActivityRequest> = {}
): RuntimeTransportDispatchToolActivityRequest => ({
  v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
  attemptId: "attempt-1",
  connectionGeneration: 1,
  daemonSessionId: "daemon-session-1",
  dispatchId: "dispatch-1",
  executionIdentityEcho: {
    core: deliveryExecutionIdentity.core,
    echoSource: "daemon_delivery_context",
  },
  executionTokenEcho: overrides.executionTokenEcho ?? {
    executionToken: `rcet_v1_${"a".repeat(64)}`,
    runId: "run-placeholder",
    runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
    tokenFingerprint: `etfp_v1_${"a".repeat(32)}`,
  },
  leaseEpoch: 2,
  observedAtMs: 1_700_000_000_100,
  part: {
    type: "tool",
    toolCallId: "tool-call-1",
    toolName: "agent_run_command",
    state: "input-available",
  },
  runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
  sequence: 1,
  sourceSignalId: "signal-1",
  spaceId: HEX_SPACE_ID,
  targetProfileId: TARGET_AGENT_PROFILE_ID,
  taskId: "task-1",
  ...overrides,
});

const buildInteractionRequest = (
  executionToken: RuntimeCoordinatorExecutionTokenEnvelope,
  overrides: Partial<RuntimeTransportDispatchInteractionRequest> = {}
): RuntimeTransportDispatchInteractionRequest => ({
  attemptId: "attempt-1",
  connectionGeneration: 1,
  daemonSessionId: "daemon-session-1",
  dispatchId: "dispatch-1",
  executionIdentityEcho: {
    core: deliveryExecutionIdentity.core,
    echoSource: "daemon_delivery_context",
  },
  executionTokenEcho: buildExecutionTokenEcho(executionToken),
  interaction: {
    description: "Codex needs permission before running this command.",
    expiresAtMs: Date.now() + 60_000,
    interactionId: "interaction-1",
    kind: "permission",
    options: [
      {
        intent: "allow_once",
        label: "Allow once",
        optionId: "allow-once",
      },
      {
        intent: "deny",
        label: "Deny",
        optionId: "deny",
      },
    ],
    requestedAtMs: Date.now(),
    subject: {
      command: "git status",
      cwd: "/workspace",
      type: "command",
    },
    title: "Allow this command?",
    v: 1,
  },
  leaseEpoch: 2,
  runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
  taskId: "task-1",
  v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
  ...overrides,
});

const buildInteractionDeliveredRequest = (
  executionToken: RuntimeCoordinatorExecutionTokenEnvelope,
  overrides: Partial<RuntimeTransportDispatchInteractionDeliveredRequest> = {}
): RuntimeTransportDispatchInteractionDeliveredRequest => ({
  attemptId: "attempt-1",
  connectionGeneration: 1,
  daemonSessionId: "daemon-session-1",
  deliveredAtMs: Date.now(),
  dispatchId: "dispatch-1",
  executionIdentityEcho: {
    core: deliveryExecutionIdentity.core,
    echoSource: "daemon_delivery_context",
  },
  executionTokenEcho: buildExecutionTokenEcho(executionToken),
  interactionId: "interaction-1",
  leaseEpoch: 2,
  runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
  v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
  ...overrides,
});

const buildDeliverRequest = (
  overrides: {
    replyToSnapshot?: {
      signalId: string;
      profileId: string;
      profileKind: "agent" | "human" | "system" | null;
      profileName: string;
      previewText: string;
    };
    threadContext?: {
      rootSignalId: string;
      threadId: string;
    };
    runtimeCoordinatorExecutionId?: string;
  } = {}
) => ({
  v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
  attemptId: "attempt-1",
  connectionGeneration: 1,
  daemonSessionId: "daemon-session-1",
  dispatchId: "dispatch-1",
  leaseEpoch: 2,
  ownerUserId: "owner-1",
  profileId: TARGET_AGENT_PROFILE_ID,
  payload: {
    attemptId: "attempt-1",
    contextIdMappingSpec: null,
    controllerSnapshot: {
      agentControllerRef: "builtin:codex",
      bindingId: "binding-1",
      configurationRevision: 1,
      targetBindingEnabled: true,
      targetBindingState: "bound" as const,
    },
    dispatchContractVersion: 2,
    dispatchId: "dispatch-1",
    dispatchPolicy: "mention_only" as const,
    dispatchRulesSnapshot: {
      dispatchPolicy: "mention_only" as const,
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      ruleSource: "registry" as const,
    },
    enqueuedAtMs: 1_700_000_000_000,
    executionIdentity: deliveryExecutionIdentity,
    idempotencyKey: "idempotency-1",
    runtimeCoordinatorExecutionId:
      overrides.runtimeCoordinatorExecutionId ??
      RUNTIME_COORDINATOR_EXECUTION_ID,
    sourceEventId: "signal-1",
    sourceClientMessageId: "client-message-1",
    sourceSignal: {
      profileId: "human-1",
      profileKind: "human" as const,
      text: "hello",
    },
    spaceId: HEX_SPACE_ID,
    targetProfileId: TARGET_AGENT_PROFILE_ID,
    targetProfileName: "Codex Agent",
    taskId: "task-1",
    ...(overrides.replyToSnapshot
      ? { replyToSnapshot: overrides.replyToSnapshot }
      : {}),
    ...(overrides.threadContext
      ? { threadContext: overrides.threadContext }
      : {}),
  },
});

const buildRuntimeCoordinatorHeadAcceptRequest = (
  overrides: Partial<RuntimeTransportRuntimeCoordinatorHeadAcceptRequest> = {}
): RuntimeTransportRuntimeCoordinatorHeadAcceptRequest => {
  const dispatchId = overrides.dispatchId ?? "dispatch-1";
  const targetWakeLifecycleIdentity =
    overrides.targetWakeLifecycleIdentity ??
    projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId,
      sourceSignalId: "signal-1",
      spaceId: HEX_SPACE_ID,
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
  return {
    v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    ...(overrides.acceptedDispatchSnapshot
      ? { acceptedDispatchSnapshot: overrides.acceptedDispatchSnapshot }
      : {}),
    dispatchId,
    idempotencyKey: overrides.idempotencyKey ?? "idempotency-1",
    ownerUserId: overrides.ownerUserId ?? "owner-1",
    targetProfileMentionLabel:
      overrides.targetProfileMentionLabel ?? "Codex Agent",
    targetProfileName: overrides.targetProfileName ?? "Codex Agent",
    targetWakeLifecycleIdentity,
  };
};

const buildAcceptedDispatchSnapshot = (input: {
  agentControllerRef?: string;
  bindingId?: string;
  configurationRevision?: number;
  fingerprint: string;
  openMeldServiceRuntimeId?: string;
}): OpenMeldDaemonAcceptedDispatchSnapshot => ({
  controllerSnapshot: {
    agentControllerRef: input.agentControllerRef ?? "builtin:codex",
    bindingId: input.bindingId ?? "binding-accepted-1",
    configurationRevision: input.configurationRevision ?? 7,
    targetBindingEnabled: true,
    targetBindingState: "bound",
  },
  openMeldServiceRuntimeId:
    input.openMeldServiceRuntimeId ?? "runtime-accepted-1",
  payloadFingerprint: `sha256:${input.fingerprint.repeat(64)}`,
  runtimeKind: "openmeld_service",
});

const buildRuntimeCoordinatorHeadNoExecutionRequest = (
  overrides: Partial<RuntimeTransportRuntimeCoordinatorHeadNoExecutionRequest> = {}
): RuntimeTransportRuntimeCoordinatorHeadNoExecutionRequest => {
  const dispatchId = overrides.dispatchId ?? "dispatch-1";
  const targetWakeLifecycleIdentity =
    overrides.targetWakeLifecycleIdentity ??
    projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId,
      sourceSignalId: "signal-1",
      spaceId: HEX_SPACE_ID,
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
  return {
    v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    dispatchId,
    idempotencyKey: overrides.idempotencyKey ?? "idempotency-1",
    ownerUserId: overrides.ownerUserId ?? "owner-1",
    publicationCategory: overrides.publicationCategory ?? "binding_required",
    reasonCode: overrides.reasonCode ?? "agent_profile_binding.missing",
    targetWakeLifecycleIdentity,
    userRecoveryAction: overrides.userRecoveryAction ?? "set_up_agent_binding",
  };
};

const buildRuntimeCoordinatorHeadPreAgentStopRequest = (
  overrides: Partial<RuntimeTransportRuntimeCoordinatorHeadPreAgentStopRequest> = {}
): RuntimeTransportRuntimeCoordinatorHeadPreAgentStopRequest => {
  const dispatchId = overrides.dispatchId ?? "dispatch-1";
  const targetWakeLifecycleIdentity =
    overrides.targetWakeLifecycleIdentity ??
    projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId,
      sourceSignalId: "signal-1",
      spaceId: HEX_SPACE_ID,
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
  return {
    v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    dispatchId,
    idempotencyKey: overrides.idempotencyKey ?? "wake-stop:dispatch-1",
    ownerUserId: overrides.ownerUserId ?? "owner-1",
    ...(overrides.reason ? { reason: overrides.reason } : {}),
    targetProfileMentionLabel:
      overrides.targetProfileMentionLabel ?? "Codex Agent",
    targetProfileName: overrides.targetProfileName ?? "Codex Agent",
    targetWakeLifecycleIdentity,
  };
};

const buildRuntimeCoordinatorHeadWaitingRequest = (
  overrides: Partial<
    Extract<
      RuntimeTransportRuntimeCoordinatorHeadWaitingRequest,
      { reasonCode: "daemon.profile.offline" }
    >
  > = {}
): RuntimeTransportRuntimeCoordinatorHeadWaitingRequest => {
  const dispatchId = overrides.dispatchId ?? "dispatch-1";
  const targetWakeLifecycleIdentity =
    overrides.targetWakeLifecycleIdentity ??
    projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId,
      sourceSignalId: "signal-1",
      spaceId: HEX_SPACE_ID,
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
  return {
    v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    dispatchId,
    idempotencyKey: overrides.idempotencyKey ?? "idempotency-1",
    observedAtMs: overrides.observedAtMs ?? 1_700_000_005_000,
    ownerUserId: overrides.ownerUserId ?? "owner-1",
    reasonCode: "daemon.profile.offline",
    targetWakeLifecycleIdentity,
    userRecoveryAction: "start_or_restart_openmeld_service",
    waitingCategory: "service_not_connected",
  };
};

const buildRuntimeCoordinatorWakeStopRequest = (
  overrides: Partial<RuntimeTransportRuntimeCoordinatorWakeStopRequest> = {}
): RuntimeTransportRuntimeCoordinatorWakeStopRequest => ({
  v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
  dispatchId: "dispatch-1",
  ownerUserId: "owner-1",
  runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
  sourceClientMessageId: "client-message-1",
  spaceId: HEX_SPACE_ID,
  targetProfileId: TARGET_AGENT_PROFILE_ID,
  ...overrides,
});

const configureCompatibleRoute = (input: {
  socket: WebSocket;
  state: RuntimeTransportMutableState;
}) => {
  input.state.pendingDispatches.clear();
  registerCompatibleRoute({
    socket: input.socket,
    state: input.state,
  });
};

const configureRevisionAwareRoute = (input: {
  configurationRevision: number;
  socket: WebSocket;
  state: RuntimeTransportMutableState;
}) => {
  configureCompatibleRoute(input);
  const session = input.state.sessionsById.get("daemon-session-1");
  if (!session) {
    throw new Error("Expected compatible Runtime Transport session.");
  }
  session.capabilities.profileConfigurationRevision = true;
  session.localWakeRouteReport = {
    daemonSessionId: session.daemonSessionId,
    deviceId: session.deviceId,
    includedProfileIds: [TARGET_AGENT_PROFILE_ID],
    lane: session.lane,
    profileConfigurationRevisions: [
      {
        bindingId: "binding-1",
        configurationRevision: input.configurationRevision,
        profileId: TARGET_AGENT_PROFILE_ID,
      },
    ],
    reportedAtMs: Date.now(),
    skippedProfiles: [],
  };
};

const registerCompatibleRoute = (input: {
  connectionGeneration?: number;
  daemonSessionId?: string;
  leaseEpoch?: number;
  runtimeAdapters?: DaemonRuntimeAdapterCapabilitySnapshot[];
  socket: WebSocket;
  state: RuntimeTransportMutableState;
}) => {
  const daemonSessionId = input.daemonSessionId ?? "daemon-session-1";
  const connectionGeneration = input.connectionGeneration ?? 1;
  const leaseEpoch = input.leaseEpoch ?? 2;
  const runtimeAdapters = input.runtimeAdapters ?? [
    codexRuntimeAdapterCapability,
  ];
  input.state.ownerUserId = "owner-1";
  input.state.sessionsById.set(daemonSessionId, {
    capabilities: {
      runtimeAdapters,
    },
    connectedAtMs: 1_700_000_000_000,
    connectionGeneration,
    daemonSessionId,
    deviceId: "device-1",
    executionCompatibility: {
      expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      reasonCode: "daemon.runtime_contract.compatible",
      status: "compatible",
    },
    lane: "dev-local",
    lastHeartbeatMs: 1_700_000_000_000,
    deliveryDisconnectedAtMs: null,
    ownerUserId: "owner-1",
    profileIds: new Set([TARGET_AGENT_PROFILE_ID]),
    localWakeRouteReport: null,
    rejectedProfileRegistrationsByProfileId: new Map(),
    socket: input.socket,
  });
  input.state.profileLeasesByProfileId.set(TARGET_AGENT_PROFILE_ID, {
    capabilities: {
      runtimeAdapters,
    },
    daemonSessionId,
    deviceId: "device-1",
    executionCompatibility: {
      expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      reasonCode: "daemon.runtime_contract.compatible",
      status: "compatible",
    },
    lane: "dev-local",
    lastHeartbeatMs: 1_700_000_000_000,
    leaseEpoch,
    profileId: TARGET_AGENT_PROFILE_ID,
  });
};

const buildRuntimeCoordinatorDecisionInput = (
  overrides: Partial<RuntimeTransportRuntimeCoordinatorDecisionRequest> = {}
): RuntimeTransportRuntimeCoordinatorDecisionRequest => ({
  v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
  attemptId: "attempt-1",
  claimDecision: "claim_recovery",
  dispatchId: "dispatch-1",
  eventKind: "retry",
  idempotencyKey: "queue:dispatch-1:retry:default",
  reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
  runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
  sourceClientMessageId: "client-message-1",
  spaceId: HEX_SPACE_ID,
  targetProfileId: TARGET_AGENT_PROFILE_ID,
  trigger: "queue",
  ...overrides,
});

const decideRuntimeCoordinatorProgress = (
  hub: RuntimeTransportHub,
  input: RuntimeTransportRuntimeCoordinatorDecisionRequest
): Promise<{
  ok: boolean;
  action?: string;
  reasonCode: string;
  status: string;
}> =>
  (
    hub as unknown as {
      decideRuntimeCoordinatorExecutionProgress: (
        decisionInput: RuntimeTransportRuntimeCoordinatorDecisionRequest
      ) => Promise<{
        ok: boolean;
        action?: string;
        reasonCode: string;
        status: string;
      }>;
    }
  ).decideRuntimeCoordinatorExecutionProgress(input);

const classifyPublicationClosureDiagnostics = (
  hub: RuntimeTransportHub,
  input: {
    dispatchId: string;
    evidenceSource?: string;
    executionTokenRunId?: string;
    failurePublicationCommandId?: string;
    finalizationCommandId?: string;
    publicationKind: "failure_notice" | "stopped_notice" | "success_reply";
    runtimeCoordinatorExecutionId?: string;
    spaceId: string;
    targetProfileId: string;
    targetWakeLifecycleId?: string;
  }
): Promise<{
  publicationKind: string;
  reasonCode: string;
  status: string;
}> =>
  (
    hub as unknown as {
      classifyRuntimeCoordinatorPublicationClosureDiagnostics: (
        classifierInput: typeof input
      ) => Promise<{
        publicationKind: string;
        reasonCode: string;
        status: string;
      }>;
    }
  ).classifyRuntimeCoordinatorPublicationClosureDiagnostics(input);

const issueDeliveryToken = async (input: {
  hub: RuntimeTransportHub;
  profileConfigurationRevision?: number;
  replyToSnapshot?: {
    signalId: string;
    profileId: string;
    profileKind: "agent" | "human" | "system" | null;
    profileName: string;
    previewText: string;
  };
  sentFrames: unknown[];
  socket: WebSocket;
  state: RuntimeTransportMutableState;
  threadContext?: {
    rootSignalId: string;
    threadId: string;
  };
}): Promise<RuntimeCoordinatorExecutionTokenEnvelope> => {
  if (input.profileConfigurationRevision === undefined) {
    configureCompatibleRoute({
      socket: input.socket,
      state: input.state,
    });
  } else {
    configureRevisionAwareRoute({
      configurationRevision: input.profileConfigurationRevision,
      socket: input.socket,
      state: input.state,
    });
  }
  await acceptDefaultRuntimeCoordinatorHead(input.hub);

  await (
    input.hub as unknown as {
      handleDeliverDispatchRequest: (request: Request) => Promise<Response>;
    }
  ).handleDeliverDispatchRequest(
    new Request("https://runtime-transport.test/deliver-dispatch", {
      body: JSON.stringify(
        buildDeliverRequest({
          ...(input.replyToSnapshot
            ? { replyToSnapshot: input.replyToSnapshot }
            : {}),
          ...(input.threadContext
            ? { threadContext: input.threadContext }
            : {}),
        })
      ),
      method: "POST",
    })
  );

  const deliverFrame = input.sentFrames.find(
    (frame) =>
      typeof frame === "object" &&
      frame !== null &&
      (frame as { code?: unknown }).code === "daemon.dispatch.deliver"
  ) as
    | {
        payload?: {
          payload?: {
            executionToken?: RuntimeCoordinatorExecutionTokenEnvelope;
          };
        };
      }
    | undefined;
  const executionToken = deliverFrame?.payload?.payload?.executionToken;
  if (!executionToken) {
    throw new Error("Expected delivery token envelope.");
  }
  return executionToken;
};

const fetchRuntimeTransportJson = (
  hub: RuntimeTransportHub,
  path: string,
  body: unknown
): Promise<Response> =>
  (
    hub as unknown as {
      fetch: (request: Request) => Promise<Response>;
    }
  ).fetch(
    new Request(`https://runtime-transport.internal${path}`, {
      body: JSON.stringify(body),
      method: "POST",
    })
  );

const acceptDefaultRuntimeCoordinatorHead = (
  hub: RuntimeTransportHub
): Promise<Response> =>
  fetchRuntimeTransportJson(
    hub,
    "/runtime-coordinator/head/accept",
    buildRuntimeCoordinatorHeadAcceptRequest()
  );

const prepareRunningContinuationWithQueuedWork = async (input: {
  hub: RuntimeTransportHub;
  profileConfigurationRevision?: number;
  queuedWorkName: string;
  sentFrames: unknown[];
  socket: WebSocket;
  state: RuntimeTransportMutableState;
  storageRecords: Map<string, unknown>;
}): Promise<{
  admissionKey: string;
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
  queuedIdentity: RuntimeTransportRuntimeCoordinatorHeadAcceptRequest["targetWakeLifecycleIdentity"];
}> => {
  await issueDeliveryToken({
    hub: input.hub,
    profileConfigurationRevision: input.profileConfigurationRevision,
    sentFrames: input.sentFrames,
    socket: input.socket,
    state: input.state,
  });
  const dispatchId = `dispatch-${input.queuedWorkName}`;
  const queuedIdentity = projectTargetWakeLifecycleIdentity({
    clientMessageId: `client-message-${input.queuedWorkName}`,
    dispatchId,
    sourceSignalId: `signal-${input.queuedWorkName}`,
    spaceId: "b".repeat(64),
    targetProfileId: TARGET_AGENT_PROFILE_ID,
  });
  await fetchRuntimeTransportJson(
    input.hub,
    "/runtime-coordinator/head/accept",
    buildRuntimeCoordinatorHeadAcceptRequest({
      dispatchId,
      idempotencyKey: `idempotency-${input.queuedWorkName}`,
      targetWakeLifecycleIdentity: queuedIdentity,
    })
  );
  const admissionKey =
    runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
      TARGET_AGENT_PROFILE_ID
    );
  const admission = input.storageRecords.get(admissionKey) as {
    recoveryGate: unknown;
    revision: number;
    updatedAtMs: number;
    workItems: Array<{
      dispatchId: string;
      enqueuedAtMs: number;
      targetWakeLifecycleId: string;
    }>;
  };
  const continuationWork = admission.workItems[0];
  if (!continuationWork) {
    throw new Error("Expected running continuation work.");
  }
  input.storageRecords.set(admissionKey, {
    ...admission,
    recoveryGate: {
      continuationClientMessageId: null,
      interruptedWork: continuationWork,
      status: "continuation_running",
      updatedAtMs: Date.now(),
    },
    revision: admission.revision + 1,
    updatedAtMs: Date.now(),
  });
  const authority = findRuntimeCoordinatorExecutionTokenAuthorityRecord(
    input.storageRecords
  );
  if (!authority) {
    throw new Error("Expected continuation execution authority.");
  }
  return { admissionKey, authority, queuedIdentity };
};

const prepareAwaitingOwnerApprovalWorkQueue = async (input: {
  hub: RuntimeTransportHub;
  queuedWorkNames: readonly [string, ...string[]];
  sentFrames: unknown[];
  socket: WebSocket;
  state: RuntimeTransportMutableState;
  storageRecords: Map<string, unknown>;
}): Promise<{
  admissionKey: string;
  interruptedTargetWakeLifecycleId: string;
  queuedIdentities: RuntimeTransportRuntimeCoordinatorHeadAcceptRequest["targetWakeLifecycleIdentity"][];
}> => {
  const [firstQueuedWorkName, ...laterQueuedWorkNames] = input.queuedWorkNames;
  const { admissionKey, authority, queuedIdentity } =
    await prepareRunningContinuationWithQueuedWork({
      hub: input.hub,
      queuedWorkName: firstQueuedWorkName,
      sentFrames: input.sentFrames,
      socket: input.socket,
      state: input.state,
      storageRecords: input.storageRecords,
    });
  await (
    input.hub as unknown as {
      writeRuntimeCoordinatorTokenAuthority: (
        nextAuthority: RuntimeCoordinatorExecutionTokenAuthorityRecord
      ) => Promise<void>;
    }
  ).writeRuntimeCoordinatorTokenAuthority({
    ...authority,
    terminalOutcome: {
      finalizedAtMs: Date.now(),
      reasonCode: "completed",
      replySignalId: `signal-${firstQueuedWorkName}-continuation-final`,
      status: "reply_published",
    },
  });

  const queuedIdentities = [queuedIdentity];
  for (const [index, queuedWorkName] of laterQueuedWorkNames.entries()) {
    const dispatchId = `dispatch-${queuedWorkName}`;
    const identity = projectTargetWakeLifecycleIdentity({
      clientMessageId: `client-message-${queuedWorkName}`,
      dispatchId,
      sourceSignalId: `signal-${queuedWorkName}`,
      spaceId: String.fromCharCode("c".charCodeAt(0) + index).repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    await fetchRuntimeTransportJson(
      input.hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest({
        dispatchId,
        idempotencyKey: `idempotency-${queuedWorkName}`,
        targetWakeLifecycleIdentity: identity,
      })
    );
    queuedIdentities.push(identity);
  }

  const admission = input.storageRecords.get(admissionKey) as {
    recoveryGate?: {
      interruptedWork?: { targetWakeLifecycleId?: string };
      status?: string;
    };
  };
  const interruptedTargetWakeLifecycleId =
    admission.recoveryGate?.interruptedWork?.targetWakeLifecycleId;
  if (
    admission.recoveryGate?.status !== "awaiting_owner_approval" ||
    !interruptedTargetWakeLifecycleId
  ) {
    throw new Error("Expected an owner-approval recovery gate.");
  }
  return {
    admissionKey,
    interruptedTargetWakeLifecycleId,
    queuedIdentities,
  };
};

const requestRuntimeCoordinatorWakeStop = (
  hub: RuntimeTransportHub,
  input: RuntimeTransportRuntimeCoordinatorWakeStopRequest = buildRuntimeCoordinatorWakeStopRequest()
): Promise<Response> =>
  fetchRuntimeTransportJson(hub, "/runtime-coordinator/wake-stop", input);

const enableWakeStopControl = (
  state: RuntimeTransportMutableState,
  controlMode: "cancel" | "interrupt" = "cancel"
) => {
  const session = state.sessionsById.get("daemon-session-1");
  if (!session) {
    throw new Error("Expected live daemon session.");
  }
  session.capabilities = {
    ...session.capabilities,
    localAgentControl: { [controlMode]: true },
  };
};

const enableLocalAgentInteraction = (state: RuntimeTransportMutableState) => {
  const session = state.sessionsById.get("daemon-session-1");
  const lease = state.profileLeasesByProfileId.get(TARGET_AGENT_PROFILE_ID);
  if (!(session && lease)) {
    throw new Error("Expected live daemon route.");
  }
  session.capabilities = {
    ...session.capabilities,
    localAgentInteraction: true,
  };
  lease.capabilities = {
    ...lease.capabilities,
    localAgentInteraction: true,
  };
};

const submitWakeStopLocalControlResult = async (input: {
  accepted?: boolean;
  hub: RuntimeTransportHub;
  includeResolvedIdentity?: boolean;
  note?: string | null;
  reasonCode?: string | null;
  resolvedDispatchId?: string;
  resolvedRuntimeCoordinatorExecutionId?: string;
  resolvedTaskId?: string;
  socket: WebSocket;
  state: RuntimeTransportMutableState;
  waitUntilTasks: Promise<unknown>[];
}): Promise<void> => {
  input.state.sessionIdBySocket.set(input.socket, "daemon-session-1");
  (
    input.hub as unknown as {
      handleLocalAgentControlResultFrame: (
        webSocket: WebSocket,
        payload: unknown
      ) => void;
    }
  ).handleLocalAgentControlResultFrame(input.socket, {
    requestId: `wake-stop:${RUNTIME_COORDINATOR_EXECUTION_ID}`,
    payload: {
      accepted: input.accepted ?? true,
      ...(input.note === null
        ? {}
        : { note: input.note ?? "adapter.cancel.accepted" }),
      ...(input.reasonCode === null
        ? {}
        : { reasonCode: input.reasonCode ?? "adapter.cancel.accepted" }),
      ...(input.includeResolvedIdentity === false
        ? {}
        : {
            resolvedDispatchId: input.resolvedDispatchId ?? "dispatch-1",
            resolvedRuntimeCoordinatorExecutionId:
              input.resolvedRuntimeCoordinatorExecutionId ??
              RUNTIME_COORDINATOR_EXECUTION_ID,
            resolvedTaskId: input.resolvedTaskId ?? "task-1",
          }),
      target: {
        by: "task",
        taskId: "task-1",
      },
    },
  });
  await Promise.all(input.waitUntilTasks.splice(0));
};

const buildExecutionTokenEcho = (
  envelope: RuntimeCoordinatorExecutionTokenEnvelope
) => ({
  executionToken: envelope.executionToken,
  runId: envelope.runId,
  runtimeCoordinatorExecutionId:
    envelope.executionScope.runtimeCoordinatorExecutionId,
  tokenFingerprint: envelope.tokenFingerprint,
});

const seedAcceptedResultInbox = (
  inboxRows: Map<string, Record<string, unknown>>,
  executionToken: RuntimeCoordinatorExecutionTokenEnvelope
) => {
  inboxRows.set("dispatch-1::attempt-1", {
    accepted_at_ms: 1_700_000_000_100,
    attempt_id: "attempt-1",
    daemon_session_id: "daemon-session-1",
    dispatch_id: "dispatch-1",
    execution_token_fingerprint: executionToken.tokenFingerprint,
    execution_token_run_id: executionToken.runId,
    lease_epoch: 2,
    publication_error_code: null,
    publish_state: "result_accepted",
    published_signal_id: null,
    result_key: "dispatch-1::attempt-1",
    result_payload_json: JSON.stringify(buildResultRequest().taskResult),
    runtime_coordinator_execution_id: RUNTIME_COORDINATOR_EXECUTION_ID,
    submitted_connection_generation: 1,
    target_profile_id: TARGET_AGENT_PROFILE_ID,
    task_id: "task-1",
    updated_at_ms: 1_700_000_000_100,
  });
};

const buildAttemptAcceptanceRow = (
  overrides: Partial<RecordingDispatchAttemptAcceptanceRow> = {}
): RecordingDispatchAttemptAcceptanceRow => ({
  attemptId: "attempt-1",
  attemptStatus: "waiting_result",
  daemonSessionId: "daemon-session-1",
  dispatchId: "dispatch-1",
  leaseEpoch: 2,
  spaceId: HEX_SPACE_ID,
  targetProfileId: TARGET_AGENT_PROFILE_ID,
  taskId: "task-1",
  ...overrides,
});

const buildCompletedDispatchResult = (
  overrides: Partial<CompletedDispatchResultState> = {}
): CompletedDispatchResultState => ({
  attemptId: "attempt-1",
  connectionGeneration: 1,
  daemonSessionId: "daemon-session-1",
  dispatchId: "dispatch-1",
  executionIdentity: deliveryExecutionIdentity,
  executionTokenFingerprint: `etfp_v1_${"b".repeat(32)}`,
  executionTokenRunId: "run-1",
  leaseEpoch: 2,
  receivedAtMs: 1_700_000_000_100,
  runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
  sourceClientMessageId: "client-message-1",
  submittedConnectionGeneration: 1,
  targetProfileId: TARGET_AGENT_PROFILE_ID,
  taskId: "task-1",
  taskResult: buildResultRequest().taskResult,
  ...overrides,
});

const buildRuntimeCoordinatorProjectionRow = (
  overrides: Partial<RecordingRuntimeCoordinatorExecutionRow> = {}
): RecordingRuntimeCoordinatorExecutionRow => ({
  attempt_id: "attempt-1",
  binding_id: "binding-1",
  agent_controller_ref: "builtin:codex",
  claim_lease_id: null,
  connection_generation: 1,
  created_at_ms: 1_700_000_000_000,
  daemon_session_id: "daemon-session-1",
  dispatch_id: "dispatch-1",
  lease_epoch: 2,
  model_version: RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION,
  runtime_coordinator_execution_id: RUNTIME_COORDINATOR_EXECUTION_ID,
  openmeld_service_runtime_id: "runtime-1",
  openmeld_service_runtime_id_source: "runtime_registry_authority",
  source_client_message_id: "client-message-1",
  space_id: HEX_SPACE_ID,
  status: "running",
  target_profile_id: TARGET_AGENT_PROFILE_ID,
  terminal_outcome_json: null,
  updated_at_ms: 1_700_000_000_100,
  ...overrides,
});

const buildAgentControllerInterfaceSnapshot = (
  overrides: Partial<AgentControllerInterfaceSnapshot> = {}
): AgentControllerInterfaceSnapshot => ({
  agentControllerRef: "builtin:codex",
  auth: { status: "authenticated" },
  capabilities: {
    approvals: false,
    cancel: true,
    interrupt: false,
    modelSelection: false,
    nativeEventStream: false,
    permissionModes: false,
    structuredUserInput: false,
  },
  checkedAt: "2026-06-29T00:00:00.000Z",
  controllerId: "codex",
  displayName: "Codex Agent",
  launch: {
    argsPrefix: [],
    commandPath: "/usr/local/bin/codex",
    installChoiceCount: 1,
    status: "ready",
  },
  message: null,
  models: [],
  nativeInterface: "local-cli",
  schemaVersion: 1,
  skills: [],
  status: "ready",
  version: "0.0.0-test",
  ...overrides,
});

const buildRuntimeAgentControllerReportRow = (input?: {
  agentControllerInterface?: AgentControllerInterfaceSnapshot | null;
  expiresAtMs?: number;
  reportStatus?: string;
}): RecordingRuntimeAgentControllerReportRow => ({
  agent_controller_interface_json:
    input?.agentControllerInterface === null
      ? null
      : JSON.stringify(
          input?.agentControllerInterface ??
            buildAgentControllerInterfaceSnapshot()
        ),
  agent_controller_ref: "builtin:codex",
  accepted_at_ms: 1_700_000_000_000,
  openmeld_service_runtime_id: "runtime-1",
  expires_at_ms: input?.expiresAtMs ?? 4_102_444_800_000,
  observed_at_ms: 1_700_000_000_000,
  report_status: input?.reportStatus ?? "ready",
  reported_reason_codes_json: "[]",
  updated_at_ms: 1_700_000_000_000,
});

const getRuntimeCoordinatorEventCalls = (calls: RecordingD1Call[]) =>
  calls.filter((call) =>
    call.query.includes("openMeldDaemon_runtime_coordinator_execution_events")
  );

const getReadinessImpactWriteCalls = (calls: RecordingD1Call[]) =>
  calls.filter((call) =>
    call.query.includes(
      "INSERT INTO openMeldDaemon_agent_execution_readiness_impacts"
    )
  );

const findRuntimeCoordinatorRunCommandState = (
  storageRecords: Map<string, unknown>
) =>
  [...storageRecords.values()].find(
    (value): value is RuntimeCoordinatorRunCommandState =>
      value !== null &&
      typeof value === "object" &&
      (value as { modelVersion?: unknown }).modelVersion ===
        "openmeld.runtime_coordinator.run_command_state.v1"
  );

const isRuntimeCoordinatorExecutionTokenAuthorityRecord = (
  value: unknown
): value is RuntimeCoordinatorExecutionTokenAuthorityRecord =>
  value !== null && typeof value === "object" && "runsById" in value;

const findRuntimeCoordinatorExecutionTokenAuthorityRecord = (
  storageRecords: Map<string, unknown>
) =>
  [...storageRecords.values()].find(
    isRuntimeCoordinatorExecutionTokenAuthorityRecord
  );

const findRuntimeCoordinatorExecutionTokenAuthorityEntry = (
  storageRecords: Map<string, unknown>
): [string, RuntimeCoordinatorExecutionTokenAuthorityRecord] | undefined => {
  for (const [key, value] of storageRecords.entries()) {
    if (isRuntimeCoordinatorExecutionTokenAuthorityRecord(value)) {
      return [key, value];
    }
  }
  return undefined;
};

const findRuntimeCoordinatorHeadLifecycleRecord = (
  storageRecords: Map<string, unknown>
) =>
  [...storageRecords.values()].find(
    (
      value
    ): value is {
      duplicateDispatches: Array<{
        dispatchId: string;
        idempotencyKey: string;
        reasonCode: string;
      }>;
      modelVersion: string;
      ownerUserId: string;
      noExecutionDecision?: {
        reasonCode: string;
      };
      primaryDispatchId: string;
      publicationIntent?: {
        intentId: string;
        reasonCode: string;
        status: string;
      };
      runtimeCoordinatorExecutionId: string | null;
      status: string;
      targetWakeLifecycleId: string;
    } =>
      value !== null &&
      typeof value === "object" &&
      (value as { modelVersion?: unknown }).modelVersion ===
        "openmeld.runtime_coordinator.head_lifecycle.v1"
  );

const findRuntimeCoordinatorPublicationBlockerRecord = (
  storageRecords: Map<string, unknown>
) =>
  [...storageRecords.values()].find(
    (
      value
    ): value is {
      blockerKind: string;
      dispatchId: string;
      modelVersion: string;
      publicationKind: string;
      reasonCode: string;
      runtimeCoordinatorExecutionId?: string | null;
      status: string;
      targetWakeLifecycleId?: string | null;
    } =>
      value !== null &&
      typeof value === "object" &&
      (value as { modelVersion?: unknown }).modelVersion ===
        "openmeld.runtime_coordinator.publication_blocker.v1"
  );

const findRuntimeCoordinatorWakeStoppedNoticePublicationRecord = (
  storageRecords: Map<string, unknown>
) =>
  [...storageRecords.values()].find(
    (
      value
    ): value is {
      dispatchId: string;
      modelVersion: string;
      publicationId: string;
      publishedSignalId: string | null;
      reasonCode: string;
      runtimeCoordinatorExecutionId: string | null;
      status: string;
      targetProfileId: string;
      targetWakeLifecycleId: string | null;
    } =>
      value !== null &&
      typeof value === "object" &&
      (value as { modelVersion?: unknown }).modelVersion ===
        "openmeld.runtime_coordinator.wake_stopped_notice_publication.v1"
  );

describe("runtime transport runtime coordinator transport contract", () => {
  it("atomically persists an Agent Task observation delivery with its redrive index", async () => {
    const records = new Map<string, unknown>();
    const outerGet = vi.fn(() =>
      Promise.reject(new Error("read must stay inside the transaction"))
    );
    const outerPut = vi.fn(() =>
      Promise.reject(new Error("write must stay inside the transaction"))
    );
    const transaction = vi.fn(
      async <T>(
        operation: (transaction: DurableObjectTransaction) => Promise<T>
      ) =>
        await operation({
          get: async (key: string) => records.get(key),
          put: (key: string, value: unknown) => {
            records.set(key, value);
            return Promise.resolve();
          },
        } as unknown as DurableObjectTransaction)
    );

    await expect(
      upsertRuntimeCoordinatorAgentTaskObservationDelivery(
        {
          get: outerGet,
          put: outerPut,
          transaction,
        } as unknown as DurableObjectStorage,
        {
          nowMs: 1000,
          observation: {
            attentionCode: "permission_request",
            eventId: "interaction-event-1",
            occurredAtMs: 990,
            status: "needs_attention",
          },
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
          task: {
            kind: "space_wake",
            sourceClientMessageId: "client-message-1",
            spaceId: HEX_SPACE_ID,
            targetProfileId: TARGET_AGENT_PROFILE_ID,
            v: 1,
          },
        }
      )
    ).resolves.toMatchObject({
      status: "pending",
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(outerGet).not.toHaveBeenCalled();
    expect(outerPut).not.toHaveBeenCalled();
    expect(
      records.get("runtime-coordinator:agent-task-observation-delivery:index")
    ).toEqual([
      `agent-task-observation:${RUNTIME_COORDINATOR_EXECUTION_ID}:interaction-event-1`,
    ]);
  });

  it("verifies exact owner, controller conversation, task, and destination before offering controller resume", async () => {
    const { hub, sentFrames, socket, state } = createHarness();
    configureCompatibleRoute({ socket, state });
    const session = state.sessionsById.get("daemon-session-1");
    if (!session) {
      throw new Error("Expected compatible daemon session.");
    }
    session.capabilities = {
      ...session.capabilities,
      localAgentControl: {
        resumeControllerConversation: true,
      },
    };
    await acceptDefaultRuntimeCoordinatorHead(hub);
    const delivery = buildDeliverRequest();
    const deliveryResponse = await (
      hub as unknown as {
        handleDeliverDispatchRequest: (request: Request) => Promise<Response>;
      }
    ).handleDeliverDispatchRequest(
      new Request("https://runtime-transport.test/deliver-dispatch", {
        body: JSON.stringify({
          ...delivery,
          payload: {
            ...delivery.payload,
            agentControllerConversationId: "conversation-1",
          },
        }),
        method: "POST",
      })
    );
    expect(deliveryResponse.status).toBe(200);
    const deliveryFrameCount = sentFrames.length;
    const recoveryHub = hub as unknown as {
      rpcInspectExecutionRecovery: (input: unknown) => Promise<{
        exactAssociationVerified: boolean;
        identity: { taskId: string | null } | null;
        serviceSupportsResume: boolean;
        status: string;
      }>;
    };
    const request = {
      destination: {
        spaceId: HEX_SPACE_ID,
        surface: "space" as const,
        threadId: null,
      },
      identity: {
        agentControllerConversationId: "conversation-1",
        agentControllerRef: deliveryExecutionIdentity.core.agentControllerRef,
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        resultRef: null,
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        spaceId: HEX_SPACE_ID,
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        taskId: null,
      },
      ownerUserId: "owner-1",
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    };

    await expect(
      recoveryHub.rpcInspectExecutionRecovery(request)
    ).resolves.toMatchObject({
      exactAssociationVerified: true,
      identity: {
        taskId: "task-1",
      },
      serviceSupportsResume: true,
      status: "available",
    });
    for (const mismatch of [
      { ...request, ownerUserId: "different-owner" },
      {
        ...request,
        identity: {
          ...request.identity,
          agentControllerRef: "builtin:claude-code",
        },
      },
      {
        ...request,
        identity: {
          ...request.identity,
          agentControllerConversationId: "different-conversation",
        },
      },
      {
        ...request,
        destination: {
          ...request.destination,
          threadId: "different-thread",
        },
      },
    ]) {
      await expect(
        recoveryHub.rpcInspectExecutionRecovery(mismatch)
      ).resolves.toMatchObject({
        exactAssociationVerified: false,
        serviceSupportsResume: false,
        status: "unavailable",
      });
    }
    expect(sentFrames).toHaveLength(deliveryFrameCount);
  });

  it("round-trips Computer file access only through a capable exact session", async () => {
    const { hub, sentFrames, socket, state } = createHarness();
    configureCompatibleRoute({ socket, state });
    const session = state.sessionsById.get("daemon-session-1");
    if (!session) {
      throw new Error("Expected live daemon session.");
    }
    session.capabilities = {
      ...session.capabilities,
      computerFileAccess: { readPolicy: true, updatePolicy: true },
    };
    state.sessionIdBySocket.set(socket, "daemon-session-1");
    Object.defineProperty(hub, "currentDeviceOperationWaiters", {
      value: new Map(),
    });

    const responsePromise = fetchRuntimeTransportJson(
      hub,
      "/computer-file-access/read-policy",
      {
        deviceId: "device-1",
        lane: "dev-local",
        ownerUserId: "owner-1",
        request: { expectedDeviceId: "device-1" },
        requestId: "file-access-read-1",
        v: 1,
      }
    );
    await vi.waitFor(() => {
      expect(sentFrames).toContainEqual(
        expect.objectContaining({
          code: "daemon.computer_file_access.read_policy",
          payload: {
            request: { expectedDeviceId: "device-1" },
            requestId: "file-access-read-1",
          },
        })
      );
    });
    RuntimeTransportHub.prototype.webSocketMessage.call(
      hub,
      socket,
      JSON.stringify({
        code: "daemon.computer_file_access.read_policy_result",
        payload: {
          requestId: "file-access-read-1",
          result: {
            deviceId: "device-1",
            policy: {
              mode: "local_agent_settings",
              revision: 1,
              updatedAtMs: 0,
            },
          },
        },
        v: 1,
      })
    );

    const response = await responsePromise;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deviceId: "device-1",
      policy: {
        mode: "local_agent_settings",
        revision: 1,
        updatedAtMs: 0,
      },
    });
  });

  it("does not send Computer file access to a Service without the capability", async () => {
    const { hub, sentFrames, socket, state } = createHarness();
    configureCompatibleRoute({ socket, state });

    const response = await fetchRuntimeTransportJson(
      hub,
      "/computer-file-access/read-policy",
      {
        deviceId: "device-1",
        lane: "dev-local",
        ownerUserId: "owner-1",
        request: { expectedDeviceId: "device-1" },
        requestId: "file-access-unsupported",
        v: 1,
      }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "computer.file_access.unsupported",
      status: "rejected",
    });
    expect(
      sentFrames.some(
        (frame) =>
          typeof frame === "object" &&
          frame !== null &&
          (frame as { code?: unknown }).code ===
            "daemon.computer_file_access.read_policy"
      )
    ).toBe(false);
  });

  it("round-trips Local Folder Picker only through a capable exact session", async () => {
    const { hub, sentFrames, socket, state } = createHarness();
    configureCompatibleRoute({ socket, state });
    const session = state.sessionsById.get("daemon-session-1");
    if (!session) {
      throw new Error("Expected live daemon session.");
    }
    session.capabilities = {
      ...session.capabilities,
      localFolderPicker: { selectFolders: true },
    };
    state.sessionIdBySocket.set(socket, "daemon-session-1");
    Object.defineProperty(hub, "currentDeviceOperationWaiters", {
      value: new Map(),
    });

    const responsePromise = fetchRuntimeTransportJson(
      hub,
      "/local-folder-picker/select-folders",
      {
        deviceId: "device-1",
        lane: "dev-local",
        ownerUserId: "owner-1",
        request: {
          allowMultiple: true,
          expectedDeviceId: "device-1",
          purpose: "computer_file_access",
        },
        requestId: "folder-picker-1",
        v: 1,
      }
    );
    await vi.waitFor(() => {
      expect(sentFrames).toContainEqual(
        expect.objectContaining({
          code: "daemon.local_folder_picker.select_folders",
          payload: {
            request: {
              allowMultiple: true,
              expectedDeviceId: "device-1",
              purpose: "computer_file_access",
            },
            requestId: "folder-picker-1",
          },
        })
      );
    });
    RuntimeTransportHub.prototype.webSocketMessage.call(
      hub,
      socket,
      JSON.stringify({
        code: "daemon.local_folder_picker.select_folders_result",
        payload: {
          requestId: "folder-picker-1",
          result: {
            deviceId: "device-1",
            paths: ["/Users/felix/Design Work"],
            status: "selected",
          },
        },
        v: 1,
      })
    );

    const response = await responsePromise;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deviceId: "device-1",
      paths: ["/Users/felix/Design Work"],
      status: "selected",
    });
  });

  it("does not open Local Folder Picker through an older Service", async () => {
    const { hub, sentFrames, socket, state } = createHarness();
    configureCompatibleRoute({ socket, state });

    const response = await fetchRuntimeTransportJson(
      hub,
      "/local-folder-picker/select-folders",
      {
        deviceId: "device-1",
        lane: "dev-local",
        ownerUserId: "owner-1",
        request: {
          allowMultiple: false,
          expectedDeviceId: "device-1",
          purpose: "agent_profile_working_folder",
        },
        requestId: "folder-picker-old-service",
        v: 1,
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "local.folder_picker.service_update_required",
      status: "unavailable",
    });
    expect(
      sentFrames.some(
        (frame) =>
          typeof frame === "object" &&
          frame !== null &&
          (frame as { code?: unknown }).code ===
            "daemon.local_folder_picker.select_folders"
      )
    ).toBe(false);
  });

  it("returns service_offline when no current-device Project session exists", async () => {
    const { hub } = createHarness();
    const response = await fetchRuntimeTransportJson(
      hub,
      "/local-project-control/discover-projects",
      {
        v: 1,
        ownerUserId: "owner-1",
        deviceId: "device-1",
        lane: "dev-local",
        requestId: "project-discovery-offline",
        request: {
          clientGeneration: 1,
          expectedOrganizationId: "org-1",
          projects: [],
        },
      }
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "rejected",
      code: "service_offline",
    });
  });

  it("returns 504 when a current-device Project operation times out", async () => {
    vi.useFakeTimers();
    try {
      const { hub, socket, state } = createHarness();
      configureCompatibleRoute({ socket, state });
      const session = state.sessionsById.get("daemon-session-1");
      if (!session) {
        throw new Error("Expected live daemon session.");
      }
      session.capabilities = {
        ...session.capabilities,
        localProjectControl: {
          connectCandidate: true,
          connectDeclaredPath: true,
          discoverProjects: true,
          moveConnection: true,
          removeConnection: true,
          removeMissingConnections: true,
          setDefaultConnection: true,
        },
      };
      Object.defineProperty(hub, "currentDeviceOperationWaiters", {
        value: new Map(),
      });

      const responsePromise = fetchRuntimeTransportJson(
        hub,
        "/local-project-control/discover-projects",
        {
          v: 1,
          ownerUserId: "owner-1",
          deviceId: "device-1",
          lane: "dev-local",
          requestId: "project-discovery-timeout",
          request: {
            clientGeneration: 1,
            expectedOrganizationId: "org-1",
            projects: [],
          },
        }
      );
      await vi.advanceTimersByTimeAsync(30_000);

      const response = await responsePromise;
      expect(response.status).toBe(504);
      await expect(response.json()).resolves.toMatchObject({
        status: "rejected",
        code: "timeout",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns invalid_response instead of a timeout for a malformed Project result", async () => {
    const { hub, sentFrames, socket, state } = createHarness();
    configureCompatibleRoute({ socket, state });
    const session = state.sessionsById.get("daemon-session-1");
    if (!session) {
      throw new Error("Expected live daemon session.");
    }
    session.capabilities = {
      ...session.capabilities,
      localProjectControl: {
        connectCandidate: true,
        connectDeclaredPath: true,
        discoverProjects: true,
        moveConnection: true,
        removeConnection: true,
        removeMissingConnections: true,
        setDefaultConnection: true,
      },
    };
    state.sessionIdBySocket.set(socket, "daemon-session-1");
    Object.defineProperty(hub, "currentDeviceOperationWaiters", {
      value: new Map(),
    });

    const responsePromise = fetchRuntimeTransportJson(
      hub,
      "/local-project-control/discover-projects",
      {
        v: 1,
        ownerUserId: "owner-1",
        deviceId: "device-1",
        lane: "dev-local",
        requestId: "project-discovery-invalid-result",
        request: {
          clientGeneration: 1,
          expectedOrganizationId: "org-1",
          projects: [],
        },
      }
    );
    await vi.waitFor(() => {
      expect(
        sentFrames.some(
          (frame) =>
            typeof frame === "object" &&
            frame !== null &&
            (frame as { payload?: { requestId?: unknown } }).payload
              ?.requestId === "project-discovery-invalid-result"
        )
      ).toBe(true);
    });
    RuntimeTransportHub.prototype.webSocketMessage.call(
      hub,
      socket,
      JSON.stringify({
        code: "daemon.local_project_control.discover_projects_result",
        payload: {
          requestId: "project-discovery-invalid-result",
          result: { unexpected: true },
        },
        v: 1,
      })
    );

    const response = await responsePromise;
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      status: "rejected",
      code: "invalid_response",
    });
  });

  it("returns invalid_response when a Project operation receives the wrong result code", async () => {
    const { hub, sentFrames, socket, state } = createHarness();
    configureCompatibleRoute({ socket, state });
    const session = state.sessionsById.get("daemon-session-1");
    if (!session) {
      throw new Error("Expected live daemon session.");
    }
    session.capabilities = {
      ...session.capabilities,
      localProjectControl: {
        connectCandidate: true,
        connectDeclaredPath: true,
        discoverProjects: true,
        moveConnection: true,
        removeConnection: true,
        removeMissingConnections: true,
        setDefaultConnection: true,
      },
    };
    state.sessionIdBySocket.set(socket, "daemon-session-1");
    Object.defineProperty(hub, "currentDeviceOperationWaiters", {
      value: new Map(),
    });

    const responsePromise = fetchRuntimeTransportJson(
      hub,
      "/local-project-control/discover-projects",
      {
        v: 1,
        ownerUserId: "owner-1",
        deviceId: "device-1",
        lane: "dev-local",
        requestId: "project-discovery-wrong-result-code",
        request: {
          clientGeneration: 1,
          expectedOrganizationId: "org-1",
          projects: [],
        },
      }
    );
    await vi.waitFor(() => {
      expect(
        sentFrames.some(
          (frame) =>
            typeof frame === "object" &&
            frame !== null &&
            (frame as { payload?: { requestId?: unknown } }).payload
              ?.requestId === "project-discovery-wrong-result-code"
        )
      ).toBe(true);
    });
    RuntimeTransportHub.prototype.webSocketMessage.call(
      hub,
      socket,
      JSON.stringify({
        code: "daemon.local_project_control.remove_missing_connections_result",
        payload: {
          requestId: "project-discovery-wrong-result-code",
          result: { connections: [], removedCount: 0 },
        },
        v: 1,
      })
    );

    const response = await responsePromise;
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      status: "rejected",
      code: "invalid_response",
    });
  });

  it("keeps route lookup fast paths off RuntimeCoordinator housekeeping sync", async () => {
    const requests = [
      {
        path: "/lookup-route",
        body: {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          ownerUserId: "owner-fast-path",
          profileId: "agt-fast-path",
        },
        expectedStatus: 404,
      },
      {
        path: "/lookup-routes-batch",
        body: {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          ownerUserId: "owner-fast-path",
          profileIds: ["agt-fast-path"],
        },
        expectedStatus: 200,
      },
      {
        path: "/lookup-owner-service",
        body: {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          ownerUserId: "owner-fast-path",
        },
        expectedStatus: 404,
      },
    ] as const;

    for (const request of requests) {
      const { hub } = createHarness();
      const syncHousekeepingAlarm = vi.fn(() =>
        Promise.reject(
          new Error("lookup fast paths must not sync housekeeping")
        )
      );
      Object.defineProperty(hub, "syncHousekeepingAlarm", {
        value: syncHousekeepingAlarm,
      });
      const ctx = (
        hub as unknown as {
          ctx: {
            storage: {
              deleteAlarm: () => Promise<void>;
              getAlarm: () => Promise<number | null>;
              setAlarm: (scheduledTime: number) => Promise<void>;
            };
            waitUntil: (promise: Promise<unknown>) => void;
          };
        }
      ).ctx;
      const deleteAlarm = vi.mocked(ctx.storage.deleteAlarm);
      const getAlarm = vi.mocked(ctx.storage.getAlarm);
      const setAlarm = vi.mocked(ctx.storage.setAlarm);
      const waitUntil = vi.mocked(ctx.waitUntil);

      const response = await fetchRuntimeTransportJson(
        hub,
        request.path,
        request.body
      );

      expect(response.status).toBe(request.expectedStatus);
      expect(syncHousekeepingAlarm).not.toHaveBeenCalled();
      expect(deleteAlarm).not.toHaveBeenCalled();
      expect(getAlarm).not.toHaveBeenCalled();
      expect(setAlarm).not.toHaveBeenCalled();
      expect(waitUntil).not.toHaveBeenCalled();
    }
  });

  it("reschedules housekeeping when an alarm phase fails", async () => {
    const nowMs = 1_700_000_000_000;
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);
    try {
      const { hub, storageSetAlarm } = createHarness();
      const finalizationPhase = vi.fn(() =>
        Promise.reject(new Error("forced phase failure"))
      );
      const watchdogPhase = vi.fn(() => Promise.resolve());
      Object.defineProperty(
        hub,
        "processRuntimeCoordinatorFinalizationRetryAlarm",
        {
          value: finalizationPhase,
        }
      );
      Object.defineProperty(hub, "processRuntimeCoordinatorWatchdogAlarm", {
        value: watchdogPhase,
      });

      await (hub as unknown as { alarm: () => Promise<void> }).alarm();

      expect(finalizationPhase).toHaveBeenCalled();
      expect(watchdogPhase).not.toHaveBeenCalled();
      expect(storageSetAlarm).toHaveBeenCalledWith(nowMs + 1000);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("bounds housekeeping alarm work and schedules continuation", async () => {
    const nowMs = 1_700_000_000_000;
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);
    try {
      const { hub, storageSetAlarm } = createHarness();
      const reserveWorkUnit = (
        hub as unknown as {
          reserveHousekeepingAlarmWorkUnit: (
            run: unknown,
            phase: "runtime_coordinator_finalization_retry"
          ) => boolean;
        }
      ).reserveHousekeepingAlarmWorkUnit.bind(hub);
      const finalizationPhase = vi.fn((_: number, run: unknown) => {
        for (let index = 0; index < 100; index += 1) {
          if (!reserveWorkUnit(run, "runtime_coordinator_finalization_retry")) {
            break;
          }
        }
        return Promise.resolve();
      });
      const watchdogPhase = vi.fn(() => Promise.resolve());
      Object.defineProperty(
        hub,
        "processRuntimeCoordinatorFinalizationRetryAlarm",
        {
          value: finalizationPhase,
        }
      );
      Object.defineProperty(hub, "processRuntimeCoordinatorWatchdogAlarm", {
        value: watchdogPhase,
      });

      await (hub as unknown as { alarm: () => Promise<void> }).alarm();

      expect(finalizationPhase).toHaveBeenCalled();
      expect(watchdogPhase).not.toHaveBeenCalled();
      expect(storageSetAlarm).toHaveBeenCalledWith(nowMs + 1000);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("runs execution authority phases before a stream-closure repair backlog", async () => {
    const nowMs = 1_700_000_000_000;
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);
    try {
      const { hub, storageSetAlarm } = createHarness();
      const order: string[] = [];
      const phaseNames = [
        "processRuntimeCoordinatorFinalizationRetryAlarm",
        "processRuntimeCoordinatorWatchdogAlarm",
        "processRuntimeCoordinatorHeadAcceptedHandoffAlarm",
        "processRuntimeCoordinatorHeadWaitingAlarm",
        "processRuntimeCoordinatorHeadFailurePublicationRetryAlarm",
        "processRuntimeCoordinatorPreExecutionHandoffAlarm",
      ] as const;
      for (const phaseName of phaseNames) {
        Object.defineProperty(hub, phaseName, {
          value: vi.fn(() => {
            order.push(phaseName);
            return Promise.resolve();
          }),
        });
      }
      const reserveWorkUnit = (
        hub as unknown as {
          reserveHousekeepingAlarmWorkUnit: (
            run: unknown,
            phase: "local_agent_stream_closure_retry"
          ) => boolean;
        }
      ).reserveHousekeepingAlarmWorkUnit.bind(hub);
      Object.defineProperty(hub, "processLocalAgentStreamClosureRetryAlarm", {
        value: vi.fn((_: number, run: unknown) => {
          order.push("processLocalAgentStreamClosureRetryAlarm");
          for (let index = 0; index < 100; index += 1) {
            if (!reserveWorkUnit(run, "local_agent_stream_closure_retry")) {
              break;
            }
          }
          return Promise.resolve();
        }),
      });

      await (hub as unknown as { alarm: () => Promise<void> }).alarm();

      expect(order).toEqual([
        ...phaseNames,
        "processLocalAgentStreamClosureRetryAlarm",
      ]);
      expect(storageSetAlarm).toHaveBeenCalledWith(nowMs + 1000);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("issues and stores an execution token before sending an accepted delivery to the daemon", async () => {
    const { hub, recordingD1, sentFrames, socket, state, storageRecords } =
      createHarness();
    state.pendingDispatches.clear();
    state.ownerUserId = "owner-1";
    state.sessionsById.set("daemon-session-1", {
      capabilities: {},
      connectedAtMs: 1_700_000_000_000,
      connectionGeneration: 1,
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      executionCompatibility: {
        expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        reasonCode: "daemon.runtime_contract.compatible",
        status: "compatible",
      },
      lane: "dev-local",
      lastHeartbeatMs: 1_700_000_000_000,
      deliveryDisconnectedAtMs: null,
      ownerUserId: "owner-1",
      profileIds: new Set([TARGET_AGENT_PROFILE_ID]),
      localWakeRouteReport: null,
      rejectedProfileRegistrationsByProfileId: new Map(),
      socket,
    });
    state.profileLeasesByProfileId.set(TARGET_AGENT_PROFILE_ID, {
      capabilities: {},
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      executionCompatibility: {
        expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        reasonCode: "daemon.runtime_contract.compatible",
        status: "compatible",
      },
      lane: "dev-local",
      lastHeartbeatMs: 1_700_000_000_000,
      leaseEpoch: 2,
      profileId: TARGET_AGENT_PROFILE_ID,
    });
    await acceptDefaultRuntimeCoordinatorHead(hub);

    const response = await (
      hub as unknown as {
        handleDeliverDispatchRequest: (request: Request) => Promise<Response>;
      }
    ).handleDeliverDispatchRequest(
      new Request("https://runtime-transport.test/deliver-dispatch", {
        body: JSON.stringify(buildDeliverRequest()),
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    const deliverFrame = sentFrames.find(
      (frame) =>
        typeof frame === "object" &&
        frame !== null &&
        (frame as { code?: unknown }).code === "daemon.dispatch.deliver"
    ) as { payload?: { payload?: { executionToken?: unknown } } } | undefined;
    const executionToken = deliverFrame?.payload?.payload?.executionToken as
      | { executionToken?: string; runId?: string; tokenFingerprint?: string }
      | undefined;
    expect(executionToken?.executionToken).toMatch(EXECUTION_TOKEN_PATTERN);
    expect(executionToken?.runId).toMatch(RUN_ID_PATTERN);
    expect(executionToken?.tokenFingerprint).toMatch(TOKEN_FINGERPRINT_PATTERN);

    const authority =
      findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords);
    const currentRun =
      authority?.runsById?.[String(authority.currentRunId)] ?? null;
    expect(currentRun?.tokenSecretRefOrSealedToken).toBe(
      executionToken?.executionToken
    );
    expect(currentRun?.tokenValidationHash).toMatch(
      TOKEN_VALIDATION_HASH_PATTERN
    );

    const eventPayloads = getRuntimeCoordinatorEventCalls(recordingD1.calls)
      .map((call) => String(call.params[7] ?? ""))
      .join("\n");
    expect(eventPayloads).toContain(String(executionToken?.tokenFingerprint));
    expect(eventPayloads).not.toContain(String(executionToken?.executionToken));
    expect(eventPayloads).not.toContain(
      String(currentRun?.tokenValidationHash)
    );
  });

  it("accepts one target Wake head and keeps later dispatches diagnostic-only", async () => {
    const { hub, storageRecords } = createHarness();
    const firstResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest()
    );
    expect(firstResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toMatchObject({
      action: "create_execution",
      ok: true,
      primaryDispatchId: "dispatch-1",
      runtimeCoordinatorExecutionId: null,
      status: "accepted",
    });

    const duplicateResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest({
        dispatchId: "dispatch-2",
        idempotencyKey: "idempotency-2",
        targetWakeLifecycleIdentity: projectTargetWakeLifecycleIdentity({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-2",
          sourceSignalId: "signal-1",
          spaceId: HEX_SPACE_ID,
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        }),
      })
    );

    expect(duplicateResponse.status).toBe(200);
    await expect(duplicateResponse.json()).resolves.toMatchObject({
      action: "skip_duplicate",
      ok: true,
      primaryDispatchId: "dispatch-1",
      runtimeCoordinatorExecutionId: null,
      status: "already_accepted",
    });
    const headRecord =
      findRuntimeCoordinatorHeadLifecycleRecord(storageRecords);
    expect(headRecord).toMatchObject({
      ownerUserId: "owner-1",
      primaryDispatchId: "dispatch-1",
      runtimeCoordinatorExecutionId: null,
      status: "accepted",
    });
    expect(headRecord).not.toHaveProperty("openMeldServiceRuntimeId");
    expect(headRecord?.duplicateDispatches).toContainEqual(
      expect.objectContaining({
        dispatchId: "dispatch-2",
        idempotencyKey: "idempotency-2",
        reasonCode: "runtime_coordinator.head_duplicate_dispatch_ignored",
      })
    );
  });

  it("queues distinct Wake lifecycles for one Agent Profile while another Profile starts immediately", async () => {
    const { hub } = createHarness();
    const publishAgentReadinessInvalidated = vi.fn();
    (
      hub as unknown as {
        publishAgentReadinessInvalidated: (input: {
          profileIds: readonly string[];
          reason: string;
        }) => void;
      }
    ).publishAgentReadinessInvalidated = publishAgentReadinessInvalidated;
    const firstIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-fifo-1",
      dispatchId: "dispatch-fifo-1",
      sourceSignalId: "signal-fifo-1",
      spaceId: HEX_SPACE_ID,
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    const secondIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-fifo-2",
      dispatchId: "dispatch-fifo-2",
      sourceSignalId: "signal-fifo-2",
      spaceId: "b".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    const thirdIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-fifo-3",
      dispatchId: "dispatch-fifo-3",
      sourceSignalId: "signal-fifo-3",
      spaceId: "c".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });

    await expect(
      (
        await fetchRuntimeTransportJson(
          hub,
          "/runtime-coordinator/head/accept",
          buildRuntimeCoordinatorHeadAcceptRequest({
            dispatchId: "dispatch-fifo-1",
            idempotencyKey: "idempotency-fifo-1",
            targetWakeLifecycleIdentity: firstIdentity,
          })
        )
      ).json()
    ).resolves.toMatchObject({
      action: "create_execution",
      status: "accepted",
    });
    expect(publishAgentReadinessInvalidated).toHaveBeenCalledWith({
      profileIds: [TARGET_AGENT_PROFILE_ID],
      reason: "agent_profile_work_coordinator.changed",
    });
    await expect(
      (
        await fetchRuntimeTransportJson(
          hub,
          "/runtime-coordinator/head/accept",
          buildRuntimeCoordinatorHeadAcceptRequest({
            dispatchId: "dispatch-fifo-2",
            idempotencyKey: "idempotency-fifo-2",
            targetWakeLifecycleIdentity: secondIdentity,
          })
        )
      ).json()
    ).resolves.toMatchObject({
      action: "wait_in_queue",
      queuePosition: 1,
      status: "queued",
      waitingCount: 1,
    });
    await expect(
      (
        await fetchRuntimeTransportJson(
          hub,
          "/runtime-coordinator/head/accept",
          buildRuntimeCoordinatorHeadAcceptRequest({
            dispatchId: "dispatch-fifo-3",
            idempotencyKey: "idempotency-fifo-3",
            targetWakeLifecycleIdentity: thirdIdentity,
          })
        )
      ).json()
    ).resolves.toMatchObject({
      action: "wait_in_queue",
      queuePosition: 2,
      status: "queued",
      waitingCount: 2,
    });

    const otherProfileIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-other-profile",
      dispatchId: "dispatch-other-profile",
      sourceSignalId: "signal-other-profile",
      spaceId: HEX_SPACE_ID,
      targetProfileId: "agt_22222222-2222-4222-8222-222222222222",
    });
    await expect(
      (
        await fetchRuntimeTransportJson(
          hub,
          "/runtime-coordinator/head/accept",
          buildRuntimeCoordinatorHeadAcceptRequest({
            dispatchId: "dispatch-other-profile",
            idempotencyKey: "idempotency-other-profile",
            targetWakeLifecycleIdentity: otherProfileIdentity,
          })
        )
      ).json()
    ).resolves.toMatchObject({
      action: "create_execution",
      status: "accepted",
    });
    expect(publishAgentReadinessInvalidated).toHaveBeenCalledWith({
      profileIds: ["agt_22222222-2222-4222-8222-222222222222"],
      reason: "agent_profile_work_coordinator.changed",
    });
  });

  it("returns the accepted dispatch identity when FIFO promotion is redriven after configuration drift", async () => {
    const { hub, socket, state, storageRecords } = createHarness();
    configureCompatibleRoute({ socket, state });
    const firstSnapshot = buildAcceptedDispatchSnapshot({ fingerprint: "a" });
    await expect(
      (
        await fetchRuntimeTransportJson(
          hub,
          "/runtime-coordinator/head/accept",
          buildRuntimeCoordinatorHeadAcceptRequest({
            acceptedDispatchSnapshot: firstSnapshot,
          })
        )
      ).json()
    ).resolves.toMatchObject({
      acceptedDispatchSnapshot: firstSnapshot,
      action: "create_execution",
      status: "accepted",
    });
    const deliveryResponse = await (
      hub as unknown as {
        handleDeliverDispatchRequest: (request: Request) => Promise<Response>;
      }
    ).handleDeliverDispatchRequest(
      new Request("https://runtime-transport.test/deliver-dispatch", {
        body: JSON.stringify(buildDeliverRequest()),
        method: "POST",
      })
    );
    expect(deliveryResponse.status).toBe(200);

    const secondIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-snapshot-b",
      dispatchId: "dispatch-snapshot-b",
      sourceSignalId: "signal-snapshot-b",
      spaceId: "b".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    const thirdIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-snapshot-c",
      dispatchId: "dispatch-snapshot-c",
      sourceSignalId: "signal-snapshot-c",
      spaceId: "c".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    const secondSnapshot = buildAcceptedDispatchSnapshot({ fingerprint: "b" });
    const thirdSnapshot = buildAcceptedDispatchSnapshot({ fingerprint: "c" });
    await expect(
      (
        await fetchRuntimeTransportJson(
          hub,
          "/runtime-coordinator/head/accept",
          buildRuntimeCoordinatorHeadAcceptRequest({
            acceptedDispatchSnapshot: secondSnapshot,
            dispatchId: "dispatch-snapshot-b",
            idempotencyKey: "idempotency-snapshot-b",
            targetWakeLifecycleIdentity: secondIdentity,
          })
        )
      ).json()
    ).resolves.toMatchObject({
      acceptedDispatchSnapshot: secondSnapshot,
      queuePosition: 1,
      status: "queued",
    });
    await expect(
      (
        await fetchRuntimeTransportJson(
          hub,
          "/runtime-coordinator/head/accept",
          buildRuntimeCoordinatorHeadAcceptRequest({
            acceptedDispatchSnapshot: thirdSnapshot,
            dispatchId: "dispatch-snapshot-c",
            idempotencyKey: "idempotency-snapshot-c",
            targetWakeLifecycleIdentity: thirdIdentity,
          })
        )
      ).json()
    ).resolves.toMatchObject({
      acceptedDispatchSnapshot: thirdSnapshot,
      queuePosition: 2,
      status: "queued",
    });

    const authority =
      findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords);
    expect(authority).toBeDefined();
    await (
      hub as unknown as {
        writeRuntimeCoordinatorTokenAuthority: (
          authority: RuntimeCoordinatorExecutionTokenAuthorityRecord
        ) => Promise<void>;
      }
    ).writeRuntimeCoordinatorTokenAuthority({
      ...(authority as RuntimeCoordinatorExecutionTokenAuthorityRecord),
      terminalOutcome: {
        finalizedAtMs: Date.now(),
        reasonCode: "space.reply_published",
        replySignalId: "signal-final-snapshot-a",
        status: "reply_published",
      },
    });

    const driftedCurrentSnapshot = buildAcceptedDispatchSnapshot({
      agentControllerRef: "builtin:claude-code",
      bindingId: "binding-later-2",
      configurationRevision: 8,
      fingerprint: "b",
      openMeldServiceRuntimeId: "runtime-later-2",
    });
    const redriveResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest({
        acceptedDispatchSnapshot: driftedCurrentSnapshot,
        dispatchId: "dispatch-snapshot-b",
        idempotencyKey: "idempotency-snapshot-b",
        targetWakeLifecycleIdentity: secondIdentity,
      })
    );
    expect(redriveResponse.status).toBe(200);
    await expect(redriveResponse.json()).resolves.toMatchObject({
      acceptedDispatchSnapshot: secondSnapshot,
      action: "create_execution",
      primaryDispatchId: "dispatch-snapshot-b",
      status: "already_accepted",
    });

    const mutatedPayloadResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest({
        acceptedDispatchSnapshot: buildAcceptedDispatchSnapshot({
          fingerprint: "d",
        }),
        dispatchId: "dispatch-snapshot-b",
        idempotencyKey: "idempotency-snapshot-b",
        targetWakeLifecycleIdentity: secondIdentity,
      })
    );
    expect(mutatedPayloadResponse.status).toBe(409);
    await expect(mutatedPayloadResponse.json()).resolves.toMatchObject({
      ok: false,
      primaryDispatchId: "dispatch-snapshot-b",
      reasonCode: "runtime_coordinator.head_authority_conflict",
      status: "conflict",
    });
  });

  it("keeps an old Core caller from reaccepting a head that owns an accepted snapshot", async () => {
    const { hub } = createHarness();
    const acceptedSnapshot = buildAcceptedDispatchSnapshot({
      fingerprint: "a",
    });
    await expect(
      (
        await fetchRuntimeTransportJson(
          hub,
          "/runtime-coordinator/head/accept",
          buildRuntimeCoordinatorHeadAcceptRequest({
            acceptedDispatchSnapshot: acceptedSnapshot,
          })
        )
      ).json()
    ).resolves.toMatchObject({
      acceptedDispatchSnapshot: acceptedSnapshot,
      action: "create_execution",
      status: "accepted",
    });

    const oldCallerResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest()
    );
    expect(oldCallerResponse.status).toBe(503);
    await expect(oldCallerResponse.json()).resolves.toEqual({
      ok: false,
      primaryDispatchId: "dispatch-1",
      reasonCode: "runtime_coordinator.accepted_dispatch_snapshot_required",
      status: "retry_later",
      targetWakeLifecycleId: expect.any(String),
    });
  });

  it("keeps a new Core caller from upgrading a legacy head that may already be executing", async () => {
    const { hub } = createHarness();
    await expect(
      (
        await fetchRuntimeTransportJson(
          hub,
          "/runtime-coordinator/head/accept",
          buildRuntimeCoordinatorHeadAcceptRequest()
        )
      ).json()
    ).resolves.toMatchObject({
      action: "create_execution",
      status: "accepted",
    });

    const newCallerResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest({
        acceptedDispatchSnapshot: buildAcceptedDispatchSnapshot({
          fingerprint: "a",
        }),
      })
    );
    expect(newCallerResponse.status).toBe(503);
    await expect(newCallerResponse.json()).resolves.toEqual({
      ok: false,
      primaryDispatchId: "dispatch-1",
      reasonCode: "runtime_coordinator.legacy_head_snapshot_upgrade_unsafe",
      status: "retry_later",
      targetWakeLifecycleId: expect.any(String),
    });
  });

  it("atomically upgrades a queued legacy head before a new Core caller can use it", async () => {
    const { hub } = createHarness();
    await expect(
      (
        await fetchRuntimeTransportJson(
          hub,
          "/runtime-coordinator/head/accept",
          buildRuntimeCoordinatorHeadAcceptRequest()
        )
      ).json()
    ).resolves.toMatchObject({
      action: "create_execution",
      status: "accepted",
    });
    const queuedIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-legacy-queued",
      dispatchId: "dispatch-legacy-queued",
      sourceSignalId: "signal-legacy-queued",
      spaceId: "b".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    const queuedRequest = buildRuntimeCoordinatorHeadAcceptRequest({
      dispatchId: "dispatch-legacy-queued",
      idempotencyKey: "idempotency-legacy-queued",
      targetWakeLifecycleIdentity: queuedIdentity,
    });
    await expect(
      (
        await fetchRuntimeTransportJson(
          hub,
          "/runtime-coordinator/head/accept",
          queuedRequest
        )
      ).json()
    ).resolves.toMatchObject({
      action: "wait_in_queue",
      queuePosition: 1,
      status: "queued",
    });

    const acceptedSnapshot = buildAcceptedDispatchSnapshot({
      fingerprint: "b",
    });
    const upgradedResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      {
        ...queuedRequest,
        acceptedDispatchSnapshot: acceptedSnapshot,
      }
    );
    expect(upgradedResponse.status).toBe(200);
    await expect(upgradedResponse.json()).resolves.toMatchObject({
      acceptedDispatchSnapshot: acceptedSnapshot,
      action: "wait_in_queue",
      queuePosition: 1,
      status: "queued",
    });
  });

  it("preserves the running Wake and FIFO queue across an execution-index generation repair", async () => {
    const { hub, socket, spaceFetchRequests, state, storageRecords } =
      createHarness();
    configureCompatibleRoute({ socket, state });
    await acceptDefaultRuntimeCoordinatorHead(hub);
    const deliveryResponse = await (
      hub as unknown as {
        handleDeliverDispatchRequest: (request: Request) => Promise<Response>;
      }
    ).handleDeliverDispatchRequest(
      new Request("https://runtime-transport.test/deliver-dispatch", {
        body: JSON.stringify(buildDeliverRequest()),
        method: "POST",
      })
    );
    expect(deliveryResponse.status).toBe(200);

    const secondIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-repair-2",
      dispatchId: "dispatch-repair-2",
      sourceSignalId: "signal-repair-2",
      spaceId: "b".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    await expect(
      (
        await fetchRuntimeTransportJson(
          hub,
          "/runtime-coordinator/head/accept",
          buildRuntimeCoordinatorHeadAcceptRequest({
            dispatchId: "dispatch-repair-2",
            idempotencyKey: "idempotency-repair-2",
            targetWakeLifecycleIdentity: secondIdentity,
          })
        )
      ).json()
    ).resolves.toMatchObject({ queuePosition: 1, status: "queued" });

    beginExecutionIndexGenerationRepair(storageRecords);
    await finishExecutionIndexGenerationRepair(hub);

    const repairedAdmission = storageRecords.get(
      runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
        TARGET_AGENT_PROFILE_ID
      )
    ) as { workItems?: Array<{ dispatchId: string }> } | undefined;
    expect(
      repairedAdmission?.workItems?.map((item) => item.dispatchId)
    ).toEqual(["dispatch-1", "dispatch-repair-2"]);

    const thirdIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-repair-3",
      dispatchId: "dispatch-repair-3",
      sourceSignalId: "signal-repair-3",
      spaceId: "c".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    await expect(
      (
        await fetchRuntimeTransportJson(
          hub,
          "/runtime-coordinator/head/accept",
          buildRuntimeCoordinatorHeadAcceptRequest({
            dispatchId: "dispatch-repair-3",
            idempotencyKey: "idempotency-repair-3",
            targetWakeLifecycleIdentity: thirdIdentity,
          })
        )
      ).json()
    ).resolves.toMatchObject({ queuePosition: 2, status: "queued" });

    const authority =
      findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords);
    expect(authority).toBeDefined();
    await (
      hub as unknown as {
        writeRuntimeCoordinatorTokenAuthority: (
          authority: RuntimeCoordinatorExecutionTokenAuthorityRecord
        ) => Promise<void>;
      }
    ).writeRuntimeCoordinatorTokenAuthority({
      ...(authority as RuntimeCoordinatorExecutionTokenAuthorityRecord),
      terminalOutcome: {
        finalizedAtMs: Date.now(),
        reasonCode: "space.reply_published",
        replySignalId: "signal-final-repair-1",
        status: "reply_published",
      },
    });
    const admissionAfterTerminal = storageRecords.get(
      runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
        TARGET_AGENT_PROFILE_ID
      )
    ) as { workItems?: Array<{ dispatchId: string }> } | undefined;
    expect(
      admissionAfterTerminal?.workItems?.map((item) => item.dispatchId)
    ).toEqual(["dispatch-repair-2", "dispatch-repair-3"]);

    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          secondIdentity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({
      primaryDispatchId: "dispatch-repair-2",
      status: "accepted",
    });
    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          thirdIdentity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({
      primaryDispatchId: "dispatch-repair-3",
      status: "queued",
    });
    expect(spaceFetchRequests).toContainEqual({
      body: {
        reason: "agent_profile_work_coordinator_promotion",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        targetWakeLifecycleId: secondIdentity.targetWakeLifecycleId,
      },
      path: "/internal/dispatches/dispatch-repair-2/redrive",
    });

    const promotionRedriveCount = spaceFetchRequests.filter(
      (request) =>
        request.path === "/internal/dispatches/dispatch-repair-2/redrive"
    ).length;
    await (
      hub as unknown as {
        writeRuntimeCoordinatorTokenAuthority: (
          authority: RuntimeCoordinatorExecutionTokenAuthorityRecord
        ) => Promise<void>;
      }
    ).writeRuntimeCoordinatorTokenAuthority({
      ...(authority as RuntimeCoordinatorExecutionTokenAuthorityRecord),
      terminalOutcome: {
        finalizedAtMs: Date.now(),
        reasonCode: "space.reply_published",
        replySignalId: "signal-final-repair-1",
        status: "reply_published",
      },
    });
    expect(
      (
        storageRecords.get(
          runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
            TARGET_AGENT_PROFILE_ID
          )
        ) as { workItems?: Array<{ dispatchId: string }> } | undefined
      )?.workItems?.map((item) => item.dispatchId)
    ).toEqual(["dispatch-repair-2", "dispatch-repair-3"]);
    expect(
      spaceFetchRequests.filter(
        (request) =>
          request.path === "/internal/dispatches/dispatch-repair-2/redrive"
      )
    ).toHaveLength(promotionRedriveCount);
  });

  it("promotes the FIFO successor when completion lands during an execution-index generation repair", async () => {
    const { hub, socket, spaceFetchRequests, state, storageRecords } =
      createHarness();
    configureCompatibleRoute({ socket, state });
    await acceptDefaultRuntimeCoordinatorHead(hub);
    const deliveryResponse = await (
      hub as unknown as {
        handleDeliverDispatchRequest: (request: Request) => Promise<Response>;
      }
    ).handleDeliverDispatchRequest(
      new Request("https://runtime-transport.test/deliver-dispatch", {
        body: JSON.stringify(buildDeliverRequest()),
        method: "POST",
      })
    );
    expect(deliveryResponse.status).toBe(200);

    const successorIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-repair-terminal-2",
      dispatchId: "dispatch-repair-terminal-2",
      sourceSignalId: "signal-repair-terminal-2",
      spaceId: "b".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest({
        dispatchId: "dispatch-repair-terminal-2",
        idempotencyKey: "idempotency-repair-terminal-2",
        targetWakeLifecycleIdentity: successorIdentity,
      })
    );
    beginExecutionIndexGenerationRepair(storageRecords);

    const authority =
      findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords);
    expect(authority).toBeDefined();
    await (
      hub as unknown as {
        writeRuntimeCoordinatorTokenAuthority: (
          authority: RuntimeCoordinatorExecutionTokenAuthorityRecord
        ) => Promise<void>;
      }
    ).writeRuntimeCoordinatorTokenAuthority({
      ...(authority as RuntimeCoordinatorExecutionTokenAuthorityRecord),
      terminalOutcome: {
        finalizedAtMs: Date.now(),
        reasonCode: "space.reply_published",
        replySignalId: "signal-final-during-repair",
        status: "reply_published",
      },
    });

    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          successorIdentity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({
      primaryDispatchId: "dispatch-repair-terminal-2",
      status: "accepted",
    });
    expect(spaceFetchRequests).toContainEqual({
      body: {
        reason: "agent_profile_work_coordinator_promotion",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        targetWakeLifecycleId: successorIdentity.targetWakeLifecycleId,
      },
      path: "/internal/dispatches/dispatch-repair-terminal-2/redrive",
    });
  });

  it.each([
    ["reply_published", "space.reply_published"],
    ["failed_terminal", "provider.execution_failed"],
    ["cancelled", "runtime_coordinator.wake_stop_local_control_accepted"],
  ] as const)("atomically promotes and immediately redrives the FIFO successor after a running Wake becomes %s", async (terminalStatus, reasonCode) => {
    const { hub, spaceFetchRequests, socket, state, storageRecords } =
      createHarness();
    configureCompatibleRoute({ socket, state });
    await acceptDefaultRuntimeCoordinatorHead(hub);
    const deliveryResponse = await (
      hub as unknown as {
        handleDeliverDispatchRequest: (request: Request) => Promise<Response>;
      }
    ).handleDeliverDispatchRequest(
      new Request("https://runtime-transport.test/deliver-dispatch", {
        body: JSON.stringify(buildDeliverRequest()),
        method: "POST",
      })
    );
    expect(deliveryResponse.status).toBe(200);

    const successorIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-successor",
      dispatchId: "dispatch-successor",
      sourceSignalId: "signal-successor",
      spaceId: "b".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    await expect(
      (
        await fetchRuntimeTransportJson(
          hub,
          "/runtime-coordinator/head/accept",
          buildRuntimeCoordinatorHeadAcceptRequest({
            dispatchId: "dispatch-successor",
            idempotencyKey: "idempotency-successor",
            targetWakeLifecycleIdentity: successorIdentity,
          })
        )
      ).json()
    ).resolves.toMatchObject({ status: "queued" });

    const authority =
      findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords);
    expect(authority).toBeDefined();
    await (
      hub as unknown as {
        writeRuntimeCoordinatorTokenAuthority: (
          authority: RuntimeCoordinatorExecutionTokenAuthorityRecord
        ) => Promise<void>;
      }
    ).writeRuntimeCoordinatorTokenAuthority({
      ...(authority as RuntimeCoordinatorExecutionTokenAuthorityRecord),
      terminalOutcome: {
        finalizedAtMs: Date.now(),
        reasonCode,
        replySignalId:
          terminalStatus === "reply_published" ? "signal-final-1" : null,
        status: terminalStatus,
      },
    });

    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          successorIdentity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({
      primaryDispatchId: "dispatch-successor",
      status: "accepted",
    });
    expect(spaceFetchRequests).toContainEqual({
      body: {
        reason: "agent_profile_work_coordinator_promotion",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        targetWakeLifecycleId: successorIdentity.targetWakeLifecycleId,
      },
      path: "/internal/dispatches/dispatch-successor/redrive",
    });

    const promotionRedriveCount = spaceFetchRequests.filter(
      (request) =>
        request.path === "/internal/dispatches/dispatch-successor/redrive"
    ).length;
    await (
      hub as unknown as {
        writeRuntimeCoordinatorTokenAuthority: (
          authority: RuntimeCoordinatorExecutionTokenAuthorityRecord
        ) => Promise<void>;
      }
    ).writeRuntimeCoordinatorTokenAuthority({
      ...(authority as RuntimeCoordinatorExecutionTokenAuthorityRecord),
      terminalOutcome: {
        finalizedAtMs: Date.now(),
        reasonCode,
        replySignalId:
          terminalStatus === "reply_published" ? "signal-final-1" : null,
        status: terminalStatus,
      },
    });
    expect(
      spaceFetchRequests.filter(
        (request) =>
          request.path === "/internal/dispatches/dispatch-successor/redrive"
      )
    ).toHaveLength(promotionRedriveCount);
  });

  it.each([
    ["still matches", false, "accepted"],
    ["changes after approval", true, "needs_attention"],
  ] as const)("holds FIFO work when the running Wake exhausts Usage and its execution target %s", async (_caseName, saveFutureSettings, expectedOutcome) => {
    const {
      hub,
      recordingD1,
      spaceFetchRequests,
      socket,
      state,
      storageRecords,
    } = createHarness({
      agentProfileRow: {
        managed_role: null,
        organization_id: "org-one",
        owner_user_id: "owner-1",
        profile_kind: "agent",
        profile_name: "Codex Agent",
      },
    });
    configureRevisionAwareRoute({
      configurationRevision: 1,
      socket,
      state,
    });
    await acceptDefaultRuntimeCoordinatorHead(hub);
    const deliveryResponse = await (
      hub as unknown as {
        handleDeliverDispatchRequest: (request: Request) => Promise<Response>;
      }
    ).handleDeliverDispatchRequest(
      new Request("https://runtime-transport.test/deliver-dispatch", {
        body: JSON.stringify(buildDeliverRequest()),
        method: "POST",
      })
    );
    expect(deliveryResponse.status).toBe(200);

    const successorIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-usage-successor",
      dispatchId: "dispatch-usage-successor",
      sourceSignalId: "signal-usage-successor",
      spaceId: "b".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest({
        dispatchId: "dispatch-usage-successor",
        idempotencyKey: "idempotency-usage-successor",
        targetWakeLifecycleIdentity: successorIdentity,
      })
    );

    const authority =
      findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords);
    expect(authority).toBeDefined();
    await (
      hub as unknown as {
        writeRuntimeCoordinatorTokenAuthority: (
          authority: RuntimeCoordinatorExecutionTokenAuthorityRecord
        ) => Promise<void>;
      }
    ).writeRuntimeCoordinatorTokenAuthority({
      ...(authority as RuntimeCoordinatorExecutionTokenAuthorityRecord),
      terminalOutcome: {
        finalizedAtMs: Date.now(),
        reasonCode: "usage_exhausted",
        replySignalId: null,
        status: "failed_terminal",
      },
    });

    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          successorIdentity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({ status: "queued" });
    expect(
      storageRecords.get(
        runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
          TARGET_AGENT_PROFILE_ID
        )
      )
    ).toMatchObject({
      recoveryGate: {
        continuationClientMessageId: null,
        status: "awaiting_usage",
      },
      workItems: [
        expect.objectContaining({ dispatchId: "dispatch-usage-successor" }),
      ],
    });
    expect(spaceFetchRequests).not.toContainEqual(
      expect.objectContaining({
        path: "/internal/dispatches/dispatch-usage-successor/redrive",
      })
    );
    beginExecutionIndexGenerationRepair(storageRecords);
    await finishExecutionIndexGenerationRepair(hub);
    const operationalContextHub = hub as unknown as {
      rpcReadAgentProfileOperationalContexts: (input: {
        includeWorkReferences: boolean;
        ownerUserId: string;
        targetProfileIds: string[];
      }) => Promise<unknown>;
    };
    await expect(
      operationalContextHub.rpcReadAgentProfileOperationalContexts({
        includeWorkReferences: true,
        ownerUserId: "owner-1",
        targetProfileIds: [TARGET_AGENT_PROFILE_ID],
      })
    ).resolves.toEqual({
      contexts: [
        {
          operationalContext: {
            queuedWorkReferences: [
              {
                sourceSignalId: "signal-usage-successor",
                spaceId: "b".repeat(64),
              },
            ],
            status: "paused",
            waitingCount: 1,
          },
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        },
      ],
    });

    const recoveryHub = hub as unknown as {
      rpcAuthorizeAgentProfileWorkContinuation: (input: {
        continuationClientMessageId: string;
        currentAgentControllerRef: string;
        currentBindingId: string;
        currentConfigurationRevision: number;
        expectedInterruptedTargetWakeLifecycleId: string;
        ownerUserId: string;
        requireAcceptedExecutionTargetRevision: true;
        targetProfileId: string;
      }) => Promise<unknown>;
      rpcMarkAgentProfileWorkUsageAvailable: (input: {
        ownerUserId: string;
        targetProfileIds: string[];
      }) => Promise<unknown>;
      rpcReadAgentProfileWorkRecovery: (input: {
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<unknown>;
    };
    await expect(
      recoveryHub.rpcReadAgentProfileWorkRecovery({
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toEqual({ status: "not_pending" });
    await expect(
      recoveryHub.rpcMarkAgentProfileWorkUsageAvailable({
        ownerUserId: "owner-1",
        targetProfileIds: [TARGET_AGENT_PROFILE_ID],
      })
    ).resolves.toEqual({
      changedProfileIds: [TARGET_AGENT_PROFILE_ID],
      continuationProfileIds: [TARGET_AGENT_PROFILE_ID],
      status: "updated",
    });
    await expect(
      recoveryHub.rpcMarkAgentProfileWorkUsageAvailable({
        ownerUserId: "owner-1",
        targetProfileIds: [TARGET_AGENT_PROFILE_ID],
      })
    ).resolves.toEqual({
      changedProfileIds: [],
      continuationProfileIds: [TARGET_AGENT_PROFILE_ID],
      status: "updated",
    });
    const admissionKey =
      runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
        TARGET_AGENT_PROFILE_ID
      );
    const legacyAdmission = storageRecords.get(admissionKey) as {
      recoveryGate: Record<string, unknown>;
    };
    storageRecords.set(admissionKey, {
      ...legacyAdmission,
      recoveryGate: {
        ...legacyAdmission.recoveryGate,
        status: "awaiting_owner_continuation",
      },
    });
    await expect(
      recoveryHub.rpcReadAgentProfileWorkRecovery({
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toEqual({
      action: "continue_interrupted_work",
      authorizedContinuationClientMessageId: null,
      interruptedClientMessageId: "client-message-1",
      interruptedDispatchId: "dispatch-1",
      interruptedSourceSignalId: "signal-1",
      interruptedTargetWakeLifecycleId:
        buildRuntimeCoordinatorHeadAcceptRequest().targetWakeLifecycleIdentity
          .targetWakeLifecycleId,
      spaceId: HEX_SPACE_ID,
      status: "available",
    });
    await expect(
      operationalContextHub.rpcReadAgentProfileOperationalContexts({
        includeWorkReferences: true,
        ownerUserId: "owner-1",
        targetProfileIds: [TARGET_AGENT_PROFILE_ID],
      })
    ).resolves.toEqual({
      contexts: [
        {
          operationalContext: {
            queuedWorkReferences: [
              {
                sourceSignalId: "signal-usage-successor",
                spaceId: "b".repeat(64),
              },
            ],
            recoveryAction: "continue_interrupted_work",
            recoveryTargetWakeLifecycleId:
              buildRuntimeCoordinatorHeadAcceptRequest()
                .targetWakeLifecycleIdentity.targetWakeLifecycleId,
            status: "paused",
            waitingCount: 1,
          },
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        },
      ],
    });
    await expect(
      recoveryHub.rpcMarkAgentProfileWorkUsageAvailable({
        ownerUserId: "owner-1",
        targetProfileIds: [TARGET_AGENT_PROFILE_ID],
      })
    ).resolves.toEqual({
      changedProfileIds: [],
      continuationProfileIds: [TARGET_AGENT_PROFILE_ID],
      status: "updated",
    });
    expect([...recordingD1.interactionInboxRows.values()]).toEqual([]);
    await expect(
      recoveryHub.rpcAuthorizeAgentProfileWorkContinuation({
        continuationClientMessageId: "client-message-usage-continuation",
        currentAgentControllerRef: "builtin:codex",
        currentBindingId: "binding-1",
        currentConfigurationRevision: 1,
        expectedInterruptedTargetWakeLifecycleId:
          buildRuntimeCoordinatorHeadAcceptRequest().targetWakeLifecycleIdentity
            .targetWakeLifecycleId,
        ownerUserId: "owner-1",
        requireAcceptedExecutionTargetRevision: true,
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toEqual({ status: "authorized" });
    await expect(
      recoveryHub.rpcReadAgentProfileWorkRecovery({
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toMatchObject({
      action: "continue_interrupted_work",
      authorizedContinuationClientMessageId:
        "client-message-usage-continuation",
      status: "available",
    });
    await expect(
      recoveryHub.rpcMarkAgentProfileWorkUsageAvailable({
        ownerUserId: "owner-1",
        targetProfileIds: [TARGET_AGENT_PROFILE_ID],
      })
    ).resolves.toEqual({
      changedProfileIds: [],
      continuationProfileIds: [TARGET_AGENT_PROFILE_ID],
      status: "updated",
    });

    const continuationIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-usage-continuation",
      dispatchId: "dispatch-usage-continuation",
      sourceSignalId: "signal-usage-continuation",
      spaceId: "c".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    const mutationHub = hub as unknown as {
      rpcAcquireAgentProfileFutureWorkSettingsMutation: (input: {
        operationId: string;
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<{ status: string }>;
      rpcAcquireAgentProfileControllerMutation: (input: {
        operationId: string;
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<{ status: string }>;
      rpcReleaseAgentProfileControllerMutation: (input: {
        operationId: string;
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<{ status: string }>;
    };
    if (saveFutureSettings) {
      await expect(
        mutationHub.rpcAcquireAgentProfileFutureWorkSettingsMutation({
          operationId: "save-future-settings-after-approval",
          ownerUserId: "owner-1",
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        })
      ).resolves.toMatchObject({ status: "acquired" });
      await expect(
        mutationHub.rpcReleaseAgentProfileControllerMutation({
          operationId: "save-future-settings-after-approval",
          ownerUserId: "owner-1",
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        })
      ).resolves.toEqual({ status: "released" });
    }

    const continuationAcceptance = await (
      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/accept",
        buildRuntimeCoordinatorHeadAcceptRequest({
          dispatchId: "dispatch-usage-continuation",
          idempotencyKey: "idempotency-usage-continuation",
          targetWakeLifecycleIdentity: continuationIdentity,
        })
      )
    ).json();
    if (expectedOutcome === "needs_attention") {
      expect(continuationAcceptance).toMatchObject({
        ok: false,
        reasonCode:
          "agent_profile_work_coordinator.continuation_needs_attention",
        status: "conflict",
      });
      expect(
        storageRecords.get(
          buildRuntimeCoordinatorHeadLifecycleStorageKey(
            continuationIdentity.targetWakeLifecycleId
          )
        )
      ).toBeUndefined();
      expect(storageRecords.get(admissionKey)).toMatchObject({
        recoveryGate: {
          continuationClientMessageId: "client-message-usage-continuation",
          status: "continuation_needs_attention",
        },
        workItems: [
          expect.objectContaining({ dispatchId: "dispatch-usage-successor" }),
        ],
      });
      const recoveryProjectionCount = [...storageRecords.values()].filter(
        (value) =>
          parseAgentProfileWorkRecoveryInboxProjectionIntent(value) !== null
      ).length;
      await expect(
        (
          await fetchRuntimeTransportJson(
            hub,
            "/runtime-coordinator/head/accept",
            buildRuntimeCoordinatorHeadAcceptRequest({
              dispatchId: "dispatch-usage-continuation",
              idempotencyKey: "idempotency-usage-continuation",
              targetWakeLifecycleIdentity: continuationIdentity,
            })
          )
        ).json()
      ).resolves.toMatchObject({
        reasonCode:
          "agent_profile_work_coordinator.continuation_needs_attention",
        status: "conflict",
      });
      expect(
        [...storageRecords.values()].filter(
          (value) =>
            parseAgentProfileWorkRecoveryInboxProjectionIntent(value) !== null
        )
      ).toHaveLength(recoveryProjectionCount);
      expect(storageRecords.get(admissionKey)).toMatchObject({
        workItems: [
          expect.objectContaining({ dispatchId: "dispatch-usage-successor" }),
        ],
      });
      return;
    }
    await expect(
      Promise.resolve(continuationAcceptance)
    ).resolves.toMatchObject({
      action: "create_execution",
      status: "accepted",
    });
    await expect(
      mutationHub.rpcAcquireAgentProfileControllerMutation({
        operationId: "too-late-after-continuation-started",
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toMatchObject({ status: "blocked" });
    expect(
      storageRecords.get(
        runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
          TARGET_AGENT_PROFILE_ID
        )
      )
    ).toMatchObject({
      recoveryGate: { status: "continuation_running" },
      workItems: [
        expect.objectContaining({
          dispatchId: "dispatch-usage-continuation",
        }),
        expect.objectContaining({ dispatchId: "dispatch-usage-successor" }),
      ],
    });
  });

  it("projects and resolves the queued-work approval from Coordinator truth", async () => {
    const {
      hub,
      recordingD1,
      sentFrames,
      socket,
      state,
      storageRecords,
      storageSetAlarm,
    } = createHarness();
    const { admissionKey, authority } =
      await prepareRunningContinuationWithQueuedWork({
        hub,
        queuedWorkName: "owner-approval",
        sentFrames,
        socket,
        state,
        storageRecords,
      });
    storageSetAlarm.mockClear();
    await (
      hub as unknown as {
        writeRuntimeCoordinatorTokenAuthority: (
          authority: RuntimeCoordinatorExecutionTokenAuthorityRecord
        ) => Promise<void>;
      }
    ).writeRuntimeCoordinatorTokenAuthority({
      ...authority,
      terminalOutcome: {
        finalizedAtMs: Date.now(),
        reasonCode: "completed",
        replySignalId: "signal-continuation-final",
        status: "reply_published",
      },
    });
    expect(storageSetAlarm).toHaveBeenCalledWith(expect.any(Number));

    expect(storageRecords.get(admissionKey)).toMatchObject({
      recoveryGate: { status: "awaiting_owner_approval" },
      workItems: [
        expect.objectContaining({ dispatchId: "dispatch-owner-approval" }),
      ],
    });
    expect([...recordingD1.interactionInboxRows.values()]).toEqual([]);
    await (
      hub as unknown as {
        rpcReadAgentProfileOperationalContexts: (input: {
          includeWorkReferences: boolean;
          ownerUserId: string;
          targetProfileIds: string[];
        }) => Promise<unknown>;
      }
    ).rpcReadAgentProfileOperationalContexts({
      includeWorkReferences: false,
      ownerUserId: "owner-1",
      targetProfileIds: [TARGET_AGENT_PROFILE_ID],
    });
    expect([...recordingD1.interactionInboxRows.values()]).toEqual([]);
    await (hub as unknown as { alarm: () => Promise<void> }).alarm();
    expect([...recordingD1.interactionInboxRows.values()]).toEqual([
      expect.objectContaining({
        attention: "action_required",
        context_label: "Codex Agent",
        importance: "urgent",
        organization_id: "org-one",
        recipient_user_id: "owner-1",
        resolution_status: "open",
        source_kind: "agent_profile_work_recovery",
        title: "Start queued work for Codex Agent",
      }),
    ]);
    expect(
      JSON.parse(
        String(
          [...recordingD1.interactionInboxRows.values()][0]?.source_target_json
        )
      )
    ).toEqual({
      kind: "agent_profile",
      profileId: TARGET_AGENT_PROFILE_ID,
    });
    const projectedApproval = [...recordingD1.interactionInboxRows.values()][0];
    recordingD1.interactionInboxRows.set("unrelated-recovery", {
      ...projectedApproval,
      id: "unrelated-recovery",
      source_key: "unrelated-recovery",
    });

    await expect(
      (
        hub as unknown as {
          rpcApproveAgentProfileWorkQueue: (input: {
            ownerUserId: string;
            targetProfileId: string;
          }) => Promise<unknown>;
        }
      ).rpcApproveAgentProfileWorkQueue({
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toEqual({ status: "approved" });
    expect(
      [...recordingD1.interactionInboxRows.values()].find(
        (row) => row.source_key === projectedApproval?.source_key
      )
    ).toMatchObject({ resolution_status: "open" });
    await (hub as unknown as { alarm: () => Promise<void> }).alarm();
    expect(
      [...recordingD1.interactionInboxRows.values()].find(
        (row) => row.source_key === projectedApproval?.source_key
      )
    ).toMatchObject({ resolution_status: "resolved" });
    expect(
      recordingD1.interactionInboxRows.get("unrelated-recovery")
    ).toMatchObject({ resolution_status: "open" });
  });

  it("projects one interrupted-work review and promotes queued work only after the owner skips", async () => {
    const {
      hub,
      recordingD1,
      sentFrames,
      socket,
      spaceFetchRequests,
      state,
      storageRecords,
    } = createHarness();
    const { admissionKey, queuedIdentity } =
      await prepareRunningContinuationWithQueuedWork({
        hub,
        queuedWorkName: "needs-attention-successor",
        sentFrames,
        socket,
        state,
        storageRecords,
      });
    const admission = storageRecords.get(admissionKey) as {
      recoveryGate: {
        interruptedWork: {
          dispatchId: string;
          targetWakeLifecycleId: string;
        };
      };
      revision: number;
      updatedAtMs: number;
      workItems: Array<{
        dispatchId: string;
        enqueuedAtMs: number;
        targetWakeLifecycleId: string;
      }>;
    };
    const queuedWork = admission.workItems.find(
      (item) => item.dispatchId === queuedIdentity.dispatchId
    );
    if (!queuedWork) {
      throw new Error("Expected queued work after the interrupted Wake.");
    }
    storageRecords.set(admissionKey, {
      ...admission,
      recoveryGate: {
        continuationClientMessageId: null,
        interruptedWork: admission.recoveryGate.interruptedWork,
        status: "continuation_pending",
        updatedAtMs: Date.now(),
      },
      revision: admission.revision + 1,
      updatedAtMs: Date.now(),
      workItems: [queuedWork],
    });

    const recoveryHub = hub as unknown as {
      rpcMarkAgentProfileWorkContinuationNeedsAttention: (input: {
        expectedInterruptedTargetWakeLifecycleId: string;
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<unknown>;
      rpcReadAgentProfileWorkRecovery: (input: {
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<unknown>;
      rpcSkipAgentProfileInterruptedWork: (input: {
        expectedInterruptedTargetWakeLifecycleId: string;
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<unknown>;
    };
    const request = {
      ownerUserId: "owner-1",
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    };
    const markRequest = {
      expectedInterruptedTargetWakeLifecycleId:
        admission.recoveryGate.interruptedWork.targetWakeLifecycleId,
      ...request,
    };
    const skipRequest = {
      expectedInterruptedTargetWakeLifecycleId:
        admission.recoveryGate.interruptedWork.targetWakeLifecycleId,
      ...request,
    };

    await expect(
      recoveryHub.rpcMarkAgentProfileWorkContinuationNeedsAttention(markRequest)
    ).resolves.toEqual({ status: "marked" });
    await expect(
      recoveryHub.rpcMarkAgentProfileWorkContinuationNeedsAttention(markRequest)
    ).resolves.toEqual({ status: "not_pending" });
    await expect(
      recoveryHub.rpcReadAgentProfileWorkRecovery(request)
    ).resolves.toMatchObject({
      action: "skip_interrupted_work",
      interruptedClientMessageId: "client-message-1",
      interruptedDispatchId: "dispatch-1",
      interruptedSourceSignalId: "signal-1",
      spaceId: HEX_SPACE_ID,
      status: "available",
    });

    await (hub as unknown as { alarm: () => Promise<void> }).alarm();
    const reviewRows = [...recordingD1.interactionInboxRows.values()];
    expect(reviewRows).toEqual([
      expect.objectContaining({
        resolution_status: "open",
        title: "Review interrupted work for Codex Agent",
      }),
    ]);
    expect(JSON.parse(String(reviewRows[0]?.source_target_json))).toEqual({
      kind: "space",
      signalId: "signal-1",
      spaceId: HEX_SPACE_ID,
    });
    await (hub as unknown as { alarm: () => Promise<void> }).alarm();
    expect(recordingD1.interactionInboxRows.size).toBe(1);

    await expect(
      recoveryHub.rpcSkipAgentProfileInterruptedWork(skipRequest)
    ).resolves.toEqual({ status: "skipped" });
    await expect(
      recoveryHub.rpcSkipAgentProfileInterruptedWork(skipRequest)
    ).resolves.toEqual({ status: "not_pending" });
    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          queuedIdentity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({ status: "accepted" });
    expect(spaceFetchRequests).toContainEqual({
      body: {
        reason: "agent_profile_work_coordinator_promotion",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        targetWakeLifecycleId: queuedIdentity.targetWakeLifecycleId,
      },
      path: "/internal/dispatches/dispatch-needs-attention-successor/redrive",
    });

    await (hub as unknown as { alarm: () => Promise<void> }).alarm();
    expect([...recordingD1.interactionInboxRows.values()]).toEqual([
      expect.objectContaining({ resolution_status: "resolved" }),
    ]);
  });

  it("does not let a stale Skip action clear a later interrupted-work gate", async () => {
    const { hub, sentFrames, socket, state, storageRecords } = createHarness();
    const { admissionKey } = await prepareRunningContinuationWithQueuedWork({
      hub,
      queuedWorkName: "stale-skip-successor",
      sentFrames,
      socket,
      state,
      storageRecords,
    });
    const admission = storageRecords.get(admissionKey) as {
      recoveryGate: AgentProfileWorkRecoveryGate;
      revision: number;
    };
    const staleTargetWakeLifecycleId =
      admission.recoveryGate.interruptedWork.targetWakeLifecycleId;
    const currentTargetWakeLifecycleId = "twl_current-needs-attention";
    storageRecords.set(admissionKey, {
      ...admission,
      recoveryGate: {
        ...admission.recoveryGate,
        interruptedWork: {
          ...admission.recoveryGate.interruptedWork,
          dispatchId: "dispatch-current-needs-attention",
          targetWakeLifecycleId: currentTargetWakeLifecycleId,
        },
        status: "continuation_needs_attention",
      },
      revision: admission.revision + 1,
    });

    await expect(
      (
        hub as unknown as {
          rpcSkipAgentProfileInterruptedWork: (input: {
            expectedInterruptedTargetWakeLifecycleId: string;
            ownerUserId: string;
            targetProfileId: string;
          }) => Promise<unknown>;
        }
      ).rpcSkipAgentProfileInterruptedWork({
        expectedInterruptedTargetWakeLifecycleId: staleTargetWakeLifecycleId,
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toEqual({ status: "not_pending" });
    expect(storageRecords.get(admissionKey)).toMatchObject({
      recoveryGate: {
        interruptedWork: {
          targetWakeLifecycleId: currentTargetWakeLifecycleId,
        },
        status: "continuation_needs_attention",
      },
    });
  });

  it("does not let a delayed failure mark a later interrupted-work gate", async () => {
    const { hub, sentFrames, socket, state, storageRecords } = createHarness();
    const { admissionKey } = await prepareRunningContinuationWithQueuedWork({
      hub,
      queuedWorkName: "stale-needs-attention-successor",
      sentFrames,
      socket,
      state,
      storageRecords,
    });
    const admission = storageRecords.get(admissionKey) as {
      recoveryGate: AgentProfileWorkRecoveryGate;
      revision: number;
    };
    const staleTargetWakeLifecycleId =
      admission.recoveryGate.interruptedWork.targetWakeLifecycleId;
    const currentTargetWakeLifecycleId = "twl_current-continuation";
    storageRecords.set(admissionKey, {
      ...admission,
      recoveryGate: {
        ...admission.recoveryGate,
        interruptedWork: {
          ...admission.recoveryGate.interruptedWork,
          dispatchId: "dispatch-current-continuation",
          targetWakeLifecycleId: currentTargetWakeLifecycleId,
        },
        status: "continuation_pending",
      },
      revision: admission.revision + 1,
    });

    await expect(
      (
        hub as unknown as {
          rpcMarkAgentProfileWorkContinuationNeedsAttention: (input: {
            expectedInterruptedTargetWakeLifecycleId: string;
            ownerUserId: string;
            targetProfileId: string;
          }) => Promise<unknown>;
        }
      ).rpcMarkAgentProfileWorkContinuationNeedsAttention({
        expectedInterruptedTargetWakeLifecycleId: staleTargetWakeLifecycleId,
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toEqual({ status: "not_pending" });
    expect(storageRecords.get(admissionKey)).toMatchObject({
      recoveryGate: {
        interruptedWork: {
          targetWakeLifecycleId: currentTargetWakeLifecycleId,
        },
        status: "continuation_pending",
      },
    });
  });

  it("moves a pending continuation to Needs attention when a future-settings save wins", async () => {
    const {
      hub,
      sentFrames,
      socket,
      spaceFetchRequests,
      state,
      storageRecords,
    } = createHarness();
    const { admissionKey } = await prepareRunningContinuationWithQueuedWork({
      hub,
      queuedWorkName: "future-settings-successor",
      sentFrames,
      socket,
      state,
      storageRecords,
    });
    const admission = storageRecords.get(admissionKey) as {
      recoveryGate: AgentProfileWorkRecoveryGate;
      revision: number;
      updatedAtMs: number;
      workItems: AgentProfileWorkCoordinatorItem[];
    };
    const interruptedTargetWakeLifecycleId =
      admission.recoveryGate.interruptedWork.targetWakeLifecycleId;
    storageRecords.set(admissionKey, {
      ...admission,
      recoveryGate: {
        ...admission.recoveryGate,
        continuationClientMessageId: null,
        status: "continuation_pending",
      },
      revision: admission.revision + 1,
    });
    const redriveCount = spaceFetchRequests.length;
    const mutationHub = hub as unknown as {
      rpcAcquireAgentProfileFutureWorkSettingsMutation: (input: {
        operationId: string;
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<unknown>;
      rpcReleaseAgentProfileControllerMutation: (input: {
        operationId: string;
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<unknown>;
    };
    const mutation = {
      operationId: "save-settings-before-continuation-authorization",
      ownerUserId: "owner-1",
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    };

    await expect(
      mutationHub.rpcAcquireAgentProfileFutureWorkSettingsMutation(mutation)
    ).resolves.toMatchObject({ status: "acquired" });
    expect(storageRecords.get(admissionKey)).toMatchObject({
      recoveryGate: {
        interruptedWork: {
          targetWakeLifecycleId: interruptedTargetWakeLifecycleId,
        },
        status: "continuation_needs_attention",
      },
      workItems: admission.workItems,
    });
    expect(
      [...storageRecords.values()].filter(
        (value) =>
          parseAgentProfileWorkRecoveryInboxProjectionIntent(value) !== null
      )
    ).toHaveLength(1);
    expect(spaceFetchRequests).toHaveLength(redriveCount);
    await expect(
      mutationHub.rpcReleaseAgentProfileControllerMutation(mutation)
    ).resolves.toEqual({ status: "released" });
  });

  it.each([
    "continuation_pending",
    "continuation_authorized",
  ] as const)("moves a %s continuation to Needs attention when an execution-target change wins", async (continuationStatus) => {
    const {
      hub,
      sentFrames,
      socket,
      spaceFetchRequests,
      state,
      storageRecords,
    } = createHarness();
    await issueDeliveryToken({
      hub,
      profileConfigurationRevision: 1,
      sentFrames,
      socket,
      state,
    });
    const queuedWorkName = `execution-target-${continuationStatus}-successor`;
    const queuedDispatchId = `dispatch-${queuedWorkName}`;
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest({
        dispatchId: queuedDispatchId,
        idempotencyKey: `idempotency-${queuedWorkName}`,
        targetWakeLifecycleIdentity: projectTargetWakeLifecycleIdentity({
          clientMessageId: `client-message-${queuedWorkName}`,
          dispatchId: queuedDispatchId,
          sourceSignalId: `signal-${queuedWorkName}`,
          spaceId: "b".repeat(64),
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        }),
      })
    );
    const authority =
      findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords);
    if (!authority) {
      throw new Error("Expected interrupted execution authority.");
    }
    await (
      hub as unknown as {
        writeRuntimeCoordinatorTokenAuthority: (
          nextAuthority: RuntimeCoordinatorExecutionTokenAuthorityRecord
        ) => Promise<void>;
      }
    ).writeRuntimeCoordinatorTokenAuthority({
      ...authority,
      terminalOutcome: {
        finalizedAtMs: Date.now(),
        reasonCode: "usage_exhausted",
        replySignalId: null,
        status: "failed_terminal",
      },
    });
    const admissionKey =
      runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
        TARGET_AGENT_PROFILE_ID
      );
    const recoveryHub = hub as unknown as {
      rpcAuthorizeAgentProfileWorkContinuation: (input: {
        continuationClientMessageId: string;
        currentAgentControllerRef: string;
        currentBindingId: string;
        currentConfigurationRevision: number;
        expectedInterruptedTargetWakeLifecycleId: string;
        ownerUserId: string;
        requireAcceptedExecutionTargetRevision: true;
        targetProfileId: string;
      }) => Promise<unknown>;
      rpcMarkAgentProfileWorkUsageAvailable: (input: {
        ownerUserId: string;
        targetProfileIds: string[];
      }) => Promise<unknown>;
    };
    await expect(
      recoveryHub.rpcMarkAgentProfileWorkUsageAvailable({
        ownerUserId: "owner-1",
        targetProfileIds: [TARGET_AGENT_PROFILE_ID],
      })
    ).resolves.toMatchObject({
      continuationProfileIds: [TARGET_AGENT_PROFILE_ID],
      status: "updated",
    });
    const pendingAdmission = storageRecords.get(admissionKey) as {
      recoveryGate: AgentProfileWorkRecoveryGate;
      workItems: AgentProfileWorkCoordinatorItem[];
    };
    const interruptedTargetWakeLifecycleId =
      pendingAdmission.recoveryGate.interruptedWork.targetWakeLifecycleId;
    if (continuationStatus === "continuation_authorized") {
      await expect(
        recoveryHub.rpcAuthorizeAgentProfileWorkContinuation({
          continuationClientMessageId: "client-message-authorized-continuation",
          currentAgentControllerRef: "builtin:codex",
          currentBindingId: "binding-1",
          currentConfigurationRevision: 1,
          expectedInterruptedTargetWakeLifecycleId:
            interruptedTargetWakeLifecycleId,
          ownerUserId: "owner-1",
          requireAcceptedExecutionTargetRevision: true,
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        })
      ).resolves.toEqual({ status: "authorized" });
    }
    expect(storageRecords.get(admissionKey)).toMatchObject({
      recoveryGate: { status: continuationStatus },
    });
    const redriveCount = spaceFetchRequests.length;
    const mutationHub = hub as unknown as {
      rpcAcquireAgentProfileControllerMutation: (input: {
        operationId: string;
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<unknown>;
      rpcReleaseAgentProfileControllerMutation: (input: {
        operationId: string;
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<unknown>;
    };
    const mutation = {
      operationId: `change-execution-target-${continuationStatus}`,
      ownerUserId: "owner-1",
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    };

    await expect(
      mutationHub.rpcAcquireAgentProfileControllerMutation(mutation)
    ).resolves.toMatchObject({ status: "acquired" });
    expect(storageRecords.get(admissionKey)).toMatchObject({
      recoveryGate: {
        interruptedWork: {
          targetWakeLifecycleId: interruptedTargetWakeLifecycleId,
        },
        status: "continuation_needs_attention",
      },
      workItems: pendingAdmission.workItems,
    });
    expect(
      [...storageRecords.values()].filter(
        (value) =>
          parseAgentProfileWorkRecoveryInboxProjectionIntent(value) !== null
      )
    ).toHaveLength(1);
    expect(spaceFetchRequests).toHaveLength(redriveCount);
    await expect(
      mutationHub.rpcReleaseAgentProfileControllerMutation(mutation)
    ).resolves.toEqual({ status: "released" });
  });

  it("moves Usage recovery to Needs attention when the accepted configuration changed", async () => {
    const { hub, sentFrames, socket, state, storageRecords } = createHarness();
    const publishAgentReadinessInvalidated = vi.fn();
    (
      hub as unknown as {
        publishAgentReadinessInvalidated: (input: {
          profileIds: readonly string[];
          reason: string;
        }) => void;
      }
    ).publishAgentReadinessInvalidated = publishAgentReadinessInvalidated;
    const { admissionKey } = await prepareRunningContinuationWithQueuedWork({
      hub,
      profileConfigurationRevision: 1,
      queuedWorkName: "changed-configuration-successor",
      sentFrames,
      socket,
      state,
      storageRecords,
    });
    const admission = storageRecords.get(admissionKey) as {
      recoveryGate: AgentProfileWorkRecoveryGate;
      revision: number;
    };
    const interruptedTargetWakeLifecycleId =
      admission.recoveryGate.interruptedWork.targetWakeLifecycleId;
    storageRecords.set(admissionKey, {
      ...admission,
      recoveryGate: {
        ...admission.recoveryGate,
        status: "continuation_pending",
      },
      revision: admission.revision + 1,
    });

    await expect(
      (
        hub as unknown as {
          rpcAuthorizeAgentProfileWorkContinuation: (input: {
            continuationClientMessageId: string;
            currentAgentControllerRef: string;
            currentBindingId: string;
            currentConfigurationRevision: number;
            expectedInterruptedTargetWakeLifecycleId: string;
            ownerUserId: string;
            requireAcceptedExecutionTargetRevision: true;
            targetProfileId: string;
          }) => Promise<unknown>;
        }
      ).rpcAuthorizeAgentProfileWorkContinuation({
        continuationClientMessageId: "client-message-changed-configuration",
        currentAgentControllerRef: "builtin:codex",
        currentBindingId: "binding-1",
        currentConfigurationRevision: 2,
        expectedInterruptedTargetWakeLifecycleId:
          interruptedTargetWakeLifecycleId,
        ownerUserId: "owner-1",
        requireAcceptedExecutionTargetRevision: true,
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toEqual({ status: "needs_attention" });
    expect(storageRecords.get(admissionKey)).toMatchObject({
      recoveryGate: {
        continuationClientMessageId: null,
        interruptedWork: {
          targetWakeLifecycleId: interruptedTargetWakeLifecycleId,
        },
        status: "continuation_needs_attention",
      },
    });
    expect(
      storageRecords.get(
        buildAgentProfileWorkRecoveryInboxProjectionStorageKey(
          TARGET_AGENT_PROFILE_ID
        )
      )
    ).toMatchObject({
      desiredStatus: "open",
      stage: "review_interrupted_work",
      targetWakeLifecycleId: interruptedTargetWakeLifecycleId,
    });
    expect(publishAgentReadinessInvalidated).toHaveBeenCalledWith({
      profileIds: [TARGET_AGENT_PROFILE_ID],
      reason: "agent_profile_work_coordinator.changed",
    });
  });

  it("keeps a stopped Usage continuation terminal and holds queued work for owner approval", async () => {
    const { hub, recordingD1, sentFrames, socket, state, storageRecords } =
      createHarness();
    const { admissionKey, authority } =
      await prepareRunningContinuationWithQueuedWork({
        hub,
        queuedWorkName: "stopped-continuation",
        sentFrames,
        socket,
        state,
        storageRecords,
      });

    await (
      hub as unknown as {
        writeRuntimeCoordinatorTokenAuthority: (
          nextAuthority: RuntimeCoordinatorExecutionTokenAuthorityRecord
        ) => Promise<void>;
      }
    ).writeRuntimeCoordinatorTokenAuthority({
      ...authority,
      terminalOutcome: {
        finalizedAtMs: Date.now(),
        reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
        replySignalId: null,
        status: "cancelled",
      },
    });

    expect(storageRecords.get(admissionKey)).toMatchObject({
      recoveryGate: { status: "awaiting_owner_approval" },
      workItems: [
        expect.objectContaining({
          dispatchId: "dispatch-stopped-continuation",
        }),
      ],
    });
    await expect(
      (
        hub as unknown as {
          rpcMarkAgentProfileWorkUsageAvailable: (input: {
            ownerUserId: string;
            targetProfileIds: string[];
          }) => Promise<unknown>;
        }
      ).rpcMarkAgentProfileWorkUsageAvailable({
        ownerUserId: "owner-1",
        targetProfileIds: [TARGET_AGENT_PROFILE_ID],
      })
    ).resolves.toEqual({
      changedProfileIds: [],
      continuationProfileIds: [],
      status: "updated",
    });

    await (hub as unknown as { alarm: () => Promise<void> }).alarm();
    expect([...recordingD1.interactionInboxRows.values()]).toEqual([
      expect.objectContaining({
        attention: "action_required",
        resolution_status: "open",
        source_kind: "agent_profile_work_recovery",
      }),
    ]);
  });

  it("bounds recovery Inbox projection work per housekeeping alarm", async () => {
    const { hub, recordingD1, storageRecords } = createHarness();
    await acceptDefaultRuntimeCoordinatorHead(hub);
    const baseIdentity =
      buildRuntimeCoordinatorHeadAcceptRequest().targetWakeLifecycleIdentity;
    const baseHead = storageRecords.get(
      buildRuntimeCoordinatorHeadLifecycleStorageKey(
        baseIdentity.targetWakeLifecycleId
      )
    ) as RuntimeCoordinatorHeadLifecycleRecord;
    const projectionKeys: string[] = [];

    for (let index = 0; index < 9; index += 1) {
      const targetProfileId = `agt_${(index + 20)
        .toString(16)
        .padStart(8, "0")}-3333-4333-8333-${(index + 20)
        .toString(16)
        .padStart(12, "0")}`;
      const dispatchId = `dispatch-recovery-housekeeping-${index}`;
      const identity = projectTargetWakeLifecycleIdentity({
        clientMessageId: `client-message-recovery-housekeeping-${index}`,
        dispatchId,
        sourceSignalId: `signal-recovery-housekeeping-${index}`,
        spaceId: String(index + 1).repeat(64),
        targetProfileId,
      });
      storageRecords.set(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          identity.targetWakeLifecycleId
        ),
        {
          ...baseHead,
          primaryDispatchId: dispatchId,
          primaryIdempotencyKey: `idempotency-recovery-housekeeping-${index}`,
          targetWakeLifecycleId: identity.targetWakeLifecycleId,
          targetWakeLifecycleIdentity: identity,
        }
      );
      const projectionKey =
        buildAgentProfileWorkRecoveryInboxProjectionStorageKey(targetProfileId);
      projectionKeys.push(projectionKey);
      storageRecords.set(
        projectionKey,
        buildAgentProfileWorkRecoveryInboxProjectionIntent({
          desiredStatus: "open",
          occurredAtMs: 1_700_000_000_000 + index,
          stage: "approve_queued_work",
          targetProfileId,
          targetWakeLifecycleId: identity.targetWakeLifecycleId,
          updatedAtMs: 1_700_000_000_000 + index,
        })
      );
    }

    await (hub as unknown as { alarm: () => Promise<void> }).alarm();
    expect(recordingD1.interactionInboxRows.size).toBe(8);
    expect(
      projectionKeys.filter((key) => storageRecords.has(key))
    ).toHaveLength(1);

    await (hub as unknown as { alarm: () => Promise<void> }).alarm();
    expect(recordingD1.interactionInboxRows.size).toBe(9);
    expect(
      projectionKeys.filter((key) => storageRecords.has(key))
    ).toHaveLength(0);
  });

  it("parks broken recovery projections without starving later Inbox work", async () => {
    const { hub, recordingD1, storageRecords } = createHarness();
    await acceptDefaultRuntimeCoordinatorHead(hub);
    const baseIdentity =
      buildRuntimeCoordinatorHeadAcceptRequest().targetWakeLifecycleIdentity;
    const baseHead = storageRecords.get(
      buildRuntimeCoordinatorHeadLifecycleStorageKey(
        baseIdentity.targetWakeLifecycleId
      )
    ) as RuntimeCoordinatorHeadLifecycleRecord;
    const projectionKeys: string[] = [];

    for (let index = 0; index < 9; index += 1) {
      const targetProfileId = `agt_${(index + 40)
        .toString(16)
        .padStart(8, "0")}-3333-4333-8333-${(index + 40)
        .toString(16)
        .padStart(12, "0")}`;
      const dispatchId = `dispatch-recovery-starvation-${index}`;
      const identity = projectTargetWakeLifecycleIdentity({
        clientMessageId: `client-message-recovery-starvation-${index}`,
        dispatchId,
        sourceSignalId: `signal-recovery-starvation-${index}`,
        spaceId: String(index + 1).repeat(64),
        targetProfileId,
      });
      if (index === 8) {
        storageRecords.set(
          buildRuntimeCoordinatorHeadLifecycleStorageKey(
            identity.targetWakeLifecycleId
          ),
          {
            ...baseHead,
            primaryDispatchId: dispatchId,
            primaryIdempotencyKey: `idempotency-recovery-starvation-${index}`,
            targetWakeLifecycleId: identity.targetWakeLifecycleId,
            targetWakeLifecycleIdentity: identity,
          }
        );
      }
      const projectionKey =
        buildAgentProfileWorkRecoveryInboxProjectionStorageKey(targetProfileId);
      projectionKeys.push(projectionKey);
      storageRecords.set(
        projectionKey,
        buildAgentProfileWorkRecoveryInboxProjectionIntent({
          desiredStatus: "open",
          occurredAtMs: 1_700_000_100_000 + index,
          stage: "approve_queued_work",
          targetProfileId,
          targetWakeLifecycleId: identity.targetWakeLifecycleId,
          updatedAtMs: 1_700_000_100_000 + index,
        })
      );
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await (hub as unknown as { alarm: () => Promise<void> }).alarm();
    }
    expect(recordingD1.interactionInboxRows.size).toBe(0);
    expect(
      [...storageRecords.values()].filter((value) =>
        parseAgentProfileWorkRecoveryInboxProjectionIntent(value)
      )
    ).toHaveLength(9);

    await (hub as unknown as { alarm: () => Promise<void> }).alarm();
    expect(recordingD1.interactionInboxRows.size).toBe(1);
    expect(
      [...storageRecords.values()].filter((value) =>
        parseAgentProfileWorkRecoveryInboxProjectionIntent(value)
      )
    ).toHaveLength(8);
  });

  it("retries a parked recovery Inbox projection after transient failures", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    try {
      const { hub, recordingD1, storageRecords } = createHarness({
        interactionInboxWriteFailures: 3,
      });
      await acceptDefaultRuntimeCoordinatorHead(hub);
      const identity =
        buildRuntimeCoordinatorHeadAcceptRequest().targetWakeLifecycleIdentity;
      storageRecords.set(
        buildAgentProfileWorkRecoveryInboxProjectionStorageKey(
          TARGET_AGENT_PROFILE_ID
        ),
        buildAgentProfileWorkRecoveryInboxProjectionIntent({
          desiredStatus: "open",
          occurredAtMs: Date.now(),
          stage: "review_interrupted_work",
          targetProfileId: TARGET_AGENT_PROFILE_ID,
          targetWakeLifecycleId: identity.targetWakeLifecycleId,
          updatedAtMs: Date.now(),
        })
      );

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await (hub as unknown as { alarm: () => Promise<void> }).alarm();
      }
      expect(recordingD1.interactionInboxRows.size).toBe(0);
      expect(
        [...storageRecords.values()].filter((value) =>
          parseAgentProfileWorkRecoveryInboxProjectionIntent(value)
        )
      ).toHaveLength(1);
      expect(
        [...storageRecords.keys()].some((key) =>
          key.includes(
            "agent-profile-work-recovery-inbox-projection-parked-pointer"
          )
        )
      ).toBe(true);

      vi.setSystemTime(1_700_000_060_001);
      await (hub as unknown as { alarm: () => Promise<void> }).alarm();

      expect([...recordingD1.interactionInboxRows.values()]).toEqual([
        expect.objectContaining({
          resolution_status: "open",
          source_kind: "agent_profile_work_recovery",
        }),
      ]);
      expect(
        [...storageRecords.values()].filter((value) =>
          parseAgentProfileWorkRecoveryInboxProjectionIntent(value)
        )
      ).toHaveLength(0);
      expect(
        [...storageRecords.keys()].some((key) =>
          key.includes(
            "agent-profile-work-recovery-inbox-projection-parked-pointer"
          )
        )
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("eventually resolves parked recovery Inbox work and retires its old head", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    try {
      const { hub, recordingD1, sentFrames, socket, state, storageRecords } =
        createHarness({ interactionInboxResolveFailures: 3 });
      const { admissionKey, authority } =
        await prepareRunningContinuationWithQueuedWork({
          hub,
          queuedWorkName: "parked-resolution",
          sentFrames,
          socket,
          state,
          storageRecords,
        });
      await (
        hub as unknown as {
          writeRuntimeCoordinatorTokenAuthority: (
            nextAuthority: RuntimeCoordinatorExecutionTokenAuthorityRecord
          ) => Promise<void>;
        }
      ).writeRuntimeCoordinatorTokenAuthority({
        ...authority,
        terminalOutcome: {
          finalizedAtMs: Date.now(),
          reasonCode: "space.reply_published",
          replySignalId: "signal-parked-resolution-final",
          status: "reply_published",
        },
      });
      const admission = storageRecords.get(admissionKey) as {
        recoveryGate: AgentProfileWorkRecoveryGate;
      };
      const interruptedTargetWakeLifecycleId =
        admission.recoveryGate.interruptedWork.targetWakeLifecycleId;
      const interruptedHeadKey = buildRuntimeCoordinatorHeadLifecycleStorageKey(
        interruptedTargetWakeLifecycleId
      );

      await (hub as unknown as { alarm: () => Promise<void> }).alarm();
      expect([...recordingD1.interactionInboxRows.values()]).toEqual([
        expect.objectContaining({ resolution_status: "open" }),
      ]);

      await expect(
        (
          hub as unknown as {
            rpcApproveAgentProfileWorkQueue: (input: {
              ownerUserId: string;
              targetProfileId: string;
            }) => Promise<unknown>;
          }
        ).rpcApproveAgentProfileWorkQueue({
          ownerUserId: "owner-1",
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        })
      ).resolves.toEqual({ status: "approved" });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await (hub as unknown as { alarm: () => Promise<void> }).alarm();
      }
      expect([...recordingD1.interactionInboxRows.values()]).toEqual([
        expect.objectContaining({ resolution_status: "open" }),
      ]);
      expect(storageRecords.has(interruptedHeadKey)).toBe(true);
      expect(
        [...storageRecords.values()].filter((value) =>
          parseAgentProfileWorkRecoveryInboxProjectionIntent(value)
        )
      ).toHaveLength(1);

      vi.setSystemTime(1_700_000_060_001);
      await (hub as unknown as { alarm: () => Promise<void> }).alarm();

      expect([...recordingD1.interactionInboxRows.values()]).toEqual([
        expect.objectContaining({ resolution_status: "resolved" }),
      ]);
      expect(storageRecords.has(interruptedHeadKey)).toBe(false);
      expect(
        [...storageRecords.values()].filter((value) =>
          parseAgentProfileWorkRecoveryInboxProjectionIntent(value)
        )
      ).toHaveLength(0);
      expect(
        [...storageRecords.keys()].some((key) =>
          key.includes(
            "agent-profile-work-recovery-inbox-projection-parked-pointer"
          )
        )
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("repairs queued-work Inbox projection without rolling back Coordinator truth", async () => {
    const {
      hub,
      recordingD1,
      sentFrames,
      socket,
      state,
      storageRecords,
      storageTransaction,
    } = createHarness({
      interactionInboxResolveFailures: 1,
      interactionInboxWriteFailures: 1,
    });
    const { admissionKey, authority } =
      await prepareRunningContinuationWithQueuedWork({
        hub,
        queuedWorkName: "recovery-retry",
        sentFrames,
        socket,
        state,
        storageRecords,
      });
    const terminalAuthority = {
      ...authority,
      terminalOutcome: {
        finalizedAtMs: Date.now(),
        reasonCode: "completed",
        replySignalId: "signal-recovery-retry-final",
        status: "reply_published" as const,
      },
    } satisfies RuntimeCoordinatorExecutionTokenAuthorityRecord;
    const authorityWriter = hub as unknown as {
      writeRuntimeCoordinatorTokenAuthority: (
        nextAuthority: RuntimeCoordinatorExecutionTokenAuthorityRecord
      ) => Promise<void>;
    };

    await expect(
      authorityWriter.writeRuntimeCoordinatorTokenAuthority(terminalAuthority)
    ).resolves.toBeUndefined();
    expect(storageRecords.get(admissionKey)).toMatchObject({
      recoveryGate: { status: "awaiting_owner_approval" },
    });
    expect([...recordingD1.interactionInboxRows.values()]).toEqual([]);

    await (hub as unknown as { alarm: () => Promise<void> }).alarm();
    expect([...recordingD1.interactionInboxRows.values()]).toEqual([]);

    await (hub as unknown as { alarm: () => Promise<void> }).alarm();
    expect([...recordingD1.interactionInboxRows.values()]).toEqual([
      expect.objectContaining({ resolution_status: "open" }),
    ]);

    await expect(
      (
        hub as unknown as {
          rpcApproveAgentProfileWorkQueue: (input: {
            ownerUserId: string;
            targetProfileId: string;
          }) => Promise<unknown>;
        }
      ).rpcApproveAgentProfileWorkQueue({
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toEqual({ status: "approved" });
    expect(storageRecords.get(admissionKey)).toMatchObject({
      recoveryGate: null,
      workItems: [
        expect.objectContaining({ dispatchId: "dispatch-recovery-retry" }),
      ],
    });
    expect([...recordingD1.interactionInboxRows.values()]).toEqual([
      expect.objectContaining({ resolution_status: "open" }),
    ]);

    await expect(
      (
        hub as unknown as {
          rpcReadAgentProfileExecutionState: (input: {
            ownerUserId: string;
            targetProfileId: string;
          }) => Promise<unknown>;
        }
      ).rpcReadAgentProfileExecutionState({
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toEqual({ status: "active" });
    expect([...recordingD1.interactionInboxRows.values()]).toEqual([
      expect.objectContaining({ resolution_status: "open" }),
    ]);

    const recoveryProjectionKey =
      buildAgentProfileWorkRecoveryInboxProjectionStorageKey(
        TARGET_AGENT_PROFILE_ID
      );
    const resolvedIntent = storageRecords.get(recoveryProjectionKey) as {
      targetWakeLifecycleId: string;
    };
    const interruptedHeadKey = buildRuntimeCoordinatorHeadLifecycleStorageKey(
      resolvedIntent.targetWakeLifecycleId
    );
    await (hub as unknown as { alarm: () => Promise<void> }).alarm();
    expect([...recordingD1.interactionInboxRows.values()]).toEqual([
      expect.objectContaining({ resolution_status: "open" }),
    ]);
    expect(storageRecords.has(recoveryProjectionKey)).toBe(true);
    expect(storageRecords.has(interruptedHeadKey)).toBe(true);

    storageTransaction.mockRejectedValueOnce(
      new Error("recovery projection transaction unavailable")
    );
    await (hub as unknown as { alarm: () => Promise<void> }).alarm();
    expect([...recordingD1.interactionInboxRows.values()]).toEqual([
      expect.objectContaining({ resolution_status: "resolved" }),
    ]);
    expect(storageRecords.has(recoveryProjectionKey)).toBe(true);
    expect(storageRecords.has(interruptedHeadKey)).toBe(true);

    await (hub as unknown as { alarm: () => Promise<void> }).alarm();
    expect(storageRecords.has(recoveryProjectionKey)).toBe(false);
    expect(storageRecords.has(interruptedHeadKey)).toBe(false);
  });

  it("atomically approves and redrives queued work after the interrupted continuation succeeds", async () => {
    const { hub, spaceFetchRequests, storageRecords } = createHarness();
    const queuedIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-recovery-approved",
      dispatchId: "dispatch-recovery-approved",
      sourceSignalId: "signal-recovery-approved",
      spaceId: "b".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    await acceptDefaultRuntimeCoordinatorHead(hub);
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest({
        dispatchId: "dispatch-recovery-approved",
        idempotencyKey: "idempotency-recovery-approved",
        targetWakeLifecycleIdentity: queuedIdentity,
      })
    );
    await (
      hub as unknown as {
        rpcReadAgentProfileExecutionState: (input: {
          ownerUserId: string;
          targetProfileId: string;
        }) => Promise<unknown>;
      }
    ).rpcReadAgentProfileExecutionState({
      ownerUserId: "owner-1",
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });

    const admissionKey =
      runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
        TARGET_AGENT_PROFILE_ID
      );
    const admission = storageRecords.get(admissionKey) as {
      activeHeadLifecycleIds: string[];
      recoveryGate: unknown;
      revision: number;
      updatedAtMs: number;
      workItems: Array<{
        dispatchId: string;
        enqueuedAtMs: number;
        targetWakeLifecycleId: string;
      }>;
    };
    const interruptedWork = admission.workItems[0];
    const queuedWork = admission.workItems[1];
    if (!(interruptedWork && queuedWork)) {
      throw new Error("Expected interrupted and queued work fixtures.");
    }
    storageRecords.set(admissionKey, {
      ...admission,
      activeHeadLifecycleIds: [],
      recoveryGate: {
        continuationClientMessageId: null,
        interruptedWork,
        status: "awaiting_owner_approval",
        updatedAtMs: Date.now(),
      },
      revision: admission.revision + 1,
      updatedAtMs: Date.now(),
      workItems: [queuedWork],
    });

    await expect(
      (
        hub as unknown as {
          rpcApproveAgentProfileWorkQueue: (input: {
            ownerUserId: string;
            targetProfileId: string;
          }) => Promise<unknown>;
        }
      ).rpcApproveAgentProfileWorkQueue({
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toEqual({ status: "approved" });
    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          queuedIdentity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({ status: "accepted" });
    expect(spaceFetchRequests).toContainEqual({
      body: {
        reason: "agent_profile_work_coordinator_promotion",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        targetWakeLifecycleId: queuedIdentity.targetWakeLifecycleId,
      },
      path: "/internal/dispatches/dispatch-recovery-approved/redrive",
    });
    await (hub as unknown as { alarm: () => Promise<void> }).alarm();
    expect(
      storageRecords.has(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          interruptedWork.targetWakeLifecycleId
        )
      )
    ).toBe(false);
  });

  it("promotes the next accepted head after no-execution and never pops it again on terminal replay", async () => {
    const { hub, spaceFetchRequests, storageRecords } = createHarness();
    const firstIdentity =
      buildRuntimeCoordinatorHeadAcceptRequest().targetWakeLifecycleIdentity;
    const secondIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-no-execution-2",
      dispatchId: "dispatch-no-execution-2",
      sourceSignalId: "signal-no-execution-2",
      spaceId: "b".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    const thirdIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-no-execution-3",
      dispatchId: "dispatch-no-execution-3",
      sourceSignalId: "signal-no-execution-3",
      spaceId: "c".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });

    await acceptDefaultRuntimeCoordinatorHead(hub);
    for (const [dispatchId, identity] of [
      ["dispatch-no-execution-2", secondIdentity],
      ["dispatch-no-execution-3", thirdIdentity],
    ] as const) {
      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/accept",
        buildRuntimeCoordinatorHeadAcceptRequest({
          dispatchId,
          idempotencyKey: `idempotency-${dispatchId}`,
          targetWakeLifecycleIdentity: identity,
        })
      );
    }

    const noExecutionRequest = buildRuntimeCoordinatorHeadNoExecutionRequest({
      targetWakeLifecycleIdentity: firstIdentity,
    });
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/no-execution",
      noExecutionRequest
    );

    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          secondIdentity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({ status: "accepted" });
    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          thirdIdentity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({ status: "queued" });
    expect(spaceFetchRequests).toContainEqual({
      body: {
        reason: "agent_profile_work_coordinator_promotion",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        targetWakeLifecycleId: secondIdentity.targetWakeLifecycleId,
      },
      path: "/internal/dispatches/dispatch-no-execution-2/redrive",
    });

    const promotionRedriveCount = spaceFetchRequests.filter(
      (request) =>
        request.path === "/internal/dispatches/dispatch-no-execution-2/redrive"
    ).length;
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/no-execution",
      noExecutionRequest
    );
    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          secondIdentity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({ status: "accepted" });
    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          thirdIdentity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({ status: "queued" });
    expect(
      spaceFetchRequests.filter(
        (request) =>
          request.path ===
          "/internal/dispatches/dispatch-no-execution-2/redrive"
      )
    ).toHaveLength(promotionRedriveCount);
  });

  it("removes the inactive Coordinator snapshot after final publication is visible", async () => {
    const { hub, storageRecords } = createHarness();
    const identity =
      buildRuntimeCoordinatorHeadAcceptRequest().targetWakeLifecycleIdentity;
    const admissionKey =
      runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
        TARGET_AGENT_PROFILE_ID
      );
    const headKey = buildRuntimeCoordinatorHeadLifecycleStorageKey(
      identity.targetWakeLifecycleId
    );

    await acceptDefaultRuntimeCoordinatorHead(hub);
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/no-execution",
      buildRuntimeCoordinatorHeadNoExecutionRequest({
        targetWakeLifecycleIdentity: identity,
      })
    );

    expect(storageRecords.has(admissionKey)).toBe(false);
    expect(storageRecords.get(headKey)).toMatchObject({
      publicationOutcome: { status: "failure_published" },
      status: "publication_intent_ready",
    });
    expect(
      storageRecords.get(RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY)
    ).not.toContain(identity.targetWakeLifecycleId);
  });

  it("removes the completed execution head and empty Coordinator snapshot", async () => {
    const { hub, sentFrames, socket, state, storageRecords } = createHarness();
    await issueDeliveryToken({ hub, sentFrames, socket, state });
    const authority =
      findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords);
    expect(authority).toBeDefined();
    const identity =
      buildRuntimeCoordinatorHeadAcceptRequest().targetWakeLifecycleIdentity;

    await (
      hub as unknown as {
        writeRuntimeCoordinatorTokenAuthority: (
          nextAuthority: RuntimeCoordinatorExecutionTokenAuthorityRecord
        ) => Promise<void>;
      }
    ).writeRuntimeCoordinatorTokenAuthority({
      ...(authority as RuntimeCoordinatorExecutionTokenAuthorityRecord),
      terminalOutcome: {
        finalizedAtMs: Date.now(),
        reasonCode: "space.reply_published",
        replySignalId: "signal-terminal-cleanup",
        status: "reply_published",
      },
    });

    expect(
      storageRecords.has(
        runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
          TARGET_AGENT_PROFILE_ID
        )
      )
    ).toBe(false);
    expect(
      storageRecords.has(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          identity.targetWakeLifecycleId
        )
      )
    ).toBe(false);
    expect(
      storageRecords.get(RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY)
    ).not.toContain(identity.targetWakeLifecycleId);
  });

  it("never admits an exact head replay after its execution reached a visible terminal outcome", async () => {
    const { hub, socket, state, storageRecords } = createHarness();
    configureCompatibleRoute({ socket, state });
    const acceptRequest = buildRuntimeCoordinatorHeadAcceptRequest();
    const identity = acceptRequest.targetWakeLifecycleIdentity;
    const runtimeCoordinatorExecutionId = buildRuntimeCoordinatorExecutionId({
      dispatchId: acceptRequest.dispatchId,
      spaceId: identity.spaceId,
      targetProfileId: identity.targetProfileId,
    });
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      acceptRequest
    );
    const deliveryResponse = await (
      hub as unknown as {
        handleDeliverDispatchRequest: (request: Request) => Promise<Response>;
      }
    ).handleDeliverDispatchRequest(
      new Request("https://runtime-transport.test/deliver-dispatch", {
        body: JSON.stringify(
          buildDeliverRequest({ runtimeCoordinatorExecutionId })
        ),
        method: "POST",
      })
    );
    expect(deliveryResponse.status).toBe(200);
    const authority =
      findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords);
    expect(authority?.runtimeCoordinatorExecutionId).toBe(
      runtimeCoordinatorExecutionId
    );

    await (
      hub as unknown as {
        writeRuntimeCoordinatorTokenAuthority: (
          nextAuthority: RuntimeCoordinatorExecutionTokenAuthorityRecord
        ) => Promise<void>;
      }
    ).writeRuntimeCoordinatorTokenAuthority({
      ...(authority as RuntimeCoordinatorExecutionTokenAuthorityRecord),
      terminalOutcome: {
        finalizedAtMs: Date.now(),
        reasonCode: "space.reply_published",
        replySignalId: "signal-terminal-replay-proof",
        status: "reply_published",
      },
    });
    expect(
      storageRecords.has(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          identity.targetWakeLifecycleId
        )
      )
    ).toBe(false);

    const replayResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      acceptRequest
    );

    expect(replayResponse.status).toBe(200);
    await expect(replayResponse.json()).resolves.toMatchObject({
      action: "skip_duplicate",
      ok: true,
      primaryDispatchId: acceptRequest.dispatchId,
      runtimeCoordinatorExecutionId,
      status: "execution_linked",
    });
    expect(
      storageRecords.has(
        runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
          TARGET_AGENT_PROFILE_ID
        )
      )
    ).toBe(false);
    expect(
      storageRecords.has(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          identity.targetWakeLifecycleId
        )
      )
    ).toBe(false);
  });

  it("retains terminal head current state while final publication still needs repair", async () => {
    const { hub, spaceStub, storageRecords } = createHarness();
    const identity =
      buildRuntimeCoordinatorHeadAcceptRequest().targetWakeLifecycleIdentity;
    const headKey = buildRuntimeCoordinatorHeadLifecycleStorageKey(
      identity.targetWakeLifecycleId
    );
    spaceStub.rpcApplyRuntimeCoordinatorFailurePublicationCommand.mockResolvedValueOnce(
      {
        failurePublicationCommandId: `rcfp:${identity.targetWakeLifecycleId}`,
        finalMessageKind: null,
        ok: false,
        publicationErrorCode: "space.unavailable",
        publishedSignalId: null,
        status: "failure_publication_failed",
      }
    );

    await acceptDefaultRuntimeCoordinatorHead(hub);
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/no-execution",
      buildRuntimeCoordinatorHeadNoExecutionRequest({
        targetWakeLifecycleIdentity: identity,
      })
    );

    expect(storageRecords.get(headKey)).toMatchObject({
      publicationOutcome: { status: "failure_publication_failed" },
      status: "publication_intent_ready",
    });
  });

  it("removes a queued Stop without disturbing running work or promoting another queued Wake", async () => {
    const { hub, spaceFetchRequests, storageRecords } = createHarness();
    const secondIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-stop-2",
      dispatchId: "dispatch-stop-2",
      sourceSignalId: "signal-stop-2",
      spaceId: "b".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    const thirdIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-stop-3",
      dispatchId: "dispatch-stop-3",
      sourceSignalId: "signal-stop-3",
      spaceId: "c".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    await acceptDefaultRuntimeCoordinatorHead(hub);
    for (const [dispatchId, identity] of [
      ["dispatch-stop-2", secondIdentity],
      ["dispatch-stop-3", thirdIdentity],
    ] as const) {
      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/accept",
        buildRuntimeCoordinatorHeadAcceptRequest({
          dispatchId,
          idempotencyKey: `idempotency-${dispatchId}`,
          targetWakeLifecycleIdentity: identity,
        })
      );
    }

    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/pre-agent-stop",
      buildRuntimeCoordinatorHeadPreAgentStopRequest({
        dispatchId: "dispatch-stop-2",
        idempotencyKey: "idempotency-dispatch-stop-2",
        targetWakeLifecycleIdentity: secondIdentity,
      })
    );

    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          buildRuntimeCoordinatorHeadAcceptRequest().targetWakeLifecycleIdentity
            .targetWakeLifecycleId
        )
      )
    ).toMatchObject({ status: "accepted" });
    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          secondIdentity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({ status: "stopped_before_execution" });
    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          thirdIdentity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({ status: "queued" });
    expect(
      spaceFetchRequests.filter((request) =>
        request.path.startsWith("/internal/dispatches/")
      )
    ).toHaveLength(0);
  });

  it("settles a pre-link stopped continuation and keeps its successor behind owner approval", async () => {
    const { hub, spaceFetchRequests, storageRecords } = createHarness();
    const continuationIdentity =
      buildRuntimeCoordinatorHeadAcceptRequest().targetWakeLifecycleIdentity;
    const successorIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-pre-link-stopped-successor",
      dispatchId: "dispatch-pre-link-stopped-successor",
      sourceSignalId: "signal-pre-link-stopped-successor",
      spaceId: "b".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    await acceptDefaultRuntimeCoordinatorHead(hub);
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest({
        dispatchId: "dispatch-pre-link-stopped-successor",
        idempotencyKey: "idempotency-pre-link-stopped-successor",
        targetWakeLifecycleIdentity: successorIdentity,
      })
    );
    const admissionKey =
      runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
        TARGET_AGENT_PROFILE_ID
      );
    const admission = storageRecords.get(admissionKey) as {
      recoveryGate: unknown;
      revision: number;
      updatedAtMs: number;
      workItems: Array<{
        dispatchId: string;
        enqueuedAtMs: number;
        targetWakeLifecycleId: string;
      }>;
    };
    const continuationWork = admission.workItems[0];
    if (!continuationWork) {
      throw new Error("Expected the pre-link continuation work.");
    }
    storageRecords.set(admissionKey, {
      ...admission,
      recoveryGate: {
        continuationClientMessageId: null,
        interruptedWork: continuationWork,
        status: "continuation_running",
        updatedAtMs: Date.now(),
      },
      revision: admission.revision + 1,
      updatedAtMs: Date.now(),
    });

    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/pre-agent-stop",
      buildRuntimeCoordinatorHeadPreAgentStopRequest({
        targetWakeLifecycleIdentity: continuationIdentity,
      })
    );

    expect(storageRecords.get(admissionKey)).toMatchObject({
      recoveryGate: { status: "awaiting_owner_approval" },
      workItems: [
        expect.objectContaining({
          dispatchId: "dispatch-pre-link-stopped-successor",
        }),
      ],
    });
    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          successorIdentity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({ status: "queued" });
    expect(
      spaceFetchRequests.filter((request) =>
        request.path.startsWith("/internal/dispatches/")
      )
    ).toHaveLength(0);
    expect(
      storageRecords.get(
        buildAgentProfileWorkRecoveryInboxProjectionStorageKey(
          TARGET_AGENT_PROFILE_ID
        )
      )
    ).toMatchObject({ desiredStatus: "open" });
  });

  it("clears recovery when a pre-link stopped continuation has no successor", async () => {
    const { hub, storageRecords } = createHarness();
    const continuationIdentity =
      buildRuntimeCoordinatorHeadAcceptRequest().targetWakeLifecycleIdentity;
    await acceptDefaultRuntimeCoordinatorHead(hub);
    const admissionKey =
      runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
        TARGET_AGENT_PROFILE_ID
      );
    const admission = storageRecords.get(admissionKey) as {
      recoveryGate: unknown;
      revision: number;
      updatedAtMs: number;
      workItems: Array<{
        dispatchId: string;
        enqueuedAtMs: number;
        targetWakeLifecycleId: string;
      }>;
    };
    const continuationWork = admission.workItems[0];
    if (!continuationWork) {
      throw new Error("Expected the pre-link continuation work.");
    }
    storageRecords.set(admissionKey, {
      ...admission,
      recoveryGate: {
        continuationClientMessageId: null,
        interruptedWork: continuationWork,
        status: "continuation_running",
        updatedAtMs: Date.now(),
      },
      revision: admission.revision + 1,
      updatedAtMs: Date.now(),
    });

    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/pre-agent-stop",
      buildRuntimeCoordinatorHeadPreAgentStopRequest({
        targetWakeLifecycleIdentity: continuationIdentity,
      })
    );

    expect(storageRecords.has(admissionKey)).toBe(false);
    expect(
      storageRecords.has(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          continuationIdentity.targetWakeLifecycleId
        )
      )
    ).toBe(false);
    expect(
      storageRecords.has(
        buildAgentProfileWorkRecoveryInboxProjectionStorageKey(
          TARGET_AGENT_PROFILE_ID
        )
      )
    ).toBe(false);
  });

  it("keeps Q2 paused when Q1 is stopped behind owner approval", async () => {
    const {
      hub,
      sentFrames,
      socket,
      spaceFetchRequests,
      state,
      storageRecords,
    } = createHarness();
    const { admissionKey, queuedIdentities } =
      await prepareAwaitingOwnerApprovalWorkQueue({
        hub,
        queuedWorkNames: ["stop-paused-q1", "stop-paused-q2"],
        sentFrames,
        socket,
        state,
        storageRecords,
      });
    const [q1Identity, q2Identity] = queuedIdentities;
    if (!(q1Identity && q2Identity)) {
      throw new Error("Expected Q1 and Q2 identities.");
    }
    const redriveCount = spaceFetchRequests.filter((request) =>
      request.path.startsWith("/internal/dispatches/")
    ).length;

    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/pre-agent-stop",
      buildRuntimeCoordinatorHeadPreAgentStopRequest({
        dispatchId: "dispatch-stop-paused-q1",
        idempotencyKey: "idempotency-stop-paused-q1",
        targetWakeLifecycleIdentity: q1Identity,
      })
    );

    expect(storageRecords.get(admissionKey)).toMatchObject({
      recoveryGate: { status: "awaiting_owner_approval" },
      workItems: [
        expect.objectContaining({ dispatchId: "dispatch-stop-paused-q2" }),
      ],
    });
    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          q2Identity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({ status: "queued" });
    expect(
      spaceFetchRequests.filter((request) =>
        request.path.startsWith("/internal/dispatches/")
      )
    ).toHaveLength(redriveCount);
  });

  it("keeps Q1 paused when Q2 is stopped behind owner approval", async () => {
    const { hub, sentFrames, socket, state, storageRecords } = createHarness();
    const { admissionKey, queuedIdentities } =
      await prepareAwaitingOwnerApprovalWorkQueue({
        hub,
        queuedWorkNames: ["keep-paused-q1", "stop-paused-later-q2"],
        sentFrames,
        socket,
        state,
        storageRecords,
      });
    const [q1Identity, q2Identity] = queuedIdentities;
    if (!(q1Identity && q2Identity)) {
      throw new Error("Expected Q1 and Q2 identities.");
    }

    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/pre-agent-stop",
      buildRuntimeCoordinatorHeadPreAgentStopRequest({
        dispatchId: "dispatch-stop-paused-later-q2",
        idempotencyKey: "idempotency-stop-paused-later-q2",
        targetWakeLifecycleIdentity: q2Identity,
      })
    );

    expect(storageRecords.get(admissionKey)).toMatchObject({
      recoveryGate: { status: "awaiting_owner_approval" },
      workItems: [
        expect.objectContaining({ dispatchId: "dispatch-keep-paused-q1" }),
      ],
    });
    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          q1Identity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({ status: "queued" });
  });

  it("clears owner approval and records resolved Inbox intent when its last Q1 is stopped", async () => {
    const { hub, sentFrames, socket, state, storageRecords } = createHarness();
    const { admissionKey, interruptedTargetWakeLifecycleId, queuedIdentities } =
      await prepareAwaitingOwnerApprovalWorkQueue({
        hub,
        queuedWorkNames: ["stop-last-paused-q1"],
        sentFrames,
        socket,
        state,
        storageRecords,
      });
    const [q1Identity] = queuedIdentities;
    if (!q1Identity) {
      throw new Error("Expected the last Q1 identity.");
    }

    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/pre-agent-stop",
      buildRuntimeCoordinatorHeadPreAgentStopRequest({
        dispatchId: "dispatch-stop-last-paused-q1",
        idempotencyKey: "idempotency-stop-last-paused-q1",
        targetWakeLifecycleIdentity: q1Identity,
      })
    );

    expect(storageRecords.has(admissionKey)).toBe(false);
    expect(
      storageRecords.get(
        buildAgentProfileWorkRecoveryInboxProjectionStorageKey(
          TARGET_AGENT_PROFILE_ID
        )
      )
    ).toMatchObject({
      desiredStatus: "resolved",
      targetWakeLifecycleId: interruptedTargetWakeLifecycleId,
    });
  });

  it("promotes after the running head is stopped before execution and stays idempotent on replay", async () => {
    const { hub, spaceFetchRequests, storageRecords } = createHarness();
    const successorIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-stopped-successor",
      dispatchId: "dispatch-stopped-successor",
      sourceSignalId: "signal-stopped-successor",
      spaceId: "b".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    await acceptDefaultRuntimeCoordinatorHead(hub);
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest({
        dispatchId: "dispatch-stopped-successor",
        idempotencyKey: "idempotency-stopped-successor",
        targetWakeLifecycleIdentity: successorIdentity,
      })
    );

    const stopRequest = buildRuntimeCoordinatorHeadPreAgentStopRequest();
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/pre-agent-stop",
      stopRequest
    );
    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          successorIdentity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({ status: "accepted" });
    expect(spaceFetchRequests).toContainEqual({
      body: {
        reason: "agent_profile_work_coordinator_promotion",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        targetWakeLifecycleId: successorIdentity.targetWakeLifecycleId,
      },
      path: "/internal/dispatches/dispatch-stopped-successor/redrive",
    });

    const redriveCount = spaceFetchRequests.length;
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/pre-agent-stop",
      stopRequest
    );
    expect(spaceFetchRequests).toHaveLength(redriveCount);
  });

  it("keeps the FIFO successor queued while the running head is waiting", async () => {
    const { hub, spaceFetchRequests, storageRecords } = createHarness();
    const successorIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-waiting-successor",
      dispatchId: "dispatch-waiting-successor",
      sourceSignalId: "signal-waiting-successor",
      spaceId: "b".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    await acceptDefaultRuntimeCoordinatorHead(hub);
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest({
        dispatchId: "dispatch-waiting-successor",
        idempotencyKey: "idempotency-waiting-successor",
        targetWakeLifecycleIdentity: successorIdentity,
      })
    );

    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/waiting",
      buildRuntimeCoordinatorHeadWaitingRequest()
    );

    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          buildRuntimeCoordinatorHeadWaitingRequest()
            .targetWakeLifecycleIdentity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({ status: "waiting" });
    expect(
      storageRecords.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          successorIdentity.targetWakeLifecycleId
        )
      )
    ).toMatchObject({ status: "queued" });
    expect(
      spaceFetchRequests.filter((request) =>
        request.path.startsWith("/internal/dispatches/")
      )
    ).toHaveLength(0);
  });

  it("keeps a failed immediate promotion redrive durable for bounded alarm recovery", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    try {
      const { hub, spaceFetchRequests, spaceStub, storageRecords } =
        createHarness();
      const successorIdentity = projectTargetWakeLifecycleIdentity({
        clientMessageId: "client-message-recovery-2",
        dispatchId: "dispatch-recovery-2",
        sourceSignalId: "signal-recovery-2",
        spaceId: "b".repeat(64),
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      });
      await acceptDefaultRuntimeCoordinatorHead(hub);
      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/accept",
        buildRuntimeCoordinatorHeadAcceptRequest({
          dispatchId: "dispatch-recovery-2",
          idempotencyKey: "idempotency-recovery-2",
          targetWakeLifecycleIdentity: successorIdentity,
        })
      );
      spaceStub.fetch.mockRejectedValueOnce(
        new Error("promotion redrive unavailable")
      );

      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/no-execution",
        buildRuntimeCoordinatorHeadNoExecutionRequest()
      );

      const pendingPromotionKey =
        runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.pendingPromotion(
          TARGET_AGENT_PROFILE_ID
        );
      const pendingPromotion = storageRecords.get(pendingPromotionKey);
      expect(pendingPromotion).toMatchObject({
        attemptCount: 1,
        dispatchId: "dispatch-recovery-2",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        targetWakeLifecycleId: successorIdentity.targetWakeLifecycleId,
      });
      expect(
        Object.keys(pendingPromotion as Record<string, unknown>).sort()
      ).toEqual([
        "attemptCount",
        "createdAtMs",
        "dispatchId",
        "modelVersion",
        "nextAttemptAtMs",
        "targetProfileId",
        "targetWakeLifecycleId",
      ]);

      vi.setSystemTime(1_700_000_001_001);
      await (hub as unknown as { alarm: () => Promise<void> }).alarm();

      expect(storageRecords.has(pendingPromotionKey)).toBe(false);
      expect(
        spaceFetchRequests.filter(
          (request) =>
            request.path === "/internal/dispatches/dispatch-recovery-2/redrive"
        )
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps retry-scheduled promotion redrive durable until Space accepts it", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    try {
      const { hub, storageRecords } = createHarness({
        promotionRedriveStatus: "retry_scheduled",
      });
      const successorIdentity = projectTargetWakeLifecycleIdentity({
        clientMessageId: "client-message-retry-scheduled-2",
        dispatchId: "dispatch-retry-scheduled-2",
        sourceSignalId: "signal-retry-scheduled-2",
        spaceId: "b".repeat(64),
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      });
      await acceptDefaultRuntimeCoordinatorHead(hub);
      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/accept",
        buildRuntimeCoordinatorHeadAcceptRequest({
          dispatchId: "dispatch-retry-scheduled-2",
          idempotencyKey: "idempotency-retry-scheduled-2",
          targetWakeLifecycleIdentity: successorIdentity,
        })
      );

      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/no-execution",
        buildRuntimeCoordinatorHeadNoExecutionRequest()
      );

      expect(
        storageRecords.get(
          runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.pendingPromotion(
            TARGET_AGENT_PROFILE_ID
          )
        )
      ).toMatchObject({
        attemptCount: 1,
        dispatchId: "dispatch-retry-scheduled-2",
        targetWakeLifecycleId: successorIdentity.targetWakeLifecycleId,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not report inactive when the legacy head index is missing an active Wake", async () => {
    const { hub, storageRecords } = createHarness();
    await acceptDefaultRuntimeCoordinatorHead(hub);
    storageRecords.delete(RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY);

    await expect(
      (
        hub as unknown as {
          rpcReadAgentProfileExecutionState: (input: {
            ownerUserId: string;
            targetProfileId: string;
          }) => Promise<unknown>;
        }
      ).rpcReadAgentProfileExecutionState({
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toEqual({ status: "active" });
  });

  it("projects one Profile's current and queued work without exposing locations unless requested", async () => {
    const { hub } = createHarness();
    const queuedIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-operational-context-2",
      dispatchId: "dispatch-operational-context-2",
      sourceSignalId: "signal-operational-context-2",
      spaceId: "b".repeat(64),
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    await acceptDefaultRuntimeCoordinatorHead(hub);
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest({
        dispatchId: "dispatch-operational-context-2",
        idempotencyKey: "idempotency-operational-context-2",
        targetWakeLifecycleIdentity: queuedIdentity,
      })
    );
    const operationalContextHub = hub as unknown as {
      rpcReadAgentProfileOperationalContexts: (input: {
        includeWorkReferences: boolean;
        ownerUserId: string;
        targetProfileIds: string[];
      }) => Promise<unknown>;
    };

    await expect(
      operationalContextHub.rpcReadAgentProfileOperationalContexts({
        includeWorkReferences: false,
        ownerUserId: "owner-1",
        targetProfileIds: [TARGET_AGENT_PROFILE_ID],
      })
    ).resolves.toEqual({
      contexts: [
        {
          operationalContext: { status: "working", waitingCount: 1 },
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        },
      ],
    });

    await expect(
      operationalContextHub.rpcReadAgentProfileOperationalContexts({
        includeWorkReferences: true,
        ownerUserId: "owner-1",
        targetProfileIds: [TARGET_AGENT_PROFILE_ID],
      })
    ).resolves.toEqual({
      contexts: [
        {
          operationalContext: {
            currentWorkReference: {
              sourceSignalId: "signal-1",
              spaceId: HEX_SPACE_ID,
            },
            queuedWorkReferences: [
              {
                sourceSignalId: "signal-operational-context-2",
                spaceId: "b".repeat(64),
              },
            ],
            status: "working",
            waitingCount: 1,
          },
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        },
      ],
    });
  });

  it("reads owner work references in Cloudflare-safe batches across Profiles", async () => {
    const {
      getMaxConcurrentArrayStorageGets,
      hub,
      resetArrayStorageGetConcurrency,
      setMaxStorageGetKeys,
      storageGet,
      storageRecords,
    } = createHarness();
    const targetProfileIds = Array.from({ length: 100 }, (_, index) =>
      index === 0
        ? TARGET_AGENT_PROFILE_ID
        : `agt_${(index + 1).toString(16).padStart(8, "0")}-2222-4222-8222-${(
            index + 1
          )
            .toString(16)
            .padStart(12, "0")}`
    );

    for (let workIndex = 0; workIndex <= 50; workIndex += 1) {
      const dispatchId = `dispatch-batched-context-0-${workIndex}`;
      const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
        clientMessageId: `client-message-batched-context-0-${workIndex}`,
        dispatchId,
        sourceSignalId: `signal-batched-context-0-${workIndex}`,
        spaceId: "1".repeat(64),
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      });
      const response = await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/accept",
        buildRuntimeCoordinatorHeadAcceptRequest({
          dispatchId,
          idempotencyKey: `idempotency-batched-context-0-${workIndex}`,
          targetWakeLifecycleIdentity,
        })
      );
      expect(response.status).toBe(200);
    }
    await (
      hub as unknown as {
        rpcReadAgentProfileOperationalContexts: (input: {
          includeWorkReferences: boolean;
          ownerUserId: string;
          targetProfileIds: string[];
        }) => Promise<unknown>;
      }
    ).rpcReadAgentProfileOperationalContexts({
      includeWorkReferences: false,
      ownerUserId: "owner-1",
      targetProfileIds: [TARGET_AGENT_PROFILE_ID],
    });
    await finishExecutionIndexGenerationRepair(hub);
    const sourceAdmissionKey =
      runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
        TARGET_AGENT_PROFILE_ID
      );
    const sourceAdmission = storageRecords.get(sourceAdmissionKey) as {
      activeHeadLifecycleIds: string[];
      generation: number;
      workItems: Array<{
        dispatchId: string;
        enqueuedAtMs: number;
        targetWakeLifecycleId: string;
      }>;
    } & Record<string, unknown>;
    const sourceHeads = sourceAdmission.workItems.map(
      ({ targetWakeLifecycleId }) =>
        storageRecords.get(
          buildRuntimeCoordinatorHeadLifecycleStorageKey(targetWakeLifecycleId)
        ) as RuntimeCoordinatorHeadLifecycleRecord
    );
    for (const [profileIndex, targetProfileId] of targetProfileIds
      .slice(1)
      .entries()) {
      const workItems = sourceAdmission.workItems.map(
        (sourceWork, workIndex) => {
          const suffix = `${profileIndex + 1}-${workIndex}`;
          const dispatchId = `dispatch-batched-context-${suffix}`;
          const targetWakeLifecycleIdentity =
            projectTargetWakeLifecycleIdentity({
              clientMessageId: `client-message-batched-context-${suffix}`,
              dispatchId,
              sourceSignalId: `signal-batched-context-${suffix}`,
              spaceId: String((profileIndex % 9) + 1).repeat(64),
              targetProfileId,
            });
          const sourceHead = sourceHeads[workIndex];
          if (!sourceHead) {
            throw new Error("Expected source work head.");
          }
          storageRecords.set(
            buildRuntimeCoordinatorHeadLifecycleStorageKey(
              targetWakeLifecycleIdentity.targetWakeLifecycleId
            ),
            {
              ...sourceHead,
              primaryDispatchId: dispatchId,
              primaryIdempotencyKey: `idempotency-batched-context-${suffix}`,
              targetWakeLifecycleId:
                targetWakeLifecycleIdentity.targetWakeLifecycleId,
              targetWakeLifecycleIdentity,
            }
          );
          return {
            dispatchId,
            enqueuedAtMs: sourceWork.enqueuedAtMs,
            targetWakeLifecycleId:
              targetWakeLifecycleIdentity.targetWakeLifecycleId,
          };
        }
      );
      storageRecords.set(
        runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
          targetProfileId
        ),
        {
          ...sourceAdmission,
          activeHeadLifecycleIds: [workItems[0]?.targetWakeLifecycleId],
          targetProfileId,
          workItems,
        }
      );
    }
    const activeProfileIndex = storageRecords.get(
      "runtime-coordinator:agent-profile-active-index:v1"
    ) as Record<string, unknown>;
    storageRecords.set("runtime-coordinator:agent-profile-active-index:v1", {
      ...activeProfileIndex,
      targetProfileIds,
    });
    setMaxStorageGetKeys(128);
    resetArrayStorageGetConcurrency();

    const operationalContextHub = hub as unknown as {
      rpcReadAgentProfileOperationalContexts: (input: {
        includeWorkReferences: boolean;
        ownerUserId: string;
        targetProfileIds: string[];
      }) => Promise<{
        contexts: Array<{
          operationalContext: {
            currentWorkReference?: { sourceSignalId: string };
            queuedWorkReferences?: Array<{ sourceSignalId: string }>;
            status: string;
            waitingCount?: number;
          };
          targetProfileId: string;
        }>;
      }>;
    };
    const result =
      await operationalContextHub.rpcReadAgentProfileOperationalContexts({
        includeWorkReferences: true,
        ownerUserId: "owner-1",
        targetProfileIds,
      });

    expect(
      result.contexts.map(({ targetProfileId }) => targetProfileId)
    ).toEqual(targetProfileIds);
    expect(result.contexts).toHaveLength(100);
    expect(
      result.contexts.every(
        ({ operationalContext }) =>
          operationalContext.status === "working" &&
          operationalContext.waitingCount === 50 &&
          operationalContext.queuedWorkReferences?.length === 50
      )
    ).toBe(true);
    expect(result.contexts[0]?.operationalContext).toMatchObject({
      currentWorkReference: { sourceSignalId: "signal-batched-context-0-0" },
    });
    expect(
      storageGet.mock.calls
        .map(([key]) => (Array.isArray(key) ? key.length : 1))
        .every((keyCount) => keyCount <= 128)
    ).toBe(true);
    expect(getMaxConcurrentArrayStorageGets()).toBeLessThanOrEqual(4);
  });

  it("preserves recovery-only work across an execution-index generation repair", async () => {
    const { hub, socket, state, storageRecords } = createHarness({
      agentProfileRow: {
        managed_role: null,
        organization_id: "org-one",
        owner_user_id: "owner-1",
        profile_kind: "agent",
        profile_name: "Codex Agent",
      },
    });
    configureCompatibleRoute({ socket, state });
    await acceptDefaultRuntimeCoordinatorHead(hub);
    const deliveryResponse = await (
      hub as unknown as {
        handleDeliverDispatchRequest: (request: Request) => Promise<Response>;
      }
    ).handleDeliverDispatchRequest(
      new Request("https://runtime-transport.test/deliver-dispatch", {
        body: JSON.stringify(buildDeliverRequest()),
        method: "POST",
      })
    );
    expect(deliveryResponse.status).toBe(200);

    const authority =
      findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords);
    expect(authority).toBeDefined();
    await (
      hub as unknown as {
        writeRuntimeCoordinatorTokenAuthority: (
          authority: RuntimeCoordinatorExecutionTokenAuthorityRecord
        ) => Promise<void>;
      }
    ).writeRuntimeCoordinatorTokenAuthority({
      ...(authority as RuntimeCoordinatorExecutionTokenAuthorityRecord),
      terminalOutcome: {
        finalizedAtMs: Date.now(),
        reasonCode: "usage_exhausted",
        replySignalId: null,
        status: "failed_terminal",
      },
    });

    const admissionKey =
      runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
        TARGET_AGENT_PROFILE_ID
      );
    expect(storageRecords.get(admissionKey)).toMatchObject({
      recoveryGate: {
        continuationClientMessageId: null,
        status: "awaiting_usage",
      },
      workItems: [],
    });

    beginExecutionIndexGenerationRepair(storageRecords);
    await finishExecutionIndexGenerationRepair(hub);
    expect(
      storageRecords.get("runtime-coordinator:agent-profile-active-index:v1")
    ).toMatchObject({ targetProfileIds: [TARGET_AGENT_PROFILE_ID] });

    const recoveryHub = hub as unknown as {
      rpcMarkAgentProfileWorkUsageAvailable: (input: {
        ownerUserId: string;
        targetProfileIds: string[];
      }) => Promise<unknown>;
      rpcReadAgentProfileOperationalContexts: (input: {
        includeWorkReferences: boolean;
        ownerUserId: string;
        targetProfileIds: string[];
      }) => Promise<unknown>;
      rpcReadAgentProfileWorkRecovery: (input: {
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<unknown>;
    };
    await expect(
      recoveryHub.rpcMarkAgentProfileWorkUsageAvailable({
        ownerUserId: "owner-1",
        targetProfileIds: [TARGET_AGENT_PROFILE_ID],
      })
    ).resolves.toEqual({
      changedProfileIds: [TARGET_AGENT_PROFILE_ID],
      continuationProfileIds: [TARGET_AGENT_PROFILE_ID],
      status: "updated",
    });
    await expect(
      recoveryHub.rpcReadAgentProfileWorkRecovery({
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toEqual({
      action: "continue_interrupted_work",
      authorizedContinuationClientMessageId: null,
      interruptedClientMessageId: "client-message-1",
      interruptedDispatchId: "dispatch-1",
      interruptedSourceSignalId: "signal-1",
      interruptedTargetWakeLifecycleId:
        buildRuntimeCoordinatorHeadAcceptRequest().targetWakeLifecycleIdentity
          .targetWakeLifecycleId,
      spaceId: HEX_SPACE_ID,
      status: "available",
    });
    await expect(
      recoveryHub.rpcReadAgentProfileOperationalContexts({
        includeWorkReferences: true,
        ownerUserId: "owner-1",
        targetProfileIds: [TARGET_AGENT_PROFILE_ID],
      })
    ).resolves.toEqual({
      contexts: [
        {
          operationalContext: {
            queuedWorkReferences: [],
            recoveryAction: "continue_interrupted_work",
            recoveryTargetWakeLifecycleId:
              buildRuntimeCoordinatorHeadAcceptRequest()
                .targetWakeLifecycleIdentity.targetWakeLifecycleId,
            status: "paused",
            waitingCount: 0,
          },
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        },
      ],
    });
  });

  it("rebuilds a stale active-profile projection from canonical execution truth", async () => {
    const { hub, storageRecords } = createHarness();
    storageRecords.set("runtime-coordinator:agent-profile-active-index:v1", [
      TARGET_AGENT_PROFILE_ID,
    ]);

    await expect(
      (
        hub as unknown as {
          rpcReadAgentProfileExecutionState: (input: {
            ownerUserId: string;
            targetProfileId: string;
          }) => Promise<unknown>;
        }
      ).rpcReadAgentProfileExecutionState({
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toEqual({ status: "inactive" });
  });

  it("repairs a ready execution index that loses its per-profile admission", async () => {
    const { hub, storageRecords } = createHarness();
    await acceptDefaultRuntimeCoordinatorHead(hub);
    const executionStateHub = hub as unknown as {
      rpcReadAgentProfileExecutionState: (input: {
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<unknown>;
    };
    const request = {
      ownerUserId: "owner-1",
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    };
    await expect(
      executionStateHub.rpcReadAgentProfileExecutionState(request)
    ).resolves.toEqual({ status: "active" });

    const admissionKey = [...storageRecords.keys()].find((key) =>
      key.startsWith(
        "runtime-coordinator:agent-profile-execution-admission:v1:"
      )
    );
    expect(admissionKey).toBeDefined();
    storageRecords.delete(admissionKey as string);

    await expect(
      executionStateHub.rpcReadAgentProfileExecutionState(request)
    ).resolves.toEqual({
      reasonCode: "runtime_coordinator.execution_state_rebuilding",
      status: "unavailable",
    });

    await (hub as unknown as { alarm: () => Promise<void> }).alarm();
    await expect(
      executionStateHub.rpcReadAgentProfileExecutionState(request)
    ).resolves.toEqual({ status: "active" });
  });

  it("deletes a legacy inactive Coordinator snapshot during bounded index repair", async () => {
    const { hub, storageRecords } = createHarness();
    const admissionKey =
      runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
        TARGET_AGENT_PROFILE_ID
      );
    await acceptDefaultRuntimeCoordinatorHead(hub);
    const activeAdmission = storageRecords.get(admissionKey) as Record<
      string,
      unknown
    >;
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/no-execution",
      buildRuntimeCoordinatorHeadNoExecutionRequest()
    );
    expect(storageRecords.has(admissionKey)).toBe(false);

    storageRecords.set(admissionKey, {
      ...activeAdmission,
      activeExecutionIds: [],
      activeHeadLifecycleIds: [],
      executionTargetMutation: null,
      recoveryGate: null,
      referencesOverflowed: false,
      workItems: [],
    });
    beginExecutionIndexGenerationRepair(storageRecords);
    await finishExecutionIndexGenerationRepair(hub);

    expect(storageRecords.has(admissionKey)).toBe(false);
  });

  it("bounds execution-state repair work instead of reading the full owner history", async () => {
    const { hub, storageGet, storageList, storageRecords } = createHarness();
    const historyIds: string[] = [];
    for (let index = 0; index < 512; index += 1) {
      const dispatchId = `history-dispatch-${String(index).padStart(4, "0")}`;
      const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
        clientMessageId: `history-client-message-${index}`,
        dispatchId,
        sourceSignalId: `history-signal-${index}`,
        spaceId: HEX_SPACE_ID,
        targetProfileId: "agt_22222222-2222-4222-8222-222222222222",
      });
      const record: RuntimeCoordinatorHeadLifecycleRecord = {
        createdAtMs: index,
        duplicateDispatches: [],
        executionLinkedAtMs: null,
        modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
        ownerUserId: "owner-1",
        primaryDispatchId: dispatchId,
        primaryIdempotencyKey: `history-idempotency-${index}`,
        runtimeCoordinatorExecutionId: null,
        status: "publication_intent_ready",
        targetWakeLifecycleId:
          targetWakeLifecycleIdentity.targetWakeLifecycleId,
        targetWakeLifecycleIdentity,
        updatedAtMs: index,
      };
      historyIds.push(record.targetWakeLifecycleId);
      storageRecords.set(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          record.targetWakeLifecycleId
        ),
        record
      );
    }
    storageRecords.set(
      RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY,
      historyIds
    );
    storageGet.mockClear();

    const executionStateHub = hub as unknown as {
      rpcReadAgentProfileExecutionState: (input: {
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<unknown>;
    };
    const readExecutionState = () =>
      executionStateHub.rpcReadAgentProfileExecutionState({
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      });

    await expect(readExecutionState()).resolves.toMatchObject({
      status: "unavailable",
    });
    expect(storageGet.mock.calls.length).toBeLessThan(32);

    for (let step = 0; step < 4; step += 1) {
      await (hub as unknown as { alarm: () => Promise<void> }).alarm();
    }
    await expect(readExecutionState()).resolves.toEqual({
      status: "inactive",
    });

    storageList.mockClear();
    await expect(readExecutionState()).resolves.toEqual({
      status: "inactive",
    });
    expect(storageList).not.toHaveBeenCalled();
  });

  it("keeps a Wake that starts during index repair active after the repair completes", async () => {
    const { hub, storageRecords } = createHarness();
    for (let index = 0; index < 256; index += 1) {
      const dispatchId = `repair-race-history-${String(index).padStart(4, "0")}`;
      const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
        clientMessageId: `repair-race-client-message-${index}`,
        dispatchId,
        sourceSignalId: `repair-race-signal-${index}`,
        spaceId: HEX_SPACE_ID,
        targetProfileId: "agt_22222222-2222-4222-8222-222222222222",
      });
      const record: RuntimeCoordinatorHeadLifecycleRecord = {
        createdAtMs: index,
        duplicateDispatches: [],
        executionLinkedAtMs: null,
        modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
        ownerUserId: "owner-1",
        primaryDispatchId: dispatchId,
        primaryIdempotencyKey: `repair-race-idempotency-${index}`,
        runtimeCoordinatorExecutionId: null,
        status: "publication_intent_ready",
        targetWakeLifecycleId:
          targetWakeLifecycleIdentity.targetWakeLifecycleId,
        targetWakeLifecycleIdentity,
        updatedAtMs: index,
      };
      storageRecords.set(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          record.targetWakeLifecycleId
        ),
        record
      );
    }

    const executionStateHub = hub as unknown as {
      rpcReadAgentProfileExecutionState: (input: {
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<unknown>;
    };
    await expect(
      executionStateHub.rpcReadAgentProfileExecutionState({
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toMatchObject({ status: "unavailable" });

    const acceptedDuringRepair = await acceptDefaultRuntimeCoordinatorHead(hub);
    expect(acceptedDuringRepair.status).toBe(200);

    await expect(
      executionStateHub.rpcReadAgentProfileExecutionState({
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toEqual({ status: "active" });
  });

  it("retries a transient index repair failure instead of locking normal changes forever", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    try {
      const { hub, storageList } = createHarness();
      storageList.mockRejectedValueOnce(new Error("transient storage failure"));
      const executionStateHub = hub as unknown as {
        rpcReadAgentProfileExecutionState: (input: {
          ownerUserId: string;
          targetProfileId: string;
        }) => Promise<unknown>;
      };
      const readExecutionState = () =>
        executionStateHub.rpcReadAgentProfileExecutionState({
          ownerUserId: "owner-1",
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        });

      await expect(readExecutionState()).resolves.toEqual({
        reasonCode: "runtime_coordinator.execution_state_repair_failed",
        status: "unavailable",
      });

      vi.setSystemTime(1_700_000_005_001);
      await expect(readExecutionState()).resolves.toEqual({
        status: "inactive",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("backs off and recovers when applying an index repair page fails", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    try {
      const { hub, storagePut, storageRecords } = createHarness();
      await acceptDefaultRuntimeCoordinatorHead(hub);
      await expect(
        (
          hub as unknown as {
            rpcReadAgentProfileExecutionState: (input: {
              ownerUserId: string;
              targetProfileId: string;
            }) => Promise<unknown>;
          }
        ).rpcReadAgentProfileExecutionState({
          ownerUserId: "owner-1",
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        })
      ).resolves.toEqual({ status: "active" });

      const readyIndex = storageRecords.get(
        "runtime-coordinator:agent-profile-execution-index:v1"
      ) as { generation: number; modelVersion: string; ownerUserId: string };
      storageRecords.set(
        "runtime-coordinator:agent-profile-execution-index:v1",
        {
          cursor: null,
          failureCount: 0,
          generation: readyIndex.generation + 1,
          modelVersion: readyIndex.modelVersion,
          ownerUserId: readyIndex.ownerUserId,
          phase: "head_lifecycles",
          repairRequested: true,
          status: "rebuilding",
          updatedAtMs: Date.now(),
        }
      );
      storageRecords.set("runtime-coordinator:agent-profile-active-index:v1", {
        generation: readyIndex.generation + 1,
        modelVersion:
          "openmeld.runtime_coordinator.agent_profile_active_index.v1",
        targetProfileIds: [],
      });
      const originalStoragePut = storagePut.getMockImplementation();
      expect(originalStoragePut).toBeDefined();
      let shouldFailRepairApply = true;
      storagePut.mockImplementation((key: string, value: unknown) => {
        if (
          shouldFailRepairApply &&
          key.startsWith(
            "runtime-coordinator:agent-profile-execution-admission:v1:"
          )
        ) {
          shouldFailRepairApply = false;
          return Promise.reject(new Error("repair page apply unavailable"));
        }
        return originalStoragePut?.(key, value) ?? Promise.resolve();
      });

      const readExecutionState = () =>
        (
          hub as unknown as {
            rpcReadAgentProfileExecutionState: (input: {
              ownerUserId: string;
              targetProfileId: string;
            }) => Promise<unknown>;
          }
        ).rpcReadAgentProfileExecutionState({
          ownerUserId: "owner-1",
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        });
      await expect(readExecutionState()).resolves.toEqual({
        reasonCode: "runtime_coordinator.execution_state_repair_failed",
        status: "unavailable",
      });

      vi.setSystemTime(1_700_000_005_001);
      await expect(readExecutionState()).resolves.toEqual({ status: "active" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps per-profile execution references within the fifty-item waiting limit", async () => {
    const { hub, storageRecords } = createHarness();
    for (let index = 0; index < 51; index += 1) {
      const dispatchId = `bounded-dispatch-${index}`;
      const response = await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/accept",
        buildRuntimeCoordinatorHeadAcceptRequest({
          dispatchId,
          idempotencyKey: `bounded-idempotency-${index}`,
          targetWakeLifecycleIdentity: projectTargetWakeLifecycleIdentity({
            clientMessageId: `bounded-client-message-${index}`,
            dispatchId,
            sourceSignalId: `bounded-signal-${index}`,
            spaceId: HEX_SPACE_ID,
            targetProfileId: TARGET_AGENT_PROFILE_ID,
          }),
        })
      );
      expect(response.status).toBe(200);
    }

    const rejectedDispatchId = "bounded-dispatch-51";
    const rejected = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest({
        dispatchId: rejectedDispatchId,
        idempotencyKey: "bounded-idempotency-51",
        targetWakeLifecycleIdentity: projectTargetWakeLifecycleIdentity({
          clientMessageId: "bounded-client-message-51",
          dispatchId: rejectedDispatchId,
          sourceSignalId: "bounded-signal-51",
          spaceId: HEX_SPACE_ID,
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        }),
      })
    );
    expect(rejected.status).toBe(503);
    await expect(rejected.json()).resolves.toMatchObject({
      ok: false,
      reasonCode: "agent_profile_work_coordinator.queue_full",
      status: "queue_full",
      waitingCount: 50,
    });

    const admission = [...storageRecords.entries()].find(([key]) =>
      key.startsWith(
        "runtime-coordinator:agent-profile-execution-admission:v1:"
      )
    )?.[1] as
      | {
          activeHeadLifecycleIds?: unknown[];
          referencesOverflowed?: boolean;
          workItems?: unknown[];
        }
      | undefined;
    expect(admission?.activeHeadLifecycleIds).toHaveLength(1);
    expect(admission?.workItems).toHaveLength(51);
    expect(admission?.referencesOverflowed).toBe(false);
  });

  it("fails closed without batch-reading corrupted over-limit execution references", async () => {
    const seeded = createHarness();
    await acceptDefaultRuntimeCoordinatorHead(seeded.hub);
    await expect(
      (
        seeded.hub as unknown as {
          rpcReadAgentProfileExecutionState: (input: {
            ownerUserId: string;
            targetProfileId: string;
          }) => Promise<unknown>;
        }
      ).rpcReadAgentProfileExecutionState({
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toEqual({ status: "active" });
    const storageRecords = new Map(seeded.storageRecords);
    const { hub, storageGet } = createHarness({ storageRecords });
    const admissionKey =
      runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
        TARGET_AGENT_PROFILE_ID
      );
    const admission = storageRecords.get(admissionKey);
    expect(admission).toBeDefined();
    storageRecords.set(admissionKey, {
      ...(admission as Record<string, unknown>),
      activeExecutionIds: Array.from(
        { length: 129 },
        (_, index) => `corrupt-execution-${index}`
      ),
      activeHeadLifecycleIds: [],
      referencesOverflowed: false,
    });
    expect(
      (
        storageRecords.get(admissionKey) as {
          activeExecutionIds: string[];
        }
      ).activeExecutionIds
    ).toHaveLength(129);
    storageGet.mockClear();

    await expect(
      (
        hub as unknown as {
          rpcReadAgentProfileExecutionState: (input: {
            ownerUserId: string;
            targetProfileId: string;
          }) => Promise<unknown>;
        }
      ).rpcReadAgentProfileExecutionState({
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toMatchObject({ status: "unavailable" });
    expect(
      storageGet.mock.calls.some(
        ([key]) => Array.isArray(key) && key.length > 128
      )
    ).toBe(false);
  });

  it("serializes Controller mutation admission with new Wake acceptance", async () => {
    const { hub, storageRecords } = createHarness();
    const mutationHub = hub as unknown as {
      rpcAcquireAgentProfileControllerMutation: (input: {
        operationId: string;
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<{
        expiresAtMs?: number;
        operationId?: string;
        status: string;
      }>;
      rpcReleaseAgentProfileControllerMutation: (input: {
        operationId: string;
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<{ status: string }>;
    };

    await expect(
      mutationHub.rpcAcquireAgentProfileControllerMutation({
        operationId: "controller-mutation-1",
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toMatchObject({
      operationId: "controller-mutation-1",
      status: "acquired",
    });

    const blockedAccept = await acceptDefaultRuntimeCoordinatorHead(hub);
    expect(blockedAccept.status).toBe(503);
    await expect(blockedAccept.json()).resolves.toMatchObject({
      ok: false,
      reasonCode: "runtime_coordinator.execution_target_mutation_in_progress",
      status: "retry_later",
    });

    await expect(
      mutationHub.rpcReleaseAgentProfileControllerMutation({
        operationId: "controller-mutation-1",
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toEqual({ status: "released" });
    expect(
      storageRecords.has(
        runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys.admission(
          TARGET_AGENT_PROFILE_ID
        )
      )
    ).toBe(false);

    const acceptedAfterRelease = await acceptDefaultRuntimeCoordinatorHead(hub);
    expect(acceptedAfterRelease.status).toBe(200);
    await expect(acceptedAfterRelease.json()).resolves.toMatchObject({
      action: "create_execution",
      ok: true,
      status: "accepted",
    });
  });

  it("allows future-work settings to save while the current Wake keeps its accepted revision", async () => {
    const { hub } = createHarness();
    const acceptedWake = await acceptDefaultRuntimeCoordinatorHead(hub);
    expect(acceptedWake.status).toBe(200);

    const mutationHub = hub as unknown as {
      rpcAcquireAgentProfileFutureWorkSettingsMutation: (input: {
        operationId: string;
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<{ status: string }>;
      rpcReleaseAgentProfileControllerMutation: (input: {
        operationId: string;
        ownerUserId: string;
        targetProfileId: string;
      }) => Promise<{ status: string }>;
    };
    const mutationIdentity = {
      operationId: "future-work-settings-1",
      ownerUserId: "owner-1",
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    };
    await expect(
      mutationHub.rpcAcquireAgentProfileFutureWorkSettingsMutation(
        mutationIdentity
      )
    ).resolves.toMatchObject({ status: "acquired" });

    await expect(
      mutationHub.rpcReleaseAgentProfileControllerMutation(mutationIdentity)
    ).resolves.toEqual({ status: "released" });
  });

  it("rechecks both sides when Wake acceptance and execution-target mutation overlap", async () => {
    const createMutationHub = (hub: RuntimeTransportHub) =>
      hub as unknown as {
        rpcAcquireAgentProfileControllerMutation: (input: {
          operationId: string;
          ownerUserId: string;
          targetProfileId: string;
        }) => Promise<{ status: string }>;
        rpcReadAgentProfileExecutionState: (input: {
          ownerUserId: string;
          targetProfileId: string;
        }) => Promise<unknown>;
      };
    const pauseNextTransaction = (
      storageTransaction: ReturnType<typeof vi.fn>
    ) => {
      const original = storageTransaction.getMockImplementation();
      expect(original).toBeDefined();
      let signalEntered: (() => void) | null = null;
      let signalRelease: (() => void) | null = null;
      const entered = new Promise<void>((resolve) => {
        signalEntered = resolve;
      });
      const release = new Promise<void>((resolve) => {
        signalRelease = resolve;
      });
      storageTransaction.mockImplementationOnce(
        async (
          operation: (transaction: DurableObjectTransaction) => unknown
        ) => {
          signalEntered?.();
          await release;
          return await original?.(operation);
        }
      );
      return {
        entered,
        release: () => signalRelease?.(),
      };
    };
    const executionStateRequest = {
      ownerUserId: "owner-1",
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    };

    const mutationFirst = createHarness();
    const mutationFirstHub = createMutationHub(mutationFirst.hub);
    await expect(
      mutationFirstHub.rpcReadAgentProfileExecutionState(executionStateRequest)
    ).resolves.toEqual({ status: "inactive" });
    const pausedMutation = pauseNextTransaction(
      mutationFirst.storageTransaction
    );
    const mutationPromise =
      mutationFirstHub.rpcAcquireAgentProfileControllerMutation({
        operationId: "overlapping-mutation",
        ...executionStateRequest,
      });
    await pausedMutation.entered;
    const acceptedWake = await acceptDefaultRuntimeCoordinatorHead(
      mutationFirst.hub
    );
    expect(acceptedWake.status).toBe(200);
    pausedMutation.release();
    await expect(mutationPromise).resolves.toMatchObject({ status: "blocked" });

    const wakeFirst = createHarness();
    const wakeFirstHub = createMutationHub(wakeFirst.hub);
    await expect(
      wakeFirstHub.rpcReadAgentProfileExecutionState(executionStateRequest)
    ).resolves.toEqual({ status: "inactive" });
    const pausedWake = pauseNextTransaction(wakeFirst.storageTransaction);
    const wakePromise = acceptDefaultRuntimeCoordinatorHead(wakeFirst.hub);
    await pausedWake.entered;
    await expect(
      wakeFirstHub.rpcAcquireAgentProfileControllerMutation({
        operationId: "overlapping-mutation",
        ...executionStateRequest,
      })
    ).resolves.toMatchObject({ status: "acquired" });
    pausedWake.release();
    const blockedWake = await wakePromise;
    expect(blockedWake.status).toBe(503);
    await expect(blockedWake.json()).resolves.toMatchObject({
      reasonCode: "runtime_coordinator.execution_target_mutation_in_progress",
      status: "retry_later",
    });
  });

  it("lets a new Wake proceed after an abandoned Controller mutation lease expires", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    try {
      const { hub } = createHarness();
      const mutationHub = hub as unknown as {
        rpcAcquireAgentProfileControllerMutation: (input: {
          operationId: string;
          ownerUserId: string;
          targetProfileId: string;
        }) => Promise<{ expiresAtMs?: number; status: string }>;
      };
      await expect(
        mutationHub.rpcAcquireAgentProfileControllerMutation({
          operationId: "abandoned-controller-mutation",
          ownerUserId: "owner-1",
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        })
      ).resolves.toMatchObject({ status: "acquired" });

      vi.setSystemTime(1_700_000_300_001);
      const acceptedAfterExpiry =
        await acceptDefaultRuntimeCoordinatorHead(hub);
      expect(acceptedAfterExpiry.status).toBe(200);
      await expect(acceptedAfterExpiry.json()).resolves.toMatchObject({
        action: "create_execution",
        ok: true,
        status: "accepted",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a new Wake blocked while an unknown working-folder outcome may arrive late", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    try {
      const { hub } = createHarness();
      const mutationHub = hub as unknown as {
        rpcAcquireAgentProfileControllerMutation: (input: {
          operationId: string;
          ownerUserId: string;
          targetProfileId: string;
        }) => Promise<{ status: string }>;
      };
      await expect(
        mutationHub.rpcAcquireAgentProfileControllerMutation({
          operationId: "working-folder-outcome-unknown",
          ownerUserId: "owner-1",
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        })
      ).resolves.toMatchObject({ status: "acquired" });

      const blockedWhileLateResultIsPossible =
        await acceptDefaultRuntimeCoordinatorHead(hub);
      expect(blockedWhileLateResultIsPossible.status).toBe(503);
      await expect(
        blockedWhileLateResultIsPossible.json()
      ).resolves.toMatchObject({
        reasonCode: "runtime_coordinator.execution_target_mutation_in_progress",
        status: "retry_later",
      });

      vi.setSystemTime(1_700_000_300_001);
      const acceptedAfterUnknownOutcomeLease =
        await acceptDefaultRuntimeCoordinatorHead(hub);
      expect(acceptedAfterUnknownOutcomeLease.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records pre-agent Stop before execution without creating execution authority", async () => {
    const { hub, spaceFetchRequests, storageRecords } = createHarness();
    const stopRequest = buildRuntimeCoordinatorHeadPreAgentStopRequest({
      reason: "The Agent Profile was deleted.",
    });

    const stopResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/pre-agent-stop",
      stopRequest
    );

    expect(stopResponse.status).toBe(200);
    await expect(stopResponse.json()).resolves.toMatchObject({
      ok: true,
      primaryDispatchId: "dispatch-1",
      publicationIntentId: expect.stringContaining("rcpi:stopped:"),
      reasonCode: "runtime_coordinator.pre_agent_stop_requested",
      runtimeCoordinatorExecutionId: null,
      status: "stopped_before_execution",
    });

    const headRecord =
      findRuntimeCoordinatorHeadLifecycleRecord(storageRecords);
    expect(headRecord).toMatchObject({
      ownerUserId: "owner-1",
      primaryDispatchId: "dispatch-1",
      publicationIntent: {
        kind: "stopped_notice",
        reasonCode: "runtime_coordinator.pre_agent_stop_requested",
        status: "ready_for_phase_6",
      },
      runtimeCoordinatorExecutionId: null,
      status: "stopped_before_execution",
      stopReason: "The Agent Profile was deleted.",
      targetDisplay: {
        targetProfileMentionLabel: "Codex Agent",
        targetProfileName: "Codex Agent",
      },
    });
    expect(spaceFetchRequests).toContainEqual({
      path: "/rpc/signals/system-notice",
      body: {
        finalOutcomeAuthority: "runtime_coordinator_wake_stop_publication",
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        data: {
          noticeType: "wake_stopped",
          actorProfileId: TARGET_AGENT_PROFILE_ID,
          actorName: "Codex Agent",
          dispatchId: "dispatch-1",
          generatedBy: "openmeld",
          reason: "The Agent Profile was deleted.",
          reasonCode: "runtime_coordinator.pre_agent_stop_requested",
          text: "Wake was stopped for Codex Agent because its Agent Profile was deleted.",
        },
      },
    });
    expect(
      findRuntimeCoordinatorWakeStoppedNoticePublicationRecord(storageRecords)
    ).toMatchObject({
      dispatchId: "dispatch-1",
      publicationId: `wake-stopped:head:${stopRequest.targetWakeLifecycleIdentity.targetWakeLifecycleId}`,
      publishedSignalId: "signal-delivery-expired-1",
      reasonCode: "runtime_coordinator.pre_agent_stop_requested",
      runtimeCoordinatorExecutionId: null,
      status: "published",
      targetProfileId: TARGET_AGENT_PROFILE_ID,
      targetWakeLifecycleId:
        stopRequest.targetWakeLifecycleIdentity.targetWakeLifecycleId,
    });
    expect(
      storageRecords.get(RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY)
    ).not.toContain(
      stopRequest.targetWakeLifecycleIdentity.targetWakeLifecycleId
    );
    await expect(
      classifyPublicationClosureDiagnostics(hub, {
        dispatchId: "dispatch-1",
        publicationKind: "stopped_notice",
        spaceId: HEX_SPACE_ID,
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        targetWakeLifecycleId:
          stopRequest.targetWakeLifecycleIdentity.targetWakeLifecycleId,
      })
    ).resolves.toMatchObject({
      publicationId: `wake-stopped:head:${stopRequest.targetWakeLifecycleIdentity.targetWakeLifecycleId}`,
      publicationKind: "stopped_notice",
      reasonCode: "runtime_coordinator.publication_already_visible",
      status: "already_visible",
    });
  });

  it("keeps late head accept from creating execution after pre-agent Stop", async () => {
    const { hub } = createHarness();
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/pre-agent-stop",
      buildRuntimeCoordinatorHeadPreAgentStopRequest()
    );

    const acceptResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest()
    );

    expect(acceptResponse.status).toBe(200);
    await expect(acceptResponse.json()).resolves.toMatchObject({
      action: "skip_duplicate",
      ok: true,
      primaryDispatchId: "dispatch-1",
      reasonCode: "runtime_coordinator.pre_agent_stop_already_recorded",
      runtimeCoordinatorExecutionId: null,
      status: "stopped_before_execution",
    });
  });

  it("blocks late delivery preparation after pre-agent Stop before issuing execution token state", async () => {
    const { hub, sentFrames, socket, state, storageRecords } = createHarness();
    configureCompatibleRoute({ socket, state });
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/pre-agent-stop",
      buildRuntimeCoordinatorHeadPreAgentStopRequest()
    );

    const deliveryResponse = await (
      hub as unknown as {
        handleDeliverDispatchRequest: (request: Request) => Promise<Response>;
      }
    ).handleDeliverDispatchRequest(
      new Request("https://runtime-transport.test/deliver-dispatch", {
        body: JSON.stringify(buildDeliverRequest()),
        method: "POST",
      })
    );

    expect(deliveryResponse.status).toBe(409);
    await expect(deliveryResponse.json()).resolves.toMatchObject({
      accepted: false,
      reasonCode: "runtime_coordinator.pre_agent_stop_requested",
      status: "rejected",
    });
    expect(sentFrames).toHaveLength(0);
    expect(
      findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords)
    ).toBeUndefined();
    expect(
      findRuntimeCoordinatorRunCommandState(storageRecords)
    ).toBeUndefined();
    expect(
      findRuntimeCoordinatorHeadLifecycleRecord(storageRecords)
    ).toMatchObject({
      runtimeCoordinatorExecutionId: null,
      status: "stopped_before_execution",
    });
  });

  it("records no-execution publication intent for an accepted target Wake head without creating execution authority", async () => {
    const { appliedFailurePublicationCommands, hub, storageRecords } =
      createHarness();
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest()
    );

    const noExecutionResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/no-execution",
      buildRuntimeCoordinatorHeadNoExecutionRequest()
    );

    expect(noExecutionResponse.status).toBe(200);
    await expect(noExecutionResponse.json()).resolves.toMatchObject({
      ok: true,
      primaryDispatchId: "dispatch-1",
      publicationIntentId: expect.stringContaining("rcpi:no_execution:"),
      reasonCode: "agent_profile_binding.missing",
      runtimeCoordinatorExecutionId: null,
      status: "publication_intent_ready",
    });

    const headRecord =
      findRuntimeCoordinatorHeadLifecycleRecord(storageRecords);
    expect(headRecord).toMatchObject({
      noExecutionDecision: {
        reasonCode: "agent_profile_binding.missing",
      },
      ownerUserId: "owner-1",
      primaryDispatchId: "dispatch-1",
      publicationIntent: {
        reasonCode: "agent_profile_binding.missing",
        status: "ready_for_phase_6",
      },
      publicationOutcome: {
        finalMessageKind: "failure_notice",
        publishedSignalId: "signal-head-failure-1",
        status: "failure_published",
      },
      runtimeCoordinatorExecutionId: null,
      status: "publication_intent_ready",
      targetDisplay: {
        targetProfileMentionLabel: "Codex Agent",
        targetProfileName: "Codex Agent",
      },
    });
    expect(headRecord).not.toHaveProperty("openMeldServiceRuntimeId");
    expect(appliedFailurePublicationCommands).toHaveLength(1);
    expect(appliedFailurePublicationCommands[0]).toMatchObject({
      dispatchId: "dispatch-1",
      modelVersion:
        "openmeld.runtime_coordinator.failure_publication_command.v1",
      publicationCategory: "binding_required",
      reasonCode: "agent_profile_binding.missing",
      spaceId: HEX_SPACE_ID,
      targetProfileMentionLabel: "Codex Agent",
      targetProfileId: TARGET_AGENT_PROFILE_ID,
      targetProfileName: "Codex Agent",
      userRecoveryAction: "set_up_agent_binding",
    });

    const duplicateAcceptResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest()
    );
    expect(duplicateAcceptResponse.status).toBe(200);
    await expect(duplicateAcceptResponse.json()).resolves.toMatchObject({
      action: "skip_duplicate",
      ok: true,
      runtimeCoordinatorExecutionId: null,
      status: "publication_intent_ready",
    });
  });

  it("does not publish a second failure notice when a ready no-execution intent is replayed", async () => {
    const { appliedFailurePublicationCommands, hub, storageRecords } =
      createHarness();
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest()
    );
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/no-execution",
      buildRuntimeCoordinatorHeadNoExecutionRequest()
    );

    const replayResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/no-execution",
      buildRuntimeCoordinatorHeadNoExecutionRequest()
    );

    expect(replayResponse.status).toBe(200);
    await expect(replayResponse.json()).resolves.toMatchObject({
      ok: true,
      status: "already_recorded",
    });
    expect(appliedFailurePublicationCommands).toHaveLength(1);
    expect(
      findRuntimeCoordinatorHeadLifecycleRecord(storageRecords)
    ).toMatchObject({
      publicationOutcome: {
        publishedSignalId: "signal-head-failure-1",
        status: "failure_published",
      },
    });
  });

  it("retries a failed head failure publication from RuntimeCoordinator alarm", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        appliedFailurePublicationCommands,
        hub,
        spaceStub,
        storageRecords,
        storageSetAlarm,
        waitUntilTasks,
      } = createHarness();
      let applyCount = 0;
      spaceStub.rpcApplyRuntimeCoordinatorFailurePublicationCommand.mockImplementation(
        (command: RuntimeCoordinatorFailurePublicationCommand) => {
          appliedFailurePublicationCommands.push(command);
          applyCount += 1;
          if (applyCount === 1) {
            return {
              failurePublicationCommandId: command.failurePublicationCommandId,
              finalMessageKind: null,
              ok: false as const,
              publicationErrorCode:
                "runtime_coordinator.failure_publication_unavailable",
              publishedSignalId: null,
              status: "failure_publication_failed" as const,
            };
          }
          return {
            failurePublicationCommandId: command.failurePublicationCommandId,
            finalMessageKind: "failure_notice" as const,
            ok: true as const,
            publicationAction: "created" as const,
            publicationErrorCode: null,
            publishedSignalId: "signal-head-failure-2",
            status: "failure_published" as const,
          };
        }
      );

      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/accept",
        buildRuntimeCoordinatorHeadAcceptRequest()
      );
      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/no-execution",
        buildRuntimeCoordinatorHeadNoExecutionRequest()
      );
      await Promise.all(waitUntilTasks);

      expect(appliedFailurePublicationCommands).toHaveLength(1);
      expect(
        findRuntimeCoordinatorHeadLifecycleRecord(storageRecords)
      ).toMatchObject({
        publicationOutcome: {
          status: "failure_publication_failed",
        },
        publicationRetry: {
          status: "retry_scheduled",
        },
      });
      expect(storageSetAlarm).toHaveBeenCalledWith(1_700_000_005_000);

      nowSpy.mockReturnValue(1_700_000_006_000);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(appliedFailurePublicationCommands).toHaveLength(2);
      expect(
        findRuntimeCoordinatorHeadLifecycleRecord(storageRecords)
      ).toMatchObject({
        publicationOutcome: {
          finalMessageKind: "failure_notice",
          publishedSignalId: "signal-head-failure-2",
          status: "failure_published",
        },
      });
      expect(
        findRuntimeCoordinatorHeadLifecycleRecord(storageRecords)
      ).not.toHaveProperty("publicationRetry");

      nowSpy.mockReturnValue(1_700_000_012_000);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(appliedFailurePublicationCommands).toHaveLength(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("exhausts failed head failure publication retry as unresolved without an execution record", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        appliedFailurePublicationCommands,
        hub,
        spaceStub,
        storageRecords,
        waitUntilTasks,
      } = createHarness();
      spaceStub.rpcApplyRuntimeCoordinatorFailurePublicationCommand.mockImplementation(
        (command: RuntimeCoordinatorFailurePublicationCommand) => {
          appliedFailurePublicationCommands.push(command);
          return {
            failurePublicationCommandId: command.failurePublicationCommandId,
            finalMessageKind: null,
            ok: false as const,
            publicationErrorCode:
              "runtime_coordinator.failure_publication_unavailable",
            publishedSignalId: null,
            status: "failure_publication_failed" as const,
          };
        }
      );
      const acceptRequest = buildRuntimeCoordinatorHeadAcceptRequest();

      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/accept",
        acceptRequest
      );
      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/no-execution",
        buildRuntimeCoordinatorHeadNoExecutionRequest()
      );
      await Promise.all(waitUntilTasks);

      nowSpy.mockReturnValue(1_700_000_601_000);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(appliedFailurePublicationCommands.length).toBeGreaterThanOrEqual(
        1
      );
      expect(
        findRuntimeCoordinatorHeadLifecycleRecord(storageRecords)
      ).toMatchObject({
        publicationExhaustion: {
          reasonCode: "runtime_coordinator.publication_retry_exhausted",
          status: "publication_exhausted",
        },
        runtimeCoordinatorExecutionId: null,
      });
      expect(
        findRuntimeCoordinatorHeadLifecycleRecord(storageRecords)
      ).not.toHaveProperty("publicationRetry");
      expect(
        findRuntimeCoordinatorPublicationBlockerRecord(storageRecords)
      ).toMatchObject({
        blockerKind: "publication_unavailable",
        publicationKind: "failure_notice",
        reasonCode: "runtime_coordinator.publication_retry_exhausted",
        runtimeCoordinatorExecutionId: null,
        status: "unresolved_publication_failure",
        targetWakeLifecycleId:
          acceptRequest.targetWakeLifecycleIdentity.targetWakeLifecycleId,
      });

      const traceResponse = await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/trace",
        {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          targetWakeLifecycleIdentity:
            acceptRequest.targetWakeLifecycleIdentity,
        }
      );

      expect(traceResponse.status).toBe(200);
      await expect(traceResponse.json()).resolves.toMatchObject({
        lifecycle: {
          publicationExhaustion: {
            reasonCode: "runtime_coordinator.publication_retry_exhausted",
            status: "publication_exhausted",
          },
          runtimeCoordinatorExecutionId: null,
        },
        ok: true,
        readStatus: "found",
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("keeps service-offline head waiting under RuntimeCoordinator ownership until the hard deadline", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const { hub, state, storageRecords, storageSetAlarm } = createHarness();
      state.pendingDispatches.clear();
      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/accept",
        buildRuntimeCoordinatorHeadAcceptRequest()
      );

      nowSpy.mockReturnValue(1_700_000_005_000);
      const waitingResponse = await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/waiting",
        buildRuntimeCoordinatorHeadWaitingRequest()
      );

      expect(waitingResponse.status).toBe(200);
      await expect(waitingResponse.json()).resolves.toMatchObject({
        deadlineAtMs: 1_700_000_300_000,
        nextTriggerAtMs: 1_700_000_030_000,
        ok: true,
        reasonCode: "daemon.profile.offline",
        softDeadlineAtMs: 1_700_000_030_000,
        status: "waiting",
      });
      expect(storageSetAlarm).toHaveBeenCalledWith(1_700_000_030_000);
      expect(
        findRuntimeCoordinatorHeadLifecycleRecord(storageRecords)
      ).toMatchObject({
        runtimeCoordinatorExecutionId: null,
        status: "waiting",
        waitingBoundary: {
          deadlineAtMs: 1_700_000_300_000,
          reasonCode: "daemon.profile.offline",
          softDeadlineAtMs: 1_700_000_030_000,
        },
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("keeps a connected Service pending its first route report recoverable until the hard deadline", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        appliedFailurePublicationCommands,
        hub,
        state,
        storageRecords,
        storageSetAlarm,
      } = createHarness();
      state.pendingDispatches.clear();
      const acceptRequest = buildRuntimeCoordinatorHeadAcceptRequest();
      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/accept",
        acceptRequest
      );

      nowSpy.mockReturnValue(1_700_000_005_000);
      const waitingResponse = await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/waiting",
        {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          dispatchId: "dispatch-1",
          idempotencyKey: "idempotency-1",
          observedAtMs: 1_700_000_005_000,
          ownerUserId: "owner-1",
          reasonCode: "daemon.profile.pending_first_report",
          targetWakeLifecycleIdentity:
            acceptRequest.targetWakeLifecycleIdentity,
          userRecoveryAction: "wait_for_wake_route_report",
          waitingCategory: "wake_route_registration_pending",
        } satisfies RuntimeTransportRuntimeCoordinatorHeadWaitingRequest
      );

      expect(waitingResponse.status).toBe(200);
      await expect(waitingResponse.json()).resolves.toMatchObject({
        deadlineAtMs: 1_700_000_300_000,
        nextTriggerAtMs: 1_700_000_030_000,
        ok: true,
        reasonCode: "daemon.profile.pending_first_report",
        softDeadlineAtMs: 1_700_000_030_000,
        status: "waiting",
        userRecoveryAction: "wait_for_wake_route_report",
        waitingCategory: "wake_route_registration_pending",
      });
      expect(storageSetAlarm).toHaveBeenCalledWith(1_700_000_030_000);
      expect(
        findRuntimeCoordinatorHeadLifecycleRecord(storageRecords)
      ).toMatchObject({
        runtimeCoordinatorExecutionId: null,
        status: "waiting",
        waitingBoundary: {
          reasonCode: "daemon.profile.pending_first_report",
          trigger: "wake_route_reported",
          userRecoveryAction: "wait_for_wake_route_report",
          userVisibleState: "waiting_for_wake_route_report",
          waitingCategory: "wake_route_registration_pending",
          waitingFor: "wake_route_report",
        },
      });

      nowSpy.mockReturnValue(1_700_000_301_000);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(
        findRuntimeCoordinatorHeadLifecycleRecord(storageRecords)
      ).toMatchObject({
        noExecutionDecision: {
          publicationCategory: "wake_route_registration_pending",
          reasonCode: "daemon.profile.pending_first_report",
          source: "runtime_coordinator_head_waiting_deadline",
          userRecoveryAction: "wait_for_wake_route_report",
        },
        publicationIntent: {
          publicationCategory: "wake_route_registration_pending",
          reasonCode: "daemon.profile.pending_first_report",
          status: "ready_for_phase_6",
          userRecoveryAction: "wait_for_wake_route_report",
        },
        status: "publication_intent_ready",
      });
      expect(appliedFailurePublicationCommands).toHaveLength(1);
      expect(appliedFailurePublicationCommands[0]).toMatchObject({
        reasonCode: "daemon.profile.pending_first_report",
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("moves an accepted Wake head without execution into service wait after the handoff window", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const { hub, state, storageRecords, storageSetAlarm } = createHarness();
      state.pendingDispatches.clear();

      await acceptDefaultRuntimeCoordinatorHead(hub);

      expect(storageSetAlarm).toHaveBeenCalledWith(1_700_000_030_000);
      storageSetAlarm.mockClear();
      nowSpy.mockReturnValue(1_700_000_031_000);

      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(
        findRuntimeCoordinatorHeadLifecycleRecord(storageRecords)
      ).toMatchObject({
        runtimeCoordinatorExecutionId: null,
        status: "waiting",
        waitingBoundary: {
          deadlineAtMs: 1_700_000_300_000,
          reasonCode: "daemon.profile.offline",
          softDeadlineAtMs: 1_700_000_030_000,
          userRecoveryAction: "start_or_restart_openmeld_service",
          waitingCategory: "service_not_connected",
        },
      });
      expect(storageSetAlarm).toHaveBeenCalledWith(1_700_000_300_000);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("publishes failure and degrades readiness when an accepted Wake head never creates execution", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        appliedFailurePublicationCommands,
        hub,
        recordingD1,
        state,
        storageRecords,
      } = createHarness();
      state.pendingDispatches.clear();

      await acceptDefaultRuntimeCoordinatorHead(hub);

      recordingD1.calls.length = 0;
      nowSpy.mockReturnValue(1_700_000_301_000);

      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(
        findRuntimeCoordinatorHeadLifecycleRecord(storageRecords)
      ).toMatchObject({
        noExecutionDecision: {
          reasonCode: "daemon.profile.offline",
          source: "runtime_coordinator_head_waiting_deadline",
        },
        publicationIntent: {
          publicationCategory: "service_not_connected",
          reasonCode: "daemon.profile.offline",
          status: "ready_for_phase_6",
        },
        publicationOutcome: {
          finalMessageKind: "failure_notice",
          publishedSignalId: "signal-head-failure-1",
          status: "failure_published",
        },
        runtimeCoordinatorExecutionId: null,
        status: "publication_intent_ready",
      });
      expect(appliedFailurePublicationCommands).toHaveLength(1);
      expect(getReadinessImpactWriteCalls(recordingD1.calls)).toHaveLength(1);
      expect(
        getReadinessImpactWriteCalls(recordingD1.calls)[0]?.params
      ).toEqual([
        `readiness_impact:local_execution:${TARGET_AGENT_PROFILE_ID}:binding-1:runtime-1:builtin:codex`,
        "local_execution",
        TARGET_AGENT_PROFILE_ID,
        "binding-1",
        "runtime-1",
        "builtin:codex",
        "runtime_coordinator.delivery_expired",
        "wake_failure",
        "dispatch-1",
        "attempt-1",
        1_700_000_301_000,
        1_700_002_101_000,
        1_700_000_301_000,
        1_700_000_301_000,
      ]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("still publishes accepted-head failure when readiness impact write fails", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      const { appliedFailurePublicationCommands, hub, state } = createHarness({
        readinessImpactWriteError: new Error("readiness impact D1 failed"),
      });
      state.pendingDispatches.clear();

      await acceptDefaultRuntimeCoordinatorHead(hub);

      nowSpy.mockReturnValue(1_700_000_301_000);

      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(appliedFailurePublicationCommands).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledWith(
        "[core.runtime_transport.runtime_coordinator_head_failure_readiness_impact_failed]",
        expect.objectContaining({
          agentProfileId: TARGET_AGENT_PROFILE_ID,
          dispatchId: "dispatch-1",
          error: "readiness impact D1 failed",
          reasonCode: "runtime_coordinator.delivery_expired",
        })
      );
    } finally {
      warnSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it("re-enqueues a pending-first-report Wake when the route report arrives", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const { hub, spaceFetchRequests, waitUntilTasks } = createHarness();
      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/accept",
        buildRuntimeCoordinatorHeadAcceptRequest()
      );
      const waitingRequest = {
        ...buildRuntimeCoordinatorHeadWaitingRequest(),
        reasonCode: "daemon.profile.pending_first_report",
        userRecoveryAction: "wait_for_wake_route_report",
        waitingCategory: "wake_route_registration_pending",
      } satisfies RuntimeTransportRuntimeCoordinatorHeadWaitingRequest;
      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/waiting",
        waitingRequest
      );
      nowSpy.mockReturnValue(1_700_000_020_000);

      const reconnectResponse = await fetchRuntimeTransportJson(
        hub,
        "/route-catalog-changed",
        {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          ownerUserId: "owner-1",
          reason: "route_registered",
        }
      );
      expect(reconnectResponse.status).toBe(200);
      await Promise.all(waitUntilTasks);

      expect(spaceFetchRequests).toContainEqual({
        body: {
          reason: "runtime_coordinator_head_waiting_recovery",
          targetProfileId: TARGET_AGENT_PROFILE_ID,
          targetWakeLifecycleId:
            waitingRequest.targetWakeLifecycleIdentity.targetWakeLifecycleId,
        },
        path: "/internal/dispatches/dispatch-1/redrive",
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("forms service-offline publication intent at the hard deadline instead of re-enqueuing late reconnects", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        appliedFailurePublicationCommands,
        hub,
        spaceFetchRequests,
        storageRecords,
        waitUntilTasks,
      } = createHarness();
      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/accept",
        buildRuntimeCoordinatorHeadAcceptRequest()
      );
      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/head/waiting",
        buildRuntimeCoordinatorHeadWaitingRequest()
      );
      nowSpy.mockReturnValue(1_700_000_301_000);

      await fetchRuntimeTransportJson(hub, "/route-catalog-changed", {
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        ownerUserId: "owner-1",
        reason: "route_registered",
      });
      await Promise.all(waitUntilTasks);

      expect(spaceFetchRequests).toEqual([]);
      expect(
        findRuntimeCoordinatorHeadLifecycleRecord(storageRecords)
      ).toMatchObject({
        noExecutionDecision: {
          reasonCode: "daemon.profile.offline",
          source: "runtime_coordinator_head_waiting_deadline",
        },
        publicationIntent: {
          publicationCategory: "service_not_connected",
          reasonCode: "daemon.profile.offline",
          status: "ready_for_phase_6",
        },
        publicationOutcome: {
          finalMessageKind: "failure_notice",
          publishedSignalId: "signal-head-failure-1",
          status: "failure_published",
        },
        runtimeCoordinatorExecutionId: null,
        status: "publication_intent_ready",
        targetDisplay: {
          targetProfileMentionLabel: "Codex Agent",
          targetProfileName: "Codex Agent",
        },
      });
      expect(appliedFailurePublicationCommands).toHaveLength(1);
      expect(appliedFailurePublicationCommands[0]).toMatchObject({
        publicationCategory: "service_not_connected",
        reasonCode: "daemon.profile.offline",
        targetProfileMentionLabel: "Codex Agent",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        targetProfileName: "Codex Agent",
        userRecoveryAction: "start_or_restart_openmeld_service",
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("links the accepted target Wake head to the first created execution", async () => {
    const { hub, sentFrames, socket, state, storageRecords } = createHarness();
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest()
    );
    configureCompatibleRoute({ socket, state });

    const deliveryResponse = await (
      hub as unknown as {
        handleDeliverDispatchRequest: (request: Request) => Promise<Response>;
      }
    ).handleDeliverDispatchRequest(
      new Request("https://runtime-transport.test/deliver-dispatch", {
        body: JSON.stringify(buildDeliverRequest()),
        method: "POST",
      })
    );

    expect(deliveryResponse.status).toBe(200);
    expect(sentFrames).toHaveLength(1);
    const headRecord =
      findRuntimeCoordinatorHeadLifecycleRecord(storageRecords);
    expect(headRecord).toMatchObject({
      primaryDispatchId: "dispatch-1",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      status: "execution_linked",
    });

    const duplicateResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest({
        dispatchId: "dispatch-2",
        idempotencyKey: "idempotency-2",
        targetWakeLifecycleIdentity: projectTargetWakeLifecycleIdentity({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-2",
          sourceSignalId: "signal-1",
          spaceId: HEX_SPACE_ID,
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        }),
      })
    );

    expect(duplicateResponse.status).toBe(200);
    await expect(duplicateResponse.json()).resolves.toMatchObject({
      action: "skip_duplicate",
      ok: true,
      primaryDispatchId: "dispatch-1",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      status: "execution_linked",
    });
  });

  it("records Wake Stop as cancellation_requested for an eligible active RuntimeCoordinator execution", async () => {
    const { hub, recordingD1, sentFrames, socket, state, storageRecords } =
      createHarness({
        agentControllerReportRow: buildRuntimeAgentControllerReportRow(),
      });
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    const session = state.sessionsById.get("daemon-session-1");
    if (!session) {
      throw new Error("Expected live daemon session.");
    }
    session.capabilities = {
      ...session.capabilities,
      localAgentControl: { cancel: true },
    };
    enableLocalAgentInteraction(state);
    await (
      hub as unknown as {
        handleDispatchInteractionRequestFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchInteractionRequestFrame(
      socket,
      buildInteractionRequest(executionToken)
    );

    const response = await requestRuntimeCoordinatorWakeStop(hub);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      status: "cancellation_requested",
      targetProfileId: TARGET_AGENT_PROFILE_ID,
      cancellationState: {
        reasonCode: "runtime_coordinator.wake_stop_delivery_pending",
        status: "delivery_pending",
      },
    });
    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.interaction_response",
        payload: expect.objectContaining({
          interactionId: "interaction-1",
          response: { kind: "cancel" },
        }),
      })
    );
    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.local_agent_control.cancel",
        payload: {
          requestId: `wake-stop:${RUNTIME_COORDINATOR_EXECUTION_ID}`,
          payload: {
            runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
            target: {
              by: "task",
              taskId: "task-1",
            },
          },
        },
      })
    );
    expect(
      recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
    ).toMatchObject({
      status: "cancellation_requested",
      terminal_outcome_json: null,
    });
    expect(findRuntimeCoordinatorRunCommandState(storageRecords)).toMatchObject(
      {
        lastCommandReasonCode: "runtime_coordinator.wake_stop_delivery_pending",
        pendingInteraction: {
          response: { kind: "cancel" },
        },
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      }
    );
    expect([...recordingD1.interactionInboxRows.values()]).toEqual([
      expect.objectContaining({ resolution_status: "resolved" }),
    ]);
    const requestedEvents = getRuntimeCoordinatorEventCalls(
      recordingD1.calls
    ).filter((call) => call.params[2] === "cancellation_requested");
    expect(requestedEvents).toHaveLength(1);
    expect(requestedEvents[0]?.params[3]).toBe("cancellation_requested");
    expect(JSON.parse(String(requestedEvents[0]?.params[7]))).toMatchObject({
      controlMode: "cancel",
      reliability: "native_cancel",
      source: "space_wake_stop",
    });
    const deliveryEvents = getRuntimeCoordinatorEventCalls(
      recordingD1.calls
    ).filter((call) => call.params[2] === "cancellation_delivery_accepted");
    expect(deliveryEvents).toHaveLength(1);
    expect(deliveryEvents[0]?.params[3]).toBe("cancellation_requested");
    expect(JSON.parse(String(deliveryEvents[0]?.params[7]))).toMatchObject({
      controlMode: "cancel",
      requestId: `wake-stop:${RUNTIME_COORDINATOR_EXECUTION_ID}`,
      reliability: "native_cancel",
    });

    const repeatResponse = await requestRuntimeCoordinatorWakeStop(hub);

    expect(repeatResponse.status).toBe(200);
    await expect(repeatResponse.json()).resolves.toMatchObject({
      ok: true,
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      status: "cancellation_requested",
      cancellationState: {
        status: "delivery_pending",
      },
    });
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).filter(
        (call) => call.params[2] === "cancellation_requested"
      )
    ).toHaveLength(1);
  });

  it("records Wake Stop through interrupt delivery for interrupt-only RuntimeCoordinator executions", async () => {
    const { hub, recordingD1, sentFrames, socket, state, storageRecords } =
      createHarness({
        agentControllerReportRow: buildRuntimeAgentControllerReportRow({
          agentControllerInterface: buildAgentControllerInterfaceSnapshot({
            capabilities: {
              approvals: false,
              cancel: false,
              interrupt: true,
              modelSelection: false,
              nativeEventStream: true,
              permissionModes: false,
              structuredUserInput: false,
            },
          }),
        }),
      });
    await issueDeliveryToken({ hub, sentFrames, socket, state });
    enableWakeStopControl(state, "interrupt");

    const response = await requestRuntimeCoordinatorWakeStop(hub);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      status: "cancellation_requested",
      targetProfileId: TARGET_AGENT_PROFILE_ID,
      cancellationState: {
        reasonCode: "runtime_coordinator.wake_stop_delivery_pending",
        status: "delivery_pending",
      },
    });
    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.local_agent_control.interrupt",
        payload: {
          requestId: `wake-stop:${RUNTIME_COORDINATOR_EXECUTION_ID}`,
          payload: {
            mode: "force",
            runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
            target: {
              by: "task",
              taskId: "task-1",
            },
          },
        },
      })
    );
    expect(
      recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
    ).toMatchObject({
      status: "cancellation_requested",
      terminal_outcome_json: null,
    });
    expect(findRuntimeCoordinatorRunCommandState(storageRecords)).toMatchObject(
      {
        lastCommandReasonCode: "runtime_coordinator.wake_stop_delivery_pending",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      }
    );
    const requestedEvents = getRuntimeCoordinatorEventCalls(
      recordingD1.calls
    ).filter((call) => call.params[2] === "cancellation_requested");
    expect(JSON.parse(String(requestedEvents[0]?.params[7]))).toMatchObject({
      controlMode: "interrupt",
      reliability: "native_interrupt",
      source: "space_wake_stop",
    });
    const deliveryEvents = getRuntimeCoordinatorEventCalls(
      recordingD1.calls
    ).filter((call) => call.params[2] === "cancellation_delivery_accepted");
    expect(deliveryEvents).toHaveLength(1);
    expect(JSON.parse(String(deliveryEvents[0]?.params[7]))).toMatchObject({
      controlMode: "interrupt",
      requestId: `wake-stop:${RUNTIME_COORDINATOR_EXECUTION_ID}`,
      reliability: "native_interrupt",
    });
  });

  it("suppresses a success reply when it arrives after Wake Stop is requested before reply finalization", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      recordingD1,
      sentFrames,
      socket,
      spaceFetchRequests,
      spaceStub,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness({
      agentControllerReportRow: buildRuntimeAgentControllerReportRow(),
    });
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    enableWakeStopControl(state);
    await requestRuntimeCoordinatorWakeStop(hub);
    appliedFinalizationCommands.length = 0;
    recordingD1.calls.length = 0;
    sentFrames.length = 0;
    spaceFetchRequests.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );
    expect(
      recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
    ).toMatchObject({
      status: "cancelled",
    });
    await Promise.all(waitUntilTasks.splice(0));

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: true,
          status: "accepted",
        }),
      })
    );
    expect(appliedFinalizationCommands).toHaveLength(0);
    expect(spaceFetchRequests).toContainEqual({
      path: "/rpc/signals/system-notice",
      body: {
        finalOutcomeAuthority: "runtime_coordinator_wake_stop_publication",
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        data: {
          noticeType: "wake_stopped",
          actorProfileId: TARGET_AGENT_PROFILE_ID,
          actorName: "Codex Agent",
          dispatchId: "dispatch-1",
          generatedBy: "openmeld",
          reason: "runtime_coordinator.wake_stop_requested",
          reasonCode: "runtime_coordinator.wake_stop_requested",
          text: "Wake was stopped for Codex Agent.",
        },
      },
    });
    const projection = recordingD1.projectionRows.get(
      RUNTIME_COORDINATOR_EXECUTION_ID
    );
    expect(projection).toMatchObject({
      status: "cancelled",
    });
    expect(JSON.parse(String(projection?.terminal_outcome_json))).toMatchObject(
      {
        kind: "cancelled",
        reasonCode: "runtime_coordinator.wake_stop_requested",
      }
    );
    expect(
      recordingD1.inboxRows.get("dispatch-1::attempt-1")?.publish_state
    ).toBe("reply_suppressed_stopped");
    expect(
      recordingD1.inboxRows.get("dispatch-1::attempt-1")?.publication_error_code
    ).toBe("runtime_coordinator.wake_stop_requested");
    const authority =
      findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords);
    expect(authority).toMatchObject({
      terminalOutcome: {
        reasonCode: "runtime_coordinator.wake_stop_requested",
        replySignalId: null,
        status: "cancelled",
      },
    });
    await expect(
      (
        hub as unknown as {
          rpcReadAgentProfileExecutionState: (input: {
            ownerUserId: string;
            targetProfileId: string;
          }) => Promise<unknown>;
        }
      ).rpcReadAgentProfileExecutionState({
        ownerUserId: "owner-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toEqual({ status: "inactive" });
    const events = getRuntimeCoordinatorEventCalls(recordingD1.calls);
    expect(events.some((call) => call.params[2] === "reply_published")).toBe(
      false
    );
    const suppressedEvents = events.filter(
      (call) =>
        call.params[2] === "runtime_coordinator_decision_recorded" &&
        call.params[4] === "runtime_coordinator.wake_stop_requested"
    );
    expect(suppressedEvents.length).toBeGreaterThan(0);
    expect(
      JSON.parse(String(suppressedEvents.at(-1)?.params[7]))
    ).toMatchObject({
      finalizationCommandId: buildRuntimeCoordinatorFinalizationCommandId({
        executionTokenRunId: executionToken.runId,
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      }),
      publishState: "reply_suppressed_stopped",
      stoppedNoticePublication: {
        publishedSignalId: "signal-delivery-expired-1",
        status: "published",
      },
    });
    expect(spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
      spaceId: HEX_SPACE_ID,
      streamId: "local-agent:10.dispatch-1:9.attempt-1",
      terminal: {
        kind: "stopped",
        noticeText: "The Agent stopped this reply.",
        reasonCode: "runtime_coordinator.wake_stop_requested",
      },
    });
  });

  it("threads the upstream reply-to snapshot into the wake-stopped notice", async () => {
    const { hub, sentFrames, socket, spaceFetchRequests, state } =
      createHarness({
        agentControllerReportRow: buildRuntimeAgentControllerReportRow(),
      });
    const replyToSnapshot = {
      signalId: "signal-source-2",
      profileId: "11111111-1111-4111-8111-111111111111",
      profileKind: "human" as const,
      profileName: "Felix",
      previewText: "@Codex please check this",
    };
    const executionToken = await issueDeliveryToken({
      hub,
      replyToSnapshot,
      sentFrames,
      socket,
      state,
    });
    enableWakeStopControl(state);
    await requestRuntimeCoordinatorWakeStop(hub);
    sentFrames.length = 0;
    spaceFetchRequests.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(spaceFetchRequests).toContainEqual(
      expect.objectContaining({
        path: "/rpc/signals/system-notice",
        body: expect.objectContaining({
          data: expect.objectContaining({
            noticeType: "wake_stopped",
            reasonCode: "runtime_coordinator.wake_stop_requested",
            replyTo: replyToSnapshot,
          }),
        }),
      })
    );
  });

  it("settles a Wake execution as cancelled only after accepted local cancel control", async () => {
    const {
      hub,
      recordingD1,
      sentFrames,
      socket,
      spaceFetchRequests,
      spaceStub,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness({
      agentControllerReportRow: buildRuntimeAgentControllerReportRow(),
    });
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    enableWakeStopControl(state);
    await requestRuntimeCoordinatorWakeStop(
      hub,
      buildRuntimeCoordinatorWakeStopRequest({
        reason: "The Agent Profile was deleted.",
      })
    );
    recordingD1.calls.length = 0;

    await submitWakeStopLocalControlResult({
      hub,
      socket,
      state,
      waitUntilTasks,
    });

    const projection = recordingD1.projectionRows.get(
      RUNTIME_COORDINATOR_EXECUTION_ID
    );
    expect(projection).toMatchObject({
      status: "cancelled",
    });
    expect(JSON.parse(String(projection?.terminal_outcome_json))).toMatchObject(
      {
        kind: "cancelled",
        reasonCode: "adapter.cancel.accepted",
      }
    );
    const authority =
      findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords);
    expect(authority).toMatchObject({
      currentRunId: null,
      terminalOutcome: {
        reasonCode: "adapter.cancel.accepted",
        replySignalId: null,
        status: "cancelled",
      },
    });
    expect(authority?.runsById[executionToken.runId]).toMatchObject({
      retiredReasonCode: "execution_token_revoked",
      tokenSecretRefOrSealedToken: null,
      tokenStatus: "revoked",
    });
    expect(spaceFetchRequests).toContainEqual({
      path: "/rpc/signals/system-notice",
      body: {
        finalOutcomeAuthority: "runtime_coordinator_wake_stop_publication",
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        data: {
          noticeType: "wake_stopped",
          actorProfileId: TARGET_AGENT_PROFILE_ID,
          actorName: "Codex Agent",
          dispatchId: "dispatch-1",
          generatedBy: "openmeld",
          reason: "The Agent Profile was deleted.",
          reasonCode: "adapter.cancel.accepted",
          text: "Wake was stopped for Codex Agent because its Agent Profile was deleted.",
        },
      },
    });
    expect(
      findRuntimeCoordinatorWakeStoppedNoticePublicationRecord(storageRecords)
    ).toMatchObject({
      dispatchId: "dispatch-1",
      publicationId: `wake-stopped:${RUNTIME_COORDINATOR_EXECUTION_ID}`,
      publishedSignalId: "signal-delivery-expired-1",
      reasonCode: "adapter.cancel.accepted",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      status: "published",
      targetProfileId: TARGET_AGENT_PROFILE_ID,
    });
    expect(spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
      spaceId: HEX_SPACE_ID,
      streamId: "local-agent:10.dispatch-1:9.attempt-1",
      terminal: {
        kind: "stopped",
        noticeText: "The Agent stopped this reply.",
        reasonCode: "adapter.cancel.accepted",
      },
    });
    expect(findRuntimeCoordinatorRunCommandState(storageRecords)).toMatchObject(
      {
        lastCommandReasonCode: "adapter.cancel.accepted",
        stopReason: "The Agent Profile was deleted.",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      }
    );
    const acceptedEvents = getRuntimeCoordinatorEventCalls(
      recordingD1.calls
    ).filter((call) => call.params[2] === "cancellation_control_accepted");
    expect(acceptedEvents).toHaveLength(1);
    expect(acceptedEvents[0]?.params[3]).toBe("cancelled");
    expect(JSON.parse(String(acceptedEvents[0]?.params[7]))).toMatchObject({
      accepted: true,
      requestId: `wake-stop:${RUNTIME_COORDINATOR_EXECUTION_ID}`,
      resolvedDispatchId: "dispatch-1",
      resolvedRuntimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      resolvedTaskId: "task-1",
      stoppedNoticePublication: {
        publishedSignalId: "signal-delivery-expired-1",
        status: "published",
      },
    });
    spaceFetchRequests.length = 0;

    await submitWakeStopLocalControlResult({
      hub,
      socket,
      state,
      waitUntilTasks,
    });

    expect(spaceFetchRequests).toEqual([]);
    await expect(
      classifyPublicationClosureDiagnostics(hub, {
        dispatchId: "dispatch-1",
        publicationKind: "stopped_notice",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        spaceId: HEX_SPACE_ID,
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toMatchObject({
      publicationId: `wake-stopped:${RUNTIME_COORDINATOR_EXECUTION_ID}`,
      publicationKind: "stopped_notice",
      reasonCode: "runtime_coordinator.publication_already_visible",
      status: "already_visible",
    });
  });

  it("durably retries an accepted Wake Stop stream close until Space accepts it", async () => {
    const {
      hub,
      sentFrames,
      socket,
      spaceStub,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness({
      agentControllerReportRow: buildRuntimeAgentControllerReportRow(),
    });
    await issueDeliveryToken({ hub, sentFrames, socket, state });
    enableWakeStopControl(state);
    await requestRuntimeCoordinatorWakeStop(hub);
    spaceStub.rpcCloseAgentStream.mockRejectedValueOnce(
      new Error("Space stream close unavailable")
    );

    await submitWakeStopLocalControlResult({
      hub,
      socket,
      state,
      waitUntilTasks,
    });

    expect(
      [...storageRecords.entries()]
        .filter(([key]) =>
          key.startsWith(
            "runtime-coordinator:local-agent-stream-closure-retry:entry:"
          )
        )
        .map(([, value]) => value)
    ).toEqual([
      expect.objectContaining({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        spaceId: HEX_SPACE_ID,
        streamId: "local-agent:10.dispatch-1:9.attempt-1",
        terminal: expect.objectContaining({ kind: "stopped" }),
      }),
    ]);
    expect(
      [...storageRecords.keys()].filter((key) =>
        key.startsWith(
          "runtime-coordinator:local-agent-stream-closure-retry:due:"
        )
      )
    ).toHaveLength(1);

    spaceStub.rpcCloseAgentStream.mockClear();
    await (
      hub as unknown as {
        processLocalAgentStreamClosureRetryAlarm: (
          nowMs: number
        ) => Promise<void>;
      }
    ).processLocalAgentStreamClosureRetryAlarm(Number.MAX_SAFE_INTEGER);

    expect(spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
      spaceId: HEX_SPACE_ID,
      streamId: "local-agent:10.dispatch-1:9.attempt-1",
      terminal: {
        kind: "stopped",
        noticeText: "The Agent stopped this reply.",
        reasonCode: "adapter.cancel.accepted",
      },
    });
    expect(
      [...storageRecords.keys()].filter((key) =>
        key.startsWith("runtime-coordinator:local-agent-stream-closure-retry:")
      )
    ).toEqual([]);
  });

  it("settles a user-requested Wake Stop when the restarted service reports task.not_found", async () => {
    const {
      hub,
      recordingD1,
      sentFrames,
      socket,
      spaceFetchRequests,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness({
      agentControllerReportRow: buildRuntimeAgentControllerReportRow(),
    });
    await issueDeliveryToken({ hub, sentFrames, socket, state });
    enableWakeStopControl(state);
    await requestRuntimeCoordinatorWakeStop(hub);
    recordingD1.calls.length = 0;
    spaceFetchRequests.length = 0;

    await submitWakeStopLocalControlResult({
      accepted: false,
      hub,
      includeResolvedIdentity: false,
      note: "The task is not present in this service process.",
      reasonCode: "task.not_found",
      socket,
      state,
      waitUntilTasks,
    });

    expect(
      recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
    ).toMatchObject({
      status: "cancelled",
    });
    expect(
      findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords)
    ).toMatchObject({
      currentRunId: null,
      terminalOutcome: {
        reasonCode: "task.not_found",
        status: "cancelled",
      },
    });
    expect(spaceFetchRequests).toContainEqual(
      expect.objectContaining({
        path: "/rpc/signals/system-notice",
        body: expect.objectContaining({
          data: expect.objectContaining({
            noticeType: "wake_stopped",
            reasonCode: "task.not_found",
          }),
        }),
      })
    );
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).filter(
        (call) => call.params[2] === "cancellation_control_accepted"
      )
    ).toHaveLength(1);
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "runtime_connection_lost"
      )
    ).toBe(false);
  });

  it("settles a Wake execution as cancelled only after accepted local interrupt control", async () => {
    const { hub, recordingD1, sentFrames, socket, state, waitUntilTasks } =
      createHarness({
        agentControllerReportRow: buildRuntimeAgentControllerReportRow({
          agentControllerInterface: buildAgentControllerInterfaceSnapshot({
            capabilities: {
              approvals: false,
              cancel: false,
              interrupt: true,
              modelSelection: false,
              nativeEventStream: true,
              permissionModes: false,
              structuredUserInput: false,
            },
          }),
        }),
      });
    await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    enableWakeStopControl(state, "interrupt");
    await requestRuntimeCoordinatorWakeStop(hub);
    recordingD1.calls.length = 0;

    await submitWakeStopLocalControlResult({
      hub,
      note: "adapter.interrupt.accepted",
      reasonCode: "adapter.interrupt.accepted",
      socket,
      state,
      waitUntilTasks,
    });

    const projection = recordingD1.projectionRows.get(
      RUNTIME_COORDINATOR_EXECUTION_ID
    );
    expect(projection).toMatchObject({
      status: "cancelled",
    });
    expect(JSON.parse(String(projection?.terminal_outcome_json))).toMatchObject(
      {
        kind: "cancelled",
        reasonCode: "adapter.interrupt.accepted",
      }
    );
    const acceptedEvents = getRuntimeCoordinatorEventCalls(
      recordingD1.calls
    ).filter((call) => call.params[2] === "cancellation_control_accepted");
    expect(acceptedEvents).toHaveLength(1);
    expect(acceptedEvents[0]?.params[3]).toBe("cancelled");
    expect(acceptedEvents[0]?.params[4]).toBe("adapter.interrupt.accepted");
    expect(JSON.parse(String(acceptedEvents[0]?.params[7]))).toMatchObject({
      accepted: true,
      requestId: `wake-stop:${RUNTIME_COORDINATOR_EXECUTION_ID}`,
      resolvedDispatchId: "dispatch-1",
      resolvedRuntimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      resolvedTaskId: "task-1",
    });
  });

  it("projects a published Wake Stop task outcome through Agent Task Coordination storage", async () => {
    const { hub, recordingD1, storageRecords } = createHarness();
    const wakeEvidenceD1 = createRecordingD1();
    (
      hub as unknown as {
        env: CoreBindings;
      }
    ).env.OPENMELD_WAKE_EVIDENCE_DB = wakeEvidenceD1.db;

    await (
      hub as unknown as {
        projectRuntimeCoordinatorStoppedTaskOutcome: (input: {
          record: {
            createdAtMs: number;
            dispatchId: string;
            modelVersion: typeof RUNTIME_COORDINATOR_WAKE_STOPPED_NOTICE_PUBLICATION_MODEL_VERSION;
            publicationId: string;
            publishedSignalId: string;
            reasonCode: string;
            runtimeCoordinatorExecutionId: string;
            spaceId: string;
            status: "published";
            taskOutcomeProjectedAtMs: null;
            taskOutcomeSourceClientMessageId: string;
            targetProfileId: string;
            targetWakeLifecycleId: string;
            updatedAtMs: number;
          };
          sourceClientMessageId: string;
        }) => Promise<void>;
      }
    ).projectRuntimeCoordinatorStoppedTaskOutcome({
      record: {
        createdAtMs: 1000,
        dispatchId: "dispatch-1",
        modelVersion:
          RUNTIME_COORDINATOR_WAKE_STOPPED_NOTICE_PUBLICATION_MODEL_VERSION,
        publicationId: `wake-stopped:${RUNTIME_COORDINATOR_EXECUTION_ID}`,
        publishedSignalId: "signal-wake-stopped-1",
        reasonCode: "runtime_coordinator.wake_stop_requested",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        spaceId: HEX_SPACE_ID,
        status: "published",
        taskOutcomeProjectedAtMs: null,
        taskOutcomeSourceClientMessageId: "client-message-1",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        targetWakeLifecycleId: "wake-lifecycle-1",
        updatedAtMs: 2000,
      },
      sourceClientMessageId: "client-message-1",
    });

    expect(
      recordingD1.calls.some((call) =>
        call.query.includes("INSERT INTO agent_task_terminal_outcomes")
      )
    ).toBe(true);
    expect(
      wakeEvidenceD1.calls.some((call) =>
        call.query.includes("INSERT INTO agent_task_terminal_outcomes")
      )
    ).toBe(false);
    expect(
      findRuntimeCoordinatorWakeStoppedNoticePublicationRecord(storageRecords)
    ).toMatchObject({
      publishedSignalId: "signal-wake-stopped-1",
      taskOutcomeProjectedAtMs: expect.any(Number),
      taskOutcomeSourceClientMessageId: "client-message-1",
    });
  });

  it("keeps Wake Stop cancellation_requested when local cancel control is rejected", async () => {
    const {
      hub,
      recordingD1,
      sentFrames,
      socket,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness({
      agentControllerReportRow: buildRuntimeAgentControllerReportRow(),
    });
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    enableWakeStopControl(state);
    await requestRuntimeCoordinatorWakeStop(hub);
    recordingD1.calls.length = 0;

    await submitWakeStopLocalControlResult({
      accepted: false,
      hub,
      note: "adapter.unsupported",
      reasonCode: "adapter.unsupported",
      socket,
      state,
      waitUntilTasks,
    });

    expect(
      recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
    ).toMatchObject({
      status: "cancellation_requested",
      terminal_outcome_json: null,
    });
    const authority =
      findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords);
    expect(authority?.currentRunId).toBe(executionToken.runId);
    expect(authority?.terminalOutcome).toBeNull();
    expect(authority?.runsById[executionToken.runId]).toMatchObject({
      tokenStatus: "active",
    });
    const rejectedEvents = getRuntimeCoordinatorEventCalls(
      recordingD1.calls
    ).filter((call) => call.params[2] === "cancellation_control_rejected");
    expect(rejectedEvents).toHaveLength(1);
    expect(rejectedEvents[0]?.params[3]).toBe("cancellation_requested");
    expect(rejectedEvents[0]?.params[4]).toBe("adapter.unsupported");
  });

  it("records a stopped_notice blocker when Wake Stop publication fails after cancellation settles", async () => {
    const {
      hub,
      recordingD1,
      sentFrames,
      socket,
      spaceStub,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness({
      agentControllerReportRow: buildRuntimeAgentControllerReportRow(),
    });
    await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    enableWakeStopControl(state);
    await requestRuntimeCoordinatorWakeStop(hub);
    recordingD1.calls.length = 0;
    spaceStub.rpcPostSystemNoticeSignal.mockRejectedValue(
      new Error("space unavailable")
    );

    await submitWakeStopLocalControlResult({
      hub,
      socket,
      state,
      waitUntilTasks,
    });

    expect(
      recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
    ).toMatchObject({
      status: "cancelled",
    });
    expect(
      findRuntimeCoordinatorWakeStoppedNoticePublicationRecord(storageRecords)
    ).toMatchObject({
      publicationId: `wake-stopped:${RUNTIME_COORDINATOR_EXECUTION_ID}`,
      publishedSignalId: null,
      reasonCode: "runtime_coordinator.stopped_publication_unavailable",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      status: "publication_failed",
    });
    expect(
      findRuntimeCoordinatorPublicationBlockerRecord(storageRecords)
    ).toMatchObject({
      blockerKind: "publication_unavailable",
      dispatchId: "dispatch-1",
      publicationKind: "stopped_notice",
      reasonCode: "runtime_coordinator.stopped_publication_unavailable",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      status: "unresolved_publication_failure",
    });
    const acceptedEvents = getRuntimeCoordinatorEventCalls(
      recordingD1.calls
    ).filter((call) => call.params[2] === "cancellation_control_accepted");
    expect(acceptedEvents).toHaveLength(1);
    expect(JSON.parse(String(acceptedEvents[0]?.params[7]))).toMatchObject({
      stoppedNoticePublication: {
        reasonCode: "runtime_coordinator.stopped_publication_unavailable",
        status: "unavailable",
      },
    });
    const blockerEvents = getRuntimeCoordinatorEventCalls(
      recordingD1.calls
    ).filter(
      (call) => call.params[4] === "runtime_coordinator.publication_unresolved"
    );
    expect(blockerEvents).toHaveLength(1);
    expect(JSON.parse(String(blockerEvents[0]?.params[7]))).toMatchObject({
      publicationKind: "stopped_notice",
      reasonCode: "runtime_coordinator.stopped_publication_unavailable",
      status: "unresolved_publication_failure",
    });
    await expect(
      classifyPublicationClosureDiagnostics(hub, {
        dispatchId: "dispatch-1",
        publicationKind: "stopped_notice",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        spaceId: HEX_SPACE_ID,
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toMatchObject({
      publicationId: `wake-stopped:${RUNTIME_COORDINATOR_EXECUTION_ID}`,
      publicationKind: "stopped_notice",
      reasonCode: "runtime_coordinator.publication_redrive_retryable",
      status: "retryable",
    });
  });

  it("rejects late task results after Wake Stop cancellation settles", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      recordingD1,
      sentFrames,
      socket,
      spaceStub,
      state,
      waitUntilTasks,
    } = createHarness({
      agentControllerReportRow: buildRuntimeAgentControllerReportRow(),
    });
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    enableWakeStopControl(state);
    await requestRuntimeCoordinatorWakeStop(hub);
    await submitWakeStopLocalControlResult({
      hub,
      socket,
      state,
      waitUntilTasks,
    });
    spaceStub.rpcCloseAgentStream.mockClear();
    recordingD1.calls.length = 0;
    sentFrames.length = 0;
    appliedFinalizationCommands.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: false,
          reasonCode: "execution_token_terminal_late",
          status: "rejected_terminal",
        }),
      })
    );
    expect(
      recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
    ).toMatchObject({
      status: "cancelled",
    });
    expect(
      recordingD1.calls.some((call) =>
        call.query.includes("INSERT INTO openMeldDaemon_dispatch_result_inbox")
      )
    ).toBe(false);
    expect(appliedFinalizationCommands).toHaveLength(0);
    expect(spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
      spaceId: HEX_SPACE_ID,
      streamId: "local-agent:10.dispatch-1:9.attempt-1",
      terminal: {
        kind: "stopped",
        noticeText: "The Agent stopped this reply.",
        reasonCode: "adapter.cancel.accepted",
      },
    });
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "execution_token_terminal_late"
      )
    ).toBe(true);
  });

  it("rejects Wake Stop when the current Agent Controller Interface has no stop capability", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness({
      agentControllerReportRow: buildRuntimeAgentControllerReportRow({
        agentControllerInterface: buildAgentControllerInterfaceSnapshot({
          capabilities: {
            approvals: false,
            cancel: false,
            interrupt: false,
            modelSelection: false,
            nativeEventStream: false,
            permissionModes: false,
            structuredUserInput: false,
          },
        }),
      }),
    });
    await issueDeliveryToken({ hub, sentFrames, socket, state });

    const response = await requestRuntimeCoordinatorWakeStop(hub);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      reasonCode: "agent_controller_interface.stop_unsupported",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      status: "unsupported",
      targetProfileId: TARGET_AGENT_PROFILE_ID,
      cancellationState: {
        status: "unsupported",
      },
    });
    expect(
      recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
    ).not.toMatchObject({
      status: "cancellation_requested",
    });
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "cancellation_requested"
      )
    ).toBe(false);
  });

  it("rejects Wake Stop when the request source client message does not match execution scope", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness({
      agentControllerReportRow: buildRuntimeAgentControllerReportRow(),
    });
    await issueDeliveryToken({ hub, sentFrames, socket, state });
    enableWakeStopControl(state);

    const response = await requestRuntimeCoordinatorWakeStop(
      hub,
      buildRuntimeCoordinatorWakeStopRequest({
        sourceClientMessageId: "client-message-other",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      reasonCode: "runtime_coordinator.wake_stop_scope_missing",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      status: "retry_later",
      targetProfileId: TARGET_AGENT_PROFILE_ID,
      cancellationState: {
        status: "delivery_rejected",
      },
    });
    expect(
      sentFrames.some(
        (frame) =>
          typeof frame === "object" &&
          frame !== null &&
          (frame as { code?: unknown }).code ===
            "daemon.local_agent_control.cancel"
      )
    ).toBe(false);
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "cancellation_requested"
      )
    ).toBe(false);
  });

  it("fails Wake Stop delivery closed when the live local OpenMeld Service is too old for cancel frames", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness({
      agentControllerReportRow: buildRuntimeAgentControllerReportRow(),
    });
    await issueDeliveryToken({ hub, sentFrames, socket, state });

    const response = await requestRuntimeCoordinatorWakeStop(hub);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      reasonCode: "runtime_coordinator.wake_stop_transport_unsupported",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      status: "retry_later",
      targetProfileId: TARGET_AGENT_PROFILE_ID,
      cancellationState: {
        status: "delivery_rejected",
      },
    });
    expect(
      sentFrames.some(
        (frame) =>
          typeof frame === "object" &&
          frame !== null &&
          (frame as { code?: unknown }).code ===
            "daemon.local_agent_control.cancel"
      )
    ).toBe(false);
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).filter(
        (call) => call.params[2] === "cancellation_delivery_rejected"
      )
    ).toHaveLength(1);
  });

  it("fails Wake Stop delivery closed when interrupt-only Stop has no live interrupt frame support", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness({
      agentControllerReportRow: buildRuntimeAgentControllerReportRow({
        agentControllerInterface: buildAgentControllerInterfaceSnapshot({
          capabilities: {
            approvals: false,
            cancel: false,
            interrupt: true,
            modelSelection: false,
            nativeEventStream: true,
            permissionModes: false,
            structuredUserInput: false,
          },
        }),
      }),
    });
    await issueDeliveryToken({ hub, sentFrames, socket, state });
    const session = state.sessionsById.get("daemon-session-1");
    if (!session) {
      throw new Error("Expected live daemon session.");
    }
    session.capabilities = {
      ...session.capabilities,
      localAgentControl: { cancel: true },
    };

    const response = await requestRuntimeCoordinatorWakeStop(hub);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      reasonCode: "runtime_coordinator.wake_stop_transport_unsupported",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      status: "retry_later",
      targetProfileId: TARGET_AGENT_PROFILE_ID,
      cancellationState: {
        status: "delivery_rejected",
      },
    });
    expect(
      sentFrames.some(
        (frame) =>
          typeof frame === "object" &&
          frame !== null &&
          ((frame as { code?: unknown }).code ===
            "daemon.local_agent_control.cancel" ||
            (frame as { code?: unknown }).code ===
              "daemon.local_agent_control.interrupt")
      )
    ).toBe(false);
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).filter(
        (call) => call.params[2] === "cancellation_delivery_rejected"
      )
    ).toHaveLength(1);
  });

  it("fails Wake Stop delivery closed when the original local OpenMeld Service session is offline", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness({
      agentControllerReportRow: buildRuntimeAgentControllerReportRow(),
    });
    await issueDeliveryToken({ hub, sentFrames, socket, state });
    state.sessionsById.delete("daemon-session-1");

    const response = await requestRuntimeCoordinatorWakeStop(hub);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      reasonCode: "runtime_coordinator.wake_stop_service_offline",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      status: "retry_later",
      targetProfileId: TARGET_AGENT_PROFILE_ID,
      cancellationState: {
        status: "delivery_rejected",
      },
    });
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).filter(
        (call) => call.params[2] === "cancellation_delivery_rejected"
      )
    ).toHaveLength(1);
  });

  it("rejects Wake Stop for terminal RuntimeCoordinator executions without marking stopped", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness({
      agentControllerReportRow: buildRuntimeAgentControllerReportRow(),
    });
    await issueDeliveryToken({ hub, sentFrames, socket, state });
    recordingD1.projectionRows.set(
      RUNTIME_COORDINATOR_EXECUTION_ID,
      buildRuntimeCoordinatorProjectionRow({
        status: "reply_published",
        terminal_outcome_json: null,
      })
    );

    const response = await requestRuntimeCoordinatorWakeStop(hub);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      reasonCode: "runtime_coordinator.wake_stop_execution_terminal",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      status: "not_stoppable",
      targetProfileId: TARGET_AGENT_PROFILE_ID,
      cancellationState: {
        status: "not_requested",
      },
    });
    expect(
      recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
    ).toMatchObject({
      status: "reply_published",
    });
  });

  it("rejects a result that omits the coordinator execution id without completing the pending dispatch", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(socket, buildResultRequest());

    const dispatchAttemptKey = buildDispatchAttemptKey(
      "dispatch-1",
      "attempt-1"
    );
    expect(state.pendingDispatches.has(dispatchAttemptKey)).toBe(true);
    expect(state.completedDispatchResults.has(dispatchAttemptKey)).toBe(false);
    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: false,
          reasonCode: "runtime_coordinator.execution_id_missing",
          status: "rejected_terminal",
        }),
      })
    );

    const eventCalls = getRuntimeCoordinatorEventCalls(recordingD1.calls);
    expect(eventCalls).toHaveLength(1);
    expect(eventCalls[0]?.params[1]).toBe(RUNTIME_COORDINATOR_EXECUTION_ID);
    expect(eventCalls[0]?.params[2]).toBe(
      "runtime_coordinator_execution_id_missing"
    );
    expect(
      recordingD1.calls.some((call) =>
        call.query.includes("openMeldDaemon_dispatch_result_inbox")
      )
    ).toBe(false);
  });

  it("records a mismatched result id against the authoritative pending execution, not the echoed wrong id", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        runtimeCoordinatorExecutionId: WRONG_RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    const dispatchAttemptKey = buildDispatchAttemptKey(
      "dispatch-1",
      "attempt-1"
    );
    expect(state.pendingDispatches.has(dispatchAttemptKey)).toBe(true);
    expect(state.completedDispatchResults.has(dispatchAttemptKey)).toBe(false);
    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: false,
          reasonCode: "runtime_coordinator.execution_id_mismatch",
          status: "rejected_terminal",
        }),
      })
    );

    const eventCalls = getRuntimeCoordinatorEventCalls(recordingD1.calls);
    expect(eventCalls).toHaveLength(1);
    expect(eventCalls[0]?.params[1]).toBe(RUNTIME_COORDINATOR_EXECUTION_ID);
    expect(eventCalls[0]?.params[1]).not.toBe(
      WRONG_RUNTIME_COORDINATOR_EXECUTION_ID
    );
    expect(eventCalls[0]?.params[2]).toBe(
      "runtime_coordinator_execution_id_mismatch"
    );
    expect(JSON.parse(String(eventCalls[0]?.params[7]))).toEqual(
      expect.objectContaining({
        requestRuntimeCoordinatorExecutionId:
          WRONG_RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );
  });

  it("rejects a result with an unknown coordinator execution id after pending state is gone without writing to that id", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();
    state.pendingDispatches.clear();

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        runtimeCoordinatorExecutionId: WRONG_RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: false,
          reasonCode: "runtime_coordinator.execution_id_mismatch",
          status: "rejected_terminal",
        }),
      })
    );
    expect(getRuntimeCoordinatorEventCalls(recordingD1.calls)).toHaveLength(0);
    expect(
      recordingD1.calls.some((call) =>
        call.query.includes("openMeldDaemon_dispatch_result_inbox")
      )
    ).toBe(false);
  });

  it("rejects a lifecycle frame with a wrong coordinator execution id before advancing lifecycle state", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();

    await (
      hub as unknown as {
        handleDispatchLifecycleFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchLifecycleFrame(
      socket,
      buildLifecycleRequest({
        runtimeCoordinatorExecutionId: WRONG_RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    const pending = state.pendingDispatches.get(
      buildDispatchAttemptKey("dispatch-1", "attempt-1")
    );
    expect(pending?.phase).toBe("starting");
    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.error",
        payload: expect.objectContaining({
          code: "runtime_coordinator.execution_id_mismatch",
        }),
      })
    );

    const eventCalls = getRuntimeCoordinatorEventCalls(recordingD1.calls);
    expect(eventCalls).toHaveLength(1);
    expect(eventCalls[0]?.params[1]).toBe(RUNTIME_COORDINATOR_EXECUTION_ID);
    expect(eventCalls[0]?.params[2]).toBe(
      "runtime_coordinator_execution_id_mismatch"
    );
  });

  it("advances lifecycle only after validating the echoed execution token", async () => {
    const { hub, recordingD1, sentFrames, socket, state, storageRecords } =
      createHarness();
    const publishAgentReadinessInvalidated = vi.fn();
    (
      hub as unknown as {
        publishAgentReadinessInvalidated: (input: {
          profileIds: readonly string[];
          reason: string;
        }) => void;
      }
    ).publishAgentReadinessInvalidated = publishAgentReadinessInvalidated;
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    const authorityBefore = [...storageRecords.values()].find(
      (value): value is RuntimeCoordinatorExecutionTokenAuthorityRecord =>
        value !== null && typeof value === "object" && "runsById" in value
    );
    expect(authorityBefore?.runsById[executionToken.runId]).toMatchObject({
      tokenStatus: "active",
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchLifecycleFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchLifecycleFrame(
      socket,
      buildLifecycleRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    const pending = state.pendingDispatches.get(
      buildDispatchAttemptKey("dispatch-1", "attempt-1")
    );
    expect(pending?.phase).toBe("running");
    expect(sentFrames).toEqual([]);
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "lifecycle_running"
      )
    ).toBe(true);
    const readinessImpactClear = recordingD1.calls.find((call) =>
      call.query.includes(
        "UPDATE openMeldDaemon_agent_execution_readiness_impacts"
      )
    );
    expect(readinessImpactClear?.params.slice(3, 8)).toEqual([
      TARGET_AGENT_PROFILE_ID,
      "binding-1",
      "runtime-1",
      "builtin:codex",
      executionToken.issuedAtMs,
    ]);
    expect(publishAgentReadinessInvalidated).toHaveBeenCalledWith({
      profileIds: [TARGET_AGENT_PROFILE_ID],
      reason: "matching_execution_running",
    });
  });

  it("rejects a lifecycle frame that omits the execution token before advancing lifecycle state", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();
    await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchLifecycleFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchLifecycleFrame(
      socket,
      buildLifecycleRequest({
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    const pending = state.pendingDispatches.get(
      buildDispatchAttemptKey("dispatch-1", "attempt-1")
    );
    expect(pending?.phase).toBe("starting");
    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.error",
        payload: expect.objectContaining({
          code: "execution_token_missing",
        }),
      })
    );
    const tokenEvent = getRuntimeCoordinatorEventCalls(recordingD1.calls).find(
      (call) => call.params[2] === "execution_token_validation_failed"
    );
    expect(tokenEvent?.params[1]).toBe(RUNTIME_COORDINATOR_EXECUTION_ID);
    expect(JSON.parse(String(tokenEvent?.params[7]))).toEqual(
      expect.objectContaining({
        frameKind: "lifecycle",
        reasonCode: "execution_token_missing",
      })
    );
  });

  it("rejects a lifecycle frame with an unknown execution token before advancing lifecycle state", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchLifecycleFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchLifecycleFrame(
      socket,
      buildLifecycleRequest({
        executionTokenEcho: {
          ...buildExecutionTokenEcho(executionToken),
          executionToken: `rcet_v1_${"b".repeat(64)}`,
        },
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    const pending = state.pendingDispatches.get(
      buildDispatchAttemptKey("dispatch-1", "attempt-1")
    );
    expect(pending?.phase).toBe("starting");
    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.error",
        payload: expect.objectContaining({
          code: "execution_token_unknown",
        }),
      })
    );
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "execution_token_validation_failed"
      )
    ).toBe(true);
  });

  it("rejects runtime evidence that omits the execution token before writing evidence", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();
    await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchRuntimeEvidenceFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchRuntimeEvidenceFrame(
      socket,
      buildRuntimeEvidenceRequest({
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.error",
        payload: expect.objectContaining({
          code: "execution_token_missing",
        }),
      })
    );
    const eventTypes = getRuntimeCoordinatorEventCalls(recordingD1.calls).map(
      (call) => call.params[2]
    );
    expect(eventTypes).toContain("execution_token_validation_failed");
    expect(eventTypes).not.toContain("runtime_evidence_observed");
  });

  it("applies authority-bound Local Agent tool activity to the shared Space stream", async () => {
    const { hub, sentFrames, socket, spaceStub, state } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchToolActivityFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchToolActivityFrame(
      socket,
      buildToolActivityRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
      })
    );

    expect(spaceStub.rpcApplyAgentStreamPart).toHaveBeenCalledWith({
      v: 1,
      dispatchId: "dispatch-1",
      part: {
        type: "tool",
        toolCallId: "tool-call-1",
        toolName: "agent_run_command",
        state: "input-available",
      },
      profileId: TARGET_AGENT_PROFILE_ID,
      sequence: 1,
      spaceId: HEX_SPACE_ID,
      streamId: "local-agent:10.dispatch-1:9.attempt-1",
      triggerMessageId: "signal-1",
    });
    expect(sentFrames).toEqual([]);
  });

  it("projects and resolves one urgent Inbox action for the interaction owner", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
      threadContext: {
        rootSignalId: "thread-root-1",
        threadId: "thr_00000000-0000-4000-8000-000000000001",
      },
    });
    enableLocalAgentInteraction(state);

    await (
      hub as unknown as {
        handleDispatchInteractionRequestFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchInteractionRequestFrame(
      socket,
      buildInteractionRequest(executionToken)
    );

    expect([...recordingD1.interactionInboxRows.values()]).toEqual([
      expect.objectContaining({
        attention: "action_required",
        importance: "urgent",
        kind: "agent_interaction",
        organization_id: "org-one",
        recipient_user_id: "owner-1",
        resolution_status: "open",
        title: "Approval required",
      }),
    ]);
    const projectedInboxItem = [
      ...recordingD1.interactionInboxRows.values(),
    ][0];
    expect(JSON.parse(String(projectedInboxItem?.source_target_json))).toEqual({
      interactionId: "interaction-1",
      kind: "agent_interaction",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      sourceSignalId: "signal-1",
      spaceId: HEX_SPACE_ID,
      threadRootSignalId: "thread-root-1",
    });

    const respondResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/interaction/respond",
      {
        actorOwnerUserId: "owner-1",
        interactionId: "interaction-1",
        response: {
          kind: "permission",
          optionId: "allow-once",
        },
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      }
    );

    expect(respondResponse.status).toBe(200);
    await expect(respondResponse.json()).resolves.toMatchObject({
      ok: true,
      status: "accepted",
    });
    expect([...recordingD1.interactionInboxRows.values()]).toEqual([
      expect.objectContaining({ resolution_status: "resolved" }),
    ]);
  });

  it("keeps the pending interaction authoritative when Inbox creation fails", async () => {
    const { hub, recordingD1, sentFrames, socket, state, storageRecords } =
      createHarness({ interactionInboxWriteFailures: 1 });
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    enableLocalAgentInteraction(state);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      (
        hub as unknown as {
          handleDispatchInteractionRequestFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchInteractionRequestFrame(
        socket,
        buildInteractionRequest(executionToken)
      )
    ).resolves.toBeUndefined();

    expect(recordingD1.interactionInboxRows.size).toBe(0);
    expect(findRuntimeCoordinatorRunCommandState(storageRecords)).toMatchObject(
      {
        pendingInteraction: {
          request: { interactionId: "interaction-1" },
          response: null,
        },
      }
    );
  });

  it("repairs a transient Inbox creation failure on exact interaction replay", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness({
      interactionInboxWriteFailures: 1,
    });
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    enableLocalAgentInteraction(state);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const request = buildInteractionRequest(executionToken);

    const handleInteraction = () =>
      (
        hub as unknown as {
          handleDispatchInteractionRequestFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchInteractionRequestFrame(socket, request);

    await handleInteraction();
    expect(recordingD1.interactionInboxRows.size).toBe(0);

    await handleInteraction();
    expect([...recordingD1.interactionInboxRows.values()]).toEqual([
      expect.objectContaining({
        recipient_user_id: "owner-1",
        resolution_status: "open",
      }),
    ]);
  });

  it("repairs a transient Inbox creation failure from durable alarm state after restart", async () => {
    const nowMs = 1_700_000_000_000;
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);
    try {
      const first = createHarness({ interactionInboxWriteFailures: 1 });
      const executionToken = await issueDeliveryToken({
        hub: first.hub,
        sentFrames: first.sentFrames,
        socket: first.socket,
        state: first.state,
      });
      enableLocalAgentInteraction(first.state);
      vi.spyOn(console, "warn").mockImplementation(() => undefined);

      await (
        first.hub as unknown as {
          handleDispatchInteractionRequestFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchInteractionRequestFrame(
        first.socket,
        buildInteractionRequest(executionToken)
      );
      expect(first.recordingD1.interactionInboxRows.size).toBe(0);

      const restarted = createHarness({
        storageRecords: first.storageRecords,
      });
      dateNow.mockReturnValue(nowMs + 1000);
      await (
        restarted.hub as unknown as { alarm: () => Promise<void> }
      ).alarm();

      expect([...restarted.recordingD1.interactionInboxRows.values()]).toEqual([
        expect.objectContaining({
          recipient_user_id: "owner-1",
          resolution_status: "open",
        }),
      ]);
      expect(
        findRuntimeCoordinatorRunCommandState(restarted.storageRecords)
      ).toMatchObject({
        pendingInteraction: {
          request: { interactionId: "interaction-1" },
          response: null,
        },
      });
    } finally {
      dateNow.mockRestore();
    }
  });

  it("finishes a legacy open repair after its legacy Inbox item was already written", async () => {
    const nowMs = 1_700_000_000_000;
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);
    try {
      const { hub, recordingD1, sentFrames, socket, state, storageRecords } =
        createHarness();
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      enableLocalAgentInteraction(state);
      await (
        hub as unknown as {
          handleDispatchInteractionRequestFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchInteractionRequestFrame(
        socket,
        buildInteractionRequest(executionToken)
      );

      const inboxRow = [...recordingD1.interactionInboxRows.values()][0];
      if (!inboxRow) {
        throw new Error("Expected the interaction Inbox item.");
      }
      const { threadRootSignalId: _threadRootSignalId, ...legacySourceTarget } =
        JSON.parse(String(inboxRow.source_target_json)) as Record<
          string,
          unknown
        >;
      inboxRow.source_target_json = JSON.stringify(legacySourceTarget);

      const repairStorageKey = `runtime-coordinator:interaction-inbox-repair:${RUNTIME_COORDINATOR_EXECUTION_ID}`;
      storageRecords.set(repairStorageKey, {
        attemptCount: 1,
        desiredStatus: "open",
        interaction: {
          interactionId: "interaction-1",
          kind: "permission",
          requestedAtMs: nowMs,
        },
        nextAttemptAtMs: nowMs,
        ownerUserId: "owner-1",
        resolvedAtMs: null,
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        sourceSignalId: "signal-1",
        spaceId: HEX_SPACE_ID,
        targetProfileName: "Codex Agent",
        updatedAtMs: nowMs,
        v: 1,
      });

      dateNow.mockReturnValue(nowMs + 1000);
      await (hub as unknown as { alarm: () => Promise<void> }).alarm();

      expect(storageRecords.has(repairStorageKey)).toBe(false);
      expect(JSON.parse(String(inboxRow.source_target_json))).toEqual(
        legacySourceTarget
      );
    } finally {
      dateNow.mockRestore();
    }
  });

  it("accepts the owner response when Inbox resolution fails", async () => {
    const { hub, recordingD1, sentFrames, socket, state, storageRecords } =
      createHarness({ interactionInboxResolveFailures: 1 });
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    enableLocalAgentInteraction(state);
    await (
      hub as unknown as {
        handleDispatchInteractionRequestFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchInteractionRequestFrame(
      socket,
      buildInteractionRequest(executionToken)
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const respondResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/interaction/respond",
      {
        actorOwnerUserId: "owner-1",
        interactionId: "interaction-1",
        response: {
          kind: "permission",
          optionId: "allow-once",
        },
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      }
    );

    expect(respondResponse.status).toBe(200);
    await expect(respondResponse.json()).resolves.toMatchObject({
      ok: true,
      status: "accepted",
    });
    expect([...recordingD1.interactionInboxRows.values()]).toEqual([
      expect.objectContaining({ resolution_status: "open" }),
    ]);
    expect(findRuntimeCoordinatorRunCommandState(storageRecords)).toMatchObject(
      {
        pendingInteraction: {
          request: { interactionId: "interaction-1" },
          response: { kind: "permission", optionId: "allow-once" },
        },
      }
    );
  });

  it("resolves a responded interaction from durable alarm state", async () => {
    const nowMs = 1_700_000_000_000;
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);
    try {
      const { hub, recordingD1, sentFrames, socket, state, storageRecords } =
        createHarness({ interactionInboxResolveFailures: 1 });
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      enableLocalAgentInteraction(state);
      await (
        hub as unknown as {
          handleDispatchInteractionRequestFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchInteractionRequestFrame(
        socket,
        buildInteractionRequest(executionToken)
      );
      vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const respondResponse = await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/interaction/respond",
        {
          actorOwnerUserId: "owner-1",
          interactionId: "interaction-1",
          response: {
            kind: "permission",
            optionId: "allow-once",
          },
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        }
      );
      expect(respondResponse.status).toBe(200);
      expect([...recordingD1.interactionInboxRows.values()]).toEqual([
        expect.objectContaining({ resolution_status: "open" }),
      ]);

      dateNow.mockReturnValue(nowMs + 1000);
      await (hub as unknown as { alarm: () => Promise<void> }).alarm();

      expect([...recordingD1.interactionInboxRows.values()]).toEqual([
        expect.objectContaining({ resolution_status: "resolved" }),
      ]);
      expect(
        findRuntimeCoordinatorRunCommandState(storageRecords)
      ).toMatchObject({
        pendingInteraction: {
          request: { interactionId: "interaction-1" },
          response: { kind: "permission", optionId: "allow-once" },
        },
      });
    } finally {
      dateNow.mockRestore();
    }
  });

  it("does not let an older open repair delete a newer resolved generation", async () => {
    const { hub, storageRecords } = createHarness();
    const storageKey = `runtime-coordinator:interaction-inbox-repair:${RUNTIME_COORDINATOR_EXECUTION_ID}`;
    const olderOpenRepair = {
      attemptCount: 1,
      desiredStatus: "open",
      interaction: {
        interactionId: "interaction-1",
        kind: "permission",
        requestedAtMs: 100,
      },
      nextAttemptAtMs: 200,
      ownerUserId: "owner-1",
      resolvedAtMs: null,
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      spaceId: HEX_SPACE_ID,
      targetProfileName: "Codex Agent",
      updatedAtMs: 100,
      v: 1,
    };
    const newerResolvedRepair = {
      ...olderOpenRepair,
      desiredStatus: "resolved",
      nextAttemptAtMs: 300,
      resolvedAtMs: 250,
      updatedAtMs: 250,
    };
    storageRecords.set(storageKey, newerResolvedRepair);

    await (
      hub as unknown as {
        removeRuntimeCoordinatorInteractionInboxRepair: (
          record: unknown
        ) => Promise<void>;
      }
    ).removeRuntimeCoordinatorInteractionInboxRepair(olderOpenRepair);

    expect(storageRecords.get(storageKey)).toEqual(newerResolvedRepair);
  });

  it("persists, privacy-projects, responds to, and acknowledges a Local Agent interaction", async () => {
    const { hub, sentFrames, socket, state } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    enableLocalAgentInteraction(state);
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchInteractionRequestFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchInteractionRequestFrame(
      socket,
      buildInteractionRequest(executionToken)
    );

    const ownerReadResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/interaction/read",
      {
        actorOwnerUserId: "owner-1",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      }
    );
    await expect(ownerReadResponse.json()).resolves.toMatchObject({
      pendingInteraction: {
        canRespond: true,
        interactionId: "interaction-1",
        kind: "permission",
        request: {
          kind: "permission",
          title: "Allow this command?",
        },
      },
    });

    const otherMemberReadResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/interaction/read",
      {
        actorOwnerUserId: "other-space-member",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      }
    );
    await expect(otherMemberReadResponse.json()).resolves.toMatchObject({
      pendingInteraction: {
        canRespond: false,
        interactionId: "interaction-1",
        kind: "permission",
        request: null,
      },
    });

    const respondResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/interaction/respond",
      {
        actorOwnerUserId: "owner-1",
        interactionId: "interaction-1",
        response: {
          kind: "permission",
          optionId: "allow-once",
        },
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      }
    );
    await expect(respondResponse.json()).resolves.toMatchObject({
      ok: true,
      status: "accepted",
    });
    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.interaction_response",
        payload: expect.objectContaining({
          interactionId: "interaction-1",
          response: {
            kind: "permission",
            optionId: "allow-once",
          },
        }),
      })
    );

    await (
      hub as unknown as {
        handleDispatchInteractionDeliveredFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchInteractionDeliveredFrame(
      socket,
      buildInteractionDeliveredRequest(executionToken)
    );
    const commandState = await (
      hub as unknown as {
        readRuntimeCoordinatorRunCommandState: (
          runtimeCoordinatorExecutionId: string
        ) => Promise<{ pendingInteraction?: unknown } | null>;
      }
    ).readRuntimeCoordinatorRunCommandState(RUNTIME_COORDINATOR_EXECUTION_ID);
    expect(commandState?.pendingInteraction).toBeNull();
  });

  it("restores a pending Local Agent interaction after restart and replays its response after reconnect", async () => {
    const first = createHarness();
    const executionToken = await issueDeliveryToken({
      hub: first.hub,
      sentFrames: first.sentFrames,
      socket: first.socket,
      state: first.state,
    });
    enableLocalAgentInteraction(first.state);

    await (
      first.hub as unknown as {
        handleDispatchInteractionRequestFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchInteractionRequestFrame(
      first.socket,
      buildInteractionRequest(executionToken)
    );

    const restarted = createHarness({
      storageRecords: first.storageRecords,
    });
    const restoredReadResponse = await fetchRuntimeTransportJson(
      restarted.hub,
      "/runtime-coordinator/interaction/read",
      {
        actorOwnerUserId: "owner-1",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      }
    );
    await expect(restoredReadResponse.json()).resolves.toMatchObject({
      pendingInteraction: {
        canRespond: true,
        interactionId: "interaction-1",
        request: {
          kind: "permission",
          title: "Allow this command?",
        },
      },
    });

    const respondResponse = await fetchRuntimeTransportJson(
      restarted.hub,
      "/runtime-coordinator/interaction/respond",
      {
        actorOwnerUserId: "owner-1",
        interactionId: "interaction-1",
        response: {
          kind: "permission",
          optionId: "allow-once",
        },
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      }
    );
    await expect(respondResponse.json()).resolves.toMatchObject({
      ok: true,
      status: "accepted",
    });
    expect(restarted.sentFrames).toEqual([]);

    configureCompatibleRoute({
      socket: restarted.socket,
      state: restarted.state,
    });
    enableLocalAgentInteraction(restarted.state);
    await (
      restarted.hub as unknown as {
        replayRuntimeCoordinatorInteractionResponsesForSession: (
          daemonSessionId: string
        ) => Promise<void>;
      }
    ).replayRuntimeCoordinatorInteractionResponsesForSession(
      "daemon-session-1"
    );

    expect(restarted.sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.interaction_response",
        payload: expect.objectContaining({
          interactionId: "interaction-1",
          response: {
            kind: "permission",
            optionId: "allow-once",
          },
        }),
      })
    );

    await (
      restarted.hub as unknown as {
        handleDispatchInteractionDeliveredFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchInteractionDeliveredFrame(
      restarted.socket,
      buildInteractionDeliveredRequest(executionToken)
    );
    const commandState = await (
      restarted.hub as unknown as {
        readRuntimeCoordinatorRunCommandState: (
          runtimeCoordinatorExecutionId: string
        ) => Promise<{ pendingInteraction?: unknown } | null>;
      }
    ).readRuntimeCoordinatorRunCommandState(RUNTIME_COORDINATOR_EXECUTION_ID);
    expect(commandState?.pendingInteraction).toBeNull();
  });

  it("cancels an expired Local Agent interaction without expiring the Wake watchdog", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    enableLocalAgentInteraction(state);
    sentFrames.length = 0;
    const request = buildInteractionRequest(executionToken);

    await (
      hub as unknown as {
        handleDispatchInteractionRequestFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchInteractionRequestFrame(socket, request);
    const commandState = await (
      hub as unknown as {
        readRuntimeCoordinatorRunCommandState: (
          runtimeCoordinatorExecutionId: string
        ) => Promise<RuntimeCoordinatorRunCommandState | null>;
      }
    ).readRuntimeCoordinatorRunCommandState(RUNTIME_COORDINATOR_EXECUTION_ID);
    if (!commandState) {
      throw new Error("Expected persisted RuntimeCoordinator command state.");
    }

    await (
      hub as unknown as {
        processRuntimeCoordinatorWatchdogDue: (input: {
          commandState: RuntimeCoordinatorRunCommandState;
          nextCheckAtMs: number;
          nowMs: number;
        }) => Promise<void>;
      }
    ).processRuntimeCoordinatorWatchdogDue({
      commandState,
      nextCheckAtMs: request.interaction.expiresAtMs,
      nowMs: request.interaction.expiresAtMs + 1,
    });

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.interaction_response",
        payload: expect.objectContaining({
          interactionId: "interaction-1",
          response: { kind: "cancel" },
        }),
      })
    );
    const expiredState = await (
      hub as unknown as {
        readRuntimeCoordinatorRunCommandState: (
          runtimeCoordinatorExecutionId: string
        ) => Promise<RuntimeCoordinatorRunCommandState | null>;
      }
    ).readRuntimeCoordinatorRunCommandState(RUNTIME_COORDINATOR_EXECUTION_ID);
    expect(expiredState).toMatchObject({
      lastCommandReasonCode: "runtime_coordinator.interaction_expired",
      pendingInteraction: {
        response: { kind: "cancel" },
      },
    });
    expect([...recordingD1.interactionInboxRows.values()]).toEqual([
      expect.objectContaining({ resolution_status: "resolved" }),
    ]);
  });

  it("bounds daemon-supplied Local Agent interaction timestamps to the Core window", async () => {
    const { hub, sentFrames, socket, state } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    enableLocalAgentInteraction(state);
    const observedAtMs = Date.now();
    const request = buildInteractionRequest(executionToken);
    request.interaction = {
      ...request.interaction,
      expiresAtMs: observedAtMs + 365 * 24 * 60 * 60 * 1000,
      requestedAtMs: observedAtMs + 365 * 24 * 60 * 60 * 1000,
    };

    await (
      hub as unknown as {
        handleDispatchInteractionRequestFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchInteractionRequestFrame(socket, request);

    const ownerReadResponse = await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/interaction/read",
      {
        actorOwnerUserId: "owner-1",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      }
    );
    const ownerRead = (await ownerReadResponse.json()) as {
      pendingInteraction: {
        expiresAtMs: number;
        requestedAtMs: number;
      };
    };
    expect(ownerRead.pendingInteraction.requestedAtMs).toBeGreaterThanOrEqual(
      observedAtMs
    );
    expect(ownerRead.pendingInteraction.requestedAtMs).toBeLessThanOrEqual(
      Date.now()
    );
    expect(ownerRead.pendingInteraction.expiresAtMs).toBeLessThanOrEqual(
      Date.now() + 8 * 60 * 60 * 1000
    );
  });

  it("redrives a durable interaction observation after the first Agent Task write fails", async () => {
    const storageRecords = new Map<string, unknown>();
    const first = createHarness({
      storageRecords,
      taskNeedsAttentionObservationWriteFailures: 1,
    });
    const executionToken = await issueDeliveryToken({
      hub: first.hub,
      sentFrames: first.sentFrames,
      socket: first.socket,
      state: first.state,
    });
    enableLocalAgentInteraction(first.state);

    await (
      first.hub as unknown as {
        handleDispatchInteractionRequestFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchInteractionRequestFrame(
      first.socket,
      buildInteractionRequest(executionToken)
    );

    expect(first.recordingD1.taskNeedsAttentionObservationRows.size).toBe(0);
    expect(
      storageRecords.get(
        "runtime-coordinator:agent-task-observation-delivery:index"
      )
    ).toEqual([
      `agent-task-observation:${RUNTIME_COORDINATOR_EXECUTION_ID}:runtime-coordinator-interaction:${RUNTIME_COORDINATOR_EXECUTION_ID}:interaction-1`,
    ]);
    expect(
      [...storageRecords.values()].find(
        (value) =>
          value !== null &&
          typeof value === "object" &&
          (value as { deliveryId?: unknown }).deliveryId ===
            `agent-task-observation:${RUNTIME_COORDINATOR_EXECUTION_ID}:runtime-coordinator-interaction:${RUNTIME_COORDINATOR_EXECUTION_ID}:interaction-1`
      )
    ).toMatchObject({
      observation: {
        eventId: `runtime-coordinator-interaction:${RUNTIME_COORDINATOR_EXECUTION_ID}:interaction-1`,
        status: "needs_attention",
      },
      status: "pending",
    });

    const restarted = createHarness({ storageRecords });
    expect(first.queuedObservationRedrives).toHaveLength(1);
    await deliverAgentTaskObservationRedriveThroughQueue({
      body: first.queuedObservationRedrives[0],
      db: restarted.recordingD1.db,
      hub: restarted.hub,
    });

    expect(restarted.recordingD1.taskNeedsAttentionObservationRows.size).toBe(
      1
    );
    expect(
      storageRecords.get(
        "runtime-coordinator:agent-task-observation-delivery:index"
      )
    ).toEqual([]);
    expect(
      [...storageRecords.values()].find(
        (value) =>
          value !== null &&
          typeof value === "object" &&
          (value as { deliveryId?: unknown }).deliveryId ===
            `agent-task-observation:${RUNTIME_COORDINATOR_EXECUTION_ID}:runtime-coordinator-interaction:${RUNTIME_COORDINATOR_EXECUTION_ID}:interaction-1`
      )
    ).toMatchObject({
      projectedAtMs: expect.any(Number),
      status: "projected",
    });
  });

  it("fails the interaction acknowledgement when both immediate projection and durable alarm scheduling fail", async () => {
    const storageRecords = new Map<string, unknown>();
    const first = createHarness({
      storageRecords,
      taskNeedsAttentionObservationWriteFailures: 1,
    });
    const executionToken = await issueDeliveryToken({
      hub: first.hub,
      sentFrames: first.sentFrames,
      socket: first.socket,
      state: first.state,
    });
    enableLocalAgentInteraction(first.state);
    await Promise.all(first.waitUntilTasks);
    (
      first.hub as unknown as {
        scheduledHousekeepingAlarmAtMs: number | null | undefined;
      }
    ).scheduledHousekeepingAlarmAtMs = null;
    first.storageSetAlarm.mockRejectedValue(
      new Error("durable object alarm unavailable")
    );

    await expect(
      (
        first.hub as unknown as {
          handleDispatchInteractionRequestFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchInteractionRequestFrame(
        first.socket,
        buildInteractionRequest(executionToken)
      )
    ).rejects.toThrow("durable object alarm unavailable");

    expect(first.recordingD1.taskNeedsAttentionObservationRows.size).toBe(0);
    expect(
      storageRecords.get(
        "runtime-coordinator:agent-task-observation-delivery:index"
      )
    ).toHaveLength(1);

    expect(first.queuedObservationRedrives).toHaveLength(1);
    const restarted = createHarness({ storageRecords });
    await deliverAgentTaskObservationRedriveThroughQueue({
      body: first.queuedObservationRedrives[0],
      db: restarted.recordingD1.db,
      hub: restarted.hub,
    });
    await deliverAgentTaskObservationRedriveThroughQueue({
      body: first.queuedObservationRedrives[0],
      db: restarted.recordingD1.db,
      hub: restarted.hub,
    });

    expect(restarted.recordingD1.taskNeedsAttentionObservationRows.size).toBe(
      1
    );
    expect(
      storageRecords.get(
        "runtime-coordinator:agent-task-observation-delivery:index"
      )
    ).toEqual([]);
  });

  it("does not report terminal failure publication success when task projection and alarm scheduling both fail", async () => {
    const storageRecords = new Map<string, unknown>();
    const first = createHarness({
      storageRecords,
      taskTerminalOutcomeWriteFailures: 1,
    });
    await issueDeliveryToken({
      hub: first.hub,
      sentFrames: first.sentFrames,
      socket: first.socket,
      state: first.state,
    });
    await Promise.all(first.waitUntilTasks);
    const commandState = findRuntimeCoordinatorRunCommandState(storageRecords);
    if (!commandState) {
      throw new Error("Expected a durable RuntimeCoordinator command state.");
    }
    (
      first.hub as unknown as {
        scheduledHousekeepingAlarmAtMs: number | null | undefined;
      }
    ).scheduledHousekeepingAlarmAtMs = null;
    first.storageSetAlarm.mockRejectedValueOnce(
      new Error("durable object alarm unavailable")
    );

    const publication = await (
      first.hub as unknown as {
        publishRuntimeCoordinatorDeliveryExpiredFailure: (input: {
          commandState: RuntimeCoordinatorRunCommandState;
          nowMs: number;
          reasonCode: "runtime_coordinator.delivery_expired";
        }) => Promise<{
          ok: boolean;
          publishedSignalId?: string;
          reasonCode?: string;
        }>;
      }
    ).publishRuntimeCoordinatorDeliveryExpiredFailure({
      commandState,
      nowMs: 1_700_000_031_000,
      reasonCode: "runtime_coordinator.delivery_expired",
    });

    expect(publication).toEqual({
      ok: false,
      reasonCode: "runtime_coordinator.failure_publication_unavailable",
    });
    expect(first.spaceFetchRequests).toHaveLength(1);
    expect(first.recordingD1.taskTerminalOutcomeRows.size).toBe(0);
    expect(
      storageRecords.get(
        "runtime-coordinator:agent-task-observation-delivery:index"
      )
    ).toHaveLength(1);

    expect(first.queuedObservationRedrives).toHaveLength(1);
    const restarted = createHarness({ storageRecords });
    await deliverAgentTaskObservationRedriveThroughQueue({
      body: first.queuedObservationRedrives[0],
      db: restarted.recordingD1.db,
      hub: restarted.hub,
    });
    await deliverAgentTaskObservationRedriveThroughQueue({
      body: first.queuedObservationRedrives[0],
      db: restarted.recordingD1.db,
      hub: restarted.hub,
    });

    expect(restarted.recordingD1.taskTerminalOutcomeRows.size).toBe(1);
    expect(
      storageRecords.get(
        "runtime-coordinator:agent-task-observation-delivery:index"
      )
    ).toEqual([]);
    expect(first.spaceFetchRequests).toHaveLength(1);
  });

  it("orders Local Agent tool activity before its result without blocking heartbeat frames", async () => {
    const { hub, sentFrames, socket, spaceStub, state } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    sentFrames.length = 0;

    const toolActivity = Promise.withResolvers<{
      lastSequence: number;
      status: "accepted";
    }>();
    spaceStub.rpcApplyAgentStreamPart.mockImplementationOnce(
      () => toolActivity.promise
    );
    const originalResultHandler = (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame.bind(hub);
    const handleDispatchResultFrame = vi.fn(originalResultHandler);
    Object.defineProperty(hub, "handleDispatchResultFrame", {
      configurable: true,
      value: handleDispatchResultFrame,
    });
    const handleHeartbeatFrame = vi.fn();
    Object.defineProperty(hub, "handleHeartbeatFrame", {
      configurable: true,
      value: handleHeartbeatFrame,
    });

    RuntimeTransportHub.prototype.webSocketMessage.call(
      hub,
      socket,
      JSON.stringify({
        code: "daemon.dispatch.tool_activity",
        payload: buildToolActivityRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
        }),
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      })
    );
    RuntimeTransportHub.prototype.webSocketMessage.call(
      hub,
      socket,
      JSON.stringify({
        code: "daemon.session.heartbeat",
        payload: {},
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      })
    );
    RuntimeTransportHub.prototype.webSocketMessage.call(
      hub,
      socket,
      JSON.stringify({
        code: "daemon.dispatch.result",
        payload: buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        }),
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      })
    );

    expect(handleHeartbeatFrame).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(spaceStub.rpcApplyAgentStreamPart).toHaveBeenCalledTimes(1);
    });
    expect(handleDispatchResultFrame).not.toHaveBeenCalled();

    toolActivity.resolve({ lastSequence: 1, status: "accepted" });
    await vi.waitFor(() => {
      expect(handleDispatchResultFrame).toHaveBeenCalledTimes(1);
      expect(sentFrames).toContainEqual(
        expect.objectContaining({
          code: "daemon.dispatch.accepted",
          payload: expect.objectContaining({ ok: true }),
        })
      );
    });
  });

  it("continues ordered result handling after tool activity fails and releases the dispatch queue", async () => {
    const { hub, sentFrames, socket, spaceStub, state } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    sentFrames.length = 0;
    spaceStub.rpcApplyAgentStreamPart.mockRejectedValueOnce(
      new Error("Space tool activity unavailable")
    );

    RuntimeTransportHub.prototype.webSocketMessage.call(
      hub,
      socket,
      JSON.stringify({
        code: "daemon.dispatch.tool_activity",
        payload: buildToolActivityRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
        }),
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      })
    );
    RuntimeTransportHub.prototype.webSocketMessage.call(
      hub,
      socket,
      JSON.stringify({
        code: "daemon.dispatch.result",
        payload: buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        }),
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      })
    );

    await vi.waitFor(() => {
      expect(sentFrames).toContainEqual(
        expect.objectContaining({
          code: "daemon.dispatch.accepted",
          payload: expect.objectContaining({ ok: true }),
        })
      );
    });
    await vi.waitFor(() => {
      expect(
        (
          hub as unknown as {
            orderedDispatchFrameTails: Map<string, Promise<void>>;
          }
        ).orderedDispatchFrameTails.size
      ).toBe(0);
    });
  });

  it("rejects Local Agent tool activity without an execution token", async () => {
    const { hub, sentFrames, socket, spaceStub, state } = createHarness();
    await issueDeliveryToken({ hub, sentFrames, socket, state });
    sentFrames.length = 0;

    const request = buildToolActivityRequest();
    await (
      hub as unknown as {
        handleDispatchToolActivityFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchToolActivityFrame(socket, {
      ...request,
      executionTokenEcho: undefined,
    });

    expect(spaceStub.rpcApplyAgentStreamPart).not.toHaveBeenCalled();
    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.error",
        payload: expect.objectContaining({
          code: "execution_token_missing",
        }),
      })
    );
  });

  it("rejects Local Agent tool activity that targets another source message", async () => {
    const { hub, sentFrames, socket, spaceStub, state } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchToolActivityFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchToolActivityFrame(
      socket,
      buildToolActivityRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        sourceSignalId: "signal-other",
      })
    );

    expect(spaceStub.rpcApplyAgentStreamPart).not.toHaveBeenCalled();
    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.error",
        payload: expect.objectContaining({ code: "schema.invalid" }),
      })
    );
  });

  it("rejects Local Agent tool activity from a replaced connection after execution starts", async () => {
    const { hub, sentFrames, socket, spaceStub, state } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    const pending = state.pendingDispatches.get("dispatch-1::attempt-1");
    if (!pending) {
      throw new Error("test_pending_dispatch_missing");
    }
    pending.phase = "running";
    pending.runningAtMs = 1_700_000_000_100;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchToolActivityFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchToolActivityFrame(
      socket,
      buildToolActivityRequest({
        connectionGeneration: pending.connectionGeneration + 1,
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
      })
    );

    expect(spaceStub.rpcApplyAgentStreamPart).not.toHaveBeenCalled();
    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.error",
        payload: expect.objectContaining({
          code: "daemon.session.connection_replaced",
        }),
      })
    );
  });

  it("accepts Local Agent tool activity from the current reconnected owner", async () => {
    const { hub, sentFrames, socket, spaceStub, state } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    const pending = state.pendingDispatches.get("dispatch-1::attempt-1");
    const session = state.sessionsById.get("daemon-session-1");
    if (!(pending && session)) {
      throw new Error("test_runtime_owner_missing");
    }
    pending.phase = "running";
    pending.runningAtMs = 1_700_000_000_100;
    session.connectionGeneration = pending.connectionGeneration + 1;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchToolActivityFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchToolActivityFrame(
      socket,
      buildToolActivityRequest({
        connectionGeneration: session.connectionGeneration,
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
      })
    );

    expect(spaceStub.rpcApplyAgentStreamPart).toHaveBeenCalledOnce();
    expect(sentFrames).toEqual([]);
  });

  it("rejects a result with an unknown execution token before result inbox acceptance", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: {
          ...buildExecutionTokenEcho(executionToken),
          executionToken: `rcet_v1_${"b".repeat(64)}`,
        },
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(
      state.pendingDispatches.has(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )
    ).toBe(true);
    expect(
      state.completedDispatchResults.has(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )
    ).toBe(false);
    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: false,
          reasonCode: "execution_token_unknown",
          status: "rejected_terminal",
        }),
      })
    );
    expect(
      recordingD1.calls.some((call) =>
        call.query.includes("openMeldDaemon_dispatch_result_inbox")
      )
    ).toBe(false);
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "execution_token_validation_failed"
      )
    ).toBe(true);
  });

  it("rejects a result that omits the execution token before result inbox acceptance", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();
    await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: false,
          reasonCode: "execution_token_missing",
          status: "rejected_terminal",
        }),
      })
    );
    expect(
      recordingD1.calls.some((call) =>
        call.query.includes("openMeldDaemon_dispatch_result_inbox")
      )
    ).toBe(false);
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "execution_token_validation_failed"
      )
    ).toBe(true);
  });

  it("does not let completed cache accept a result after RuntimeCoordinator token authority is terminal", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      recordingD1,
      sentFrames,
      socket,
      state,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(
      state.completedDispatchResults.has(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )
    ).toBe(true);
    recordingD1.calls.length = 0;
    sentFrames.length = 0;
    appliedFinalizationCommands.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: false,
          reasonCode: "execution_token_terminal_late",
          status: "rejected_terminal",
        }),
      })
    );
    expect(
      recordingD1.calls.some((call) =>
        call.query.includes("INSERT INTO openMeldDaemon_dispatch_result_inbox")
      )
    ).toBe(false);
    expect(appliedFinalizationCommands).toHaveLength(0);
  });

  it("retries a result when RuntimeCoordinator token authority is temporarily unreadable", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      recordingD1,
      sentFrames,
      socket,
      state,
      storageRecords,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    const waitUntil = vi.mocked(
      (
        hub as unknown as {
          ctx: {
            waitUntil: (promise: Promise<unknown>) => void;
          };
        }
      ).ctx.waitUntil
    );
    waitUntil.mockClear();
    const storageGet = vi.mocked(
      (
        hub as unknown as {
          ctx: {
            storage: { get: (key: string) => Promise<unknown> };
          };
        }
      ).ctx.storage.get
    );
    storageGet.mockImplementation((key: string) => {
      if (key.includes("runtime-coordinator:execution-token-authority:")) {
        return Promise.reject(new Error("runtime coordinator storage down"));
      }
      return Promise.resolve(storageRecords.get(key));
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;
    appliedFinalizationCommands.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: false,
          reasonCode:
            "runtime_coordinator.execution_token_authority_unavailable",
          status: "retry_later",
        }),
      })
    );
    expect(
      recordingD1.calls.some((call) =>
        call.query.includes("openMeldDaemon_dispatch_result_inbox")
      )
    ).toBe(false);
    expect(appliedFinalizationCommands).toHaveLength(0);
    expect(waitUntil).toHaveBeenCalledTimes(2);
    await Promise.allSettled(waitUntil.mock.calls.map(([promise]) => promise));
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some((call) => {
        const payload = JSON.parse(String(call.params[7]));
        return (
          payload.reasonCode ===
          "runtime_coordinator.execution_token_authority_unavailable"
        );
      })
    ).toBe(true);
  });

  it("acks a token-valid completed-cache replay without publishing a second reply", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      recordingD1,
      sentFrames,
      socket,
      state,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    const replayRequest = buildResultRequest({
      executionTokenEcho: buildExecutionTokenEcho(executionToken),
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
    });
    state.pendingDispatches.clear();
    state.completedDispatchResults.set(
      buildDispatchAttemptKey("dispatch-1", "attempt-1"),
      buildCompletedDispatchResult({
        executionTokenFingerprint: executionToken.tokenFingerprint,
        executionTokenRunId: executionToken.runId,
        taskResult: replayRequest.taskResult,
      })
    );
    recordingD1.calls.length = 0;
    sentFrames.length = 0;
    appliedFinalizationCommands.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(socket, replayRequest);

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: true,
          status: "accepted",
        }),
      })
    );
    expect(
      recordingD1.calls.some((call) =>
        call.query.includes("INSERT INTO openMeldDaemon_dispatch_result_inbox")
      )
    ).toBe(false);
    expect(appliedFinalizationCommands).toHaveLength(0);
  });

  it("rejects a token-valid completed-cache replay with a different result without overwriting the old result", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      recordingD1,
      sentFrames,
      socket,
      state,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    const dispatchAttemptKey = buildDispatchAttemptKey(
      "dispatch-1",
      "attempt-1"
    );
    state.pendingDispatches.clear();
    state.completedDispatchResults.set(
      dispatchAttemptKey,
      buildCompletedDispatchResult({
        executionTokenFingerprint: executionToken.tokenFingerprint,
        executionTokenRunId: executionToken.runId,
      })
    );
    recordingD1.calls.length = 0;
    sentFrames.length = 0;
    appliedFinalizationCommands.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        taskResult: {
          v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
          code: "service.task_result",
          payload: {
            agentId: TARGET_AGENT_PROFILE_ID,
            attemptId: "attempt-1",
            deduped: false,
            output: "different result",
            sourceEventId: "signal-1",
            status: "success",
            taskId: "task-1",
          },
        },
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: false,
          reasonCode: "daemon.result.conflict",
          status: "rejected_terminal",
        }),
      })
    );
    const cachedResult =
      state.completedDispatchResults.get(dispatchAttemptKey)?.taskResult;
    expect(cachedResult?.payload.status).toBe("success");
    if (cachedResult?.payload.status !== "success") {
      throw new Error("Expected cached result to remain successful");
    }
    expect(cachedResult.payload.output).toBe("done");
    expect(
      recordingD1.calls.some((call) =>
        call.query.includes("INSERT INTO openMeldDaemon_dispatch_result_inbox")
      )
    ).toBe(false);
    expect(appliedFinalizationCommands).toHaveLength(0);
  });

  it("rejects an old D1 inbox row with a mismatched RuntimeCoordinator token pointer", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      recordingD1,
      sentFrames,
      socket,
      state,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    state.pendingDispatches.clear();
    recordingD1.inboxRows.set("dispatch-1::attempt-1", {
      accepted_at_ms: 1_700_000_000_100,
      attempt_id: "attempt-1",
      daemon_session_id: "daemon-session-1",
      dispatch_id: "dispatch-1",
      execution_token_fingerprint: `etfp_v1_${"a".repeat(32)}`,
      execution_token_run_id: "old-run",
      lease_epoch: 2,
      publication_error_code: null,
      publish_state: "reply_published",
      published_signal_id: "signal-old",
      result_key: "dispatch-1::attempt-1",
      result_payload_json: JSON.stringify(buildResultRequest().taskResult),
      runtime_coordinator_execution_id: RUNTIME_COORDINATOR_EXECUTION_ID,
      submitted_connection_generation: 1,
      target_profile_id: TARGET_AGENT_PROFILE_ID,
      task_id: "task-1",
      updated_at_ms: 1_700_000_000_100,
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;
    appliedFinalizationCommands.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: false,
          reasonCode: "daemon.result.identity_mismatch",
          status: "rejected_terminal",
        }),
      })
    );
    expect(appliedFinalizationCommands).toHaveLength(0);
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[4] === "daemon.result.identity_mismatch"
      )
    ).toBe(true);
  });

  it("accepts a pending-missing result only after RuntimeCoordinator token validation and matching D1 attempt evidence", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      recordingD1,
      sentFrames,
      socket,
      state,
    } = createHarness({
      attemptAcceptanceRow: buildAttemptAcceptanceRow(),
    });
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    state.pendingDispatches.clear();
    recordingD1.calls.length = 0;
    sentFrames.length = 0;
    appliedFinalizationCommands.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: true,
          status: "accepted",
        }),
      })
    );
    const inboxInsertCall = recordingD1.calls.find((call) =>
      call.query.includes("INSERT INTO openMeldDaemon_dispatch_result_inbox")
    );
    expect(inboxInsertCall?.params).toEqual(
      expect.arrayContaining([
        RUNTIME_COORDINATOR_EXECUTION_ID,
        executionToken.runId,
        executionToken.tokenFingerprint,
      ])
    );
    expect(appliedFinalizationCommands).toHaveLength(1);
    expect(appliedFinalizationCommands[0]).toMatchObject({
      acceptedResult: {
        executionTokenFingerprint: executionToken.tokenFingerprint,
        executionTokenRunId: executionToken.runId,
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      },
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
    });
  });

  it("does not require D1 RuntimeCoordinator projection to accept a pending-missing token-valid result", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      recordingD1,
      sentFrames,
      socket,
      state,
    } = createHarness({
      attemptAcceptanceRow: buildAttemptAcceptanceRow(),
    });
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    state.pendingDispatches.clear();
    recordingD1.projectionRows.clear();
    recordingD1.calls.length = 0;
    sentFrames.length = 0;
    appliedFinalizationCommands.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: true,
          status: "accepted",
        }),
      })
    );
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[4] === "runtime_coordinator.execution_id_mismatch"
      )
    ).toBe(false);
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "result_accepted"
      )
    ).toBe(true);
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "result_late_diagnostic"
      )
    ).toBe(false);
    const inboxInsertCall = recordingD1.calls.find((call) =>
      call.query.includes("INSERT INTO openMeldDaemon_dispatch_result_inbox")
    );
    expect(inboxInsertCall?.params).toEqual(
      expect.arrayContaining([
        RUNTIME_COORDINATOR_EXECUTION_ID,
        executionToken.runId,
        executionToken.tokenFingerprint,
      ])
    );
    expect(appliedFinalizationCommands).toHaveLength(1);
  });

  it("records owner conflict with a current token as a RuntimeCoordinator decision event", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        taskResult: buildOwnerConflictTaskResult(),
      })
    );

    const ownerConflictEvent = getRuntimeCoordinatorEventCalls(
      recordingD1.calls
    ).find((call) => call.params[2] === "owner_conflict_current_token");
    expect(ownerConflictEvent?.params[1]).toBe(
      RUNTIME_COORDINATOR_EXECUTION_ID
    );
    expect(JSON.parse(String(ownerConflictEvent?.params[7]))).toMatchObject({
      coordinatorAction: "decide_retry_timeout_or_reclaim",
      decisionKind: "record_current_owner_conflict",
      ownerConflictTokenClass: "current",
      reasonCode: "runtime_coordinator.owner_conflict_current_token",
      runId: executionToken.runId,
      tokenFingerprint: executionToken.tokenFingerprint,
      tokenStatus: "active",
      usesFinalClaimAuthority: false,
      usesLegacyClaimLeaseAuthority: false,
    });
  });

  it("does not complete the active Wake when a later delivery reports a current-token owner conflict", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      recordingD1,
      sentFrames,
      socket,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    const dispatchAttemptKey = buildDispatchAttemptKey(
      "dispatch-1",
      "attempt-1"
    );
    recordingD1.calls.length = 0;
    sentFrames.length = 0;
    appliedFinalizationCommands.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        taskResult: buildOwnerConflictTaskResult(),
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: true,
          status: "accepted",
        }),
      })
    );
    expect(appliedFinalizationCommands).toHaveLength(0);
    expect(state.pendingDispatches.has(dispatchAttemptKey)).toBe(true);
    expect(recordingD1.inboxRows.has("dispatch-1::attempt-1")).toBe(false);
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "owner_conflict_current_token"
      )
    ).toBe(true);
    expect(waitUntilTasks.length).toBeGreaterThan(0);
    await Promise.allSettled(waitUntilTasks);
    const authorityAfterOwnerConflict = [...storageRecords.values()].find(
      (value): value is RuntimeCoordinatorExecutionTokenAuthorityRecord =>
        value !== null && typeof value === "object" && "runsById" in value
    );
    expect(authorityAfterOwnerConflict?.terminalOutcome).toBeNull();
    expect(
      authorityAfterOwnerConflict?.runsById[executionToken.runId]
    ).toMatchObject({
      tokenStatus: "active",
    });
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) =>
          call.params[2] === "runtime_coordinator_owner_conflict_terminal"
      )
    ).toBe(false);

    sentFrames.length = 0;
    recordingD1.calls.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: true,
          status: "accepted",
        }),
      })
    );
    expect(appliedFinalizationCommands).toHaveLength(1);
    expect(appliedFinalizationCommands[0]).toMatchObject({
      acceptedResult: {
        taskResult: {
          payload: expect.objectContaining({
            output: "done",
            status: "success",
          }),
        },
      },
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
    });
  });

  it("records owner conflict with a stale token as stale diagnostic only", async () => {
    const { hub, recordingD1, sentFrames, socket, state, storageRecords } =
      createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    const [authorityKey, rawAuthority] =
      findRuntimeCoordinatorExecutionTokenAuthorityEntry(storageRecords) ?? [];
    if (!(authorityKey && rawAuthority)) {
      throw new Error("Expected stored token authority.");
    }
    storageRecords.set(
      authorityKey,
      retireRuntimeCoordinatorTokenRun({
        authority:
          rawAuthority as RuntimeCoordinatorExecutionTokenAuthorityRecord,
        reasonCode: "execution_token_superseded",
        retiredAtMs: 1_700_000_001_000,
        retentionExpiresAtMs: 1_700_000_011_000,
        runId: executionToken.runId,
        tokenStatus: "superseded",
      })
    );
    recordingD1.calls.length = 0;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        taskResult: buildOwnerConflictTaskResult(),
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: false,
          reasonCode: "execution_token_superseded",
          status: "rejected_terminal",
        }),
      })
    );
    const ownerConflictEvent = getRuntimeCoordinatorEventCalls(
      recordingD1.calls
    ).find((call) => call.params[2] === "owner_conflict_stale_token");
    expect(JSON.parse(String(ownerConflictEvent?.params[7]))).toMatchObject({
      coordinatorAction: "record_diagnostic_only",
      decisionKind: "record_stale_diagnostic",
      ownerConflictTokenClass: "stale",
      reasonCode: "execution_token_superseded",
      runId: executionToken.runId,
      tokenFingerprint: executionToken.tokenFingerprint,
      tokenStatus: "superseded",
      usesFinalClaimAuthority: false,
      usesLegacyClaimLeaseAuthority: false,
    });
  });

  it("records owner conflict without a token as a contract diagnostic", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();
    await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        taskResult: buildOwnerConflictTaskResult(),
      })
    );

    const ownerConflictEvent = getRuntimeCoordinatorEventCalls(
      recordingD1.calls
    ).find((call) => call.params[2] === "owner_conflict_missing_token");
    expect(JSON.parse(String(ownerConflictEvent?.params[7]))).toMatchObject({
      coordinatorAction: "record_diagnostic_only",
      decisionKind: "record_contract_diagnostic",
      ownerConflictTokenClass: "missing",
      reasonCode: "runtime_coordinator.owner_conflict_token_missing",
      usesFinalClaimAuthority: false,
      usesLegacyClaimLeaseAuthority: false,
    });
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "execution_token_validation_failed"
      )
    ).toBe(true);
  });

  it("redelivers the same active run on retry after rechecking the current route", async () => {
    const { hub, recordingD1, sentFrames, socket, state, storageRecords } =
      createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;
    state.sessionsById.set("daemon-session-2", {
      capabilities: {
        runtimeAdapters: [codexRuntimeAdapterCapability],
      },
      connectedAtMs: 1_700_000_000_100,
      connectionGeneration: 9,
      daemonSessionId: "daemon-session-2",
      deviceId: "device-1",
      executionCompatibility: {
        expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        reasonCode: "daemon.runtime_contract.compatible",
        status: "compatible",
      },
      lane: "dev-local",
      lastHeartbeatMs: 1_700_000_000_100,
      deliveryDisconnectedAtMs: null,
      ownerUserId: "owner-1",
      profileIds: new Set([TARGET_AGENT_PROFILE_ID]),
      localWakeRouteReport: null,
      rejectedProfileRegistrationsByProfileId: new Map(),
      socket,
    });
    state.profileLeasesByProfileId.set(TARGET_AGENT_PROFILE_ID, {
      capabilities: {
        runtimeAdapters: [codexRuntimeAdapterCapability],
      },
      daemonSessionId: "daemon-session-2",
      deviceId: "device-1",
      executionCompatibility: {
        expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        reasonCode: "daemon.runtime_contract.compatible",
        status: "compatible",
      },
      lane: "dev-local",
      lastHeartbeatMs: 1_700_000_000_100,
      leaseEpoch: 5,
      profileId: TARGET_AGENT_PROFILE_ID,
    });

    const decisionInput = {
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      attemptId: "attempt-1",
      claimDecision: "claim_recovery" as const,
      dispatchId: "dispatch-1",
      eventKind: "retry" as const,
      idempotencyKey: "queue:dispatch-1:retry:1",
      reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      sourceClientMessageId: "client-message-1",
      spaceId: HEX_SPACE_ID,
      targetProfileId: TARGET_AGENT_PROFILE_ID,
      trigger: "queue" as const,
    };
    const first = await (
      hub as unknown as {
        decideRuntimeCoordinatorExecutionProgress: (
          input: typeof decisionInput
        ) => Promise<{
          ok: boolean;
          action?: string;
          reasonCode: string;
          status: string;
        }>;
      }
    ).decideRuntimeCoordinatorExecutionProgress(decisionInput);
    const second = await (
      hub as unknown as {
        decideRuntimeCoordinatorExecutionProgress: (
          input: typeof decisionInput
        ) => Promise<{
          ok: boolean;
          action?: string;
          reasonCode: string;
          status: string;
        }>;
      }
    ).decideRuntimeCoordinatorExecutionProgress(decisionInput);

    expect(first).toMatchObject({
      action: "redeliver_current_run",
      ok: true,
      reasonCode: "runtime_coordinator.current_run_redelivered",
      status: "recorded",
    });
    expect(second).toMatchObject({
      action: "redeliver_current_run",
      ok: true,
      reasonCode: "runtime_coordinator.current_run_redelivered",
      status: "recorded",
    });
    const redeliveryFrames = sentFrames.filter(
      (frame) =>
        typeof frame === "object" &&
        frame !== null &&
        (frame as { code?: unknown }).code === "daemon.dispatch.deliver"
    ) as Array<{
      payload?: {
        connectionGeneration?: number;
        daemonSessionId?: string;
        leaseEpoch?: number;
        payload?: {
          executionToken?: RuntimeCoordinatorExecutionTokenEnvelope;
        };
      };
    }>;
    expect(redeliveryFrames).toHaveLength(2);
    const redeliveredFrame = redeliveryFrames[0] as
      | {
          payload?: {
            connectionGeneration?: number;
            daemonSessionId?: string;
            leaseEpoch?: number;
            payload?: {
              executionToken?: RuntimeCoordinatorExecutionTokenEnvelope;
            };
          };
        }
      | undefined;
    expect(redeliveredFrame).toMatchObject({
      payload: {
        connectionGeneration: 9,
        daemonSessionId: "daemon-session-2",
        leaseEpoch: 5,
      },
    });
    expect(redeliveredFrame?.payload?.payload?.executionToken).toMatchObject({
      deliveryProvenance: {
        connectionGeneration: 9,
        daemonSessionId: "daemon-session-2",
        leaseEpoch: 5,
      },
      executionToken: executionToken.executionToken,
      runId: executionToken.runId,
      tokenFingerprint: executionToken.tokenFingerprint,
    });
    const authority = [...storageRecords.values()].find(
      (value): value is RuntimeCoordinatorExecutionTokenAuthorityRecord =>
        value !== null && typeof value === "object" && "runsById" in value
    );
    expect(authority?.terminalOutcome).toBeNull();
    expect(authority?.runsById[executionToken.runId]).toMatchObject({
      tokenSecretRefOrSealedToken: executionToken.executionToken,
      tokenStatus: "active",
    });
    const decisionLog = [...storageRecords.values()].find(
      (value): value is unknown[] =>
        Array.isArray(value) &&
        value.every((entry) => typeof entry === "object" && entry !== null)
    );
    expect(decisionLog).toHaveLength(2);
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).filter(
        (call) => call.params[2] === "runtime_coordinator_redelivery_commanded"
      )
    ).toHaveLength(2);
  });

  it("does not mark a redelivery pending when the daemon frame send fails", async () => {
    const { hub, recordingD1, sentFrames, socket, state, storageRecords } =
      createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;
    state.pendingDispatches.clear();

    const failingSocket = {
      send: vi.fn(() => {
        throw new Error("socket closed");
      }),
    } as unknown as WebSocket;
    registerCompatibleRoute({
      connectionGeneration: 9,
      daemonSessionId: "daemon-session-2",
      leaseEpoch: 5,
      socket: failingSocket,
      state,
    });

    const response = await decideRuntimeCoordinatorProgress(
      hub,
      buildRuntimeCoordinatorDecisionInput({
        idempotencyKey: "queue:dispatch-1:retry:send-failed",
      })
    );

    expect(response).toMatchObject({
      action: "redelivery_deferred",
      ok: true,
      reasonCode: "runtime_coordinator.redelivery_send_failed",
      status: "recorded",
    });
    expect(failingSocket.send).toHaveBeenCalledTimes(1);
    expect(
      state.pendingDispatches.has(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )
    ).toBe(false);
    expect(sentFrames).toEqual([]);
    const authority = [...storageRecords.values()].find(
      (value): value is RuntimeCoordinatorExecutionTokenAuthorityRecord =>
        value !== null && typeof value === "object" && "runsById" in value
    );
    expect(authority?.terminalOutcome).toBeNull();
    expect(authority?.runsById[executionToken.runId]).toMatchObject({
      tokenStatus: "active",
    });
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "runtime_coordinator_redelivery_commanded"
      )
    ).toBe(false);
  });

  it("re-evaluates a deferred redelivery with the same idempotency key after the route recovers", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;
    state.pendingDispatches.clear();
    state.profileLeasesByProfileId.clear();
    state.sessionsById.clear();

    const decisionInput = buildRuntimeCoordinatorDecisionInput({
      idempotencyKey: "queue:dispatch-1:retry:route-recovers",
    });
    const first = await decideRuntimeCoordinatorProgress(hub, decisionInput);

    registerCompatibleRoute({
      connectionGeneration: 4,
      daemonSessionId: "daemon-session-recovered",
      leaseEpoch: 6,
      socket,
      state,
    });
    const second = await decideRuntimeCoordinatorProgress(hub, decisionInput);

    expect(first).toMatchObject({
      action: "redelivery_deferred",
      ok: true,
      reasonCode: "runtime_coordinator.redelivery_route_unavailable",
      status: "recorded",
    });
    expect(second).toMatchObject({
      action: "redeliver_current_run",
      ok: true,
      reasonCode: "runtime_coordinator.current_run_redelivered",
      status: "recorded",
    });
    const redeliveredFrame = sentFrames.find(
      (frame) =>
        typeof frame === "object" &&
        frame !== null &&
        (frame as { code?: unknown }).code === "daemon.dispatch.deliver"
    ) as
      | {
          payload?: {
            connectionGeneration?: number;
            daemonSessionId?: string;
            leaseEpoch?: number;
            payload?: {
              executionToken?: RuntimeCoordinatorExecutionTokenEnvelope;
            };
          };
        }
      | undefined;
    expect(redeliveredFrame).toMatchObject({
      payload: {
        connectionGeneration: 4,
        daemonSessionId: "daemon-session-recovered",
        leaseEpoch: 6,
      },
    });
    expect(redeliveredFrame?.payload?.payload?.executionToken).toMatchObject({
      executionToken: executionToken.executionToken,
      runId: executionToken.runId,
      tokenFingerprint: executionToken.tokenFingerprint,
    });
  });

  it("keeps waiting instead of redelivering when the active run has local progress", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();
    await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;

    const dispatchAttemptKey = buildDispatchAttemptKey(
      "dispatch-1",
      "attempt-1"
    );
    const pending = state.pendingDispatches.get(dispatchAttemptKey);
    if (!pending) {
      throw new Error("Expected pending dispatch after tokenized delivery.");
    }
    state.pendingDispatches.set(dispatchAttemptKey, {
      ...pending,
      acceptedLocalAtMs: 1_700_000_000_100,
      lastLifecycleAtMs: 1_700_000_000_200,
      phase: "running",
      runningAtMs: 1_700_000_000_200,
    });

    const response = await decideRuntimeCoordinatorProgress(
      hub,
      buildRuntimeCoordinatorDecisionInput({
        eventKind: "timeout",
        idempotencyKey: "alarm:dispatch-1:timeout:local-progress",
        trigger: "alarm",
      })
    );

    expect(response).toMatchObject({
      action: "keep_waiting",
      ok: true,
      reasonCode: "runtime_coordinator.local_progress_active",
      status: "recorded",
    });
    expect(sentFrames).toEqual([]);
    expect(state.pendingDispatches.get(dispatchAttemptKey)).toMatchObject({
      phase: "running",
      runningAtMs: 1_700_000_000_200,
    });
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "runtime_coordinator_redelivery_commanded"
      )
    ).toBe(false);
  });

  it("keeps waiting from durable run progress after pending memory is lost", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;
    state.pendingDispatches.clear();

    await (
      hub as unknown as {
        handleDispatchLifecycleFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchLifecycleFrame(
      socket,
      buildLifecycleRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        lifecycleAtMs: 1_700_000_000_300,
        phase: "running",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(sentFrames).toEqual([]);

    const response = await decideRuntimeCoordinatorProgress(
      hub,
      buildRuntimeCoordinatorDecisionInput({
        eventKind: "timeout",
        idempotencyKey: "alarm:dispatch-1:timeout:durable-progress",
        trigger: "alarm",
      })
    );

    expect(response).toMatchObject({
      action: "keep_waiting",
      ok: true,
      reasonCode: "runtime_coordinator.local_progress_active",
      status: "recorded",
    });
    expect(
      state.pendingDispatches.has(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )
    ).toBe(false);
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "runtime_coordinator_redelivery_commanded"
      )
    ).toBe(false);
  });

  it("keeps the latest conversation occupancy transition as current evidence", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    const lifecycleHub = hub as unknown as {
      handleDispatchLifecycleFrame: (
        webSocket: WebSocket,
        payload: unknown
      ) => Promise<void>;
    };
    const nowSpy = vi.spyOn(Date, "now");
    try {
      const reportOccupancy = async (
        stateValue: "available" | "occupied",
        nowMs: number
      ) => {
        nowSpy.mockReturnValue(nowMs);
        await lifecycleHub.handleDispatchLifecycleFrame(
          socket,
          buildLifecycleRequest({
            agentControllerConversationOccupancy: {
              agentControllerConversationId: "conversation-1",
              contractVersion: 1,
              state: stateValue,
            },
            executionTokenEcho: buildExecutionTokenEcho(executionToken),
            lifecycleAtMs: nowMs,
            runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
          })
        );
        await vi.waitFor(() => {
          expect(
            [...recordingD1.eventRows.values()].some((row) => {
              const payload = JSON.parse(String(row.payload_json));
              return (
                payload.agentControllerConversationOccupancy?.state ===
                stateValue
              );
            })
          ).toBe(true);
        });
      };

      await reportOccupancy("occupied", 1_700_000_000_100);
      await reportOccupancy("available", 1_700_000_000_200);
      await reportOccupancy("occupied", 1_700_000_000_300);

      const occupancyRows = [...recordingD1.eventRows.values()].filter(
        (row) => {
          const payload = JSON.parse(String(row.payload_json));
          return Boolean(payload.agentControllerConversationOccupancy);
        }
      );
      expect(occupancyRows).toHaveLength(2);
      expect(
        occupancyRows.map((row) => ({
          observedAtMs: row.observed_at_ms,
          state: JSON.parse(String(row.payload_json))
            .agentControllerConversationOccupancy.state,
        }))
      ).toEqual(
        expect.arrayContaining([
          { observedAtMs: 1_700_000_000_200, state: "available" },
          { observedAtMs: 1_700_000_000_300, state: "occupied" },
        ])
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("defers redelivery instead of keep-waiting when the current route lacks capability", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();
    await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;
    state.pendingDispatches.clear();

    registerCompatibleRoute({
      connectionGeneration: 9,
      daemonSessionId: "daemon-session-2",
      leaseEpoch: 5,
      runtimeAdapters: [
        {
          ...codexRuntimeAdapterCapability,
          adapterId: "openclaw",
        },
      ],
      socket,
      state,
    });

    const response = await decideRuntimeCoordinatorProgress(
      hub,
      buildRuntimeCoordinatorDecisionInput({
        idempotencyKey: "queue:dispatch-1:retry:capability-missing",
      })
    );

    expect(response).toMatchObject({
      action: "redelivery_deferred",
      ok: true,
      reasonCode: "runtime_coordinator.redelivery_capability_unavailable",
      status: "recorded",
    });
    expect(sentFrames).toEqual([]);
    expect(
      state.pendingDispatches.has(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )
    ).toBe(false);
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "runtime_coordinator_redelivery_commanded"
      )
    ).toBe(false);
  });

  it("expires an unaccepted Wake after the redelivery window and publishes a user-visible failure", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceFetchRequests,
        state,
        storageRecords,
      } = createHarness();
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      recordingD1.calls.length = 0;
      sentFrames.length = 0;
      spaceFetchRequests.length = 0;
      state.pendingDispatches.clear();
      nowSpy.mockReturnValue(1_700_000_031_000);

      const response = await decideRuntimeCoordinatorProgress(
        hub,
        buildRuntimeCoordinatorDecisionInput({
          eventKind: "timeout",
          idempotencyKey: "alarm:dispatch-1:timeout:delivery-expired",
          trigger: "alarm",
        })
      );

      expect(response).toMatchObject({
        action: "timeout_terminal",
        ok: true,
        reasonCode: "runtime_coordinator.delivery_expired",
        status: "recorded",
      });
      expect(sentFrames).toEqual([]);
      expect(spaceFetchRequests).toHaveLength(1);
      expect(spaceFetchRequests[0]).toMatchObject({
        path: "/rpc/signals/system-notice",
      });
      expect(spaceFetchRequests[0]?.body).toMatchObject({
        data: {
          actorProfileId: TARGET_AGENT_PROFILE_ID,
          actorName: "Codex Agent",
          dispatchId: "dispatch-1",
          failureStage: "execution",
          generatedBy: "openmeld",
          noticeType: "terminal_failure",
          reason: "runtime_coordinator.delivery_expired",
          reasonCode: "runtime_coordinator.delivery_expired",
          text: "Codex Agent did not receive this Wake before it expired. Wake the agent again when the local OpenMeld Service is online.",
        },
      });
      const authority = [...storageRecords.values()].find(
        (value): value is RuntimeCoordinatorExecutionTokenAuthorityRecord =>
          value !== null && typeof value === "object" && "runsById" in value
      );
      expect(authority?.terminalOutcome).toMatchObject({
        reasonCode: "runtime_coordinator.delivery_expired",
        replySignalId: "signal-delivery-expired-1",
        status: "failed_terminal",
      });
      expect(authority?.runsById[executionToken.runId]).toMatchObject({
        tokenStatus: "expired",
      });
      const terminalProjection = recordingD1.projectionRows.get(
        RUNTIME_COORDINATOR_EXECUTION_ID
      );
      expect(terminalProjection).toMatchObject({
        status: "failed_terminal",
      });
      expect(
        JSON.parse(String(terminalProjection?.terminal_outcome_json))
      ).toMatchObject({
        kind: "timed_out",
        reasonCode: "runtime_coordinator.delivery_expired",
      });
      expect(getReadinessImpactWriteCalls(recordingD1.calls)).toHaveLength(1);
      expect(
        getReadinessImpactWriteCalls(recordingD1.calls)[0]?.params
      ).toEqual([
        `readiness_impact:local_execution:${TARGET_AGENT_PROFILE_ID}:binding-1:runtime-1:builtin:codex`,
        "local_execution",
        TARGET_AGENT_PROFILE_ID,
        "binding-1",
        "runtime-1",
        "builtin:codex",
        "runtime_coordinator.delivery_expired",
        "wake_failure",
        "dispatch-1",
        "attempt-1",
        1_700_000_031_000,
        1_700_001_831_000,
        1_700_000_031_000,
        1_700_000_031_000,
      ]);
      const terminalEvent = getRuntimeCoordinatorEventCalls(
        recordingD1.calls
      ).find(
        (call) => call.params[2] === "runtime_coordinator_timeout_terminal"
      );
      expect(JSON.parse(String(terminalEvent?.params[7]))).toMatchObject({
        deliveryExpired: {
          redeliveryWindowMs: 30_000,
          publishedSignalId: "signal-delivery-expired-1",
        },
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("threads the upstream reply-to snapshot into the delivery-expired failure notice", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const { hub, sentFrames, socket, spaceFetchRequests, state } =
        createHarness();
      const replyToSnapshot = {
        signalId: "signal-source-1",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human" as const,
        profileName: "Felix",
        previewText: "@Codex please check this",
      };
      await issueDeliveryToken({
        hub,
        replyToSnapshot,
        sentFrames,
        socket,
        state,
      });
      sentFrames.length = 0;
      state.pendingDispatches.clear();
      nowSpy.mockReturnValue(1_700_000_031_000);

      await decideRuntimeCoordinatorProgress(
        hub,
        buildRuntimeCoordinatorDecisionInput({
          eventKind: "timeout",
          idempotencyKey: "alarm:dispatch-1:timeout:delivery-expired-reply-to",
          trigger: "alarm",
        })
      );

      expect(spaceFetchRequests).toHaveLength(1);
      expect(spaceFetchRequests[0]?.body).toMatchObject({
        data: {
          dispatchId: "dispatch-1",
          failureStage: "execution",
          noticeType: "terminal_failure",
          reason: "runtime_coordinator.delivery_expired",
          reasonCode: "runtime_coordinator.delivery_expired",
          replyTo: replyToSnapshot,
        },
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("uses durable RuntimeCoordinator authority on alarm after pending memory is lost", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceFetchRequests,
        state,
        storageRecords,
      } = createHarness();
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      const setAlarm = vi.mocked(
        (
          hub as unknown as {
            ctx: {
              storage: { setAlarm: (scheduledTime: number) => Promise<void> };
            };
          }
        ).ctx.storage.setAlarm
      );
      expect(setAlarm).toHaveBeenCalledWith(1_700_000_030_000);
      state.pendingDispatches.clear();
      nowSpy.mockReturnValue(1_700_000_030_000);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();
      expect(spaceFetchRequests).toEqual([]);
      expect(setAlarm).toHaveBeenCalledWith(1_700_000_030_001);
      recordingD1.calls.length = 0;
      sentFrames.length = 0;
      nowSpy.mockReturnValue(1_700_000_031_000);

      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(sentFrames).toEqual([]);
      expect(spaceFetchRequests).toHaveLength(1);
      expect(spaceFetchRequests[0]).toMatchObject({
        path: "/rpc/signals/system-notice",
      });
      expect(spaceFetchRequests[0]?.body).toMatchObject({
        data: {
          actorProfileId: TARGET_AGENT_PROFILE_ID,
          dispatchId: "dispatch-1",
          failureStage: "execution",
          generatedBy: "openmeld",
          noticeType: "terminal_failure",
          reason: "runtime_coordinator.delivery_expired",
          reasonCode: "runtime_coordinator.delivery_expired",
        },
      });
      const authority = [...storageRecords.values()].find(
        (value): value is RuntimeCoordinatorExecutionTokenAuthorityRecord =>
          value !== null && typeof value === "object" && "runsById" in value
      );
      expect(authority?.terminalOutcome).toMatchObject({
        reasonCode: "runtime_coordinator.delivery_expired",
        status: "failed_terminal",
      });
      expect(authority?.runsById[executionToken.runId]).toMatchObject({
        tokenStatus: "expired",
      });
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) => call.params[2] === "runtime_coordinator_timeout_terminal"
        )
      ).toBe(true);
      expect(
        recordingD1.calls.some(
          (call) =>
            SQL_SELECT_PATTERN.test(call.query) &&
            call.query.includes("openMeldDaemon_runtime_coordinator_executions")
        )
      ).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("keeps legacy pre-execution handoff as evidence instead of publishing final Space failure", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_005_000);
    try {
      const { hub, spaceFetchRequests, storageRecords, storageSetAlarm } =
        createHarness();
      const requestBody = {
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        attemptId: "attempt-preexec-1",
        autoRelayDepth: 0,
        dispatchChainId: "chain-preexec-1",
        dispatchId: "dispatch-preexec-1",
        firstSeenAtMs: 1_700_000_000_000,
        idempotencyKey: "5:evt-preexec-1|5:agt-preexec-1",
        observedAtMs: 1_700_000_005_000,
        reasonCode: "daemon.profile.offline",
        sourceClientMessageId: "client-preexec-1",
        sourceEventId: "evt-preexec-1",
        spaceId: HEX_SPACE_ID,
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        targetProfileName: "Codex",
        taskId: "task-preexec-1",
        visitedProfileIds: [],
        visitedProfileIdsHash: "stable32:preexec",
      };

      const firstResponse = await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/pre-execution-handoff",
        requestBody
      );

      expect(firstResponse.status).toBe(200);
      await expect(firstResponse.json()).resolves.toMatchObject({
        deadlineAtMs: 1_700_000_030_000,
        ok: true,
        reasonCode: "daemon.profile.offline",
        status: "waiting_for_recovery",
      });
      expect(storageSetAlarm).toHaveBeenCalledWith(1_700_000_030_000);

      nowSpy.mockReturnValue(1_700_000_020_000);
      const redeliveryResponse = await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/pre-execution-handoff",
        {
          ...requestBody,
          attemptId: "attempt-preexec-redelivery",
          firstSeenAtMs: 1_700_000_020_000,
          observedAtMs: 1_700_000_020_000,
        }
      );

      await expect(redeliveryResponse.json()).resolves.toMatchObject({
        deadlineAtMs: 1_700_000_030_000,
        ok: true,
        status: "waiting_for_recovery",
      });
      spaceFetchRequests.length = 0;
      nowSpy.mockReturnValue(1_700_000_031_000);

      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(spaceFetchRequests).toEqual([]);
      const ownerRecord = [...storageRecords.values()].find(
        (value) =>
          value !== null &&
          typeof value === "object" &&
          (value as { dispatchId?: unknown }).dispatchId ===
            "dispatch-preexec-1"
      );
      expect(ownerRecord).toMatchObject({
        deadlineAtMs: 1_700_000_030_000,
        firstSeenAtMs: 1_700_000_000_000,
        publicationStatus: "legacy_evidence_only",
        publishedSignalId: null,
        resultRef: "pre-execution-handoff-failure:dispatch-preexec-1",
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("does not retry legacy pre-execution failure publication when Space is unavailable", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_031_000);
    try {
      const { hub, spaceFetchRequests, spaceStub, state, storageRecords } =
        createHarness();
      state.pendingDispatches.clear();
      vi.mocked(spaceStub.fetch).mockRejectedValueOnce(
        new Error("space unavailable")
      );

      const response = await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/pre-execution-handoff",
        {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          attemptId: "attempt-preexec-publish-retry",
          autoRelayDepth: 0,
          dispatchChainId: "chain-preexec-publish-retry",
          dispatchId: "dispatch-preexec-publish-retry",
          firstSeenAtMs: 1_700_000_000_000,
          idempotencyKey: "5:evt-preexec-publish-retry|5:agt-preexec",
          observedAtMs: 1_700_000_031_000,
          reasonCode: "daemon.profile.offline",
          sourceClientMessageId: "client-preexec-publish-retry",
          sourceEventId: "evt-preexec-publish-retry",
          spaceId: HEX_SPACE_ID,
          targetProfileId: TARGET_AGENT_PROFILE_ID,
          targetProfileName: "Codex",
          taskId: "task-preexec-publish-retry",
          visitedProfileIds: [],
          visitedProfileIdsHash: "stable32:preexec-publish-retry",
        }
      );

      await expect(response.json()).resolves.toMatchObject({
        deadlineAtMs: 1_700_000_030_000,
        ok: true,
        reasonCode: "daemon.profile.offline",
        status: "legacy_evidence_only",
      });
      expect(spaceFetchRequests).toEqual([]);
      let ownerRecord = [...storageRecords.values()].find(
        (value) =>
          value !== null &&
          typeof value === "object" &&
          (value as { dispatchId?: unknown }).dispatchId ===
            "dispatch-preexec-publish-retry"
      );
      expect(ownerRecord).toMatchObject({
        nextPublicationRetryAtMs: null,
        publicationStatus: "legacy_evidence_only",
        publishedSignalId: null,
      });

      spaceFetchRequests.length = 0;
      nowSpy.mockReturnValue(1_700_000_036_000);

      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(spaceFetchRequests).toEqual([]);
      ownerRecord = [...storageRecords.values()].find(
        (value) =>
          value !== null &&
          typeof value === "object" &&
          (value as { dispatchId?: unknown }).dispatchId ===
            "dispatch-preexec-publish-retry"
      );
      expect(ownerRecord).toMatchObject({
        nextPublicationRetryAtMs: null,
        publicationStatus: "legacy_evidence_only",
        publishedSignalId: null,
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("lets a recovered service execute before the pre-execution handoff deadline", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_005_000);
    try {
      const { hub, sentFrames, socket, spaceFetchRequests, state } =
        createHarness();
      state.pendingDispatches.clear();

      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/pre-execution-handoff",
        {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          attemptId: "attempt-1",
          dispatchId: "dispatch-1",
          firstSeenAtMs: 1_700_000_000_000,
          idempotencyKey: "idempotency-1",
          observedAtMs: 1_700_000_005_000,
          reasonCode: "daemon.profile.offline",
          sourceClientMessageId: "client-message-1",
          sourceEventId: "signal-1",
          spaceId: HEX_SPACE_ID,
          targetProfileId: TARGET_AGENT_PROFILE_ID,
          targetProfileName: "Codex Agent",
          taskId: "task-1",
        }
      );
      nowSpy.mockReturnValue(1_700_000_010_000);
      await acceptDefaultRuntimeCoordinatorHead(hub);
      configureCompatibleRoute({ socket, state });

      const deliveryResponse = await (
        hub as unknown as {
          handleDeliverDispatchRequest: (request: Request) => Promise<Response>;
        }
      ).handleDeliverDispatchRequest(
        new Request("https://runtime-transport.test/deliver-dispatch", {
          body: JSON.stringify(buildDeliverRequest()),
          method: "POST",
        })
      );

      expect(deliveryResponse.status).toBe(200);
      await expect(deliveryResponse.json()).resolves.toMatchObject({
        accepted: true,
        status: "delivered",
      });
      expect(sentFrames).toHaveLength(1);
      nowSpy.mockReturnValue(1_700_000_031_000);
      spaceFetchRequests.length = 0;

      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(spaceFetchRequests).toEqual([]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("does not reject recovered Queue delivery from legacy pre-execution evidence", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_031_000);
    try {
      const { hub, sentFrames, socket, spaceFetchRequests, state } =
        createHarness();
      state.pendingDispatches.clear();

      await fetchRuntimeTransportJson(
        hub,
        "/runtime-coordinator/pre-execution-handoff",
        {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          attemptId: "attempt-1",
          dispatchId: "dispatch-1",
          firstSeenAtMs: 1_700_000_000_000,
          idempotencyKey: "idempotency-1",
          observedAtMs: 1_700_000_031_000,
          reasonCode: "daemon.profile.offline",
          sourceClientMessageId: "client-message-1",
          sourceEventId: "signal-1",
          spaceId: HEX_SPACE_ID,
          targetProfileId: TARGET_AGENT_PROFILE_ID,
          targetProfileName: "Codex Agent",
          taskId: "task-1",
        }
      );
      expect(spaceFetchRequests).toEqual([]);
      await acceptDefaultRuntimeCoordinatorHead(hub);
      configureCompatibleRoute({ socket, state });

      const deliveryResponse = await (
        hub as unknown as {
          handleDeliverDispatchRequest: (request: Request) => Promise<Response>;
        }
      ).handleDeliverDispatchRequest(
        new Request("https://runtime-transport.test/deliver-dispatch", {
          body: JSON.stringify(buildDeliverRequest()),
          method: "POST",
        })
      );

      expect(deliveryResponse.status).toBe(200);
      await expect(deliveryResponse.json()).resolves.toMatchObject({
        accepted: true,
        status: "delivered",
      });
      expect(sentFrames).toHaveLength(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("stores RuntimeCoordinator command state before sending delivery to the daemon", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const { hub, sentFrames, socket, state, storageRecords } =
        createHarness();
      const setAlarm = vi.mocked(
        (
          hub as unknown as {
            ctx: {
              storage: { setAlarm: (scheduledTime: number) => Promise<void> };
            };
          }
        ).ctx.storage.setAlarm
      );
      vi.mocked(socket.send).mockImplementation((message) => {
        const commandState = [...storageRecords.values()].find(
          (
            value
          ): value is {
            modelVersion: string;
            runtimeCoordinatorExecutionId: string;
          } =>
            value !== null &&
            typeof value === "object" &&
            (value as { modelVersion?: unknown }).modelVersion ===
              "openmeld.runtime_coordinator.run_command_state.v1"
        );
        expect(commandState).toMatchObject({
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        });
        expect(setAlarm).toHaveBeenCalledWith(1_700_000_030_000);
        sentFrames.push(JSON.parse(String(message)));
      });

      await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });

      expect(sentFrames).toHaveLength(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("does not let a pre-send RuntimeCoordinator command state create a second fact when daemon delivery fails", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceFetchRequests,
        state,
      } = createHarness();
      configureCompatibleRoute({
        socket,
        state,
      });
      vi.mocked(socket.send).mockImplementationOnce(() => {
        throw new Error("socket not writable");
      });
      await acceptDefaultRuntimeCoordinatorHead(hub);

      const response = await (
        hub as unknown as {
          handleDeliverDispatchRequest: (request: Request) => Promise<Response>;
        }
      ).handleDeliverDispatchRequest(
        new Request("https://runtime-transport.test/deliver-dispatch", {
          body: JSON.stringify(buildDeliverRequest()),
          method: "POST",
        })
      );

      await expect(response.json()).resolves.toMatchObject({
        accepted: false,
        reasonCode: "daemon.profile.offline",
        status: "rejected",
      });
      expect(response.status).toBe(409);
      expect(state.pendingDispatches.size).toBe(0);

      recordingD1.calls.length = 0;
      sentFrames.length = 0;
      spaceFetchRequests.length = 0;
      nowSpy.mockReturnValue(1_700_000_031_000);

      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(sentFrames).toEqual([]);
      expect(spaceFetchRequests).toEqual([]);
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) => call.params[2] === "runtime_coordinator_timeout_terminal"
        )
      ).toBe(false);
      await expect(
        (
          hub as unknown as {
            resolveNextRuntimeCoordinatorWatchdogAlarmAtMs: () => Promise<
              number | null
            >;
          }
        ).resolveNextRuntimeCoordinatorWatchdogAlarmAtMs()
      ).resolves.toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("reuses a pre-send RuntimeCoordinator token authority safely on the next Queue delivery retry", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceFetchRequests,
        state,
        storageRecords,
      } = createHarness();
      configureCompatibleRoute({
        socket,
        state,
      });
      vi.mocked(socket.send).mockImplementationOnce(() => {
        throw new Error("socket not writable");
      });
      await acceptDefaultRuntimeCoordinatorHead(hub);

      const firstResponse = await (
        hub as unknown as {
          handleDeliverDispatchRequest: (request: Request) => Promise<Response>;
        }
      ).handleDeliverDispatchRequest(
        new Request("https://runtime-transport.test/deliver-dispatch", {
          body: JSON.stringify(buildDeliverRequest()),
          method: "POST",
        })
      );

      await expect(firstResponse.json()).resolves.toMatchObject({
        accepted: false,
        reasonCode: "daemon.profile.offline",
        status: "rejected",
      });
      const authorityAfterFailedSend = [...storageRecords.values()].find(
        (value): value is RuntimeCoordinatorExecutionTokenAuthorityRecord =>
          value !== null && typeof value === "object" && "runsById" in value
      );
      const preSendRunId = authorityAfterFailedSend?.currentRunId ?? null;
      expect(preSendRunId).toEqual(expect.any(String));
      expect(authorityAfterFailedSend?.terminalOutcome).toBeNull();
      expect(
        authorityAfterFailedSend?.runsById[String(preSendRunId)]
      ).toMatchObject({
        tokenStatus: "active",
      });
      expect(
        findRuntimeCoordinatorRunCommandState(storageRecords)
      ).toBeUndefined();

      recordingD1.calls.length = 0;
      sentFrames.length = 0;
      spaceFetchRequests.length = 0;
      const decisionResponse = await (
        hub as unknown as {
          decideRuntimeCoordinatorExecutionProgress: (
            input: RuntimeTransportRuntimeCoordinatorDecisionRequest
          ) => Promise<{
            action?: string;
            ok: boolean;
            reasonCode: string;
            status: string;
          }>;
        }
      ).decideRuntimeCoordinatorExecutionProgress({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        eventKind: "retry",
        idempotencyKey: "queue:dispatch-1:retry:pre-send-command-missing",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        sourceClientMessageId: "client-message-1",
        spaceId: HEX_SPACE_ID,
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        trigger: "queue",
      });

      expect(decisionResponse).toMatchObject({
        action: "redelivery_deferred",
        ok: true,
        reasonCode: "runtime_coordinator.redelivery_command_missing",
        status: "recorded",
      });
      expect(sentFrames).toEqual([]);
      expect(spaceFetchRequests).toEqual([]);
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) => call.params[2] === "runtime_coordinator_timeout_terminal"
        )
      ).toBe(false);

      recordingD1.calls.length = 0;
      const secondResponse = await (
        hub as unknown as {
          handleDeliverDispatchRequest: (request: Request) => Promise<Response>;
        }
      ).handleDeliverDispatchRequest(
        new Request("https://runtime-transport.test/deliver-dispatch", {
          body: JSON.stringify(buildDeliverRequest()),
          method: "POST",
        })
      );

      await expect(secondResponse.json()).resolves.toMatchObject({
        accepted: true,
        status: "delivered",
      });
      expect(secondResponse.status).toBe(200);
      const deliveredFrame = sentFrames.find(
        (frame) =>
          typeof frame === "object" &&
          frame !== null &&
          (frame as { code?: unknown }).code === "daemon.dispatch.deliver"
      ) as
        | {
            payload?: {
              payload?: {
                executionToken?: RuntimeCoordinatorExecutionTokenEnvelope;
              };
            };
          }
        | undefined;
      expect(deliveredFrame?.payload?.payload?.executionToken?.runId).toBe(
        preSendRunId
      );
      const commandState =
        findRuntimeCoordinatorRunCommandState(storageRecords);
      expect(commandState).toMatchObject({
        activeRunId: preSendRunId,
        lastCommandReasonCode: "runtime_coordinator.delivery_command_stored",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      });
      const authorityAfterRetry = [...storageRecords.values()].find(
        (value): value is RuntimeCoordinatorExecutionTokenAuthorityRecord =>
          value !== null && typeof value === "object" && "runsById" in value
      );
      expect(authorityAfterRetry?.currentRunId).toBe(preSendRunId);
      expect(authorityAfterRetry?.terminalOutcome).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("does not delivery-expire durable running progress from alarm after pending memory is lost", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceFetchRequests,
        state,
        storageRecords,
      } = createHarness();
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      state.pendingDispatches.clear();

      await (
        hub as unknown as {
          handleDispatchLifecycleFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchLifecycleFrame(
        socket,
        buildLifecycleRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          lifecycleAtMs: 1_700_000_000_300,
          phase: "running",
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );

      recordingD1.calls.length = 0;
      sentFrames.length = 0;
      spaceFetchRequests.length = 0;
      nowSpy.mockReturnValue(1_700_000_031_000);

      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(sentFrames).toEqual([]);
      expect(spaceFetchRequests).toEqual([]);
      const authority = [...storageRecords.values()].find(
        (value): value is RuntimeCoordinatorExecutionTokenAuthorityRecord =>
          value !== null && typeof value === "object" && "runsById" in value
      );
      expect(authority?.terminalOutcome).toBeNull();
      expect(authority?.runsById[executionToken.runId]).toMatchObject({
        tokenStatus: "active",
      });
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) => call.params[2] === "runtime_coordinator_timeout_terminal"
        )
      ).toBe(false);
      const progressDecision = getRuntimeCoordinatorEventCalls(
        recordingD1.calls
      ).find(
        (call) => call.params[2] === "runtime_coordinator_decision_recorded"
      );
      expect(JSON.parse(String(progressDecision?.params[7]))).toMatchObject({
        action: "keep_waiting",
        reasonCode: "runtime_coordinator.local_progress_active",
        trigger: "alarm",
      });
      const commandState = [...storageRecords.values()].find(
        (
          value
        ): value is {
          lastCommandReasonCode: string | null;
          runtimeCoordinatorExecutionId: string;
          updatedAtMs: number;
        } =>
          value !== null &&
          typeof value === "object" &&
          (value as { modelVersion?: unknown }).modelVersion ===
            "openmeld.runtime_coordinator.run_command_state.v1"
      );
      expect(commandState).toMatchObject({
        lastCommandReasonCode: "runtime_coordinator.local_progress_active",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        updatedAtMs: 1_700_000_031_000,
      });
      await expect(
        (
          hub as unknown as {
            resolveNextRuntimeCoordinatorWatchdogAlarmAtMs: () => Promise<
              number | null
            >;
          }
        ).resolveNextRuntimeCoordinatorWatchdogAlarmAtMs()
      ).resolves.toBe(1_700_000_061_000);
      expect(
        recordingD1.calls.some(
          (call) =>
            SQL_SELECT_PATTERN.test(call.query) &&
            call.query.includes("openMeldDaemon_runtime_coordinator_executions")
        )
      ).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("keeps watchdog checks out of progress and retries late-result notice publication before acknowledgement", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceStub,
        spaceFetchRequests,
        state,
        storageRecords,
      } = createHarness({ taskTerminalOutcomeWriteFailures: 2 });
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      state.pendingDispatches.clear();

      await (
        hub as unknown as {
          handleDispatchLifecycleFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchLifecycleFrame(
        socket,
        buildLifecycleRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          lifecycleAtMs: 1_700_000_000_300,
          phase: "running",
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );

      recordingD1.calls.length = 0;
      sentFrames.length = 0;
      spaceFetchRequests.length = 0;
      nowSpy.mockReturnValue(1_700_000_031_000);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      recordingD1.calls.length = 0;
      sentFrames.length = 0;
      spaceFetchRequests.length = 0;
      nowSpy.mockReturnValue(1_700_000_061_000);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(sentFrames).toEqual([]);
      expect(spaceFetchRequests).toEqual([]);
      const secondRoundDecision = getRuntimeCoordinatorEventCalls(
        recordingD1.calls
      ).find(
        (call) => call.params[2] === "runtime_coordinator_decision_recorded"
      );
      expect(JSON.parse(String(secondRoundDecision?.params[7]))).toMatchObject({
        action: "keep_waiting",
        reasonCode: "runtime_coordinator.progress_stale_policy_pending",
        trigger: "alarm",
      });
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some((call) => {
          const payload = JSON.parse(String(call.params[7]));
          return (
            payload.reasonCode === "runtime_coordinator.local_progress_active"
          );
        })
      ).toBe(false);
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) => call.params[2] === "runtime_coordinator_timeout_terminal"
        )
      ).toBe(false);
      const commandState =
        findRuntimeCoordinatorRunCommandState(storageRecords);
      expect(commandState).toMatchObject({
        lastCommandReasonCode:
          "runtime_coordinator.progress_stale_policy_pending",
        lastWatchdogCheckAtMs: 1_700_000_061_000,
        localProgress: {
          lastLifecycleAtMs: 1_700_000_000_300,
          runningAtMs: 1_700_000_000_300,
        },
      });

      recordingD1.calls.length = 0;
      sentFrames.length = 0;
      spaceFetchRequests.length = 0;
      const drainingSession = state.sessionsById.get("daemon-session-1");
      if (!drainingSession) {
        throw new Error("Expected the registered daemon session.");
      }
      drainingSession.acceptingDispatches = false;
      drainingSession.stopCause = "controlled_service_update";
      nowSpy.mockReturnValue(1_700_000_300_300);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(sentFrames).toEqual([]);
      expect(spaceFetchRequests).toHaveLength(1);
      expect(spaceFetchRequests[0]).toMatchObject({
        path: "/rpc/signals/system-notice",
      });
      expect(spaceFetchRequests[0]?.body).toMatchObject({
        data: {
          actorProfileId: TARGET_AGENT_PROFILE_ID,
          actorName: "Codex Agent",
          dispatchId: "dispatch-1",
          failureStage: "execution",
          generatedBy: "openmeld",
          noticeType: "terminal_failure",
          reason: "runtime.progress_stale",
          reasonCode: "runtime.progress_stale",
          stopCause: "controlled_service_update",
          text: "Codex Agent stopped making progress on this Wake. Reconnect OpenMeld Service before trying again.",
        },
      });
      const progressStaleTerminalEvent = getRuntimeCoordinatorEventCalls(
        recordingD1.calls
      ).find(
        (call) => call.params[2] === "runtime_coordinator_timeout_terminal"
      );
      expect(
        JSON.parse(String(progressStaleTerminalEvent?.params[7]))
      ).toMatchObject({
        action: "timeout_terminal",
        progressStale: {
          expiryCause: "local_progress_stale",
          publicationStatus: "published",
          publishedSignalId: "signal-delivery-expired-1",
        },
        reasonCode: "runtime.progress_stale",
        trigger: "alarm",
      });
      const terminalAuthority = [...storageRecords.values()].find(
        (value): value is RuntimeCoordinatorExecutionTokenAuthorityRecord =>
          value !== null && typeof value === "object" && "runsById" in value
      );
      expect(terminalAuthority?.terminalOutcome).toMatchObject({
        reasonCode: "runtime.progress_stale",
        replySignalId: "signal-delivery-expired-1",
        status: "failed_terminal",
      });
      const agentTaskOutcomeWrite = recordingD1.calls.find((call) =>
        call.query.includes("INSERT INTO agent_task_terminal_outcomes")
      );
      expect(agentTaskOutcomeWrite?.params[2]).toBe("failed");
      expect(JSON.parse(String(agentTaskOutcomeWrite?.params[4]))).toEqual({
        errorCode: "runtime.progress_stale",
        eventId: `runtime-coordinator-terminal:${RUNTIME_COORDINATOR_EXECUTION_ID}`,
        occurredAtMs: 1_700_000_300_300,
        publishedSignalId: "signal-delivery-expired-1",
        status: "failed",
      });
      expect(recordingD1.taskTerminalOutcomeRows.size).toBe(0);
      expect(
        storageRecords.get(
          "runtime-coordinator:agent-task-observation-delivery:index"
        )
      ).toEqual([
        `agent-task-observation:${RUNTIME_COORDINATOR_EXECUTION_ID}:runtime-coordinator-terminal:${RUNTIME_COORDINATOR_EXECUTION_ID}`,
      ]);

      const restarted = createHarness({ storageRecords });
      await (
        restarted.hub as unknown as {
          processRuntimeCoordinatorAgentTaskObservationDeliveryAlarm: (
            nowMs: number
          ) => Promise<void>;
        }
      ).processRuntimeCoordinatorAgentTaskObservationDeliveryAlarm(
        1_700_000_300_301
      );
      expect(restarted.recordingD1.taskTerminalOutcomeRows.size).toBe(1);
      expect(
        storageRecords.get(
          "runtime-coordinator:agent-task-observation-delivery:index"
        )
      ).toEqual([]);
      expect(spaceFetchRequests).toHaveLength(1);

      recordingD1.calls.length = 0;
      sentFrames.length = 0;
      spaceFetchRequests.length = 0;
      vi.mocked(
        spaceStub.rpcPostExecutionRecoveryNoticeSignal
      ).mockRejectedValueOnce(
        new Error("late-result notice temporarily unavailable")
      );
      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );

      expect(sentFrames).toContainEqual(
        expect.objectContaining({
          code: "daemon.dispatch.accepted",
          payload: expect.objectContaining({
            ok: false,
            reasonCode: "daemon.result.finalization_unavailable",
            status: "retry_later",
          }),
        })
      );
      expect(
        recordingD1.inboxRows.get("dispatch-1::attempt-1")?.publish_state
      ).toBe("late_result_available");
      expect(
        recordingD1.inboxRows.get("dispatch-1::attempt-1")?.published_signal_id
      ).toBeNull();

      sentFrames.length = 0;
      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );

      expect(sentFrames).toContainEqual(
        expect.objectContaining({
          code: "daemon.dispatch.accepted",
          payload: expect.objectContaining({
            ok: true,
            status: "accepted",
          }),
        })
      );
      expect(spaceFetchRequests).toHaveLength(1);
      expect(spaceFetchRequests[0]?.body).toMatchObject({
        data: {
          actorProfileId: TARGET_AGENT_PROFILE_ID,
          dispatchId: "dispatch-1",
          generatedBy: "openmeld",
          noticeType: "execution_recovery_available",
          reasonCode: "runtime_coordinator.late_result_available",
          resultRef: "dispatch-1::attempt-1",
        },
      });
      expect(spaceFetchRequests[0]?.path).toBe(
        "/rpc/signals/execution-recovery"
      );
      expect(
        recordingD1.inboxRows.get("dispatch-1::attempt-1")?.published_signal_id
      ).toBe("execution-recovery:space-1:dispatch-1::attempt-1");
      expect(terminalAuthority?.terminalOutcome).toMatchObject({
        reasonCode: "runtime.progress_stale",
        replySignalId: "signal-delivery-expired-1",
        status: "failed_terminal",
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("redelivers a Wake that reached a Service while a controlled update was closing admission", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceFetchRequests,
        state,
      } = createHarness();
      await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });

      const oldSession = state.sessionsById.get("daemon-session-1");
      if (!oldSession) {
        throw new Error("Expected the original daemon session.");
      }
      oldSession.acceptingDispatches = false;
      oldSession.deliveryDisconnectedAtMs = 1_700_000_001_000;
      oldSession.socket = null;
      oldSession.stopCause = "controlled_service_update";

      const replacementSocket = {
        send: vi.fn((message: string) => {
          sentFrames.push(JSON.parse(message));
        }),
      } as unknown as WebSocket;
      registerCompatibleRoute({
        connectionGeneration: 9,
        daemonSessionId: "daemon-session-2",
        leaseEpoch: 5,
        socket: replacementSocket,
        state,
      });
      sentFrames.length = 0;
      recordingD1.calls.length = 0;
      spaceFetchRequests.length = 0;
      nowSpy.mockReturnValue(1_700_000_001_200);

      await (
        hub as unknown as {
          reconcileRuntimeCoordinatorExecutionsForReplacementSession: (input: {
            daemonSessionId: string;
          }) => Promise<void>;
        }
      ).reconcileRuntimeCoordinatorExecutionsForReplacementSession({
        daemonSessionId: "daemon-session-2",
      });

      expect(sentFrames).toEqual([
        expect.objectContaining({
          code: "daemon.dispatch.deliver",
          payload: expect.objectContaining({
            connectionGeneration: 9,
            daemonSessionId: "daemon-session-2",
            leaseEpoch: 5,
          }),
        }),
      ]);
      expect(spaceFetchRequests).toEqual([]);
      expect(
        recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
      ).toMatchObject({
        status: "delivery_accepted",
      });
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) =>
            call.params[2] === "runtime_coordinator_redelivery_commanded"
        )
      ).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("redelivers exactly once after a hub restart loses the old in-memory Service session", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const first = createHarness();
      await issueDeliveryToken({
        hub: first.hub,
        sentFrames: first.sentFrames,
        socket: first.socket,
        state: first.state,
      });

      expect(
        findRuntimeCoordinatorRunCommandState(first.storageRecords)
          ?.lastDeliveryProvenance
      ).toMatchObject({
        daemonSessionId: "daemon-session-1",
        deviceId: "device-1",
        lane: "dev-local",
      });

      const restarted = createHarness({
        storageRecords: first.storageRecords,
      });
      const replacementSocket = {
        send: vi.fn((message: string) => {
          restarted.sentFrames.push(JSON.parse(message));
        }),
      } as unknown as WebSocket;
      registerCompatibleRoute({
        connectionGeneration: 9,
        daemonSessionId: "daemon-session-2",
        leaseEpoch: 5,
        socket: replacementSocket,
        state: restarted.state,
      });
      expect(restarted.state.sessionsById.has("daemon-session-1")).toBe(false);
      restarted.sentFrames.length = 0;
      nowSpy.mockReturnValue(1_700_000_001_200);

      const reconcile = () =>
        (
          restarted.hub as unknown as {
            reconcileRuntimeCoordinatorExecutionsForReplacementSession: (input: {
              daemonSessionId: string;
            }) => Promise<void>;
          }
        ).reconcileRuntimeCoordinatorExecutionsForReplacementSession({
          daemonSessionId: "daemon-session-2",
        });
      await Promise.all([reconcile(), reconcile()]);

      expect(
        restarted.sentFrames.filter(
          (frame) =>
            typeof frame === "object" &&
            frame !== null &&
            (frame as { code?: unknown }).code === "daemon.dispatch.deliver"
        )
      ).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({
            connectionGeneration: 9,
            daemonSessionId: "daemon-session-2",
            leaseEpoch: 5,
          }),
        }),
      ]);
      expect(
        findRuntimeCoordinatorRunCommandState(first.storageRecords)
      ).toMatchObject({
        lastDeliveryProvenance: {
          daemonSessionId: "daemon-session-2",
          deviceId: "device-1",
          lane: "dev-local",
        },
        redeliveryCount: 1,
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("reconciles one active local run when a replacement service session proves the old runtime was lost", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceFetchRequests,
        state,
        storageRecords,
        waitUntilTasks,
      } = createHarness({
        agentControllerReportRow: buildRuntimeAgentControllerReportRow(),
      });
      Object.defineProperty(hub, "reconcileExpectedRoutesForSession", {
        value: vi.fn(async () => undefined),
      });
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      await (
        hub as unknown as {
          handleDispatchLifecycleFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchLifecycleFrame(
        socket,
        buildLifecycleRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          lifecycleAtMs: 1_700_000_000_300,
          phase: "running",
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
      const oldSession = state.sessionsById.get("daemon-session-1");
      if (!oldSession) {
        throw new Error("Expected the original daemon session.");
      }
      oldSession.acceptingDispatches = false;
      oldSession.deliveryDisconnectedAtMs = 1_700_000_001_000;
      oldSession.socket = null;
      oldSession.stopCause = "controlled_service_update";
      let replacementAttachment: unknown = {
        verifiedOwnerUserId: "owner-1",
      };
      const replacementSocket = {
        close: vi.fn(),
        deserializeAttachment: vi.fn(() => replacementAttachment),
        send: vi.fn((message: string) => {
          sentFrames.push(JSON.parse(message));
        }),
        serializeAttachment: vi.fn((value: unknown) => {
          replacementAttachment = value;
        }),
      } as unknown as WebSocket;
      recordingD1.calls.length = 0;
      spaceFetchRequests.length = 0;
      waitUntilTasks.length = 0;
      nowSpy.mockReturnValue(1_700_000_001_100);

      const registerReplacement = async () => {
        (
          hub as unknown as {
            handleRegisterSessionFrame: (
              webSocket: WebSocket,
              payload: unknown
            ) => void;
          }
        ).handleRegisterSessionFrame(replacementSocket, {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          capabilities: {
            runtimeAdapters: [codexRuntimeAdapterCapability],
          },
          connectedAtMs: 1_700_000_001_100,
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-2",
          deviceId: "device-1",
          lane: "dev-local",
          ownerUserId: "owner-1",
          profileIds: [TARGET_AGENT_PROFILE_ID],
          runtimeContract: {
            epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          },
        });
        await Promise.allSettled([...waitUntilTasks]);
      };
      await registerReplacement();

      expect(
        recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
      ).toMatchObject({
        status: "running",
      });
      expect(spaceFetchRequests).toHaveLength(0);
      expect(state.sessionsById.get("daemon-session-2")).toMatchObject({
        acceptingDispatches: false,
      });

      const replacementLease = state.profileLeasesByProfileId.get(
        TARGET_AGENT_PROFILE_ID
      );
      if (!replacementLease) {
        throw new Error("Expected the replacement session lease.");
      }
      waitUntilTasks.length = 0;
      (
        hub as unknown as {
          handleHeartbeatFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => void;
        }
      ).handleHeartbeatFrame(replacementSocket, {
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        daemonSessionId: "daemon-session-2",
        deviceId: "device-1",
        lane: "dev-local",
        leases: [
          {
            leaseEpoch: replacementLease.leaseEpoch,
            profileId: TARGET_AGENT_PROFILE_ID,
          },
        ],
        ownerUserId: "owner-1",
        runtimeContract: {
          epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        },
        sentAtMs: 1_700_000_001_200,
      });
      const heartbeatTasks = await Promise.allSettled([...waitUntilTasks]);
      expect(
        heartbeatTasks.filter((result) => result.status === "rejected")
      ).toEqual([]);
      expect(state.sessionsById.get("daemon-session-1")).toMatchObject({
        deliveryDisconnectedAtMs: 1_700_000_001_000,
        deviceId: "device-1",
        lane: "dev-local",
        ownerUserId: "owner-1",
        socket: null,
      });
      expect(state.sessionsById.get("daemon-session-2")).toMatchObject({
        acceptingDispatches: true,
        deviceId: "device-1",
        lane: "dev-local",
        ownerUserId: "owner-1",
      });
      expect(
        state.profileLeasesByProfileId.get(TARGET_AGENT_PROFILE_ID)
      ).toMatchObject({
        daemonSessionId: "daemon-session-2",
      });

      expect(
        recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
      ).toMatchObject({
        status: "failed_terminal",
      });
      expect(
        JSON.parse(
          String(
            recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
              ?.terminal_outcome_json
          )
        )
      ).toMatchObject({
        kind: "failed_terminal",
        reasonCode: "runtime.local_runtime_lost",
      });
      expect(
        findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords)
      ).toMatchObject({
        currentRunId: null,
        terminalOutcome: {
          reasonCode: "runtime.local_runtime_lost",
          status: "failed_terminal",
        },
      });
      expect(spaceFetchRequests).toHaveLength(1);
      expect(spaceFetchRequests[0]).toMatchObject({
        path: "/rpc/signals/system-notice",
        body: {
          data: expect.objectContaining({
            dispatchId: "dispatch-1",
            failureStage: "execution",
            noticeType: "terminal_failure",
            reasonCode: "runtime.local_runtime_lost",
            stopCause: "controlled_service_update",
            text: "Codex Agent was interrupted when OpenMeld Service restarted.",
          }),
        },
      });
      expect(recordingD1.taskTerminalOutcomeRows.size).toBe(1);
      const terminalTaskWritesAfterFirstReconcile = recordingD1.calls.filter(
        (call) =>
          call.query.includes("INSERT INTO agent_task_terminal_outcomes")
      ).length;

      waitUntilTasks.length = 0;
      await registerReplacement();

      expect(spaceFetchRequests).toHaveLength(1);
      expect(recordingD1.taskTerminalOutcomeRows.size).toBe(1);
      expect(
        recordingD1.calls.filter((call) =>
          call.query.includes("INSERT INTO agent_task_terminal_outcomes")
        )
      ).toHaveLength(terminalTaskWritesAfterFirstReconcile);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("serializes concurrent lost-run reconciliation after replacement route registration", async () => {
    vi.useFakeTimers({
      now: 1_700_000_000_000,
    });
    try {
      const {
        hub,
        queuedObservationRedrives,
        recordingD1,
        sentFrames,
        socket,
        spaceFetchRequests,
        spaceStub,
        state,
        storageRecords,
        waitUntilTasks,
      } = createHarness({
        agentControllerReportRow: buildRuntimeAgentControllerReportRow(),
      });
      Object.defineProperty(hub, "reconcileExpectedRoutesForSession", {
        value: vi.fn(async () => undefined),
      });
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      await (
        hub as unknown as {
          handleDispatchLifecycleFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchLifecycleFrame(
        socket,
        buildLifecycleRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          lifecycleAtMs: 1_700_000_000_300,
          phase: "running",
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
      const oldSession = state.sessionsById.get("daemon-session-1");
      if (!oldSession) {
        throw new Error("Expected the original daemon session.");
      }
      oldSession.acceptingDispatches = false;
      oldSession.deliveryDisconnectedAtMs = 1_700_000_001_000;
      oldSession.socket = null;
      oldSession.stopCause = "controlled_service_update";

      let replacementAttachment: unknown = {
        verifiedOwnerUserId: "owner-1",
      };
      const replacementSocket = {
        close: vi.fn(),
        deserializeAttachment: vi.fn(() => replacementAttachment),
        send: vi.fn((message: string) => {
          sentFrames.push(JSON.parse(message));
        }),
        serializeAttachment: vi.fn((value: unknown) => {
          replacementAttachment = value;
        }),
      } as unknown as WebSocket;
      recordingD1.calls.length = 0;
      spaceFetchRequests.length = 0;
      waitUntilTasks.length = 0;
      vi.setSystemTime(1_700_000_001_100);

      const registerReplacement = (profileIds: string[]) => {
        (
          hub as unknown as {
            handleRegisterSessionFrame: (
              webSocket: WebSocket,
              payload: unknown
            ) => void;
          }
        ).handleRegisterSessionFrame(replacementSocket, {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          capabilities: {
            runtimeAdapters: [codexRuntimeAdapterCapability],
          },
          connectedAtMs: 1_700_000_001_100,
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-2",
          deviceId: "device-1",
          lane: "dev-local",
          ownerUserId: "owner-1",
          profileIds,
          runtimeContract: {
            epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          },
        });
      };
      const settleWaitUntilTasks = async () => {
        let settledTaskCount = 0;
        while (settledTaskCount < waitUntilTasks.length) {
          const tasks = await Promise.allSettled(
            waitUntilTasks.slice(settledTaskCount)
          );
          settledTaskCount = waitUntilTasks.length;
          expect(
            tasks.filter((result) => result.status === "rejected")
          ).toEqual([]);
        }
      };

      registerReplacement([]);
      await settleWaitUntilTasks();

      expect(state.sessionsById.get("daemon-session-2")).toMatchObject({
        acceptingDispatches: false,
        profileIds: new Set(),
      });
      expect(
        state.profileLeasesByProfileId.get(TARGET_AGENT_PROFILE_ID)
      ).toMatchObject({
        daemonSessionId: "daemon-session-1",
      });

      const persistedNoticeId = "signal-delivery-expired-1";
      const persistedNoticeIds = new Set<string>();
      let noticePublicationAttempt = 0;
      let rejectFirstReconciliation: ((reason?: unknown) => void) | undefined;
      const firstReconciliation = new Promise<never>((_resolve, reject) => {
        rejectFirstReconciliation = reject;
      });
      const originalReconcile = (
        hub as unknown as {
          reconcileRuntimeCoordinatorExecutionForReplacementSession: (input: {
            commandState: RuntimeCoordinatorRunCommandState;
            daemonSessionId: string;
          }) => Promise<void>;
        }
      ).reconcileRuntimeCoordinatorExecutionForReplacementSession.bind(hub);
      let reconciliationAttempt = 0;
      Object.defineProperty(
        hub,
        "reconcileRuntimeCoordinatorExecutionForReplacementSession",
        {
          value: vi.fn(
            async (input: {
              commandState: RuntimeCoordinatorRunCommandState;
              daemonSessionId: string;
            }) => {
              reconciliationAttempt += 1;
              if (reconciliationAttempt === 1) {
                await firstReconciliation;
              }
              await originalReconcile(input);
            }
          ),
        }
      );
      vi.mocked(spaceStub.rpcPostSystemNoticeSignal).mockImplementation(
        async (input) => {
          noticePublicationAttempt += 1;
          const attempt = noticePublicationAttempt;
          spaceFetchRequests.push({
            path: "/rpc/signals/system-notice",
            body: {
              profile: input.profile,
              data: input.data,
              ...(input.finalOutcomeAuthority
                ? { finalOutcomeAuthority: input.finalOutcomeAuthority }
                : {}),
              ...(input.threadContext
                ? { threadContext: input.threadContext }
                : {}),
            },
          });
          if (attempt === 1) {
            persistedNoticeIds.add(persistedNoticeId);
          } else {
            await vi.waitFor(() => {
              expect(
                findRuntimeCoordinatorExecutionTokenAuthorityRecord(
                  storageRecords
                )?.terminalOutcome?.replySignalId
              ).toBe(persistedNoticeId);
            });
          }
          return {
            v: 1,
            id:
              attempt === 1
                ? persistedNoticeId
                : `signal-unpersisted-duplicate-${attempt}`,
            spaceId: HEX_SPACE_ID,
            ts: 1_700_000_031_000,
            profile: {
              kind: "system",
              profileId: "openmeld-system",
              profileName: "OpenMeld System",
            },
            type: "signal.system_notice",
            data: {
              noticeType: "terminal_failure",
              actorProfileId: TARGET_AGENT_PROFILE_ID,
              actorName: "Codex Agent",
              dispatchId: "dispatch-1",
              generatedBy: "openmeld",
              reason: "runtime.local_runtime_lost",
              text: "The local runtime was lost.",
            },
          };
        }
      );

      const conflictingProfileId = "agt_22222222-2222-4222-8222-222222222222";
      state.profileLeasesByProfileId.set(conflictingProfileId, {
        capabilities: {
          runtimeAdapters: [codexRuntimeAdapterCapability],
        },
        daemonSessionId: "daemon-session-conflicting",
        deviceId: "device-2",
        executionCompatibility: {
          expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          reasonCode: "daemon.runtime_contract.compatible",
          status: "compatible",
        },
        lane: "dev-local",
        lastHeartbeatMs: 1_700_000_001_200,
        leaseEpoch: 1,
        profileId: conflictingProfileId,
      });

      waitUntilTasks.length = 0;
      (
        hub as unknown as {
          handleHeartbeatFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => void;
        }
      ).handleHeartbeatFrame(replacementSocket, {
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        acceptingDispatches: true,
        daemonSessionId: "daemon-session-2",
        deviceId: "device-1",
        lane: "dev-local",
        leases: [],
        ownerUserId: "owner-1",
        runtimeContract: {
          epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        },
        sentAtMs: 1_700_000_001_200,
      });
      registerReplacement([TARGET_AGENT_PROFILE_ID, conflictingProfileId]);
      registerReplacement([TARGET_AGENT_PROFILE_ID, conflictingProfileId]);
      const settleBurst = settleWaitUntilTasks();
      await vi.advanceTimersByTimeAsync(0);
      expect(reconciliationAttempt).toBe(1);
      expect(noticePublicationAttempt).toBe(0);
      await vi.advanceTimersByTimeAsync(1000);
      rejectFirstReconciliation?.(
        new Error("simulated slow first reconciliation failure")
      );
      await settleBurst;

      expect(state.sessionsById.get("daemon-session-2")).toMatchObject({
        acceptingDispatches: true,
        profileIds: new Set([TARGET_AGENT_PROFILE_ID]),
      });

      expect(
        state.profileLeasesByProfileId.get(TARGET_AGENT_PROFILE_ID)
      ).toMatchObject({
        daemonSessionId: "daemon-session-2",
      });
      expect(
        sentFrames.filter(
          (frame) =>
            typeof frame === "object" &&
            frame !== null &&
            (frame as { code?: unknown }).code === "daemon.session.register"
        )
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            payload: {
              acceptedLeases: [
                expect.objectContaining({
                  profileId: TARGET_AGENT_PROFILE_ID,
                }),
              ],
              connectionGeneration: 1,
              ok: false,
              rejectedProfiles: [
                {
                  profileId: conflictingProfileId,
                  reasonCode: "daemon.session.reject_conflict",
                },
              ],
            },
          }),
        ])
      );
      expect(
        recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
      ).toMatchObject({
        status: "failed_terminal",
      });
      expect(
        JSON.parse(
          String(
            recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
              ?.terminal_outcome_json
          )
        )
      ).toMatchObject({
        kind: "failed_terminal",
        reasonCode: "runtime.local_runtime_lost",
      });
      expect(
        findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords)
      ).toMatchObject({
        currentRunId: null,
        terminalOutcome: {
          reasonCode: "runtime.local_runtime_lost",
          replySignalId: persistedNoticeId,
          status: "failed_terminal",
        },
      });
      expect(reconciliationAttempt).toBe(3);
      expect(noticePublicationAttempt).toBe(1);
      expect(persistedNoticeIds).toEqual(new Set([persistedNoticeId]));
      expect(spaceFetchRequests).toHaveLength(1);
      expect(spaceFetchRequests[0]).toMatchObject({
        path: "/rpc/signals/system-notice",
        body: {
          data: expect.objectContaining({
            dispatchId: "dispatch-1",
            noticeType: "terminal_failure",
            reasonCode: "runtime.local_runtime_lost",
            stopCause: "controlled_service_update",
          }),
        },
      });
      expect(recordingD1.taskTerminalOutcomeRows.size).toBe(1);
      const taskOutcomeRow = [
        ...recordingD1.taskTerminalOutcomeRows.values(),
      ][0];
      expect(JSON.parse(String(taskOutcomeRow?.outcome_json))).toMatchObject({
        errorCode: "runtime.local_runtime_lost",
        publishedSignalId: persistedNoticeId,
        status: "failed",
      });
      expect(queuedObservationRedrives).toHaveLength(1);
      expect(queuedObservationRedrives[0]).toMatchObject({
        observation: {
          publishedSignalId: persistedNoticeId,
        },
      });
      expect(
        [...recordingD1.eventRows.values()].filter(
          (event) => event.reason_code === "runtime.local_runtime_lost"
        )
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records RuntimeCoordinator terminal authority before publishing delivery-expired failure to Space", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceStub,
        state,
        storageRecords,
      } = createHarness();
      await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      recordingD1.calls.length = 0;
      sentFrames.length = 0;
      state.pendingDispatches.clear();
      vi.mocked(spaceStub.rpcPostSystemNoticeSignal).mockImplementationOnce(
        () => {
          const authority = [...storageRecords.values()].find(
            (value): value is RuntimeCoordinatorExecutionTokenAuthorityRecord =>
              value !== null && typeof value === "object" && "runsById" in value
          );
          expect(authority?.terminalOutcome).toMatchObject({
            reasonCode: "runtime_coordinator.delivery_expired",
            replySignalId: null,
            status: "failed_terminal",
          });
          return Promise.reject(new Error("space unavailable"));
        }
      );
      nowSpy.mockReturnValue(1_700_000_031_000);

      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      const authority = [...storageRecords.values()].find(
        (value): value is RuntimeCoordinatorExecutionTokenAuthorityRecord =>
          value !== null && typeof value === "object" && "runsById" in value
      );
      expect(authority?.terminalOutcome).toMatchObject({
        reasonCode: "runtime_coordinator.delivery_expired",
        replySignalId: null,
        status: "failed_terminal",
      });
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) => call.params[2] === "runtime_coordinator_timeout_terminal"
        )
      ).toBe(true);
      const terminalEvent = getRuntimeCoordinatorEventCalls(
        recordingD1.calls
      ).find(
        (call) => call.params[2] === "runtime_coordinator_timeout_terminal"
      );
      expect(JSON.parse(String(terminalEvent?.params[7]))).toMatchObject({
        deliveryExpired: {
          failurePublicationReasonCode:
            "runtime_coordinator.failure_publication_unavailable",
          publicationStatus: "unavailable",
          publishedSignalId: null,
        },
      });
      expect(getReadinessImpactWriteCalls(recordingD1.calls)).toHaveLength(1);
      expect(
        findRuntimeCoordinatorPublicationBlockerRecord(storageRecords)
      ).toMatchObject({
        blockerKind: "publication_unavailable",
        dispatchId: "dispatch-1",
        publicationKind: "failure_notice",
        reasonCode: "runtime_coordinator.failure_publication_unavailable",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        status: "unresolved_publication_failure",
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("continues the delivery-expired terminal decision when readiness impact write fails", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      const {
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceFetchRequests,
        state,
      } = createHarness({
        readinessImpactWriteError: new Error("readiness impact D1 failed"),
      });
      await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      recordingD1.calls.length = 0;
      sentFrames.length = 0;
      state.pendingDispatches.clear();
      nowSpy.mockReturnValue(1_700_000_031_000);

      const response = await decideRuntimeCoordinatorProgress(
        hub,
        buildRuntimeCoordinatorDecisionInput({
          eventKind: "timeout",
          idempotencyKey:
            "alarm:dispatch-1:timeout:delivery-expired-readiness-impact-fails",
          trigger: "alarm",
        })
      );

      expect(response).toMatchObject({
        action: "timeout_terminal",
        ok: true,
        reasonCode: "runtime_coordinator.delivery_expired",
        status: "recorded",
      });
      expect(spaceFetchRequests).toHaveLength(1);
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) => call.params[2] === "runtime_coordinator_timeout_terminal"
        )
      ).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        "[core.runtime_transport.runtime_coordinator_delivery_expired_readiness_impact_write_failed]",
        expect.objectContaining({
          attemptId: "attempt-1",
          dispatchId: "dispatch-1",
          error: "readiness impact D1 failed",
          reasonCode: "runtime_coordinator.delivery_expired",
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
    } finally {
      warnSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it("does not delivery-expire durable completed progress from alarm after pending memory is lost", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceFetchRequests,
        state,
        storageRecords,
      } = createHarness();
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      state.pendingDispatches.clear();

      await (
        hub as unknown as {
          handleDispatchLifecycleFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchLifecycleFrame(
        socket,
        buildLifecycleRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          lifecycleAtMs: 1_700_000_000_400,
          phase: "completed_local",
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );

      recordingD1.calls.length = 0;
      sentFrames.length = 0;
      spaceFetchRequests.length = 0;
      nowSpy.mockReturnValue(1_700_000_031_000);

      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(sentFrames).toEqual([]);
      expect(spaceFetchRequests).toEqual([]);
      const authority = [...storageRecords.values()].find(
        (value): value is RuntimeCoordinatorExecutionTokenAuthorityRecord =>
          value !== null && typeof value === "object" && "runsById" in value
      );
      expect(authority?.terminalOutcome).toBeNull();
      expect(authority?.runsById[executionToken.runId]).toMatchObject({
        tokenStatus: "active",
      });
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) => call.params[2] === "runtime_coordinator_timeout_terminal"
        )
      ).toBe(false);
      expect(
        recordingD1.calls.some(
          (call) =>
            SQL_SELECT_PATTERN.test(call.query) &&
            call.query.includes("openMeldDaemon_runtime_coordinator_executions")
        )
      ).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("fails closed when D1 has a projection but Durable Object token authority is missing", async () => {
    const { hub, recordingD1, storageRecords } = createHarness({
      executionRow: buildRuntimeCoordinatorProjectionRow(),
    });

    const response = await (
      hub as unknown as {
        decideRuntimeCoordinatorExecutionProgress: (input: {
          v: typeof RUNTIME_TRANSPORT_SCHEMA_VERSION;
          attemptId: string;
          claimDecision: "claim_recovery";
          dispatchId: string;
          eventKind: "retry";
          idempotencyKey: string;
          reasonCode: string;
          runtimeCoordinatorExecutionId: string;
          sourceClientMessageId: string;
          spaceId: string;
          targetProfileId: string;
          trigger: "queue";
        }) => Promise<{
          ok: boolean;
          action?: string;
          reasonCode: string;
          status: string;
        }>;
      }
    ).decideRuntimeCoordinatorExecutionProgress({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      attemptId: "attempt-1",
      claimDecision: "claim_recovery",
      dispatchId: "dispatch-1",
      eventKind: "retry",
      idempotencyKey: "queue:dispatch-1:retry:authority-missing",
      reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      sourceClientMessageId: "client-message-1",
      spaceId: HEX_SPACE_ID,
      targetProfileId: TARGET_AGENT_PROFILE_ID,
      trigger: "queue",
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "runtime_coordinator.execution_token_authority_missing",
      status: "retry_later",
    });
    expect(
      [...storageRecords.values()].some(
        (value) =>
          value !== null && typeof value === "object" && "runsById" in value
      )
    ).toBe(false);
    const eventTypes = getRuntimeCoordinatorEventCalls(recordingD1.calls).map(
      (call) => call.params[2]
    );
    expect(eventTypes).not.toContain("runtime_coordinator_decision_recorded");
    expect(eventTypes).not.toContain("runtime_coordinator_retry_blocked");
    expect(
      recordingD1.calls.some((call) =>
        call.query.includes(
          "UPDATE openMeldDaemon_runtime_coordinator_executions"
        )
      )
    ).toBe(false);
  });

  it("rejects a decision scope mismatch without terminalizing the real execution", async () => {
    const { hub, recordingD1, sentFrames, socket, state, storageRecords } =
      createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    recordingD1.calls.length = 0;

    const response = await (
      hub as unknown as {
        decideRuntimeCoordinatorExecutionProgress: (input: {
          v: typeof RUNTIME_TRANSPORT_SCHEMA_VERSION;
          attemptId: string;
          claimDecision: "claim_recovery";
          dispatchId: string;
          eventKind: "retry";
          idempotencyKey: string;
          reasonCode: string;
          runtimeCoordinatorExecutionId: string;
          sourceClientMessageId: string;
          spaceId: string;
          targetProfileId: string;
          trigger: "queue";
        }) => Promise<{
          ok: boolean;
          action?: string;
          reasonCode: string;
          status: string;
        }>;
      }
    ).decideRuntimeCoordinatorExecutionProgress({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      attemptId: "attempt-1",
      claimDecision: "claim_recovery",
      dispatchId: "wrong-dispatch",
      eventKind: "retry",
      idempotencyKey: "queue:wrong-scope:retry:1",
      reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      sourceClientMessageId: "client-message-1",
      spaceId: "wrong-space",
      targetProfileId: "wrong-agent",
      trigger: "queue",
    });

    expect(response).toMatchObject({
      action: "diagnostic_only",
      ok: true,
      reasonCode: "runtime_coordinator.decision_scope_mismatch",
      status: "recorded",
    });
    const authority = [...storageRecords.values()].find(
      (value): value is RuntimeCoordinatorExecutionTokenAuthorityRecord =>
        value !== null && typeof value === "object" && "runsById" in value
    );
    expect(authority?.terminalOutcome).toBeNull();
    expect(authority?.runsById[executionToken.runId]).toMatchObject({
      tokenStatus: "active",
    });
    const eventTypes = getRuntimeCoordinatorEventCalls(recordingD1.calls).map(
      (call) => call.params[2]
    );
    expect(eventTypes).toContain("runtime_coordinator_decision_recorded");
    expect(eventTypes).not.toContain("runtime_coordinator_retry_blocked");
    const decisionEvent = getRuntimeCoordinatorEventCalls(
      recordingD1.calls
    ).find(
      (call) => call.params[2] === "runtime_coordinator_decision_recorded"
    );
    expect(decisionEvent?.params[3]).toBeNull();
    expect(decisionEvent?.params[7]).not.toContain("wrong-dispatch");
    expect(decisionEvent?.params[7]).not.toContain("wrong-space");
    expect(decisionEvent?.params[7]).not.toContain("wrong-agent");
    expect(
      recordingD1.calls.some((call) =>
        call.query.includes(
          "UPDATE openMeldDaemon_runtime_coordinator_executions"
        )
      )
    ).toBe(false);
  });

  it("keeps a published result terminal when a later coordinator reminder arrives", async () => {
    const { hub, recordingD1, sentFrames, socket, state, storageRecords } =
      createHarness();
    await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    const authorityEntry = [...storageRecords.entries()].find(
      (
        entry
      ): entry is [string, RuntimeCoordinatorExecutionTokenAuthorityRecord] =>
        entry[1] !== null &&
        typeof entry[1] === "object" &&
        "runsById" in entry[1]
    );
    if (!authorityEntry) {
      throw new Error("Expected RuntimeCoordinator token authority.");
    }
    storageRecords.set(authorityEntry[0], {
      ...authorityEntry[1],
      terminalOutcome: {
        finalizedAtMs: 1_700_000_010_000,
        reasonCode: "space.reply_published",
        replySignalId: "signal-final-1",
        status: "reply_published",
      },
    } satisfies RuntimeCoordinatorExecutionTokenAuthorityRecord);
    recordingD1.calls.length = 0;

    const response = await (
      hub as unknown as {
        decideRuntimeCoordinatorExecutionProgress: (input: {
          v: typeof RUNTIME_TRANSPORT_SCHEMA_VERSION;
          attemptId: string;
          dispatchId: string;
          eventKind: "timeout";
          idempotencyKey: string;
          reasonCode: string;
          runtimeCoordinatorExecutionId: string;
          sourceClientMessageId: string;
          spaceId: string;
          targetProfileId: string;
          trigger: "alarm";
        }) => Promise<{
          ok: boolean;
          action?: string;
          reasonCode: string;
          status: string;
        }>;
      }
    ).decideRuntimeCoordinatorExecutionProgress({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      eventKind: "timeout",
      idempotencyKey: "alarm:dispatch-1:timeout:after-final",
      reasonCode: "daemon.delivery.timeout",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      sourceClientMessageId: "client-message-1",
      spaceId: HEX_SPACE_ID,
      targetProfileId: TARGET_AGENT_PROFILE_ID,
      trigger: "alarm",
    });

    expect(response).toMatchObject({
      action: "diagnostic_only",
      ok: true,
      reasonCode: "execution_token_terminal_late",
      status: "recorded",
    });
    const authorityAfter = storageRecords.get(authorityEntry[0]);
    expect(authorityAfter).toMatchObject({
      terminalOutcome: {
        reasonCode: "space.reply_published",
        replySignalId: "signal-final-1",
        status: "reply_published",
      },
    });
    const eventTypes = getRuntimeCoordinatorEventCalls(recordingD1.calls).map(
      (call) => call.params[2]
    );
    expect(eventTypes).toContain("runtime_coordinator_decision_recorded");
    expect(eventTypes).not.toContain("runtime_coordinator_timeout_terminal");
  });

  it("accepts a result only after validating the echoed execution token", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      recordingD1,
      sentFrames,
      socket,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    const daemonEchoRunId = "run-from-daemon-echo";
    const daemonEchoTokenFingerprint = `etfp_v1_${"b".repeat(32)}`;
    recordingD1.calls.length = 0;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: {
          ...buildExecutionTokenEcho(executionToken),
          runId: daemonEchoRunId,
          tokenFingerprint: daemonEchoTokenFingerprint,
        },
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(
      state.pendingDispatches.has(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )
    ).toBe(false);
    expect(
      state.completedDispatchResults.has(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )
    ).toBe(true);
    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: true,
          status: "accepted",
        }),
      })
    );
    expect(
      recordingD1.calls.some((call) =>
        call.query.includes("openMeldDaemon_dispatch_result_inbox")
      )
    ).toBe(true);
    const inboxInsertCall = recordingD1.calls.find((call) =>
      call.query.includes("INSERT INTO openMeldDaemon_dispatch_result_inbox")
    );
    expect(inboxInsertCall?.params).toEqual(
      expect.arrayContaining([
        RUNTIME_COORDINATOR_EXECUTION_ID,
        executionToken.runId,
        executionToken.tokenFingerprint,
      ])
    );
    expect(inboxInsertCall?.params).not.toContain(daemonEchoRunId);
    expect(inboxInsertCall?.params).not.toContain(daemonEchoTokenFingerprint);
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "result_accepted"
      )
    ).toBe(true);

    // The receipt above is sent on durable acceptance; the Space publish
    // finishes in the waitUntil replay, so flush it before terminal asserts.
    await Promise.all(waitUntilTasks.splice(0));

    const [, rawAuthority] =
      findRuntimeCoordinatorExecutionTokenAuthorityEntry(storageRecords) ?? [];
    const authority =
      rawAuthority as RuntimeCoordinatorExecutionTokenAuthorityRecord;
    expect(authority.runsById[executionToken.runId]).toMatchObject({
      tokenSecretRefOrSealedToken: null,
      tokenStatus: "terminal",
    });
    expect(authority.terminalOutcome).toMatchObject({
      reasonCode: "space.reply_published",
      replySignalId: "signal-final-1",
      status: "reply_published",
    });
    expect(appliedFinalizationCommands).toHaveLength(1);
    expect(appliedFinalizationCommands[0]).toMatchObject({
      acceptedResult: {
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        executionTokenFingerprint: executionToken.tokenFingerprint,
        executionTokenRunId: executionToken.runId,
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      },
      dispatchFact: {
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        dispatchOwner: {
          id: "owner-1",
          kind: "owner_account",
        },
        sourceEventId: "signal-1",
        spaceId: HEX_SPACE_ID,
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        taskId: "task-1",
      },
      executionTokenRunId: executionToken.runId,
      finalizationCommandId: buildRuntimeCoordinatorFinalizationCommandId({
        executionTokenRunId: executionToken.runId,
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      }),
      modelVersion: RUNTIME_COORDINATOR_FINALIZATION_COMMAND_MODEL_VERSION,
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      spaceId: HEX_SPACE_ID,
      targetOwnerUserId: "owner-1",
    });
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "reply_published"
      )
    ).toBe(true);
  });

  it("fails closed when Space reports non-visible silence as a successful finalization", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      recordingD1,
      sentFrames,
      socket,
      spaceStub,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness();
    spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
      (command: RuntimeCoordinatorFinalizationCommand) => {
        appliedFinalizationCommands.push(command);
        return {
          finalMessageKind: "stay_silent" as const,
          finalizationCommandId: command.finalizationCommandId,
          ok: true as const,
          publicationErrorCode: null,
          publishedSignalId: null,
          publishState: "invalid_space_action" as const,
          status: "finalized" as const,
        };
      }
    );
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        taskResult: buildSuccessfulInternalOnlyTaskResult(),
      })
    );
    await Promise.all(waitUntilTasks.splice(0));

    expect(appliedFinalizationCommands).toHaveLength(1);
    expect(
      recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
    ).toMatchObject({ status: "failed_terminal" });
    expect(
      JSON.parse(
        String(
          recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
            ?.terminal_outcome_json
        )
      )
    ).toMatchObject({
      kind: "failed_terminal",
      reasonCode: "agent_task.invalid_space_action",
    });
    expect(
      recordingD1.calls
        .filter((call) =>
          call.query.includes("INSERT INTO agent_task_terminal_outcomes")
        )
        .map((call) => call.params[2])
    ).toEqual(["failed"]);
    const [, authority] =
      findRuntimeCoordinatorExecutionTokenAuthorityEntry(storageRecords) ?? [];
    expect(authority).toMatchObject({
      terminalOutcome: {
        reasonCode: "agent_task.invalid_space_action",
        replySignalId: null,
        status: "failed_terminal",
      },
    });
    expect(spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
      spaceId: HEX_SPACE_ID,
      streamId: "local-agent:10.dispatch-1:9.attempt-1",
      terminal: {
        kind: "failed",
        noticeText:
          "The Agent finished, but did not produce a valid Space reply.",
        reasonCode: "daemon.result.invalid_space_action",
      },
    });
  });

  it("keeps a published failure notice failed across RuntimeCoordinator truth", async () => {
    const {
      hub,
      recordingD1,
      sentFrames,
      socket,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    try {
      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
          taskResult: buildFailedVisibleTaskResult(),
        })
      );
      await Promise.all(waitUntilTasks.splice(0));

      expect(
        recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
      ).toMatchObject({
        status: "failed_terminal",
      });
      expect(
        JSON.parse(
          String(
            recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
              ?.terminal_outcome_json
          )
        )
      ).toMatchObject({
        kind: "failed_terminal",
        reasonCode: "quota.exceeded",
      });
      expect(
        recordingD1.calls
          .filter((call) =>
            call.query.includes("INSERT INTO agent_task_terminal_outcomes")
          )
          .map((call) => call.params[2])
      ).toEqual(["failed"]);
      const [, authority] =
        findRuntimeCoordinatorExecutionTokenAuthorityEntry(storageRecords) ??
        [];
      expect(authority).toMatchObject({
        terminalOutcome: {
          reasonCode: "quota.exceeded",
          replySignalId: "signal-final-1",
          status: "failed_terminal",
        },
      });
      expect(consoleInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "core.openmeld.space.final_visible_outcome_observed",
          reasonCode: "quota.exceeded",
          status: "failed",
        })
      );
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it("refuses to mint a replay command from D1 accepted result facts", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      recordingD1,
      sentFrames,
      socket,
      state,
      storageRecords,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    seedAcceptedResultInbox(recordingD1.inboxRows, executionToken);

    await expect(
      (
        hub as unknown as {
          rpcReplayRuntimeCoordinatorFinalizationCommand: (
            input: Record<string, string>
          ) => Promise<unknown>;
        }
      ).rpcReplayRuntimeCoordinatorFinalizationCommand({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        executionTokenRunId: executionToken.runId,
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        spaceId: HEX_SPACE_ID,
      })
    ).resolves.toEqual({
      ok: false,
      reasonCode: "daemon.result.finalization_unavailable",
      status: "retry_later",
    });
    const commandId = buildRuntimeCoordinatorFinalizationCommandId({
      executionTokenRunId: executionToken.runId,
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
    });
    expect(appliedFinalizationCommands).toHaveLength(0);
    expect(
      [...storageRecords.values()].some(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          (value as { finalizationCommandId?: unknown })
            .finalizationCommandId === commandId
      )
    ).toBe(false);
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) =>
          call.params[2] === "runtime_coordinator_decision_recorded" &&
          call.params[4] === "runtime_coordinator.finalization_command_missing"
      )
    ).toBe(true);
  });

  it("returns the stored RuntimeCoordinator finalization outcome without publishing a second reply", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      sentFrames,
      socket,
      spaceStub,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );
    await Promise.all(waitUntilTasks.splice(0));

    expect(appliedFinalizationCommands).toHaveLength(1);
    expect(spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
      spaceId: HEX_SPACE_ID,
      streamId: "local-agent:10.dispatch-1:9.attempt-1",
      terminal: {
        kind: "final_message",
        publishedSignalId: "signal-final-1",
      },
    });
    const command = appliedFinalizationCommands[0];
    const commandId = buildRuntimeCoordinatorFinalizationCommandId({
      executionTokenRunId: executionToken.runId,
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
    });
    expect(command).toMatchObject({
      acceptedResult: {
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        executionTokenRunId: executionToken.runId,
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      },
      dispatchId: "dispatch-1",
      finalizationCommandId: commandId,
      modelVersion: RUNTIME_COORDINATOR_FINALIZATION_COMMAND_MODEL_VERSION,
      spaceId: HEX_SPACE_ID,
    });
    expect(
      [...storageRecords.values()].some(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          (value as { finalizationCommandId?: unknown })
            .finalizationCommandId === commandId
      )
    ).toBe(true);

    spaceStub.rpcCloseAgentStream.mockClear();
    await expect(
      (
        hub as unknown as {
          rpcReplayRuntimeCoordinatorFinalizationCommand: (
            input: Record<string, string>
          ) => Promise<unknown>;
        }
      ).rpcReplayRuntimeCoordinatorFinalizationCommand({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        executionTokenRunId: executionToken.runId,
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        spaceId: HEX_SPACE_ID,
      })
    ).resolves.toMatchObject({
      ok: true,
      outcome: {
        finalizationCommandId: commandId,
        ok: true,
        publishState: "reply_published",
      },
    });
    expect(spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
      spaceId: HEX_SPACE_ID,
      streamId: "local-agent:10.dispatch-1:9.attempt-1",
      terminal: {
        kind: "final_message",
        publishedSignalId: "signal-final-1",
      },
    });
    expect(appliedFinalizationCommands).toHaveLength(1);
    await expect(
      (
        hub as unknown as {
          rpcReplayRuntimeCoordinatorFinalizationCommand: (
            input: Record<string, string>
          ) => Promise<unknown>;
        }
      ).rpcReplayRuntimeCoordinatorFinalizationCommand({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        executionTokenRunId: "run-other",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        spaceId: HEX_SPACE_ID,
      })
    ).resolves.toEqual({
      ok: false,
      reasonCode: "daemon.result.finalization_unavailable",
      status: "retry_later",
    });
    await expect(
      (
        hub as unknown as {
          rpcReplayRuntimeCoordinatorFinalizationCommand: (
            input: Record<string, string>
          ) => Promise<unknown>;
        }
      ).rpcReplayRuntimeCoordinatorFinalizationCommand({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        executionTokenRunId: executionToken.runId,
        runtimeCoordinatorExecutionId: WRONG_RUNTIME_COORDINATOR_EXECUTION_ID,
        spaceId: HEX_SPACE_ID,
      })
    ).resolves.toEqual({
      ok: false,
      reasonCode: "daemon.result.finalization_unavailable",
      status: "retry_later",
    });
  });

  it("upgrades a legacy stored finalization outcome from the verified Space claim", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      sentFrames,
      socket,
      spaceStub,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );
    await Promise.all(waitUntilTasks.splice(0));

    const command = appliedFinalizationCommands[0];
    if (!command) {
      throw new Error("Expected a RuntimeCoordinator finalization command.");
    }
    const outcomeKey = buildRuntimeCoordinatorFinalizationOutcomeStorageKey(
      command.finalizationCommandId
    );
    const storedOutcome = storageRecords.get(outcomeKey) as Extract<
      RuntimeCoordinatorFinalizationOutcome,
      { ok: true }
    >;
    const { finalMessageKind: _legacyMissingKind, ...legacyOutcome } =
      storedOutcome;
    storageRecords.set(outcomeKey, legacyOutcome);
    (
      spaceStub.rpcReadRuntimeCoordinatorFinalizationClaimOutcome as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValue({
      outcome: {
        ...storedOutcome,
        status: "already_final" as const,
      },
      status: "finalization_visible" as const,
    });

    await expect(
      (
        hub as unknown as {
          rpcReplayRuntimeCoordinatorFinalizationCommand: (
            input: Record<string, string>
          ) => Promise<unknown>;
        }
      ).rpcReplayRuntimeCoordinatorFinalizationCommand({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        executionTokenRunId: executionToken.runId,
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        spaceId: HEX_SPACE_ID,
      })
    ).resolves.toMatchObject({
      ok: true,
      outcome: {
        finalMessageKind: "success_reply",
        publishedSignalId: "signal-final-1",
        publishState: "reply_published",
      },
    });
    expect(storageRecords.get(outcomeKey)).toEqual(
      expect.objectContaining({
        finalMessageKind: "success_reply",
        publishedSignalId: "signal-final-1",
        publishState: "reply_published",
      })
    );
    expect(
      spaceStub.rpcReadRuntimeCoordinatorFinalizationClaimOutcome
    ).toHaveBeenCalledTimes(1);
    expect(appliedFinalizationCommands).toHaveLength(1);
  });

  it("repairs stream closure separately after reply publication succeeds", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      sentFrames,
      socket,
      spaceStub,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    spaceStub.rpcCloseAgentStream.mockRejectedValue(
      new Error("stream close unavailable")
    );

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );
    await Promise.all(waitUntilTasks.splice(0));

    const commandId = buildRuntimeCoordinatorFinalizationCommandId({
      executionTokenRunId: executionToken.runId,
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
    });
    expect(appliedFinalizationCommands).toHaveLength(1);
    expect(
      storageRecords.get(
        buildRuntimeCoordinatorFinalizationOutcomeStorageKey(commandId)
      )
    ).toEqual(
      expect.objectContaining({
        ok: true,
        publishedSignalId: "signal-final-1",
        publishState: "reply_published",
      })
    );
    expect(
      storageRecords.get(
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
      )
    ).toEqual([]);
    expect(
      [...storageRecords.entries()]
        .filter(([key]) =>
          key.startsWith(
            "runtime-coordinator:local-agent-stream-closure-retry:entry:"
          )
        )
        .map(([, value]) => value)
    ).toEqual([
      expect.objectContaining({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        spaceId: HEX_SPACE_ID,
        streamId: "local-agent:10.dispatch-1:9.attempt-1",
        terminal: {
          kind: "final_message",
          publishedSignalId: "signal-final-1",
        },
      }),
    ]);
    expect(
      [...storageRecords.keys()].filter((key) =>
        key.startsWith(
          "runtime-coordinator:local-agent-stream-closure-retry:due:"
        )
      )
    ).toHaveLength(1);
  });

  it("acks the daemon after command persistence when Space publication fails", async () => {
    const {
      hub,
      recordingD1,
      sentFrames,
      socket,
      spaceStub,
      state,
      waitUntilTasks,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
      (command: RuntimeCoordinatorFinalizationCommand) => ({
        finalizationCommandId: command.finalizationCommandId,
        ok: false as const,
        publicationErrorCode: "space.reply_write_failed",
        publishedSignalId: null,
        publishState: "reply_publication_failed" as const,
        status: "retry_later" as const,
      })
    );
    recordingD1.calls.length = 0;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: true,
          status: "accepted",
        }),
      })
    );
    await Promise.all(waitUntilTasks.splice(0));
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "reply_publication_failed"
      )
    ).toBe(true);
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "reply_published"
      )
    ).toBe(false);
  });

  it("records success reply and failure notice apply failures as retry-scheduled publication states, not visible closure", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const success = createHarness();
      const executionToken = await issueDeliveryToken({
        hub: success.hub,
        sentFrames: success.sentFrames,
        socket: success.socket,
        state: success.state,
      });
      success.spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => {
          success.appliedFinalizationCommands.push(command);
          return {
            finalizationCommandId: command.finalizationCommandId,
            ok: false as const,
            publicationErrorCode: "space.reply_write_failed",
            publishedSignalId: null,
            publishState: "reply_publication_failed" as const,
            status: "retry_later" as const,
          };
        }
      );
      success.recordingD1.calls.length = 0;
      success.sentFrames.length = 0;
      success.storageSetAlarm.mockClear();
      success.waitUntilTasks.length = 0;

      await (
        success.hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        success.socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
      await Promise.all(success.waitUntilTasks);

      expect(success.appliedFinalizationCommands).toHaveLength(1);
      expect(success.spaceStub.rpcCloseAgentStream).not.toHaveBeenCalled();
      expect(success.storageSetAlarm).toHaveBeenCalledWith(1_700_000_005_000);
      expect(
        success.storageRecords.get(
          "runtime-coordinator:finalization-retry:index"
        )
      ).toEqual([
        expect.objectContaining({
          dispatchId: "dispatch-1",
          nextReplayAtMs: 1_700_000_005_000,
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        }),
      ]);
      expect(
        getRuntimeCoordinatorEventCalls(success.recordingD1.calls).some(
          (call) => call.params[2] === "reply_publication_failed"
        )
      ).toBe(true);
      expect(
        getRuntimeCoordinatorEventCalls(success.recordingD1.calls).some(
          (call) => call.params[2] === "reply_published"
        )
      ).toBe(false);

      const failure = createHarness();
      failure.spaceStub.rpcApplyRuntimeCoordinatorFailurePublicationCommand.mockImplementation(
        (command: RuntimeCoordinatorFailurePublicationCommand) => {
          failure.appliedFailurePublicationCommands.push(command);
          return {
            failurePublicationCommandId: command.failurePublicationCommandId,
            finalMessageKind: null,
            ok: false as const,
            publicationErrorCode:
              "runtime_coordinator.failure_publication_unavailable",
            publishedSignalId: null,
            status: "failure_publication_failed" as const,
          };
        }
      );

      await fetchRuntimeTransportJson(
        failure.hub,
        "/runtime-coordinator/head/accept",
        buildRuntimeCoordinatorHeadAcceptRequest()
      );
      failure.storageSetAlarm.mockClear();
      failure.waitUntilTasks.length = 0;
      await fetchRuntimeTransportJson(
        failure.hub,
        "/runtime-coordinator/head/no-execution",
        buildRuntimeCoordinatorHeadNoExecutionRequest()
      );
      await Promise.all(failure.waitUntilTasks);

      expect(failure.appliedFailurePublicationCommands).toHaveLength(1);
      expect(failure.storageSetAlarm).toHaveBeenCalledWith(1_700_000_005_000);
      expect(
        findRuntimeCoordinatorHeadLifecycleRecord(failure.storageRecords)
      ).toMatchObject({
        publicationOutcome: {
          publishedSignalId: null,
          status: "failure_publication_failed",
        },
        publicationRetry: {
          nextRetryAtMs: 1_700_000_005_000,
          status: "retry_scheduled",
        },
      });
      expect(
        findRuntimeCoordinatorHeadLifecycleRecord(failure.storageRecords)
      ).not.toMatchObject({
        publicationOutcome: {
          status: "failure_published",
        },
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("replays a failed Space publication from RuntimeCoordinator alarm without trusting D1 publish_state", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        appliedFinalizationCommands,
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceStub,
        state,
        storageSetAlarm,
        storageRecords,
        waitUntilTasks,
      } = createHarness();
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      let applyCount = 0;
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => {
          appliedFinalizationCommands.push(command);
          applyCount += 1;
          if (applyCount === 1) {
            return {
              finalizationCommandId: command.finalizationCommandId,
              ok: false as const,
              publicationErrorCode: "space.reply_write_failed",
              publishedSignalId: null,
              publishState: "reply_publication_failed" as const,
              status: "retry_later" as const,
            };
          }
          return {
            finalMessageKind: "success_reply" as const,
            finalizationCommandId: command.finalizationCommandId,
            ok: true as const,
            publicationErrorCode: null,
            publishedSignalId: "signal-final-2",
            publishState: "reply_published" as const,
            status: "finalized" as const,
          };
        }
      );
      storageSetAlarm.mockClear();
      waitUntilTasks.length = 0;

      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );

      expect(sentFrames).toContainEqual(
        expect.objectContaining({
          code: "daemon.dispatch.accepted",
          payload: expect.objectContaining({
            ok: true,
            status: "accepted",
          }),
        })
      );
      expect(appliedFinalizationCommands).toHaveLength(1);
      expect(
        recordingD1.inboxRows.get("dispatch-1::attempt-1")?.publish_state
      ).toBe("reply_publication_failed");
      expect(waitUntilTasks.length).toBeGreaterThan(0);
      await Promise.all(waitUntilTasks);
      expect(storageSetAlarm).toHaveBeenCalledWith(1_700_000_005_000);

      recordingD1.inboxRows.delete("dispatch-1::attempt-1");
      recordingD1.calls.length = 0;
      sentFrames.length = 0;
      nowSpy.mockReturnValue(1_700_000_006_000);

      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(appliedFinalizationCommands).toHaveLength(2);
      expect(appliedFinalizationCommands[1]).toMatchObject({
        dispatchId: "dispatch-1",
        executionTokenRunId: executionToken.runId,
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      });
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) => call.params[2] === "reply_published"
        )
      ).toBe(true);
      const authority = [...storageRecords.values()].find(
        (value): value is RuntimeCoordinatorExecutionTokenAuthorityRecord =>
          value !== null && typeof value === "object" && "runsById" in value
      );
      expect(authority?.terminalOutcome).toMatchObject({
        reasonCode: "space.reply_published",
        replySignalId: "signal-final-2",
        status: "reply_published",
      });

      recordingD1.calls.length = 0;
      sentFrames.length = 0;
      nowSpy.mockReturnValue(1_700_000_012_000);

      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(appliedFinalizationCommands).toHaveLength(2);
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) => call.params[2] === "reply_published"
        )
      ).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("classifies an existing success reply finalization command as authoritative publication command evidence", async () => {
    const { hub, sentFrames, socket, spaceStub, state, waitUntilTasks } =
      createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
      (command: RuntimeCoordinatorFinalizationCommand) => ({
        finalizationCommandId: command.finalizationCommandId,
        ok: false as const,
        publicationErrorCode: "space.reply_write_failed",
        publishedSignalId: null,
        publishState: "reply_publication_failed" as const,
        status: "retry_later" as const,
      })
    );

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );
    await Promise.all(waitUntilTasks);

    const commandId = buildRuntimeCoordinatorFinalizationCommandId({
      executionTokenRunId: executionToken.runId,
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
    });

    await expect(
      classifyPublicationClosureDiagnostics(hub, {
        dispatchId: "dispatch-1",
        executionTokenRunId: executionToken.runId,
        finalizationCommandId: commandId,
        publicationKind: "success_reply",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        spaceId: HEX_SPACE_ID,
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toMatchObject({
      finalizationCommandId: commandId,
      publicationKind: "success_reply",
      reasonCode: "runtime_coordinator.publication_redrive_retryable",
      status: "retryable",
    });
  });

  it("classifies a missing success reply finalization command as missing authoritative publication facts", async () => {
    await expect(
      classifyPublicationClosureDiagnostics(createHarness().hub, {
        dispatchId: "dispatch-1",
        finalizationCommandId: "rcfc:missing",
        publicationKind: "success_reply",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        spaceId: HEX_SPACE_ID,
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toMatchObject({
      publicationKind: "success_reply",
      reasonCode: "runtime_coordinator.finalization_command_missing",
      status: "unreplayable",
    });
  });

  it("classifies a success reply selector target mismatch as missing authoritative publication facts", async () => {
    const { hub, sentFrames, socket, spaceStub, state, waitUntilTasks } =
      createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
      (command: RuntimeCoordinatorFinalizationCommand) => ({
        finalizationCommandId: command.finalizationCommandId,
        ok: false as const,
        publicationErrorCode: "space.reply_write_failed",
        publishedSignalId: null,
        publishState: "reply_publication_failed" as const,
        status: "retry_later" as const,
      })
    );
    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );
    await Promise.all(waitUntilTasks);

    await expect(
      classifyPublicationClosureDiagnostics(hub, {
        dispatchId: "dispatch-1",
        executionTokenRunId: executionToken.runId,
        publicationKind: "success_reply",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        spaceId: HEX_SPACE_ID,
        targetProfileId: "agt-other",
      })
    ).resolves.toMatchObject({
      publicationKind: "success_reply",
      reasonCode: "runtime_coordinator.finalization_command_mismatch",
      status: "unreplayable",
    });
  });

  it("classifies an already published success reply outcome as already visible", async () => {
    const { hub, sentFrames, socket, state, waitUntilTasks } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );
    await Promise.all(waitUntilTasks);

    await expect(
      classifyPublicationClosureDiagnostics(hub, {
        dispatchId: "dispatch-1",
        executionTokenRunId: executionToken.runId,
        publicationKind: "success_reply",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        spaceId: HEX_SPACE_ID,
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toMatchObject({
      publicationKind: "success_reply",
      reasonCode: "runtime_coordinator.publication_already_visible",
      status: "already_visible",
    });
  });

  it("classifies a complete failed-head publication lifecycle as authoritative publication command evidence", async () => {
    const {
      appliedFailurePublicationCommands,
      hub,
      spaceStub,
      storageRecords,
    } = createHarness();
    spaceStub.rpcApplyRuntimeCoordinatorFailurePublicationCommand.mockImplementation(
      (
        command: RuntimeCoordinatorFailurePublicationCommand
      ): RuntimeCoordinatorFailurePublicationOutcome => {
        appliedFailurePublicationCommands.push(command);
        return {
          failurePublicationCommandId: command.failurePublicationCommandId,
          finalMessageKind: null,
          ok: false as const,
          publicationErrorCode: "space.failure_notice_write_failed",
          publishedSignalId: null,
          status: "failure_publication_failed" as const,
        };
      }
    );
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest()
    );
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/no-execution",
      buildRuntimeCoordinatorHeadNoExecutionRequest()
    );

    const headRecord =
      findRuntimeCoordinatorHeadLifecycleRecord(storageRecords);
    const targetWakeLifecycleId = headRecord?.targetWakeLifecycleId;
    if (!targetWakeLifecycleId) {
      throw new Error("Expected target Wake lifecycle id.");
    }
    expect(appliedFailurePublicationCommands).toHaveLength(1);
    const failurePublicationCommand =
      appliedFailurePublicationCommands[0] ?? null;
    if (!failurePublicationCommand) {
      throw new Error("Expected failure publication command.");
    }

    await expect(
      classifyPublicationClosureDiagnostics(hub, {
        dispatchId: "dispatch-1",
        failurePublicationCommandId:
          failurePublicationCommand.failurePublicationCommandId,
        publicationKind: "failure_notice",
        spaceId: HEX_SPACE_ID,
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        targetWakeLifecycleId,
      })
    ).resolves.toMatchObject({
      failurePublicationCommandId:
        failurePublicationCommand.failurePublicationCommandId,
      publicationKind: "failure_notice",
      reasonCode: "runtime_coordinator.publication_redrive_retryable",
      status: "retryable",
    });
  });

  it("classifies an incomplete failed-head lifecycle as missing authoritative publication facts", async () => {
    const { hub, storageRecords } = createHarness();
    await fetchRuntimeTransportJson(
      hub,
      "/runtime-coordinator/head/accept",
      buildRuntimeCoordinatorHeadAcceptRequest()
    );
    const headRecord =
      findRuntimeCoordinatorHeadLifecycleRecord(storageRecords);
    const targetWakeLifecycleId = headRecord?.targetWakeLifecycleId;
    if (!targetWakeLifecycleId) {
      throw new Error("Expected target Wake lifecycle id.");
    }

    await expect(
      classifyPublicationClosureDiagnostics(hub, {
        dispatchId: "dispatch-1",
        publicationKind: "failure_notice",
        spaceId: HEX_SPACE_ID,
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        targetWakeLifecycleId,
      })
    ).resolves.toMatchObject({
      publicationKind: "failure_notice",
      reasonCode:
        "runtime_coordinator.failure_publication_lifecycle_incomplete",
      status: "unreplayable",
    });
  });

  it("classifies stopped notice publication as unreplayable until the execution is cancelled", async () => {
    const { hub, sentFrames, socket, state } = createHarness({
      agentControllerReportRow: buildRuntimeAgentControllerReportRow(),
    });
    await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });

    await expect(
      classifyPublicationClosureDiagnostics(hub, {
        dispatchId: "dispatch-1",
        publicationKind: "stopped_notice",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        spaceId: HEX_SPACE_ID,
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toMatchObject({
      publicationKind: "stopped_notice",
      reasonCode:
        "runtime_coordinator.stopped_publication_execution_not_cancelled",
      status: "unreplayable",
    });
  });

  it("classifies accepted result inbox evidence alone as historical evidence only", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    seedAcceptedResultInbox(recordingD1.inboxRows, executionToken);

    await expect(
      classifyPublicationClosureDiagnostics(hub, {
        dispatchId: "dispatch-1",
        evidenceSource: "result_inbox",
        publicationKind: "success_reply",
        spaceId: HEX_SPACE_ID,
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      })
    ).resolves.toMatchObject({
      publicationKind: "success_reply",
      reasonCode:
        "runtime_coordinator.publication_redrive_historical_compensation_candidate",
      status: "historical_compensation_candidate",
    });
  });

  it("records an unresolved publication blocker when finalization retry loses the durable command", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceStub,
        state,
        storageRecords,
        waitUntilTasks,
      } = createHarness();
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => ({
          finalizationCommandId: command.finalizationCommandId,
          ok: false as const,
          publicationErrorCode: "space.reply_write_failed",
          publishedSignalId: null,
          publishState: "reply_publication_failed" as const,
          status: "retry_later" as const,
        })
      );

      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
      await Promise.all(waitUntilTasks);

      const commandId = buildRuntimeCoordinatorFinalizationCommandId({
        executionTokenRunId: executionToken.runId,
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      });
      for (const key of [...storageRecords.keys()]) {
        if (
          key.includes(`runtime-coordinator:finalization-command:${commandId}`)
        ) {
          storageRecords.delete(key);
        }
      }
      recordingD1.calls.length = 0;
      nowSpy.mockReturnValue(1_700_000_006_000);

      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(
        findRuntimeCoordinatorPublicationBlockerRecord(storageRecords)
      ).toMatchObject({
        blockerKind: "unreplayable",
        dispatchId: "dispatch-1",
        publicationKind: "success_reply",
        reasonCode: "runtime_coordinator.finalization_command_missing",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        status: "unresolved_publication_failure",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      });
      const publicationBlockerEventPayload = JSON.parse(
        String(
          getRuntimeCoordinatorEventCalls(recordingD1.calls).find(
            (call) =>
              call.params[2] === "runtime_coordinator_decision_recorded" &&
              call.params[4] === "runtime_coordinator.publication_unresolved"
          )?.params[7] ?? "{}"
        )
      ) as Record<string, unknown>;
      expect(publicationBlockerEventPayload).toMatchObject({
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      });
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) =>
            call.params[2] === "runtime_coordinator_decision_recorded" &&
            call.params[4] === "runtime_coordinator.publication_unresolved"
        )
      ).toBe(true);
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) => call.params[2] === "reply_published"
        )
      ).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("parks exhausted success reply publication retry and recovers from the long-period alarm", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        appliedFinalizationCommands,
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceStub,
        state,
        storageSetAlarm,
        storageRecords,
        waitUntilTasks,
      } = createHarness();
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      let applyCount = 0;
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => {
          appliedFinalizationCommands.push(command);
          applyCount += 1;
          if (applyCount < 3) {
            return {
              finalizationCommandId: command.finalizationCommandId,
              ok: false as const,
              publicationErrorCode: "space.reply_write_failed",
              publishedSignalId: null,
              publishState: "reply_publication_failed" as const,
              status: "retry_later" as const,
            };
          }
          return {
            finalMessageKind: "success_reply" as const,
            finalizationCommandId: command.finalizationCommandId,
            ok: true as const,
            publicationErrorCode: null,
            publishedSignalId: "signal-final-park-recovery",
            publishState: "reply_published" as const,
            status: "finalized" as const,
          };
        }
      );

      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
      await Promise.all(waitUntilTasks);
      expect(appliedFinalizationCommands).toHaveLength(1);
      storageSetAlarm.mockClear();
      recordingD1.calls.length = 0;
      nowSpy.mockReturnValue(1_700_000_601_000);

      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(
        findRuntimeCoordinatorPublicationBlockerRecord(storageRecords)
      ).toMatchObject({
        blockerKind: "publication_unavailable",
        dispatchId: "dispatch-1",
        publicationKind: "success_reply",
        reasonCode: "runtime_coordinator.publication_retry_exhausted",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        status: "unresolved_publication_failure",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      });
      const publicationBlockerEventPayload = JSON.parse(
        String(
          getRuntimeCoordinatorEventCalls(recordingD1.calls).find(
            (call) =>
              call.params[2] === "runtime_coordinator_decision_recorded" &&
              call.params[4] === "runtime_coordinator.publication_unresolved"
          )?.params[7] ?? "{}"
        )
      ) as Record<string, unknown>;
      expect(publicationBlockerEventPayload).toMatchObject({
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      });
      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([
        expect.objectContaining({
          attemptCount: 3,
          dispatchId: "dispatch-1",
          nextReplayAtMs:
            1_700_000_601_000 +
            RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
          targetProfileId: TARGET_AGENT_PROFILE_ID,
        }),
      ]);
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) =>
            call.params[2] === "runtime_coordinator_decision_recorded" &&
            call.params[4] === "runtime_coordinator.publication_unresolved"
        )
      ).toBe(true);
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) => call.params[2] === "reply_published"
        )
      ).toBe(false);

      recordingD1.calls.length = 0;
      storageSetAlarm.mockClear();
      nowSpy.mockReturnValue(
        1_700_000_601_000 + RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS
      );

      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(appliedFinalizationCommands).toHaveLength(3);
      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([]);
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) => call.params[2] === "reply_published"
        )
      ).toBe(true);
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) =>
            call.params[2] === "runtime_coordinator_decision_recorded" &&
            call.params[4] === "runtime_coordinator.publication_unresolved"
        )
      ).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("fails terminal after the finalization retry park window and leaves active progress", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        appliedFinalizationCommands,
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceStub,
        state,
        storageRecords,
        waitUntilTasks,
      } = createHarness();
      const wakeEvidenceD1 = createRecordingD1();
      (
        hub as unknown as {
          env: CoreBindings;
        }
      ).env.OPENMELD_WAKE_EVIDENCE_DB = wakeEvidenceD1.db;
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => {
          appliedFinalizationCommands.push(command);
          return {
            finalizationCommandId: command.finalizationCommandId,
            ok: false as const,
            publicationErrorCode: "space.reply_write_failed",
            publishedSignalId: null,
            publishState: "reply_publication_failed" as const,
            status: "retry_later" as const,
          };
        }
      );

      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
      await Promise.all(waitUntilTasks);

      recordingD1.calls.length = 0;
      wakeEvidenceD1.calls.length = 0;
      nowSpy.mockReturnValue(1_700_000_301_000);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([
        expect.objectContaining({
          dispatchId: "dispatch-1",
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        }),
      ]);
      expect(
        wakeEvidenceD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
          ?.status
      ).not.toBe("failed_terminal");

      recordingD1.calls.length = 0;
      wakeEvidenceD1.calls.length = 0;
      nowSpy.mockReturnValue(
        1_700_000_000_000 +
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS +
          1
      );
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(appliedFinalizationCommands).toHaveLength(3);
      expect(
        spaceStub.rpcApplyRuntimeCoordinatorPublicationExhaustionCommand
      ).toHaveBeenCalledOnce();
      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([]);
      expect(
        findRuntimeCoordinatorPublicationBlockerRecord(storageRecords)
      ).toMatchObject({
        blockerKind: "publication_unavailable",
        dispatchId: "dispatch-1",
        publicationKind: "success_reply",
        reasonCode: "runtime_coordinator.publication_retry_exhausted",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        status: "unresolved_publication_failure",
        targetProfileId: TARGET_AGENT_PROFILE_ID,
      });
      const projection = wakeEvidenceD1.projectionRows.get(
        RUNTIME_COORDINATOR_EXECUTION_ID
      );
      expect(projection).toMatchObject({
        status: "failed_terminal",
      });
      expect(JSON.parse(String(projection?.terminal_outcome_json))).toEqual({
        kind: "failed_terminal",
        observedAtMs:
          1_700_000_000_000 +
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS +
          1,
        reasonCode: "runtime_coordinator.publication_retry_exhausted",
      });
      const agentTaskOutcomeWrite = recordingD1.calls.find((call) =>
        call.query.includes("INSERT INTO agent_task_terminal_outcomes")
      );
      expect(agentTaskOutcomeWrite?.params[2]).toBe("publication_failed");
      expect(JSON.parse(String(agentTaskOutcomeWrite?.params[4]))).toEqual({
        errorCode: "runtime_coordinator.publication_retry_exhausted",
        eventId: expect.any(String),
        occurredAtMs: 1_700_000_000_000,
        publishedSignalId: "signal-publication-failed-1",
        status: "publication_failed",
      });
      expect(spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
        spaceId: HEX_SPACE_ID,
        streamId: "local-agent:10.dispatch-1:9.attempt-1",
        terminal: {
          kind: "failed",
          noticeText: "The Agent finished, but its reply could not be posted.",
          reasonCode: "runtime_coordinator.publication_retry_exhausted",
        },
      });
      expect(
        getRuntimeCoordinatorEventCalls(wakeEvidenceD1.calls).some(
          (call) =>
            call.params[2] === "runtime_coordinator_decision_recorded" &&
            call.params[4] ===
              "runtime_coordinator.publication_retry_exhausted" &&
            call.params[3] === "failed_terminal"
        )
      ).toBe(true);
      await expect(
        listActiveRuntimeCoordinatorExecutionWakeProgressSelectorsBySpace({
          db: wakeEvidenceD1.db,
          spaceId: HEX_SPACE_ID,
        })
      ).resolves.toEqual([]);

      const terminalOutcomeWriteCount = recordingD1.calls.filter((call) =>
        call.query.includes("INSERT INTO agent_task_terminal_outcomes")
      ).length;
      nowSpy.mockReturnValue(
        1_700_000_000_000 +
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS +
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS +
          1
      );
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();
      expect(
        recordingD1.calls.filter((call) =>
          call.query.includes("INSERT INTO agent_task_terminal_outcomes")
        )
      ).toHaveLength(terminalOutcomeWriteCount);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it.each([
    {
      failureBoundary: "RuntimeCoordinator authority",
      harnessInput: { exhaustionAuthorityWriteFailures: 1 },
    },
    {
      failureBoundary: "Wake-evidence projection",
      harnessInput: { terminalProjectionWriteFailures: 1 },
    },
  ])("recovers publication exhaustion after a $failureBoundary write failure without releasing Agent Task work early", async ({
    harnessInput,
  }) => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceStub,
        state,
        storageRecords,
        waitUntilTasks,
      } = createHarness(harnessInput);
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => ({
          finalizationCommandId: command.finalizationCommandId,
          ok: false as const,
          publicationErrorCode: "space.reply_write_failed",
          publishedSignalId: null,
          publishState: "reply_publication_failed" as const,
          status: "retry_later" as const,
        })
      );

      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
      await Promise.all(waitUntilTasks);

      nowSpy.mockReturnValue(1_700_000_301_000);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      const exhaustedAtMs =
        1_700_000_000_000 +
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS +
        1;
      nowSpy.mockReturnValue(exhaustedAtMs);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(recordingD1.taskTerminalOutcomeRows.size).toBe(0);
      expect(spaceStub.rpcCloseAgentStream).not.toHaveBeenCalled();
      const parkedRetries = storageRecords.get(
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
      ) as Array<{ nextReplayAtMs: number }>;
      expect(parkedRetries).toEqual([
        expect.objectContaining({
          nextReplayAtMs:
            exhaustedAtMs +
            RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
        }),
      ]);

      nowSpy.mockReturnValue(parkedRetries[0]?.nextReplayAtMs ?? 0);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([]);
      expect(
        findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords)
          ?.terminalOutcome
      ).toMatchObject({
        reasonCode: "runtime_coordinator.publication_retry_exhausted",
        status: "failed_terminal",
      });
      expect(
        recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
      ).toMatchObject({ status: "failed_terminal" });
      const task = {
        kind: "space_wake" as const,
        sourceClientMessageId: "client-message-1",
        spaceId: HEX_SPACE_ID,
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        v: 1 as const,
      };
      const taskOutcomeRow = recordingD1.taskTerminalOutcomeRows.get(
        buildAgentTaskKey(task)
      );
      expect(taskOutcomeRow).toBeDefined();
      expect(JSON.parse(String(taskOutcomeRow?.outcome_json))).toMatchObject({
        errorCode: "runtime_coordinator.publication_retry_exhausted",
        occurredAtMs: 1_700_000_000_000,
        publishedSignalId: "signal-publication-failed-1",
        status: "publication_failed",
      });
      expect(spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
        spaceId: HEX_SPACE_ID,
        streamId: "local-agent:10.dispatch-1:9.attempt-1",
        terminal: expect.objectContaining({
          kind: "failed",
          reasonCode: "runtime_coordinator.publication_retry_exhausted",
        }),
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("repairs a legacy publication-exhausted authority when Space already owns a visible reply", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        appliedFinalizationCommands,
        hub,
        sentFrames,
        socket,
        spaceStub,
        state,
        storageRecords,
        waitUntilTasks,
      } = createHarness({
        terminalProjectionWriteFailures: 1,
      });
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => {
          appliedFinalizationCommands.push(command);
          return {
            finalizationCommandId: command.finalizationCommandId,
            ok: false as const,
            publicationErrorCode: "space.reply_write_failed",
            publishedSignalId: null,
            publishState: "reply_publication_failed" as const,
            status: "retry_later" as const,
          };
        }
      );

      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
      await Promise.all(waitUntilTasks);

      nowSpy.mockReturnValue(1_700_000_301_000);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      const exhaustedAtMs =
        1_700_000_000_000 +
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS +
        1;
      nowSpy.mockReturnValue(exhaustedAtMs);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      const retryAfterProjectionFailure = storageRecords.get(
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
      );
      expect(retryAfterProjectionFailure).toEqual([
        expect.objectContaining({
          nextReplayAtMs:
            exhaustedAtMs +
            RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
        }),
      ]);
      expect(appliedFinalizationCommands).toHaveLength(3);
      expect(
        findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords)
          ?.terminalOutcome
      ).toMatchObject({
        reasonCode: "runtime_coordinator.publication_retry_exhausted",
        status: "failed_terminal",
      });
      (
        spaceStub.rpcApplyRuntimeCoordinatorPublicationExhaustionCommand as ReturnType<
          typeof vi.fn
        >
      ).mockImplementation((command: RuntimeCoordinatorFinalizationCommand) =>
        Promise.resolve({
          outcome: {
            finalMessageKind: "success_reply" as const,
            finalizationCommandId: command.finalizationCommandId,
            ok: true as const,
            publicationErrorCode: null,
            publishedSignalId: "signal-after-terminal-decision",
            publishState: "reply_published" as const,
            status: "already_final" as const,
          },
          status: "finalization_visible" as const,
        })
      );
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => {
          appliedFinalizationCommands.push(command);
          return {
            finalMessageKind: "success_reply" as const,
            finalizationCommandId: command.finalizationCommandId,
            ok: true as const,
            publicationErrorCode: null,
            publishedSignalId: "signal-after-terminal-decision",
            publishState: "reply_published" as const,
            status: "already_final" as const,
          };
        }
      );

      const taskProjectionAttemptAtMs =
        exhaustedAtMs + RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS;
      nowSpy.mockReturnValue(taskProjectionAttemptAtMs);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(appliedFinalizationCommands).toHaveLength(4);
      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([]);
      expect(
        findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords)
          ?.terminalOutcome
      ).toEqual({
        finalizedAtMs: taskProjectionAttemptAtMs,
        reasonCode: "space.reply_published",
        replySignalId: "signal-after-terminal-decision",
        status: "reply_published",
      });

      expect(spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
        spaceId: HEX_SPACE_ID,
        streamId: "local-agent:10.dispatch-1:9.attempt-1",
        terminal: {
          kind: "final_message",
          publishedSignalId: "signal-after-terminal-decision",
        },
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("keeps exhaustion retry parked when Agent Task already owns a different terminal outcome", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Intentionally suppress the expected structured conflict warning.
    });
    try {
      const {
        appliedFinalizationCommands,
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceStub,
        state,
        storageRecords,
        waitUntilTasks,
      } = createHarness();
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => {
          appliedFinalizationCommands.push(command);
          return {
            finalizationCommandId: command.finalizationCommandId,
            ok: false as const,
            publicationErrorCode: "space.reply_write_failed",
            publishedSignalId: null,
            publishState: "reply_publication_failed" as const,
            status: "retry_later" as const,
          };
        }
      );

      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
      await Promise.all(waitUntilTasks);

      nowSpy.mockReturnValue(1_700_000_301_000);
      await (hub as unknown as { alarm: () => Promise<void> }).alarm();

      const task = {
        kind: "space_wake" as const,
        sourceClientMessageId: "client-message-1",
        spaceId: HEX_SPACE_ID,
        targetProfileId: TARGET_AGENT_PROFILE_ID,
        v: 1 as const,
      };
      const existingOutcome = {
        errorCode: null,
        eventId: "historical-success-event",
        occurredAtMs: 1_700_000_200_000,
        publishedSignalId: "signal-historical-success",
        status: "succeeded" as const,
      };
      recordingD1.taskTerminalOutcomeRows.set(buildAgentTaskKey(task), {
        event_id: existingOutcome.eventId,
        observed_at_ms: existingOutcome.occurredAtMs,
        occurred_at_ms: existingOutcome.occurredAtMs,
        outcome_json: JSON.stringify(existingOutcome),
        status: existingOutcome.status,
        task_handle_json: JSON.stringify(task),
        task_key: buildAgentTaskKey(task),
      });

      const exhaustedAtMs =
        1_700_000_000_000 +
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS +
        1;
      nowSpy.mockReturnValue(exhaustedAtMs);
      await (hub as unknown as { alarm: () => Promise<void> }).alarm();

      expect(
        findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords)
          ?.terminalOutcome
      ).toBeNull();
      expect(
        recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)?.status
      ).not.toBe("failed_terminal");
      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([
        expect.objectContaining({
          nextReplayAtMs:
            exhaustedAtMs +
            RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
        }),
      ]);
      expect(
        recordingD1.taskTerminalOutcomeRows.get(buildAgentTaskKey(task))
      ).toMatchObject({
        event_id: existingOutcome.eventId,
        status: existingOutcome.status,
      });
      expect(warnSpy).toHaveBeenCalledWith(
        "[core.runtime_transport.runtime_coordinator_publication_exhaustion_task_outcome_conflict]",
        expect.objectContaining({
          actualStatus: "succeeded",
          expectedStatus: "publication_failed",
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
    } finally {
      warnSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it.each([
    [
      "a Wake Stop cancellation",
      "cancelled",
      "runtime_coordinator.wake_stop_requested",
    ],
    ["another terminal failure", "failed_terminal", "agent_execution.failed"],
  ] as const)("does not replace %s with a late visible reply", async (_label, status, reasonCode) => {
    const {
      appliedFinalizationCommands,
      hub,
      sentFrames,
      socket,
      spaceStub,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
      (command: RuntimeCoordinatorFinalizationCommand) => {
        appliedFinalizationCommands.push(command);
        return {
          finalizationCommandId: command.finalizationCommandId,
          ok: false as const,
          publicationErrorCode: "space.reply_write_failed",
          publishedSignalId: null,
          publishState: "reply_publication_failed" as const,
          status: "retry_later" as const,
        };
      }
    );

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );
    await Promise.all(waitUntilTasks);

    const authorityEntry =
      findRuntimeCoordinatorExecutionTokenAuthorityEntry(storageRecords);
    const command = appliedFinalizationCommands[0];
    if (!(authorityEntry && command)) {
      throw new Error("Expected RuntimeCoordinator authority and command.");
    }
    const [authorityKey, authority] = authorityEntry;
    const terminalOutcome = {
      finalizedAtMs: 1_700_000_100_000,
      reasonCode,
      replySignalId: null,
      status,
    };
    storageRecords.set(authorityKey, {
      ...authority,
      terminalOutcome,
    });

    await expect(
      (
        hub as unknown as {
          setRuntimeCoordinatorFinalizationTerminalOutcome: (input: {
            command: RuntimeCoordinatorFinalizationCommand;
            executionSemantic: {
              reasonCode: null;
              status: "succeeded";
            };
            nowMs: number;
            publishedSignalId: string | null;
          }) => Promise<boolean>;
        }
      ).setRuntimeCoordinatorFinalizationTerminalOutcome({
        command,
        executionSemantic: { reasonCode: null, status: "succeeded" },
        nowMs: 1_700_000_200_000,
        publishedSignalId: "signal-late-visible-reply",
      })
    ).resolves.toBe(false);
    expect(
      findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords)
        ?.terminalOutcome
    ).toEqual(terminalOutcome);
  });

  it("keeps a legacy retry when its verified success conflicts with Agent Task publication_failed", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Intentionally suppress the expected structured warning.
    });
    try {
      const {
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceStub,
        state,
        storageRecords,
        waitUntilTasks,
      } = createHarness();
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => ({
          finalizationCommandId: command.finalizationCommandId,
          ok: false as const,
          publicationErrorCode: "space.reply_write_failed",
          publishedSignalId: null,
          publishState: "reply_publication_failed" as const,
          status: "retry_later" as const,
        })
      );

      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
      await Promise.all(waitUntilTasks);

      nowSpy.mockReturnValue(1_700_000_301_000);
      await (hub as unknown as { alarm: () => Promise<void> }).alarm();
      const [retryBeforeExhaustion] = storageRecords.get(
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
      ) as Record<string, unknown>[];
      if (!retryBeforeExhaustion) {
        throw new Error("Expected a parked finalization retry.");
      }

      const exhaustedAtMs =
        1_700_000_000_000 +
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS +
        1;
      nowSpy.mockReturnValue(exhaustedAtMs);
      await (hub as unknown as { alarm: () => Promise<void> }).alarm();

      expect(
        findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords)
          ?.terminalOutcome
      ).toMatchObject({
        reasonCode: "runtime_coordinator.publication_retry_exhausted",
        status: "failed_terminal",
      });
      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([]);
      expect(
        recordingD1.calls.some(
          (call) =>
            call.query.includes("INSERT INTO agent_task_terminal_outcomes") &&
            call.params[2] === "publication_failed"
        )
      ).toBe(true);

      storageRecords.set(
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY,
        [
          {
            ...retryBeforeExhaustion,
            nextReplayAtMs:
              exhaustedAtMs +
              RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
            updatedAtMs: exhaustedAtMs,
          },
        ]
      );
      storageRecords.set(
        buildRuntimeCoordinatorFinalizationOutcomeStorageKey(
          String(retryBeforeExhaustion.finalizationCommandId)
        ),
        {
          finalizationCommandId: retryBeforeExhaustion.finalizationCommandId,
          ok: true,
          publicationErrorCode: null,
          publishedSignalId: "signal-after-task-publication-failure",
          publishState: "reply_published",
          status: "already_final",
        }
      );
      spaceStub.rpcCloseAgentStream.mockClear();

      (
        spaceStub.rpcReadRuntimeCoordinatorFinalizationClaimOutcome as ReturnType<
          typeof vi.fn
        >
      ).mockImplementation((command: RuntimeCoordinatorFinalizationCommand) =>
        Promise.resolve({
          outcome: {
            finalMessageKind: "success_reply" as const,
            finalizationCommandId: command.finalizationCommandId,
            ok: true as const,
            publicationErrorCode: null,
            publishedSignalId: "signal-after-task-publication-failure",
            publishState: "reply_published" as const,
            status: "already_final" as const,
          },
          status: "finalization_visible" as const,
        })
      );

      const repairAtMs =
        exhaustedAtMs + RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS;
      nowSpy.mockReturnValue(repairAtMs);
      await (hub as unknown as { alarm: () => Promise<void> }).alarm();

      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([
        expect.objectContaining({
          nextReplayAtMs:
            repairAtMs + RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
        }),
      ]);
      expect(
        findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords)
          ?.terminalOutcome
      ).toMatchObject({
        reasonCode: "runtime_coordinator.publication_retry_exhausted",
        status: "failed_terminal",
      });
      expect(spaceStub.rpcCloseAgentStream).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        "[core.runtime_transport.runtime_coordinator_finalization_task_outcome_conflict]",
        expect.objectContaining({
          actualStatus: "publication_failed",
          expectedStatus: "succeeded",
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
    } finally {
      warnSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it.each([
    {
      expectedAppliedCountAfterFailure: 2,
      expectedAppliedCountAfterRecovery: 3,
      expectedStatus: "db_unavailable",
      keepWakeEvidenceDb: false,
      removeCoordinationDb: true,
      taskTerminalOutcomeReadFailures: 0,
    },
    {
      expectedAppliedCountAfterFailure: 3,
      expectedAppliedCountAfterRecovery: 4,
      expectedStatus: "task_outcome_unavailable",
      keepWakeEvidenceDb: true,
      removeCoordinationDb: true,
      taskTerminalOutcomeReadFailures: 0,
    },
    {
      expectedAppliedCountAfterFailure: 3,
      expectedAppliedCountAfterRecovery: 4,
      expectedStatus: "task_outcome_inspection_failed",
      keepWakeEvidenceDb: false,
      removeCoordinationDb: false,
      taskTerminalOutcomeReadFailures: 1,
    },
  ] as const)("keeps the finalization retry parked for $expectedStatus", async ({
    expectedAppliedCountAfterFailure,
    expectedAppliedCountAfterRecovery,
    expectedStatus,
    keepWakeEvidenceDb,
    removeCoordinationDb,
    taskTerminalOutcomeReadFailures,
  }) => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Intentionally suppress the expected structured recovery warning.
    });
    try {
      const {
        appliedFinalizationCommands,
        hub,
        sentFrames,
        socket,
        spaceStub,
        state,
        storageRecords,
        waitUntilTasks,
      } = createHarness({ taskTerminalOutcomeReadFailures });
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => {
          appliedFinalizationCommands.push(command);
          return {
            finalizationCommandId: command.finalizationCommandId,
            ok: false as const,
            publicationErrorCode: "space.reply_write_failed",
            publishedSignalId: null,
            publishState: "reply_publication_failed" as const,
            status: "retry_later" as const,
          };
        }
      );

      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
      await Promise.all(waitUntilTasks);

      nowSpy.mockReturnValue(1_700_000_301_000);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      const env = (
        hub as unknown as {
          env: Record<string, unknown>;
        }
      ).env;
      const coordinationDb = env.OPENMELD_DB;
      if (keepWakeEvidenceDb) {
        env.OPENMELD_WAKE_EVIDENCE_DB = coordinationDb;
      }
      if (removeCoordinationDb) {
        env.OPENMELD_DB = undefined;
      }
      const exhaustedAtMs =
        1_700_000_000_000 +
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS +
        1;
      nowSpy.mockReturnValue(exhaustedAtMs);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(appliedFinalizationCommands).toHaveLength(
        expectedAppliedCountAfterFailure
      );
      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([
        expect.objectContaining({
          nextReplayAtMs:
            exhaustedAtMs +
            RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
        }),
      ]);
      expect(warnSpy).toHaveBeenCalledWith(
        "[core.runtime_transport.runtime_coordinator_finalization_retry_terminal_recovery_pending]",
        expect.objectContaining({ terminalStatus: expectedStatus })
      );

      if (removeCoordinationDb) {
        env.OPENMELD_DB = coordinationDb;
      }
      nowSpy.mockReturnValue(
        exhaustedAtMs + RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS
      );
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(appliedFinalizationCommands).toHaveLength(
        expectedAppliedCountAfterRecovery
      );
      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([]);
    } finally {
      warnSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it("does not let a D1-only late publication decide park exhaustion", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceStub,
        state,
        storageRecords,
        waitUntilTasks,
      } = createHarness();
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => ({
          finalizationCommandId: command.finalizationCommandId,
          ok: false as const,
          publicationErrorCode: "space.reply_write_failed",
          publishedSignalId: null,
          publishState: "reply_publication_failed" as const,
          status: "retry_later" as const,
        })
      );

      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
      await Promise.all(waitUntilTasks);

      nowSpy.mockReturnValue(1_700_000_301_000);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      const projection = recordingD1.projectionRows.get(
        RUNTIME_COORDINATOR_EXECUTION_ID
      );
      if (!projection) {
        throw new Error("Expected RuntimeCoordinator projection.");
      }
      recordingD1.projectionRows.set(RUNTIME_COORDINATOR_EXECUTION_ID, {
        ...projection,
        status: "reply_published",
        terminal_outcome_json: JSON.stringify({
          kind: "reply_published",
          observedAtMs: 1_700_000_600_000,
          reasonCode: "space.reply_published",
        }),
      });
      recordingD1.calls.length = 0;
      const exhaustedAtMs =
        1_700_000_000_000 +
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS +
        1;
      nowSpy.mockReturnValue(exhaustedAtMs);

      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(
        recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
      ).toMatchObject({
        status: "reply_published",
      });
      expect(
        spaceStub.rpcApplyRuntimeCoordinatorPublicationExhaustionCommand
      ).toHaveBeenCalled();
      expect(
        spaceStub.rpcReadRuntimeCoordinatorFinalizationClaimOutcome
      ).not.toHaveBeenCalled();
      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([
        expect.objectContaining({
          nextReplayAtMs:
            exhaustedAtMs +
            RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
        }),
      ]);
      expect(
        findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords)
          ?.terminalOutcome
      ).toBeNull();
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) =>
            call.params[2] === "runtime_coordinator_decision_recorded" &&
            call.params[4] ===
              "runtime_coordinator.publication_retry_exhausted" &&
            call.params[3] === "failed_terminal"
        )
      ).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("keeps the retry when D1 races the exhaustion authority with another terminal projection", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceStub,
        state,
        storageRecords,
        waitUntilTasks,
      } = createHarness({
        exhaustionAuthorityProjectionRaceStatus: "reply_published",
      });
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => ({
          finalizationCommandId: command.finalizationCommandId,
          ok: false as const,
          publicationErrorCode: "space.reply_write_failed",
          publishedSignalId: null,
          publishState: "reply_publication_failed" as const,
          status: "retry_later" as const,
        })
      );

      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
      await Promise.all(waitUntilTasks);

      nowSpy.mockReturnValue(1_700_000_301_000);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      const exhaustedAtMs =
        1_700_000_000_000 +
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS +
        1;
      nowSpy.mockReturnValue(exhaustedAtMs);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(
        findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords)
          ?.terminalOutcome
      ).toMatchObject({
        reasonCode: "runtime_coordinator.publication_retry_exhausted",
        status: "failed_terminal",
      });
      expect(
        recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
      ).toMatchObject({ status: "reply_published" });
      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([
        expect.objectContaining({
          nextReplayAtMs:
            exhaustedAtMs +
            RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
        }),
      ]);
      expect(
        recordingD1.calls.some(
          (call) =>
            call.query.includes("INSERT INTO agent_task_terminal_outcomes") &&
            call.params[2] === "publication_failed"
        )
      ).toBe(false);
      expect(
        getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
          (call) =>
            call.params[2] === "runtime_coordinator_decision_recorded" &&
            call.params[4] === "runtime_coordinator.publication_retry_exhausted"
        )
      ).toBe(false);

      const repairAtMs =
        exhaustedAtMs + RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS;
      nowSpy.mockReturnValue(repairAtMs);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();
      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([
        expect.objectContaining({
          nextReplayAtMs:
            repairAtMs + RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
        }),
      ]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("reports a competing failed terminal projection as a conflict during park exhaustion", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Intentionally suppress the expected structured warning.
    });
    try {
      const {
        hub,
        sentFrames,
        socket,
        spaceStub,
        state,
        storageRecords,
        waitUntilTasks,
      } = createHarness({
        exhaustionAuthorityProjectionRaceStatus: "failed_terminal_other",
      });
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => ({
          finalizationCommandId: command.finalizationCommandId,
          ok: false as const,
          publicationErrorCode: "space.reply_write_failed",
          publishedSignalId: null,
          publishState: "reply_publication_failed" as const,
          status: "retry_later" as const,
        })
      );

      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
      await Promise.all(waitUntilTasks);

      nowSpy.mockReturnValue(1_700_000_301_000);
      await (hub as unknown as { alarm: () => Promise<void> }).alarm();
      const exhaustedAtMs =
        1_700_000_000_000 +
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS +
        1;
      nowSpy.mockReturnValue(exhaustedAtMs);
      await (hub as unknown as { alarm: () => Promise<void> }).alarm();

      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([
        expect.objectContaining({
          nextReplayAtMs:
            exhaustedAtMs +
            RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
        }),
      ]);
      expect(warnSpy).toHaveBeenCalledWith(
        "[core.runtime_transport.runtime_coordinator_finalization_retry_terminal_recovery_pending]",
        expect.objectContaining({ terminalStatus: "projection_conflict" })
      );
    } finally {
      warnSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it("reports a failed terminal projection reread instead of treating it as missing", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Intentionally suppress the expected structured warning.
    });
    try {
      const { hub, sentFrames, socket, spaceStub, state, waitUntilTasks } =
        createHarness({
          exhaustionAuthorityProjectionRaceStatus: "reply_published",
          exhaustionProjectionRereadError: true,
        });
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => ({
          finalizationCommandId: command.finalizationCommandId,
          ok: false as const,
          publicationErrorCode: "space.reply_write_failed",
          publishedSignalId: null,
          publishState: "reply_publication_failed" as const,
          status: "retry_later" as const,
        })
      );

      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
      await Promise.all(waitUntilTasks);

      nowSpy.mockReturnValue(1_700_000_301_000);
      await (hub as unknown as { alarm: () => Promise<void> }).alarm();
      nowSpy.mockReturnValue(
        1_700_000_000_000 +
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS +
          1
      );
      await (hub as unknown as { alarm: () => Promise<void> }).alarm();

      expect(warnSpy).toHaveBeenCalledWith(
        "[core.runtime_transport.runtime_coordinator_finalization_retry_park_terminal_projection_reread_failed]",
        expect.objectContaining({
          error: "runtime coordinator projection reread unavailable",
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
      expect(warnSpy).toHaveBeenCalledWith(
        "[core.runtime_transport.runtime_coordinator_finalization_retry_terminal_recovery_pending]",
        expect.objectContaining({
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
          terminalStatus: "terminal_projection_read_failed",
        })
      );
    } finally {
      warnSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it("logs invalid Space finalization claim payloads with their validation issue", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Intentionally suppress the expected structured warning.
    });
    try {
      const {
        appliedFinalizationCommands,
        hub,
        sentFrames,
        socket,
        spaceStub,
        state,
        waitUntilTasks,
      } = createHarness();
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
      await Promise.all(waitUntilTasks);
      const command = appliedFinalizationCommands.at(0);
      if (!command) {
        throw new Error("Expected a finalization command.");
      }
      spaceStub.rpcReadRuntimeCoordinatorFinalizationClaimOutcome.mockResolvedValue(
        { status: "unexpected_status" } as never
      );

      await expect(
        (
          hub as unknown as {
            readRuntimeCoordinatorFinalizationClaim: (
              input: RuntimeCoordinatorFinalizationCommand
            ) => Promise<unknown>;
          }
        ).readRuntimeCoordinatorFinalizationClaim(command)
      ).resolves.toBeNull();

      expect(warnSpy).toHaveBeenCalledWith(
        "[core.runtime_transport.runtime_coordinator_finalization_claim_invalid]",
        expect.objectContaining({
          dispatchId: command.dispatchId,
          issue: expect.any(String),
          runtimeCoordinatorExecutionId: command.runtimeCoordinatorExecutionId,
          spaceId: command.spaceId,
        })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("recovers a visible Space final claim before park exhaustion can mark publication failed", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        appliedFinalizationCommands,
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceStub,
        state,
        storageRecords,
        waitUntilTasks,
      } = createHarness();
      const wakeEvidenceD1 = createRecordingD1();
      (
        hub as unknown as {
          env: CoreBindings;
        }
      ).env.OPENMELD_WAKE_EVIDENCE_DB = wakeEvidenceD1.db;
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      let finalClaimVisible = false;
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => {
          appliedFinalizationCommands.push(command);
          if (finalClaimVisible) {
            return {
              finalMessageKind: "success_reply" as const,
              finalizationCommandId: command.finalizationCommandId,
              ok: true as const,
              publicationErrorCode: null,
              publishedSignalId: "signal-visible-final",
              publishState: "reply_published" as const,
              status: "already_final" as const,
            };
          }
          return {
            finalizationCommandId: command.finalizationCommandId,
            ok: false as const,
            publicationErrorCode: "space.task_outcome_write_failed",
            publishedSignalId: null,
            publishState: "reply_publication_failed" as const,
            status: "retry_later" as const,
          };
        }
      );
      (
        spaceStub.rpcApplyRuntimeCoordinatorPublicationExhaustionCommand as ReturnType<
          typeof vi.fn
        >
      ).mockImplementation((command: RuntimeCoordinatorFinalizationCommand) =>
        Promise.resolve().then(() => {
          finalClaimVisible = true;
          return {
            outcome: {
              finalMessageKind: "success_reply" as const,
              finalizationCommandId: command.finalizationCommandId,
              ok: true as const,
              publicationErrorCode: null,
              publishedSignalId: "signal-visible-final",
              publishState: "reply_published" as const,
              status: "already_final" as const,
            },
            status: "finalization_visible" as const,
          };
        })
      );

      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
          taskResult: buildSuccessfulPostMessageTaskResult(),
        })
      );
      await Promise.all(waitUntilTasks);

      nowSpy.mockReturnValue(1_700_000_301_000);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      nowSpy.mockReturnValue(
        1_700_000_000_000 +
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS +
          1
      );
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(appliedFinalizationCommands).toHaveLength(4);
      expect(
        spaceStub.rpcApplyRuntimeCoordinatorPublicationExhaustionCommand
      ).toHaveBeenCalled();
      expect(
        spaceStub.rpcReadRuntimeCoordinatorFinalizationClaimOutcome
      ).not.toHaveBeenCalled();
      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([]);
      expect(
        wakeEvidenceD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
      ).toMatchObject({
        status: "reply_published",
      });
      expect(
        recordingD1.calls
          .filter((call) =>
            call.query.includes("INSERT INTO agent_task_terminal_outcomes")
          )
          .map((call) => call.params[2])
      ).toEqual(["succeeded"]);
      expect(spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
        spaceId: HEX_SPACE_ID,
        streamId: "local-agent:10.dispatch-1:9.attempt-1",
        terminal: {
          kind: "final_message",
          publishedSignalId: "signal-visible-final",
        },
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it.each([
    {
      authorityWriteFailures: 0,
      projectionWriteFailures: 1,
      repair: "D1 reply projection",
    },
    {
      authorityWriteFailures: 1,
      projectionWriteFailures: 0,
      repair: "RuntimeCoordinator authority",
    },
  ])("keeps visible-claim recovery durable when the $repair repair fails once", async ({
    authorityWriteFailures,
    projectionWriteFailures,
  }) => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        appliedFinalizationCommands,
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceStub,
        state,
        storageRecords,
        waitUntilTasks,
      } = createHarness({
        replyPublishedAuthorityWriteFailures: authorityWriteFailures,
      });
      const wakeEvidenceD1 = createRecordingD1({
        replyPublishedProjectionWriteFailures: projectionWriteFailures,
      });
      (
        hub as unknown as {
          env: CoreBindings;
        }
      ).env.OPENMELD_WAKE_EVIDENCE_DB = wakeEvidenceD1.db;
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      let finalClaimVisible = false;
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => {
          appliedFinalizationCommands.push(command);
          if (finalClaimVisible) {
            return {
              finalMessageKind: "success_reply" as const,
              finalizationCommandId: command.finalizationCommandId,
              ok: true as const,
              publicationErrorCode: null,
              publishedSignalId: "signal-visible-final-repair",
              publishState: "reply_published" as const,
              status: "already_final" as const,
            };
          }
          return {
            finalizationCommandId: command.finalizationCommandId,
            ok: false as const,
            publicationErrorCode: "space.task_outcome_write_failed",
            publishedSignalId: null,
            publishState: "reply_publication_failed" as const,
            status: "retry_later" as const,
          };
        }
      );
      (
        spaceStub.rpcApplyRuntimeCoordinatorPublicationExhaustionCommand as ReturnType<
          typeof vi.fn
        >
      ).mockImplementation((command: RuntimeCoordinatorFinalizationCommand) =>
        Promise.resolve().then(() => {
          finalClaimVisible = true;
          return {
            outcome: {
              finalMessageKind: "success_reply" as const,
              finalizationCommandId: command.finalizationCommandId,
              ok: true as const,
              publicationErrorCode: null,
              publishedSignalId: "signal-visible-final-repair",
              publishState: "reply_published" as const,
              status: "already_final" as const,
            },
            status: "finalization_visible" as const,
          };
        })
      );

      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
          taskResult: buildSuccessfulPostMessageTaskResult(),
        })
      );
      await Promise.all(waitUntilTasks);

      nowSpy.mockReturnValue(1_700_000_301_000);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      const exhaustedAtMs =
        1_700_000_000_000 +
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS +
        1;
      nowSpy.mockReturnValue(exhaustedAtMs);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(appliedFinalizationCommands).toHaveLength(4);
      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([
        expect.objectContaining({
          nextReplayAtMs:
            exhaustedAtMs +
            RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
        }),
      ]);
      expect(
        recordingD1.calls.some(
          (call) =>
            call.query.includes("INSERT INTO agent_task_terminal_outcomes") &&
            call.params[2] === "publication_failed"
        )
      ).toBe(false);
      expect(
        wakeEvidenceD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
          ?.status === "reply_published"
      ).toBe(projectionWriteFailures === 0);
      expect(
        findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords)
          ?.terminalOutcome?.status === "reply_published"
      ).toBe(authorityWriteFailures === 0);

      nowSpy.mockReturnValue(
        exhaustedAtMs + RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS
      );
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(appliedFinalizationCommands).toHaveLength(4);
      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([]);
      expect(
        wakeEvidenceD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
      ).toMatchObject({ status: "reply_published" });
      expect(
        findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords)
          ?.terminalOutcome
      ).toMatchObject({
        replySignalId: "signal-visible-final-repair",
        status: "reply_published",
      });
      expect(
        recordingD1.calls.some(
          (call) =>
            call.query.includes("INSERT INTO agent_task_terminal_outcomes") &&
            call.params[2] === "succeeded"
        )
      ).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("keeps park exhaustion recoverable while Space claim reconciliation is uncertain", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        appliedFinalizationCommands,
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceStub,
        state,
        storageRecords,
        waitUntilTasks,
      } = createHarness({ taskTerminalOutcomeWriteFailures: 1 });
      const wakeEvidenceD1 = createRecordingD1();
      (
        hub as unknown as {
          env: CoreBindings;
        }
      ).env.OPENMELD_WAKE_EVIDENCE_DB = wakeEvidenceD1.db;
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      let finalClaimVisible = false;
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => {
          appliedFinalizationCommands.push(command);
          if (finalClaimVisible) {
            return {
              finalMessageKind: "success_reply" as const,
              finalizationCommandId: command.finalizationCommandId,
              ok: true as const,
              publicationErrorCode: null,
              publishedSignalId: "signal-visible-final-after-retry",
              publishState: "reply_published" as const,
              status: "already_final" as const,
            };
          }
          return {
            finalizationCommandId: command.finalizationCommandId,
            ok: false as const,
            publicationErrorCode: "daemon.result.finalization_unavailable",
            publishedSignalId: null,
            publishState: "reply_publication_failed" as const,
            status: "retry_later" as const,
          };
        }
      );
      (
        spaceStub.rpcApplyRuntimeCoordinatorPublicationExhaustionCommand as ReturnType<
          typeof vi.fn
        >
      ).mockRejectedValue(new Error("Space claim read unavailable."));

      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
          taskResult: buildSuccessfulPostMessageTaskResult(),
        })
      );
      await Promise.all(waitUntilTasks);

      nowSpy.mockReturnValue(1_700_000_301_000);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      const exhaustedAtMs =
        1_700_000_000_000 +
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS +
        1;
      nowSpy.mockReturnValue(exhaustedAtMs);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(appliedFinalizationCommands).toHaveLength(3);
      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([
        expect.objectContaining({
          nextReplayAtMs:
            exhaustedAtMs +
            RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
        }),
      ]);
      expect(
        findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords)
          ?.terminalOutcome
      ).toBeNull();

      (
        spaceStub.rpcApplyRuntimeCoordinatorPublicationExhaustionCommand as ReturnType<
          typeof vi.fn
        >
      ).mockImplementation((command: RuntimeCoordinatorFinalizationCommand) =>
        Promise.resolve().then(() => {
          finalClaimVisible = true;
          return {
            outcome: {
              finalMessageKind: "success_reply" as const,
              finalizationCommandId: command.finalizationCommandId,
              ok: true as const,
              publicationErrorCode: null,
              publishedSignalId: "signal-visible-final-after-retry",
              publishState: "reply_published" as const,
              status: "already_final" as const,
            },
            status: "finalization_visible" as const,
          };
        })
      );
      const taskRepairAtMs =
        exhaustedAtMs + RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS;
      nowSpy.mockReturnValue(taskRepairAtMs);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(appliedFinalizationCommands).toHaveLength(5);
      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([
        expect.objectContaining({
          nextReplayAtMs:
            taskRepairAtMs +
            RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
        }),
      ]);
      expect(
        findRuntimeCoordinatorExecutionTokenAuthorityRecord(storageRecords)
          ?.terminalOutcome
      ).toBeNull();
      expect(
        recordingD1.calls.some(
          (call) =>
            call.query.includes("INSERT INTO agent_task_terminal_outcomes") &&
            call.params[2] === "publication_failed"
        )
      ).toBe(false);

      nowSpy.mockReturnValue(
        taskRepairAtMs + RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS
      );
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      expect(appliedFinalizationCommands).toHaveLength(6);
      expect(
        storageRecords.get(
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
        )
      ).toEqual([]);
      expect(
        wakeEvidenceD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
      ).toMatchObject({ status: "reply_published" });
      expect(
        recordingD1.calls.some(
          (call) =>
            call.query.includes("INSERT INTO agent_task_terminal_outcomes") &&
            call.params[2] === "succeeded"
        )
      ).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("lets an in-flight late failure publication settle before exhaustion decides the terminal outcome", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const {
        hub,
        recordingD1,
        sentFrames,
        socket,
        spaceStub,
        state,
        waitUntilTasks,
      } = createHarness();
      const executionToken = await issueDeliveryToken({
        hub,
        sentFrames,
        socket,
        state,
      });
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
        (command: RuntimeCoordinatorFinalizationCommand) => ({
          finalizationCommandId: command.finalizationCommandId,
          ok: false as const,
          publicationErrorCode: "space.reply_write_failed",
          publishedSignalId: null,
          publishState: "reply_publication_failed" as const,
          status: "retry_later" as const,
        })
      );

      await (
        hub as unknown as {
          handleDispatchResultFrame: (
            webSocket: WebSocket,
            payload: unknown
          ) => Promise<void>;
        }
      ).handleDispatchResultFrame(
        socket,
        buildResultRequest({
          executionTokenEcho: buildExecutionTokenEcho(executionToken),
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        })
      );
      await Promise.all(waitUntilTasks);

      nowSpy.mockReturnValue(1_700_000_301_000);
      await (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();

      let releaseLatePublication: () => void = () => undefined;
      let markLatePublicationStarted: () => void = () => undefined;
      let markCompetingReplayStarted: () => void = () => undefined;
      const latePublicationGate = new Promise<void>((resolve) => {
        releaseLatePublication = resolve;
      });
      const latePublicationStarted = new Promise<void>((resolve) => {
        markLatePublicationStarted = resolve;
      });
      const competingReplayStarted = new Promise<void>((resolve) => {
        markCompetingReplayStarted = resolve;
      });
      let concurrentReplayCount = 0;
      (
        spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand as ReturnType<
          typeof vi.fn
        >
      ).mockImplementation(
        async (command: RuntimeCoordinatorFinalizationCommand) => {
          concurrentReplayCount += 1;
          if (concurrentReplayCount === 1) {
            markLatePublicationStarted();
            await latePublicationGate;
            return {
              finalMessageKind: "failure_notice" as const,
              finalizationCommandId: command.finalizationCommandId,
              ok: true as const,
              publicationErrorCode: null,
              publishedSignalId: "signal-late-final",
              publishState: "reply_published" as const,
              status: "finalized" as const,
            };
          }
          markCompetingReplayStarted();
          return {
            finalizationCommandId: command.finalizationCommandId,
            ok: false as const,
            publicationErrorCode: "space.reply_write_failed",
            publishedSignalId: null,
            publishState: "reply_publication_failed" as const,
            status: "retry_later" as const,
          };
        }
      );

      nowSpy.mockReturnValue(
        1_700_000_000_000 +
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS +
          1
      );
      const replayPromise = (
        hub as unknown as {
          rpcReplayRuntimeCoordinatorFinalizationCommand: (
            input: Record<string, string>
          ) => Promise<unknown>;
        }
      ).rpcReplayRuntimeCoordinatorFinalizationCommand({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        executionTokenRunId: executionToken.runId,
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        spaceId: HEX_SPACE_ID,
      });
      await latePublicationStarted;
      const alarmPromise = (
        hub as unknown as {
          alarm: () => Promise<void>;
        }
      ).alarm();
      const competingReplayWon = await Promise.race([
        competingReplayStarted.then(() => true),
        new Promise<false>((resolve) => {
          setTimeout(() => resolve(false), 20);
        }),
      ]);
      if (competingReplayWon) {
        await alarmPromise;
      }
      const alarmCompletedWithinBound = await Promise.race([
        alarmPromise.then(() => true),
        new Promise<false>((resolve) => {
          setTimeout(() => resolve(false), 2500);
        }),
      ]);

      expect(alarmCompletedWithinBound).toBe(true);
      expect(concurrentReplayCount).toBe(1);
      expect(
        recordingD1.calls.some((call) =>
          call.query.includes("INSERT INTO agent_task_terminal_outcomes")
        )
      ).toBe(false);

      releaseLatePublication();
      await replayPromise;
      await vi.waitFor(() => {
        expect(
          recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
        ).toMatchObject({
          status: "failed_terminal",
        });
      });
      expect(
        recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
      ).toMatchObject({
        status: "failed_terminal",
      });
      expect(
        recordingD1.inboxRows.get("dispatch-1::attempt-1")?.published_signal_id
      ).toBe("signal-late-final");
      expect(
        recordingD1.calls
          .filter((call) =>
            call.query.includes("INSERT INTO agent_task_terminal_outcomes")
          )
          .map((call) => call.params[2])
      ).toEqual(["failed"]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("recovers an accepted final Space claim when the publication RPC response stays in flight", async () => {
    const {
      hub,
      recordingD1,
      sentFrames,
      socket,
      spaceStub,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness();
    const wakeEvidenceD1 = createRecordingD1();
    (
      hub as unknown as {
        env: CoreBindings;
      }
    ).env.OPENMELD_WAKE_EVIDENCE_DB = wakeEvidenceD1.db;
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
      (command: RuntimeCoordinatorFinalizationCommand) => ({
        finalizationCommandId: command.finalizationCommandId,
        ok: false as const,
        publicationErrorCode: "space.reply_write_failed",
        publishedSignalId: null,
        publishState: "reply_publication_failed" as const,
        status: "retry_later" as const,
      })
    );
    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );
    await Promise.all(waitUntilTasks);

    let releasePublicationResponse: () => void = () => undefined;
    const publicationResponseGate = new Promise<void>((resolve) => {
      releasePublicationResponse = resolve;
    });
    (
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand as ReturnType<
        typeof vi.fn
      >
    ).mockClear();
    let replayApplyCallCount = 0;
    (
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand as ReturnType<
        typeof vi.fn
      >
    ).mockImplementation(
      async (command: RuntimeCoordinatorFinalizationCommand) => {
        replayApplyCallCount += 1;
        if (replayApplyCallCount === 1) {
          await publicationResponseGate;
          return {
            finalizationCommandId: command.finalizationCommandId,
            ok: false as const,
            publicationErrorCode: "space.task_outcome_write_failed",
            publishedSignalId: null,
            publishState: "reply_publication_failed" as const,
            status: "retry_later" as const,
          };
        }
        return {
          finalMessageKind: "success_reply" as const,
          finalizationCommandId: command.finalizationCommandId,
          ok: true as const,
          publicationErrorCode: null,
          publishedSignalId: "signal-claim-recovered",
          publishState: "reply_published" as const,
          status: "already_final" as const,
        };
      }
    );
    (
      spaceStub.rpcReadRuntimeCoordinatorFinalizationClaimOutcome as ReturnType<
        typeof vi.fn
      >
    ).mockImplementation((command: RuntimeCoordinatorFinalizationCommand) =>
      Promise.resolve({
        outcome: {
          finalMessageKind: "success_reply" as const,
          finalizationCommandId: command.finalizationCommandId,
          ok: true as const,
          publicationErrorCode: null,
          publishedSignalId: "signal-claim-recovered",
          publishState: "reply_published" as const,
          status: "already_final" as const,
        },
        status: "finalization_visible" as const,
      })
    );

    const replay = await (
      hub as unknown as {
        rpcReplayRuntimeCoordinatorFinalizationCommand: (
          input: Record<string, string>
        ) => Promise<unknown>;
      }
    ).rpcReplayRuntimeCoordinatorFinalizationCommand({
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      executionTokenRunId: executionToken.runId,
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      spaceId: HEX_SPACE_ID,
    });

    expect(replay).toMatchObject({
      ok: true,
      outcome: {
        publishedSignalId: "signal-claim-recovered",
        publishState: "reply_published",
        status: "already_final",
      },
    });
    expect(
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand
    ).toHaveBeenCalledTimes(2);
    expect(
      wakeEvidenceD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
    ).toMatchObject({
      status: "reply_published",
    });
    expect(
      recordingD1.calls.some((call) =>
        call.query.includes("INSERT INTO agent_task_terminal_outcomes")
      )
    ).toBe(true);
    expect(
      wakeEvidenceD1.calls.some((call) =>
        call.query.includes("INSERT INTO agent_task_terminal_outcomes")
      )
    ).toBe(false);

    releasePublicationResponse();
    await vi.waitFor(() => {
      expect(
        (
          hub as unknown as {
            runtimeCoordinatorFinalizationTails: Map<string, Promise<void>>;
          }
        ).runtimeCoordinatorFinalizationTails.size
      ).toBe(0);
    });
    expect(
      storageRecords.get(
        buildRuntimeCoordinatorFinalizationOutcomeStorageKey(
          buildRuntimeCoordinatorFinalizationCommandId({
            executionTokenRunId: executionToken.runId,
            runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
          })
        )
      )
    ).toMatchObject({
      ok: true,
      publishedSignalId: "signal-claim-recovered",
      publishState: "reply_published",
    });
    expect(
      storageRecords.get(
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
      )
    ).toEqual([]);
  });

  it("treats a failed final-claim repair as publication uncertainty", async () => {
    const { hub } = createHarness();
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const recoveryError = new Error("Space claim read failed.");
    vi.spyOn(
      hub as unknown as {
        recoverRuntimeCoordinatorFinalizationFromSpaceClaim: (
          input: Record<string, string>
        ) => Promise<unknown>;
      },
      "recoverRuntimeCoordinatorFinalizationFromSpaceClaim"
    ).mockRejectedValue(recoveryError);

    try {
      await expect(
        (
          hub as unknown as {
            runBoundedRuntimeCoordinatorFinalizationRecovery: (
              input: Record<string, string>
            ) => Promise<unknown>;
          }
        ).runBoundedRuntimeCoordinatorFinalizationRecovery({
          attemptId: "attempt-recovery-failed",
          dispatchId: "dispatch-recovery-failed",
          executionTokenRunId: "run-recovery-failed",
          runtimeCoordinatorExecutionId: "execution-recovery-failed",
          spaceId: HEX_SPACE_ID,
        })
      ).resolves.toEqual({
        status: "completed",
        value: null,
      });
      expect(warning).toHaveBeenCalledWith(
        "[core.runtime_transport.runtime_coordinator_finalization_recovery_failed]",
        expect.objectContaining({
          attemptId: "attempt-recovery-failed",
          dispatchId: "dispatch-recovery-failed",
          error: recoveryError.message,
          runtimeCoordinatorExecutionId: "execution-recovery-failed",
          spaceId: HEX_SPACE_ID,
        })
      );
      expect(
        (
          hub as unknown as {
            runtimeCoordinatorFinalizationRecoveryTails: Map<
              string,
              Promise<unknown>
            >;
          }
        ).runtimeCoordinatorFinalizationRecoveryTails.size
      ).toBe(0);
    } finally {
      warning.mockRestore();
    }
  });

  it("keeps failed active final-claim repair bounded as publication uncertainty", async () => {
    const {
      hub,
      sentFrames,
      socket,
      spaceStub,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
      (command: RuntimeCoordinatorFinalizationCommand) => ({
        finalizationCommandId: command.finalizationCommandId,
        ok: false as const,
        publicationErrorCode: "space.reply_write_failed",
        publishedSignalId: null,
        publishState: "reply_publication_failed" as const,
        status: "retry_later" as const,
      })
    );
    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );
    await Promise.all(waitUntilTasks);

    let releasePublicationResponse: () => void = () => undefined;
    let rejectClaimRead: (error: Error) => void = () => undefined;
    const publicationResponseGate = new Promise<void>((resolve) => {
      releasePublicationResponse = resolve;
    });
    const claimReadGate = new Promise<void>((_resolve, reject) => {
      rejectClaimRead = reject;
    });
    (
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand as ReturnType<
        typeof vi.fn
      >
    ).mockImplementation(
      async (command: RuntimeCoordinatorFinalizationCommand) => {
        await publicationResponseGate;
        return {
          finalizationCommandId: command.finalizationCommandId,
          ok: false as const,
          publicationErrorCode: "space.task_outcome_write_failed",
          publishedSignalId: null,
          publishState: "reply_publication_failed" as const,
          status: "retry_later" as const,
        };
      }
    );
    (
      spaceStub.rpcReadRuntimeCoordinatorFinalizationClaimOutcome as ReturnType<
        typeof vi.fn
      >
    ).mockImplementation(async () => {
      await claimReadGate;
      throw new Error("unreachable");
    });

    const startedAtMs = performance.now();
    const replay = await (
      hub as unknown as {
        rpcReplayRuntimeCoordinatorFinalizationCommand: (
          input: Record<string, string>
        ) => Promise<unknown>;
      }
    ).rpcReplayRuntimeCoordinatorFinalizationCommand({
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      executionTokenRunId: executionToken.runId,
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      spaceId: HEX_SPACE_ID,
    });
    const elapsedMs = performance.now() - startedAtMs;

    expect(replay).toEqual({
      ok: false,
      reasonCode: "daemon.result.finalization_unavailable",
      status: "retry_later",
    });
    expect(elapsedMs).toBeLessThan(3500);
    expect(
      (
        hub as unknown as {
          runtimeCoordinatorFinalizationRecoveryTails: Map<
            string,
            Promise<unknown>
          >;
        }
      ).runtimeCoordinatorFinalizationRecoveryTails.size
    ).toBe(1);
    expect(
      storageRecords.get(
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
      )
    ).toHaveLength(1);

    releasePublicationResponse();
    await vi.waitFor(() => {
      expect(
        (
          hub as unknown as {
            runtimeCoordinatorFinalizationTails: Map<string, Promise<void>>;
          }
        ).runtimeCoordinatorFinalizationTails.size
      ).toBe(0);
    });
    const publicationCallCountBeforeRetry =
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mock.calls.length;
    const retryStartedAtMs = performance.now();
    const retry = (
      hub as unknown as {
        rpcReplayRuntimeCoordinatorFinalizationCommand: (
          input: Record<string, string>
        ) => Promise<unknown>;
      }
    ).rpcReplayRuntimeCoordinatorFinalizationCommand({
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      executionTokenRunId: executionToken.runId,
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      spaceId: HEX_SPACE_ID,
    });
    rejectClaimRead(new Error("Space claim read failed."));
    await expect(retry).resolves.toEqual({
      ok: false,
      reasonCode: "daemon.result.finalization_unavailable",
      status: "retry_later",
    });
    expect(performance.now() - retryStartedAtMs).toBeLessThan(2000);
    expect(
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand
    ).toHaveBeenCalledTimes(publicationCallCountBeforeRetry);

    await vi.waitFor(() => {
      expect(
        (
          hub as unknown as {
            runtimeCoordinatorFinalizationRecoveryTails: Map<
              string,
              Promise<unknown>
            >;
          }
        ).runtimeCoordinatorFinalizationRecoveryTails.size
      ).toBe(0);
    });
  });

  it("keeps a claimed Wake Stop terminal when a late finalization failure returns", async () => {
    const {
      hub,
      recordingD1,
      sentFrames,
      socket,
      spaceStub,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness({
      agentControllerReportRow: buildRuntimeAgentControllerReportRow(),
    });
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
      (command: RuntimeCoordinatorFinalizationCommand) => ({
        finalizationCommandId: command.finalizationCommandId,
        ok: false as const,
        publicationErrorCode: "space.reply_write_failed",
        publishedSignalId: null,
        publishState: "reply_publication_failed" as const,
        status: "retry_later" as const,
      })
    );
    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );
    await Promise.all(waitUntilTasks.splice(0));

    let markPublicationStarted: () => void = () => undefined;
    let releasePublicationResponse: () => void = () => undefined;
    const publicationStarted = new Promise<void>((resolve) => {
      markPublicationStarted = resolve;
    });
    const publicationResponseGate = new Promise<void>((resolve) => {
      releasePublicationResponse = resolve;
    });
    (
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand as ReturnType<
        typeof vi.fn
      >
    ).mockImplementation(
      async (command: RuntimeCoordinatorFinalizationCommand) => {
        markPublicationStarted();
        await publicationResponseGate;
        return {
          finalizationCommandId: command.finalizationCommandId,
          ok: false as const,
          publicationErrorCode: "space.task_outcome_write_failed",
          publishedSignalId: null,
          publishState: "reply_publication_failed" as const,
          status: "retry_later" as const,
        };
      }
    );
    (
      spaceStub.rpcReadRuntimeCoordinatorFinalizationClaimOutcome as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValue({
      publishedSignalId: "signal-wake-stopped-1",
      status: "wake_stopped_visible" as const,
    });

    const replayPromise = (
      hub as unknown as {
        rpcReplayRuntimeCoordinatorFinalizationCommand: (
          input: Record<string, string>
        ) => Promise<unknown>;
      }
    ).rpcReplayRuntimeCoordinatorFinalizationCommand({
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      executionTokenRunId: executionToken.runId,
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      spaceId: HEX_SPACE_ID,
    });
    await publicationStarted;
    const projection = recordingD1.projectionRows.get(
      RUNTIME_COORDINATOR_EXECUTION_ID
    );
    expect(projection).toBeDefined();
    recordingD1.projectionRows.set(RUNTIME_COORDINATOR_EXECUTION_ID, {
      ...projection,
      status: "cancellation_requested",
      terminal_outcome_json: null,
      updated_at_ms: Date.now(),
    });

    await expect(replayPromise).resolves.toEqual({
      ok: true,
      reasonCode: "runtime_coordinator.wake_stop_requested",
      status: "suppressed",
    });
    expect(
      recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
    ).toMatchObject({
      status: "cancelled",
    });
    expect(
      recordingD1.inboxRows.get("dispatch-1::attempt-1")?.publish_state
    ).toBe("reply_suppressed_stopped");

    releasePublicationResponse();
    await vi.waitFor(() => {
      expect(
        (
          hub as unknown as {
            runtimeCoordinatorFinalizationTails: Map<string, Promise<void>>;
          }
        ).runtimeCoordinatorFinalizationTails.size
      ).toBe(0);
    });
    expect(
      storageRecords.get(
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
      )
    ).toEqual([]);
    expect(
      recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
    ).toMatchObject({
      status: "cancelled",
    });
  });

  it("sends the daemon receipt on durable acceptance with the retry backstop seeded before the publish lands", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      sentFrames,
      socket,
      spaceStub,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    // Hold the Space publish open so a receipt can only appear if it no
    // longer waits on publication.
    let releasePublish: () => void = () => undefined;
    const publishGate = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    (
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand as ReturnType<
        typeof vi.fn
      >
    ).mockImplementation(
      async (command: RuntimeCoordinatorFinalizationCommand) => {
        await publishGate;
        appliedFinalizationCommands.push(command);
        return {
          finalMessageKind: "success_reply" as const,
          finalizationCommandId: command.finalizationCommandId,
          ok: true as const,
          publicationErrorCode: null,
          publishedSignalId: "signal-final-1",
          publishState: "reply_published" as const,
          status: "finalized" as const,
        };
      }
    );
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    // Receipt is out while the publish is still held open.
    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: true,
          status: "accepted",
        }),
      })
    );
    expect(appliedFinalizationCommands).toHaveLength(0);
    // Durability backstop: the finalization retry entry is seeded at
    // command-create time, so the retry alarm replays this command even if
    // the waitUntil replay never runs.
    const seededRetries = storageRecords.get(
      RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
    ) as Array<{ dispatchId: string }> | undefined;
    expect(seededRetries).toHaveLength(1);
    expect(seededRetries?.at(0)).toMatchObject({ dispatchId: "dispatch-1" });
    // Hot path passes the in-memory command into the replay: the only
    // command-key storage read is ensure…'s idempotency check, and the
    // waitUntil replay below must not add another one.
    const storageGet = (
      hub as unknown as {
        ctx: { storage: { get: ReturnType<typeof vi.fn> } };
      }
    ).ctx.storage.get;
    const countCommandKeyReads = () =>
      storageGet.mock.calls.filter(([key]) =>
        String(key).startsWith(
          RUNTIME_COORDINATOR_FINALIZATION_COMMAND_STORAGE_KEY_PREFIX
        )
      ).length;
    const commandKeyReadsBeforeReplay = countCommandKeyReads();

    releasePublish();
    await Promise.all(waitUntilTasks.splice(0));

    expect(countCommandKeyReads()).toBe(commandKeyReadsBeforeReplay);

    expect(appliedFinalizationCommands).toHaveLength(1);
    // Publish success clears the seeded retry backstop.
    expect(
      (storageRecords.get(
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
      ) as unknown[] | undefined) ?? []
    ).toHaveLength(0);
  });

  it.each([
    ["raw_context_sharing reply", buildResultRequest().taskResult],
    ["stay_silent notice", buildSuccessfulStaySilentTaskResult()],
  ])("keeps a first legacy %s result retryable until Space confirms its final claim", async (_label, taskResult) => {
    const {
      appliedFinalizationCommands,
      hub,
      sentFrames,
      socket,
      spaceStub,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
      (command: RuntimeCoordinatorFinalizationCommand) => {
        appliedFinalizationCommands.push(command);
        return {
          finalizationCommandId: command.finalizationCommandId,
          ok: true as const,
          publicationErrorCode: null,
          publishedSignalId: "signal-legacy-final",
          publishState: "reply_published" as const,
          status: "finalized" as const,
        };
      }
    );
    spaceStub.rpcReadRuntimeCoordinatorFinalizationClaimOutcome.mockResolvedValue(
      { status: "unresolved" as const }
    );

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        taskResult,
      })
    );
    await Promise.all(waitUntilTasks.splice(0));

    expect(
      spaceStub.rpcReadRuntimeCoordinatorFinalizationClaimOutcome
    ).toHaveBeenCalledOnce();
    expect(
      storageRecords.get(
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
      )
    ).toEqual([
      expect.objectContaining({
        dispatchId: "dispatch-1",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      }),
    ]);
  });

  it("uses the visible Space claim instead of legacy task prose to classify the first final result", async () => {
    const {
      hub,
      sentFrames,
      socket,
      spaceStub,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand.mockImplementation(
      (command: RuntimeCoordinatorFinalizationCommand) => ({
        finalizationCommandId: command.finalizationCommandId,
        ok: true as const,
        publicationErrorCode: null,
        publishedSignalId: "signal-legacy-final",
        publishState: "reply_published" as const,
        status: "finalized" as const,
      })
    );
    (
      spaceStub.rpcReadRuntimeCoordinatorFinalizationClaimOutcome as ReturnType<
        typeof vi.fn
      >
    ).mockImplementation((command: RuntimeCoordinatorFinalizationCommand) => ({
      outcome: {
        finalMessageKind: "stay_silent" as const,
        finalizationCommandId: command.finalizationCommandId,
        ok: true as const,
        publicationErrorCode: null,
        publishedSignalId: "signal-legacy-final",
        publishState: "reply_published" as const,
        status: "already_final" as const,
      },
      status: "finalization_visible" as const,
    }));

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );
    await Promise.all(waitUntilTasks.splice(0));

    expect(
      spaceStub.rpcReadRuntimeCoordinatorFinalizationClaimOutcome
    ).toHaveBeenCalledOnce();
    expect(
      storageRecords.get(
        buildRuntimeCoordinatorFinalizationOutcomeStorageKey(
          buildRuntimeCoordinatorFinalizationCommandId({
            executionTokenRunId: executionToken.runId,
            runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
          })
        )
      )
    ).toMatchObject({
      finalMessageKind: "stay_silent",
      publishedSignalId: "signal-legacy-final",
      publishState: "reply_published",
    });
    expect(
      storageRecords.get(
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
      )
    ).toEqual([]);
  });

  it("returns review_required without accepting the result when a capable Service proposed a stale reply", async () => {
    const {
      hub,
      recordingD1,
      sentFrames,
      socket,
      spaceStub,
      state,
      storageRecords,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    const session = state.sessionsById.get("daemon-session-1");
    if (!session) {
      throw new Error("test session missing");
    }
    session.capabilities.agentReplyContextReview = true;
    (
      spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand as ReturnType<
        typeof vi.fn
      >
    ).mockImplementation(
      async (command: RuntimeCoordinatorFinalizationCommand) => ({
        finalizationCommandId: command.finalizationCommandId,
        ok: false as const,
        publicationErrorCode: "space.agent_reply.context_changed" as const,
        publishedSignalId: null,
        publishState: "reply_review_required" as const,
        status: "review_required" as const,
      })
    );
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        taskResult: buildSuccessfulPostMessageTaskResult(),
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: {
          attemptId: "attempt-1",
          dispatchId: "dispatch-1",
          ok: false,
          reasonCode: "space.agent_reply.context_changed",
          status: "review_required",
        },
      })
    );
    expect(recordingD1.inboxRows.has("dispatch-1::attempt-1")).toBe(false);
    expect(
      state.pendingDispatches.get(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )?.phase
    ).toBe("starting");
    expect(
      [...storageRecords.keys()].some((key) =>
        key.startsWith(
          RUNTIME_COORDINATOR_FINALIZATION_COMMAND_STORAGE_KEY_PREFIX
        )
      )
    ).toBe(false);
    expect(
      (storageRecords.get(
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
      ) as unknown[] | undefined) ?? []
    ).toHaveLength(0);
  });

  it("finalizes an accepted Agent reply from the same command without publishing it twice", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      recordingD1,
      sentFrames,
      socket,
      state,
      storageRecords,
      waitUntilTasks,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    const session = state.sessionsById.get("daemon-session-1");
    if (!session) {
      throw new Error("test session missing");
    }
    session.capabilities.agentReplyContextReview = true;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        taskResult: buildSuccessfulPostMessageTaskResult(),
      })
    );
    await Promise.all(waitUntilTasks.splice(0));

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: true,
          status: "accepted",
        }),
      })
    );
    expect(appliedFinalizationCommands).toHaveLength(1);
    expect(
      recordingD1.projectionRows.get(RUNTIME_COORDINATOR_EXECUTION_ID)
    ).toMatchObject({ status: "reply_published" });
    expect(recordingD1.inboxRows.get("dispatch-1::attempt-1")).toMatchObject({
      published_signal_id: "signal-final-1",
      publish_state: "reply_published",
    });
    expect(
      (storageRecords.get(
        RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
      ) as unknown[] | undefined) ?? []
    ).toHaveLength(0);
  });

  it("keeps a token-valid accepted result retryable until the finalization command is durable", async () => {
    const {
      appliedFinalizationCommands,
      hub,
      recordingD1,
      sentFrames,
      socket,
      state,
      storagePut,
      storageRecords,
      waitUntilTasks,
    } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    storagePut.mockImplementation((key: string, value: unknown) => {
      if (key.includes("runtime-coordinator:finalization-command:")) {
        return Promise.reject(new Error("finalization command storage down"));
      }
      storageRecords.set(key, value);
      return Promise.resolve();
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: false,
          reasonCode: "daemon.result.finalization_unavailable",
          status: "retry_later",
        }),
      })
    );
    expect(appliedFinalizationCommands).toHaveLength(0);
    expect(
      state.pendingDispatches.has(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )
    ).toBe(true);
    expect(
      state.completedDispatchResults.has(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )
    ).toBe(false);
    expect(
      recordingD1.inboxRows.get("dispatch-1::attempt-1")?.publish_state
    ).toBe("result_accepted");

    storagePut.mockImplementation((key: string, value: unknown) => {
      storageRecords.set(key, value);
      return Promise.resolve();
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: true,
          status: "accepted",
        }),
      })
    );
    // The receipt above is sent on durable acceptance; the Space publish
    // finishes in the waitUntil replay, so flush it before terminal asserts.
    await Promise.all(waitUntilTasks.splice(0));
    expect(appliedFinalizationCommands).toHaveLength(1);
    expect(appliedFinalizationCommands[0]).toMatchObject({
      dispatchId: "dispatch-1",
      executionTokenRunId: executionToken.runId,
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
    });
    const authority = [...storageRecords.values()].find(
      (value): value is RuntimeCoordinatorExecutionTokenAuthorityRecord =>
        value !== null && typeof value === "object" && "runsById" in value
    );
    expect(authority?.terminalOutcome).toMatchObject({
      reasonCode: "space.reply_published",
      replySignalId: "signal-final-1",
      status: "reply_published",
    });
  });

  it("classifies late lifecycle after accepted result as terminal token progress", async () => {
    const { hub, recordingD1, sentFrames, socket, state } = createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );
    recordingD1.calls.length = 0;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchLifecycleFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchLifecycleFrame(
      socket,
      buildLifecycleRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.error",
        payload: expect.objectContaining({
          code: "execution_token_terminal_late",
        }),
      })
    );
    const tokenEvent = getRuntimeCoordinatorEventCalls(recordingD1.calls).find(
      (call) => call.params[2] === "execution_token_terminal_late"
    );
    expect(tokenEvent?.params[1]).toBe(RUNTIME_COORDINATOR_EXECUTION_ID);
    expect(JSON.parse(String(tokenEvent?.params[7]))).toEqual(
      expect.objectContaining({
        frameKind: "lifecycle",
        reasonCode: "execution_token_terminal_late",
        tokenFingerprint: executionToken.tokenFingerprint,
        tokenStatus: "terminal",
      })
    );
  });

  it("rejects an expired token result before result inbox acceptance", async () => {
    const { hub, recordingD1, sentFrames, socket, state, storageRecords } =
      createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    const [authorityKey, rawAuthority] =
      findRuntimeCoordinatorExecutionTokenAuthorityEntry(storageRecords) ?? [];
    if (!(authorityKey && rawAuthority)) {
      throw new Error("Expected stored token authority.");
    }
    const authority =
      rawAuthority as RuntimeCoordinatorExecutionTokenAuthorityRecord;
    const activeRun = authority.runsById[executionToken.runId];
    if (!activeRun) {
      throw new Error("Expected active token run.");
    }
    storageRecords.set(authorityKey, {
      ...authority,
      runsById: {
        ...authority.runsById,
        [executionToken.runId]: {
          ...activeRun,
          expiresAtMs: 1,
        },
      },
    });
    recordingD1.calls.length = 0;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: false,
          reasonCode: "execution_token_expired",
          status: "rejected_terminal",
        }),
      })
    );
    expect(
      recordingD1.calls.some((call) =>
        call.query.includes("openMeldDaemon_dispatch_result_inbox")
      )
    ).toBe(false);
    expect(
      getRuntimeCoordinatorEventCalls(recordingD1.calls).some(
        (call) => call.params[2] === "execution_token_expired"
      )
    ).toBe(true);
  });

  it("classifies a superseded token result from DO token history without accepting the result", async () => {
    const { hub, recordingD1, sentFrames, socket, state, storageRecords } =
      createHarness();
    const executionToken = await issueDeliveryToken({
      hub,
      sentFrames,
      socket,
      state,
    });
    const [authorityKey, rawAuthority] =
      findRuntimeCoordinatorExecutionTokenAuthorityEntry(storageRecords) ?? [];
    if (!(authorityKey && rawAuthority)) {
      throw new Error("Expected stored token authority.");
    }
    const retiredAuthority = retireRuntimeCoordinatorTokenRun({
      authority:
        rawAuthority as RuntimeCoordinatorExecutionTokenAuthorityRecord,
      reasonCode: "execution_token_superseded",
      retiredAtMs: 1_700_000_001_000,
      retentionExpiresAtMs: 1_700_000_011_000,
      runId: executionToken.runId,
      tokenStatus: "superseded",
    });
    storageRecords.set(authorityKey, retiredAuthority);
    recordingD1.calls.length = 0;
    sentFrames.length = 0;

    await (
      hub as unknown as {
        handleDispatchResultFrame: (
          webSocket: WebSocket,
          payload: unknown
        ) => Promise<void>;
      }
    ).handleDispatchResultFrame(
      socket,
      buildResultRequest({
        executionTokenEcho: buildExecutionTokenEcho(executionToken),
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      })
    );

    expect(
      state.completedDispatchResults.has(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )
    ).toBe(false);
    expect(sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.dispatch.accepted",
        payload: expect.objectContaining({
          ok: false,
          reasonCode: "execution_token_superseded",
          status: "rejected_terminal",
        }),
      })
    );
    expect(
      recordingD1.calls.some((call) =>
        call.query.includes("openMeldDaemon_dispatch_result_inbox")
      )
    ).toBe(false);
    const tokenEvent = getRuntimeCoordinatorEventCalls(recordingD1.calls).find(
      (call) => call.params[2] === "execution_token_superseded"
    );
    expect(tokenEvent?.params[1]).toBe(RUNTIME_COORDINATOR_EXECUTION_ID);
    expect(JSON.parse(String(tokenEvent?.params[7]))).toEqual(
      expect.objectContaining({
        frameKind: "result",
        reasonCode: "execution_token_superseded",
        tokenFingerprint: executionToken.tokenFingerprint,
        tokenStatus: "superseded",
      })
    );
  });
});
