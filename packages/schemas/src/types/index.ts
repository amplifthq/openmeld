// biome-ignore-all lint/performance/noBarrelFile: Shared schema package intentionally exposes stable contract entrypoints.

export type { SpaceSendRequestReceipt } from "../schemas/cli/space-send";
export type {
  ServiceConnectionEvidenceEvent,
  ServiceConnectionEvidenceJournal,
  ServiceConnectionIncident,
  ServiceConnectionIncidentReceipt,
  ServiceConnectionIncidentReport,
  ServiceConnectionIncidentReportRpcInput,
  ServiceConnectionIncidentsReadRpcInput,
  ServiceConnectionIncidentsResponse,
} from "../schemas/daemon/service-connection-evidence";
export type {
  LocalAgentReasoningPreferences,
  LocalAgentReasoningPreferencesRpc,
  LocalAgentReasoningState,
} from "../schemas/http/local-agent-reasoning";
export type {
  SpaceFileStreamMetadata,
  SpaceFileStreamOptions,
} from "../schemas/http/space-file-stream";
export type {
  SpaceMessageMutationBody,
  SpaceMessageMutationResponse,
} from "../schemas/http/space-message-mutation";
export type { AgentFailureFacts } from "../schemas/runtime/agent-failure";
export type {
  GenerateCenterAgentSessionTitleInput,
  GenerateCenterAgentSessionTitleResponse,
} from "../schemas/runtime/center-agent-session-title";
export type { MessageChannelCardHistory } from "../schemas/runtime/message-channel-card-history";
export type { PreHeadFailurePublicationIdentity } from "../schemas/space-mesh/signal-system-notice";
export type {
  UserRequestTimeContext,
  UserTimeContext,
  UserTimeZoneObservation,
} from "../user-time-context";
export type {
  AiUsageObservation,
  AiUsageQuery,
  AiUsageQueryResponse,
  AiUsageRecord,
  AiUsageSummary,
  CenterAgentAiUsageRpcInput,
  OrganizationAiUsageRpcInput,
  RemoteAiCreditHold,
  RemoteAiUsageWrite,
  RemoteAiUsageWriteResponse,
} from "./ai-usage";
export type { AgentActivityOverviewResponse } from "./http/agent-activity-overview";
export type {
  CenterAgentReadAuditJournalResponse,
  CenterAgentReadAuditJournalRpcInput,
} from "./http/center-agent-evidence";
export type {
  CenterAgentMemorySourceReference,
  CenterAgentSearchMemoryResponse,
  CenterAgentSearchMemoryRpcInput,
} from "./http/center-agent-memory-search";
export type {
  CenterAgentListRoutineRunsToolResponse,
  CenterAgentListRoutineRunsToolRpcInput,
  CenterAgentReadRoutineRunDiagnosticsResponse,
  CenterAgentReadRoutineRunDiagnosticsRpcInput,
  CenterAgentRoutineRunEvidence,
} from "./http/center-agent-routine-evidence";
export type {
  ListRoutineManagementResponse,
  RoutineExecutorKind,
  RoutineManagement,
  RoutineScope,
} from "./http/center-agent-routines";
export type {
  OrganizationMemberPresenceBody,
  OrganizationMemberPresenceResponse,
} from "./http/organization-member-presence";
export type {
  SpaceHistoryNavigation,
  SpaceHistoryNavigationQuery,
} from "./http/space-history-navigation";

// Type-query import keeps this entrypoint type-only while locking the version type to the schema export.
export type OpenMeldSchemaVersion =
  typeof import("../schemas/index")["OPENMELD_SCHEMA_VERSION"];

export type {
  ComputerPowerRequest,
  ComputerPowerRpcInput,
  ComputerPowerState,
} from "../computer-power";
export type { RemoteAgentExecutionReconciliationObservation } from "../remote-agent-execution-reconciliation";
export type {
  SpaceFileUpdateSettings,
  SpaceFileUpdateSettingsCommand,
} from "../schemas/http/space-file-update-settings";
export type {
  SpaceInputQueueMutation,
  SpaceInputQueueOptions,
  SpaceInputQueueResponse,
} from "../schemas/http/space-input-queue";
export type {
  CenterAgentSetReplyPlacementInput,
  NativeReplyPlacement,
  ResolveNativeReplyPlacementInput,
} from "../schemas/space-mesh/agent-reply-placement";
export type * from "./agent-controller-collaboration-mode";
export type * from "./agent-controller-permission-mode";
export type * from "./agent-view/index";
export type {
  AiFundingSource,
  OrganizationAiBilling,
  OrganizationAiBillingRpcInput,
  RemoteAiProviderAuthorization,
  UpdateOrganizationAiBilling,
  UpdateOrganizationAiBillingRpcInput,
} from "./ai-billing";
export type * from "./common/index";
export type * from "./config/index";
export type * from "./daemon/index";
export type {
  LocalAgentSetupOperation,
  LocalAgentSetupRequest,
  LocalAgentSetupState,
} from "./daemon/local-agent-setup";
export type {
  LocalAgentUpdateOperation,
  LocalAgentUpdateRequest,
  LocalAgentUpdateState,
} from "./daemon/local-agent-update";
export * from "./daemon/session-history";
export type * from "./db/index";
export type * from "./eval-report";
export type * from "./http/index";
export type * from "./http/space-file-upload";
export type * from "./local-components";
export type * from "./open-code-permission";
export type * from "./prepare/index";
export type * from "./profile-details";
export type * from "./protocol/index";
export type {
  WakeDeviceWait,
  WakeDeviceWaitAccessRequest,
  WakeDeviceWaitAccessResponse,
  WakeDeviceWaitTarget,
} from "./protocol/wake-device-wait";
export type { AgentControllerSessionTitle } from "./runtime/agent-controller-session";
export type * from "./runtime/index";
export type * from "./space-mesh/index";
export type * from "./space-mesh/message-reaction";
export type * from "./start/index";
