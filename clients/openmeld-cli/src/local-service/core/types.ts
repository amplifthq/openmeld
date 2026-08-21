import type {
  AdapterAgentContextResolution,
  AdapterDispatchContextDelta,
} from "@openmeld/adapter-core";
import type {
  AgentControllerCollaborationMode,
  AgentControllerConversationRef,
  AgentControllerPermissionMode,
  BootstrapTemplateFacts,
  ConversationPolicy,
  DispatchExecution,
  MessageEnvelope,
  OpenCodePermissionConfig,
  OpenMeldDaemonDispatchContinuitySnapshot,
  OpenMeldDaemonDispatchDeliveryRecoveryReason,
  OpenMeldDaemonDispatchReplyToSnapshot,
  OpenMeldDaemonTaskResultPayload,
  OpenMeldSpaceEgressAction,
  RuntimeAgentControllerLaunchContract,
  RuntimeCoordinatorExecutionTokenEcho,
  RuntimeDispatchPolicy,
  RuntimeTransportDeliverDispatchRequest,
  RuntimeTransportDeliveryExecutionIdentity,
  RuntimeTransportHeartbeatResponse,
  RuntimeTransportRegisterSessionResponse,
  DaemonProfileSkipReason as SharedDaemonProfileSkipReason,
  SkippedDaemonProfile as SharedSkippedDaemonProfile,
  SpaceContract,
  SpaceMessageAttachment,
  SpaceThreadContext,
  WorkingLanguageGuidance,
} from "@openmeld/schemas/types";
import type { AgentsRegistryRuntimeAdapterMatch } from "../../agents/registry-source";
import type {
  DaemonRunMode,
  DaemonServiceController,
  DaemonServiceRuntimeMetadata,
} from "../../config/daemon-state";
import type {
  RuntimeAgentControllerConversationIdMappingSpec,
  RuntimeAgentStreamingMode,
  RuntimeAgentTransportMode,
} from "../../config/runtime-config";
import type { Presenter } from "../../runtime/presenter/types";

export type DaemonServiceRunInput = {
  baseUrl?: string;
  deviceId?: string;
  heartbeatIntervalMs?: number;
  mode?: DaemonRunMode;
  presenter: Presenter;
  profile?: string;
};

export type DaemonRuntimePaths = {
  contractMetaPath: string;
  contractRepairReportPath: string;
  contextStorePath: string;
  dataRootPath: string;
  deviceIdPath: string;
  ledgerRootPath: string;
};

export type DaemonRuntimeContractMeta = {
  schema: "daemon.runtime.contract.meta";
  v: 1;
  contractEpoch: string;
  updatedAt: string;
};

export type DaemonRuntimeContractRepairReason =
  | "legacy_state_without_meta"
  | "contract_epoch_mismatch";

export type DaemonRuntimeContractRepairStatus = "applied" | "failed";

export type DaemonRuntimeContractRepairReport = {
  schema: "daemon.runtime.contract.repair.report";
  v: 1;
  status: DaemonRuntimeContractRepairStatus;
  reason: DaemonRuntimeContractRepairReason;
  fromEpoch: string | null;
  toEpoch: string;
  appliedAt: string;
  cleanedPaths: string[];
  backupPaths: string[];
  errorMessage: string | null;
};

export type DaemonRuntimeContractGuardResult =
  | {
      action: "fresh_init" | "none";
      meta: DaemonRuntimeContractMeta;
    }
  | {
      action: "repair_applied";
      reason: DaemonRuntimeContractRepairReason;
      meta: DaemonRuntimeContractMeta;
      report: DaemonRuntimeContractRepairReport;
    };

export type LedgerPaths = {
  backupStateFilePath: string;
  historyFilePath: string;
  historyTempFilePath: string;
  rootDirPath: string;
  stateFilePath: string;
  stateTempFilePath: string;
};

export type CurrentDaemonSocketRef = {
  connectionGeneration: number | null;
  socket: import("../../transport/ws").WsClient | null;
};

export type DaemonDispatchLimits = {
  globalConcurrency: number;
  queueMax: number;
};

export type DaemonProfileRouteConfig = {
  openMeldServiceRuntimeId?: string;
  bindingId?: string;
  configurationRevision?: number;
  agentControllerCollaborationMode?: AgentControllerCollaborationMode;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  conversationPolicy?: ConversationPolicy;
  openCodePermission?: OpenCodePermissionConfig;
  contextIdMappingSpec: RuntimeAgentControllerConversationIdMappingSpec;
  agentControllerRef: string;
  agentControllerConversationId?: string | null;
  launchContract?: RuntimeAgentControllerLaunchContract | null;
  profileId: string;
  streamingMode: RuntimeAgentStreamingMode;
  transportMode: RuntimeAgentTransportMode;
};

export type DaemonProfileRouteResolution =
  | {
      profileId: string;
      route: DaemonProfileRouteConfig;
      status: "accepted";
    }
  | {
      profileId?: string;
      skipReason?: DaemonProfileSkipReason;
      status: "skipped";
    };

export type DaemonProfileSkipReason = SharedDaemonProfileSkipReason;
export type SkippedDaemonProfile = SharedSkippedDaemonProfile;

export type RouteCatalog = {
  profileIds: string[];
  routeByProfileId: Map<string, DaemonProfileRouteConfig>;
  skippedProfiles: SkippedDaemonProfile[];
};

export type MutableRouteCatalogState = {
  fingerprint: string;
  profileIds: string[];
  routeByProfileId: Map<string, DaemonProfileRouteConfig>;
  skippedProfiles: SkippedDaemonProfile[];
};

export type RouteCatalogDiff = {
  addedProfileIds: string[];
  keptProfileIds: string[];
  removedProfileIds: string[];
};

export type RouteCatalogSyncResult =
  | {
      skippedProfiles: SkippedDaemonProfile[];
      status: "unchanged";
    }
  | {
      registerResponse: RuntimeTransportRegisterSessionResponse;
      skippedProfiles: SkippedDaemonProfile[];
      status: "registered";
    }
  | {
      status: "changed";
      diff: RouteCatalogDiff;
      registerResponse: RuntimeTransportRegisterSessionResponse;
      skippedProfiles: SkippedDaemonProfile[];
    }
  | {
      errorMessage: string;
      reason: "load_failed" | "register_failed";
      status: "failed";
    };

export type InflightDispatchMeta = {
  agentContextLookupKey: string;
};

export type OpenMeldDaemonTaskErrorType =
  | "adapter"
  | "auth"
  | "config"
  | "internal"
  | "network"
  | "policy"
  | "timeout";

export type ParsedDispatchTask = {
  agentControllerConversationId: string | null;
  attachments: SpaceMessageAttachment[];
  attemptId: string;
  continuitySnapshot: OpenMeldDaemonDispatchContinuitySnapshot | null;
  contextIdMappingSpec: RuntimeAgentControllerConversationIdMappingSpec;
  agentControllerRef: string;
  deliveryRecoveryReason: OpenMeldDaemonDispatchDeliveryRecoveryReason | null;
  defaultProjectId: string | null;
  dispatchId: string;
  executionIdentity: RuntimeTransportDeliveryExecutionIdentity;
  executionTokenEcho: RuntimeCoordinatorExecutionTokenEcho;
  mentionSourceProfileId: string | null;
  mentionSourceProfileKind: "agent" | "human" | "system" | null;
  mentionSourceProfileMentionLabel: string | null;
  organizationProtectedInformation: string | null;
  workingLanguage: WorkingLanguageGuidance | null;
  prompt: string;
  replyToSnapshot: OpenMeldDaemonDispatchReplyToSnapshot | null;
  recipientExplicitlyAddressedByActivationTargets: boolean;
  runtimeCoordinatorExecutionId: string;
  sequence: number;
  sourceEventId: string;
  sourceMessageEnvelope: MessageEnvelope | null;
  threadContext: SpaceThreadContext | null;
  dispatchTriggerSource: "activation_targets" | "listen_all";
  spaceContractSnapshot: SpaceContract | null;
  spaceId: string;
  spaceNameSnapshot: string | null;
  spacePassword: string | null;
  targetProfileId: string;
  targetProfileIsCenterAgent: boolean;
  targetProfileMentionLabel: string | null;
  targetProfileName: string | null;
  taskId: string;
  streamingMode: RuntimeAgentStreamingMode;
  transportMode: RuntimeAgentTransportMode;
  triggerMode: RuntimeDispatchPolicy;
};

export type DispatchPromptBootstrapInput = {
  continuitySnapshot?: OpenMeldDaemonDispatchContinuitySnapshot | null;
  dispatchTriggerSource: "activation_targets" | "listen_all";
  imageAttachmentPromptSection?: string | null;
  organizationProtectedInformation?: string | null;
  workingLanguage?: WorkingLanguageGuidance | null;
  serviceFreshnessWarningLines?: string[] | null;
  sendTargetReferenceLines?: string[] | null;
  shouldInjectBootstrap: boolean;
  mentionSourceProfileId?: string | null;
  mentionSourceMentionLabel?: string | null;
  mentionSourceProfileName?: string | null;
  mentionSourceProfileKind?: "agent" | "human" | "system" | null;
  profileOwnerName?: string | null;
  profileOwnerUserId?: string | null;
  prompt: string;
  recipientExplicitlyAddressedByActivationTargets?: boolean;
  sourceSignalId?: string | null;
  sourceMessageEnvelope?: MessageEnvelope | null;
  threadContext?: SpaceThreadContext | null;
  spaceId: string;
  spaceOwnerProfileId?: string | null;
  targetProfileMentionLabel?: string | null;
  targetProfileName?: string | null;
  targetProfileRole?: string | null;
  shouldInjectCenterAgentRoleTemplate?: boolean | null;
  cliEntry?: string | null;
  replyToSnapshot?: OpenMeldDaemonDispatchReplyToSnapshot | null;
  spaceContractSnapshot?: SpaceContract | null;
  spaceGuide?: string | null;
  spaceName?: string | null;
  spacePurpose?: string | null;
  targetProfileId: string;
};

export type DispatchCorrelation = {
  attemptId: string;
  agentControllerRef: string | null;
  dispatchId: string;
  sourceEventId: string;
  targetProfileId: string;
  taskId: string;
};

export type PendingFrameWaiters = {
  heartbeatResolver:
    | ((payload: RuntimeTransportHeartbeatResponse) => void)
    | null;
  heartbeatRejecter: ((error: Error) => void) | null;
  registerResolver:
    | ((payload: RuntimeTransportRegisterSessionResponse) => void)
    | null;
  registerRejecter: ((error: Error) => void) | null;
};

export type ParsedDaemonFrame = {
  code:
    | "daemon.dispatch.accepted"
    | "daemon.dispatch.deliver"
    | "daemon.dispatch.interaction_delivered"
    | "daemon.dispatch.interaction_request"
    | "daemon.dispatch.interaction_response"
    | "daemon.dispatch.lifecycle"
    | "daemon.dispatch.preview"
    | "daemon.dispatch.preview_end"
    | "daemon.dispatch.result"
    | "daemon.dispatch.runtime_evidence"
    | "daemon.dispatch.tool_activity"
    | "daemon.error"
    | "daemon.computer_file_access.read_policy"
    | "daemon.computer_file_access.read_policy_result"
    | "daemon.computer_file_access.update_policy"
    | "daemon.computer_file_access.update_policy_result"
    | "daemon.execution_recovery.resume_controller_conversation"
    | "daemon.execution_recovery.resume_controller_conversation_result"
    | "daemon.local_agent_control.cancel"
    | "daemon.local_agent_control.interrupt"
    | "daemon.local_agent_control.fork_session"
    | "daemon.local_agent_control.manage_installation"
    | "daemon.local_agent_control.refresh_catalog"
    | "daemon.local_agent_control.result"
    | "daemon.local_agent_control.set_enabled"
    | "daemon.local_agent_control.set_profile_workspace"
    | "daemon.local_folder_picker.select_folders"
    | "daemon.local_folder_picker.select_folders_result"
    | "daemon.local_project_control.connect_candidate"
    | "daemon.local_project_control.connect_candidate_result"
    | "daemon.local_project_control.connect_declared_path"
    | "daemon.local_project_control.connect_declared_path_result"
    | "daemon.local_project_control.discover_projects"
    | "daemon.local_project_control.discover_projects_result"
    | "daemon.local_project_control.remove_connection"
    | "daemon.local_project_control.remove_connection_result"
    | "daemon.local_project_control.remove_missing_connections"
    | "daemon.local_project_control.remove_missing_connections_result"
    | "daemon.local_project_control.set_default_connection"
    | "daemon.local_project_control.set_default_connection_result"
    | "daemon.route_catalog.changed"
    | "daemon.session.heartbeat"
    | "daemon.session.register";
  payload: Record<string, unknown>;
};

export type LocalRuntimeControllerSupport =
  | {
      supported: true;
      runtimeAdapterMatch: AgentsRegistryRuntimeAdapterMatch;
    }
  | {
      supported: false;
      reason: string;
    };

export type DaemonRuntimeState = {
  command: string;
  gatewayUrl: string | null;
  heartbeatAt: string | null;
  mode: DaemonRunMode;
  pid: number;
  profile: string | null;
  runtimeMetadata: DaemonServiceRuntimeMetadata;
  startedAt: string;
  stopRequestedAt: string | null;
  updatedAt: string;
};

export type DaemonRuntimeStateSnapshot = {
  command: string;
  gatewayUrl: string | null;
  heartbeatAt: string | null;
  mode: DaemonRunMode;
  pid: number;
  profile: string | null;
  startedAt: string;
  stopRequestedAt: string | null;
  status: "running";
  v: 1;
  schema: "daemon.service.runtime.state";
  updatedAt: string;
  managedBySystemService: boolean;
  serviceController: DaemonServiceController;
  autoStart: boolean;
};

export class DaemonServiceRunError extends Error {
  readonly code: string;
  readonly openClawGatewayVisibility?: OpenMeldDaemonTaskResultPayload["openClawGatewayVisibility"];
  readonly projectFailureContext?: OpenMeldDaemonTaskResultPayload["projectFailureContext"];
  readonly providerErrorCode?: string;

  constructor(input: {
    code: string;
    message: string;
    openClawGatewayVisibility?: OpenMeldDaemonTaskResultPayload["openClawGatewayVisibility"];
    projectFailureContext?: OpenMeldDaemonTaskResultPayload["projectFailureContext"];
    providerErrorCode?: string;
  }) {
    super(input.message);
    this.code = input.code;
    this.name = "DaemonServiceRunError";
    this.openClawGatewayVisibility = input.openClawGatewayVisibility;
    this.projectFailureContext = input.projectFailureContext;
    this.providerErrorCode = input.providerErrorCode;
  }
}

export type DispatchTaskParseInput = {
  deliverRequest: RuntimeTransportDeliverDispatchRequest;
  fallbackRouteConfig: DaemonProfileRouteConfig | null;
};

export type DispatchResultPayloadResolveInput = {
  dispatchExecution?: DispatchExecution;
  contextDelta: AdapterDispatchContextDelta | null;
  contextResolution: AdapterAgentContextResolution | null;
  basePayload: OpenMeldDaemonTaskResultPayload;
  bootstrapTemplateFacts?: BootstrapTemplateFacts;
  agentControllerRef: string;
  existingContextId: string | null;
  promptTrace?: OpenMeldDaemonTaskResultPayload["promptTrace"] | null;
  workingDirectory?: string | null;
  openClawGatewayVisibility?:
    | OpenMeldDaemonTaskResultPayload["openClawGatewayVisibility"]
    | null;
  openClawBinding?: OpenMeldDaemonTaskResultPayload["openClawBinding"] | null;
  agentControllerConversationForDispatch?: AgentControllerConversationRef | null;
  spaceAction?: OpenMeldSpaceEgressAction | null;
  spaceActionProvenance?:
    | OpenMeldDaemonTaskResultPayload["spaceActionProvenance"]
    | null;
  attemptId: string;
  sourceEventId: string;
  targetProfileId: string;
  taskId: string;
};
