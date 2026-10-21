import type { AgentExecutionStatusProjection } from "@openmeld/agent-runtime";
import {
  DEFAULT_DISPATCH_FINALIZATION_TIMEOUT_MS,
  DEFAULT_DISPATCH_START_TIMEOUT_MS,
  DEFAULT_TASK_PROGRESS_EVIDENCE_STALE_AFTER_MS,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  hasRuntimeAdapterCapabilityForRef,
  isAgentWakeAdmissionPreparationPendingReason,
  parseAgentControllerRef,
  resolveAgentControllerUsageLimitSupport,
  resolveAgentWakeAdmissionBlockReasonCode,
} from "@openmeld/agent-runtime";
import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import type { SignalEnvelope } from "@openmeld/protocol";
import type { PermissionModeAdvisory } from "@openmeld/schemas";
import {
  builtinAgentControllerAllowsDistinctConversationId,
  CONVERSATION_CONTINUITY_WARNING_PURPOSE,
  CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
  HOSTED_REMOTE_AGENT_RUNTIME_IDENTITY,
  hostedCenterAgentRuntimeIdentitySchema,
  LEGACY_RUNTIME_DISPATCH_POLICY,
  normalizeKnownBuiltinAgentControllerId,
  normalizeOptionalWorkingDirectory,
  openMeldDaemonProviderAccessEvidenceProviderSchema,
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
  resolveBuiltinAgentControllerConversationKind,
  resolvePublicAgentAvailabilityCopy,
  resolveSingleSpaceMentionLabels,
} from "@openmeld/schemas";
import type {
  AgentControllerConversationRef,
  BootstrapTemplateFacts,
  CenterAgentModelRoute,
  DispatchExecution,
  DispatchResult,
  HostedAgentRuntimeIdentity,
  HostedCenterAgentRuntimeIdentity,
  MessageEnvelope,
  OpenMeldDaemonAcceptedDispatchSnapshot,
  OpenMeldDaemonDispatchQueueMessage,
  OpenMeldDaemonProviderAccessEvidence,
  OpenMeldDaemonTaskResultEnvelope,
  RuntimeTransportDeliverDispatchResponse,
  RuntimeTransportDeliveryExecutionIdentity,
  RuntimeTransportDispatchLifecycleSnapshot,
  SpaceThreadContext,
} from "@openmeld/schemas/types";
import { resolveCoreAgentExecutionReadinessForProfile } from "../../agent-execution/application/agent-execution-readiness-service";
import {
  clearAgentExecutionReadinessImpactForExecutionSuccess,
  resolveAcceptedAgentExecutionReadinessImpactReasonCode,
  writeAcceptedAgentExecutionReadinessImpact,
} from "../../agent-execution/infrastructure/postgresql/agent-execution-readiness-impact-repo";
import {
  clearProviderAccessFailureEvidenceForExecutionSuccess,
  writeAcceptedProviderAccessFailureEvidence,
} from "../../agent-execution/infrastructure/postgresql/provider-access-evidence-repo";
import { resolvePermissionModeAdvisoryForDispatch } from "../../agent-profile/application/permission-mode-advisor";
import {
  type AgentProfileBindingRecord,
  readPrimaryAgentProfileBindingRecord,
  readPrimaryAgentProfileBindingRecordByControllerConversation,
  updatePrimaryAgentProfileBindingConversationId,
} from "../../agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import {
  CenterAgentModelResolutionError,
  resolveCenterAgentModelRouteForBinding,
} from "../../center-agent/application/center-agent-model-service";
import { readCenterAgentDesignationRecord } from "../../center-agent/center-agent-repository";
import { readModelCatalog } from "../../config/model-catalog";
import type { CoreBindings } from "../../lib/bindings";
import {
  type CoreLocalComponentsRelease,
  readCoreLocalComponentsRelease,
} from "../../local-components/release-source";
import { resolveLocalComponentUpdateProjection } from "../../local-components/update-projection";
import { summarizeInformationProtectionError } from "../../organizations/organization-information-protection-observability";
import { readOrganizationInformationProtectionPolicyForSpace } from "../../organizations/organization-information-protection-repository";
import {
  readOrganizationWorkingLanguagePreferenceForSpace,
  toWorkingLanguageGuidance,
} from "../../organizations/organization-working-language-repository";
import { readProjectRepositorySettingsRecord } from "../../projects/project-repository";
import { isPersonalRemoteAgentBinding } from "../../remote-agent/application/personal-remote-agent-binding";
import {
  emitSpaceStatusSignal,
  emitSpaceSystemNoticeSignal,
  emitSpaceTextSignal,
} from "../../rpc/space-signal-emitter";
import {
  readRuntimeDeviceDisplayNameByRuntimeId,
  readRuntimeRegistryRecordByRuntimeId,
} from "../../runtime-registry/infrastructure/postgresql/runtime-registry-repo";
import {
  type RuntimeCoordinatorFinalizationSemantic,
  resolveRuntimeCoordinatorFinalizationSemantic,
} from "../../runtime-transport/application/runtime-coordinator-finalization-semantic";
import {
  type DispatchResultInboxRecord,
  updateDispatchResultInboxPublishState,
} from "../../runtime-transport/infrastructure/postgresql/dispatch-result-inbox-repo";
import {
  buildRuntimeCoordinatorCreationDiagnostic,
  readRuntimeCoordinatorExecutionProjectionByDispatch,
  writeRuntimeCoordinatorCreationDiagnostic,
  writeRuntimeCoordinatorExecutionEventFromParts,
  writeRuntimeCoordinatorExecutionProjection,
} from "../../runtime-transport/infrastructure/postgresql/runtime-coordinator-execution-repo";
import { emitCoreFinalVisibleOutcomeRuntimeEvidence } from "../../shared/observability/final-visible-outcome-evidence";
import { CORE_LOG_EVENTS } from "../../shared/observability/log-events";
import type { SpaceBootstrapTimingCollector } from "../../space/application/space-bootstrap-timing";
import { truncateSpaceTextToProtocolLimit } from "../../space/application/space-text";
import type { FinalOutcomeWriteAuthority } from "../../space/application/types";
import { readForgottenDeviceRecord } from "../../start/infrastructure/postgresql/forgotten-device-repo";
import { RUNTIME_TRANSPORT_WAIT_RESULT_TIMEOUT_MS } from "../../strategy-constants";
import { recordAcceptedLocalAiUsage } from "../../usage/local-ai-usage";
import {
  claimFinalReplyEmission,
  claimReplyingHintEmission,
  markDispatchAttemptWaitingForResult,
  markDispatchStatus,
  OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE,
  OPENMELD_DAEMON_DISPATCH_STATE,
  readDispatchAttemptExecutionOwnershipFact,
  recordDispatchAttemptExecutionOwnership,
  rollbackFinalReplyEmissionClaim,
  rollbackReplyingHintEmissionClaim,
  writeOpenMeldDaemonOpsDecision,
} from "../infrastructure/postgresql/dispatch-ledger-postgresql";
import {
  type DispatchTargetProfileIdentity,
  DispatchTargetProfileIdentityUnavailableError,
  resolveDispatchTargetProfileIdentity,
} from "../infrastructure/profile/dispatch-target-profile-identity-adapter";
import {
  buildRuntimeTransportDeliverDispatchRequest,
  deliverRuntimeTransportDispatch,
  waitRuntimeTransportDispatchResult,
} from "../infrastructure/runtime-transport/runtime-coordinator-client";
import {
  acquireRuntimeTransportAgentProfileLegacyConversationMutation,
  lookupRuntimeTransportOwnerService,
  lookupRuntimeTransportRoute,
  releaseRuntimeTransportAgentProfileExecutionTargetMutation,
} from "../infrastructure/runtime-transport/runtime-transport-client";
import { RUNTIME_TASK_DEDUPED_ERROR_CODE } from "../rules/dispatch-error-policy";
import {
  buildReplyingHintText,
  DISPATCH_HINT_SYSTEM_PROFILE_ID,
  DISPATCH_HINT_SYSTEM_PROFILE_NAME,
  DISPATCH_REPLYING_HINT_START_PURPOSE,
} from "../rules/dispatch-hint-policy";
import {
  type ReplyingHintEmissionState,
  type ReplyingHintTransitionHint,
  resolveReplyingHintActivationState,
} from "../rules/replying-hint-lifecycle";
import {
  isRuntimeTaskResultStatusSuccessLike,
  isSuccessfulRuntimeTaskResultPayload,
} from "../rules/runtime-task-result-transition-contract";
import { isDispatchRequestedByAgentOwner } from "./accepted-dispatch-snapshot";
import {
  keepsColleagueConversationOffBinding,
  usesSeparateColleagueConversation,
} from "./colleague-conversation";
import { emitDispatchActivitySignal } from "./dispatch-activity-signal";
import {
  buildDispatchResultRecord,
  buildDispatchResultRef,
  type DispatchPublicationPlan,
  resolveArchivedReplyToSignalId,
  resolveDispatchPublicationPlan,
} from "./dispatch-publication-policy";
import {
  buildCanonicalDispatchReplyMessageEnvelope,
  buildDispatchPublishedAgentProfile,
  buildDispatchReplyContext,
  emitDispatchTextReplySignal,
} from "./dispatch-reply-foundation";
import {
  getDispatchResultByDispatchId,
  writeDispatchResult,
} from "./dispatch-result-service";
import { readDispatchSourceSignalContext } from "./dispatch-source-signal-context";
import {
  buildDispatchContinuationSpaceAccess,
  buildDispatchSystemRequestContext,
  buildDispatchSystemSpaceAccess,
} from "./dispatch-space-access";
import {
  DISPATCH_CONVERSATION_LIFECYCLE_DECISION_CODE,
  DISPATCH_EXECUTION_LIFECYCLE_DECISION_CODE,
  DISPATCH_OPENCLAW_BINDING_DECISION_CODE,
  DISPATCH_RUNTIME_TELEMETRY_DECISION_CODE,
  DISPATCH_RUNTIME_TELEMETRY_MISSING_DECISION_CODE,
  DISPATCH_STREAMING_TELEMETRY_DECISION_CODE,
  DISPATCH_STRUCTURED_ACTION_FAILURE_DECISION_CODE,
} from "./dispatch-trace-decision-codes";
import {
  deviceWaitTargetMatches,
  resolveDeviceWaitReason,
} from "./wake-device-wait";

type RuntimeTransportLookupRouteResult = Awaited<
  ReturnType<typeof lookupRuntimeTransportRoute>
>;
async function measureDispatchTiming<T>(input: {
  description: string;
  name: string;
  read: () => Promise<T> | T;
  timing?: SpaceBootstrapTimingCollector;
}): Promise<T> {
  if (!input.timing) {
    return await input.read();
  }
  return await input.timing.measure(
    {
      description: input.description,
      name: input.name,
    },
    input.read
  );
}
export type AgentTransportSpaceActionDeliveryReceipt = {
  emittedSignal: SignalEnvelope | null;
  finalReplySettled: boolean;
  threadContext?: SpaceThreadContext | null;
};
export type AgentTransportSpaceActionDeliveryInput = {
  agentControllerConversationId: string | null;
  attemptId: string;
  agentControllerRef: string | null;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
  messageEnvelope: MessageEnvelope | null;
  plan: Extract<
    DispatchPublicationPlan,
    {
      kind: "message" | "status" | "system_notice";
    }
  >;
  profileHandle: string | null;
  resultRef: string | null;
  targetOwnerUserId: string;
  targetProfileMentionLabel: string | null;
  targetProfileName: string | null;
  agentControllerConversation: AgentControllerConversationRef | null;
  workingDirectory: string | null;
};
export type AgentTransportSpaceActionDeliveryPort = (
  input: AgentTransportSpaceActionDeliveryInput
) => Promise<AgentTransportSpaceActionDeliveryReceipt>;
export type EffectiveTargetBindingSnapshot = {
  bindingState: "bound" | "missing";
  bindingEnabled: boolean;
  bindingId: string | null;
  configurationRevision?: number | null;
  agentControllerRef: string | null;
  controllerNormalization: {
    bindingUpdatedAtMs: number;
    canonicalAgentControllerRef: string;
    reasonCode: "hosted_runtime_family_controller_canonicalized";
    storedAgentControllerRef: string | null;
    storedAgentControllerRefStatus: "canonical" | "malformed" | "stale";
  } | null;
  ownerUserId: string | null;
  organizationId: string | null;
  runtimeKind:
    | "openmeld_service"
    | "hosted_center_agent"
    | "hosted_remote_agent"
    | null;
  hostedRuntimeIdentity: HostedAgentRuntimeIdentity | null;
  modelRoute?: CenterAgentModelRoute | null;
  openMeldServiceRuntimeId: string | null;
};
export type TargetBindingSource = "core_primary_binding";
type RuntimeDispatchSuccessResult = {
  executionContextId?: string;
  agentControllerConversationId: string | null;
  bootstrapTemplateFacts?: BootstrapTemplateFacts;
  dispatchExecution?: DispatchExecution;
  agentControllerRef: string;
  output: string;
  taskId: string;
  agentControllerConversation?: AgentControllerConversationRef;
  workingDirectory?: string;
};
type SuccessfulOpenMeldDaemonTaskResultPayload = Extract<
  OpenMeldDaemonTaskResultEnvelope["payload"],
  {
    status: "success" | "partial_success";
  }
>;
const isSuccessfulTaskResultPayload = (
  payload: OpenMeldDaemonTaskResultEnvelope["payload"]
): payload is SuccessfulOpenMeldDaemonTaskResultPayload =>
  payload.status === "success" || payload.status === "partial_success";
type PreparedSuccessfulDispatchReply = {
  agentControllerConversationId: string | null;
  agentControllerRef: string;
  replyText: string;
  runtimeResult: RuntimeDispatchSuccessResult;
};
export type DeliveredDispatchContext = {
  correlatedAttemptId: string;
  deliveryStatus: Extract<
    RuntimeTransportDeliverDispatchResponse,
    {
      accepted: true;
    }
  >["status"];
  executionContext: DispatchExecutionContext;
  profileHandle: string | null;
  targetProfileMentionLabel: string | null;
  targetProfileName: string | null;
};
export type DispatchExecutionContext = {
  attemptId: string;
  connectionGeneration: number | null;
  daemonSessionId: string;
  leaseEpoch: number;
  replyingHintActive: boolean;
};
export type DispatchWaitPhaseOutcome = {
  executionContext: DispatchExecutionContext;
  finalizationHandledByRuntimeCoordinator: boolean;
  replyingHintTransitionHint: ReplyingHintTransitionHint | null;
};
type AcceptedDispatchFinalizationResult = {
  publishedSignalId: string | null;
  publishState: "invalid_space_action" | "reply_published";
  status: "already_final" | "finalized";
};
type DispatchExecutionLogBase = {
  attemptId: string;
  dispatchId: string;
  sourceEventId: string;
  targetOwnerUserId: string;
  targetProfileId: string;
  taskId: string;
};
// The Auth owner's authoritative answer that the target profile id no longer
// exists at all. Deliberately NOT set for soft-retired profiles
// (status !== "active"): the Space membership liveness alarm re-verifies
// against Auth before removal, and a disabled profile re-verifies as found —
// its evidence would only be cleared again.
type TargetProfileIdentityVerdict = "not_found";
type ResolvedTargetBindingSnapshotResult =
  | {
      ok: true;
      source: TargetBindingSource;
      snapshot: EffectiveTargetBindingSnapshot;
    }
  | {
      ok: false;
      source: TargetBindingSource;
      errorCode: string;
      errorMessage: string;
      finalStatus:
        | typeof OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable
        | typeof OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal;
      targetOwnerUserId?: string;
      targetProfileIdentityVerdict?: TargetProfileIdentityVerdict;
    };
export type DispatchExecutionPreflightResult =
  | {
      ok: true;
      effectiveTargetBindingSnapshot: EffectiveTargetBindingSnapshot;
      bindingSource: TargetBindingSource;
      deviceWaitReason?:
        | "daemon.profile.offline"
        | "daemon.profile.pending_first_report"
        | "wake.device_wait.readiness_checking";
    }
  | {
      ok: false;
      canonicalAdmissionBlock?: boolean;
      errorCode: string;
      errorMessage: string;
      finalStatus:
        | typeof OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable
        | typeof OPENMELD_DAEMON_DISPATCH_STATE.blocked
        | typeof OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal;
      bindingSource?: TargetBindingSource;
      targetOwnerUserId?: string;
      targetProfileIdentityVerdict?: TargetProfileIdentityVerdict;
    };
type ResolvedAwaitDispatchReplyTargetContext = {
  profileHandle: string | null;
  targetProfileMentionLabel: string | null;
  targetProfileName: string | null;
};
type DispatchExecutionLifecycleDecisionPayload = {
  attemptId: string;
  finalizationTimeoutMs: number;
  lastLifecycleAtMs: number | null;
  phase:
    | "accepted_local"
    | "completed_local"
    | "result_received"
    | "running"
    | "starting";
  phaseEnteredAtMs: number | null;
  progressEvidenceState: "active" | "stalled" | "unknown";
  startTimeoutMs: number;
  taskProgressEvidenceStaleAfterMs: number;
  waitWindowMs: number;
};
type DispatchOpenClawBindingDecisionPayload = {
  attemptId: string;
  bindingSource: "agent_profile" | null;
  classification: "canonical_owned" | "foreign" | "legacy" | "missing";
  upgradeApplied: boolean;
};
type PersistAgentControllerConversationIdResult = {
  bindingSource: "agent_profile" | null;
  updateApplied: boolean;
};
type WaitForDaemonDispatchCompletionResult = {
  lifecycle: RuntimeTransportDispatchLifecycleSnapshot | null;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
};
const AUDIT_UNKNOWN_DAEMON_SESSION_ID = "unknown";
const AUDIT_UNKNOWN_LEASE_EPOCH = -1;
const RUNTIME_ERROR_CODE_PREFIX_RE = /^([a-z0-9][a-z0-9._-]{0,127}):/i;
const DISPATCH_CONTINUITY_WARNING_TEXT_MAX_LENGTH = 220;
export class DispatchExecutionValidationError extends Error {
  readonly code: string;
  readonly executionContext: DispatchExecutionContext | null;
  readonly replyingHintTransitionHint: ReplyingHintTransitionHint | null;
  readonly terminalReplySettled: boolean;
  readonly waitDurationMs: number | null;
  readonly waitReasonCode: string | null;
  constructor(input: {
    code: string;
    message: string;
    executionContext?: DispatchExecutionContext | null;
    replyingHintTransitionHint?: ReplyingHintTransitionHint | null;
    terminalReplySettled?: boolean;
    waitDurationMs?: number | null;
    waitReasonCode?: string | null;
  }) {
    super(input.message);
    this.code = input.code;
    this.executionContext = input.executionContext ?? null;
    this.replyingHintTransitionHint = input.replyingHintTransitionHint ?? null;
    this.terminalReplySettled = input.terminalReplySettled === true;
    this.waitDurationMs =
      typeof input.waitDurationMs === "number" &&
      Number.isFinite(input.waitDurationMs)
        ? Math.max(0, Math.trunc(input.waitDurationMs))
        : null;
    this.waitReasonCode = normalizeOptionalText(input.waitReasonCode);
    this.name = "DispatchExecutionValidationError";
  }
}
const resolveTerminalReplyingHintTransitionHint = (
  executionContext?: DispatchExecutionContext | null
): ReplyingHintTransitionHint | null => {
  return executionContext?.replyingHintActive === true
    ? "clear_for_terminal_reply"
    : null;
};
const buildDispatchExecutionValidationError = (input: {
  code: string;
  message: string;
  executionContext?: DispatchExecutionContext | null;
  replyingHintTransitionHint?: ReplyingHintTransitionHint | null;
  terminalReplySettled?: boolean;
  waitDurationMs?: number | null;
  waitReasonCode?: string | null;
}): DispatchExecutionValidationError => {
  return new DispatchExecutionValidationError({
    code: input.code,
    message: input.message,
    executionContext: input.executionContext,
    replyingHintTransitionHint:
      input.replyingHintTransitionHint === undefined
        ? resolveTerminalReplyingHintTransitionHint(input.executionContext)
        : input.replyingHintTransitionHint,
    terminalReplySettled: input.terminalReplySettled,
    waitDurationMs: input.waitDurationMs,
    waitReasonCode: input.waitReasonCode,
  });
};
// Physical DB split: dispatch reads/writes that target LOCAL-STATE tables must
// run on the local-state binding, not the wake-evidence handle threaded as `db`.
// Resolve the guarded handle once per entry function and thread it down.
const resolveLocalStateDbHandleOrThrow = (
  env: CoreBindings,
  executionContext: DispatchExecutionContext
): PostgresDatabase => {
  const localStateDbHandle = getPostgresDatabase(env);
  if (!localStateDbHandle) {
    throw buildDispatchExecutionValidationError({
      code: "dispatch.storage.schema_missing",
      message: "OPENMELD_POSTGRESQL binding is not configured",
      executionContext,
    });
  }
  return localStateDbHandle;
};

async function assertProjectWorkRepositoryAvailable(input: {
  env: CoreBindings;
  executionContext: DispatchExecutionContext;
  message: OpenMeldDaemonDispatchQueueMessage;
}): Promise<void> {
  const assignment = input.message.executionContext;
  const selected = assignment?.projectWork;
  if (!selected) {
    return;
  }
  const organizationId = assignment.scope.organizationId;
  if (!organizationId || input.message.organizationId !== organizationId) {
    throw buildDispatchExecutionValidationError({
      code: "project.repository_scope_mismatch",
      message: "The selected Project does not match this work's Organization.",
      executionContext: input.executionContext,
    });
  }
  const db = getPostgresDatabase(input.env);
  if (!db) {
    throw buildDispatchExecutionValidationError({
      code: "project.store_unavailable",
      message: "Project repository selection is unavailable.",
      executionContext: input.executionContext,
    });
  }
  const settings = await readProjectRepositorySettingsRecord({
    db,
    organizationId,
    projectId: selected.projectId,
  });
  if (
    !(
      settings &&
      (settings.legacyDefaultFingerprint === selected.repositoryFingerprint ||
        settings.repositories.some(
          (repository) =>
            repository.repositoryFingerprint === selected.repositoryFingerprint
        ))
    )
  ) {
    throw buildDispatchExecutionValidationError({
      code: "project.repository_unavailable",
      message:
        "The selected repository is no longer associated with this Project. Choose a current repository before starting work.",
      executionContext: input.executionContext,
    });
  }
}
export const deliverDispatchMessageToDaemon = async (input: {
  acceptedDispatchSnapshot?: OpenMeldDaemonAcceptedDispatchSnapshot;
  attemptId: string;
  db: PostgresDatabase;
  env: CoreBindings;
  message: OpenMeldDaemonDispatchQueueMessage;
  targetOwnerUserId: string;
  timing?: SpaceBootstrapTimingCollector;
}): Promise<DeliveredDispatchContext> => {
  const executionLogBase = {
    attemptId: input.attemptId,
    dispatchId: input.message.dispatchId,
    sourceEventId: input.message.sourceEventId,
    targetOwnerUserId: input.targetOwnerUserId,
    targetProfileId: input.message.targetProfileId,
    taskId: input.message.taskId,
  };
  const resolveExecutionContextFromRoute = (
    route: RuntimeTransportLookupRouteResult
  ): DispatchExecutionContext => {
    const daemonSessionId =
      "daemonSessionId" in route
        ? normalizeOptionalText(route.daemonSessionId)
        : null;
    const connectionGeneration =
      "connectionGeneration" in route &&
      Number.isInteger(route.connectionGeneration) &&
      route.connectionGeneration > 0
        ? route.connectionGeneration
        : null;
    const leaseEpoch =
      "leaseEpoch" in route &&
      Number.isInteger(route.leaseEpoch) &&
      route.leaseEpoch > 0
        ? route.leaseEpoch
        : null;
    return {
      attemptId: input.attemptId,
      connectionGeneration,
      daemonSessionId: daemonSessionId ?? AUDIT_UNKNOWN_DAEMON_SESSION_ID,
      leaseEpoch: leaseEpoch ?? AUDIT_UNKNOWN_LEASE_EPOCH,
      replyingHintActive: false,
    };
  };
  const sourceSignal = await measureDispatchTiming({
    description: "Read the source signal context for delivery",
    name: "openmeld_dispatch_deliver_source_signal",
    read: () =>
      readDispatchSourceSignalContext({
        message: input.message,
      }),
    timing: input.timing,
  });
  const targetProfileNameSnapshot = normalizeOptionalText(
    input.message.targetProfileNameSnapshot
  );
  const targetProfileMentionLabelSnapshot = normalizeOptionalText(
    input.message.targetProfileMentionLabel
  );
  const routeLookupStartedAtMs = Date.now();
  const route = await measureDispatchTiming({
    description: "Look up the current RuntimeTransport route",
    name: "openmeld_dispatch_route",
    read: () =>
      lookupRuntimeTransportRoute({
        env: input.env,
        ownerUserId: input.targetOwnerUserId,
        profileId: input.message.targetProfileId,
      }),
    timing: input.timing,
  });
  const routeExecutionContext = resolveExecutionContextFromRoute(route);
  const localStateDbHandle = resolveLocalStateDbHandleOrThrow(
    input.env,
    routeExecutionContext
  );
  console.info("[core.openMeldDaemon.dispatch_execution.route_resolved]", {
    event: CORE_LOG_EVENTS.dispatchExecutionRouteResolved,
    ...executionLogBase,
    connectionGeneration: routeExecutionContext.connectionGeneration,
    daemonSessionId: routeExecutionContext.daemonSessionId,
    durationMs: Date.now() - routeLookupStartedAtMs,
    leaseEpoch: routeExecutionContext.leaseEpoch,
    online: route.online,
    reasonCode: route.online ? null : route.reasonCode,
  });
  if (!route.online) {
    const serviceUpdateBlocker = await measureDispatchTiming({
      description:
        "Check whether an offline route is blocked by service update",
      name: "openmeld_dispatch_deliver_offline_service_update",
      read: () =>
        resolveOfflineRouteServiceUpdateBlocker({
          db: localStateDbHandle,
          env: input.env,
          ownerUserId: input.targetOwnerUserId,
          targetProfileId: input.message.targetProfileId,
        }),
      timing: input.timing,
    });
    if (serviceUpdateBlocker) {
      console.warn(
        "[core.openMeldDaemon.dispatch_execution.service_update_required]",
        {
          event:
            "core.openMeldDaemon.dispatch_execution.service_update_required",
          ...executionLogBase,
          connectionGeneration: routeExecutionContext.connectionGeneration,
          daemonSessionId: routeExecutionContext.daemonSessionId,
          expectedEpoch: serviceUpdateBlocker.expectedEpoch,
          leaseEpoch: routeExecutionContext.leaseEpoch,
          observedEpoch: serviceUpdateBlocker.observedEpoch,
          reasonCode: serviceUpdateBlocker.reasonCode,
        }
      );
      await recordRuntimeCoordinatorCreationDiagnosticForMessage({
        attemptId: input.attemptId,
        db: input.db,
        message: input.message,
        reasonCode: "service.update_required",
      });
      throw buildDispatchExecutionValidationError({
        code: "service.update_required",
        message: `OpenMeld Service update is required: ${serviceUpdateBlocker.reasonCode}`,
        executionContext: routeExecutionContext,
        waitReasonCode: serviceUpdateBlocker.reasonCode,
      });
    }
    console.warn("[core.openMeldDaemon.dispatch_execution.route_blocked]", {
      event: CORE_LOG_EVENTS.dispatchExecutionRouteBlocked,
      ...executionLogBase,
      connectionGeneration: routeExecutionContext.connectionGeneration,
      daemonSessionId: routeExecutionContext.daemonSessionId,
      leaseEpoch: routeExecutionContext.leaseEpoch,
      reasonCode: route.reasonCode,
    });
    await recordRuntimeCoordinatorCreationDiagnosticForMessage({
      attemptId: input.attemptId,
      db: input.db,
      message: input.message,
      reasonCode: normalizeRuntimeTransportRouteErrorCode(route.reasonCode),
    });
    throw buildDispatchExecutionValidationError({
      code: normalizeRuntimeTransportRouteErrorCode(route.reasonCode),
      message: `daemon route is offline: ${route.reasonCode}`,
      executionContext: routeExecutionContext,
    });
  }
  if (route.acceptingDispatches === false) {
    console.info("[core.openMeldDaemon.dispatch_execution.service_draining]", {
      event: "core.openMeldDaemon.dispatch_execution.service_draining",
      ...executionLogBase,
      connectionGeneration: routeExecutionContext.connectionGeneration,
      daemonSessionId: routeExecutionContext.daemonSessionId,
      leaseEpoch: routeExecutionContext.leaseEpoch,
      reasonCode: "daemon.service.draining",
    });
    await recordRuntimeCoordinatorCreationDiagnosticForMessage({
      attemptId: input.attemptId,
      db: input.db,
      message: input.message,
      reasonCode: "daemon.service.draining",
    });
    throw buildDispatchExecutionValidationError({
      code: "daemon.service.draining",
      message:
        "OpenMeld Service is finishing accepted local agent work before a controlled restart.",
      executionContext: routeExecutionContext,
      waitReasonCode: "controlled_service_update",
    });
  }
  const localComponentsRelease = await readCoreLocalComponentsRelease(
    input.env.OPENMELD_CLI_RELEASES
  );
  try {
    await measureDispatchTiming({
      description: "Validate RuntimeTransport route execution compatibility",
      name: "openmeld_dispatch_deliver_route_guards",
      read: () => {
        assertDaemonRouteExecutionCompatible({
          executionContext: routeExecutionContext,
          executionLogBase,
          route,
        });
        assertDaemonRouteLocalComponentsCurrent({
          executionContext: routeExecutionContext,
          executionLogBase,
          localComponentsRelease,
          route,
        });
        assertDaemonRouteExecutionContextCapable({
          message: input.message,
          route,
          executionContext: routeExecutionContext,
        });
      },
      timing: input.timing,
    });
  } catch (error) {
    await recordRuntimeCoordinatorCreationDiagnosticForMessage({
      attemptId: input.attemptId,
      db: input.db,
      message: input.message,
      reasonCode: resolveDispatchExecutionErrorCode(error),
    });
    throw error;
  }
  if (typeof route.deviceId === "string" && route.deviceId.trim()) {
    const forgottenDevice = await measureDispatchTiming({
      description: "Check whether the route device was forgotten",
      name: "openmeld_dispatch_deliver_forgotten_device",
      read: () =>
        readForgottenDeviceRecord({
          db: localStateDbHandle,
          userId: input.targetOwnerUserId,
          deviceId: route.deviceId,
        }),
      timing: input.timing,
    });
    if (forgottenDevice) {
      console.warn("[core.current_device.forgotten_dispatch_blocked]", {
        event: "current_device.forgotten_dispatch_blocked",
        ...executionLogBase,
        connectionGeneration: routeExecutionContext.connectionGeneration,
        daemonSessionId: routeExecutionContext.daemonSessionId,
        deviceId: route.deviceId,
        leaseEpoch: routeExecutionContext.leaseEpoch,
      });
      await recordRuntimeCoordinatorCreationDiagnosticForMessage({
        attemptId: input.attemptId,
        db: input.db,
        message: input.message,
        reasonCode: "daemon.profile.offline",
      });
      throw buildDispatchExecutionValidationError({
        code: "daemon.profile.offline",
        message: "daemon route is offline: device.forgotten",
        executionContext: routeExecutionContext,
      });
    }
  }
  const primaryBindingResolution = await measureDispatchTiming({
    description: "Verify the route matches the Core primary Binding",
    name: "openmeld_dispatch_deliver_binding_match",
    read: () =>
      assertDaemonRouteMatchesPrimaryBinding({
        acceptedDispatchSnapshot: input.acceptedDispatchSnapshot,
        db: localStateDbHandle,
        executionContext: routeExecutionContext,
        executionLogBase,
        message: input.message,
        ownerUserId: input.targetOwnerUserId,
        route,
        spaceId: input.message.spaceId,
        targetProfileId: input.message.targetProfileId,
      }),
    timing: input.timing,
  }).catch(async (error) => {
    await recordRuntimeCoordinatorCreationDiagnosticForMessage({
      attemptId: input.attemptId,
      db: input.db,
      message: input.message,
      reasonCode: resolveDispatchExecutionErrorCode(error),
    });
    throw error;
  });
  const targetProfileIdentity = await measureDispatchTiming({
    description: "Resolve target profile identity for delivery",
    name: "openmeld_dispatch_deliver_profile_identity",
    read: () =>
      resolveDispatchTargetProfileIdentityOrThrowValidationError({
        authRpc: input.env.OPENMELD_AUTH_WORKER,
        executionContext: routeExecutionContext,
        logContext: {
          dispatchId: input.message.dispatchId,
          source: "dispatch_execution_preflight",
          targetProfileId: input.message.targetProfileId,
        },
        targetProfileId: input.message.targetProfileId,
      }),
    timing: input.timing,
  });
  const profileHandle = targetProfileIdentity.profileHandle;
  const targetProfileMentionLabel =
    targetProfileMentionLabelSnapshot ??
    resolveSingleSpaceMentionLabels({
      profileId: input.message.targetProfileId,
      profileName:
        targetProfileNameSnapshot ?? targetProfileIdentity.profileName,
    }).primaryMentionLabel;
  const targetProfileName =
    targetProfileNameSnapshot ?? targetProfileIdentity.profileName;
  const targetProfileIsCenterAgent = await measureDispatchTiming({
    description:
      "Resolve whether the target profile is the current Center Agent",
    name: "openmeld_dispatch_deliver_center_agent_designation",
    read: () =>
      resolveTargetProfileIsCurrentCenterAgent({
        bindingId: primaryBindingResolution.binding.bindingId,
        db: localStateDbHandle,
        env: input.env,
        executionLogBase,
        message: input.message,
      }),
    timing: input.timing,
  });
  const organizationProtectedInformation =
    route.capabilities.informationProtectionPrompt === true
      ? await readOrganizationInformationProtectionPolicyForSpace({
          db: localStateDbHandle,
          spaceId: input.message.spaceId,
        })
          .then((policy) => {
            if (!policy) {
              console.warn(
                "[core.openMeldDaemon.dispatch_execution.information_protection_scope_unavailable]",
                {
                  event:
                    "core.openMeldDaemon.dispatch_execution.information_protection_scope_unavailable",
                  ...executionLogBase,
                }
              );
              return null;
            }
            return policy.protectedInformation;
          })
          .catch((error) => {
            console.warn(
              "[core.openMeldDaemon.dispatch_execution.information_protection_policy_unavailable]",
              {
                event:
                  "core.openMeldDaemon.dispatch_execution.information_protection_policy_unavailable",
                ...executionLogBase,
                error: summarizeInformationProtectionError(error),
              }
            );
            return null;
          })
      : null;
  const workingLanguage =
    route.capabilities.workingLanguagePrompt === true
      ? await readOrganizationWorkingLanguagePreferenceForSpace({
          db: localStateDbHandle,
          spaceId: input.message.spaceId,
        })
          .then((preference) =>
            preference ? toWorkingLanguageGuidance(preference) : null
          )
          .catch((error) => {
            console.warn(
              "[core.openMeldDaemon.dispatch_execution.working_language_unavailable]",
              {
                event:
                  "core.openMeldDaemon.dispatch_execution.working_language_unavailable",
                ...executionLogBase,
                error: summarizeInformationProtectionError(error),
              }
            );
            return null;
          })
      : null;
  await assertProjectWorkRepositoryAvailable({
    env: input.env,
    executionContext: resolveExecutionContextFromRoute(route),
    message: input.message,
  });
  const { permissionModeAdvisory, requesterIsAgentOwner } =
    await resolveDispatchRequesterContext({
      binding: primaryBindingResolution.binding,
      db: localStateDbHandle,
      env: input.env,
      executionLogBase,
      message: input.message,
      route,
      targetOwnerUserId: input.targetOwnerUserId,
      timing: input.timing,
    });
  const bindingConversation = await resolveDeliveredBindingConversation({
    binding: primaryBindingResolution.binding,
    env: input.env,
    executionContext: resolveExecutionContextFromRoute(route),
    message: input.message,
    requesterIsAgentOwner,
    route,
    targetOwnerUserId: input.targetOwnerUserId,
  });
  const deliverRequest = await measureDispatchTiming({
    description: "Build the RuntimeTransport delivery request",
    name: "openmeld_dispatch_deliver_request_build",
    read: async () =>
      buildRuntimeTransportDeliverDispatchRequest({
        attemptId: input.attemptId,
        agentControllerConversationId:
          bindingConversation.agentControllerConversationId,
        ownerUserId: input.targetOwnerUserId,
        route,
        executionIdentity: primaryBindingResolution.executionIdentity,
        defaultProjectId: targetProfileIdentity.defaultProjectId,
        message: input.message,
        organizationProtectedInformation,
        workingLanguage,
        permissionModeAdvisory,
        requesterIsAgentOwner,
        separateRequesterConversation:
          bindingConversation.separateRequesterConversation,
        sourceSignal,
        targetProfileIsCenterAgent,
        targetProfileMentionLabel,
        targetProfileName,
      }),
    timing: input.timing,
  });
  await measureDispatchTiming({
    description: "Record dispatch attempt execution ownership",
    name: "openmeld_dispatch_deliver_ownership_record",
    read: () =>
      recordDispatchAttemptExecutionOwnership({
        attemptId: input.attemptId,
        connectionGeneration: route.connectionGeneration,
        daemonSessionId: route.daemonSessionId,
        db: input.db,
        dispatchId: input.message.dispatchId,
        leaseEpoch: route.leaseEpoch,
        nowMs: Date.now(),
        targetProfileId: input.message.targetProfileId,
        taskId: input.message.taskId,
        executionIdentity: primaryBindingResolution.executionIdentity,
      }),
    timing: input.timing,
  });
  const deliverStartedAtMs = Date.now();
  const deliverResult = await measureDispatchTiming({
    description: "Deliver the dispatch to RuntimeTransport",
    name: "openmeld_dispatch_deliver",
    read: () =>
      deliverRuntimeTransportDispatch({
        env: input.env,
        ownerUserId: input.targetOwnerUserId,
        dispatch: deliverRequest,
        timing: input.timing,
      }),
    timing: input.timing,
  });
  console.info("[core.openMeldDaemon.dispatch_execution.daemon_delivered]", {
    event: CORE_LOG_EVENTS.dispatchExecutionDaemonDelivered,
    ...executionLogBase,
    connectionGeneration: routeExecutionContext.connectionGeneration,
    daemonSessionId: routeExecutionContext.daemonSessionId,
    deliveryRecoveryReason: input.message.deliveryRecoveryReason ?? null,
    durationMs: Date.now() - deliverStartedAtMs,
    leaseEpoch: routeExecutionContext.leaseEpoch,
    reasonCode: deliverResult.accepted
      ? null
      : (deliverResult.reasonCode ?? "unknown"),
    accepted: deliverResult.accepted,
    deliveryStatus: deliverResult.status,
  });
  if (!deliverResult.accepted) {
    throw buildDispatchExecutionValidationError({
      code: normalizeRuntimeTransportDeliveryErrorCode(
        deliverResult.reasonCode
      ),
      message: `daemon delivery rejected: ${deliverResult.reasonCode ?? "unknown"}`,
      executionContext: routeExecutionContext,
    });
  }
  const correlatedAttemptId = resolveDeliveredCorrelatedAttemptId({
    deliverResult,
    requestedAttemptId: input.attemptId,
  });
  return {
    correlatedAttemptId,
    deliveryStatus: deliverResult.status,
    executionContext: buildDispatchExecutionContext({
      attemptId: correlatedAttemptId,
      connectionGeneration: route.connectionGeneration,
      daemonSessionId: route.daemonSessionId,
      leaseEpoch: route.leaseEpoch,
    }),
    profileHandle,
    targetProfileMentionLabel,
    targetProfileName,
  };
};
const recordRuntimeCoordinatorCreationDiagnosticForMessage = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  message: OpenMeldDaemonDispatchQueueMessage;
  reasonCode: string;
}): Promise<void> => {
  try {
    await writeRuntimeCoordinatorCreationDiagnostic({
      db: input.db,
      diagnostic: buildRuntimeCoordinatorCreationDiagnostic({
        dispatchId: input.message.dispatchId,
        legacyAttemptId: input.attemptId,
        observedAtMs: Date.now(),
        reasonCode: input.reasonCode,
        sourceClientMessageId: input.message.sourceClientMessageId ?? null,
        spaceId: input.message.spaceId,
        targetProfileId: input.message.targetProfileId,
      }),
    });
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.runtime_coordinator.creation_diagnostic_failed]",
      {
        attemptId: input.attemptId,
        dispatchId: input.message.dispatchId,
        error: toErrorMessage(error),
        reasonCode: input.reasonCode,
        targetProfileId: input.message.targetProfileId,
      }
    );
  }
};
const resolveDeliveredCorrelatedAttemptId = (input: {
  deliverResult: Extract<
    RuntimeTransportDeliverDispatchResponse,
    {
      accepted: true;
    }
  >;
  requestedAttemptId: string;
}): string => {
  switch (input.deliverResult.status) {
    case "already_pending":
      return input.deliverResult.existingAttemptId;
    case "already_completed":
      return input.deliverResult.completedAttemptId;
    case "delivered":
      return input.requestedAttemptId;
    default:
      return input.requestedAttemptId;
  }
};
type OnlineRuntimeTransportRoute = Extract<
  RuntimeTransportLookupRouteResult,
  {
    online: true;
  }
>;
/** Core's requester projection for this Wake and the advisory it allows. */
/**
 * The Binding conversation this delivery resumes. A colleague's Wake on a
 * harness without Execution Contexts resumes none and starts its own
 * (member-agent-program.md §4.3); a Service that cannot keep it separate
 * would resume the owner's, so it is refused.
 */
const resolveDeliveredBindingConversation = async (input: {
  binding: AgentProfileBindingRecord;
  env: CoreBindings;
  executionContext: DispatchExecutionContext;
  message: OpenMeldDaemonDispatchQueueMessage;
  requesterIsAgentOwner: boolean | undefined;
  route: OnlineRuntimeTransportRoute;
  targetOwnerUserId: string;
}): Promise<{
  agentControllerConversationId: string | null;
  separateRequesterConversation: boolean;
}> => {
  const separate = await usesSeparateColleagueConversation({
    agentControllerRef: input.binding.agentControllerRef,
    env: input.env,
    message: input.message,
    requesterIsAgentOwner: input.requesterIsAgentOwner,
    targetOwnerUserId: input.targetOwnerUserId,
  });
  if (!separate) {
    return {
      agentControllerConversationId:
        input.binding.agentControllerConversationId ?? null,
      separateRequesterConversation: false,
    };
  }
  if (input.route.capabilities.requesterConversationIsolation !== true) {
    throw buildDispatchExecutionValidationError({
      code: "agent_access.conversation_isolation_unsupported",
      message:
        "Update OpenMeld on the Agent owner's computer before colleagues use this Agent.",
      executionContext: input.executionContext,
    });
  }
  return {
    agentControllerConversationId: null,
    separateRequesterConversation: true,
  };
};
const resolveDispatchRequesterContext = async (
  input: Omit<
    Parameters<typeof readDispatchPermissionModeAdvisory>[0],
    "requesterIsAgentOwner"
  > & { env: CoreBindings }
): Promise<{
  permissionModeAdvisory: PermissionModeAdvisory | null;
  requesterIsAgentOwner: boolean | undefined;
}> => {
  const requesterIsAgentOwner = input.route.capabilities
    .verifiedRequesterContext
    ? await isDispatchRequestedByAgentOwner({
        env: input.env,
        message: input.message,
        targetOwnerUserId: input.targetOwnerUserId,
      })
    : undefined;
  return {
    permissionModeAdvisory: await readDispatchPermissionModeAdvisory({
      ...input,
      requesterIsAgentOwner,
    }),
    requesterIsAgentOwner,
  };
};

/**
 * Permission-mode advisor: only an owner-requested Wake on a Service that
 * renders the block may carry it. Advice is optional guidance, so its
 * failure never blocks the Wake.
 */
const readDispatchPermissionModeAdvisory = async (input: {
  binding: AgentProfileBindingRecord;
  db: PostgresDatabase;
  executionLogBase: DispatchExecutionLogBase;
  message: OpenMeldDaemonDispatchQueueMessage;
  requesterIsAgentOwner: boolean | undefined;
  route: OnlineRuntimeTransportRoute;
  targetOwnerUserId: string;
  timing?: SpaceBootstrapTimingCollector;
}): Promise<PermissionModeAdvisory | null> => {
  const organizationId = input.message.organizationId;
  if (
    !(
      input.route.capabilities.permissionModeAdvisoryPrompt === true &&
      input.requesterIsAgentOwner === true &&
      organizationId
    )
  ) {
    return null;
  }
  return await measureDispatchTiming({
    description: "Resolve the permission-mode advisory",
    name: "openmeld_dispatch_deliver_permission_mode_advisory",
    read: () =>
      resolvePermissionModeAdvisoryForDispatch({
        agentControllerRef: input.binding.agentControllerRef,
        agentProfileId: input.message.targetProfileId,
        db: input.db,
        dispatchId: input.message.dispatchId,
        nowMs: Date.now(),
        organizationId,
        ownerUserId: input.targetOwnerUserId,
        requesterIsAgentOwner: input.requesterIsAgentOwner,
        savedPermissionMode: input.binding.agentControllerPermissionMode,
      }),
    timing: input.timing,
  }).catch((error) => {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.permission_mode_advisory_unavailable]",
      {
        event:
          "core.openMeldDaemon.dispatch_execution.permission_mode_advisory_unavailable",
        ...input.executionLogBase,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return null;
  });
};
const assertDaemonRouteMatchesPrimaryBinding = async (input: {
  acceptedDispatchSnapshot?: OpenMeldDaemonAcceptedDispatchSnapshot;
  db: PostgresDatabase;
  executionContext: DispatchExecutionContext;
  executionLogBase: DispatchExecutionLogBase;
  message: OpenMeldDaemonDispatchQueueMessage;
  ownerUserId: string;
  route: OnlineRuntimeTransportRoute;
  spaceId: string;
  targetProfileId: string;
}): Promise<{
  binding: AgentProfileBindingRecord;
  executionIdentity: RuntimeTransportDeliveryExecutionIdentity;
}> => {
  const binding = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.targetProfileId,
    db: input.db,
    owner: {
      id: input.ownerUserId,
      kind: "owner_account",
    },
  });
  if (!binding) {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.primary_binding_missing]",
      {
        event: "core.openMeldDaemon.dispatch_execution.primary_binding_missing",
        ...input.executionLogBase,
        connectionGeneration: input.executionContext.connectionGeneration,
        daemonSessionId: input.executionContext.daemonSessionId,
        leaseEpoch: input.executionContext.leaseEpoch,
      }
    );
    throw buildDispatchExecutionValidationError({
      code: "agent_profile_binding.missing",
      message: "target profile has no Core primary binding",
      executionContext: input.executionContext,
    });
  }
  if (binding.bindingState !== "enabled_primary") {
    throw buildDispatchExecutionValidationError({
      code: "agent_profile_binding.disabled",
      message: `target profile Core primary binding is ${binding.bindingState}`,
      executionContext: input.executionContext,
    });
  }
  const acceptedControllerSnapshot =
    input.acceptedDispatchSnapshot?.controllerSnapshot ??
    input.message.controllerSnapshot;
  const acceptedBindingId = normalizeOptionalText(
    acceptedControllerSnapshot.bindingId
  );
  const acceptedOpenMeldServiceRuntimeId = normalizeOptionalText(
    input.acceptedDispatchSnapshot?.openMeldServiceRuntimeId
  );
  const acceptedAgentControllerRef = normalizeOptionalText(
    acceptedControllerSnapshot.agentControllerRef
  );
  const acceptedIdentityMismatch =
    (acceptedBindingId && acceptedBindingId !== binding.bindingId) ||
    (acceptedOpenMeldServiceRuntimeId &&
      acceptedOpenMeldServiceRuntimeId !== binding.openMeldServiceRuntimeId) ||
    (acceptedAgentControllerRef &&
      parseAgentControllerRef(acceptedAgentControllerRef)?.ref !==
        parseAgentControllerRef(binding.agentControllerRef)?.ref);
  if (acceptedIdentityMismatch) {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.accepted_binding_identity_mismatch]",
      {
        acceptedAgentControllerRef,
        acceptedBindingId,
        acceptedOpenMeldServiceRuntimeId,
        bindingAgentControllerRef: binding.agentControllerRef,
        bindingId: binding.bindingId,
        bindingOpenMeldServiceRuntimeId: binding.openMeldServiceRuntimeId,
        event:
          "core.openMeldDaemon.dispatch_execution.accepted_binding_identity_mismatch",
        ...input.executionLogBase,
      }
    );
    throw buildDispatchExecutionValidationError({
      code: "local_service.identity_mismatch",
      message:
        "current Core primary Binding does not match the RuntimeCoordinator accepted execution identity",
      executionContext: input.executionContext,
    });
  }
  const agentControllerRef = parseAgentControllerRef(
    binding.agentControllerRef
  );
  if (!agentControllerRef) {
    throw buildDispatchExecutionValidationError({
      code: "agent_profile_binding.agent_controller_report_invalid",
      message:
        "target profile Core primary binding has an invalid agentControllerRef",
      executionContext: input.executionContext,
    });
  }
  const runtimeResult = await readRuntimeRegistryRecordByRuntimeId({
    db: input.db,
    openMeldServiceRuntimeId:
      acceptedOpenMeldServiceRuntimeId ?? binding.openMeldServiceRuntimeId,
  });
  if (runtimeResult.status !== "found") {
    throw buildDispatchExecutionValidationError({
      code: "agent_profile_binding.agent_controller_report_missing",
      message: `target profile Core primary binding runtime is ${runtimeResult.status}`,
      executionContext: input.executionContext,
    });
  }
  const openMeldServiceRuntimeIdentity =
    runtimeResult.record.runtimeLookupInput;
  if (
    openMeldServiceRuntimeIdentity.owner.kind !== "owner_account" ||
    openMeldServiceRuntimeIdentity.owner.id !== input.ownerUserId ||
    openMeldServiceRuntimeIdentity.deviceId !== input.route.deviceId ||
    openMeldServiceRuntimeIdentity.lane !== input.route.lane
  ) {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.primary_binding_route_mismatch]",
      {
        event:
          "core.openMeldDaemon.dispatch_execution.primary_binding_route_mismatch",
        ...input.executionLogBase,
        bindingRuntimeDeviceId: openMeldServiceRuntimeIdentity.deviceId,
        bindingRuntimeLane: openMeldServiceRuntimeIdentity.lane,
        bindingRuntimeOwnerId: openMeldServiceRuntimeIdentity.owner.id,
        bindingRuntimeOwnerKind: openMeldServiceRuntimeIdentity.owner.kind,
        connectionGeneration: input.executionContext.connectionGeneration,
        daemonRouteDeviceId: input.route.deviceId,
        daemonRouteLane: input.route.lane,
        daemonSessionId: input.executionContext.daemonSessionId,
        leaseEpoch: input.executionContext.leaseEpoch,
      }
    );
    throw buildDispatchExecutionValidationError({
      code: "local_service.identity_mismatch",
      message:
        "daemon route does not match the target profile Core primary binding runtime identity",
      executionContext: input.executionContext,
    });
  }
  assertDaemonRouteHasLiveBindingCapability({
    bindingAgentControllerRef:
      acceptedAgentControllerRef ?? binding.agentControllerRef,
    executionContext: input.executionContext,
    executionLogBase: input.executionLogBase,
    route: input.route,
  });
  return {
    binding,
    executionIdentity: {
      authority: "core_runtime_registry_binding_route",
      core: {
        modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
        spaceId: input.spaceId,
        dispatchId: input.executionLogBase.dispatchId,
        targetProfileId: input.targetProfileId,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value:
            acceptedOpenMeldServiceRuntimeId ??
            binding.openMeldServiceRuntimeId,
        },
        bindingId: acceptedBindingId ?? binding.bindingId,
        agentControllerRef:
          acceptedAgentControllerRef ?? binding.agentControllerRef,
      },
    },
  };
};
const assertDaemonRouteHasLiveBindingCapability = (input: {
  bindingAgentControllerRef: string;
  executionContext: DispatchExecutionContext;
  executionLogBase: DispatchExecutionLogBase;
  route: OnlineRuntimeTransportRoute;
}): void => {
  const agentControllerRef = parseAgentControllerRef(
    input.bindingAgentControllerRef
  );
  if (!agentControllerRef) {
    throw buildDispatchExecutionValidationError({
      code: "agent_profile_binding.agent_controller_report_invalid",
      message:
        "target profile Core primary binding has an invalid agentControllerRef",
      executionContext: input.executionContext,
    });
  }
  const runtimeAdapters = input.route.capabilities.runtimeAdapters ?? [];
  if (
    hasRuntimeAdapterCapabilityForRef({
      agentControllerRef: agentControllerRef.ref,
      runtimeAdapters,
    })
  ) {
    return;
  }
  console.warn(
    "[core.openMeldDaemon.dispatch_execution.live_capability_missing]",
    {
      event: "core.openMeldDaemon.dispatch_execution.live_capability_missing",
      ...input.executionLogBase,
      bindingAgentControllerRef: input.bindingAgentControllerRef,
      connectionGeneration: input.executionContext.connectionGeneration,
      daemonSessionId: input.executionContext.daemonSessionId,
      leaseEpoch: input.executionContext.leaseEpoch,
      runtimeAdapterCount: runtimeAdapters.length,
    }
  );
  throw buildDispatchExecutionValidationError({
    code: "agent_profile_binding.agent_controller_report_missing",
    message:
      "daemon route does not currently report the bound execution target",
    executionContext: input.executionContext,
  });
};
function assertDaemonRouteExecutionContextCapable(input: {
  message: OpenMeldDaemonDispatchQueueMessage;
  route: OnlineRuntimeTransportRoute;
  executionContext: DispatchExecutionContext;
}): void {
  if (
    input.message.sourceSignalSnapshot?.workHandoff?.files.length &&
    input.route.capabilities.spaceWorkHandoff !== true
  ) {
    throw buildDispatchExecutionValidationError({
      code: "service.update_required",
      message:
        "Update this Computer's OpenMeld Service before handing off selected files.",
      executionContext: input.executionContext,
      waitReasonCode: "space_work_handoff_unsupported",
    });
  }
  if (!input.message.executionContext) {
    return;
  }
  const adapterId = parseAgentControllerRef(
    input.message.controllerSnapshot.agentControllerRef
  )?.id;
  let requiredExecutionContextVersion = 1;
  if (input.message.executionContext.workspaceDefault) {
    // Core sends the hint only to a Service that resolves it.
    requiredExecutionContextVersion = 7;
  } else if (
    input.message.executionContext.folderId ||
    input.message.executionContext.forkSource?.folderId
  ) {
    requiredExecutionContextVersion = 6;
  } else if (
    input.message.executionContext.projectWork?.commit ||
    input.message.sourceSignalSnapshot?.workHandoff?.schemaVersion === 2
  ) {
    requiredExecutionContextVersion = 5;
  } else if (
    input.message.controllerSnapshot.agentControllerRef ===
      "builtin:claude-code" &&
    input.message.executionContext.access === "workspace"
  ) {
    requiredExecutionContextVersion = 3;
  } else if (input.message.executionContext.legacyAssociation) {
    requiredExecutionContextVersion = 2;
  }
  if (
    input.route.capabilities.runtimeAdapters?.some(
      (adapter) =>
        adapter.adapterId === adapterId &&
        (!input.message.executionContext?.permissionSource ||
          adapter.capabilityDeclaration
            .executionContextPermissionInheritance === true) &&
        (adapter.capabilityDeclaration.executionContextVersion ?? 0) >=
          requiredExecutionContextVersion
    )
  ) {
    return;
  }
  throw buildDispatchExecutionValidationError({
    code: "service.update_required",
    message: "Update OpenMeld Service to run independent tasks.",
    executionContext: input.executionContext,
    waitReasonCode: "execution_context.service_update_required",
  });
}
const assertDaemonRouteExecutionCompatible = (input: {
  executionContext: DispatchExecutionContext;
  executionLogBase: DispatchExecutionLogBase;
  route: OnlineRuntimeTransportRoute;
}): void => {
  if (input.route.executionCompatibility.status === "compatible") {
    return;
  }
  console.warn(
    "[core.openMeldDaemon.dispatch_execution.service_update_required]",
    {
      event: "core.openMeldDaemon.dispatch_execution.service_update_required",
      ...input.executionLogBase,
      connectionGeneration: input.executionContext.connectionGeneration,
      daemonSessionId: input.executionContext.daemonSessionId,
      expectedEpoch: input.route.executionCompatibility.expectedEpoch,
      leaseEpoch: input.executionContext.leaseEpoch,
      observedEpoch: input.route.executionCompatibility.observedEpoch,
      reasonCode: input.route.executionCompatibility.reasonCode,
    }
  );
  throw buildDispatchExecutionValidationError({
    code: "service.update_required",
    message: `OpenMeld Service update is required: ${input.route.executionCompatibility.reasonCode}`,
    executionContext: input.executionContext,
    waitReasonCode: input.route.executionCompatibility.reasonCode,
  });
};
const assertDaemonRouteLocalComponentsCurrent = (input: {
  executionContext: DispatchExecutionContext;
  executionLogBase: DispatchExecutionLogBase;
  localComponentsRelease: CoreLocalComponentsRelease;
  route: OnlineRuntimeTransportRoute;
}): void => {
  const localComponents = resolveLocalComponentUpdateProjection({
    release: input.localComponentsRelease,
    generatedAt: new Date().toISOString(),
    localComponentsStatus: input.route.capabilities.localComponents ?? null,
    serviceConnected: true,
    serviceVersion: input.route.serviceVersion ?? null,
  });
  if (!localComponents.service.wakeBlocked) {
    return;
  }
  const waitReasonCode =
    localComponents.service.reasonCodes[0] ?? "service.update_required";
  console.warn(
    "[core.openMeldDaemon.dispatch_execution.service_update_required]",
    {
      event: "core.openMeldDaemon.dispatch_execution.service_update_required",
      ...input.executionLogBase,
      connectionGeneration: input.executionContext.connectionGeneration,
      daemonSessionId: input.executionContext.daemonSessionId,
      installedVersion: localComponents.service.installedVersion,
      leaseEpoch: input.executionContext.leaseEpoch,
      latestVersion: localComponents.service.latestVersion,
      reasonCode: waitReasonCode,
      requiredVersion: localComponents.service.requiredVersion,
    }
  );
  throw buildDispatchExecutionValidationError({
    code: "service.update_required",
    message: `OpenMeld Service update is required: ${waitReasonCode}`,
    executionContext: input.executionContext,
    waitReasonCode,
  });
};
type RouteServiceUpdateBlocker = {
  expectedEpoch?: string | null;
  installedVersion?: string | null;
  latestVersion?: string | null;
  observedEpoch?: string | null;
  reasonCode: string;
  requiredVersion?: string | null;
};
const resolveOfflineRouteServiceUpdateBlocker = async (input: {
  db: PostgresDatabase;
  env: CoreBindings;
  ownerUserId: string;
  targetProfileId: string;
}): Promise<RouteServiceUpdateBlocker | null> => {
  const binding = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.targetProfileId,
    db: input.db,
    owner: {
      id: input.ownerUserId,
      kind: "owner_account",
    },
  });
  if (binding?.bindingState !== "enabled_primary") {
    return null;
  }
  const runtimeResult = await readRuntimeRegistryRecordByRuntimeId({
    db: input.db,
    openMeldServiceRuntimeId: binding.openMeldServiceRuntimeId,
  });
  if (runtimeResult.status !== "found") {
    return null;
  }
  const openMeldServiceRuntimeIdentity =
    runtimeResult.record.runtimeLookupInput;
  if (
    openMeldServiceRuntimeIdentity.owner.kind !== "owner_account" ||
    openMeldServiceRuntimeIdentity.owner.id !== input.ownerUserId
  ) {
    return null;
  }
  const ownerService = await lookupRuntimeTransportOwnerService({
    blockForgottenDevices: true,
    env: input.env,
    ownerUserId: input.ownerUserId,
  }).catch((error) => {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.owner_service_update_check_failed]",
      {
        event:
          "core.openMeldDaemon.dispatch_execution.owner_service_update_check_failed",
        error: error instanceof Error ? error.message : String(error),
        ownerUserId: input.ownerUserId,
        targetProfileId: input.targetProfileId,
      }
    );
    return null;
  });
  if (!ownerService?.online) {
    return null;
  }
  const session = ownerService.sessions.find(
    (candidate) =>
      candidate.deviceId === openMeldServiceRuntimeIdentity.deviceId &&
      candidate.lane === openMeldServiceRuntimeIdentity.lane
  );
  if (!session) {
    return null;
  }
  if (session.executionCompatibility.status === "update_required") {
    return {
      expectedEpoch: session.executionCompatibility.expectedEpoch,
      observedEpoch: session.executionCompatibility.observedEpoch,
      reasonCode: session.executionCompatibility.reasonCode,
    };
  }
  const localComponents = resolveLocalComponentUpdateProjection({
    release: await readCoreLocalComponentsRelease(
      input.env.OPENMELD_CLI_RELEASES
    ),
    generatedAt: new Date().toISOString(),
    localComponentsStatus: session.capabilities.localComponents ?? null,
    serviceConnected: true,
    serviceVersion: session.serviceVersion ?? null,
  });
  if (!localComponents.service.wakeBlocked) {
    return null;
  }
  return {
    installedVersion: localComponents.service.installedVersion,
    latestVersion: localComponents.service.latestVersion,
    reasonCode:
      localComponents.service.reasonCodes[0] ?? "service.update_required",
    requiredVersion: localComponents.service.requiredVersion,
  };
};
export const continueDispatchMessageAttempt = async (input: {
  attemptId: string;
  connectionGeneration: number;
  db: PostgresDatabase;
  daemonSessionId: string;
  env: CoreBindings;
  message: OpenMeldDaemonDispatchQueueMessage;
  leaseEpoch: number;
  replyingHintActive?: boolean;
  profileHandle?: string | null;
  targetProfileMentionLabel?: string | null;
  targetProfileName?: string | null;
  targetOwnerUserId: string;
}): Promise<DispatchWaitPhaseOutcome> => {
  return await awaitDispatchResultAndEmitReply({
    attemptId: input.attemptId,
    connectionGeneration: input.connectionGeneration,
    db: input.db,
    daemonSessionId: input.daemonSessionId,
    env: input.env,
    dispatchMessage: input.message,
    leaseEpoch: input.leaseEpoch,
    markWaitingForResult: false,
    replyingHintActive: input.replyingHintActive,
    profileHandle: input.profileHandle,
    targetProfileMentionLabel: input.targetProfileMentionLabel,
    targetProfileName: input.targetProfileName,
    targetOwnerUserId: input.targetOwnerUserId,
  });
};
const finalizeExistingAcceptedDispatchResult = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  existingResult: NonNullable<
    Awaited<ReturnType<typeof getDispatchResultByDispatchId>>
  >;
  inboxRecord: DispatchResultInboxRecord;
  recordPublicationProjection: boolean;
}): Promise<AcceptedDispatchFinalizationResult> => {
  if (
    input.existingResult.publishedSignalId &&
    input.recordPublicationProjection
  ) {
    await recordDispatchResultInboxPublicationProjection({
      attemptId: input.inboxRecord.attemptId,
      db: input.db,
      dispatchId: input.dispatchMessage.dispatchId,
      executionSemantic: resolveRuntimeCoordinatorFinalizationSemantic({
        finalMessageKind: resolveArchivedFinalMessageKind(
          input.existingResult.publicOutcome
        ),
        publishState: "reply_published",
        taskResult: input.inboxRecord.taskResult,
      }),
      publishedSignalId: input.existingResult.publishedSignalId,
      publishState: "reply_published",
      spaceId: input.dispatchMessage.spaceId,
      targetProfileId: input.dispatchMessage.targetProfileId,
    });
  }
  return {
    publishedSignalId: input.existingResult.publishedSignalId ?? null,
    publishState: input.existingResult.publishedSignalId
      ? "reply_published"
      : "invalid_space_action",
    status: "already_final",
  };
};
const markDispatchSucceeded = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  idempotencyKey: string;
}): Promise<void> => {
  await markDispatchStatus({
    attemptId: input.attemptId,
    attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.succeeded,
    db: input.db,
    idempotencyKey: input.idempotencyKey,
    nowMs: Date.now(),
    status: OPENMELD_DAEMON_DISPATCH_STATE.succeeded,
  });
};
export type ConfirmedAcceptedDispatchSuccess = {
  kind: "published_signal";
  publishedSignalId: string;
};
export const recordConfirmedAcceptedDispatchSuccess = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  idempotencyKey: string;
  outcome: ConfirmedAcceptedDispatchSuccess;
}): Promise<void> => {
  if (input.outcome.publishedSignalId.trim().length === 0) {
    throw new Error(
      "A confirmed accepted dispatch success requires a published signal ID."
    );
  }
  await markDispatchSucceeded({
    attemptId: input.attemptId,
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
};
export const recordConfirmedAcceptedDispatchFailure = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  errorCode: string;
  errorMessage?: string | null;
  idempotencyKey: string;
}): Promise<void> => {
  const errorCode = input.errorCode.trim();
  if (!errorCode) {
    throw new Error(
      "A confirmed accepted dispatch failure requires an error code."
    );
  }
  await markDispatchStatus({
    attemptId: input.attemptId,
    attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
    db: input.db,
    errorCode,
    errorMessage: input.errorMessage ?? null,
    idempotencyKey: input.idempotencyKey,
    nowMs: Date.now(),
    status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
  });
};
export const finalizeAcceptedDispatchResult = async (input: {
  db: PostgresDatabase;
  deliverAgentTransportSpaceAction?: AgentTransportSpaceActionDeliveryPort;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
  inboxRecord: DispatchResultInboxRecord;
  recordPublicationProjection?: boolean;
  profileHandle?: string | null;
  targetOwnerUserId: string;
  targetProfileMentionLabel?: string | null;
  targetProfileName?: string | null;
}): Promise<AcceptedDispatchFinalizationResult> => {
  const usageIdentityDb = getPostgresDatabase(input.env);
  if (usageIdentityDb) {
    await recordAcceptedLocalAiUsage({
      db: input.db,
      identityDb: usageIdentityDb,
      dispatchMessage: input.dispatchMessage,
      inboxRecord: input.inboxRecord,
    });
  }
  const existingResult = await getDispatchResultByDispatchId({
    db: input.db,
    dispatchId: input.dispatchMessage.dispatchId,
  });
  if (existingResult) {
    return await finalizeExistingAcceptedDispatchResult({
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      existingResult,
      inboxRecord: input.inboxRecord,
      recordPublicationProjection: input.recordPublicationProjection ?? true,
    });
  }
  const executionContext = buildDispatchExecutionContext({
    attemptId: input.inboxRecord.attemptId,
    connectionGeneration: input.inboxRecord.submittedConnectionGeneration,
    daemonSessionId: input.inboxRecord.daemonSessionId,
    leaseEpoch: input.inboxRecord.leaseEpoch,
    replyingHintActive: false,
  });
  const localStateDbHandle = resolveLocalStateDbHandleOrThrow(
    input.env,
    executionContext
  );
  if (
    input.inboxRecord.dispatchId !== input.dispatchMessage.dispatchId ||
    input.inboxRecord.taskId !== input.dispatchMessage.taskId ||
    input.inboxRecord.targetProfileId !== input.dispatchMessage.targetProfileId
  ) {
    throw buildDispatchExecutionValidationError({
      code: "daemon.result.identity_mismatch",
      executionContext,
      message:
        "accepted dispatch result does not match the stored dispatch outbox record",
    });
  }
  const executionLogBase: DispatchExecutionLogBase = {
    attemptId: input.inboxRecord.attemptId,
    dispatchId: input.dispatchMessage.dispatchId,
    sourceEventId: input.dispatchMessage.sourceEventId,
    targetOwnerUserId: input.targetOwnerUserId,
    targetProfileId: input.dispatchMessage.targetProfileId,
    taskId: input.dispatchMessage.taskId,
  };
  const { profileHandle, targetProfileMentionLabel, targetProfileName } =
    await resolveAwaitDispatchReplyTargetContext({
      authRpc: input.env.OPENMELD_AUTH_WORKER,
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      profileHandle: input.profileHandle,
      targetProfileMentionLabel: input.targetProfileMentionLabel,
      targetProfileName: input.targetProfileName,
    });
  await emitDispatchStreamingTelemetryDecision({
    attemptId: input.inboxRecord.attemptId,
    db: input.db,
    dispatchId: input.dispatchMessage.dispatchId,
    taskResult: input.inboxRecord.taskResult,
  });
  await emitDispatchRuntimeTelemetryDecision({
    attemptId: input.inboxRecord.attemptId,
    db: input.db,
    dispatchId: input.dispatchMessage.dispatchId,
    taskResult: input.inboxRecord.taskResult,
  });
  await emitDispatchStructuredActionFailureDecision({
    attemptId: input.inboxRecord.attemptId,
    db: input.db,
    dispatchId: input.dispatchMessage.dispatchId,
    taskResult: input.inboxRecord.taskResult,
  });
  assertRuntimeTransportTaskResultCorrelation({
    executionContext,
    expected: {
      attemptId: input.inboxRecord.attemptId,
      sourceEventId: input.dispatchMessage.sourceEventId,
      targetProfileId: input.dispatchMessage.targetProfileId,
      taskId: input.dispatchMessage.taskId,
    },
    taskResult: input.inboxRecord.taskResult,
  });
  if (input.inboxRecord.taskResult.payload.status === "failed") {
    await recordProviderAccessEvidenceFromAcceptedFailure({
      db: input.db,
      localStateDb: localStateDbHandle,
      dispatchMessage: input.dispatchMessage,
      inboxRecord: input.inboxRecord,
    });
    await recordReadinessImpactFromAcceptedFailure({
      db: input.db,
      localStateDb: localStateDbHandle,
      dispatchMessage: input.dispatchMessage,
      inboxRecord: input.inboxRecord,
    });
    const failedTaskResultClassification = classifyFailedTaskResultPayload(
      input.inboxRecord.taskResult.payload
    );
    await emitDispatchOpenClawBindingDecisionForFailure({
      attemptId: input.inboxRecord.attemptId,
      db: input.db,
      dispatchId: input.dispatchMessage.dispatchId,
      dispatchMessage: input.dispatchMessage,
      taskResult: input.inboxRecord.taskResult,
    });
    const failedReplyEmission =
      failedTaskResultClassification.terminalNoticeEligible
        ? await emitFailedDispatchReplySignalsIfNeeded({
            attemptId: input.inboxRecord.attemptId,
            db: input.db,
            deliverAgentTransportSpaceAction:
              input.deliverAgentTransportSpaceAction,
            dispatchMessage: input.dispatchMessage,
            env: input.env,
            executionContext,
            executionLogBase,
            finalOutcomeAuthority:
              input.finalOutcomeAuthority ?? "approved_compatibility",
            targetOwnerUserId: input.targetOwnerUserId,
            profileHandle,
            recordPublicationProjection:
              input.recordPublicationProjection ?? true,
            targetProfileMentionLabel,
            targetProfileName,
            taskResult: input.inboxRecord.taskResult,
          })
        : { publishedSignalId: null, terminalReplySettled: false };
    await markDispatchStatus({
      attemptId: input.inboxRecord.attemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
      db: input.db,
      errorCode: failedTaskResultClassification.errorCode,
      errorMessage: input.inboxRecord.taskResult.payload.errorMessage,
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      nowMs: Date.now(),
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
    });
    if (
      !failedReplyEmission.terminalReplySettled &&
      (input.recordPublicationProjection ?? true)
    ) {
      await recordDispatchResultInboxPublicationFailureProjection({
        attemptId: input.inboxRecord.attemptId,
        db: input.db,
        dispatchId: input.dispatchMessage.dispatchId,
        errorCode: failedTaskResultClassification.errorCode,
        spaceId: input.dispatchMessage.spaceId,
        targetProfileId: input.dispatchMessage.targetProfileId,
      });
    }
    return {
      publishedSignalId: failedReplyEmission.publishedSignalId,
      publishState: failedReplyEmission.publishedSignalId
        ? "reply_published"
        : "invalid_space_action",
      status: "finalized",
    };
  }
  await clearProviderAccessEvidenceFromAcceptedSuccess({
    db: input.db,
    localStateDb: localStateDbHandle,
    dispatchMessage: input.dispatchMessage,
    inboxRecord: input.inboxRecord,
  });
  await clearReadinessImpactFromAcceptedSuccess({
    db: input.db,
    localStateDb: localStateDbHandle,
    dispatchMessage: input.dispatchMessage,
    inboxRecord: input.inboxRecord,
  });
  const preparedReply = await prepareSuccessfulDispatchReply({
    attemptId: input.inboxRecord.attemptId,
    db: input.db,
    localStateDb: localStateDbHandle,
    dispatchMessage: input.dispatchMessage,
    env: input.env,
    executionContext,
    executionLogBase,
    targetOwnerUserId: input.targetOwnerUserId,
    taskResult: input.inboxRecord.taskResult,
  });
  const replyEmission = await emitDispatchReplySignals({
    agentControllerConversationId: preparedReply.agentControllerConversationId,
    attemptId: input.inboxRecord.attemptId,
    agentControllerRef: preparedReply.agentControllerRef,
    db: input.db,
    deliverAgentTransportSpaceAction: input.deliverAgentTransportSpaceAction,
    dispatchMessage: input.dispatchMessage,
    env: input.env,
    executionContext,
    executionLogBase,
    finalOutcomeAuthority:
      input.finalOutcomeAuthority ?? "approved_compatibility",
    profileHandle,
    recordPublicationProjection: input.recordPublicationProjection ?? true,
    replyText: preparedReply.replyText,
    targetOwnerUserId: input.targetOwnerUserId,
    targetProfileMentionLabel,
    targetProfileName,
    taskResult: input.inboxRecord.taskResult,
  });
  return {
    publishedSignalId: replyEmission.publishedSignalId,
    publishState: replyEmission.publishState,
    status: "finalized",
  };
};
async function recordProviderAccessEvidenceFromAcceptedFailure(input: {
  db: PostgresDatabase;
  localStateDb: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  inboxRecord: DispatchResultInboxRecord;
}): Promise<void> {
  const payload = input.inboxRecord.taskResult.payload;
  if (payload.status !== "failed") {
    return;
  }
  const reportedProviderAccessEvidence =
    "providerAccessEvidence" in payload
      ? payload.providerAccessEvidence
      : undefined;
  const structuredUsageExhausted = payload.errorCode === "usage_exhausted";
  if (!(reportedProviderAccessEvidence || structuredUsageExhausted)) {
    return;
  }
  if (
    reportedProviderAccessEvidence?.reasonCode ===
    "provider_account.capacity_exhausted"
  ) {
    // Older adapters inferred this classification from provider wording.
    // Preserve schema compatibility without letting raw text change future
    // Wakeability. New adapters submit the exact structured Usage reason.
    return;
  }
  // Keep accepted-result handling provider-agnostic. The repository validates
  // that evidence matches the exact controller in the execution identity.
  const executionIdentity = await readMatchingDispatchAttemptExecutionIdentity({
    db: input.db,
    diagnostic: {
      provider: reportedProviderAccessEvidence?.provider ?? null,
      reasonCode:
        reportedProviderAccessEvidence?.reasonCode ?? "usage_exhausted",
      subject: "provider_access_evidence",
    },
    dispatchMessage: input.dispatchMessage,
    inboxRecord: input.inboxRecord,
    operation: "write",
  });
  if (!executionIdentity) {
    return;
  }
  const providerAccessEvidence =
    reportedProviderAccessEvidence?.reasonCode === "usage_exhausted" ||
    !reportedProviderAccessEvidence
      ? createStructuredUsageExhaustedEvidence({
          agentControllerRef: executionIdentity.agentControllerRef,
          observedAtMs: input.inboxRecord.acceptedAtMs,
        })
      : reportedProviderAccessEvidence;
  if (!providerAccessEvidence) {
    return;
  }
  try {
    const result = await writeAcceptedProviderAccessFailureEvidence({
      agentProfileId: input.dispatchMessage.targetProfileId,
      db: input.localStateDb,
      evidence: providerAccessEvidence,
      executionIdentity,
      observedAtMs: input.inboxRecord.acceptedAtMs,
      sourceAttemptId: input.inboxRecord.attemptId,
      sourceDispatchId: input.dispatchMessage.dispatchId,
    });
    if (result === "written") {
      console.info("[core.agent_execution.provider_access_evidence_written]", {
        agentProfileId: input.dispatchMessage.targetProfileId,
        attemptId: input.inboxRecord.attemptId,
        dispatchId: input.dispatchMessage.dispatchId,
        provider: providerAccessEvidence.provider,
        reasonCode: providerAccessEvidence.reasonCode,
      });
    }
  } catch (error) {
    console.warn(
      "[core.agent_execution.provider_access_evidence_write_failed]",
      {
        agentProfileId: input.dispatchMessage.targetProfileId,
        attemptId: input.inboxRecord.attemptId,
        dispatchId: input.dispatchMessage.dispatchId,
        errorMessage: error instanceof Error ? error.message : String(error),
        reasonCode: providerAccessEvidence.reasonCode,
      }
    );
  }
}
function createStructuredUsageExhaustedEvidence(input: {
  agentControllerRef: string;
  observedAtMs: number;
}): OpenMeldDaemonProviderAccessEvidence | null {
  const agentControllerRef = parseAgentControllerRef(input.agentControllerRef);
  if (agentControllerRef?.kind !== "builtin") {
    return null;
  }
  if (
    resolveAgentControllerUsageLimitSupport(agentControllerRef.ref) !== "native"
  ) {
    return null;
  }
  const provider = openMeldDaemonProviderAccessEvidenceProviderSchema.safeParse(
    agentControllerRef.id
  );
  if (!provider.success) {
    return null;
  }
  return {
    observedAtMs: input.observedAtMs,
    provider: provider.data,
    reasonCode: "usage_exhausted",
    source: "wake_failure",
  };
}
async function clearProviderAccessEvidenceFromAcceptedSuccess(input: {
  db: PostgresDatabase;
  localStateDb: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  inboxRecord: DispatchResultInboxRecord;
}): Promise<void> {
  const executionIdentity = await readMatchingDispatchAttemptExecutionIdentity({
    db: input.db,
    diagnostic: {
      provider: null,
      reasonCode: "dispatch_attempt.execution_identity_missing",
      subject: "provider_access_evidence",
    },
    dispatchMessage: input.dispatchMessage,
    inboxRecord: input.inboxRecord,
    operation: "clear",
  });
  if (!executionIdentity) {
    return;
  }
  try {
    await clearProviderAccessFailureEvidenceForExecutionSuccess({
      agentProfileId: input.dispatchMessage.targetProfileId,
      clearedAtMs: input.inboxRecord.acceptedAtMs,
      db: input.localStateDb,
      executionIdentity,
      sourceAttemptId: input.inboxRecord.attemptId,
      sourceDispatchId: input.dispatchMessage.dispatchId,
    });
  } catch (error) {
    console.warn(
      "[core.agent_execution.provider_access_evidence_clear_failed]",
      {
        agentProfileId: input.dispatchMessage.targetProfileId,
        attemptId: input.inboxRecord.attemptId,
        dispatchId: input.dispatchMessage.dispatchId,
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    );
  }
}
async function recordReadinessImpactFromAcceptedFailure(input: {
  db: PostgresDatabase;
  localStateDb: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  inboxRecord: DispatchResultInboxRecord;
}): Promise<void> {
  const payload = input.inboxRecord.taskResult.payload;
  if (payload.status !== "failed") {
    return;
  }
  const reasonCode = resolveFailedTaskResultErrorCode({
    deduped: payload.deduped,
    errorCode: payload.errorCode,
    errorMessage: payload.errorMessage,
    errorType: payload.errorType ?? "internal",
  });
  const readinessImpactReasonCode =
    resolveAcceptedAgentExecutionReadinessImpactReasonCode(reasonCode);
  if (!readinessImpactReasonCode) {
    return;
  }
  const executionIdentity = await readMatchingDispatchAttemptExecutionIdentity({
    db: input.db,
    diagnostic: {
      provider: null,
      reasonCode: readinessImpactReasonCode,
      subject: "readiness_impact",
    },
    dispatchMessage: input.dispatchMessage,
    inboxRecord: input.inboxRecord,
    operation: "write",
  });
  if (!executionIdentity) {
    return;
  }
  try {
    const result = await writeAcceptedAgentExecutionReadinessImpact({
      agentProfileId: input.dispatchMessage.targetProfileId,
      db: input.localStateDb,
      executionIdentity,
      observedAtMs: input.inboxRecord.acceptedAtMs,
      reasonCode: readinessImpactReasonCode,
      sourceAttemptId: input.inboxRecord.attemptId,
      sourceDispatchId: input.dispatchMessage.dispatchId,
    });
    if (result === "written") {
      console.info("[core.agent_execution.readiness_impact_written]", {
        agentProfileId: input.dispatchMessage.targetProfileId,
        attemptId: input.inboxRecord.attemptId,
        dispatchId: input.dispatchMessage.dispatchId,
        reasonCode: readinessImpactReasonCode,
      });
    }
  } catch (error) {
    console.warn("[core.agent_execution.readiness_impact_write_failed]", {
      agentProfileId: input.dispatchMessage.targetProfileId,
      attemptId: input.inboxRecord.attemptId,
      dispatchId: input.dispatchMessage.dispatchId,
      errorMessage: error instanceof Error ? error.message : String(error),
      reasonCode: readinessImpactReasonCode,
    });
  }
}
async function clearReadinessImpactFromAcceptedSuccess(input: {
  db: PostgresDatabase;
  localStateDb: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  inboxRecord: DispatchResultInboxRecord;
}): Promise<void> {
  const executionIdentity = await readMatchingDispatchAttemptExecutionIdentity({
    db: input.db,
    diagnostic: {
      provider: null,
      reasonCode: "dispatch_attempt.execution_identity_missing",
      subject: "readiness_impact",
    },
    dispatchMessage: input.dispatchMessage,
    inboxRecord: input.inboxRecord,
    operation: "clear",
  });
  if (!executionIdentity) {
    return;
  }
  try {
    await clearAgentExecutionReadinessImpactForExecutionSuccess({
      agentProfileId: input.dispatchMessage.targetProfileId,
      clearedAtMs: input.inboxRecord.acceptedAtMs,
      db: input.localStateDb,
      executionIdentity,
      sourceDispatchId: input.dispatchMessage.dispatchId,
    });
  } catch (error) {
    console.warn("[core.agent_execution.readiness_impact_clear_failed]", {
      agentProfileId: input.dispatchMessage.targetProfileId,
      attemptId: input.inboxRecord.attemptId,
      dispatchId: input.dispatchMessage.dispatchId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}
type AcceptedResultExecutionIdentityDiagnostic = {
  provider: string | null;
  reasonCode: string;
  subject: "provider_access_evidence" | "readiness_impact";
};
async function readMatchingDispatchAttemptExecutionIdentity(input: {
  db: PostgresDatabase;
  diagnostic: AcceptedResultExecutionIdentityDiagnostic;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  inboxRecord: DispatchResultInboxRecord;
  operation: "clear" | "write";
}): Promise<{
  bindingId: string;
  agentControllerRef: string;
  openMeldServiceRuntimeId: string;
} | null> {
  const ownership = await readDispatchAttemptExecutionOwnershipFact({
    attemptId: input.inboxRecord.attemptId,
    db: input.db,
    dispatchId: input.dispatchMessage.dispatchId,
  }).catch((error) => {
    console.warn(
      `[core.agent_execution.${input.diagnostic.subject}_identity_read_failed]`,
      {
        agentProfileId: input.dispatchMessage.targetProfileId,
        attemptId: input.inboxRecord.attemptId,
        dispatchId: input.dispatchMessage.dispatchId,
        errorMessage: error instanceof Error ? error.message : String(error),
        operation: input.operation,
        provider: input.diagnostic.provider,
        reasonCode: input.diagnostic.reasonCode,
      }
    );
    return null;
  });
  if (!ownership) {
    return null;
  }
  if (
    ownership.status !== "found" ||
    ownership.targetProfileId !== input.dispatchMessage.targetProfileId ||
    ownership.taskId !== input.dispatchMessage.taskId
  ) {
    console.warn(
      `[core.agent_execution.${input.diagnostic.subject}_not_matched]`,
      {
        agentProfileId: input.dispatchMessage.targetProfileId,
        attemptId: input.inboxRecord.attemptId,
        dispatchId: input.dispatchMessage.dispatchId,
        operation: input.operation,
        provider: input.diagnostic.provider,
        reasonCode: input.diagnostic.reasonCode,
      }
    );
    return null;
  }
  return {
    bindingId: ownership.bindingId,
    agentControllerRef: ownership.agentControllerRef,
    openMeldServiceRuntimeId: ownership.openMeldServiceRuntimeId,
  };
}
const awaitDispatchResultAndEmitReply = async (input: {
  attemptId: string;
  connectionGeneration?: number | null;
  db: PostgresDatabase;
  daemonSessionId: string;
  env: CoreBindings;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  leaseEpoch: number;
  markWaitingForResult?: boolean;
  replyingHintActive?: boolean;
  profileHandle?: string | null;
  targetProfileMentionLabel?: string | null;
  targetProfileName?: string | null;
  targetOwnerUserId: string;
}): Promise<DispatchWaitPhaseOutcome> => {
  const initialExecutionContext = buildDispatchExecutionContext({
    attemptId: input.attemptId,
    connectionGeneration: input.connectionGeneration,
    daemonSessionId: input.daemonSessionId,
    leaseEpoch: input.leaseEpoch,
    replyingHintActive: input.replyingHintActive,
  });
  const localStateDbHandle = resolveLocalStateDbHandleOrThrow(
    input.env,
    initialExecutionContext
  );
  const executionLogBase: DispatchExecutionLogBase = {
    attemptId: input.attemptId,
    dispatchId: input.dispatchMessage.dispatchId,
    sourceEventId: input.dispatchMessage.sourceEventId,
    targetOwnerUserId: input.targetOwnerUserId,
    targetProfileId: input.dispatchMessage.targetProfileId,
    taskId: input.dispatchMessage.taskId,
  };
  if (input.markWaitingForResult ?? true) {
    await markDispatchAttemptWaitingForResult({
      attemptId: input.attemptId,
      connectionGeneration: initialExecutionContext.connectionGeneration ?? 1,
      daemonSessionId: input.daemonSessionId,
      db: input.db,
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      leaseEpoch: input.leaseEpoch,
      nowMs: Date.now(),
      targetProfileId: input.dispatchMessage.targetProfileId,
      taskId: input.dispatchMessage.taskId,
    });
  }
  const replyingHintEmissionState = initialExecutionContext.replyingHintActive
    ? "already_active"
    : await emitDispatchReplyingHintSignal({
        db: input.db,
        localStateDb: localStateDbHandle,
        env: input.env,
        dispatchMessage: input.dispatchMessage,
        targetProfileName: input.targetProfileName ?? null,
      });
  const executionContext: DispatchExecutionContext = {
    ...initialExecutionContext,
    replyingHintActive: resolveReplyingHintActivationState({
      replyingHintActive: initialExecutionContext.replyingHintActive,
      replyingHintEmissionState,
    }),
  };
  const waitStartedAtMs = Date.now();
  console.info("[core.openMeldDaemon.dispatch_execution.wait_started]", {
    event: CORE_LOG_EVENTS.dispatchExecutionWaitStarted,
    ...executionLogBase,
    connectionGeneration: executionContext.connectionGeneration,
    daemonSessionId: executionContext.daemonSessionId,
    leaseEpoch: executionContext.leaseEpoch,
    timeoutMs: RUNTIME_TRANSPORT_WAIT_RESULT_TIMEOUT_MS,
  });
  const waitResult = await waitForDaemonDispatchCompletion({
    attemptId: input.attemptId,
    db: input.db,
    env: input.env,
    executionContext,
    executionLogBase,
    waitStartedAtMs,
  });
  assertRuntimeTransportTaskResultCorrelation({
    executionContext,
    expected: {
      attemptId: input.attemptId,
      sourceEventId: input.dispatchMessage.sourceEventId,
      targetProfileId: input.dispatchMessage.targetProfileId,
      taskId: input.dispatchMessage.taskId,
    },
    taskResult: waitResult.taskResult,
  });
  console.info(
    "[core.openMeldDaemon.dispatch_execution.finalization_command_observed]",
    {
      event:
        "core.openMeldDaemon.dispatch_execution.finalization_command_observed",
      ...executionLogBase,
      connectionGeneration: executionContext.connectionGeneration,
      daemonSessionId: executionContext.daemonSessionId,
      leaseEpoch: executionContext.leaseEpoch,
      resultStatus: waitResult.taskResult.payload.status,
    }
  );
  return {
    executionContext,
    finalizationHandledByRuntimeCoordinator: true,
    replyingHintTransitionHint: executionContext.replyingHintActive
      ? "clear_for_terminal_reply"
      : null,
  };
};
const waitForDaemonDispatchCompletion = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  env: CoreBindings;
  executionContext: DispatchExecutionContext;
  executionLogBase: DispatchExecutionLogBase;
  waitStartedAtMs: number;
}): Promise<WaitForDaemonDispatchCompletionResult> => {
  while (true) {
    const waitResult = await waitRuntimeTransportDispatchResult({
      env: input.env,
      ownerUserId: input.executionLogBase.targetOwnerUserId,
      attemptId: input.attemptId,
      dispatchId: input.executionLogBase.dispatchId,
      daemonSessionId: input.executionContext.daemonSessionId,
      connectionGeneration: input.executionContext.connectionGeneration ?? 1,
      leaseEpoch: input.executionContext.leaseEpoch,
      timeoutMs: RUNTIME_TRANSPORT_WAIT_RESULT_TIMEOUT_MS,
    });
    const waitDurationMs = Date.now() - input.waitStartedAtMs;
    if (waitResult.state === "pending") {
      await emitDispatchExecutionLifecycleDecision({
        attemptId: input.attemptId,
        db: input.db,
        dispatchId: input.executionLogBase.dispatchId,
        lifecycle: waitResult.lifecycle,
        progressEvidenceState: "active",
      });
      console.info("[core.openMeldDaemon.dispatch_execution.wait_pending]", {
        event: CORE_LOG_EVENTS.dispatchExecutionWaitStarted,
        ...input.executionLogBase,
        connectionGeneration: input.executionContext.connectionGeneration,
        daemonSessionId: input.executionContext.daemonSessionId,
        leaseEpoch: input.executionContext.leaseEpoch,
        phase: waitResult.lifecycle.phase,
        lastLifecycleAtMs: waitResult.lifecycle.lastLifecycleAtMs,
        waitDurationMs,
      });
      continue;
    }
    if (waitResult.state === "failed") {
      if (waitResult.lifecycle) {
        await emitDispatchExecutionLifecycleDecision({
          attemptId: input.attemptId,
          db: input.db,
          dispatchId: input.executionLogBase.dispatchId,
          progressEvidenceState: isLifecycleFailureReason(waitResult.reasonCode)
            ? "stalled"
            : "unknown",
          lifecycle: waitResult.lifecycle,
        });
      }
      console.warn("[core.openMeldDaemon.dispatch_execution.wait_failed]", {
        event: CORE_LOG_EVENTS.dispatchExecutionRouteBlocked,
        ...input.executionLogBase,
        connectionGeneration: input.executionContext.connectionGeneration,
        daemonSessionId: input.executionContext.daemonSessionId,
        leaseEpoch: input.executionContext.leaseEpoch,
        phase: waitResult.lifecycle?.phase ?? null,
        reasonCode: waitResult.reasonCode,
        waitDurationMs,
      });
      throw buildDispatchExecutionValidationError({
        code: normalizeRuntimeTransportWaitErrorCode(waitResult.reasonCode),
        message: `daemon wait failed: ${waitResult.reasonCode}`,
        executionContext: input.executionContext,
        waitDurationMs,
        waitReasonCode: waitResult.reasonCode,
      });
    }
    if (waitResult.lifecycle) {
      await emitDispatchExecutionLifecycleDecision({
        attemptId: input.attemptId,
        db: input.db,
        dispatchId: input.executionLogBase.dispatchId,
        lifecycle: waitResult.lifecycle,
        progressEvidenceState: "active",
      });
    }
    console.info("[core.openMeldDaemon.dispatch_execution.wait_completed]", {
      event: CORE_LOG_EVENTS.dispatchExecutionDaemonDelivered,
      ...input.executionLogBase,
      connectionGeneration: input.executionContext.connectionGeneration,
      daemonSessionId: input.executionContext.daemonSessionId,
      leaseEpoch: input.executionContext.leaseEpoch,
      phase: waitResult.lifecycle?.phase ?? null,
      waitDurationMs,
    });
    return {
      lifecycle: waitResult.lifecycle ?? null,
      taskResult: waitResult.taskResult,
    };
  }
};
const deliverPublicationPlanWithClaim = async (input: {
  agentControllerConversationId: string | null;
  attemptId: string;
  agentControllerRef: string | null;
  db: PostgresDatabase;
  deliverAgentTransportSpaceAction: AgentTransportSpaceActionDeliveryPort;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  executionContext: DispatchExecutionContext;
  finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
  messageEnvelope: MessageEnvelope | null;
  plan: Extract<
    DispatchPublicationPlan,
    {
      kind: "message" | "status" | "system_notice";
    }
  >;
  profileHandle: string | null;
  resultRef: string | null;
  targetOwnerUserId: string;
  targetProfileMentionLabel: string | null;
  targetProfileName: string | null;
  agentControllerConversation: AgentControllerConversationRef | null;
  workingDirectory: string | null;
}): Promise<AgentTransportSpaceActionDeliveryReceipt> => {
  const replyClaimedAtMs = Date.now();
  const replyClaimState = await claimFinalReplyEmission({
    db: input.db,
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    nowMs: replyClaimedAtMs,
  });
  let shouldRollbackReplyClaim = replyClaimState === "claimed";
  try {
    const delivery = await input.deliverAgentTransportSpaceAction({
      agentControllerConversationId: input.agentControllerConversationId,
      attemptId: input.attemptId,
      agentControllerRef: input.agentControllerRef,
      dispatchMessage: input.dispatchMessage,
      finalOutcomeAuthority: input.finalOutcomeAuthority,
      messageEnvelope: input.messageEnvelope,
      plan: input.plan,
      profileHandle: input.profileHandle,
      resultRef: input.resultRef,
      targetOwnerUserId: input.targetOwnerUserId,
      targetProfileMentionLabel: input.targetProfileMentionLabel,
      targetProfileName: input.targetProfileName,
      agentControllerConversation: input.agentControllerConversation,
      workingDirectory: input.workingDirectory,
    });
    shouldRollbackReplyClaim = false;
    return delivery;
  } catch (error) {
    if (shouldRollbackReplyClaim) {
      await rollbackFinalReplyEmissionClaim({
        db: input.db,
        idempotencyKey: input.dispatchMessage.idempotencyKey,
        claimedAtMs: replyClaimedAtMs,
      }).catch(() => undefined);
    }
    throw normalizePostPublicationDispatchError({
      emittedSignal: null,
      error,
      executionContext: input.executionContext,
    });
  }
};
const deliverFailedDispatchPublicationPlan = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  deliverAgentTransportSpaceAction: AgentTransportSpaceActionDeliveryPort;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionContext: DispatchExecutionContext;
  executionLogBase: Record<string, string>;
  finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
  payload: Extract<
    OpenMeldDaemonTaskResultEnvelope["payload"],
    {
      status: "failed";
    }
  >;
  plan: Extract<
    DispatchPublicationPlan,
    {
      kind: "message" | "status" | "system_notice";
    }
  >;
  profileHandle: string | null;
  recordPublicationProjection: boolean;
  targetOwnerUserId: string;
  targetProfileMentionLabel: string | null;
  targetProfileName: string | null;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
  agentControllerConversation: AgentControllerConversationRef | null;
  workingDirectory: string | null;
}): Promise<{
  publishedSignalId: string | null;
  terminalReplySettled: boolean;
}> => {
  const archivedMessageEnvelope =
    input.plan.kind === "message"
      ? buildCanonicalDispatchReplyMessageEnvelope({
          dispatchMessage: input.dispatchMessage,
          messageEnvelope: input.plan.messageEnvelope,
          replyText: input.plan.text,
        })
      : null;
  const emission = await deliverPublicationPlanWithClaim({
    agentControllerConversationId: normalizeOptionalText(
      input.payload.agentControllerConversationId
    ),
    attemptId: input.attemptId,
    agentControllerRef:
      normalizeOptionalText(input.payload.agentControllerRef) ??
      normalizeOptionalText(
        input.dispatchMessage.controllerSnapshot.agentControllerRef
      ),
    db: input.db,
    deliverAgentTransportSpaceAction: input.deliverAgentTransportSpaceAction,
    dispatchMessage: input.dispatchMessage,
    executionContext: input.executionContext,
    finalOutcomeAuthority: input.finalOutcomeAuthority,
    messageEnvelope: archivedMessageEnvelope,
    plan: input.plan,
    profileHandle: input.profileHandle,
    resultRef: null,
    targetOwnerUserId: input.targetOwnerUserId,
    targetProfileMentionLabel: input.targetProfileMentionLabel,
    targetProfileName: input.targetProfileName,
    agentControllerConversation: input.agentControllerConversation,
    workingDirectory: input.workingDirectory,
  });
  try {
    await finalizePublishedDispatchReply({
      archivedMessageEnvelope,
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      emittedSignal: emission.emittedSignal,
      env: input.env,
      executionContext: input.executionContext,
      executionLogBase: input.executionLogBase,
      plan: input.plan,
      publishedThreadContext: emission.threadContext,
      recordPublicationProjection: input.recordPublicationProjection,
      runtimeOutput: resolveArchivedDispatchReplyText({
        plan: input.plan,
        payload: input.payload,
      }),
      targetProfileName: input.targetProfileName,
      taskResult: input.taskResult,
    });
  } catch (error) {
    if (input.recordPublicationProjection) {
      await recordDispatchResultInboxPublicationFailureProjection({
        attemptId: input.attemptId,
        db: input.db,
        dispatchId: input.dispatchMessage.dispatchId,
        errorCode: resolveDispatchExecutionErrorCode(error),
        spaceId: input.dispatchMessage.spaceId,
        targetProfileId: input.dispatchMessage.targetProfileId,
      });
    }
    throw normalizePostPublicationDispatchError({
      emittedSignal: emission.emittedSignal,
      error,
      executionContext: input.executionContext,
    });
  }
  return {
    publishedSignalId: emission.emittedSignal?.id ?? null,
    terminalReplySettled: emission.finalReplySettled,
  };
};
const emitFailedDispatchReplySignalsIfNeeded = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  deliverAgentTransportSpaceAction?: AgentTransportSpaceActionDeliveryPort;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionContext: DispatchExecutionContext;
  executionLogBase: Record<string, string>;
  finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
  recordPublicationProjection: boolean;
  targetOwnerUserId: string;
  profileHandle: string | null;
  targetProfileMentionLabel: string | null;
  targetProfileName: string | null;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
}): Promise<{
  publishedSignalId: string | null;
  terminalReplySettled: boolean;
}> => {
  const payload = input.taskResult.payload;
  if (payload.status !== "failed") {
    return {
      publishedSignalId: null,
      terminalReplySettled: false,
    };
  }
  const publicationPlan = resolveDispatchPublicationPlan({
    actorName: input.targetProfileName,
    dispatchMessage: input.dispatchMessage,
    payload,
    replyText: null,
    targetProfileName: input.targetProfileName,
  });
  if (publicationPlan.blockedExplicitAction) {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: "dispatch.reply.policy_blocked_explicit_action",
      decisionPayload: {
        attemptId: input.attemptId,
        dispatchId: input.dispatchMessage.dispatchId,
        targetProfileId: input.dispatchMessage.targetProfileId,
      },
      decidedBy: "dispatch-execution-service",
      decidedAtMs: Date.now(),
      source: "dispatch_execution",
      correlationId: input.dispatchMessage.dispatchId,
    }).catch(() => undefined);
  }
  const agentControllerConversation =
    resolveRuntimeAgentControllerConversation(payload);
  const workingDirectory = resolveRuntimeWorkingDirectory(payload);
  if (
    input.deliverAgentTransportSpaceAction &&
    (publicationPlan.kind === "message" || publicationPlan.kind === "status")
  ) {
    return await deliverFailedDispatchPublicationPlan({
      attemptId: input.attemptId,
      db: input.db,
      deliverAgentTransportSpaceAction: input.deliverAgentTransportSpaceAction,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      executionContext: input.executionContext,
      executionLogBase: input.executionLogBase,
      finalOutcomeAuthority: input.finalOutcomeAuthority,
      payload,
      plan: publicationPlan,
      profileHandle: input.profileHandle,
      recordPublicationProjection: input.recordPublicationProjection,
      targetOwnerUserId: input.targetOwnerUserId,
      targetProfileMentionLabel: input.targetProfileMentionLabel,
      targetProfileName: input.targetProfileName,
      taskResult: input.taskResult,
      agentControllerConversation,
      workingDirectory,
    });
  }
  if (publicationPlan.kind === "system_notice") {
    const emission = await emitSystemNoticeReplySignal({
      attemptId: input.attemptId,
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      finalOutcomeAuthority: input.finalOutcomeAuthority,
      plan: publicationPlan,
      resultRef: null,
      targetProfileName: input.targetProfileName,
      agentControllerConversation,
      workingDirectory,
    });
    try {
      await finalizePublishedDispatchReply({
        archivedMessageEnvelope: null,
        db: input.db,
        dispatchMessage: input.dispatchMessage,
        emittedSignal: emission.emittedSignal,
        env: input.env,
        executionContext: input.executionContext,
        executionLogBase: input.executionLogBase,
        plan: publicationPlan,
        recordPublicationProjection: input.recordPublicationProjection,
        runtimeOutput: resolveArchivedDispatchReplyText({
          plan: publicationPlan,
          payload,
        }),
        targetProfileName: input.targetProfileName,
        taskResult: input.taskResult,
      });
    } catch (error) {
      if (input.recordPublicationProjection) {
        await recordDispatchResultInboxPublicationFailureProjection({
          attemptId: input.attemptId,
          db: input.db,
          dispatchId: input.dispatchMessage.dispatchId,
          errorCode: resolveDispatchExecutionErrorCode(error),
          spaceId: input.dispatchMessage.spaceId,
          targetProfileId: input.dispatchMessage.targetProfileId,
        });
      }
      throw normalizePostPublicationDispatchError({
        emittedSignal: emission.emittedSignal,
        error,
        executionContext: input.executionContext,
      });
    }
    return {
      publishedSignalId: emission.emittedSignal?.id ?? null,
      terminalReplySettled: emission.finalReplySettled,
    };
  }
  if (publicationPlan.kind !== "status") {
    return {
      publishedSignalId: null,
      terminalReplySettled: false,
    };
  }
  const emission = await emitStatusReplySignal({
    agentControllerConversationId: normalizeOptionalText(
      payload.agentControllerConversationId
    ),
    attemptId: input.attemptId,
    agentControllerRef:
      normalizeOptionalText(payload.agentControllerRef) ??
      normalizeOptionalText(
        input.dispatchMessage.controllerSnapshot.agentControllerRef
      ),
    db: input.db,
    dispatchMessage: input.dispatchMessage,
    env: input.env,
    executionContext: input.executionContext,
    finalOutcomeAuthority: input.finalOutcomeAuthority,
    agentControllerConversation,
    workingDirectory,
    plan: publicationPlan,
    resultRef: null,
    targetOwnerUserId: input.targetOwnerUserId,
    profileHandle: input.profileHandle,
    targetProfileMentionLabel: input.targetProfileMentionLabel,
    targetProfileName: input.targetProfileName,
  });
  try {
    await finalizePublishedDispatchReply({
      archivedMessageEnvelope: null,
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      emittedSignal: emission.emittedSignal,
      env: input.env,
      executionContext: input.executionContext,
      executionLogBase: input.executionLogBase,
      plan: publicationPlan,
      recordPublicationProjection: input.recordPublicationProjection,
      runtimeOutput: resolveArchivedDispatchReplyText({
        plan: publicationPlan,
        payload,
      }),
      targetProfileName: input.targetProfileName,
      taskResult: input.taskResult,
    });
  } catch (error) {
    if (input.recordPublicationProjection) {
      await recordDispatchResultInboxPublicationFailureProjection({
        attemptId: input.attemptId,
        db: input.db,
        dispatchId: input.dispatchMessage.dispatchId,
        errorCode: resolveDispatchExecutionErrorCode(error),
        spaceId: input.dispatchMessage.spaceId,
        targetProfileId: input.dispatchMessage.targetProfileId,
      });
    }
    throw normalizePostPublicationDispatchError({
      emittedSignal: emission.emittedSignal,
      error,
      executionContext: input.executionContext,
    });
  }
  return {
    publishedSignalId: emission.emittedSignal?.id ?? null,
    terminalReplySettled: emission.finalReplySettled,
  };
};
const finalizePublishedDispatchReply = async (input: {
  archivedMessageEnvelope: MessageEnvelope | null;
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  emittedSignal: SignalEnvelope | null;
  env: CoreBindings;
  executionContext: DispatchExecutionContext;
  executionLogBase: Record<string, string>;
  plan: Extract<
    DispatchPublicationPlan,
    {
      kind: "message" | "status" | "system_notice";
    }
  >;
  publishedThreadContext?: SpaceThreadContext | null;
  recordPublicationProjection: boolean;
  runtimeOutput: string;
  targetProfileName: string | null;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
}): Promise<void> => {
  if (!input.emittedSignal) {
    return;
  }
  const archivedReplyToSignalId = resolveArchivedReplyToSignalId({
    dispatchReplyToSignalId:
      input.dispatchMessage.replyToSnapshot?.signalId ?? null,
    emittedSignal: input.emittedSignal,
    plan: input.plan,
  });
  const dispatchResult = buildDispatchResultRecord({
    archivedMessageEnvelope: input.archivedMessageEnvelope,
    dispatchId: input.dispatchMessage.dispatchId,
    dispatchReplyToSignalId:
      input.dispatchMessage.replyToSnapshot?.signalId ?? null,
    emittedSignal: input.emittedSignal,
    publishedSignalId: input.emittedSignal.id,
    runtimeOutput: input.runtimeOutput,
    targetProfileId: input.dispatchMessage.targetProfileId,
    targetProfileName: input.targetProfileName,
    plan: input.plan,
    spaceId: input.dispatchMessage.spaceId,
    threadContext:
      input.publishedThreadContext === undefined
        ? (input.dispatchMessage.threadContext ?? null)
        : input.publishedThreadContext,
  });
  if (dispatchResult) {
    await writeDispatchResult({
      db: input.db,
      result: dispatchResult,
    });
    console.info("[core.openMeldDaemon.dispatch_execution.result_archived]", {
      dispatchId: input.dispatchMessage.dispatchId,
      hasMessageEnvelope: "messageEnvelope" in dispatchResult,
      publishedSignalId: input.emittedSignal.id,
      replyToSignalId: archivedReplyToSignalId,
      resultKind: dispatchResult.resultKind,
      spaceId: input.dispatchMessage.spaceId,
    });
  }
  await emitConversationContinuityWarningIfNeeded({
    dispatchMessage: input.dispatchMessage,
    env: input.env,
    executionContext: input.executionContext,
    executionLogBase: input.executionLogBase,
    targetProfileName: input.targetProfileName,
    taskResult: input.taskResult,
  });
  if (input.recordPublicationProjection) {
    const publishState = input.plan.blockedExplicitAction
      ? "invalid_space_action"
      : "reply_published";
    const executionSemantic = resolveRuntimeCoordinatorFinalizationSemantic({
      finalMessageKind: resolvePublicationPlanFinalMessageKind(input.plan),
      publishState,
      taskResult: input.taskResult,
    });
    const publicationProjectionEvidence =
      await recordDispatchResultInboxPublicationProjection({
        attemptId: input.executionContext.attemptId,
        db: input.db,
        dispatchId: input.dispatchMessage.dispatchId,
        executionSemantic,
        publishedSignalId: input.emittedSignal.id,
        publishState,
        spaceId: input.dispatchMessage.spaceId,
        targetProfileId: input.dispatchMessage.targetProfileId,
      });
    emitCoreFinalVisibleOutcomeRuntimeEvidence(input.env, {
      clientMessageId: input.dispatchMessage.sourceClientMessageId ?? null,
      dispatchId: input.dispatchMessage.dispatchId,
      latestAttemptId: input.executionContext.attemptId,
      publishedSignalId: input.emittedSignal.id,
      reasonCode:
        executionSemantic.reasonCode ??
        (publishState === "reply_published"
          ? "space.reply_published"
          : publishState),
      replySignalId:
        publishState === "reply_published" ? input.emittedSignal.id : null,
      resultRef: dispatchResult?.resultRef ?? null,
      runtimeCoordinatorExecutionId:
        publicationProjectionEvidence.runtimeCoordinatorExecutionId,
      runtimeKind: "queue",
      sourceSignalId: input.dispatchMessage.sourceEventId,
      spaceId: input.dispatchMessage.spaceId,
      status: executionSemantic.status === "failed" ? "failed" : "succeeded",
      targetProfileId: input.dispatchMessage.targetProfileId,
    });
  }
};
const recordDispatchResultInboxPublicationProjection = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  dispatchId: string;
  executionSemantic?: RuntimeCoordinatorFinalizationSemantic;
  publicationErrorCode?: string | null;
  publishedSignalId?: string | null;
  publishState:
    | "reply_published"
    | "reply_publication_failed"
    | "invalid_space_action";
  spaceId: string;
  targetProfileId: string;
}): Promise<{
  runtimeCoordinatorExecutionId: string | null;
}> => {
  try {
    const projection = await updateDispatchResultInboxPublishState(input.db, {
      attemptId: input.attemptId,
      dispatchId: input.dispatchId,
      publicationErrorCode: input.publicationErrorCode ?? null,
      publishedSignalId: input.publishedSignalId ?? null,
      publishState: input.publishState,
      updatedAtMs: Date.now(),
    });
    if (projection.status === "missing") {
      console.warn(
        "[core.openMeldDaemon.dispatch_execution.result_inbox_projection_missing]",
        {
          attemptId: input.attemptId,
          dispatchId: input.dispatchId,
          publishState: input.publishState,
        }
      );
    }
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.result_inbox_projection_failed]",
      {
        attemptId: input.attemptId,
        dispatchId: input.dispatchId,
        error: toErrorMessage(error),
        publishState: input.publishState,
      }
    );
  }
  return recordRuntimeCoordinatorPublicationProjection(input);
};
const recordDispatchResultInboxPublicationFailureProjection = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  dispatchId: string;
  errorCode: string;
  spaceId: string;
  targetProfileId: string;
}): Promise<void> => {
  await recordDispatchResultInboxPublicationProjection({
    attemptId: input.attemptId,
    db: input.db,
    dispatchId: input.dispatchId,
    publicationErrorCode: input.errorCode,
    publishState: "reply_publication_failed",
    spaceId: input.spaceId,
    targetProfileId: input.targetProfileId,
  });
};
const recordRuntimeCoordinatorPublicationProjection = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  dispatchId: string;
  executionSemantic?: RuntimeCoordinatorFinalizationSemantic;
  publicationErrorCode?: string | null;
  publishedSignalId?: string | null;
  publishState:
    | "reply_published"
    | "reply_publication_failed"
    | "invalid_space_action";
  spaceId: string;
  targetProfileId: string;
}): Promise<{
  runtimeCoordinatorExecutionId: string | null;
}> => {
  const existing = await readRuntimeCoordinatorExecutionProjectionByDispatch({
    db: input.db,
    dispatchId: input.dispatchId,
    spaceId: input.spaceId,
    targetProfileId: input.targetProfileId,
  }).catch(() => null);
  if (!existing) {
    return { runtimeCoordinatorExecutionId: null };
  }
  const nowMs = Date.now();
  const status =
    input.executionSemantic?.status === "failed"
      ? "failed_terminal"
      : resolveRuntimeCoordinatorPublicationStatus(input.publishState);
  const reasonCode =
    input.executionSemantic?.reasonCode ??
    input.publicationErrorCode ??
    (input.publishState === "invalid_space_action"
      ? "invalid_space_action"
      : null);
  try {
    await writeRuntimeCoordinatorExecutionProjection({
      db: input.db,
      record: {
        ...existing,
        status,
        terminalOutcome: {
          kind: resolveRuntimeCoordinatorTerminalOutcomeKind(status),
          observedAtMs: nowMs,
          reasonCode,
        },
        updatedAtMs: nowMs,
      },
    });
    await writeRuntimeCoordinatorExecutionEventFromParts({
      db: input.db,
      eventType:
        input.publishState === "reply_published"
          ? "reply_published"
          : "reply_publication_failed",
      idempotencyKey: `publication:${input.dispatchId}:${input.attemptId}:${input.publishState}`,
      observedAtMs: nowMs,
      payload: {
        publishedSignalId: input.publishedSignalId ?? null,
        publishState: input.publishState,
      },
      reasonCode,
      runtimeCoordinatorExecutionId: existing.runtimeCoordinatorExecutionId,
      statusAfter: status,
    });
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.runtime_coordinator.publication_projection_failed]",
      {
        attemptId: input.attemptId,
        dispatchId: input.dispatchId,
        error: toErrorMessage(error),
        publishState: input.publishState,
        runtimeCoordinatorExecutionId: existing.runtimeCoordinatorExecutionId,
      }
    );
  }
  return {
    runtimeCoordinatorExecutionId: existing.runtimeCoordinatorExecutionId,
  };
};
const resolveRuntimeCoordinatorPublicationStatus = (
  publishState:
    | "reply_published"
    | "reply_publication_failed"
    | "invalid_space_action"
) => {
  if (publishState === "reply_published") {
    return "reply_published";
  }
  if (publishState === "invalid_space_action") {
    return "failed_terminal";
  }
  return "failed_retryable";
};
const resolveRuntimeCoordinatorTerminalOutcomeKind = (
  status: ReturnType<typeof resolveRuntimeCoordinatorPublicationStatus>
) => {
  if (status === "reply_published") {
    return "reply_published";
  }
  if (status === "failed_terminal") {
    return "failed_terminal";
  }
  return "failed_retryable";
};
const resolvePublicationPlanFinalMessageKind = (
  plan: Extract<
    DispatchPublicationPlan,
    {
      kind: "message" | "status" | "system_notice";
    }
  >
): "failure_notice" | "stay_silent" | "success_reply" => {
  if (plan.kind !== "system_notice") {
    return "success_reply";
  }
  return plan.noticeType === "stay_silent" ? "stay_silent" : "failure_notice";
};
const resolveArchivedFinalMessageKind = (
  publicOutcome: DispatchResult["publicOutcome"]
): "failure_notice" | "stay_silent" | "success_reply" | "unknown" => {
  if (publicOutcome === "stay_silent") {
    return "stay_silent";
  }
  if (publicOutcome === "system_notice") {
    return "failure_notice";
  }
  if (publicOutcome === "internal_only") {
    return "unknown";
  }
  return "success_reply";
};
export const normalizePostPublicationDispatchError = (input: {
  emittedSignal: SignalEnvelope | null;
  error: unknown;
  executionContext: DispatchExecutionContext;
}): DispatchExecutionValidationError => {
  return wrapDispatchExecutionError({
    error: input.error,
    executionContext: input.executionContext,
    terminalReplySettled: input.emittedSignal !== null,
  });
};
const resolveArchivedDispatchReplyText = (input: {
  plan: Extract<
    DispatchPublicationPlan,
    {
      kind: "message" | "status" | "system_notice";
    }
  >;
  payload: OpenMeldDaemonTaskResultEnvelope["payload"];
}): string => {
  if (isSuccessfulTaskResultPayload(input.payload)) {
    return input.payload.output;
  }
  return input.plan.text;
};
const buildDispatchExecutionContext = (input: {
  attemptId: string;
  connectionGeneration?: number | null;
  daemonSessionId: string;
  leaseEpoch: number;
  replyingHintActive?: boolean | null;
}): DispatchExecutionContext => {
  return {
    attemptId: input.attemptId,
    daemonSessionId:
      normalizeOptionalText(input.daemonSessionId) ??
      AUDIT_UNKNOWN_DAEMON_SESSION_ID,
    connectionGeneration:
      typeof input.connectionGeneration === "number" &&
      Number.isInteger(input.connectionGeneration) &&
      input.connectionGeneration > 0
        ? input.connectionGeneration
        : null,
    leaseEpoch:
      Number.isInteger(input.leaseEpoch) && input.leaseEpoch > 0
        ? input.leaseEpoch
        : AUDIT_UNKNOWN_LEASE_EPOCH,
    replyingHintActive: input.replyingHintActive === true,
  };
};
const resolveDispatchTargetProfileIdentityUnavailableDetails = (
  error: unknown
): {
  message: string;
  reasonCode: string;
  upstreamCode: string | null;
} => {
  if (error instanceof DispatchTargetProfileIdentityUnavailableError) {
    return {
      message: error.message,
      reasonCode: error.reasonCode,
      upstreamCode: error.upstreamCode,
    };
  }
  return {
    message: toErrorMessage(error),
    reasonCode: "dispatch.target_profile_identity.unknown_error",
    upstreamCode: null,
  };
};
const logDispatchTargetProfileIdentityUnavailable = (
  error: unknown,
  logContext: Record<string, unknown>
): {
  message: string;
  reasonCode: string;
} => {
  const details = resolveDispatchTargetProfileIdentityUnavailableDetails(error);
  console.warn(
    "[core.openMeldDaemon.dispatch_target_profile_identity_unavailable]",
    {
      ...logContext,
      error: toErrorMessage(error),
      reasonCode: details.reasonCode,
      ...(details.upstreamCode ? { upstreamCode: details.upstreamCode } : {}),
    }
  );
  return details;
};
const resolveDispatchTargetProfileIdentityOrThrowValidationError =
  async (input: {
    authRpc?: CoreBindings["OPENMELD_AUTH_WORKER"];
    executionContext?: DispatchExecutionContext | null;
    logContext: Record<string, unknown>;
    targetProfileId: string;
  }): Promise<DispatchTargetProfileIdentity> => {
    try {
      return await resolveDispatchTargetProfileIdentity({
        authRpc: input.authRpc,
        targetProfileId: input.targetProfileId,
      });
    } catch (error) {
      const details = logDispatchTargetProfileIdentityUnavailable(
        error,
        input.logContext
      );
      throw buildDispatchExecutionValidationError({
        code: details.reasonCode,
        message: details.message,
        executionContext: input.executionContext,
      });
    }
  };
const resolveAwaitDispatchReplyTargetContext = async (input: {
  authRpc?: CoreBindings["OPENMELD_AUTH_WORKER"];
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  profileHandle?: string | null;
  targetProfileName?: string | null;
  targetProfileMentionLabel?: string | null;
}): Promise<ResolvedAwaitDispatchReplyTargetContext> => {
  const fallbackTargetProfileIdentity =
    input.targetProfileName ||
    input.dispatchMessage.targetProfileNameSnapshot ||
    input.targetProfileMentionLabel ||
    input.dispatchMessage.targetProfileMentionLabel
      ? {
          profileHandle: normalizeOptionalText(input.profileHandle),
          profileName:
            normalizeOptionalText(input.targetProfileName) ??
            normalizeOptionalText(
              input.dispatchMessage.targetProfileNameSnapshot
            ),
        }
      : await resolveDispatchTargetProfileIdentityOrThrowValidationError({
          authRpc: input.authRpc,
          logContext: {
            dispatchId: input.dispatchMessage.dispatchId,
            source: "await_dispatch_reply_target_context",
            targetProfileId: input.dispatchMessage.targetProfileId,
          },
          targetProfileId: input.dispatchMessage.targetProfileId,
        });
  const profileHandle =
    normalizeOptionalText(input.profileHandle) ??
    fallbackTargetProfileIdentity.profileHandle;
  return {
    profileHandle,
    targetProfileMentionLabel:
      normalizeOptionalText(input.targetProfileMentionLabel) ??
      normalizeOptionalText(input.dispatchMessage.targetProfileMentionLabel) ??
      resolveSingleSpaceMentionLabels({
        profileId: input.dispatchMessage.targetProfileId,
        profileName:
          normalizeOptionalText(input.targetProfileName) ??
          normalizeOptionalText(
            input.dispatchMessage.targetProfileNameSnapshot
          ) ??
          fallbackTargetProfileIdentity.profileName,
      }).primaryMentionLabel,
    targetProfileName:
      normalizeOptionalText(input.targetProfileName) ??
      fallbackTargetProfileIdentity.profileName,
  };
};
export const runDispatchExecutionPreflightGate = async (input: {
  env: CoreBindings;
  message: OpenMeldDaemonDispatchQueueMessage;
  timing?: SpaceBootstrapTimingCollector;
}): Promise<DispatchExecutionPreflightResult> => {
  const message = input.message;
  if (
    message.dispatchPolicy !== LEGACY_RUNTIME_DISPATCH_POLICY &&
    message.dispatchPolicy !== "listen_all"
  ) {
    return {
      ok: false,
      errorCode: "dispatch.policy.unsupported",
      errorMessage: `dispatchPolicy ${message.dispatchPolicy} is unsupported`,
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
    };
  }
  const targetBindingResolution = await (input.timing?.measure(
    {
      description: "Resolve Core-owned target Binding and owner",
      name: "openmeld_dispatch_auth",
    },
    () =>
      resolveEffectiveTargetBindingSnapshot({
        authRpc: input.env.OPENMELD_AUTH_WORKER,
        env: input.env,
        message,
        timing: input.timing,
      })
  ) ??
    resolveEffectiveTargetBindingSnapshot({
      authRpc: input.env.OPENMELD_AUTH_WORKER,
      env: input.env,
      message,
      timing: input.timing,
    }));
  if (!targetBindingResolution.ok) {
    return {
      ok: false,
      errorCode: targetBindingResolution.errorCode,
      errorMessage: targetBindingResolution.errorMessage,
      finalStatus: targetBindingResolution.finalStatus,
      bindingSource: targetBindingResolution.source,
      targetOwnerUserId: targetBindingResolution.targetOwnerUserId,
      targetProfileIdentityVerdict:
        targetBindingResolution.targetProfileIdentityVerdict,
    };
  }
  const targetBindingSnapshot = targetBindingResolution.snapshot;
  const targetOwnerUserId = targetBindingSnapshot.ownerUserId ?? undefined;
  if (
    message.deviceWait &&
    !deviceWaitTargetMatches({
      wait: message.deviceWait,
      targetProfileId: message.targetProfileId,
      bindingId: targetBindingSnapshot.bindingId,
      openMeldServiceRuntimeId: targetBindingSnapshot.openMeldServiceRuntimeId,
      runtimeKind: targetBindingSnapshot.runtimeKind,
    })
  ) {
    return {
      ok: false,
      canonicalAdmissionBlock: true,
      errorCode: "local_service.identity_mismatch",
      errorMessage:
        "The Agent's current Binding no longer matches the computer selected for this Wake.",
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      targetOwnerUserId: targetBindingSnapshot.ownerUserId ?? undefined,
      bindingSource: targetBindingResolution.source,
    };
  }
  if (targetBindingSnapshot.bindingState === "missing") {
    return {
      ok: false,
      errorCode: "agent_profile_binding.missing",
      errorMessage: `target profile has no Core primary binding (bindingSource=${targetBindingResolution.source})`,
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      bindingSource: targetBindingResolution.source,
      targetOwnerUserId,
    };
  }
  if (!targetBindingSnapshot.bindingEnabled) {
    return {
      ok: false,
      errorCode: "agent_profile_binding.disabled",
      errorMessage: `target profile Core primary binding is not enabled (bindingSource=${targetBindingResolution.source})`,
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      bindingSource: targetBindingResolution.source,
      targetOwnerUserId,
    };
  }
  if (
    !targetBindingSnapshot.ownerUserId &&
    targetBindingSnapshot.runtimeKind !== "hosted_center_agent"
  ) {
    return {
      ok: false,
      errorCode: "agent_profile_binding.lookup_failed",
      errorMessage: `target profile owner is missing from binding resolution (bindingSource=${targetBindingResolution.source})`,
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      bindingSource: targetBindingResolution.source,
    };
  }
  const canonicalReadinessPromise =
    targetBindingSnapshot.runtimeKind === "openmeld_service"
      ? measureDispatchTiming({
          description: "Resolve canonical Core AgentExecutionReadiness",
          name: "openmeld_dispatch_agent_execution_readiness",
          read: () =>
            resolveCoreAgentExecutionReadinessForProfile({
              activeOrganizationId: message.organizationId ?? null,
              env: input.env,
              generatedAt: new Date().toISOString(),
              includeRuntimeDeviceDisplayName: false,
              profileId: message.targetProfileId,
            }),
          timing: input.timing,
        }).then(
          (readiness) => ({ ok: true as const, readiness }),
          (error: unknown) => ({ error, ok: false as const })
        )
      : Promise.resolve(null);
  const [organizationScope, canonicalReadinessResult] = await Promise.all([
    resolveTargetBindingOrganizationScope({
      bindingId: targetBindingSnapshot.bindingId,
      env: input.env,
      message,
    }),
    canonicalReadinessPromise,
  ]);
  if (!organizationScope.ok) {
    return {
      ok: false,
      errorCode: organizationScope.errorCode,
      errorMessage: organizationScope.errorMessage,
      finalStatus: organizationScope.finalStatus,
      bindingSource: targetBindingResolution.source,
      targetOwnerUserId,
    };
  }
  if (canonicalReadinessResult && !canonicalReadinessResult.ok) {
    return {
      ok: false,
      errorCode: "agent_execution.readiness_lookup_failed",
      errorMessage: `The Agent Profile's current Wake availability could not be checked: ${toErrorMessage(canonicalReadinessResult.error)}`,
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      bindingSource: targetBindingResolution.source,
      targetOwnerUserId,
    };
  }
  if (canonicalReadinessResult) {
    const readinessDecision = resolveCanonicalDispatchPreflight({
      bindingSource: targetBindingResolution.source,
      message,
      organizationId: organizationScope.organizationId,
      readiness: canonicalReadinessResult.readiness,
      targetBindingSnapshot,
    });
    if (readinessDecision) {
      return readinessDecision;
    }
  }
  // Auto-relay revisits are allowed by policy: agents may loop
  // (A -> B -> A -> ...) without a human turn between rounds. The chain
  // telemetry that used to feed the removed cycle gate (dispatchChainId,
  // autoRelayDepth, visitedProfileIds + hash) still rides every hop for the
  // dispatch trace. See "Auto-Relay Loop Policy" in
  // developing/architecture/agent-transport-contract.md.
  //
  // Planned with the dynamic prompt injection system (not built yet):
  // - escalating loop-awareness guidance injected into the dispatch prompt
  //   from autoRelayDepth thresholds;
  // - owner notification plus a per-chain/per-Space pause control;
  // - a machine-speed rate fuse (sustained auto-wakes per minute with no
  //   human signal) that auto-pauses the chain and resumes on one human
  //   message.
  return {
    ok: true,
    effectiveTargetBindingSnapshot: {
      ...targetBindingSnapshot,
      organizationId: organizationScope.organizationId,
    },
    bindingSource: targetBindingResolution.source,
  };
};
function resolveCanonicalDispatchPreflight(input: {
  bindingSource: TargetBindingSource;
  message: OpenMeldDaemonDispatchQueueMessage;
  organizationId: string;
  readiness: Awaited<
    ReturnType<typeof resolveCoreAgentExecutionReadinessForProfile>
  >;
  targetBindingSnapshot: EffectiveTargetBindingSnapshot;
}): DispatchExecutionPreflightResult | null {
  const { message, targetBindingSnapshot } = input;
  const deviceWaitReason = message.deviceWait
    ? resolveDeviceWaitReason(input.readiness)
    : null;
  if (deviceWaitReason) {
    return {
      ok: true,
      deviceWaitReason,
      effectiveTargetBindingSnapshot: {
        ...targetBindingSnapshot,
        organizationId: input.organizationId,
      },
      bindingSource: input.bindingSource,
    };
  }
  const blockReasonCode = resolveAgentWakeAdmissionBlockReasonCode(
    input.readiness.agentExecutionReadiness
  );
  if (
    blockReasonCode &&
    canAdmitContextWithUnavailableDefaultFolder({
      blockReasonCode,
      message,
      readiness: input.readiness.agentExecutionReadiness,
    })
  ) {
    return null;
  }
  if (blockReasonCode) {
    const preparationPending =
      isAgentWakeAdmissionPreparationPendingReason(blockReasonCode);
    return {
      ok: false,
      canonicalAdmissionBlock: !preparationPending,
      errorCode: blockReasonCode,
      errorMessage:
        resolvePublicAgentAvailabilityCopy(blockReasonCode)
          ?.availabilitySummary ??
        "This Agent Profile is unavailable for a new Wake right now.",
      finalStatus: preparationPending
        ? OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable
        : OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      bindingSource: input.bindingSource,
      targetOwnerUserId: targetBindingSnapshot.ownerUserId ?? undefined,
    };
  }
  return null;
}

const DEFAULT_FOLDER_UNAVAILABLE_REASONS = new Set([
  "workspace.missing",
  "workspace.invalid",
  "profile.workspace.missing",
  "profile.workspace.invalid",
  "project.local_connection.missing",
  "project.local_connection.folder_missing",
  "project.local_connection.invalid",
]);
const POSITIVE_RUNTIME_READINESS_REASONS = new Set([
  "runtime.ready",
  "capability.ready",
  "service.ready",
]);

function canAdmitContextWithUnavailableDefaultFolder(input: {
  blockReasonCode: string;
  message: OpenMeldDaemonDispatchQueueMessage;
  readiness: AgentExecutionStatusProjection;
}): boolean {
  // RuntimeCoordinator resolves a resume/fork source only after this preflight.
  // Later checks require a valid selected repository or the owned Space-only workspace.
  const selection = input.message.contextSelection;
  if (
    !(
      (input.message.executionContext?.projectWork ||
        input.message.executionContext?.folderId ||
        input.message.executionContext?.access === "space_context" ||
        (selection?.mode === "new" && selection.projectWork) ||
        (selection?.mode === "new" && selection.folderId) ||
        (selection?.mode === "new" && selection.access === "space_context") ||
        selection?.mode === "resume" ||
        selection?.mode === "fork") &&
      DEFAULT_FOLDER_UNAVAILABLE_REASONS.has(input.blockReasonCode)
    )
  ) {
    return false;
  }
  const { facts } = input.readiness;
  if (
    facts.runtime.ready ||
    !facts.runtime.reasonCodes.some((code) =>
      DEFAULT_FOLDER_UNAVAILABLE_REASONS.has(code)
    ) ||
    facts.runtime.reasonCodes.some(
      (code) =>
        !(
          DEFAULT_FOLDER_UNAVAILABLE_REASONS.has(code) ||
          POSITIVE_RUNTIME_READINESS_REASONS.has(code)
        )
    )
  ) {
    return false;
  }
  return (
    facts.profile.active &&
    facts.binding.routable &&
    facts.binding.reasonCodes.every(
      (code) =>
        code === "agent_profile_binding.enabled_primary" ||
        code === "agent_profile_binding.command_eligible"
    ) &&
    !facts.claim.executionBlocked &&
    !facts.providerAccount.blocked &&
    (!facts.providerConversation.required ||
      facts.providerConversation.ready) &&
    !facts.readinessImpact.blocked &&
    facts.localService.reachable &&
    facts.service.executionCompatible &&
    facts.route.online &&
    [
      ...facts.profile.reasonCodes,
      ...facts.claim.reasonCodes,
      ...facts.providerAccount.reasonCodes,
      ...facts.providerConversation.reasonCodes,
      ...facts.readinessImpact.reasonCodes,
      ...facts.localService.reasonCodes,
      ...facts.service.reasonCodes,
      ...facts.route.reasonCodes,
    ].length === 0
  );
}
export const applyEffectiveTargetBindingSnapshotToMessage = (input: {
  message: OpenMeldDaemonDispatchQueueMessage;
  snapshot: EffectiveTargetBindingSnapshot;
}): OpenMeldDaemonDispatchQueueMessage => {
  const currentAgentControllerRef = normalizeOptionalText(
    input.message.controllerSnapshot.agentControllerRef
  );
  const currentBindingState = input.message.dispatchSnapshot.targetBindingState;
  const currentBindingEnabled =
    input.message.dispatchSnapshot.targetBindingEnabled;
  const controllerSnapshotMatches = areControllerSnapshotsEquivalent({
    leftAgentControllerRef: currentAgentControllerRef,
    rightAgentControllerRef: input.snapshot.agentControllerRef,
  });
  const needsUpdate =
    input.message.controllerSnapshot.bindingId !== input.snapshot.bindingId ||
    input.message.controllerSnapshot.configurationRevision !==
      (input.snapshot.configurationRevision ?? undefined) ||
    currentBindingState !== input.snapshot.bindingState ||
    currentBindingEnabled !== input.snapshot.bindingEnabled ||
    !controllerSnapshotMatches;
  if (!needsUpdate) {
    return input.message;
  }
  return {
    ...input.message,
    controllerSnapshot: {
      ...input.message.controllerSnapshot,
      bindingId: input.snapshot.bindingId,
      ...(typeof input.snapshot.configurationRevision === "number"
        ? { configurationRevision: input.snapshot.configurationRevision }
        : {}),
      targetBindingState: input.snapshot.bindingState,
      targetBindingEnabled: input.snapshot.bindingEnabled,
      agentControllerRef: input.snapshot.agentControllerRef,
    },
    dispatchSnapshot: {
      ...input.message.dispatchSnapshot,
      targetBindingState: input.snapshot.bindingState,
      targetBindingEnabled: input.snapshot.bindingEnabled,
    },
  };
};
const areControllerSnapshotsEquivalent = (input: {
  leftAgentControllerRef: string | null;
  rightAgentControllerRef: string | null;
}): boolean => {
  if (!(input.leftAgentControllerRef || input.rightAgentControllerRef)) {
    return true;
  }
  const left = parseAgentControllerRef(input.leftAgentControllerRef);
  const right = parseAgentControllerRef(input.rightAgentControllerRef);
  return Boolean(left && right && left.ref === right.ref);
};
export const resolveDispatchTargetProfileName = async (input: {
  authRpc?: CoreBindings["OPENMELD_AUTH_WORKER"];
  targetProfileId: string;
}): Promise<string | null> => {
  try {
    return (
      await resolveDispatchTargetProfileIdentity({
        authRpc: input.authRpc,
        targetProfileId: input.targetProfileId,
      })
    ).profileName;
  } catch (error) {
    logDispatchTargetProfileIdentityUnavailable(error, {
      source: "dispatch_failure_hint_target_profile_name",
      targetProfileId: input.targetProfileId,
    });
    return null;
  }
};
const buildDispatchReplyText = (input: {
  executionContext: DispatchExecutionContext;
  runtimeOutput: string;
}): string => {
  const replyBody = input.runtimeOutput.trim();
  if (replyBody.length === 0) {
    throw buildDispatchExecutionValidationError({
      code: "runtime.reply.empty_output",
      message: "runtime.reply.empty_output: runtime output is empty",
      executionContext: input.executionContext,
    });
  }
  return truncateSpaceTextToProtocolLimit(replyBody);
};
const assertDispatchReplyIdentityMetadata: (input: {
  agentControllerConversationId: string | null;
  agentControllerRef: string | null;
  executionContext: DispatchExecutionContext;
}) => asserts input is {
  agentControllerConversationId: string | null;
  agentControllerRef: string;
  executionContext: DispatchExecutionContext;
} = (input) => {
  if (!input.agentControllerRef) {
    throw buildDispatchExecutionValidationError({
      code: "runtime.reply.metadata_missing.agent_controller_ref",
      message:
        "runtime.reply.metadata_missing.agent_controller_ref: agentControllerRef is required for agent reply emission",
      executionContext: input.executionContext,
    });
  }
};
const prepareSuccessfulDispatchReply = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  localStateDb: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionContext: DispatchExecutionContext;
  executionLogBase: Record<string, string>;
  targetOwnerUserId: string;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
}): Promise<PreparedSuccessfulDispatchReply> => {
  const runtimeResult = parseRuntimeTransportTaskResult({
    executionContext: input.executionContext,
    taskResult: input.taskResult,
    expected: {
      attemptId: input.attemptId,
      taskId: input.dispatchMessage.taskId,
      sourceEventId: input.dispatchMessage.sourceEventId,
      targetProfileId: input.dispatchMessage.targetProfileId,
    },
  });
  const agentControllerRef =
    runtimeResult.agentControllerRef ??
    normalizeOptionalText(
      input.dispatchMessage.controllerSnapshot.agentControllerRef
    );
  const identityMetadata = {
    agentControllerConversationId: normalizeOptionalText(
      runtimeResult.agentControllerConversationId
    ),
    agentControllerRef,
    executionContext: input.executionContext,
  };
  assertDispatchReplyIdentityMetadata(identityMetadata);
  const {
    agentControllerConversationId: resolvedAgentControllerConversationId,
    agentControllerRef: resolvedAgentControllerRef,
  } = identityMetadata;
  const openClawBinding = resolveTaskResultOpenClawBinding(input.taskResult);
  await emitDispatchExecutionProjectionDecision({
    attemptId: input.attemptId,
    db: input.db,
    dispatchId: input.dispatchMessage.dispatchId,
    runtimeResult,
  });
  const persistedConversationId = await persistAgentControllerConversationId({
    env: input.env,
    agentControllerConversationId: resolvedAgentControllerConversationId,
    agentControllerRef: resolvedAgentControllerRef,
    db: input.localStateDb,
    dispatchMessage: input.dispatchMessage,
    executionContext: input.executionContext,
    executionLogBase: input.executionLogBase,
    runtimeResult,
    targetOwnerUserId: input.targetOwnerUserId,
  });
  await emitDispatchOpenClawBindingDecisionForSuccess({
    attemptId: input.attemptId,
    binding: openClawBinding,
    bindingPersistence: persistedConversationId,
    db: input.db,
    dispatchId: input.dispatchMessage.dispatchId,
  });
  return {
    agentControllerConversationId: resolvedAgentControllerConversationId,
    agentControllerRef: resolvedAgentControllerRef,
    replyText: buildDispatchReplyText({
      executionContext: input.executionContext,
      runtimeOutput: runtimeResult.output,
    }),
    runtimeResult,
  };
};
const assertRuntimeConversationMetadata = (input: {
  agentControllerConversationId: string | null;
  agentControllerRef: string;
  executionContext: DispatchExecutionContext;
  agentControllerConversation: AgentControllerConversationRef | null;
}): void => {
  if (!input.agentControllerConversation) {
    return;
  }
  const allowsDistinctAgentControllerConversationId =
    builtinAgentControllerAllowsDistinctConversationId(
      normalizeKnownBuiltinAgentControllerId(
        input.agentControllerConversation.agentControllerRef
      ) ?? input.agentControllerConversation.agentControllerRef
    );
  if (
    input.agentControllerConversationId &&
    !allowsDistinctAgentControllerConversationId &&
    input.agentControllerConversation.agentControllerConversationId !==
      input.agentControllerConversationId
  ) {
    throw buildDispatchExecutionValidationError({
      code: "schema.invalid.runtime_response",
      message:
        "runtime transport success result carries mismatched agentControllerConversationId and agentControllerConversation.agentControllerConversationId",
      executionContext: input.executionContext,
    });
  }
  const expectedConversationKind =
    resolveBuiltinAgentControllerConversationKind(
      input.agentControllerConversation.agentControllerRef
    );
  if (
    expectedConversationKind &&
    input.agentControllerConversation.agentControllerConversationKind !==
      expectedConversationKind
  ) {
    throw buildDispatchExecutionValidationError({
      code: "schema.invalid.runtime_response",
      message:
        "runtime transport success result carries mismatched agentControllerConversation.agentControllerConversationKind for builtin controller",
      executionContext: input.executionContext,
    });
  }
  const builtinControllerProviderId = normalizeKnownBuiltinAgentControllerId(
    input.agentControllerRef
  );
  if (
    builtinControllerProviderId &&
    normalizeKnownBuiltinAgentControllerId(
      input.agentControllerConversation.agentControllerRef
    ) !== builtinControllerProviderId
  ) {
    throw buildDispatchExecutionValidationError({
      code: "schema.invalid.runtime_response",
      message:
        "runtime transport success result carries mismatched agentControllerConversation.agentControllerRef for builtin agentControllerRef",
      executionContext: input.executionContext,
    });
  }
};
const mapFailedTaskResultToErrorCode = (errorType: string): string => {
  if (errorType === "network") {
    return "network.transient";
  }
  if (errorType === "timeout") {
    return "timeout";
  }
  if (errorType === "adapter") {
    return "upstream_unreachable";
  }
  if (errorType === "policy") {
    return "dispatch.policy.unsupported";
  }
  if (errorType === "auth") {
    return "permission.denied.runtime";
  }
  if (errorType === "config") {
    return "controller.runtime.missing";
  }
  return "dispatch.execution_failed";
};
const extractErrorCodeFromMessage = (
  value: string | undefined
): string | null => {
  const raw = String(value ?? "").trim();
  if (raw.length === 0) {
    return null;
  }
  const matched = RUNTIME_ERROR_CODE_PREFIX_RE.exec(raw);
  if (!matched) {
    return null;
  }
  const extractedErrorCode = matched[1];
  if (!extractedErrorCode) {
    return null;
  }
  return extractedErrorCode.toLowerCase();
};
const isLegacyRuntimeTaskDedupedMessage = (
  value: string | undefined
): boolean => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  return (
    normalized.startsWith("task deduped") ||
    normalized.includes("task has already been dispatched") ||
    normalized.includes("task deduped within")
  );
};
const resolveFailedTaskResultErrorCode = (input: {
  errorCode: string | undefined;
  errorMessage: string | undefined;
  errorType: string;
  deduped: boolean;
}): string => {
  const directErrorCode = normalizeOptionalText(input.errorCode);
  if (directErrorCode) {
    return directErrorCode;
  }
  const explicitErrorCode = extractErrorCodeFromMessage(input.errorMessage);
  if (explicitErrorCode) {
    return explicitErrorCode;
  }
  if (isLegacyRuntimeTaskDedupedMessage(input.errorMessage)) {
    return RUNTIME_TASK_DEDUPED_ERROR_CODE;
  }
  if (
    input.deduped &&
    !RUNTIME_ERROR_CODE_PREFIX_RE.test(input.errorMessage ?? "")
  ) {
    return RUNTIME_TASK_DEDUPED_ERROR_CODE;
  }
  return mapFailedTaskResultToErrorCode(input.errorType);
};
const resolveRuntimeAgentControllerConversation = (
  payload: OpenMeldDaemonTaskResultEnvelope["payload"]
): AgentControllerConversationRef | null =>
  "agentControllerConversation" in payload
    ? (payload.agentControllerConversation ?? null)
    : null;
const resolveRuntimeBootstrapTemplateFacts = (
  payload: OpenMeldDaemonTaskResultEnvelope["payload"]
): BootstrapTemplateFacts | null =>
  "bootstrapTemplateFacts" in payload
    ? (payload.bootstrapTemplateFacts ?? null)
    : null;
const resolveRuntimeDispatchExecution = (
  payload: OpenMeldDaemonTaskResultEnvelope["payload"]
): DispatchExecution | null =>
  "dispatchExecution" in payload ? (payload.dispatchExecution ?? null) : null;
const resolveRuntimeWorkingDirectory = (
  payload: OpenMeldDaemonTaskResultEnvelope["payload"]
): string | null =>
  "effectiveRuntimeWorkingDirectory" in payload
    ? (normalizeOptionalWorkingDirectory(
        payload.effectiveRuntimeWorkingDirectory
      ) ?? null)
    : null;
const parseSuccessfulRuntimeTransportTaskResult = (
  executionContext: DispatchExecutionContext,
  payload: SuccessfulOpenMeldDaemonTaskResultPayload
): RuntimeDispatchSuccessResult => {
  const agentControllerRef = normalizeOptionalText(payload.agentControllerRef);
  if (!agentControllerRef) {
    throw buildDispatchExecutionValidationError({
      code: "schema.invalid.runtime_response",
      message:
        "runtime transport success result must include non-empty agentControllerRef",
      executionContext,
    });
  }
  const agentControllerConversationId = normalizeOptionalText(
    payload.agentControllerConversationId
  );
  const output = normalizeOptionalText(payload.output);
  if (!output) {
    throw buildDispatchExecutionValidationError({
      code: "schema.invalid.runtime_response",
      message: "runtime transport success result must include non-empty output",
      executionContext,
    });
  }
  const agentControllerConversation =
    resolveRuntimeAgentControllerConversation(payload);
  const bootstrapTemplateFacts = resolveRuntimeBootstrapTemplateFacts(payload);
  const dispatchExecution = resolveRuntimeDispatchExecution(payload);
  const workingDirectory = resolveRuntimeWorkingDirectory(payload);
  assertRuntimeConversationMetadata({
    agentControllerConversationId,
    agentControllerRef,
    executionContext,
    agentControllerConversation,
  });
  return {
    ...("executionContextId" in payload && payload.executionContextId
      ? { executionContextId: payload.executionContextId }
      : {}),
    agentControllerConversationId,
    agentControllerRef,
    output,
    taskId: payload.taskId,
    ...(bootstrapTemplateFacts ? { bootstrapTemplateFacts } : {}),
    ...(dispatchExecution ? { dispatchExecution } : {}),
    ...(agentControllerConversation ? { agentControllerConversation } : {}),
    ...(workingDirectory
      ? { effectiveRuntimeWorkingDirectory: workingDirectory }
      : {}),
  };
};
const parseRuntimeTransportTaskResult = (input: {
  executionContext: DispatchExecutionContext;
  expected: {
    attemptId: string;
    sourceEventId: string;
    targetProfileId: string;
    taskId: string;
  };
  taskResult: OpenMeldDaemonTaskResultEnvelope;
}): RuntimeDispatchSuccessResult => {
  assertRuntimeTransportTaskResultCorrelation(input);
  const payload = input.taskResult.payload;
  if (isSuccessfulRuntimeTaskResultPayload(payload)) {
    return parseSuccessfulRuntimeTransportTaskResult(
      input.executionContext,
      payload
    );
  }
  throw buildFailedTaskResultExecutionError({
    executionContext: input.executionContext,
    payload,
  });
};
const assertRuntimeTransportTaskResultCorrelation = (input: {
  executionContext: DispatchExecutionContext;
  expected: {
    attemptId: string;
    sourceEventId: string;
    targetProfileId: string;
    taskId: string;
  };
  taskResult: OpenMeldDaemonTaskResultEnvelope;
}): void => {
  const { expected } = input;
  const payload = input.taskResult.payload;
  const correlationMismatch: string[] = [];
  const taskResultAttemptId = resolveTaskResultAttemptId(input.taskResult);
  if (taskResultAttemptId && taskResultAttemptId !== expected.attemptId) {
    correlationMismatch.push(
      `attemptId expected ${expected.attemptId}, received ${taskResultAttemptId}`
    );
  }
  if (payload.taskId !== expected.taskId) {
    correlationMismatch.push(
      `taskId expected ${expected.taskId}, received ${payload.taskId}`
    );
  }
  if (payload.sourceEventId !== expected.sourceEventId) {
    correlationMismatch.push(
      `sourceEventId expected ${expected.sourceEventId}, received ${payload.sourceEventId}`
    );
  }
  if (payload.agentId !== expected.targetProfileId) {
    correlationMismatch.push(
      `agentId expected ${expected.targetProfileId}, received ${payload.agentId}`
    );
  }
  if (correlationMismatch.length > 0) {
    throw buildDispatchExecutionValidationError({
      code: "schema.invalid.runtime_response",
      message: `runtime transport result correlation mismatch: ${correlationMismatch.join("; ")}`,
      executionContext: input.executionContext,
    });
  }
};
const classifyFailedTaskResultPayload = (
  payload: Extract<
    OpenMeldDaemonTaskResultEnvelope["payload"],
    {
      status: "failed";
    }
  >
): {
  errorCode: string;
  terminalNoticeEligible: boolean;
} => {
  const errorCode = resolveFailedTaskResultErrorCode({
    deduped: payload.deduped,
    errorCode: payload.errorCode,
    errorMessage: payload.errorMessage,
    errorType: payload.errorType ?? "internal",
  });
  return {
    errorCode,
    terminalNoticeEligible: errorCode !== RUNTIME_TASK_DEDUPED_ERROR_CODE,
  };
};
const buildFailedTaskResultExecutionError = (input: {
  executionContext: DispatchExecutionContext;
  payload: Extract<
    OpenMeldDaemonTaskResultEnvelope["payload"],
    {
      status: "failed";
    }
  >;
  terminalReplySettled?: boolean;
}): DispatchExecutionValidationError => {
  const errorMessage =
    input.payload.errorMessage ?? "daemon runtime task failed";
  return buildDispatchExecutionValidationError({
    code: resolveFailedTaskResultErrorCode({
      deduped: input.payload.deduped,
      errorCode: input.payload.errorCode,
      errorMessage: input.payload.errorMessage,
      errorType: input.payload.errorType ?? "internal",
    }),
    message: errorMessage,
    executionContext: input.executionContext,
    terminalReplySettled: input.terminalReplySettled,
  });
};
const wrapDispatchExecutionError = (input: {
  error: unknown;
  executionContext: DispatchExecutionContext;
  replyingHintTransitionHint?: ReplyingHintTransitionHint | null;
  terminalReplySettled?: boolean;
}): DispatchExecutionValidationError => {
  if (input.error instanceof DispatchExecutionValidationError) {
    return buildDispatchExecutionValidationError({
      code: input.error.code,
      message: input.error.message,
      executionContext: input.executionContext,
      replyingHintTransitionHint:
        input.replyingHintTransitionHint ??
        input.error.replyingHintTransitionHint,
      terminalReplySettled:
        input.terminalReplySettled ?? input.error.terminalReplySettled,
      waitDurationMs: input.error.waitDurationMs,
      waitReasonCode: input.error.waitReasonCode,
    });
  }
  return buildDispatchExecutionValidationError({
    code: resolveDispatchExecutionErrorCode(input.error),
    message: toErrorMessage(input.error),
    executionContext: input.executionContext,
    replyingHintTransitionHint: input.replyingHintTransitionHint,
    terminalReplySettled: input.terminalReplySettled,
  });
};
const resolveTaskResultAttemptId = (
  taskResult: OpenMeldDaemonTaskResultEnvelope
): string | null => {
  const payload = taskResult.payload as {
    attemptId?: unknown;
  };
  if (typeof payload.attemptId !== "string") {
    return null;
  }
  const normalized = payload.attemptId.trim();
  return normalized.length > 0 ? normalized : null;
};
const resolveTaskResultPromptTrace = (
  taskResult: OpenMeldDaemonTaskResultEnvelope
): {
  fingerprint: string | null;
  length: number | null;
  preview: string | null;
} | null => {
  const payload = taskResult.payload as {
    promptTrace?: unknown;
  };
  const promptTrace = payload.promptTrace;
  if (!promptTrace || typeof promptTrace !== "object") {
    return null;
  }
  const fingerprint = normalizeOptionalText(
    (
      promptTrace as {
        fingerprint?: unknown;
      }
    ).fingerprint
  );
  const preview = normalizeOptionalText(
    (
      promptTrace as {
        preview?: unknown;
      }
    ).preview
  );
  const rawLength = (
    promptTrace as {
      length?: unknown;
    }
  ).length;
  const length =
    typeof rawLength === "number" &&
    Number.isInteger(rawLength) &&
    rawLength >= 0
      ? Number(rawLength)
      : null;
  if (!(fingerprint || preview || length !== null)) {
    return null;
  }
  return {
    fingerprint,
    length,
    preview,
  };
};
const resolveTaskResultAgentControllerConversationId = (
  taskResult: OpenMeldDaemonTaskResultEnvelope
): string | null => {
  const payload = taskResult.payload as {
    agentControllerConversationId?: unknown;
  };
  return normalizeOptionalText(payload.agentControllerConversationId);
};
const resolveTaskResultAgentControllerConversation = (
  taskResult: OpenMeldDaemonTaskResultEnvelope
): AgentControllerConversationRef | null => {
  const payload = taskResult.payload as {
    agentControllerConversation?: unknown;
  };
  const agentControllerConversation = payload.agentControllerConversation;
  if (
    !agentControllerConversation ||
    typeof agentControllerConversation !== "object"
  ) {
    return null;
  }
  const agentControllerRef = normalizeOptionalText(
    (
      agentControllerConversation as {
        agentControllerRef?: unknown;
      }
    ).agentControllerRef
  );
  const agentControllerConversationKind = normalizeOptionalText(
    (
      agentControllerConversation as {
        agentControllerConversationKind?: unknown;
      }
    ).agentControllerConversationKind
  );
  const agentControllerConversationId = normalizeOptionalText(
    (
      agentControllerConversation as {
        agentControllerConversationId?: unknown;
      }
    ).agentControllerConversationId
  );
  if (
    !(
      agentControllerRef &&
      agentControllerConversationKind &&
      agentControllerConversationId
    )
  ) {
    return null;
  }
  return {
    agentControllerRef,
    agentControllerConversationKind:
      agentControllerConversationKind === "session" ||
      agentControllerConversationKind === "thread" ||
      agentControllerConversationKind === "context"
        ? agentControllerConversationKind
        : "context",
    agentControllerConversationId,
  } as AgentControllerConversationRef;
};
const resolveTaskResultWorkingDirectory = (
  taskResult: OpenMeldDaemonTaskResultEnvelope
): string | null => {
  const payload = taskResult.payload as {
    effectiveRuntimeWorkingDirectory?: unknown;
  };
  return normalizeOptionalText(payload.effectiveRuntimeWorkingDirectory);
};
const resolveTaskResultRuntimeWorkspaceFingerprint = (
  taskResult: OpenMeldDaemonTaskResultEnvelope
): string | null => {
  const payload = taskResult.payload as {
    runtimeWorkspaceFingerprint?: unknown;
  };
  return normalizeOptionalText(payload.runtimeWorkspaceFingerprint);
};
const resolveTaskResultOpenClawGatewayVisibility = (
  taskResult: OpenMeldDaemonTaskResultEnvelope
): {
  agentId: string | null;
  gatewayRestartAttempted: boolean | null;
  gatewayVisibility: string | null;
} | null => {
  const payload = taskResult.payload as {
    openClawGatewayVisibility?: unknown;
  };
  const rawVisibility = payload.openClawGatewayVisibility;
  if (!rawVisibility || typeof rawVisibility !== "object") {
    return null;
  }
  const agentId = normalizeOptionalText(
    (
      rawVisibility as {
        agentId?: unknown;
      }
    ).agentId
  );
  const gatewayVisibility = normalizeOptionalText(
    (
      rawVisibility as {
        gatewayVisibility?: unknown;
      }
    ).gatewayVisibility
  );
  const rawGatewayRestartAttempted = (
    rawVisibility as {
      gatewayRestartAttempted?: unknown;
    }
  ).gatewayRestartAttempted;
  const gatewayRestartAttempted =
    typeof rawGatewayRestartAttempted === "boolean"
      ? rawGatewayRestartAttempted
      : null;
  if (!(agentId || gatewayVisibility || gatewayRestartAttempted !== null)) {
    return null;
  }
  return {
    agentId,
    gatewayRestartAttempted,
    gatewayVisibility,
  };
};
const resolveTaskResultOpenClawBinding = (
  taskResult: OpenMeldDaemonTaskResultEnvelope
): DispatchOpenClawBindingDecisionPayload["classification"] | null => {
  const payload = taskResult.payload as {
    openClawBinding?: unknown;
  };
  const rawBinding = payload.openClawBinding;
  if (!rawBinding || typeof rawBinding !== "object") {
    return null;
  }
  const classification = normalizeOptionalText(
    (
      rawBinding as {
        classification?: unknown;
      }
    ).classification
  );
  switch (classification) {
    case "canonical_owned":
    case "foreign":
    case "legacy":
    case "missing":
      return classification;
    default:
      return null;
  }
};
const emitDispatchStreamingTelemetryDecision = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  dispatchId: string;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
}): Promise<void> => {
  const telemetry = resolveTaskResultTelemetry(input.taskResult);
  if (!telemetry) {
    return;
  }
  try {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: DISPATCH_STREAMING_TELEMETRY_DECISION_CODE,
      decisionPayload: {
        attemptId: input.attemptId,
        ...telemetry,
      },
      decidedBy: "dispatch-execution-service",
      decidedAtMs: Date.now(),
      source: "core",
      correlationId: input.dispatchId,
    });
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.streaming_telemetry_write_failed]",
      {
        event: CORE_LOG_EVENTS.opsDecisionWriteFailed,
        dispatchId: input.dispatchId,
        attemptId: input.attemptId,
        decisionCode: DISPATCH_STREAMING_TELEMETRY_DECISION_CODE,
        error: toErrorMessage(error),
      }
    );
  }
};
const emitDispatchExecutionLifecycleDecision = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  dispatchId: string;
  lifecycle: RuntimeTransportDispatchLifecycleSnapshot;
  progressEvidenceState: "active" | "stalled" | "unknown";
}): Promise<void> => {
  try {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: DISPATCH_EXECUTION_LIFECYCLE_DECISION_CODE,
      decisionPayload: {
        attemptId: input.attemptId,
        finalizationTimeoutMs: DEFAULT_DISPATCH_FINALIZATION_TIMEOUT_MS,
        lastLifecycleAtMs: input.lifecycle.lastLifecycleAtMs,
        phase: input.lifecycle.phase,
        phaseEnteredAtMs: resolveLifecyclePhaseEnteredAtMs(input.lifecycle),
        progressEvidenceState: input.progressEvidenceState,
        startTimeoutMs: DEFAULT_DISPATCH_START_TIMEOUT_MS,
        taskProgressEvidenceStaleAfterMs:
          DEFAULT_TASK_PROGRESS_EVIDENCE_STALE_AFTER_MS,
        waitWindowMs: RUNTIME_TRANSPORT_WAIT_RESULT_TIMEOUT_MS,
      } satisfies DispatchExecutionLifecycleDecisionPayload,
      decidedBy: "dispatch-execution-service",
      decidedAtMs: Date.now(),
      source: "core",
      correlationId: input.dispatchId,
    });
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.lifecycle_trace_write_failed]",
      {
        event: CORE_LOG_EVENTS.opsDecisionWriteFailed,
        dispatchId: input.dispatchId,
        attemptId: input.attemptId,
        decisionCode: DISPATCH_EXECUTION_LIFECYCLE_DECISION_CODE,
        error: toErrorMessage(error),
      }
    );
  }
};
const emitDispatchRuntimeTelemetryDecision = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  dispatchId: string;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
}): Promise<void> => {
  const telemetry = resolveTaskResultTelemetry(input.taskResult);
  if (!telemetry) {
    await emitDispatchRuntimeTelemetryMissingDecision(input);
    return;
  }
  const promptTrace = resolveTaskResultPromptTrace(input.taskResult);
  const openClawGatewayVisibility = resolveTaskResultOpenClawGatewayVisibility(
    input.taskResult
  );
  const agentControllerConversation =
    resolveTaskResultAgentControllerConversation(input.taskResult);
  try {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: DISPATCH_RUNTIME_TELEMETRY_DECISION_CODE,
      decisionPayload: {
        agentControllerConversationId:
          resolveTaskResultAgentControllerConversationId(input.taskResult),
        attemptId: input.attemptId,
        exitCode: telemetry.exitCode,
        exitObservedAtMs: telemetry.exitObservedAtMs,
        exitSignal: telemetry.exitSignal,
        firstStderrAtMs: telemetry.firstStderrAtMs,
        openClawGatewayAgentId: openClawGatewayVisibility?.agentId ?? null,
        openClawGatewayRestartAttempted:
          openClawGatewayVisibility?.gatewayRestartAttempted ?? null,
        openClawGatewayVisibility:
          openClawGatewayVisibility?.gatewayVisibility ?? null,
        promptFingerprint: promptTrace?.fingerprint ?? null,
        promptLength: promptTrace?.length ?? null,
        promptPreview: promptTrace?.preview ?? null,
        processId: telemetry.processId,
        processSpawnedAtMs: telemetry.processSpawnedAtMs,
        stdinClosedAtMs: telemetry.stdinClosedAtMs,
        timeoutTriggeredAtMs: telemetry.timeoutTriggeredAtMs,
        agentControllerRef:
          agentControllerConversation?.agentControllerRef ?? null,
        resolvedAgentControllerConversationId:
          agentControllerConversation?.agentControllerConversationId ?? null,
        agentControllerConversationKind:
          agentControllerConversation?.agentControllerConversationKind ?? null,
        effectiveRuntimeWorkingDirectory: resolveTaskResultWorkingDirectory(
          input.taskResult
        ),
        runtimeWorkspaceFingerprint:
          resolveTaskResultRuntimeWorkspaceFingerprint(input.taskResult),
      },
      decidedBy: "dispatch-execution-service",
      decidedAtMs: Date.now(),
      source: "core",
      correlationId: input.dispatchId,
    });
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.runtime_telemetry_write_failed]",
      {
        event: CORE_LOG_EVENTS.opsDecisionWriteFailed,
        dispatchId: input.dispatchId,
        attemptId: input.attemptId,
        decisionCode: DISPATCH_RUNTIME_TELEMETRY_DECISION_CODE,
        error: toErrorMessage(error),
      }
    );
  }
};
const emitDispatchRuntimeTelemetryMissingDecision = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  dispatchId: string;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
}): Promise<void> => {
  const payload = input.taskResult.payload;
  if (!isRuntimeTaskResultStatusSuccessLike(payload.status)) {
    return;
  }
  try {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: DISPATCH_RUNTIME_TELEMETRY_MISSING_DECISION_CODE,
      decisionPayload: {
        attemptId: input.attemptId,
        agentControllerRef:
          "agentControllerRef" in payload &&
          typeof payload.agentControllerRef === "string"
            ? payload.agentControllerRef
            : null,
        status: payload.status,
      },
      decidedBy: "dispatch-execution-service",
      decidedAtMs: Date.now(),
      source: "core",
      correlationId: input.dispatchId,
    });
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.runtime_telemetry_missing_write_failed]",
      {
        event: CORE_LOG_EVENTS.opsDecisionWriteFailed,
        dispatchId: input.dispatchId,
        attemptId: input.attemptId,
        decisionCode: DISPATCH_RUNTIME_TELEMETRY_MISSING_DECISION_CODE,
        error: toErrorMessage(error),
      }
    );
  }
};
const emitDispatchStructuredActionFailureDecision = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  dispatchId: string;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
}): Promise<void> => {
  const payload = input.taskResult.payload;
  const failureDiagnostics =
    "spaceActionFailureDiagnostics" in payload
      ? payload.spaceActionFailureDiagnostics
      : undefined;
  if (
    payload.status !== "failed" ||
    payload.errorCode !== "openmeld.space_action.repair_failed" ||
    !failureDiagnostics
  ) {
    return;
  }
  try {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: DISPATCH_STRUCTURED_ACTION_FAILURE_DECISION_CODE,
      decisionPayload: {
        attemptId: input.attemptId,
        ...failureDiagnostics,
      },
      decidedBy: "dispatch-execution-service",
      decidedAtMs: Date.now(),
      source: "core",
      correlationId: input.dispatchId,
    });
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.structured_action_failure_write_failed]",
      {
        event: CORE_LOG_EVENTS.opsDecisionWriteFailed,
        dispatchId: input.dispatchId,
        attemptId: input.attemptId,
        decisionCode: DISPATCH_STRUCTURED_ACTION_FAILURE_DECISION_CODE,
        error: toErrorMessage(error),
      }
    );
  }
};
const emitDispatchExecutionProjectionDecision = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  dispatchId: string;
  runtimeResult: RuntimeDispatchSuccessResult;
}): Promise<void> => {
  if (!input.runtimeResult.dispatchExecution) {
    return;
  }
  try {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: DISPATCH_CONVERSATION_LIFECYCLE_DECISION_CODE,
      decisionPayload: {
        attemptId: input.attemptId,
        ...input.runtimeResult.dispatchExecution,
      },
      decidedBy: "dispatch-execution-service",
      decidedAtMs: Date.now(),
      source: "core",
      correlationId: input.dispatchId,
    });
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.dispatch_execution_write_failed]",
      {
        event: CORE_LOG_EVENTS.opsDecisionWriteFailed,
        dispatchId: input.dispatchId,
        attemptId: input.attemptId,
        decisionCode: DISPATCH_CONVERSATION_LIFECYCLE_DECISION_CODE,
        error: toErrorMessage(error),
      }
    );
  }
};
const emitDispatchOpenClawBindingDecision = async (input: {
  attemptId: string;
  bindingDiagnostics: DispatchOpenClawBindingDecisionPayload;
  db: PostgresDatabase;
  dispatchId: string;
}): Promise<void> => {
  try {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: DISPATCH_OPENCLAW_BINDING_DECISION_CODE,
      decisionPayload: {
        attemptId: input.attemptId,
        bindingSource: input.bindingDiagnostics.bindingSource,
        classification: input.bindingDiagnostics.classification,
        upgradeApplied: input.bindingDiagnostics.upgradeApplied,
      } satisfies DispatchOpenClawBindingDecisionPayload,
      decidedBy: "dispatch-execution-service",
      decidedAtMs: Date.now(),
      source: "core",
      correlationId: input.dispatchId,
    });
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.openclaw_binding_trace_write_failed]",
      {
        event: CORE_LOG_EVENTS.opsDecisionWriteFailed,
        dispatchId: input.dispatchId,
        attemptId: input.attemptId,
        decisionCode: DISPATCH_OPENCLAW_BINDING_DECISION_CODE,
        error: toErrorMessage(error),
      }
    );
  }
};
const emitDispatchOpenClawBindingDecisionForFailure = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  dispatchId: string;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
}): Promise<void> => {
  const classification = resolveTaskResultOpenClawBinding(input.taskResult);
  if (!classification) {
    return;
  }
  await emitDispatchOpenClawBindingDecision({
    attemptId: input.attemptId,
    bindingDiagnostics: {
      attemptId: input.attemptId,
      bindingSource: null,
      classification,
      upgradeApplied: false,
    },
    db: input.db,
    dispatchId: input.dispatchId,
  });
};
const emitDispatchOpenClawBindingDecisionForSuccess = async (input: {
  attemptId: string;
  binding: DispatchOpenClawBindingDecisionPayload["classification"] | null;
  bindingPersistence: PersistAgentControllerConversationIdResult;
  db: PostgresDatabase;
  dispatchId: string;
}): Promise<void> => {
  if (!input.binding) {
    return;
  }
  await emitDispatchOpenClawBindingDecision({
    attemptId: input.attemptId,
    bindingDiagnostics: {
      attemptId: input.attemptId,
      bindingSource: input.bindingPersistence.bindingSource,
      classification: input.binding,
      upgradeApplied:
        input.binding === "legacy" && input.bindingPersistence.updateApplied,
    },
    db: input.db,
    dispatchId: input.dispatchId,
  });
};
const resolveTaskResultTelemetry = (
  taskResult: OpenMeldDaemonTaskResultEnvelope
): {
  completedAtMs: number;
  exitCode: number | null;
  exitObservedAtMs: number | null;
  exitSignal: string | null;
  firstOutputAtMs: number | null;
  firstStderrAtMs: number | null;
  firstStdoutAtMs: number | null;
  invokedAtMs: number;
  processId: number | null;
  processSpawnedAtMs: number | null;
  previewEmitted: boolean;
  stdinClosedAtMs: number | null;
  streamingMode: "final" | "stream";
  timeoutTriggeredAtMs: number | null;
} | null => {
  const payload = taskResult.payload as {
    telemetry?: {
      completedAtMs?: unknown;
      exitCode?: unknown;
      exitObservedAtMs?: unknown;
      exitSignal?: unknown;
      firstOutputAtMs?: unknown;
      firstStderrAtMs?: unknown;
      firstStdoutAtMs?: unknown;
      invokedAtMs?: unknown;
      processId?: unknown;
      processSpawnedAtMs?: unknown;
      previewEmitted?: unknown;
      stdinClosedAtMs?: unknown;
      streamingMode?: unknown;
      timeoutTriggeredAtMs?: unknown;
    };
  };
  const telemetry =
    payload.telemetry && typeof payload.telemetry === "object"
      ? payload.telemetry
      : null;
  if (!telemetry) {
    return null;
  }
  const completedAtMs = toTelemetryTimestamp(telemetry.completedAtMs);
  const invokedAtMs = toTelemetryTimestamp(telemetry.invokedAtMs);
  const streamingMode =
    telemetry.streamingMode === "stream" ? "stream" : "final";
  if (!(completedAtMs !== null && invokedAtMs !== null)) {
    return null;
  }
  const processIdValue =
    typeof telemetry.processId === "number" &&
    Number.isInteger(telemetry.processId) &&
    telemetry.processId > 0
      ? Number(telemetry.processId)
      : null;
  return {
    completedAtMs,
    exitCode:
      Number.isInteger(telemetry.exitCode) || telemetry.exitCode === null
        ? (telemetry.exitCode as number | null)
        : null,
    exitObservedAtMs: toTelemetryTimestamp(telemetry.exitObservedAtMs),
    exitSignal:
      typeof telemetry.exitSignal === "string" && telemetry.exitSignal.trim()
        ? telemetry.exitSignal
        : null,
    firstOutputAtMs: toTelemetryTimestamp(telemetry.firstOutputAtMs),
    firstStderrAtMs: toTelemetryTimestamp(telemetry.firstStderrAtMs),
    firstStdoutAtMs: toTelemetryTimestamp(telemetry.firstStdoutAtMs),
    invokedAtMs,
    processId: processIdValue,
    processSpawnedAtMs: toTelemetryTimestamp(telemetry.processSpawnedAtMs),
    previewEmitted: telemetry.previewEmitted === true,
    stdinClosedAtMs: toTelemetryTimestamp(telemetry.stdinClosedAtMs),
    streamingMode,
    timeoutTriggeredAtMs: toTelemetryTimestamp(telemetry.timeoutTriggeredAtMs),
  };
};
const shouldEmitConversationContinuityWarning = (
  taskResult: OpenMeldDaemonTaskResultEnvelope
): boolean => {
  const payload = taskResult.payload as {
    dispatchExecution?: {
      agentControllerConversationResume?: {
        status?: unknown;
      };
    };
  };
  return (
    payload.dispatchExecution?.agentControllerConversationResume?.status ===
    "replaced_by_provider"
  );
};
const buildConversationContinuityWarningText = (input: {
  targetProfileLabel: string;
}): string => {
  const normalizedLabel = normalizeOptionalText(input.targetProfileLabel);
  const label = normalizedLabel ?? "agent";
  const baseText = `⚠️ ${label} conversation ID rotated unexpectedly; OpenMeld adopted the new ID to keep replies working.`;
  return baseText.length <= DISPATCH_CONTINUITY_WARNING_TEXT_MAX_LENGTH
    ? baseText
    : `${baseText.slice(0, DISPATCH_CONTINUITY_WARNING_TEXT_MAX_LENGTH - 3).trimEnd()}...`;
};
const persistAgentControllerConversationId = async (input: {
  env: CoreBindings;
  agentControllerConversationId: string | null;
  agentControllerRef: string;
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  executionContext: DispatchExecutionContext;
  executionLogBase: Record<string, string>;
  runtimeResult: RuntimeDispatchSuccessResult;
  targetOwnerUserId: string;
}): Promise<PersistAgentControllerConversationIdResult> => {
  if (input.runtimeResult.executionContextId) {
    return { bindingSource: null, updateApplied: false };
  }
  if (
    await keepsColleagueConversationOffBinding({
      agentControllerRef: input.agentControllerRef,
      env: input.env,
      message: input.dispatchMessage,
      targetOwnerUserId: input.targetOwnerUserId,
    })
  ) {
    // A colleague's conversation never becomes the owner's Binding one.
    return { bindingSource: null, updateApplied: false };
  }
  const nextConversationId = normalizeOptionalText(
    input.runtimeResult.agentControllerConversation
      ?.agentControllerConversationId ?? input.agentControllerConversationId
  );
  if (!nextConversationId) {
    console.info(
      "[core.openMeldDaemon.dispatch_execution.agent_controller_conversation_update_skipped]",
      {
        ...input.executionLogBase,
        daemonSessionId: input.executionContext.daemonSessionId,
        leaseEpoch: input.executionContext.leaseEpoch,
        hasAgentControllerConversationId: Boolean(
          input.agentControllerConversationId
        ),
        hasAgentControllerConversation: Boolean(
          input.runtimeResult.agentControllerConversation
        ),
      }
    );
    return {
      bindingSource: null,
      updateApplied: false,
    };
  }
  const operationId = `legacy-conversation:${crypto.randomUUID()}`;
  const mutation =
    await acquireRuntimeTransportAgentProfileLegacyConversationMutation({
      agentControllerRef: input.agentControllerRef,
      env: input.env,
      operationId,
      ownerUserId: input.targetOwnerUserId,
      targetProfileId: input.dispatchMessage.targetProfileId,
    });
  if (mutation.status !== "acquired") {
    console.warn("[core.legacy_conversation.write_fenced]", {
      reasonCode: mutation.reasonCode,
      targetProfileId: input.dispatchMessage.targetProfileId,
    });
    return { bindingSource: null, updateApplied: false };
  }
  try {
    const currentBinding = await readPrimaryAgentProfileBindingRecord({
      agentProfileId: input.dispatchMessage.targetProfileId,
      db: input.db,
      owner: {
        id: input.targetOwnerUserId,
        kind: "owner_account",
      },
    });
    if (currentBinding?.bindingState !== "enabled_primary") {
      console.info(
        "[core.openMeldDaemon.dispatch_execution.agent_controller_conversation_update_skipped]",
        {
          ...input.executionLogBase,
          daemonSessionId: input.executionContext.daemonSessionId,
          leaseEpoch: input.executionContext.leaseEpoch,
          reason: currentBinding ? "binding_not_enabled" : "binding_missing",
        }
      );
      return {
        bindingSource: null,
        updateApplied: false,
      };
    }
    if (currentBinding.agentControllerRef !== input.agentControllerRef) {
      console.warn(
        "[core.openMeldDaemon.dispatch_execution.agent_controller_conversation_update_blocked]",
        {
          ...input.executionLogBase,
          daemonSessionId: input.executionContext.daemonSessionId,
          leaseEpoch: input.executionContext.leaseEpoch,
          bindingAgentControllerRef: currentBinding.agentControllerRef,
          runtimeAgentControllerRef: input.agentControllerRef,
        }
      );
      return {
        bindingSource: null,
        updateApplied: false,
      };
    }
    if (
      normalizeOptionalText(currentBinding.agentControllerConversationId) ===
      nextConversationId
    ) {
      return {
        bindingSource: "agent_profile",
        updateApplied: false,
      };
    }
    const conversationConflict =
      await readPrimaryAgentProfileBindingRecordByControllerConversation({
        agentControllerConversationId: nextConversationId,
        agentControllerRef: input.agentControllerRef,
        db: input.db,
        excludeAgentProfileId: input.dispatchMessage.targetProfileId,
        owner: {
          id: input.targetOwnerUserId,
          kind: "owner_account",
        },
      });
    if (conversationConflict) {
      console.warn(
        "[core.openMeldDaemon.dispatch_execution.agent_controller_conversation_update_blocked]",
        {
          ...input.executionLogBase,
          daemonSessionId: input.executionContext.daemonSessionId,
          leaseEpoch: input.executionContext.leaseEpoch,
          reason: "controller_conversation_conflict",
          conflictingAgentProfileId: conversationConflict.agentProfileId,
          agentControllerConversationId: nextConversationId,
          agentControllerRef: input.agentControllerRef,
        }
      );
      return {
        bindingSource: null,
        updateApplied: false,
      };
    }
    const updatedBinding = await updatePrimaryAgentProfileBindingConversationId(
      {
        agentControllerConversationId: nextConversationId,
        agentProfileId: input.dispatchMessage.targetProfileId,
        bindingId: currentBinding.bindingId,
        db: input.db,
        owner: {
          id: input.targetOwnerUserId,
          kind: "owner_account",
        },
        updatedAtMs: Date.now(),
      }
    );
    if (!updatedBinding) {
      console.warn(
        "[core.openMeldDaemon.dispatch_execution.agent_controller_conversation_update_blocked]",
        {
          ...input.executionLogBase,
          reason: "binding_update_conflict",
          agentControllerRef: input.agentControllerRef,
        }
      );
      return { bindingSource: null, updateApplied: false };
    }
    console.info(
      "[core.openMeldDaemon.dispatch_execution.agent_controller_conversation_update_succeeded]",
      {
        ...input.executionLogBase,
        daemonSessionId: input.executionContext.daemonSessionId,
        leaseEpoch: input.executionContext.leaseEpoch,
        agentControllerConversationId: nextConversationId,
        agentControllerRef: input.agentControllerRef,
      }
    );
    return {
      bindingSource: "agent_profile",
      updateApplied: true,
    };
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.agent_controller_conversation_update_failed]",
      {
        ...input.executionLogBase,
        daemonSessionId: input.executionContext.daemonSessionId,
        error: toErrorMessage(error),
        leaseEpoch: input.executionContext.leaseEpoch,
      }
    );
    return {
      bindingSource: null,
      updateApplied: false,
    };
  } finally {
    await releaseRuntimeTransportAgentProfileExecutionTargetMutation({
      env: input.env,
      operationId,
      ownerUserId: input.targetOwnerUserId,
      targetProfileId: input.dispatchMessage.targetProfileId,
    });
  }
};
function resolveDeliveredThreadContext(
  receipt: AgentTransportSpaceActionDeliveryReceipt,
  sourceThreadContext: SpaceThreadContext | null
): SpaceThreadContext | null {
  return receipt.threadContext === undefined
    ? sourceThreadContext
    : receipt.threadContext;
}
const emitDispatchReplySignals = async (input: {
  agentControllerConversationId: string | null;
  attemptId: string;
  agentControllerRef: string;
  db: PostgresDatabase;
  deliverAgentTransportSpaceAction?: AgentTransportSpaceActionDeliveryPort;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionContext: DispatchExecutionContext;
  executionLogBase: Record<string, string>;
  finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
  recordPublicationProjection: boolean;
  replyText: string;
  targetOwnerUserId: string;
  profileHandle: string | null;
  targetProfileMentionLabel: string | null;
  targetProfileName: string | null;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
}): Promise<{
  publishedSignalId: string | null;
  publishState: "invalid_space_action" | "reply_published";
}> => {
  const payload = input.taskResult.payload;
  if (!isSuccessfulRuntimeTaskResultPayload(payload)) {
    throw buildDispatchExecutionValidationError({
      code: "schema.invalid.runtime_response",
      message:
        "successful reply emission requires a success-like runtime task result payload",
      executionContext: input.executionContext,
    });
  }
  const publicationPlan = resolveDispatchPublicationPlan({
    actorName: input.targetProfileName,
    dispatchMessage: input.dispatchMessage,
    payload,
    replyText: input.replyText,
    targetProfileName: input.targetProfileName,
  });
  if (publicationPlan.blockedExplicitAction) {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: "dispatch.reply.policy_blocked_explicit_action",
      decisionPayload: {
        attemptId: input.attemptId,
        dispatchId: input.dispatchMessage.dispatchId,
        targetProfileId: input.dispatchMessage.targetProfileId,
      },
      decidedBy: "dispatch-execution-service",
      decidedAtMs: Date.now(),
      source: "dispatch_execution",
      correlationId: input.dispatchMessage.dispatchId,
    }).catch(() => undefined);
  }
  const resultRef = publicationPlan.shouldArchive
    ? buildDispatchResultRef(input.dispatchMessage.dispatchId)
    : null;
  const agentControllerConversation =
    resolveRuntimeAgentControllerConversation(payload);
  const workingDirectory = resolveRuntimeWorkingDirectory(payload);
  const archivedMessageEnvelope: MessageEnvelope | null =
    publicationPlan.kind === "message"
      ? buildCanonicalDispatchReplyMessageEnvelope({
          dispatchMessage: input.dispatchMessage,
          messageEnvelope: publicationPlan.messageEnvelope,
          replyText: publicationPlan.text,
        })
      : null;
  let emittedSignal: SignalEnvelope | null = null;
  let publishedThreadContext = input.dispatchMessage.threadContext ?? null;
  if (
    input.deliverAgentTransportSpaceAction &&
    (publicationPlan.kind === "message" ||
      publicationPlan.kind === "status" ||
      publicationPlan.kind === "system_notice")
  ) {
    const emission = await deliverPublicationPlanWithClaim({
      agentControllerConversationId: input.agentControllerConversationId,
      attemptId: input.attemptId,
      agentControllerRef: input.agentControllerRef,
      db: input.db,
      deliverAgentTransportSpaceAction: input.deliverAgentTransportSpaceAction,
      dispatchMessage: input.dispatchMessage,
      executionContext: input.executionContext,
      finalOutcomeAuthority: input.finalOutcomeAuthority,
      messageEnvelope: archivedMessageEnvelope,
      plan: publicationPlan,
      profileHandle: input.profileHandle,
      resultRef,
      targetOwnerUserId: input.targetOwnerUserId,
      targetProfileMentionLabel: input.targetProfileMentionLabel,
      targetProfileName: input.targetProfileName,
      agentControllerConversation,
      workingDirectory,
    });
    emittedSignal = emission.emittedSignal;
    publishedThreadContext = resolveDeliveredThreadContext(
      emission,
      publishedThreadContext
    );
  } else if (publicationPlan.kind === "message") {
    emittedSignal = await emitDispatchTextReplySignal({
      ...input,
      finalOutcomeAuthority: input.finalOutcomeAuthority,
      messageEnvelope: archivedMessageEnvelope,
      agentControllerConversation,
      workingDirectory,
      replyText: publicationPlan.text,
    });
  } else if (publicationPlan.kind === "status") {
    const emission = await emitStatusReplySignal({
      agentControllerConversationId: input.agentControllerConversationId,
      attemptId: input.attemptId,
      agentControllerRef: input.agentControllerRef,
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      executionContext: input.executionContext,
      finalOutcomeAuthority: input.finalOutcomeAuthority,
      agentControllerConversation,
      workingDirectory,
      plan: publicationPlan,
      resultRef,
      targetOwnerUserId: input.targetOwnerUserId,
      profileHandle: input.profileHandle,
      targetProfileMentionLabel: input.targetProfileMentionLabel,
      targetProfileName: input.targetProfileName,
    });
    emittedSignal = emission.emittedSignal;
  } else if (publicationPlan.kind === "system_notice") {
    const emission = await emitSystemNoticeReplySignal({
      attemptId: input.attemptId,
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      finalOutcomeAuthority: input.finalOutcomeAuthority,
      plan: publicationPlan,
      resultRef,
      targetProfileName: input.targetProfileName,
      agentControllerConversation,
      workingDirectory,
    });
    emittedSignal = emission.emittedSignal;
  }
  if (publicationPlan.kind === "none") {
    return {
      publishedSignalId: null,
      publishState: "invalid_space_action",
    };
  }
  console.info(
    "[core.openMeldDaemon.dispatch_execution.publication_resolved]",
    {
      dispatchId: input.dispatchMessage.dispatchId,
      messageEnvelopeMode: resolvePublicationMessageEnvelopeMode({
        payload,
        publicationPlan,
      }),
      publicationKind: publicationPlan.kind,
      publicOutcome: publicationPlan.publicOutcome,
      publishedSignalId: emittedSignal?.id ?? null,
      replyToSignalId: resolveArchivedReplyToSignalId({
        dispatchReplyToSignalId:
          input.dispatchMessage.replyToSnapshot?.signalId ?? null,
        emittedSignal,
        plan: publicationPlan,
      }),
      targetProfileId: input.dispatchMessage.targetProfileId,
    }
  );
  try {
    await finalizePublishedDispatchReply({
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      emittedSignal,
      env: input.env,
      executionContext: input.executionContext,
      executionLogBase: input.executionLogBase,
      archivedMessageEnvelope,
      plan: publicationPlan,
      publishedThreadContext,
      recordPublicationProjection: input.recordPublicationProjection,
      runtimeOutput: payload.output,
      targetProfileName: input.targetProfileName,
      taskResult: input.taskResult,
    });
  } catch (error) {
    if (input.recordPublicationProjection) {
      await recordDispatchResultInboxPublicationFailureProjection({
        attemptId: input.attemptId,
        db: input.db,
        dispatchId: input.dispatchMessage.dispatchId,
        errorCode: resolveDispatchExecutionErrorCode(error),
        spaceId: input.dispatchMessage.spaceId,
        targetProfileId: input.dispatchMessage.targetProfileId,
      });
    }
    throw normalizePostPublicationDispatchError({
      emittedSignal,
      error,
      executionContext: input.executionContext,
    });
  }
  return {
    publishedSignalId: emittedSignal?.id ?? null,
    publishState:
      emittedSignal && !publicationPlan.blockedExplicitAction
        ? "reply_published"
        : "invalid_space_action",
  };
  function resolvePublicationMessageEnvelopeMode(input: {
    payload: OpenMeldDaemonTaskResultEnvelope["payload"];
    publicationPlan: DispatchPublicationPlan;
  }): "absent" | "preserved" | "synthesized" {
    if (input.publicationPlan.kind !== "message") {
      return "absent";
    }
    const spaceAction =
      typeof input.payload === "object" &&
      input.payload &&
      "spaceAction" in input.payload
        ? input.payload.spaceAction
        : undefined;
    if (spaceAction?.type === "post_message") {
      return "preserved";
    }
    return "synthesized";
  }
};
const emitSystemNoticeReplySignal = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
  plan: Extract<
    DispatchPublicationPlan,
    {
      kind: "system_notice";
    }
  >;
  resultRef: string | null;
  targetProfileName: string | null;
  agentControllerConversation: AgentControllerConversationRef | null;
  workingDirectory: string | null;
}): Promise<{
  emittedSignal: SignalEnvelope | null;
  finalReplySettled: boolean;
}> => {
  const replyClaimedAtMs = Date.now();
  const replyClaimState = await claimFinalReplyEmission({
    db: input.db,
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    nowMs: replyClaimedAtMs,
  });
  if (replyClaimState === "already_claimed") {
    return {
      emittedSignal: null,
      finalReplySettled: true,
    };
  }
  let shouldRollbackReplyClaim = replyClaimState === "claimed";
  try {
    const requestContext = buildDispatchSystemRequestContext({
      message: input.dispatchMessage,
      requestIdPrefix: "openMeldDaemon-system-notice",
    });
    const signal = await emitSpaceSystemNoticeSignal({
      env: input.env,
      finalOutcomeAuthority: input.finalOutcomeAuthority,
      spaceId: input.dispatchMessage.spaceId,
      profile: {
        kind: "system",
        profileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
        profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
      },
      data: {
        noticeType: input.plan.noticeType,
        actorProfileId: input.dispatchMessage.targetProfileId,
        coreReadinessFactsChanged: {
          agentProfileId: input.dispatchMessage.targetProfileId,
          kind: CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
        },
        ...(input.targetProfileName
          ? { actorName: input.targetProfileName }
          : {}),
        dispatchId: input.dispatchMessage.dispatchId,
        ...(input.resultRef ? { resultRef: input.resultRef } : {}),
        ...(input.dispatchMessage.replyToSnapshot
          ? { replyTo: input.dispatchMessage.replyToSnapshot }
          : {}),
        ...(input.plan.reason ? { reason: input.plan.reason } : {}),
        ...(input.plan.reasonCode ? { reasonCode: input.plan.reasonCode } : {}),
        // This publisher announces the agent's own settled failed outcome
        // (the accepted task result), never a broken OpenMeld reply
        // publication, so the failure stage is always "execution" here.
        ...(input.plan.noticeType === "terminal_failure"
          ? { failureStage: "execution" as const }
          : {}),
        text: input.plan.text,
        generatedBy: "openmeld",
      },
      spaceAccess: buildDispatchContinuationSpaceAccess({
        attemptId: input.attemptId,
        message: input.dispatchMessage,
        requestContext,
      }),
      ...(input.dispatchMessage.threadContext
        ? { threadContext: input.dispatchMessage.threadContext }
        : {}),
      context: requestContext,
    });
    shouldRollbackReplyClaim = false;
    return {
      emittedSignal: signal,
      finalReplySettled: true,
    };
  } catch (error) {
    if (shouldRollbackReplyClaim) {
      await rollbackFinalReplyEmissionClaim({
        db: input.db,
        idempotencyKey: input.dispatchMessage.idempotencyKey,
        claimedAtMs: replyClaimedAtMs,
      }).catch(() => undefined);
    }
    throw error;
  }
};
const emitStatusReplySignal = async (input: {
  agentControllerConversationId: string | null;
  attemptId: string;
  agentControllerRef: string | null;
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionContext: DispatchExecutionContext;
  finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
  agentControllerConversation: AgentControllerConversationRef | null;
  workingDirectory: string | null;
  plan: Extract<
    DispatchPublicationPlan,
    {
      kind: "status";
    }
  >;
  resultRef: string | null;
  targetOwnerUserId: string;
  profileHandle: string | null;
  targetProfileMentionLabel: string | null;
  targetProfileName: string | null;
}): Promise<{
  emittedSignal: SignalEnvelope | null;
  finalReplySettled: boolean;
}> => {
  const replyClaimedAtMs = Date.now();
  const replyClaimState = await claimFinalReplyEmission({
    db: input.db,
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    nowMs: replyClaimedAtMs,
  });
  if (replyClaimState === "already_claimed") {
    return {
      emittedSignal: null,
      finalReplySettled: true,
    };
  }
  let shouldRollbackReplyClaim = replyClaimState === "claimed";
  const targetProfileId =
    input.plan.targetProfileId ??
    input.dispatchMessage.replyToSnapshot?.profileId ??
    null;
  try {
    const publishedProfile = await buildDispatchPublishedAgentProfile({
      agentControllerConversationId: input.agentControllerConversationId,
      agentControllerRef: input.agentControllerRef,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      targetOwnerUserId: input.targetOwnerUserId,
      profileHandle: input.profileHandle,
      targetProfileName: input.targetProfileName,
      agentControllerConversation: input.agentControllerConversation,
      workingDirectory: input.workingDirectory,
    });
    const requestContext = buildDispatchReplyContext({
      message: input.dispatchMessage,
      targetProfileName: input.targetProfileName,
      ownerUserId: input.targetOwnerUserId,
      agentControllerRef: input.agentControllerRef,
      agentControllerConversationId: input.agentControllerConversationId,
    });
    const signal = await emitSpaceStatusSignal({
      env: input.env,
      finalOutcomeAuthority: input.finalOutcomeAuthority,
      spaceId: input.dispatchMessage.spaceId,
      profile: publishedProfile,
      data: {
        actorProfileId: input.dispatchMessage.targetProfileId,
        status: input.plan.status,
        dispatchId: input.dispatchMessage.dispatchId,
        coreReadinessFactsChanged: {
          agentProfileId: input.dispatchMessage.targetProfileId,
          kind: CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
        },
        ...(input.resultRef ? { resultRef: input.resultRef } : {}),
        ...(input.dispatchMessage.replyToSnapshot
          ? { replyTo: input.dispatchMessage.replyToSnapshot }
          : {}),
        ...(targetProfileId ? { targetProfileId } : {}),
        text: input.plan.text,
        generatedBy: "openmeld",
      },
      spaceAccess: buildDispatchContinuationSpaceAccess({
        attemptId: input.attemptId,
        message: input.dispatchMessage,
        requestContext,
      }),
      ...(input.dispatchMessage.threadContext
        ? { threadContext: input.dispatchMessage.threadContext }
        : {}),
      context: requestContext,
    });
    shouldRollbackReplyClaim = false;
    return {
      emittedSignal: signal,
      finalReplySettled: true,
    };
  } catch (error) {
    if (shouldRollbackReplyClaim) {
      await rollbackFinalReplyEmissionClaim({
        db: input.db,
        idempotencyKey: input.dispatchMessage.idempotencyKey,
        claimedAtMs: replyClaimedAtMs,
      }).catch(() => undefined);
    }
    throw error;
  }
};
const emitConversationContinuityWarningIfNeeded = async (input: {
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionContext: DispatchExecutionContext;
  executionLogBase: Record<string, string>;
  targetProfileName: string | null;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
}): Promise<void> => {
  if (!shouldEmitConversationContinuityWarning(input.taskResult)) {
    return;
  }
  try {
    await emitSpaceTextSignal({
      env: input.env,
      spaceId: input.dispatchMessage.spaceId,
      profile: {
        kind: "system",
        profileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
        profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
      },
      text: buildConversationContinuityWarningText({
        targetProfileLabel:
          normalizeOptionalText(input.targetProfileName) ??
          input.dispatchMessage.targetProfileId,
      }),
      authoringPolicy: "system_emitted",
      transient: true,
      spaceAccess: buildDispatchSystemSpaceAccess({
        message: input.dispatchMessage,
        requestIdPrefix: "openMeldDaemon-continuity-warning",
      }),
      meta: {
        transient: true,
        purpose: CONVERSATION_CONTINUITY_WARNING_PURPOSE,
        dispatchId: input.dispatchMessage.dispatchId,
        targetProfileId: input.dispatchMessage.targetProfileId,
        ...(input.targetProfileName
          ? { targetProfileName: input.targetProfileName }
          : {}),
      },
    });
  } catch (warningError) {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.continuity_warning_emit_failed]",
      {
        ...input.executionLogBase,
        daemonSessionId: input.executionContext.daemonSessionId,
        error: toErrorMessage(warningError),
        leaseEpoch: input.executionContext.leaseEpoch,
      }
    );
  }
};
const toTelemetryTimestamp = (value: unknown): number | null => {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
};
const resolveLifecyclePhaseEnteredAtMs = (
  lifecycle: RuntimeTransportDispatchLifecycleSnapshot
): number | null => {
  switch (lifecycle.phase) {
    case "accepted_local":
      return lifecycle.acceptedLocalAtMs;
    case "running":
      return lifecycle.runningAtMs;
    case "completed_local":
      return lifecycle.completedLocalAtMs;
    default:
      return lifecycle.createdAtMs;
  }
};
const isLifecycleFailureReason = (reasonCode: string): boolean => {
  return (
    reasonCode === "daemon.delivery.execution_stalled" ||
    reasonCode === "daemon.delivery.finalization_timeout" ||
    reasonCode === "daemon.delivery.start_timeout"
  );
};
const normalizeRuntimeTransportRouteErrorCode = (
  reasonCode: string
): string => {
  if (reasonCode === "daemon.session.not_found") {
    return "daemon.profile.offline";
  }
  if (reasonCode === "daemon.session.reject_conflict") {
    return "daemon.session.reject_conflict";
  }
  return reasonCode;
};
const normalizeRuntimeTransportDeliveryErrorCode = (
  reasonCode: string | undefined
): string => {
  if (!reasonCode) {
    return "daemon.delivery.timeout";
  }
  return reasonCode;
};
const normalizeRuntimeTransportWaitErrorCode = (reasonCode: string): string => {
  if (reasonCode === "daemon.session.stale_lease") {
    return "stale_lease_result_rejected";
  }
  return reasonCode;
};
const resolveDispatchExecutionErrorCode = (error: unknown): string => {
  if (error && typeof error === "object") {
    const code = (
      error as {
        code?: unknown;
      }
    ).code;
    if (typeof code === "string" && code.trim().length > 0) {
      return code.trim();
    }
  }
  return "dispatch.execution_failed";
};
export const emitDispatchReplyingHintSignal = async (input: {
  db: PostgresDatabase;
  localStateDb: PostgresDatabase | null;
  env: CoreBindings;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  targetProfileName: string | null;
}): Promise<ReplyingHintEmissionState> => {
  const targetProfileLabel =
    normalizeOptionalText(input.targetProfileName) ??
    input.dispatchMessage.targetProfileId;
  const hintClaimedAtMs = Date.now();
  let hintClaimState: Awaited<ReturnType<typeof claimReplyingHintEmission>>;
  try {
    hintClaimState = await claimReplyingHintEmission({
      db: input.db,
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      nowMs: hintClaimedAtMs,
    });
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_queue.replying_hint_claim_failed]",
      {
        event: CORE_LOG_EVENTS.dispatchQueueReplyingHintClaimFailed,
        dispatchId: input.dispatchMessage.dispatchId,
        idempotencyKey: input.dispatchMessage.idempotencyKey,
        error: toErrorMessage(error),
      }
    );
    return "claim_failed";
  }
  if (hintClaimState !== "claimed") {
    if (hintClaimState === "missing_ledger_row") {
      console.warn(
        "[core.openMeldDaemon.dispatch_queue.replying_hint_missing_ledger]",
        {
          event: CORE_LOG_EVENTS.dispatchQueueReplyingHintMissingLedger,
          dispatchId: input.dispatchMessage.dispatchId,
          idempotencyKey: input.dispatchMessage.idempotencyKey,
        }
      );
      return "claim_failed";
    }
    return "already_active";
  }
  const hintText = buildReplyingHintText(targetProfileLabel);
  const runtimeDeviceDisplayName = input.localStateDb
    ? await readReplyingHintRuntimeDeviceDisplayName({
        db: input.db,
        localStateDb: input.localStateDb,
        message: input.dispatchMessage,
      })
    : null;
  const emitReplyingHint = async (): Promise<void> => {
    await emitDispatchActivitySignal({
      env: input.env,
      dispatchMessage: input.dispatchMessage,
      purpose: DISPATCH_REPLYING_HINT_START_PURPOSE,
      runtimeDeviceDisplayName,
      text: hintText,
      targetProfileName: input.targetProfileName,
    });
  };
  let emitError: unknown | null = null;
  try {
    await emitReplyingHint();
    return "emitted";
  } catch (firstError) {
    try {
      await emitReplyingHint();
      return "emitted";
    } catch (secondError) {
      emitError = secondError;
      console.warn(
        "[core.openMeldDaemon.dispatch_queue.replying_hint_emit_retry_failed]",
        {
          event: CORE_LOG_EVENTS.dispatchQueueReplyingHintEmitRetryFailed,
          dispatchId: input.dispatchMessage.dispatchId,
          idempotencyKey: input.dispatchMessage.idempotencyKey,
          firstError: toErrorMessage(firstError),
          error: toErrorMessage(secondError),
        }
      );
    }
  }
  try {
    await rollbackReplyingHintEmissionClaim({
      db: input.db,
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      claimedAtMs: hintClaimedAtMs,
    });
  } catch (rollbackError) {
    console.warn(
      "[core.openMeldDaemon.dispatch_queue.replying_hint_claim_rollback_failed]",
      {
        event: CORE_LOG_EVENTS.dispatchQueueReplyingHintClaimRollbackFailed,
        dispatchId: input.dispatchMessage.dispatchId,
        idempotencyKey: input.dispatchMessage.idempotencyKey,
        error: toErrorMessage(rollbackError),
      }
    );
  }
  console.warn(
    "[core.openMeldDaemon.dispatch_queue.replying_hint_emit_failed]",
    {
      event: CORE_LOG_EVENTS.dispatchQueueReplyingHintEmitFailed,
      dispatchId: input.dispatchMessage.dispatchId,
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      error: toErrorMessage(emitError),
    }
  );
  return "emit_failed";
};
async function readReplyingHintRuntimeDeviceDisplayName(input: {
  db: PostgresDatabase;
  localStateDb: PostgresDatabase;
  message: OpenMeldDaemonDispatchQueueMessage;
}): Promise<string | null> {
  try {
    const execution = await readRuntimeCoordinatorExecutionProjectionByDispatch(
      {
        db: input.db,
        dispatchId: input.message.dispatchId,
        spaceId: input.message.spaceId,
        targetProfileId: input.message.targetProfileId,
      }
    );
    const openMeldServiceRuntimeId =
      execution?.openMeldServiceRuntimeId.value ?? null;
    return openMeldServiceRuntimeId
      ? await readRuntimeDeviceDisplayNameByRuntimeId({
          db: input.localStateDb,
          openMeldServiceRuntimeId,
        })
      : null;
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_queue.replying_hint_runtime_device_display_name_read_failed]",
      {
        dispatchId: input.message.dispatchId,
        error: toErrorMessage(error),
      }
    );
    return null;
  }
}
const resolveEffectiveTargetBindingSnapshot = async (input: {
  authRpc?: CoreBindings["OPENMELD_AUTH_WORKER"];
  env: CoreBindings;
  message: OpenMeldDaemonDispatchQueueMessage;
  timing?: SpaceBootstrapTimingCollector;
}): Promise<ResolvedTargetBindingSnapshotResult> => {
  const localStateDbHandle = getPostgresDatabase(input.env);
  if (!localStateDbHandle) {
    return {
      ok: false,
      source: "core_primary_binding",
      errorCode: "agent_profile_binding.lookup_failed",
      errorMessage:
        "failed to resolve target binding from Core primary binding (bindingSource=core_primary_binding): binding store unavailable",
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    };
  }
  const dispatchOwnerUserId =
    input.message.dispatchOwner?.kind === "owner_account"
      ? normalizeOptionalText(input.message.dispatchOwner.id)
      : null;
  const ownerResolutionPromise = measureDispatchTiming({
    description: "Resolve the target profile owner from Auth",
    name: "openmeld_dispatch_auth_profile_owner",
    read: () =>
      resolveCurrentTargetProfileOwner({
        authRpc: input.authRpc,
        message: input.message,
      }),
    timing: input.timing,
  });
  const speculativeBindingSnapshotPromise = dispatchOwnerUserId
    ? measureDispatchTiming({
        description: "Read the Core primary Binding snapshot",
        name: "openmeld_dispatch_auth_binding_snapshot",
        read: () =>
          readTargetBindingSnapshotFromCorePrimaryBinding({
            db: localStateDbHandle,
            message: input.message,
            ownerUserId: dispatchOwnerUserId,
            owner: { id: dispatchOwnerUserId, kind: "owner_account" },
          }),
        timing: input.timing,
      }).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ reason, status: "rejected" as const })
      )
    : Promise.resolve(null);
  const [ownerResolution, speculativeBindingSnapshot] = await Promise.all([
    ownerResolutionPromise,
    speculativeBindingSnapshotPromise,
  ]);
  if (!ownerResolution.ok) {
    return {
      ok: false,
      source: "core_primary_binding",
      errorCode: ownerResolution.errorCode,
      errorMessage: ownerResolution.errorMessage,
      finalStatus: ownerResolution.finalStatus,
      targetOwnerUserId: ownerResolution.targetOwnerUserId,
      targetProfileIdentityVerdict:
        ownerResolution.targetProfileIdentityVerdict,
    };
  }
  try {
    let coreBindingSnapshot: EffectiveTargetBindingSnapshot | undefined;
    if (
      dispatchOwnerUserId === ownerResolution.ownerUserId &&
      speculativeBindingSnapshot
    ) {
      if (speculativeBindingSnapshot.status === "rejected") {
        throw speculativeBindingSnapshot.reason;
      }
      coreBindingSnapshot = speculativeBindingSnapshot.value;
    } else {
      coreBindingSnapshot = await measureDispatchTiming({
        description: "Read the Core primary Binding snapshot",
        name: "openmeld_dispatch_auth_binding_snapshot",
        read: () =>
          readTargetBindingSnapshotFromCorePrimaryBinding({
            db: localStateDbHandle,
            message: input.message,
            ownerUserId: ownerResolution.ownerUserId,
            owner: ownerResolution.owner,
          }),
        timing: input.timing,
      });
    }
    if (!coreBindingSnapshot) {
      return {
        ok: false,
        source: "core_primary_binding",
        errorCode: "agent_profile_binding.lookup_failed",
        errorMessage:
          "failed to resolve target binding from Core primary binding (bindingSource=core_primary_binding): binding store or profile identity unavailable",
        finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      };
    }
    return {
      ok: true,
      source: "core_primary_binding",
      snapshot: coreBindingSnapshot,
    };
  } catch (error) {
    if (error instanceof CenterAgentModelResolutionError) {
      return {
        ok: false,
        source: "core_primary_binding",
        errorCode: error.code,
        errorMessage: error.message,
        finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      };
    }
    return {
      ok: false,
      source: "core_primary_binding",
      errorCode: "agent_profile_binding.lookup_failed",
      errorMessage: `failed to resolve target binding from Core primary binding (bindingSource=core_primary_binding): ${toErrorMessage(error)}`,
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    };
  }
};
const resolveHostedStoredAgentControllerRefStatus = (
  agentControllerRef: AgentProfileBindingRecord["agentControllerRef"]
) => {
  const parsedAgentControllerRef = parseAgentControllerRef(agentControllerRef);
  if (parsedAgentControllerRef?.ref === HOSTED_CENTER_AGENT_CONTROLLER_REF) {
    return "canonical" as const;
  }
  return parsedAgentControllerRef ? ("stale" as const) : ("malformed" as const);
};
const readTargetBindingSnapshotFromCorePrimaryBinding = async (input: {
  db?: PostgresDatabase;
  message: OpenMeldDaemonDispatchQueueMessage;
  ownerUserId: string | null;
  owner: AgentProfileBindingRecord["owner"];
}): Promise<EffectiveTargetBindingSnapshot | undefined> => {
  if (!input.db) {
    return undefined;
  }
  const binding = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.message.targetProfileId,
    db: input.db,
    owner: input.owner,
  });
  if (!binding) {
    return {
      bindingState: "missing",
      bindingEnabled: false,
      bindingId: null,
      configurationRevision: null,
      agentControllerRef: null,
      controllerNormalization: null,
      hostedRuntimeIdentity: null,
      modelRoute: null,
      openMeldServiceRuntimeId: null,
      organizationId: null,
      runtimeKind: null,
      ownerUserId: input.ownerUserId,
    };
  }
  const runtimeKind = binding.runtimeKind ?? "openmeld_service";
  if (runtimeKind === "hosted_remote_agent") {
    if (!isPersonalRemoteAgentBinding(binding)) {
      throw new Error("remote_agent.personal_binding_invalid");
    }
    const bindingEnabled = binding.bindingState === "enabled_primary";
    return {
      bindingState: "bound",
      bindingEnabled,
      bindingId: binding.bindingId,
      configurationRevision: binding.configurationRevision,
      agentControllerRef: binding.agentControllerRef,
      controllerNormalization: null,
      hostedRuntimeIdentity: HOSTED_REMOTE_AGENT_RUNTIME_IDENTITY,
      modelRoute: bindingEnabled
        ? resolveCenterAgentModelRouteForBinding({
            binding,
            catalog: readModelCatalog(),
          })
        : null,
      openMeldServiceRuntimeId: binding.openMeldServiceRuntimeId,
      organizationId: null,
      ownerUserId: input.ownerUserId,
      runtimeKind,
    };
  }
  const agentControllerRef =
    runtimeKind === "hosted_center_agent"
      ? null
      : parseAgentControllerRef(binding.agentControllerRef);
  if (runtimeKind !== "hosted_center_agent" && !agentControllerRef) {
    throw new Error(
      "agent_profile_binding.agent_controller_report_invalid: agentControllerRef is invalid"
    );
  }
  const hostedRuntimeIdentity =
    runtimeKind === "hosted_center_agent"
      ? parseHostedRuntimeIdentity(binding.hostedRuntimeIdentityJson)
      : null;
  const effectiveAgentControllerRef =
    runtimeKind === "hosted_center_agent"
      ? HOSTED_CENTER_AGENT_CONTROLLER_REF
      : (agentControllerRef?.ref ?? null);
  const controllerNormalization =
    runtimeKind === "hosted_center_agent"
      ? {
          bindingUpdatedAtMs: binding.updatedAtMs,
          canonicalAgentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          reasonCode: "hosted_runtime_family_controller_canonicalized" as const,
          storedAgentControllerRef: normalizeOptionalText(
            binding.agentControllerRef
          ),
          storedAgentControllerRefStatus:
            resolveHostedStoredAgentControllerRefStatus(
              binding.agentControllerRef
            ),
        }
      : null;
  if (
    controllerNormalization &&
    controllerNormalization.storedAgentControllerRefStatus !== "canonical"
  ) {
    console.warn(
      "[core.openMeldDaemon.dispatch_queue.hosted_binding_controller_normalized]",
      {
        bindingId: binding.bindingId,
        canonicalAgentControllerRef:
          controllerNormalization.canonicalAgentControllerRef,
        event:
          "core.openMeldDaemon.dispatch_queue.hosted_binding_controller_normalized",
        reasonCode: controllerNormalization.reasonCode,
        storedAgentControllerRef:
          controllerNormalization.storedAgentControllerRef,
        storedAgentControllerRefStatus:
          controllerNormalization.storedAgentControllerRefStatus,
        targetProfileId: input.message.targetProfileId,
      }
    );
  }
  const bindingEnabled = binding.bindingState === "enabled_primary";
  const modelRoute =
    runtimeKind === "hosted_center_agent" && bindingEnabled
      ? resolveCenterAgentModelRouteForBinding({
          binding,
          catalog: readModelCatalog(),
        })
      : null;
  return {
    bindingState: "bound",
    bindingEnabled,
    bindingId: binding.bindingId,
    configurationRevision: binding.configurationRevision,
    agentControllerRef: effectiveAgentControllerRef,
    controllerNormalization,
    hostedRuntimeIdentity,
    modelRoute,
    openMeldServiceRuntimeId: binding.openMeldServiceRuntimeId,
    organizationId: null,
    ownerUserId: input.ownerUserId,
    runtimeKind,
  };
};
function parseHostedRuntimeIdentity(
  value: string | null | undefined
): HostedCenterAgentRuntimeIdentity | null {
  if (!value) {
    return null;
  }
  try {
    const parsedJson = JSON.parse(value);
    const parsed = hostedCenterAgentRuntimeIdentitySchema.safeParse(parsedJson);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
type TargetBindingOrganizationScopeResult =
  | {
      ok: true;
      organizationId: string;
    }
  | {
      ok: false;
      errorCode:
        | "agent_profile.organization_context_missing"
        | "agent_profile.organization_lookup_failed"
        | "agent_profile.organization_mismatch"
        | "agent_profile.space_organization_unavailable";
      errorMessage: string;
      finalStatus:
        | typeof OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable
        | typeof OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal;
    };
export const resolveTargetBindingOrganizationScope = async (input: {
  bindingId: string | null;
  env: CoreBindings;
  message: OpenMeldDaemonDispatchQueueMessage;
}): Promise<TargetBindingOrganizationScopeResult> => {
  if (!input.bindingId) {
    return {
      ok: false,
      errorCode: "agent_profile.organization_lookup_failed",
      errorMessage:
        "The Agent Profile workspace could not be checked before Wake execution.",
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    };
  }
  const db = getPostgresDatabase(input.env);
  if (!db) {
    return {
      ok: false,
      errorCode: "agent_profile.organization_lookup_failed",
      errorMessage:
        "The Agent Profile workspace could not be checked before Wake execution.",
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    };
  }
  try {
    const organizationIdSnapshot = normalizeOptionalText(
      input.message.organizationId
    );
    // Phase 1 rollout compatibility only. After the canonical Space producer is
    // stable in Production, make organizationId required and delete this branch
    // together with its Space Index authorization read.
    if (!organizationIdSnapshot) {
      console.warn(
        "[core.openMeldDaemon.dispatch_execution.legacy_space_organization_fallback]",
        {
          bindingId: input.bindingId,
          dispatchId: input.message.dispatchId,
          event:
            "core.openMeldDaemon.dispatch_execution.legacy_space_organization_fallback",
          queueSchemaVersion: input.message.v,
          sourceEventId: input.message.sourceEventId,
          spaceId: input.message.spaceId,
          targetProfileId: input.message.targetProfileId,
          taskId: input.message.taskId,
        }
      );
    }
    const row = await db
      .query<{
        organization_id?: string | null;
        profile_organization_id: string | null;
      }>({
        text: organizationIdSnapshot
          ? `
          SELECT
            profiles.organization_id AS profile_organization_id
          FROM "openmeld"."openMeldDaemon_agent_profile_bindings" AS bindings
          LEFT JOIN "openmeld"."openmeld_profiles" AS profiles
            ON profiles.profile_id = bindings.agent_profile_id
            AND profiles.profile_kind = 'agent'
            AND profiles.status = 'active'
          WHERE bindings.binding_id = $1
            AND bindings.agent_profile_id = $2
            AND bindings.binding_state = 'enabled_primary'
          LIMIT 1
        `
          : `
          SELECT
            spaces.organization_id AS organization_id,
            profiles.organization_id AS profile_organization_id
          FROM "openmeld"."space_index_spaces" AS spaces
          LEFT JOIN "openmeld"."openMeldDaemon_agent_profile_bindings" AS bindings
            ON bindings.binding_id = $1
            AND bindings.agent_profile_id = $2
            AND bindings.binding_state = 'enabled_primary'
          LEFT JOIN "openmeld"."openmeld_profiles" AS profiles
            ON profiles.profile_id = bindings.agent_profile_id
            AND profiles.profile_kind = 'agent'
            AND profiles.status = 'active'
          WHERE spaces.space_id = $3
          LIMIT 1
        `,
        values: [
          input.bindingId,
          input.message.targetProfileId,
          ...(organizationIdSnapshot ? [] : [input.message.spaceId]),
        ],
      })
      .then((result) => result.rows[0] ?? null);
    const organizationId =
      organizationIdSnapshot ?? normalizeOptionalText(row?.organization_id);
    if (!organizationId) {
      return {
        ok: false,
        errorCode: "agent_profile.space_organization_unavailable",
        errorMessage:
          "Space Organization could not be verified before Wake execution.",
        finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      };
    }
    const profileOrganizationId = normalizeOptionalText(
      row?.profile_organization_id
    );
    if (!profileOrganizationId) {
      return {
        ok: false,
        errorCode: "agent_profile.organization_context_missing",
        errorMessage:
          "The Agent Profile workspace could not be verified before Wake execution.",
        finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      };
    }
    if (profileOrganizationId !== organizationId) {
      return {
        ok: false,
        errorCode: "agent_profile.organization_mismatch",
        errorMessage:
          "This Agent Profile belongs to a different workspace than the Space.",
        finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      };
    }
    return {
      ok: true,
      organizationId,
    };
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.agent_profile_organization_lookup_failed]",
      {
        bindingId: input.bindingId,
        dispatchId: input.message.dispatchId,
        error: toErrorMessage(error),
        event:
          "core.openMeldDaemon.dispatch_execution.agent_profile_organization_lookup_failed",
        sourceEventId: input.message.sourceEventId,
        spaceId: input.message.spaceId,
        targetProfileId: input.message.targetProfileId,
        taskId: input.message.taskId,
      }
    );
    return {
      ok: false,
      errorCode: "agent_profile.organization_lookup_failed",
      errorMessage:
        "The Agent Profile workspace could not be checked before Wake execution.",
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    };
  }
};
const resolveTargetProfileIsCurrentCenterAgent = async (input: {
  bindingId: string | null;
  db: PostgresDatabase;
  env: CoreBindings;
  executionLogBase: DispatchExecutionLogBase;
  message: OpenMeldDaemonDispatchQueueMessage;
}): Promise<boolean> => {
  const organizationScope = await resolveTargetBindingOrganizationScope({
    bindingId: input.bindingId,
    env: input.env,
    message: input.message,
  });
  if (!organizationScope.ok) {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.center_agent_designation_unavailable]",
      {
        event:
          "core.openMeldDaemon.dispatch_execution.center_agent_designation_unavailable",
        ...input.executionLogBase,
        reasonCode: organizationScope.errorCode,
      }
    );
    return false;
  }
  try {
    const designation = await readCenterAgentDesignationRecord({
      db: input.db,
      organizationId: organizationScope.organizationId,
    });
    return designation?.agentProfileId === input.message.targetProfileId;
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.center_agent_designation_unavailable]",
      {
        event:
          "core.openMeldDaemon.dispatch_execution.center_agent_designation_unavailable",
        ...input.executionLogBase,
        error: toErrorMessage(error),
        reasonCode: "center_agent.designation_lookup_failed",
      }
    );
    return false;
  }
};
type TargetProfileOwnerResolution =
  | {
      ok: true;
      ownerUserId: string | null;
      owner: AgentProfileBindingRecord["owner"];
    }
  | {
      ok: false;
      errorCode: string;
      errorMessage: string;
      finalStatus:
        | typeof OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable
        | typeof OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal;
      targetOwnerUserId?: string;
      targetProfileIdentityVerdict?: TargetProfileIdentityVerdict;
    };
type ResolveProfileByIdRpc = NonNullable<
  NonNullable<CoreBindings["OPENMELD_AUTH_WORKER"]>["resolveProfileById"]
>;
const resolveCurrentTargetProfileOwner = async (input: {
  authRpc?: CoreBindings["OPENMELD_AUTH_WORKER"];
  message: OpenMeldDaemonDispatchQueueMessage;
}): Promise<TargetProfileOwnerResolution> => {
  if (
    !input.authRpc ||
    typeof input.authRpc.resolveProfileById !== "function"
  ) {
    return {
      ok: false,
      errorCode: "agent_profile_binding.lookup_failed",
      errorMessage:
        "target profile identity lookup is unavailable while resolving Core primary binding owner",
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    };
  }
  let result: Awaited<ReturnType<ResolveProfileByIdRpc>>;
  try {
    result = await input.authRpc.resolveProfileById({
      openMeldProfileId: input.message.targetProfileId,
    });
  } catch (error) {
    return {
      ok: false,
      errorCode: "agent_profile_binding.lookup_failed",
      errorMessage: `target profile identity lookup failed while resolving Core primary binding owner: ${toErrorMessage(error)}`,
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    };
  }
  if (!result.ok) {
    const code = normalizeText(result.code) || "unknown";
    const message = normalizeText(result.message) || "unknown";
    if (code === "profile.not_found") {
      return {
        ok: false,
        errorCode: "agent_profile_binding.profile_owner_invalid",
        errorMessage: `target profile is not available in Auth (${code}): ${message}`,
        finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
        targetProfileIdentityVerdict: "not_found",
      };
    }
    return {
      ok: false,
      errorCode: "agent_profile_binding.lookup_failed",
      errorMessage: `resolveProfileById failed (${code}): ${message}`,
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    };
  }
  if (
    result.profile.profileKind !== "agent" ||
    result.profile.status !== "active"
  ) {
    return {
      ok: false,
      errorCode: "agent_profile_binding.profile_owner_invalid",
      errorMessage: `target profile is not an active agent profile (profileKind=${result.profile.profileKind}, status=${result.profile.status})`,
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
    };
  }
  const ownerUserId = normalizeOptionalText(result.profile.ownerUserId);
  if (
    result.profile.managedRole === "center_agent" &&
    result.profile.organizationId &&
    !ownerUserId
  ) {
    return {
      ok: true,
      ownerUserId: null,
      owner: { id: result.profile.organizationId, kind: "organization" },
    };
  }
  if (!ownerUserId) {
    return {
      ok: false,
      errorCode: "agent_profile_binding.profile_owner_unavailable",
      errorMessage: "target profile identity did not include an owner user id",
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    };
  }
  const dispatchOwner = input.message.dispatchOwner;
  if (dispatchOwner?.kind === "owner_account") {
    const dispatchOwnerId = normalizeOptionalText(dispatchOwner.id);
    if (dispatchOwnerId && dispatchOwnerId !== ownerUserId) {
      return {
        ok: false,
        errorCode: "agent_profile_binding.owner_mismatch",
        errorMessage: `dispatch owner ${dispatchOwnerId} does not match current target profile owner ${ownerUserId}`,
        finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
        targetOwnerUserId: ownerUserId,
      };
    }
  }
  return {
    ok: true,
    ownerUserId,
    owner: { id: ownerUserId, kind: "owner_account" },
  };
};
const normalizeText = (value: unknown): string => {
  return String(value ?? "").trim();
};
const normalizeOptionalText = (value: unknown): string | null => {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
};
const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};
