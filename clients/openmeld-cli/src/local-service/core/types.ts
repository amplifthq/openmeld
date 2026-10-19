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
  SpaceMessageFileReference,
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

// Execution emits frames; it does not own, close, or reconnect a cloud socket.
export type DaemonFrameSink = {
  readonly bufferedAmount?: number;
  send(data: string): void;
};

export type CurrentDaemonSocketRef = {
  confirmExecutionAdmission?: (
    request: RuntimeTransportDeliverDispatchRequest
  ) => Promise<void>;
  reasoningStreamEnabled?: boolean;
  reasoningPreferenceListeners?: Set<() => void>;
  connectionGeneration: number | null;
  socket: DaemonFrameSink | null;
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
  workingFolderRuntime?: import("../../profile-workspace/effective-runtime-resolution").CurrentEffectiveProfileWorkingFolderRuntimeResolution;
};

export type DaemonProfileRouteResolution =
  | {
      profileId: string;
      route: DaemonProfileRouteConfig;
      status: "accepted";
      workingFolderObservation?: DaemonProfileWorkingFolderObservation;
    }
  | {
      profileId?: string;
      skipReason?: DaemonProfileSkipReason;
      status: "skipped";
      workingFolderObservation?: DaemonProfileWorkingFolderObservation;
    };

export type DaemonProfileWorkingFolderObservation =
  import("../../profile-workspace/effective-runtime-resolution").ProfileWorkingFolderFact & {
    bindingId: string | null;
    configurationRevision: number | null;
    profileId: string;
  };

export type DaemonProfileSkipReason = SharedDaemonProfileSkipReason;
export type SkippedDaemonProfile = SharedSkippedDaemonProfile;

export type RouteCatalog = {
  executionHostCatalogRevision?: number;
  expectedRoutesContractVersion?: "v4";
  profileIds: string[];
  routeByProfileId: Map<string, DaemonProfileRouteConfig>;
  skippedProfiles: SkippedDaemonProfile[];
  workingFolderExpectedProfileIds?: string[];
  workingFolderObservations?: DaemonProfileWorkingFolderObservation[];
};

export type MutableRouteCatalogState = {
  executionHostCatalogRevision?: number;
  expectedRoutesContractVersion?: "v4";
  fingerprint: string;
  profileIds: string[];
  routeByProfileId: Map<string, DaemonProfileRouteConfig>;
  skippedProfiles: SkippedDaemonProfile[];
  workingFolderExpectedProfileIds?: string[];
  workingFolderObservations?: DaemonProfileWorkingFolderObservation[];
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
  requesterIsAgentOwner?: boolean;
  /** Core: a colleague's Wake that must not share the Binding conversation. */
  separateRequesterConversation?: boolean;
  permissionModeAdvisory?: import("@openmeld/schemas").PermissionModeAdvisory;
  workHandoff?: import("@openmeld/schemas").SpaceWorkHandoff;
  workingCopyId?: string;
  executionContext?: import("@openmeld/schemas/types").ExecutionContextTask;
  callerContext?: NonNullable<
    RuntimeTransportDeliverDispatchRequest["payload"]["sourceSignalSnapshot"]
  >["callerContext"];
  agentControllerConversationId: string | null;
  attachments: SpaceMessageAttachment[];
  files: SpaceMessageFileReference[];
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

/** Another direct-edit Session in this task's folder; never a path. */
export type DispatchSharedFolderSession = {
  executionContextId: string | null;
  sameSpace: boolean;
  targetLabel: string;
};

export type DispatchPromptBootstrapInput = {
  /** Direct-edit Sessions already running in this task's folder. */
  sharedFolderSessions?: DispatchSharedFolderSession[];
  /**
   * The working folder's display name, never its path, for a task whose root
   * requester is not the owner. Absent for owner-rooted tasks.
   */
  workingFolderDisplayName?: string | null;
  requesterIsAgentOwner?: ParsedDispatchTask["requesterIsAgentOwner"];
  permissionModeAdvisory?: ParsedDispatchTask["permissionModeAdvisory"];
  executionContextAccess?: NonNullable<
    ParsedDispatchTask["executionContext"]
  >["access"];
  projectWork?: NonNullable<
    ParsedDispatchTask["executionContext"]
  >["projectWork"];
  callerContext?: ParsedDispatchTask["callerContext"];
  continuitySnapshot?: OpenMeldDaemonDispatchContinuitySnapshot | null;
  dispatchTriggerSource: "activation_targets" | "listen_all";
  imageAttachmentPromptSection?: string | null;
  spaceFiles?: readonly SpaceMessageFileReference[] | null;
  organizationProtectedInformation?: string | null;
  workingLanguage?: WorkingLanguageGuidance | null;
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
  code: import("zod/v4").infer<
    typeof import("@openmeld/schemas").daemonStreamCodeSchema
  >;
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
