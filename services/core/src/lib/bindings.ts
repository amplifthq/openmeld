import type { PostgreSQLBinding } from "@openmeld/db/postgresql";
import type {
  AgentProfileCreationExecutionMessage,
  AgentTaskContinuationQueueMessage,
  AgentTaskObservationRedriveQueueMessage,
  AuthProfileView,
  AuthRpcResolveOrganizationAccountIdentityInput,
  AuthRpcResolveOrganizationAccountIdentityResult,
  AuthRpcResolveOrganizationDirectoryAgentProfilesInput,
  AuthRpcResolveOrganizationDirectoryAgentProfilesResult,
  AuthRpcResolveOrganizationDirectoryMembersInput,
  AuthRpcResolveOrganizationDirectoryMembersResult,
  AuthRpcResolveProfileByIdResult,
  AuthRpcResolveProfilesByIdsInput,
  AuthRpcResolveProfilesByIdsResult,
  AuthRpcResolveUserDisplayNameInput,
  AuthRpcResolveUserDisplayNameResult,
  AuthRpcSendInboxUrgentEmailInput,
  AuthRpcSendInboxUrgentEmailResult,
  AuthRpcUpdateAgentProfileDefaultProjectInput,
  EnsureMessageChannelMemberOrganizationMembershipRpcInput,
  EnsureMessageChannelMemberOrganizationMembershipRpcResponse,
  EnsureOrganizationJoinLinkOnBehalfOfRpcInput,
  EnsureOrganizationJoinLinkOnBehalfOfRpcResponse,
  EnsureSlackWorkspaceMemberOrganizationMembershipRpcInput,
  EnsureSlackWorkspaceMemberOrganizationMembershipRpcResponse,
  GitHubAppWebhookQueueMessage,
  MessageChannelIngressEnvelope,
  OpenMeldDaemonDispatchQueueMessage,
  OpenMeldRequestContext,
  RemoteAgentNativeDeliveryDeadlineProbeQueueMessage,
  RemoteAgentSlackEventQueueMessage,
  RemoteAgentWorkerSubmitTurnRequest,
  RemoteAgentWorkerSubmitTurnResponse,
  SummarizeAgentActivityDigestRpcInput,
  SummarizeAgentActivityDigestRpcResponse,
} from "@openmeld/schemas/types";
import type { AccountInvalidationHub } from "../account-invalidation/account-invalidation-hub";
import type { OrganizationFileRoot } from "../files/organization-file-root";
import type { PrepareSessionHub } from "../prepare-session/transport/do/prepare-session-hub";
import type { LarkChannelConnector } from "../remote-agent/transport/lark/lark-channel-connector";
import type { RuntimeTransportHub } from "../runtime-transport/transport/do/runtime-transport-hub";
import type { Space } from "../space/transport/do/space";

type AuthAgentProfileRpcResult =
  | {
      ok: true;
      profile: AuthProfileView;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };
type CoreAuthDispatchBindingRpc = {
  sendInboxUrgentEmail?(
    input: AuthRpcSendInboxUrgentEmailInput
  ): Promise<AuthRpcSendInboxUrgentEmailResult>;
  resolveOrganizationAccountIdentity?(
    input: AuthRpcResolveOrganizationAccountIdentityInput
  ): Promise<AuthRpcResolveOrganizationAccountIdentityResult>;
  resolveOrganizationDirectoryAgentProfiles?(
    input: AuthRpcResolveOrganizationDirectoryAgentProfilesInput
  ): Promise<AuthRpcResolveOrganizationDirectoryAgentProfilesResult>;
  resolveOrganizationDirectoryMembers?(
    input: AuthRpcResolveOrganizationDirectoryMembersInput
  ): Promise<AuthRpcResolveOrganizationDirectoryMembersResult>;
  resolveUserDisplayName?(
    input: AuthRpcResolveUserDisplayNameInput
  ): Promise<AuthRpcResolveUserDisplayNameResult>;
  ensureOrganizationJoinLinkOnBehalfOf?(
    input: EnsureOrganizationJoinLinkOnBehalfOfRpcInput
  ): Promise<EnsureOrganizationJoinLinkOnBehalfOfRpcResponse>;
  ensureMessageChannelMemberOrganizationMembership?(
    input: EnsureMessageChannelMemberOrganizationMembershipRpcInput
  ): Promise<EnsureMessageChannelMemberOrganizationMembershipRpcResponse>;
  ensureSlackWorkspaceMemberOrganizationMembership?(
    input: EnsureSlackWorkspaceMemberOrganizationMembershipRpcInput
  ): Promise<EnsureSlackWorkspaceMemberOrganizationMembershipRpcResponse>;
  createAgentProfileInOrganization?(input: {
    organizationId?: string | null;
    ownerUserId?: string | null;
    createdByUserId?: string | null;
    creationActorProfileId?: string | null;
    creatorProfileId?: string | null;
    idempotencyKey?: string | null;
    profileName: string;
    source?:
      | "auth_bootstrap"
      | "web_create"
      | "cli_create"
      | "local_agent_create"
      | "center_agent_create"
      | "migration";
  }): Promise<AuthAgentProfileRpcResult>;
  ensureCenterAgentProfileInOrganization?(input: {
    organizationId?: string | null;
    createdByUserId?: string | null;
  }): Promise<AuthAgentProfileRpcResult>;
  ensureDetectedMemberAgent?(
    input: import("@openmeld/schemas").EnsureDetectedMemberAgentRpcInput
  ): Promise<import("@openmeld/schemas").EnsureDetectedMemberAgentRpcResult>;
  assignAgentProfileMemberAgent?(
    input: import("@openmeld/schemas").AssignAgentProfileMemberAgentRpcInput
  ): Promise<
    import("@openmeld/schemas").AssignAgentProfileMemberAgentRpcResult
  >;
  listOwnerMemberAgents?(input: {
    organizationId?: string | null;
    ownerUserId?: string | null;
  }): Promise<
    | import("@openmeld/schemas").ListMemberAgentsResponse
    | { ok: false; code: string; message: string }
  >;
  listMemberAgentOrganizationIds?(input: {
    ownerUserId?: string | null;
  }): Promise<
    import("@openmeld/schemas").ListMemberAgentOrganizationIdsRpcResult
  >;
  updateCenterAgentProfileInOrganization?(input: {
    organizationId?: string | null;
    profileId?: string | null;
    profileName?: string | null;
    avatarStyle?: string | null;
    avatarOptions?: import("@openmeld/schemas/types").AuthProfileView["avatarOptions"];
    expectedAvatarOptions?: import("@openmeld/schemas/types").AuthProfileView["avatarOptions"];
  }): Promise<AuthAgentProfileRpcResult>;
  updateAgentProfileDefaultProjectInOrganization?(
    input: AuthRpcUpdateAgentProfileDefaultProjectInput
  ): Promise<AuthAgentProfileRpcResult>;
  initializeAgentProfileDefaultProjectInOrganization?(
    input: AuthRpcUpdateAgentProfileDefaultProjectInput
  ): Promise<AuthAgentProfileRpcResult>;
  listProfileLineage?(input: { ownerUserId?: string | null }): Promise<
    | {
        ok: true;
        profiles: Array<{
          profileId: string;
          creatorProfileId: string | null;
        }>;
      }
    | {
        ok: false;
        code: string;
        message: string;
      }
  >;
  resolveProfileById?(input: {
    openMeldProfileId?: string | null;
    includeAvatarStyle?: boolean;
  }): Promise<AuthRpcResolveProfileByIdResult>;
  resolveProfilesByIds?(
    input: AuthRpcResolveProfilesByIdsInput
  ): Promise<AuthRpcResolveProfilesByIdsResult>;
};
export type RemoteAgentWorkerBindingRpc = {
  describePluginConnection?(input: unknown): Promise<unknown>;
  createPluginComputerConnection?(input: unknown): Promise<unknown>;
  eraseAccountConversation?(
    input: import("@openmeld/schemas").AccountDeletionConversation
  ): Promise<void>;
  eraseAccountComputer?(
    input: import("@openmeld/schemas").AccountDeletionComputer
  ): Promise<void>;
  cloudComputerOperation?(input: unknown): Promise<unknown>;
  generateCenterAgentSessionTitle?(
    input: import("@openmeld/schemas/types").GenerateCenterAgentSessionTitleInput
  ): Promise<
    import("@openmeld/schemas/types").GenerateCenterAgentSessionTitleResponse
  >;
  pluginRuntime?(
    input: import("@openmeld/schemas/types").PluginRuntimeRequest
  ): Promise<import("@openmeld/schemas/types").PluginRuntimeResponse>;
  receiveExecutionInput?(
    input: import("@openmeld/schemas/types").RemoteAgentWorkerExecutionInputRequest
  ): Promise<
    import("@openmeld/schemas/types").RemoteAgentWorkerExecutionInputResponse
  >;
  readExecutionInput?(
    input: import("@openmeld/schemas/types").RemoteAgentWorkerExecutionInputQuery
  ): Promise<
    import("@openmeld/schemas/types").RemoteAgentWorkerExecutionInputResponse
  >;
  cancelExecution?(
    input: import("@openmeld/schemas/types").RemoteAgentWorkerCancellationRequest
  ): Promise<
    import("@openmeld/schemas/types").RemoteAgentWorkerCancellationResponse
  >;
  readExecutionState?(
    input: import("@openmeld/schemas/types").RemoteAgentWorkerExecutionQuery
  ): Promise<
    import("@openmeld/schemas/types").RemoteAgentWorkerExecutionQueryResponse
  >;
  reconcileExecution?(
    input: import("@openmeld/schemas/types").RemoteAgentWorkerExecutionQuery
  ): Promise<
    import("@openmeld/schemas/types").RemoteAgentWorkerExecutionQueryResponse
  >;
  readAdmission?(
    input: RemoteAgentWorkerSubmitTurnRequest
  ): Promise<
    import("@openmeld/schemas/types").RemoteAgentWorkerReadAdmissionResponse
  >;
  readSubmitTurnCapabilities?(
    input: import("@openmeld/schemas/types").RemoteAgentWorkerSubmitCapabilitiesRequest
  ): Promise<
    import("@openmeld/schemas/types").RemoteAgentWorkerSubmitCapabilities
  >;
  readAdmissionStop?(
    input: RemoteAgentWorkerSubmitTurnRequest
  ): Promise<
    import("@openmeld/schemas/types").RemoteAgentWorkerReadAdmissionStopResponse
  >;
  readRuntimeDiagnostics?(
    input: import("@openmeld/schemas/types").RemoteAgentWorkerRuntimeDiagnosticsRequest
  ): Promise<
    import("@openmeld/schemas/types").RemoteAgentWorkerRuntimeDiagnosticsResponse
  >;
  summarizeAgentActivityDigest?(
    input: SummarizeAgentActivityDigestRpcInput
  ): Promise<SummarizeAgentActivityDigestRpcResponse>;
  submitConversationTurn?(
    input: RemoteAgentWorkerSubmitTurnRequest
  ): Promise<RemoteAgentWorkerSubmitTurnResponse>;
  readUsageDiagnostics?(input: {
    organizationId?: string;
    spaceId: string;
  }): Promise<unknown>;
};
// Keep core bindings local to this package instead of reusing global
// CloudflareBindings. Gateway typegen imports core source for service RPC
// typing; using a global env type here causes cross-worker type collisions.
export type CoreBindings = {
  OPENROUTER_MANAGEMENT_API_KEY?: string;
  OPENMELD_AI_CREDENTIAL_CRYPTO_KEY?: string;
  OPENMELD_ACCOUNT_DELETION_GATEWAY?: {
    disconnectAccountConnection(
      input: import("@openmeld/schemas").AccountDeletionConnection
    ): Promise<void>;
  };
  OPENMELD_ACCOUNT_INVALIDATIONS?: DurableObjectNamespace<AccountInvalidationHub>;
  OPENMELD_LARK_CHANNEL_CONNECTOR?: DurableObjectNamespace<LarkChannelConnector>;
  OPENMELD_SPACES: DurableObjectNamespace<Space>;
  OPENMELD_FILE_ROOTS?: DurableObjectNamespace<OrganizationFileRoot>;
  OPENMELD_RUNTIME_TRANSPORT?: DurableObjectNamespace<RuntimeTransportHub>;
  OPENMELD_PREPARE_SESSION_HUB?: DurableObjectNamespace<PrepareSessionHub>;
  OPENMELD_POSTGRESQL?: PostgreSQLBinding;
  OPENMELD_OBSERVABILITY?: AnalyticsEngineDataset;
  OPENMELD_AUTH_WORKER?: CoreAuthDispatchBindingRpc;
  OPENMELD_REMOTE_AGENT_WORKER?: RemoteAgentWorkerBindingRpc;
  OPENMELD_SPACE_ATTACHMENTS?: R2Bucket;
  OPENMELD_ORGANIZATION_SKILLS?: R2Bucket;
  OPENMELD_ACCOUNT_AVATARS?: R2Bucket;
  // Published CLI release objects; see local-components/release-source.ts.
  OPENMELD_CLI_RELEASES?: R2Bucket;
  OPENMELD_SKILL_FILE_BACKED_WRITES?: string;
  OPENMELD_ROUTINE_RUN_WORKFLOW?: Workflow<{
    runId: string;
  }>;
  OPENMELD_ROUTINE_ENGINE_DEFAULT?: string;
  OPENMELD_AGENT_ACTIVITY_DIGEST_ENABLED?: string;
  OPENMELD_ROUTINE_LEGACY_ORGANIZATION_IDS?: string;
  OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED?: string;
  OPENMELD_REMOTE_AGENT_DESIGNATION_ENABLED?: string;
  OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS?: string;
  OPENMELD_SLACK_RICH_CONTEXT_REPRO_ENABLED?: string;
  OPENMELD_TASK_CONTINUATION_DESTINATION_NEUTRAL_ENABLED?: string;
  OPENMELD_LARK_CHANNEL_ENABLED?: string;
  OPENMELD_LARK_CHANNEL_ORGANIZATION_IDS?: string;
  OPENMELD_FEISHU_CHANNEL_ENABLED?: string;
  OPENMELD_FEISHU_CHANNEL_ORGANIZATION_IDS?: string;
  OPENMELD_GATEWAY_URL?: string;
  LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY?: string;
  GITHUB_OPENMELD_API_TOKEN?: string;
  GITHUB_OPENMELD_WEBHOOK_SECRET?: string;
  SLACK_OPENMELD_BOT_TOKEN?: string;
  SLACK_OPENMELD_TOKEN_CRYPTO_KEY?: string;
  WEB_APP_URL?: string;
  ZEP_OPENMELD_API_KEY?: string;
  OPENMELD_DAEMON_DISPATCH_QUEUE?: Queue<
    | AgentProfileCreationExecutionMessage
    | AgentTaskContinuationQueueMessage
    | AgentTaskObservationRedriveQueueMessage
    | RemoteAgentNativeDeliveryDeadlineProbeQueueMessage
    | RemoteAgentSlackEventQueueMessage
    | GitHubAppWebhookQueueMessage
    | OpenMeldDaemonDispatchQueueMessage
  >;
  OPENMELD_REMOTE_AGENT_MESSAGE_CHANNEL_EVENTS_QUEUE?: Queue<MessageChannelIngressEnvelope>;
  OPENMELD_DAEMON_DISPATCH_OUTBOX_DELIVERY_MODE?: string;
  OPENMELD_WORKER_ENVIRONMENT?: string;
  CORS_ORIGINS?: string;
};
export type HonoBindings = {
  Bindings: CoreBindings;
  Variables: {
    openMeldRequestContext: OpenMeldRequestContext;
    spacePassword?: string;
  };
};
