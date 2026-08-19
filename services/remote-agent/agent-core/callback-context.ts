import {
  CENTER_AGENT_CONTEXT_WINDOW_EXCEEDED_PUBLIC_COPY,
  CENTER_AGENT_EMPTY_REPLY_PUBLIC_COPY,
  CENTER_AGENT_REQUEST_FAILED_PUBLIC_COPY,
  CENTER_AGENT_TASK_REFERENCE_MAX_COUNT,
  type CenterAgentModelRoute,
  centerAgentModelRouteSchema,
  conversationCompactionMarkerSchema,
  MAX_TEXT_LENGTH,
  type OpenMeldNavigationTarget,
  openMeldNavigationTargetSchema,
  REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_PUBLIC_COPY,
  REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE,
  remoteAgentCoreCallbackBodySchema,
  remoteAgentCoreCallbackResponseSchema,
  remoteAgentWorkerConversationIdentitySchema,
  SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE,
  sanitizeDispatchErrorSummary,
} from "@openmeld/schemas";
import type {
  CenterAgentAuthorizeAnonymousMemberToolResponse,
  CenterAgentAuthorizeAnonymousMemberToolRpcInput,
  CenterAgentCreateOrganizationInviteLinkResponse,
  CenterAgentCreateOrganizationInviteLinkToolRpcInput,
  CenterAgentCreateProjectToolResponse,
  CenterAgentCreateProjectToolRpcInput,
  CenterAgentCreateRoutineToolRpcInput,
  CenterAgentCreateTaskToolRpcInput,
  CenterAgentDeleteRoutineToolRpcInput,
  CenterAgentDraftOrganizationDocumentResponse,
  CenterAgentDraftOrganizationDocumentRpcInput,
  CenterAgentGetOrganizationInviteLinkToolRpcInput,
  CenterAgentInstallOrganizationSkillResponse,
  CenterAgentInstallOrganizationSkillRpcInput,
  CenterAgentInviteSlackTeammatesRpcInput,
  CenterAgentInviteSlackTeammatesRpcResponse,
  CenterAgentListOpportunitiesToolResponse,
  CenterAgentListOpportunitiesToolRpcInput,
  CenterAgentListProjectsToolResponse,
  CenterAgentListProjectsToolRpcInput,
  CenterAgentListRoutinesToolRpcInput,
  CenterAgentListSlackChannelsBody,
  CenterAgentListSlackChannelsResponse,
  CenterAgentManageOrganizationDocumentsResponse,
  CenterAgentManageOrganizationDocumentsRpcInput,
  CenterAgentOrganizationDocumentsComputerSnapshotResponse,
  CenterAgentOrganizationDocumentsComputerSnapshotRpcInput,
  CenterAgentPauseRoutineToolRpcInput,
  CenterAgentPrepareRemoveProjectToolResponse,
  CenterAgentPrepareRemoveProjectToolRpcInput,
  CenterAgentReadChangelogToolRpcInput,
  CenterAgentReadConnectorActionOperationBody,
  CenterAgentReadConnectorActionOperationResponse,
  CenterAgentReadMemberComputersBody,
  CenterAgentReadMemberComputersResponse,
  CenterAgentReadMemberOpenMeldServiceStatusBody,
  CenterAgentReadMemberOpenMeldServiceStatusResponse,
  CenterAgentReadOrganizationDocumentsResponse,
  CenterAgentReadOrganizationDocumentsRpcInput,
  CenterAgentReadOrganizationSkillsResponse,
  CenterAgentReadOrganizationSkillsRpcInput,
  CenterAgentReadSlackChannelHistoryBody,
  CenterAgentReadSlackChannelHistoryResponse,
  CenterAgentReadSlackChannelMembersBody,
  CenterAgentReadSlackChannelMembersResponse,
  CenterAgentReadSlackWorkspaceDirectoryBody,
  CenterAgentReadSlackWorkspaceDirectoryResponse,
  CenterAgentRecommendOpportunityToolResponse,
  CenterAgentRecommendOpportunityToolRpcInput,
  CenterAgentRecordConnectorActionAuditBody,
  CenterAgentRecordConnectorActionAuditResponse,
  CenterAgentRecordConnectorActionOperationBody,
  CenterAgentRecordConnectorActionOperationResponse,
  CenterAgentRemoveProjectToolResponse,
  CenterAgentRemoveProjectToolRpcInput,
  CenterAgentRequestMemberAttentionResponse,
  CenterAgentRequestMemberAttentionRpcInput,
  CenterAgentRespondToOpportunityToolResponse,
  CenterAgentRespondToOpportunityToolRpcInput,
  CenterAgentResumeRoutineToolRpcInput,
  CenterAgentSearchSlackMessagesBody,
  CenterAgentSearchSlackMessagesResponse,
  CenterAgentSetAgentProfileDefaultProjectToolResponse,
  CenterAgentSetAgentProfileDefaultProjectToolRpcInput,
  CenterAgentSetOrganizationWorkingLanguageToolResponse,
  CenterAgentSetOrganizationWorkingLanguageToolRpcInput,
  CenterAgentSpaceAuthoringContractResponse,
  CenterAgentStartSelfMemberResearchToolRpcInput,
  CenterAgentTaskReference,
  CenterAgentUpdateProjectToolResponse,
  CenterAgentUpdateProjectToolRpcInput,
  CenterAgentUpdateRoutineToolRpcInput,
  ChangelogQueryResponse,
  ConversationCompactionMarker,
  CreateCenterAgentRoutineResponse,
  CreateCenterAgentTaskResponse,
  DeleteCenterAgentRoutineResponse,
  ListCenterAgentRoutinesResponse,
  OpenMeldRequestContext,
  OrganizationDocumentPromptContextResponse,
  OrganizationDocumentPromptContextRpcInput,
  OrganizationSkillRuntimeReleaseSelection,
  OrganizationSkillRuntimeSnapshotResponse,
  PauseCenterAgentRoutineResponse,
  ReadOrganizationSkillRuntimeSnapshotRpcInput,
  RecordCenterAgentMemberResearchComputerFileResponse,
  RecordCenterAgentMemberResearchComputerFileRpcInput,
  RecordOrganizationSkillActivationResponse,
  RecordOrganizationSkillActivationRpcInput,
  RemoteAgentCoreCallbackBody,
  RemoteAgentCoreCallbackResponse,
  RemoteAgentStreamDeltaCallbackBody,
  RemoteAgentStreamPartCallbackBody,
  RemoteAgentTurnEnvelope,
  RemoteAgentWorkerConversationIdentity,
  RemoteAgentWorkerSubmitMessagesResult,
  RemoteAgentWorkerSubmitTurnRequest,
  ResumeCenterAgentRoutineResponse,
  SpaceAttachmentDescriptor,
  SpaceMessageAttachment,
  StartCenterAgentMemberResearchResponse,
  UpdateCenterAgentRoutineResponse,
} from "@openmeld/schemas/types";
import {
  CENTER_AGENT_ASSISTANT_PROTOCOL_CONTAMINATION_REASON_CODE,
  inspectAssistantPublicationProtocol,
} from "./assistant-publication";
import {
  isRemoteAgentContextWindowExceeded,
  isRemoteAgentToolResultTooLarge,
  normalizeRemoteAgentErrorMessage,
} from "./error-message";
import type { RemoteAgentTurnUsage, RemoteAgentUsageRecord } from "./usage";

export type RemoteAgentCallbackStatus =
  | "completed"
  | "delivery_failed"
  | "failed"
  | "pending"
  | "rejected"
  | "retryable";

const CALLBACK_RETRY_BASE_DELAY_MS = 5000;
const CALLBACK_RETRY_MAX_DELAY_MS = 300_000;
const CALLBACK_CONTEXT_WRITE_MAX_ATTEMPTS = 8;
const ANONYMOUS_IDENTITY_BOUNDARY_WRITE_MAX_ATTEMPTS = 8;
const NAVIGATION_TARGET_WRITE_MAX_ATTEMPTS = 8;
const CENTER_AGENT_TASK_REFERENCE_WRITE_MAX_ATTEMPTS = 8;
const CONVERSATION_COMPACTION_WRITE_MAX_ATTEMPTS = 8;
export const REMOTE_AGENT_CALLBACK_CONTEXT_WAIT_MS = 5000;
const REMOTE_AGENT_COMPLETED_TEXT_TRUNCATION_NOTICE =
  "\n\n_Response shortened because it exceeded OpenMeld's 100,000-character response limit._";
const CENTER_AGENT_INTERNAL_FAILURE_DETAIL_RE =
  /\b(?:active tool catalog|action catalog|tool catalog|available actions|tools? (?:are |is )?(?:enabled|missing|unavailable)|space management tools|session|runtime|profile id|verified (?:openmeld )?member identity|uuid|rpc|schema|worker|endpoint|stack trace|implementation detail|onbehalfofprofileid|openmeld_[a-z0-9_]+|(?:rejected with|error(?: code)?(?: is|:)?|code(?: is|:)?)\s+[`'"]?[a-z][a-z0-9]*(?:_[a-z0-9]+)+|password (?:cannot be set|required) for this access)\b/iu;
const CENTER_AGENT_STANDALONE_IDENTITY_FAILURE_RE =
  /^\s*(?:this|the) action requires a verified (?:openmeld )?member identity[.!]?\s*$/iu;
const CENTER_AGENT_IDENTITY_REQUIREMENT_RE =
  /\b(?:requires?|needs?)\s+(?:an?\s+)?verified (?:openmeld )?member identity\b/iu;
const CENTER_AGENT_AFFIRMATIVE_ACTION_OUTCOME_RE =
  /\bi\b[^.!?\n]{0,160}\b(?:added|completed|created|finished|posted|sent|updated)\b|\b(?:request|space|task)\b[^.!?\n]{0,80}\b(?:has been|is|was)\s+(?:successfully\s+)?(?:completed|created|finished|updated)\b/iu;
const CENTER_AGENT_NEGATED_ACTION_OUTCOME_RE =
  /\b(?:did not|didn['’]t|has not|hasn['’]t|have not|haven['’]t|was not|wasn['’]t|were not|weren['’]t)\b[^.!?\n]{0,80}\b(?:added|completed|created|finished|posted|sent|updated)\b/iu;
const CENTER_AGENT_FAILURE_OUTCOME_RE =
  /\b(?:cannot|can't|could not|couldn't|did not|didn't|does not|doesn't|error|failed|failure|missing|no match(?:ing)?|unavailable|unable)\b/iu;

export function computeCallbackRetryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  const delayMs = CALLBACK_RETRY_BASE_DELAY_MS * 2 ** exponent;
  return Math.min(delayMs, CALLBACK_RETRY_MAX_DELAY_MS);
}

export type RemoteAgentFailureFact = {
  code: string;
  detail?: string;
  occurredAt: string;
  retryable: boolean;
};

export type RemoteAgentAnonymousIdentityBoundary = {
  reachedAt: string;
  requestedAction?: string;
  toolName: string;
};

export type RemoteAgentCallbackContext = {
  accepted: boolean;
  acceptedAt: string;
  agentProfileId: string;
  agentProfileOwnerUserId: string;
  anonymousIdentityBoundary?: RemoteAgentAnonymousIdentityBoundary;
  bindingId: string;
  callbackAttempts: number;
  callbackCompletedAt?: string;
  callbackNextAttemptAt?: string;
  callbackStatus: RemoteAgentCallbackStatus;
  completedText?: string;
  centerAgentTaskReferences?: CenterAgentTaskReference[];
  conversationId?: string;
  conversationIdentity?: RemoteAgentWorkerConversationIdentity;
  runtimeConversationId?: string;
  conversationCompaction?: ConversationCompactionMarker;
  outputAttachments?: SpaceMessageAttachment[];
  dispatchId: string;
  idempotencyKey: string;
  lastCoreResponse?: RemoteAgentCoreCallbackResponse;
  lastFailureFact?: RemoteAgentFailureFact;
  lastUsage?: RemoteAgentTurnUsage;
  modelRoute?: CenterAgentModelRoute;
  modelId?: string | null;
  navigationTarget?: OpenMeldNavigationTarget;
  organizationId: string;
  organizationSkillReleases?: OrganizationSkillRuntimeReleaseSelection[];
  requestId?: string;
  sourceClientMessageId: string | null;
  spaceId: string;
  submissionCreatedAt: number;
  submissionId: string;
  terminalFailureFact?: RemoteAgentFailureFact;
  toolExecutionDeadlineAtMs?: number;
  triggerMessageId: string;
  turnEnvelope?: RemoteAgentTurnEnvelope;
  v: 1;
};

export type RemoteAgentReadableStorage = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  list<T = unknown>(
    options?: DurableObjectListOptions
  ): Promise<Map<string, T>>;
};

export type RemoteAgentWritableStorage = {
  compareAndSet<T>(
    key: string,
    expectedValue: T,
    nextValue: T
  ): Promise<boolean>;
  compareAndSetExpiring<T>(
    key: string,
    expectedValue: T,
    nextValue: T,
    expiresAtMs: number
  ): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  deleteExpired(input: {
    limit: number;
    nowMs: number;
    prefix: string;
  }): Promise<{ deleted: number; nextExpiresAtMs: number | null }>;
  put<T>(key: string, value: T): Promise<void>;
  putExpiring<T>(key: string, value: T, expiresAtMs: number): Promise<void>;
  putIfAbsent<T>(key: string, value: T): Promise<boolean>;
  putIfAbsentExpiring<T>(
    key: string,
    value: T,
    expiresAtMs: number
  ): Promise<boolean>;
  takeUnexpired<T = unknown>(
    key: string,
    nowMs: number
  ): Promise<T | undefined>;
};

export type RemoteAgentStorage = RemoteAgentReadableStorage &
  RemoteAgentWritableStorage;

export type RemoteAgentCoreWorkerBinding = {
  centerAgentSetOrganizationWorkingLanguage?(
    input: CenterAgentSetOrganizationWorkingLanguageToolRpcInput
  ): Promise<CenterAgentSetOrganizationWorkingLanguageToolResponse>;
  centerAgentAuthorizeAnonymousMemberTool?(
    input: CenterAgentAuthorizeAnonymousMemberToolRpcInput
  ): Promise<CenterAgentAuthorizeAnonymousMemberToolResponse>;
  centerAgentRequestMemberAttention?(
    input: CenterAgentRequestMemberAttentionRpcInput
  ): Promise<CenterAgentRequestMemberAttentionResponse>;
  completeRemoteAgentSubmission?(
    input: RemoteAgentCoreCallbackBody
  ): Promise<unknown>;
  submitRemoteAgentStreamDelta?(
    input: RemoteAgentStreamDeltaCallbackBody
  ): Promise<unknown>;
  submitRemoteAgentStreamPart?(
    input: RemoteAgentStreamPartCallbackBody
  ): Promise<unknown>;
  centerAgentCreateAgentProfile?(input: unknown): Promise<unknown>;
  centerAgentCreateOrganizationInviteLink?(
    input: CenterAgentCreateOrganizationInviteLinkToolRpcInput
  ): Promise<CenterAgentCreateOrganizationInviteLinkResponse>;
  centerAgentCreateProject?(
    input: CenterAgentCreateProjectToolRpcInput
  ): Promise<CenterAgentCreateProjectToolResponse>;
  centerAgentCreateConfiguredAgentProfile?(input: unknown): Promise<unknown>;
  centerAgentCreateRoutine?(
    input: CenterAgentCreateRoutineToolRpcInput
  ): Promise<CreateCenterAgentRoutineResponse>;
  centerAgentCreateTask?(
    input: CenterAgentCreateTaskToolRpcInput
  ): Promise<CreateCenterAgentTaskResponse>;
  centerAgentDraftOrganizationDocument?(
    input: CenterAgentDraftOrganizationDocumentRpcInput
  ): Promise<CenterAgentDraftOrganizationDocumentResponse>;
  centerAgentStartSelfMemberResearch?(
    input: CenterAgentStartSelfMemberResearchToolRpcInput
  ): Promise<StartCenterAgentMemberResearchResponse>;
  recordCenterAgentMemberResearchComputerFile?(
    input: RecordCenterAgentMemberResearchComputerFileRpcInput
  ): Promise<RecordCenterAgentMemberResearchComputerFileResponse>;
  centerAgentManageOrganizationDocuments?(
    input: CenterAgentManageOrganizationDocumentsRpcInput
  ): Promise<CenterAgentManageOrganizationDocumentsResponse>;
  centerAgentOrganizationDocumentsComputerSnapshot?(
    input: CenterAgentOrganizationDocumentsComputerSnapshotRpcInput
  ): Promise<CenterAgentOrganizationDocumentsComputerSnapshotResponse>;
  centerAgentInstallOrganizationSkill?(
    input: CenterAgentInstallOrganizationSkillRpcInput
  ): Promise<CenterAgentInstallOrganizationSkillResponse>;
  centerAgentReadOrganizationDocuments?(
    input: CenterAgentReadOrganizationDocumentsRpcInput
  ): Promise<CenterAgentReadOrganizationDocumentsResponse>;
  centerAgentReadOrganizationSkills?(
    input: CenterAgentReadOrganizationSkillsRpcInput
  ): Promise<CenterAgentReadOrganizationSkillsResponse>;
  centerAgentReadAgentActivity?(input: unknown): Promise<unknown>;
  centerAgentReadChangelog?(
    input: CenterAgentReadChangelogToolRpcInput
  ): Promise<ChangelogQueryResponse>;
  centerAgentListOpportunities?(
    input: CenterAgentListOpportunitiesToolRpcInput
  ): Promise<CenterAgentListOpportunitiesToolResponse>;
  centerAgentRecommendOpportunity?(
    input: CenterAgentRecommendOpportunityToolRpcInput
  ): Promise<CenterAgentRecommendOpportunityToolResponse>;
  centerAgentRespondToOpportunity?(
    input: CenterAgentRespondToOpportunityToolRpcInput
  ): Promise<CenterAgentRespondToOpportunityToolResponse>;
  centerAgentDeleteRoutine?(
    input: CenterAgentDeleteRoutineToolRpcInput
  ): Promise<DeleteCenterAgentRoutineResponse>;
  centerAgentListRoutines?(
    input: CenterAgentListRoutinesToolRpcInput
  ): Promise<ListCenterAgentRoutinesResponse>;
  centerAgentListProjects?(
    input: CenterAgentListProjectsToolRpcInput
  ): Promise<CenterAgentListProjectsToolResponse>;
  centerAgentPauseRoutine?(
    input: CenterAgentPauseRoutineToolRpcInput
  ): Promise<PauseCenterAgentRoutineResponse>;
  centerAgentPrepareRemoveProject?(
    input: CenterAgentPrepareRemoveProjectToolRpcInput
  ): Promise<CenterAgentPrepareRemoveProjectToolResponse>;
  centerAgentResumeRoutine?(
    input: CenterAgentResumeRoutineToolRpcInput
  ): Promise<ResumeCenterAgentRoutineResponse>;
  centerAgentRemoveProject?(
    input: CenterAgentRemoveProjectToolRpcInput
  ): Promise<CenterAgentRemoveProjectToolResponse>;
  centerAgentSetAgentProfileDefaultProject?(
    input: CenterAgentSetAgentProfileDefaultProjectToolRpcInput
  ): Promise<CenterAgentSetAgentProfileDefaultProjectToolResponse>;
  centerAgentUpdateProject?(
    input: CenterAgentUpdateProjectToolRpcInput
  ): Promise<CenterAgentUpdateProjectToolResponse>;
  centerAgentUpdateRoutine?(
    input: CenterAgentUpdateRoutineToolRpcInput
  ): Promise<UpdateCenterAgentRoutineResponse>;
  centerAgentAddAgentProfilesToSpace?(input: unknown): Promise<unknown>;
  centerAgentAddMembersToSpace?(input: unknown): Promise<unknown>;
  centerAgentCheckAgentProfileReadiness?(input: unknown): Promise<unknown>;
  centerAgentConnectAgentProfileToLocalAgent?(input: unknown): Promise<unknown>;
  centerAgentRemoveAgentProfilesFromSpace?(input: unknown): Promise<unknown>;
  centerAgentCreateSpace?(input: unknown): Promise<unknown>;
  centerAgentResolveConnectorConnection?(input: unknown): Promise<unknown>;
  centerAgentEnableAgentProfile?(input: unknown): Promise<unknown>;
  centerAgentGetOrganizationDirectory?(input: unknown): Promise<unknown>;
  centerAgentReadMemberComputers?(
    input: CenterAgentReadMemberComputersBody & {
      context: OpenMeldRequestContext;
    }
  ): Promise<CenterAgentReadMemberComputersResponse>;
  centerAgentReadMemberOpenMeldServiceStatus?(
    input: CenterAgentReadMemberOpenMeldServiceStatusBody & {
      context: OpenMeldRequestContext;
    }
  ): Promise<CenterAgentReadMemberOpenMeldServiceStatusResponse>;
  centerAgentReadSlackWorkspaceDirectory?(
    input: CenterAgentReadSlackWorkspaceDirectoryBody & {
      context: OpenMeldRequestContext;
    }
  ): Promise<CenterAgentReadSlackWorkspaceDirectoryResponse>;
  centerAgentInviteSlackTeammates?(
    input: CenterAgentInviteSlackTeammatesRpcInput
  ): Promise<CenterAgentInviteSlackTeammatesRpcResponse>;
  centerAgentListSlackChannels?(
    input: CenterAgentListSlackChannelsBody & {
      context: OpenMeldRequestContext;
    }
  ): Promise<CenterAgentListSlackChannelsResponse>;
  centerAgentReadSlackChannelMembers?(
    input: CenterAgentReadSlackChannelMembersBody & {
      context: OpenMeldRequestContext;
    }
  ): Promise<CenterAgentReadSlackChannelMembersResponse>;
  centerAgentReadSlackChannelHistory?(
    input: CenterAgentReadSlackChannelHistoryBody & {
      context: OpenMeldRequestContext;
    }
  ): Promise<CenterAgentReadSlackChannelHistoryResponse>;
  centerAgentSearchSlackMessages?(
    input: CenterAgentSearchSlackMessagesBody & {
      context: OpenMeldRequestContext;
    }
  ): Promise<CenterAgentSearchSlackMessagesResponse>;
  centerAgentGetOrganizationInviteLink?(
    input: CenterAgentGetOrganizationInviteLinkToolRpcInput
  ): Promise<unknown>;
  centerAgentGetOrganizationSpaceDirectory?(input: unknown): Promise<unknown>;
  centerAgentListComputers?(input: unknown): Promise<unknown>;
  centerAgentListLocalAgentConnectionCandidates?(
    input: unknown
  ): Promise<unknown>;
  listCenterAgentAuditJournal?(input: unknown): Promise<unknown>;
  centerAgentPostSlackChannelMessage?(input: unknown): Promise<unknown>;
  centerAgentPostSlackThreadMessage?(input: unknown): Promise<unknown>;
  centerAgentPostSpaceMessage?(input: unknown): Promise<unknown>;
  centerAgentReadSpaceAuthoringContract?(input: {
    context: OpenMeldRequestContext;
  }): Promise<CenterAgentSpaceAuthoringContractResponse>;
  centerAgentReadDispatchHistory?(input: unknown): Promise<unknown>;
  centerAgentReadSpaceContext?(input: unknown): Promise<unknown>;
  centerAgentRecordConnectorActionAudit?(
    input: CenterAgentRecordConnectorActionAuditBody & {
      context: OpenMeldRequestContext;
    }
  ): Promise<CenterAgentRecordConnectorActionAuditResponse>;
  centerAgentReadConnectorActionOperation?(
    input: CenterAgentReadConnectorActionOperationBody & {
      context: OpenMeldRequestContext;
    }
  ): Promise<CenterAgentReadConnectorActionOperationResponse>;
  centerAgentRecordConnectorActionOperation?(
    input: CenterAgentRecordConnectorActionOperationBody & {
      context: OpenMeldRequestContext;
    }
  ): Promise<CenterAgentRecordConnectorActionOperationResponse>;
  centerAgentRememberForOrganization?(input: unknown): Promise<unknown>;
  listFeedbackIssuesForOrganization?(input: unknown): Promise<unknown>;
  readFeedbackReportingPolicy?(input: unknown): Promise<unknown>;
  updateFeedbackIssueStatusForOrganization?(input: unknown): Promise<unknown>;
  centerAgentUpdateAgentProfileRuntimeSettings?(
    input: unknown
  ): Promise<unknown>;
  centerAgentUpdateSpaceSettings?(input: unknown): Promise<unknown>;
  centerAgentWakeAgentProfilesInSpace?(input: unknown): Promise<unknown>;
  centerAgentListAgentTasks?(input: unknown): Promise<unknown>;
  centerAgentWatchAgentTask?(input: unknown): Promise<unknown>;
  inspectExecutionRecovery?(input: unknown): Promise<unknown>;
  executeExecutionRecovery?(input: unknown): Promise<unknown>;
  recordSpaceAttachment?(input: {
    context: OpenMeldRequestContext;
    fileName?: string;
    height?: number;
    mimeType: "image/jpeg" | "image/png";
    sizeBytes: number;
    spaceId: string;
    width?: number;
  }): Promise<SpaceAttachmentDescriptor>;
  deleteSpaceAttachmentRecord?(input: {
    attachmentId: string;
  }): Promise<{ deleted: boolean }>;
  readOrganizationDocumentPromptContext?(
    input: OrganizationDocumentPromptContextRpcInput
  ): Promise<OrganizationDocumentPromptContextResponse>;
  readOrganizationSkillRuntimeSnapshot?(
    input: ReadOrganizationSkillRuntimeSnapshotRpcInput
  ): Promise<OrganizationSkillRuntimeSnapshotResponse>;
  recordOrganizationSkillActivation?(
    input: RecordOrganizationSkillActivationRpcInput
  ): Promise<RecordOrganizationSkillActivationResponse>;
};

export type RemoteAgentAssistantCompletionResult = {
  continuation: boolean;
  error?: unknown;
  message: {
    parts: Record<string, unknown>[];
  };
  modelId?: string | null;
  requestId?: string;
  status: "aborted" | "completed" | "error";
  usage?: RemoteAgentTurnUsage | null;
};

export const REMOTE_AGENT_CALLBACK_CONTEXT_KEY_PREFIX =
  "openmeld:remote-agent:callback:";
const USAGE_RECORD_PREFIX = "openmeld:remote-agent:usage:";
const callbackContextWaiters = new Map<string, Set<() => void>>();

export class RemoteAgentGuardrailError extends Error {
  readonly fact: RemoteAgentFailureFact;

  constructor(fact: RemoteAgentFailureFact) {
    super(`${fact.code}${fact.detail ? `: ${fact.detail}` : ""}`);
    this.name = "RemoteAgentGuardrailError";
    this.fact = fact;
  }
}

export function buildRemoteAgentCallbackContextKey(
  submissionId: string
): string {
  return `${REMOTE_AGENT_CALLBACK_CONTEXT_KEY_PREFIX}${submissionId}`;
}

export function buildRemoteAgentUsageRecordKey(
  submissionId: string,
  recordedAt: string
): string {
  return `${USAGE_RECORD_PREFIX}${submissionId}:${recordedAt}`;
}

export function createRemoteAgentFailureFact(input: {
  code: string;
  detail?: string;
  nowMs?: number;
  retryable: boolean;
}): RemoteAgentFailureFact {
  return {
    code: input.code,
    detail: input.detail,
    occurredAt: new Date(input.nowMs ?? Date.now()).toISOString(),
    retryable: input.retryable,
  };
}

export function createRemoteAgentCallbackContext(input: {
  ack: RemoteAgentWorkerSubmitMessagesResult;
  nowMs: number;
  request: RemoteAgentWorkerSubmitTurnRequest;
}): RemoteAgentCallbackContext {
  return {
    accepted: input.ack.accepted,
    acceptedAt: new Date(input.nowMs).toISOString(),
    agentProfileId: input.request.agentProfileId,
    agentProfileOwnerUserId: input.request.agentProfileOwnerUserId,
    bindingId: input.request.bindingId,
    callbackAttempts: 0,
    callbackStatus: "pending",
    conversationId: input.request.conversationId,
    ...((input.request.v === 3 || input.request.v === 4) &&
    input.request.conversationIdentity
      ? { conversationIdentity: input.request.conversationIdentity }
      : {}),
    ...(input.request.v === 4
      ? { runtimeConversationId: input.request.runtimeConversation.id }
      : {}),
    dispatchId: input.request.dispatchId,
    idempotencyKey: input.request.idempotencyKey,
    ...(input.request.v === 1 ? {} : { modelRoute: input.request.modelRoute }),
    organizationId: input.request.organizationId,
    organizationSkillReleases:
      input.request.organizationSkillReleases?.map((release) => ({
        ...release,
      })) ?? [],
    requestId: input.ack.requestId,
    sourceClientMessageId: input.request.sourceClientMessageId ?? null,
    spaceId: input.request.spaceId,
    submissionCreatedAt: input.ack.createdAt,
    submissionId: input.ack.submissionId,
    toolExecutionDeadlineAtMs: input.request.toolExecutionDeadlineAtMs,
    triggerMessageId: input.request.triggerMessageId,
    turnEnvelope: input.request.turnEnvelope,
    v: 1,
  };
}

export async function putRemoteAgentCallbackContext(
  storage: RemoteAgentWritableStorage,
  context: RemoteAgentCallbackContext
): Promise<void> {
  await storage.put(
    buildRemoteAgentCallbackContextKey(context.submissionId),
    context
  );
  notifyRemoteAgentCallbackContextWaiters(context.submissionId);
}

async function updateRemoteAgentCallbackContext(input: {
  storage: RemoteAgentStorage;
  submissionId: string;
  update: (current: RemoteAgentCallbackContext) => RemoteAgentCallbackContext;
}): Promise<RemoteAgentCallbackContext> {
  const key = buildRemoteAgentCallbackContextKey(input.submissionId);
  for (
    let attempt = 0;
    attempt < CALLBACK_CONTEXT_WRITE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const current = await readRemoteAgentCallbackContext(
      input.storage,
      input.submissionId
    );
    if (!current) {
      throw new Error(
        `Remote Agent callback requires persisted context ${input.submissionId}.`
      );
    }
    const updated = input.update(current);
    if (updated === current) {
      return current;
    }
    if (await input.storage.compareAndSet(key, current, updated)) {
      notifyRemoteAgentCallbackContextWaiters(input.submissionId);
      return updated;
    }
  }
  throw new Error(
    `Remote Agent callback context ${input.submissionId} could not be updated after concurrent writes.`
  );
}

export async function recordRemoteAgentNavigationTarget(input: {
  storage: RemoteAgentStorage;
  submissionId: string;
  target: OpenMeldNavigationTarget;
}): Promise<RemoteAgentCallbackContext> {
  const target = openMeldNavigationTargetSchema.parse(input.target);
  return await writeRemoteAgentNavigationTarget({
    ...input,
    target,
  });
}

export async function clearRemoteAgentNavigationTarget(input: {
  storage: RemoteAgentStorage;
  submissionId: string;
}): Promise<RemoteAgentCallbackContext> {
  return await writeRemoteAgentNavigationTarget(input);
}

export async function recordRemoteAgentAnonymousIdentityBoundary(input: {
  reachedAt?: string;
  requestedAction: string;
  storage: RemoteAgentStorage;
  submissionId: string;
  toolName: string;
}): Promise<RemoteAgentCallbackContext> {
  const boundary: RemoteAgentAnonymousIdentityBoundary = {
    reachedAt: input.reachedAt ?? new Date().toISOString(),
    requestedAction: input.requestedAction.trim().replace(/\s+/gu, " "),
    toolName: input.toolName.trim(),
  };
  if (
    !(
      boundary.toolName &&
      boundary.requestedAction &&
      boundary.requestedAction.length <= 160 &&
      Number.isFinite(Date.parse(boundary.reachedAt))
    )
  ) {
    throw new Error("Remote Agent anonymous identity boundary is invalid.");
  }
  const key = buildRemoteAgentCallbackContextKey(input.submissionId);
  for (
    let attempt = 0;
    attempt < ANONYMOUS_IDENTITY_BOUNDARY_WRITE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const current = await readRemoteAgentCallbackContext(
      input.storage,
      input.submissionId
    );
    if (!current) {
      throw new Error(
        `Remote Agent anonymous identity boundary requires callback context ${input.submissionId}.`
      );
    }
    if (current.callbackStatus !== "pending") {
      throw new Error(
        `Remote Agent anonymous identity boundary cannot update ${current.callbackStatus} callback context ${input.submissionId}.`
      );
    }
    if (current.anonymousIdentityBoundary) {
      return current;
    }
    const updated: RemoteAgentCallbackContext = {
      ...current,
      anonymousIdentityBoundary: boundary,
    };
    if (await input.storage.compareAndSet(key, current, updated)) {
      notifyRemoteAgentCallbackContextWaiters(input.submissionId);
      return updated;
    }
  }
  throw new Error(
    `Remote Agent anonymous identity boundary could not update callback context ${input.submissionId} after concurrent writes.`
  );
}

export async function recordRemoteAgentConversationCompaction(input: {
  completedAtMs: number;
  storage: RemoteAgentStorage;
  submissionId: string;
}): Promise<RemoteAgentCallbackContext> {
  const key = buildRemoteAgentCallbackContextKey(input.submissionId);
  for (
    let attempt = 0;
    attempt < CONVERSATION_COMPACTION_WRITE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const current = await readRemoteAgentCallbackContext(
      input.storage,
      input.submissionId
    );
    if (!current) {
      throw new Error(
        `Remote Agent conversation compaction requires callback context ${input.submissionId}.`
      );
    }
    if (current.callbackStatus !== "pending") {
      throw new Error(
        `Remote Agent conversation compaction cannot update ${current.callbackStatus} callback context ${input.submissionId}.`
      );
    }
    const marker = conversationCompactionMarkerSchema.parse({
      completedAtMs: input.completedAtMs,
      count: (current.conversationCompaction?.count ?? 0) + 1,
      v: 1,
    } satisfies ConversationCompactionMarker);
    const updated: RemoteAgentCallbackContext = {
      ...current,
      conversationCompaction: marker,
    };
    if (await input.storage.compareAndSet(key, current, updated)) {
      notifyRemoteAgentCallbackContextWaiters(input.submissionId);
      return updated;
    }
  }
  throw new Error(
    `Remote Agent conversation compaction could not update callback context ${input.submissionId} after concurrent writes.`
  );
}

async function writeRemoteAgentNavigationTarget(input: {
  storage: RemoteAgentStorage;
  submissionId: string;
  target?: OpenMeldNavigationTarget;
}): Promise<RemoteAgentCallbackContext> {
  const key = buildRemoteAgentCallbackContextKey(input.submissionId);
  for (
    let attempt = 0;
    attempt < NAVIGATION_TARGET_WRITE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const current = await readRemoteAgentCallbackContext(
      input.storage,
      input.submissionId
    );
    if (!current) {
      throw new Error(
        `Remote Agent navigation target requires callback context ${input.submissionId}.`
      );
    }
    if (current.callbackStatus !== "pending") {
      throw new Error(
        `Remote Agent navigation target cannot update ${current.callbackStatus} callback context ${input.submissionId}.`
      );
    }
    if (
      input.target
        ? areNavigationTargetsEqual(current.navigationTarget, input.target)
        : current.navigationTarget === undefined
    ) {
      return current;
    }
    const { navigationTarget: _navigationTarget, ...contextWithoutTarget } =
      current;
    const updated: RemoteAgentCallbackContext = input.target
      ? { ...contextWithoutTarget, navigationTarget: input.target }
      : contextWithoutTarget;
    if (await input.storage.compareAndSet(key, current, updated)) {
      notifyRemoteAgentCallbackContextWaiters(input.submissionId);
      return updated;
    }
  }
  throw new Error(
    `Remote Agent navigation target could not update callback context ${input.submissionId} after concurrent writes.`
  );
}

export async function putRemoteAgentUsageRecord(
  storage: RemoteAgentWritableStorage,
  record: RemoteAgentUsageRecord
): Promise<void> {
  await storage.put(
    buildRemoteAgentUsageRecordKey(record.submissionId, record.recordedAt),
    record
  );
}

export async function listRemoteAgentCallbackContexts(
  storage: RemoteAgentReadableStorage,
  statuses?: readonly RemoteAgentCallbackStatus[]
): Promise<RemoteAgentCallbackContext[]> {
  const records = await storage.list<RemoteAgentCallbackContext>({
    prefix: REMOTE_AGENT_CALLBACK_CONTEXT_KEY_PREFIX,
  });
  const allowedStatuses = statuses ? new Set(statuses) : null;
  return [...records.values()]
    .filter(isRemoteAgentCallbackContext)
    .filter(
      (context) =>
        !allowedStatuses || allowedStatuses.has(context.callbackStatus)
    )
    .sort(
      (left, right) => left.submissionCreatedAt - right.submissionCreatedAt
    );
}

export async function readRemoteAgentCallbackContext(
  storage: RemoteAgentReadableStorage,
  submissionId: string
): Promise<RemoteAgentCallbackContext | null> {
  const context = await storage.get<RemoteAgentCallbackContext>(
    buildRemoteAgentCallbackContextKey(submissionId)
  );
  return isRemoteAgentCallbackContext(context) ? context : null;
}

export async function waitForRemoteAgentCallbackContext(input: {
  storage: RemoteAgentReadableStorage;
  submissionId: string;
  waitMs: number;
}): Promise<RemoteAgentCallbackContext | null> {
  const existing = await readRemoteAgentCallbackContext(
    input.storage,
    input.submissionId
  );
  if (existing || input.waitMs <= 0) {
    return existing;
  }
  const waiter = createRemoteAgentCallbackContextWaiter({
    submissionId: input.submissionId,
    waitMs: input.waitMs,
  });
  const afterRegistration = await readRemoteAgentCallbackContext(
    input.storage,
    input.submissionId
  );
  if (afterRegistration) {
    waiter.cancel();
    return afterRegistration;
  }
  await waiter.promise;
  return await readRemoteAgentCallbackContext(
    input.storage,
    input.submissionId
  );
}

export async function listRemoteAgentUsageRecords(
  storage: RemoteAgentReadableStorage,
  filter?: { organizationId?: string; spaceId?: string }
): Promise<RemoteAgentUsageRecord[]> {
  const records = await storage.list<RemoteAgentUsageRecord>({
    prefix: USAGE_RECORD_PREFIX,
  });
  return [...records.values()]
    .filter(isRemoteAgentUsageRecord)
    .filter(
      (record) =>
        (!filter?.organizationId ||
          record.organizationId === filter.organizationId) &&
        (!filter?.spaceId || record.spaceId === filter.spaceId)
    )
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
}

export function selectCallbackContextForChatResponse(input: {
  contexts: readonly RemoteAgentCallbackContext[];
  requestId?: string;
}): RemoteAgentCallbackContext | null {
  if (input.requestId === undefined) {
    return null;
  }
  return (
    input.contexts.find(
      (context) =>
        context.requestId === input.requestId ||
        context.submissionId === input.requestId
    ) ?? null
  );
}

export function assertCoreOriginatedTurnContext(
  context: RemoteAgentCallbackContext | null,
  nowMs = Date.now()
): asserts context is RemoteAgentCallbackContext {
  if (context) {
    return;
  }
  throw new RemoteAgentGuardrailError(
    createRemoteAgentFailureFact({
      code: "remote_agent.guardrail_missing_core_submission_context",
      detail:
        "Remote Agent turn did not have a pending Core-originated submission context.",
      nowMs,
      retryable: false,
    })
  );
}

export function extractCompletedAssistantText(
  result: RemoteAgentAssistantCompletionResult
): string | null {
  if (result.status !== "completed") {
    return null;
  }

  const text = result.message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text).trim())
    .filter((partText) => partText.length > 0)
    .join("\n\n")
    .trim();

  return text.length > 0 ? text : null;
}

export function sanitizeCenterAgentCompletedTextForPublication(
  text: string
): string {
  const includesInternalFailureDetail =
    CENTER_AGENT_INTERNAL_FAILURE_DETAIL_RE.test(text);
  const reportsAffirmativeActionOutcome =
    CENTER_AGENT_AFFIRMATIVE_ACTION_OUTCOME_RE.test(text) &&
    !CENTER_AGENT_NEGATED_ACTION_OUTCOME_RE.test(text);
  const reportsUnresolvedIdentityRequirement =
    CENTER_AGENT_IDENTITY_REQUIREMENT_RE.test(text) &&
    !reportsAffirmativeActionOutcome;
  const reportsFailure =
    CENTER_AGENT_FAILURE_OUTCOME_RE.test(text) ||
    CENTER_AGENT_STANDALONE_IDENTITY_FAILURE_RE.test(text) ||
    reportsUnresolvedIdentityRequirement;

  return reportsFailure && includesInternalFailureDetail
    ? CENTER_AGENT_REQUEST_FAILED_PUBLIC_COPY
    : text;
}

export function buildRemoteAgentCoreCallbackBody(input: {
  context: RemoteAgentCallbackContext;
  text: string;
}): RemoteAgentCoreCallbackBody {
  return remoteAgentCoreCallbackBodySchema.parse({
    agentProfileId: input.context.agentProfileId,
    bindingId: input.context.bindingId,
    callbackAttempt: input.context.callbackAttempts + 1,
    ...(input.context.centerAgentTaskReferences?.length
      ? { centerAgentTaskReferences: input.context.centerAgentTaskReferences }
      : {}),
    dispatchId: input.context.dispatchId,
    idempotencyKey: input.context.idempotencyKey,
    organizationId: input.context.organizationId,
    ...(input.context.navigationTarget
      ? { navigationTarget: input.context.navigationTarget }
      : {}),
    ...(input.context.conversationCompaction
      ? { conversationCompaction: input.context.conversationCompaction }
      : {}),
    spaceId: input.context.spaceId,
    status: "completed",
    submissionId: input.context.submissionId,
    text: fitRemoteAgentCompletedText(input.text),
    triggerMessageId: input.context.triggerMessageId,
    ...(input.context.outputAttachments?.length
      ? { attachments: input.context.outputAttachments }
      : {}),
  });
}

export async function recordRemoteAgentCenterAgentTaskReference(input: {
  storage: RemoteAgentStorage;
  submissionId: string;
  taskId: string;
}): Promise<RemoteAgentCallbackContext> {
  const taskId = input.taskId.trim();
  if (!taskId) {
    throw new Error(
      "Remote Agent Center Agent Task reference requires taskId."
    );
  }
  const key = buildRemoteAgentCallbackContextKey(input.submissionId);
  for (
    let attempt = 0;
    attempt < CENTER_AGENT_TASK_REFERENCE_WRITE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const current = await readRemoteAgentCallbackContext(
      input.storage,
      input.submissionId
    );
    if (!current) {
      throw new Error(
        `Remote Agent Center Agent Task reference requires callback context ${input.submissionId}.`
      );
    }
    if (current.callbackStatus !== "pending") {
      throw new Error(
        `Remote Agent Center Agent Task reference cannot update ${current.callbackStatus} callback context ${input.submissionId}.`
      );
    }
    const references = current.centerAgentTaskReferences ?? [];
    if (references.some((reference) => reference.taskId === taskId)) {
      return current;
    }
    if (references.length >= CENTER_AGENT_TASK_REFERENCE_MAX_COUNT) {
      throw new Error(
        `Remote Agent Center Agent Task references exceed the ${CENTER_AGENT_TASK_REFERENCE_MAX_COUNT}-reference limit.`
      );
    }
    const updated: RemoteAgentCallbackContext = {
      ...current,
      centerAgentTaskReferences: [...references, { taskId }],
    };
    if (await input.storage.compareAndSet(key, current, updated)) {
      notifyRemoteAgentCallbackContextWaiters(input.submissionId);
      return updated;
    }
  }
  throw new Error(
    `Remote Agent Center Agent Task reference could not update callback context ${input.submissionId} after concurrent writes.`
  );
}

function fitRemoteAgentCompletedText(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) {
    return text;
  }
  let sourceEnd =
    MAX_TEXT_LENGTH - REMOTE_AGENT_COMPLETED_TEXT_TRUNCATION_NOTICE.length;
  if (
    sourceEnd > 0 &&
    isHighSurrogate(text.charCodeAt(sourceEnd - 1)) &&
    isLowSurrogate(text.charCodeAt(sourceEnd))
  ) {
    sourceEnd -= 1;
  }
  return `${text.slice(
    0,
    sourceEnd
  )}${REMOTE_AGENT_COMPLETED_TEXT_TRUNCATION_NOTICE}`;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd8_00 && codeUnit <= 0xdb_ff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc_00 && codeUnit <= 0xdf_ff;
}

export async function appendRemoteAgentOutputAttachment(input: {
  attachment: SpaceMessageAttachment;
  storage: RemoteAgentStorage;
  submissionId: string;
}): Promise<RemoteAgentCallbackContext> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await readRemoteAgentCallbackContext(
      input.storage,
      input.submissionId
    );
    if (!current) {
      throw new Error("Remote Agent execution context is unavailable.");
    }
    const existing = current.outputAttachments ?? [];
    if (existing.some((attachment) => attachment.id === input.attachment.id)) {
      return current;
    }
    const outputAttachments = [
      ...existing,
      input.attachment,
    ] satisfies SpaceMessageAttachment[];
    if (outputAttachments.length > SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE) {
      throw new Error(
        `Remote Agent output cannot include more than ${SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE} attachments.`
      );
    }
    const updated: RemoteAgentCallbackContext = {
      ...current,
      outputAttachments,
    };
    if (
      await input.storage.compareAndSet(
        buildRemoteAgentCallbackContextKey(input.submissionId),
        current,
        updated
      )
    ) {
      notifyRemoteAgentCallbackContextWaiters(input.submissionId);
      return updated;
    }
  }
  throw new Error(
    "Remote Agent output attachment could not be persisted after concurrent updates."
  );
}

export function buildRemoteAgentCoreFailureCallbackBody(input: {
  context: RemoteAgentCallbackContext;
  failure: RemoteAgentFailureFact;
}): RemoteAgentCoreCallbackBody {
  return remoteAgentCoreCallbackBodySchema.parse({
    agentProfileId: input.context.agentProfileId,
    bindingId: input.context.bindingId,
    callbackAttempt: input.context.callbackAttempts + 1,
    dispatchId: input.context.dispatchId,
    failureCode: input.failure.code,
    ...(input.failure.detail ? { failureDetail: input.failure.detail } : {}),
    failureMessage: resolveRemoteAgentFailureMessage(input.failure.code),
    idempotencyKey: input.context.idempotencyKey,
    organizationId: input.context.organizationId,
    spaceId: input.context.spaceId,
    status: "failed",
    submissionId: input.context.submissionId,
    triggerMessageId: input.context.triggerMessageId,
  });
}

export function recordCoreCallbackResponse(input: {
  context: RemoteAgentCallbackContext;
  nowMs: number;
  response: RemoteAgentCoreCallbackResponse;
}): RemoteAgentCallbackContext {
  if (input.response.status === "retryable") {
    return recordCallbackDeliveryFailure({
      context: {
        ...input.context,
        lastCoreResponse: input.response,
      },
      detail:
        input.response.reasonCode ??
        "Core asked the remote agent completion callback to retry.",
      nowMs: input.nowMs,
      ...(input.response.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: input.response.retryAfterMs }),
    });
  }
  let terminalStatus: RemoteAgentCallbackContext["callbackStatus"];
  if (
    input.response.status === "rejected" ||
    (input.response.status === "duplicate_rejected" &&
      input.response.reasonCode !==
        "remote_agent.callback_completed_submission")
  ) {
    terminalStatus = "rejected";
  } else if (input.context.lastFailureFact && !input.context.completedText) {
    terminalStatus = "failed";
  } else {
    terminalStatus = "completed";
  }
  return {
    ...input.context,
    callbackAttempts: input.context.callbackAttempts + 1,
    callbackCompletedAt:
      terminalStatus === "completed" || terminalStatus === "failed"
        ? new Date(input.nowMs).toISOString()
        : input.context.callbackCompletedAt,
    callbackStatus: terminalStatus,
    lastCoreResponse: input.response,
    lastFailureFact:
      terminalStatus === "rejected"
        ? createRemoteAgentFailureFact({
            code: input.response.reasonCode ?? "remote_agent.core_rejected",
            detail: "Core rejected the remote agent completion callback.",
            nowMs: input.nowMs,
            retryable: false,
          })
        : input.context.lastFailureFact,
  };
}

export function recordCallbackDeliveryFailure(input: {
  context: RemoteAgentCallbackContext;
  detail: string;
  nowMs: number;
  retryAfterMs?: number;
}): RemoteAgentCallbackContext {
  const callbackAttempts = input.context.callbackAttempts + 1;
  const retryDelayMs = Math.max(
    computeCallbackRetryDelayMs(callbackAttempts),
    input.retryAfterMs ?? 0
  );
  return {
    ...input.context,
    callbackAttempts,
    callbackNextAttemptAt: new Date(input.nowMs + retryDelayMs).toISOString(),
    callbackStatus: "retryable",
    lastFailureFact: createRemoteAgentFailureFact({
      code: "remote_agent.core_callback_failed",
      detail: input.detail,
      nowMs: input.nowMs,
      retryable: true,
    }),
  };
}

export function recordTerminalTurnFailure(input: {
  code: string;
  context: RemoteAgentCallbackContext;
  detail?: string;
  nowMs: number;
}): RemoteAgentCallbackContext {
  const failureFact = createRemoteAgentFailureFact({
    code: input.code,
    detail: input.detail,
    nowMs: input.nowMs,
    retryable: false,
  });
  return {
    ...input.context,
    callbackStatus: "failed",
    lastFailureFact: failureFact,
    terminalFailureFact: failureFact,
  };
}

/**
 * Deliver one stored successful answer to Core. Shared by the first completion
 * callback and every durable retry so both paths update state identically. The
 * assistant text is read from the persisted context (not a live turn result),
 * so an evicted/restarted instance can still re-deliver.
 */
export async function attemptRemoteAgentCallbackDelivery(input: {
  context: RemoteAgentCallbackContext;
  coreWorker?: RemoteAgentCoreWorkerBinding;
  nowMs: number;
  storage: RemoteAgentStorage;
}): Promise<RemoteAgentCallbackContext> {
  const context = await readRemoteAgentCallbackContext(
    input.storage,
    input.context.submissionId
  );
  if (!context) {
    throw new Error(
      `Remote Agent callback requires persisted context ${input.context.submissionId}.`
    );
  }
  const text = context.completedText?.trim();
  const failure = text
    ? null
    : (context.terminalFailureFact ?? context.lastFailureFact ?? null);
  if (!(text || failure)) {
    return await updateRemoteAgentCallbackContext({
      storage: input.storage,
      submissionId: context.submissionId,
      update: (current) =>
        recordTerminalTurnFailure({
          code: "remote_agent.empty_assistant_response",
          context: current,
          nowMs: input.nowMs,
        }),
    });
  }

  const completeRemoteAgentSubmission =
    input.coreWorker?.completeRemoteAgentSubmission;
  if (!completeRemoteAgentSubmission) {
    return await updateRemoteAgentCallbackContext({
      storage: input.storage,
      submissionId: context.submissionId,
      update: (current) =>
        recordCallbackDeliveryFailure({
          context: current,
          detail:
            "OPENMELD_CORE_WORKER.completeRemoteAgentSubmission is unavailable.",
          nowMs: input.nowMs,
        }),
    });
  }

  try {
    const body = text
      ? buildRemoteAgentCoreCallbackBody({ context, text })
      : buildRemoteAgentCoreFailureCallbackBody({
          context,
          failure: failure as RemoteAgentFailureFact,
        });
    const response = remoteAgentCoreCallbackResponseSchema.parse(
      await completeRemoteAgentSubmission(body)
    );
    console.info("[remote_agent.admission.callback_sent]", {
      callbackAttempt: body.callbackAttempt,
      callbackStatus: body.status,
      coreStatus: response.status,
      dispatchId: body.dispatchId,
      idempotencyKey: body.idempotencyKey,
      organizationId: body.organizationId,
      spaceId: body.spaceId,
      submissionId: body.submissionId,
    });
    return await updateRemoteAgentCallbackContext({
      storage: input.storage,
      submissionId: context.submissionId,
      update: (current) =>
        current.callbackStatus === "completed" ||
        current.callbackStatus === "rejected"
          ? current
          : recordCoreCallbackResponse({
              context: current,
              nowMs: input.nowMs,
              response,
            }),
    });
  } catch (error) {
    const errorSummary = toErrorMessage(error);
    console.error("[remote_agent.admission.callback_send_failed]", {
      callbackAttempt: context.callbackAttempts + 1,
      dispatchId: context.dispatchId,
      error: errorSummary,
      idempotencyKey: context.idempotencyKey,
      organizationId: context.organizationId,
      spaceId: context.spaceId,
      submissionId: context.submissionId,
    });
    return await updateRemoteAgentCallbackContext({
      storage: input.storage,
      submissionId: context.submissionId,
      update: (current) =>
        current.callbackStatus === "completed" ||
        current.callbackStatus === "rejected"
          ? current
          : recordCallbackDeliveryFailure({
              context: current,
              detail: errorSummary,
              nowMs: input.nowMs,
            }),
    });
  }
}

export function buildRemoteAgentUsageRecord(input: {
  context: RemoteAgentCallbackContext;
  modelId?: string | null;
  nowMs: number;
  usage: RemoteAgentTurnUsage;
}): RemoteAgentUsageRecord {
  return {
    agentProfileId: input.context.agentProfileId,
    bindingId: input.context.bindingId,
    dispatchId: input.context.dispatchId,
    idempotencyKey: input.context.idempotencyKey,
    modelId: input.modelId ?? input.context.modelId ?? null,
    organizationId: input.context.organizationId,
    recordedAt: new Date(input.nowMs).toISOString(),
    ...(input.context.requestId ? { requestId: input.context.requestId } : {}),
    spaceId: input.context.spaceId,
    submissionId: input.context.submissionId,
    triggerMessageId: input.context.triggerMessageId,
    usage: input.usage,
    v: 1,
  };
}

export async function handleRemoteAgentChatResponse(input: {
  coreWorker?: RemoteAgentCoreWorkerBinding;
  nowMs?: () => number;
  result: RemoteAgentAssistantCompletionResult;
  storage: RemoteAgentStorage;
}): Promise<RemoteAgentCallbackContext | null> {
  const pendingContexts = await listRemoteAgentCallbackContexts(input.storage, [
    "pending",
  ]);
  const context = selectCallbackContextForChatResponse({
    contexts: pendingContexts,
    requestId: input.result.requestId,
  });
  if (!context) {
    return null;
  }

  const nowMs = input.nowMs?.() ?? Date.now();
  const extractedCompletedText = extractCompletedAssistantText(input.result);
  const protocolInspection = extractedCompletedText
    ? inspectAssistantPublicationProtocol(extractedCompletedText)
    : { status: "publishable" as const };
  if (protocolInspection.status !== "publishable") {
    console.warn("[remote_agent.publication.protocol_contamination_blocked]", {
      marker: protocolInspection.marker,
      submissionId: context.submissionId,
    });
    const updated = await updateRemoteAgentCallbackContext({
      storage: input.storage,
      submissionId: context.submissionId,
      update: (current) => {
        if (
          current.callbackStatus === "completed" ||
          current.callbackStatus === "rejected"
        ) {
          return current;
        }
        return recordTerminalTurnFailure({
          code: CENTER_AGENT_ASSISTANT_PROTOCOL_CONTAMINATION_REASON_CODE,
          context: {
            ...current,
            lastUsage: input.result.usage ?? current.lastUsage,
            modelId: input.result.modelId ?? current.modelId ?? null,
          },
          nowMs,
        });
      },
    });
    if (
      updated.callbackStatus === "completed" ||
      updated.callbackStatus === "rejected"
    ) {
      return updated;
    }
    return attemptRemoteAgentCallbackDelivery({
      context: updated,
      coreWorker: input.coreWorker,
      nowMs,
      storage: input.storage,
    });
  }
  const completedText = extractedCompletedText
    ? sanitizeCenterAgentCompletedTextForPublication(extractedCompletedText)
    : null;
  if (completedText && completedText !== extractedCompletedText) {
    console.warn("[remote_agent.publication.internal_detail_suppressed]", {
      submissionId: context.submissionId,
    });
  }
  if (!completedText) {
    const updated = await updateRemoteAgentCallbackContext({
      storage: input.storage,
      submissionId: context.submissionId,
      update: (current) => {
        if (
          current.callbackStatus === "completed" ||
          current.callbackStatus === "rejected"
        ) {
          return current;
        }
        return recordTerminalTurnFailure({
          code: resolveRemoteAgentResultFailureCode(input.result),
          context: {
            ...current,
            lastUsage: input.result.usage ?? current.lastUsage,
            modelId: input.result.modelId ?? current.modelId ?? null,
          },
          detail: toOptionalErrorMessage(input.result.error),
          nowMs,
        });
      },
    });
    if (
      updated.callbackStatus === "completed" ||
      updated.callbackStatus === "rejected"
    ) {
      return updated;
    }
    return attemptRemoteAgentCallbackDelivery({
      context: updated,
      coreWorker: input.coreWorker,
      nowMs,
      storage: input.storage,
    });
  }

  // Persist the successful answer before the first delivery so a callback
  // failure leaves a durable, retryable record instead of a lost reply.
  const readyContext = await updateRemoteAgentCallbackContext({
    storage: input.storage,
    submissionId: context.submissionId,
    update: (current) => {
      if (
        current.callbackStatus === "completed" ||
        current.callbackStatus === "rejected"
      ) {
        return current;
      }
      return {
        ...current,
        completedText,
        lastUsage: input.result.usage ?? undefined,
        modelId: input.result.modelId ?? current.modelId ?? null,
      };
    },
  });
  if (
    readyContext.callbackStatus === "completed" ||
    readyContext.callbackStatus === "rejected"
  ) {
    return readyContext;
  }
  if (readyContext.lastUsage) {
    await putRemoteAgentUsageRecord(
      input.storage,
      buildRemoteAgentUsageRecord({
        context: readyContext,
        modelId: readyContext.modelId ?? null,
        nowMs,
        usage: readyContext.lastUsage,
      })
    );
  }
  return attemptRemoteAgentCallbackDelivery({
    context: readyContext,
    coreWorker: input.coreWorker,
    nowMs,
    storage: input.storage,
  });
}

function resolveRemoteAgentResultFailureCode(
  result: Pick<RemoteAgentAssistantCompletionResult, "error" | "status">
): string {
  if (result.status === "completed") {
    return "remote_agent.empty_assistant_response";
  }
  if (result.status === "aborted") {
    return "remote_agent.execution_cancelled";
  }
  if (isRemoteAgentContextWindowExceeded(result.error)) {
    return "remote_agent.turn.context_window_exceeded";
  }
  if (isRemoteAgentToolResultTooLarge(result.error)) {
    return REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE;
  }
  return "remote_agent.turn_not_completed";
}

function resolveRemoteAgentFailureMessage(code: string): string {
  switch (code) {
    case CENTER_AGENT_ASSISTANT_PROTOCOL_CONTAMINATION_REASON_CODE:
      return CENTER_AGENT_REQUEST_FAILED_PUBLIC_COPY;
    case "remote_agent.turn.context_window_exceeded":
      return CENTER_AGENT_CONTEXT_WINDOW_EXCEEDED_PUBLIC_COPY;
    case "remote_agent.empty_assistant_response":
      return CENTER_AGENT_EMPTY_REPLY_PUBLIC_COPY;
    case REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE:
      return REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_PUBLIC_COPY;
    case "remote_agent.turn_not_completed":
      return CENTER_AGENT_REQUEST_FAILED_PUBLIC_COPY;
    case "remote_agent.execution_cancelled":
      return "This request was stopped.";
    default:
      return CENTER_AGENT_REQUEST_FAILED_PUBLIC_COPY;
  }
}

export async function listDueRetryableCallbackContexts(
  storage: RemoteAgentReadableStorage,
  nowMs: number
): Promise<RemoteAgentCallbackContext[]> {
  const candidates = await listRemoteAgentCallbackContexts(storage, [
    "failed",
    "retryable",
  ]);
  return candidates.filter((context) => {
    if (isUndeliveredTerminalFailureContext(context)) {
      return true;
    }
    return (
      context.callbackStatus === "retryable" &&
      (!context.callbackNextAttemptAt ||
        Date.parse(context.callbackNextAttemptAt) <= nowMs)
    );
  });
}

/**
 * Re-deliver every retryable callback whose backoff has elapsed. Also recovers
 * pre-fix terminal failures that were recorded locally before a Core callback
 * was sent. Returns the next due time (ms) across remaining retryable/recoverable
 * contexts so the caller can arm the next durable retry. Pending contexts keep
 * the scheduler alive until the model result becomes deliverable; they are
 * observed but never delivered by this sweep.
 */
export async function redeliverDueRemoteAgentCallbacks(input: {
  coreWorker?: RemoteAgentCoreWorkerBinding;
  nowMs?: () => number;
  storage: RemoteAgentStorage;
}): Promise<{ processed: number; nextDueAtMs: number | null }> {
  const nowMs = input.nowMs?.() ?? Date.now();
  const due = await listDueRetryableCallbackContexts(input.storage, nowMs);
  for (const context of due) {
    await attemptRemoteAgentCallbackDelivery({
      context,
      coreWorker: input.coreWorker,
      nowMs,
      storage: input.storage,
    });
  }

  const remaining = await listRemoteAgentCallbackContexts(input.storage, [
    "failed",
    "pending",
    "retryable",
  ]);
  const nextDueAtMs = remaining.reduce<number | null>((earliest, context) => {
    if (isUndeliveredTerminalFailureContext(context)) {
      return earliest === null ? nowMs : Math.min(earliest, nowMs);
    }
    if (context.callbackStatus !== "retryable") {
      if (context.callbackStatus !== "pending") {
        return earliest;
      }
      const dueAt = nowMs + CALLBACK_RETRY_BASE_DELAY_MS;
      return earliest === null ? dueAt : Math.min(earliest, dueAt);
    }
    const dueAt = context.callbackNextAttemptAt
      ? Date.parse(context.callbackNextAttemptAt)
      : nowMs;
    return earliest === null ? dueAt : Math.min(earliest, dueAt);
  }, null);
  return { nextDueAtMs, processed: due.length };
}

function isUndeliveredTerminalFailureContext(
  context: RemoteAgentCallbackContext
): boolean {
  return (
    context.callbackStatus === "failed" &&
    !context.callbackCompletedAt &&
    !context.completedText &&
    !context.lastCoreResponse &&
    Boolean(context.terminalFailureFact ?? context.lastFailureFact)
  );
}

function isRemoteAgentCallbackContext(
  value: unknown
): value is RemoteAgentCallbackContext {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<RemoteAgentCallbackContext>;
  return (
    candidate.v === 1 &&
    typeof candidate.submissionId === "string" &&
    typeof candidate.idempotencyKey === "string" &&
    typeof candidate.organizationId === "string" &&
    typeof candidate.spaceId === "string" &&
    typeof candidate.agentProfileId === "string" &&
    typeof candidate.bindingId === "string" &&
    typeof candidate.triggerMessageId === "string" &&
    typeof candidate.dispatchId === "string" &&
    typeof candidate.submissionCreatedAt === "number" &&
    (candidate.toolExecutionDeadlineAtMs === undefined ||
      (Number.isSafeInteger(candidate.toolExecutionDeadlineAtMs) &&
        candidate.toolExecutionDeadlineAtMs > 0)) &&
    (candidate.navigationTarget === undefined ||
      openMeldNavigationTargetSchema.safeParse(candidate.navigationTarget)
        .success) &&
    (candidate.anonymousIdentityBoundary === undefined ||
      isRemoteAgentAnonymousIdentityBoundary(
        candidate.anonymousIdentityBoundary
      )) &&
    (candidate.conversationCompaction === undefined ||
      conversationCompactionMarkerSchema.safeParse(
        candidate.conversationCompaction
      ).success) &&
    (candidate.conversationIdentity === undefined ||
      remoteAgentWorkerConversationIdentitySchema.safeParse(
        candidate.conversationIdentity
      ).success) &&
    (candidate.runtimeConversationId === undefined ||
      (typeof candidate.runtimeConversationId === "string" &&
        candidate.runtimeConversationId.trim().length > 0)) &&
    (candidate.centerAgentTaskReferences === undefined ||
      (Array.isArray(candidate.centerAgentTaskReferences) &&
        candidate.centerAgentTaskReferences.length <=
          CENTER_AGENT_TASK_REFERENCE_MAX_COUNT &&
        candidate.centerAgentTaskReferences.every(
          (reference) =>
            typeof reference?.taskId === "string" &&
            reference.taskId.trim().length > 0
        ))) &&
    (candidate.modelRoute === undefined ||
      centerAgentModelRouteSchema.safeParse(candidate.modelRoute).success) &&
    typeof candidate.callbackAttempts === "number" &&
    typeof candidate.callbackStatus === "string"
  );
}

function isRemoteAgentAnonymousIdentityBoundary(
  value: unknown
): value is RemoteAgentAnonymousIdentityBoundary {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<RemoteAgentAnonymousIdentityBoundary>;
  return (
    typeof candidate.toolName === "string" &&
    candidate.toolName.trim().length > 0 &&
    (candidate.requestedAction === undefined ||
      (typeof candidate.requestedAction === "string" &&
        candidate.requestedAction.trim().length > 0 &&
        candidate.requestedAction.length <= 160)) &&
    typeof candidate.reachedAt === "string" &&
    Number.isFinite(Date.parse(candidate.reachedAt))
  );
}

function areNavigationTargetsEqual(
  left: OpenMeldNavigationTarget | undefined,
  right: OpenMeldNavigationTarget
): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}

function createRemoteAgentCallbackContextWaiter(input: {
  submissionId: string;
  waitMs: number;
}): { cancel(): void; promise: Promise<void> } {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => {
    finish = () => {
      cancel();
      resolve();
    };
  });
  const waiters =
    callbackContextWaiters.get(input.submissionId) ?? new Set<() => void>();
  waiters.add(finish);
  callbackContextWaiters.set(input.submissionId, waiters);
  const timeout = setTimeout(finish, input.waitMs);
  function cancel(): void {
    clearTimeout(timeout);
    const activeWaiters = callbackContextWaiters.get(input.submissionId);
    activeWaiters?.delete(finish);
    if (activeWaiters?.size === 0) {
      callbackContextWaiters.delete(input.submissionId);
    }
  }
  return { cancel, promise };
}

function notifyRemoteAgentCallbackContextWaiters(submissionId: string): void {
  for (const finish of [...(callbackContextWaiters.get(submissionId) ?? [])]) {
    finish();
  }
}

function isRemoteAgentUsageRecord(
  value: unknown
): value is RemoteAgentUsageRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<RemoteAgentUsageRecord>;
  return (
    candidate.v === 1 &&
    typeof candidate.submissionId === "string" &&
    typeof candidate.organizationId === "string" &&
    typeof candidate.spaceId === "string" &&
    typeof candidate.dispatchId === "string" &&
    typeof candidate.recordedAt === "string" &&
    Boolean(candidate.usage)
  );
}

function toErrorMessage(error: unknown): string {
  return normalizeRemoteAgentErrorMessage(error);
}

function toOptionalErrorMessage(error: unknown): string | undefined {
  if (error === null || error === undefined) {
    return undefined;
  }
  return sanitizeDispatchErrorSummary(toErrorMessage(error)) ?? undefined;
}
