import type {
  AgentProfileCreationExecutionMessage,
  AgentTaskContinuationQueueMessage,
  AgentTaskObservationRedriveQueueMessage,
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
  EnsureMessageChannelMemberOrganizationMembershipRpcInput,
  EnsureMessageChannelMemberOrganizationMembershipRpcResponse,
  EnsureOrganizationJoinLinkOnBehalfOfRpcInput,
  EnsureOrganizationJoinLinkOnBehalfOfRpcResponse,
  EnsureSlackWorkspaceMemberOrganizationMembershipRpcInput,
  EnsureSlackWorkspaceMemberOrganizationMembershipRpcResponse,
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
import type { PrepareSessionHub } from "../prepare-session/transport/do/prepare-session-hub";
import type { LarkChannelConnector } from "../remote-agent/transport/lark/lark-channel-connector";
import type { RuntimeTransportHub } from "../runtime-transport/transport/do/runtime-transport-hub";
import type { Space } from "../space/transport/do/space";

type AuthAgentProfileRpcItem = {
  openMeldProfileId: string;
  profileName: string;
  profileHandle: string;
  profileKind: "human" | "agent";
  isDefault: boolean;
  status: "active" | "disabled";
  ownerUserId: string;
  ownerName?: string;
  avatarUrl?: string;
  source: string;
  managedRole: "openmeld_assistant" | "center_agent" | null;
  defaultProjectId?: string | null;
  createdByUserId: string | null;
  creationActorProfileId?: string | null;
  creatorProfileId: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AuthAgentProfileRpcResult =
  | {
      ok: true;
      profile: AuthAgentProfileRpcItem;
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
    ownerUserId?: string | null;
  }): Promise<AuthAgentProfileRpcResult>;
  updateCenterAgentProfileInOrganization?(input: {
    organizationId?: string | null;
    profileId?: string | null;
    profileName?: string | null;
  }): Promise<AuthAgentProfileRpcResult>;
  updateAgentProfileDefaultProjectInOrganization?(input: {
    defaultProjectId: string | null;
    organizationId?: string | null;
    ownerUserId?: string | null;
    profileId?: string | null;
  }): Promise<AuthAgentProfileRpcResult>;
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
  }): Promise<AuthRpcResolveProfileByIdResult>;
  resolveProfilesByIds?(
    input: AuthRpcResolveProfilesByIdsInput
  ): Promise<AuthRpcResolveProfilesByIdsResult>;
};

export type RemoteAgentWorkerBindingRpc = {
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
  OPENMELD_LARK_CHANNEL_CONNECTOR?: DurableObjectNamespace<LarkChannelConnector>;
  OPENMELD_SPACES: DurableObjectNamespace<Space>;
  OPENMELD_RUNTIME_TRANSPORT?: DurableObjectNamespace<RuntimeTransportHub>;
  OPENMELD_PREPARE_SESSION_HUB?: DurableObjectNamespace<PrepareSessionHub>;
  OPENMELD_DB?: D1Database;
  // Per-domain bindings (developing/architecture/physical-db-split.md). The 4-way
  // physical split was attempted and REVERTED 2026-06-14 — these are ALIASED to
  // OPENMELD_DB (single physical DB) and stay that way. Always read via the domain
  // accessors below; do not read OPENMELD_DB directly from new code (static-gate
  // enforced). This keeps the code split-ready for a future observability-only
  // split (which would flip ONLY OPENMELD_WAKE_EVIDENCE_DB).
  OPENMELD_LOCAL_STATE_DB?: D1Database;
  OPENMELD_WAKE_EVIDENCE_DB?: D1Database;
  OPENMELD_PROJECTIONS_DB?: D1Database;
  OPENMELD_OBSERVABILITY?: AnalyticsEngineDataset;
  OPENMELD_AUTH_WORKER?: CoreAuthDispatchBindingRpc;
  OPENMELD_REMOTE_AGENT_WORKER?: RemoteAgentWorkerBindingRpc;
  OPENMELD_SPACE_ATTACHMENTS?: R2Bucket;
  OPENMELD_ORGANIZATION_SKILLS?: R2Bucket;
  OPENMELD_ROUTINE_RUN_WORKFLOW?: Workflow<{ runId: string }>;
  OPENMELD_ROUTINE_ENGINE_DEFAULT?: string;
  OPENMELD_AGENT_ACTIVITY_DIGEST_ENABLED?: string;
  OPENMELD_ROUTINE_LEGACY_ORGANIZATION_IDS?: string;
  OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED?: string;
  OPENMELD_REMOTE_AGENT_DESIGNATION_ENABLED?: string;
  OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS?: string;
  OPENMELD_REMOTE_AGENT_DAILY_ADMISSION_LIMIT?: string;
  OPENMELD_SLACK_RICH_CONTEXT_REPRO_ENABLED?: string;
  OPENMELD_TASK_CONTINUATION_DESTINATION_NEUTRAL_ENABLED?: string;
  OPENMELD_LARK_CHANNEL_ENABLED?: string;
  OPENMELD_LARK_CHANNEL_ORGANIZATION_IDS?: string;
  OPENMELD_FEISHU_CHANNEL_ENABLED?: string;
  OPENMELD_FEISHU_CHANNEL_ORGANIZATION_IDS?: string;
  OPENMELD_GATEWAY_URL?: string;
  LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY?: string;
  GITHUB_OPENMELD_API_TOKEN?: string;
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
    | OpenMeldDaemonDispatchQueueMessage
  >;
  OPENMELD_REMOTE_AGENT_MESSAGE_CHANNEL_EVENTS_QUEUE?: Queue<MessageChannelIngressEnvelope>;
  OPENMELD_DAEMON_DISPATCH_OUTBOX_DELIVERY_MODE?: string;
  OPENMELD_WORKER_ENVIRONMENT?: string;
  CORS_ORIGINS?: string;
  // Reserved for a future observability-only split (physical-db-split.md): when
  // set "true" it gates the wake-evidence retention sweep. Currently UNSET — the
  // 4-way split was reverted (single DB), so no split-active deploy exists.
  OPENMELD_SPLIT_ACTIVE?: string;
};

// Per-domain D1 accessors. Each returns its domain binding, falling back to the
// shared OPENMELD_DB. The 4-way physical split was reverted (2026-06-14), so all three
// bindings are aliased to OPENMELD_DB and these accessors are NO-OPS on the current
// single physical DB. They are kept as groundwork: a future observability-only
// split would flip ONLY OPENMELD_WAKE_EVIDENCE_DB, and wakeEvidenceDb() would route
// there with no further rewiring. The split-gate net (tests-split-gate) still
// proves the per-domain routing is correct against separate schemas.
// Domain ownership: developing/architecture/physical-db-split.md.
export const localStateDb = (
  env: Pick<CoreBindings, "OPENMELD_LOCAL_STATE_DB" | "OPENMELD_DB">
): D1Database | undefined => env.OPENMELD_LOCAL_STATE_DB ?? env.OPENMELD_DB;

export const wakeEvidenceDb = (
  env: Pick<CoreBindings, "OPENMELD_WAKE_EVIDENCE_DB" | "OPENMELD_DB">
): D1Database | undefined => env.OPENMELD_WAKE_EVIDENCE_DB ?? env.OPENMELD_DB;

export const projectionsDb = (
  env: Pick<CoreBindings, "OPENMELD_PROJECTIONS_DB" | "OPENMELD_DB">
): D1Database | undefined => env.OPENMELD_PROJECTIONS_DB ?? env.OPENMELD_DB;

export const identityDb = (
  env: Pick<CoreBindings, "OPENMELD_DB">
): D1Database | undefined => env.OPENMELD_DB;

export const agentTaskCoordinationDb = (
  env: Pick<CoreBindings, "OPENMELD_DB">
): D1Database | undefined => env.OPENMELD_DB;

// Operational recovery commands must remain on the authoritative Core database.
// They must not follow wakeEvidenceDb() into a future time-decaying evidence
// database, where retention is allowed to delete old rows.
export const dispatchRecoveryDb = (
  env: Pick<CoreBindings, "OPENMELD_DB">
): D1Database | undefined => env.OPENMELD_DB;

export const feedbackDb = (
  env: Pick<CoreBindings, "OPENMELD_DB">
): D1Database | undefined => env.OPENMELD_DB;

export const inboxDb = (
  env: Pick<CoreBindings, "OPENMELD_DB">
): D1Database | undefined => env.OPENMELD_DB;

export const routineDb = (
  env: Pick<CoreBindings, "OPENMELD_DB">
): D1Database | undefined => env.OPENMELD_DB;

export const agentActivityDb = (
  env: Pick<CoreBindings, "OPENMELD_DB">
): D1Database | undefined => env.OPENMELD_DB;

export const projectDb = (
  env: Pick<CoreBindings, "OPENMELD_DB">
): D1Database | undefined => env.OPENMELD_DB;

export const organizationDocumentsDb = (
  env: Pick<CoreBindings, "OPENMELD_DB">
): D1Database | undefined => env.OPENMELD_DB;

export const organizationSkillsDb = (
  env: Pick<CoreBindings, "OPENMELD_DB">
): D1Database | undefined => env.OPENMELD_DB;

export const opportunityDb = (
  env: Pick<CoreBindings, "OPENMELD_DB">
): D1Database | undefined => env.OPENMELD_DB;

export type HonoBindings = {
  Bindings: CoreBindings;
  Variables: {
    openMeldRequestContext: OpenMeldRequestContext;
    spacePassword?: string;
  };
};
