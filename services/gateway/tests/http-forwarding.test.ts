import {
  encodeTaskCredentialHeader,
  OPENMELD_HEADER_SPACE_ADDRESSING_VERSION,
  OPENMELD_HEADER_SPACE_IMAGE_GEOMETRY_VERSION,
  OPENMELD_SPACE_ADDRESSING_VERSION,
  OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION,
} from "@openmeld/gateway-contract";
import {
  createDaemonRouteObservationSummary,
  DB_FACT_SCHEMA_VERSION,
  type DbDiagnosticsPayload,
  getAgentExecutionReadinessResponseSchema,
  organizationAgentRuntimeOverviewResponseSchema,
  organizationDirectoryResponseSchema,
  organizationProfileDirectoryResponseSchema,
  SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION,
  SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_ERROR_CODE,
} from "@openmeld/schemas";
import { createSpaceMemberAgentExecutionReadiness } from "@openmeld/schemas/testing";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import { createCoreRpcHttpError } from "../../core/src/rpc/errors";
import app from "../src/index";

// False positive: the feature test convention for this repository's gateway is placed in tests/, explicitly included by vitest.config.ts.

type CoreRpcMock = {
  fetch: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  inspectDbState: ReturnType<typeof vi.fn>;
  inspectDispatchStorageReadiness: ReturnType<typeof vi.fn>;
  createSpace: ReturnType<typeof vi.fn>;
  centerAgentGetOrganizationDirectory: ReturnType<typeof vi.fn>;
  getCurrentOrganizationAgentRuntimeOverview: ReturnType<typeof vi.fn>;
  getCurrentOrganizationDirectory: ReturnType<typeof vi.fn>;
  getCurrentOrganizationProfileDirectory: ReturnType<typeof vi.fn>;
  recordCurrentOrganizationWebActivity: ReturnType<typeof vi.fn>;
  getCurrentOrganizationMemberOpenMeldServiceStatuses: ReturnType<typeof vi.fn>;
  getCurrentOrganizationSpaceDirectory: ReturnType<typeof vi.fn>;
  getCurrentOrganizationSpaceDirectoryWithMemberCounts: ReturnType<
    typeof vi.fn
  >;
  readCenterAgentOrganizationMemoryPolicy: ReturnType<typeof vi.fn>;
  setCenterAgentOrganizationMemoryPolicy: ReturnType<typeof vi.fn>;
  readOrganizationInformationProtectionPolicy: ReturnType<typeof vi.fn>;
  setOrganizationInformationProtectionPolicy: ReturnType<typeof vi.fn>;
  readCurrentOrganizationFeedbackReportingPolicy: ReturnType<typeof vi.fn>;
  setCurrentOrganizationFeedbackReportingPolicy: ReturnType<typeof vi.fn>;
  wipeCurrentMemberCenterAgentMemory: ReturnType<typeof vi.fn>;
  listAccountSpaceActiveWakeSummary: ReturnType<typeof vi.fn>;
  listAccountSpaces: ReturnType<typeof vi.fn>;
  deleteSpace: ReturnType<typeof vi.fn>;
  upsertSpacePassword: ReturnType<typeof vi.fn>;
  clearSpacePassword: ReturnType<typeof vi.fn>;
  listSignals: ReturnType<typeof vi.fn>;
  postSignal: ReturnType<typeof vi.fn>;
  getSpaceDispatchTrace: ReturnType<typeof vi.fn>;
  getSpaceMessageDetails: ReturnType<typeof vi.fn>;
  getSpaceDispatchLookup: ReturnType<typeof vi.fn>;
  getActiveSpaceWakeProgress: ReturnType<typeof vi.fn>;
  getSpaceWakeProgress: ReturnType<typeof vi.fn>;
  postSpaceWakeStop: ReturnType<typeof vi.fn>;
  respondToSpaceAgentInteraction: ReturnType<typeof vi.fn>;
  getSpaceMembers: ReturnType<typeof vi.fn>;
  getSpaceIdentityDirectory: ReturnType<typeof vi.fn>;
  getSpaceMemberDirectory: ReturnType<typeof vi.fn>;
  addSpaceMembers: ReturnType<typeof vi.fn>;
  addCenterAgentToSpace: ReturnType<typeof vi.fn>;
  addOrganizationDirectoryProfilesToSpace: ReturnType<typeof vi.fn>;
  joinOrganizationPublicSpace: ReturnType<typeof vi.fn>;
  removeSpaceMembers: ReturnType<typeof vi.fn>;
  leaveSpace: ReturnType<typeof vi.fn>;
  getSpaceMeta: ReturnType<typeof vi.fn>;
  getSpaceBoard: ReturnType<typeof vi.fn>;
  getSpaceContract: ReturnType<typeof vi.fn>;
  patchSpaceContract: ReturnType<typeof vi.fn>;
  getSpaceBootstrap: ReturnType<typeof vi.fn>;
  getSpaceBootstrapWithTiming: Mock<
    () => Promise<{ metrics: unknown[]; payload: Record<string, unknown> }>
  >;
  getSpaceStatus: ReturnType<typeof vi.fn>;
  listSpaceThreads: ReturnType<typeof vi.fn>;
  getSpaceUpdates: ReturnType<typeof vi.fn>;
  getSpaceDispatchResult: ReturnType<typeof vi.fn>;
  createSpaceDiagnosticReport: ReturnType<typeof vi.fn>;
  updateSpaceMeta: ReturnType<typeof vi.fn>;
  putSpaceContract: ReturnType<typeof vi.fn>;
  getSpaceCursor: ReturnType<typeof vi.fn>;
  updateSpaceCursor: ReturnType<typeof vi.fn>;
};

type AuthRpcMock = {
  ping: ReturnType<typeof vi.fn>;
  resolveRequestCredentialKind?: ReturnType<typeof vi.fn>;
  inspectDbState: ReturnType<typeof vi.fn>;
  resolveRequestAuth: ReturnType<typeof vi.fn>;
  resolveProfile: ReturnType<typeof vi.fn>;
  listProfiles: ReturnType<typeof vi.fn>;
  listProfileSpaceHistory: ReturnType<typeof vi.fn>;
  querySpaceDeletionTombstones: ReturnType<typeof vi.fn>;
  upsertProfileSpaceHistory: ReturnType<typeof vi.fn>;
  upsertSpaceDeletionTombstone: ReturnType<typeof vi.fn>;
  updateProfileSpaceHistoryStatus: ReturnType<typeof vi.fn>;
};

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

const VALID_HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const VALID_CONTROLLER_AGENT_PROFILE_ID =
  "agt_12345678-1234-4234-8234-123456789abc";
const VALID_VISITED_AGENT_PROFILE_ID =
  "agt_23456789-2345-4234-8234-23456789abcd";
const EXPECTED_CORE_CONTEXT = {
  actorContext: {
    requestId: "req-test",
    openMeldProfileId: VALID_HUMAN_PROFILE_ID,
    profileKind: "human",
    profileName: "Mira",
    ownerUserId: "owner-001",
  },
} as const;
const EXPECTED_CORE_CONTEXT_WITH_OWNER_NAME = {
  actorContext: {
    ...EXPECTED_CORE_CONTEXT.actorContext,
    ownerName: "Mira",
  },
} as const;

function isRuntimeEvidenceEvent(
  value: unknown,
  event: string
): value is Record<string, unknown> & { event: string; reasonCode?: unknown } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { event?: unknown }).event === event
  );
}

function expectedAuthenticatedSpaceAccess(spaceId: string, password?: string) {
  return {
    spaceId,
    actor: {
      kind: "authenticated",
      requestContext: EXPECTED_CORE_CONTEXT,
    },
    proof:
      password === undefined
        ? { kind: "none" }
        : { kind: "space_password", password },
  };
}

const VALID_TARGET_AGENT_PROFILE_ID =
  "agt_22222222-2222-4222-8222-222222222222";
const VALID_DISABLED_AGENT_PROFILE_ID =
  "agt_33333333-3333-4333-8333-333333333333";
const VALID_AUTH_REJECTED_AGENT_PROFILE_ID =
  "agt_44444444-4444-4444-8444-444444444444";
const VALID_FLAKY_AGENT_PROFILE_ID = "agt_55555555-5555-4555-8555-555555555555";
const VALID_MEMBER_NOTICE_TARGET_PROFILE_ID =
  "agt_66666666-6666-4666-8666-666666666666";
const VALID_MEMBER_NOTICE_ACTOR_PROFILE_ID =
  "11111111-1111-4111-8111-111111111111";
const VALID_CONCURRENT_AGENT_PROFILE_ID_A =
  "agt_77777777-7777-4777-8777-777777777777";
const VALID_CONCURRENT_AGENT_PROFILE_ID_B =
  "agt_88888888-8888-4888-8888-888888888888";
const VALID_CONCURRENT_AGENT_PROFILE_ID_C =
  "agt_99999999-9999-4999-8999-999999999999";

function buildDbSnapshot(subject: "auth" | "core") {
  return {
    subject,
    mode: "runtime" as const,
    bindingName: "OPENMELD_DB",
    schemaSources: [
      {
        kind: subject === "auth" ? "schema_entrypoint" : "schema_module",
        owner: "packages/db",
        path:
          subject === "auth"
            ? "packages/db/src/auth/schema.ts"
            : "packages/db/src/core/dispatch.schema.ts",
        note: null,
      },
    ],
    migrationSources:
      subject === "auth"
        ? [
            {
              kind: "migration_dir",
              owner: "packages/db",
              path: "packages/db/drizzle",
              note: null,
            },
          ]
        : [
            {
              kind: "migration_dir",
              owner: "packages/db",
              path: "packages/db/drizzle",
              note: null,
            },
          ],
    target: {
      targetKind: "worker_binding" as const,
      bindingName: "OPENMELD_DB",
      databaseId: null,
      databaseName: null,
      localPath: null,
      resolvedFrom: "runtime_binding_present",
    },
    d1LocalDbPath: null,
    notes: [
      subject === "auth"
        ? "Auth D1 schema truth and shared migration ownership now live in packages/db."
        : "Core D1 canonical schema truth and shared versioned migration ownership now live in packages/db.",
    ],
  };
}

function buildAuthProfileRpcItem(input: {
  openMeldProfileId: string;
  profileName: string;
  profileKind: "human" | "agent" | "system";
  status?: "active" | "disabled";
  ownerUserId?: string;
  ownerName?: string;
}) {
  return {
    openMeldProfileId: input.openMeldProfileId,
    profileId: input.openMeldProfileId,
    profileName: input.profileName,
    profileKind: input.profileKind,
    status: input.status ?? "active",
    ownerUserId: input.ownerUserId ?? "owner-001",
    ...(input.ownerName ? { ownerName: input.ownerName } : {}),
  };
}

function buildListProfilesResult(
  profiles: ReturnType<typeof buildAuthProfileRpcItem>[]
) {
  return {
    ok: true as const,
    profiles,
  };
}

function buildResolveProfileByIdMock(
  profiles: ReturnType<typeof buildAuthProfileRpcItem>[]
) {
  return vi.fn((input?: { openMeldProfileId?: string }) => {
    const requestedProfileId =
      input?.openMeldProfileId ??
      profiles.find((item) => item.profileKind === "human")?.openMeldProfileId;
    const profile = profiles.find(
      (item) => item.openMeldProfileId === requestedProfileId
    );
    if (!profile) {
      return {
        ok: false as const,
        code: "profile.not_found",
        message: `profile not found: ${requestedProfileId ?? "unknown"}`,
      };
    }
    return {
      ok: true as const,
      resolvedProfile: {
        openMeldProfileId: profile.openMeldProfileId,
        profileName: profile.profileName,
        profileKind: profile.profileKind,
        ownerUserId: profile.ownerUserId,
        ...(profile.ownerName ? { ownerName: profile.ownerName } : {}),
      },
    };
  });
}

function buildOfflineAgentMemberSnapshot(input: {
  profileId: string;
  profileName: string;
  agentControllerRef: string;
  ownerName: string;
}) {
  const daemonRouteObservation = createDaemonRouteObservationSummary({
    observedAt: "2026-03-06T00:00:00.000Z",
    status: "offline",
  });
  const agentExecutionReadiness = createSpaceMemberAgentExecutionReadiness({
    agentProfileId: input.profileId,
    displayState: "not_ready",
    facts: {
      route: {
        online: false,
        reasonCodes: ["agent_execution.route_offline"],
        source: "daemon_route",
      },
    },
    primaryAction: "check_status",
    reasonCodes: ["agent_execution.route_offline"],
  });

  return {
    profileId: input.profileId,
    profileName: input.profileName,
    profileKind: "agent" as const,
    mentionAlias: null,
    status: "active" as const,
    memberSource: "added_by_member" as const,
    memberSourceLabel: "Added by Mira",
    addedAt: "2026-03-06T00:00:00.000Z",
    removedAt: null,
    createdAt: "2026-03-06T00:00:00.000Z",
    updatedAt: "2026-03-06T00:00:00.000Z",
    addedByProfileId: VALID_HUMAN_PROFILE_ID,
    addedByOwnerUserId: "owner-001",
    addedByDisplayName: "Mira",
    removedByProfileId: null,
    removedByOwnerUserId: null,
    removalReason: null,
    firstEnteredAt: null,
    lastEnteredAt: null,
    lastSeenAt: null,
    lastSeenLabel: null,
    liveNow: false,
    ownerUserId: "owner-001",
    ownerName: input.ownerName,
    agentControllerRef: input.agentControllerRef,
    agentControllerConversationId: null,
    agentWakeAvailability: {
      action: "check_status" as const,
      badgeLabel: "Offline",
      category: "offline" as const,
      isRefreshing: false,
      label: "Offline for Wake",
      phase: "offline" as const,
      reasonCode: "agent_execution.route_offline",
      status: "offline_for_wake" as const,
      summary: "This agent's connection is offline.",
      tooltip: "Agent connection is offline",
    },
    ownerWakeDiagnostics: {
      state: "checking_wake_status" as const,
      agentWakeRouteRegistration: {
        status: "registered" as const,
        reasonCode: null,
        reportedAtMs: 1_777_000_000_000,
        daemonSessionId: "daemon-session-1",
        deviceId: "device-1",
        lane: "dev-local" as const,
        serviceVersion: "0.7.57",
      },
      agentExecutionReadiness,
      wakeRouteEvidence: daemonRouteObservation,
      wakeRouteStatus: {
        status: "offline" as const,
      },
    },
  };
}

function createStructuredRpcHttpError(input: {
  status: number;
  code?: string;
  message: string;
}): Error {
  const error = new Error(input.message) as Error & {
    status?: number;
    code?: string;
  };
  error.status = input.status;
  if (input.code) {
    error.code = input.code;
  }
  return error;
}

function buildBootstrapPayload() {
  return {
    status: {
      spaceId: "demo",
      generatedAt: "2026-03-21T00:00:00.000Z",
      name: "demo",
      accessMode: "protected",
      passwordProtected: true,
      dispatchPolicy: { mode: "mention_only" },
      publicationMode: "collaboration",
      allowedActions: ["post_message", "post_status", "stay_silent"],
      resultArchivePolicy: { mode: "all_final_results" },
      entryBrief: "default",
      dispatchBrief: "default",
      members: {
        totalCount: 2,
        humanCount: 1,
        agentCount: 1,
        liveNowCount: 1,
        liveHumanCount: 1,
        liveAgentCount: 0,
      },
    },
    members: {
      spaceId: "demo",
      generatedAt: "2026-03-06T00:00:00.000Z",
      summary: {
        totalCount: 0,
        humanCount: 0,
        agentCount: 0,
        liveNowCount: 0,
      },
      humans: [],
      agents: [],
    },
    history: {
      signals: [],
      nextCursor: null,
    },
    threads: {
      threads: [],
      previews: [],
    },
  };
}

function makeEnv(input?: {
  coreOverrides?: Partial<CoreRpcMock>;
  authOverrides?: Partial<AuthRpcMock>;
}): {
  env: CloudflareBindings;
  rpc: CoreRpcMock;
  authRpc: AuthRpcMock;
  writeDataPoint: ReturnType<typeof vi.fn>;
} {
  const writeDataPoint = vi.fn();
  const rpc: CoreRpcMock = {
    fetch: vi.fn(async () => new Response("unused", { status: 500 })),
    ping: vi.fn(async () => ({ ok: true, service: "openmeld-core" })),
    inspectDbState: vi.fn(async () => buildDbSnapshot("core")),
    inspectDispatchStorageReadiness: vi.fn(async () => ({
      ready: true,
      detail: null,
      checkedAt: "2026-04-07T00:00:00.000Z",
    })),
    createSpace: vi.fn(async () => ({ spaceId: "from-core-space-id" })),
    centerAgentGetOrganizationDirectory: vi.fn(),
    getCurrentOrganizationAgentRuntimeOverview: vi.fn(async () => ({
      organizationId: "org-1",
      generatedAt: "2026-07-04T00:00:00.000Z",
      agentProfiles: [],
    })),
    getCurrentOrganizationDirectory: vi.fn(async () => ({
      organizationId: "org-1",
      generatedAt: "2026-07-04T00:00:00.000Z",
      members: [],
      agentProfiles: [],
    })),
    getCurrentOrganizationProfileDirectory: vi.fn(async () => ({
      organizationId: "org-1",
      generatedAt: "2026-07-04T00:00:00.000Z",
      members: [],
      agentProfiles: [],
    })),
    recordCurrentOrganizationWebActivity: vi.fn(async () => ({
      lastActiveAt: "2026-08-28T03:00:00.000Z",
      organizationId: "org-1",
      userId: "owner-001",
    })),
    getCurrentOrganizationMemberOpenMeldServiceStatuses: vi.fn(async () => ({
      generatedAt: "2026-07-21T00:00:00.000Z",
      members: [{ state: "connected" as const, userId: "user-1" }],
      organizationId: "org-1",
    })),
    getCurrentOrganizationSpaceDirectory: vi.fn(async () => ({
      organizationId: "org-1",
      generatedAt: "2026-07-04T00:00:00.000Z",
      spaces: [
        {
          spaceId: "demo",
          name: "ops-room",
          organizationId: "org-1",
          visibility: "public",
          joined: false,
          lastJoinedAt: null,
          spaceCreatedAt: "2026-07-04T00:00:00.000Z",
          spaceUpdatedAt: "2026-07-04T00:01:00.000Z",
          updatedAt: "2026-07-04T00:02:00.000Z",
        },
      ],
    })),
    getCurrentOrganizationSpaceDirectoryWithMemberCounts: vi.fn(async () => ({
      organizationId: "org-1",
      generatedAt: "2026-07-04T00:00:00.000Z",
      spaces: [
        {
          activeMemberCount: 4,
          spaceId: "demo",
          name: "ops-room",
          organizationId: "org-1",
          visibility: "public",
          joined: false,
          lastJoinedAt: null,
          spaceCreatedAt: "2026-07-04T00:00:00.000Z",
          spaceUpdatedAt: "2026-07-04T00:01:00.000Z",
          updatedAt: "2026-07-04T00:02:00.000Z",
        },
      ],
    })),
    readCenterAgentOrganizationMemoryPolicy: vi.fn(async () => ({
      organizationId: "org-1",
      organizationMemoryOptIn: false,
      provider: "zep_cloud",
      updatedByUserId: null,
    })),
    setCenterAgentOrganizationMemoryPolicy: vi.fn(async () => ({
      organizationId: "org-1",
      organizationMemoryOptIn: true,
      provider: "zep_cloud",
      updatedByUserId: "owner-001",
    })),
    readOrganizationInformationProtectionPolicy: vi.fn(async () => ({
      organizationId: "org-1",
      protectedInformation:
        "Unreleased Board forecasts and acquisition planning materials.",
      updatedAt: "2026-07-21T00:00:00.000Z",
      updatedByUserId: "owner-001",
    })),
    setOrganizationInformationProtectionPolicy: vi.fn(async () => ({
      organizationId: "org-1",
      protectedInformation:
        "Unreleased Board forecasts and acquisition planning materials.",
      updatedAt: "2026-07-21T00:01:00.000Z",
      updatedByUserId: "owner-001",
    })),
    readCurrentOrganizationFeedbackReportingPolicy: vi.fn(async () => ({
      organizationId: "org-1",
      reportingEnabled: true,
      updatedByUserId: null,
    })),
    setCurrentOrganizationFeedbackReportingPolicy: vi.fn(async () => ({
      organizationId: "org-1",
      reportingEnabled: false,
      updatedByUserId: "owner-001",
    })),
    wipeCurrentMemberCenterAgentMemory: vi.fn(async () => ({
      organizationId: "org-1",
      provider: "zep_cloud",
      status: "deleted",
      userId: "owner-001",
    })),
    listAccountSpaces: vi.fn(async () => ({
      pinnedItems: [],
      spaceItems: [],
    })),
    listAccountSpaceActiveWakeSummary: vi.fn(async () => ({
      generatedAtMs: 1000,
      items: [],
    })),
    deleteSpace: vi.fn(async () => ({ spaceId: "demo", deleted: true })),
    upsertSpacePassword: vi.fn(async () => ({
      spaceId: "demo",
      passwordProtected: true,
    })),
    clearSpacePassword: vi.fn(async () => ({
      spaceId: "demo",
      passwordProtected: false,
    })),
    listSignals: vi.fn(async () => ({
      signals: [{ type: "signal.text", data: { text: "x" } }],
      nextCursor: null,
    })),
    postSignal: vi.fn(async () => ({
      v: 1,
      id: "evt-1",
      spaceId: "demo",
      ts: 1,
      profile: { kind: "agent", profileId: "mira" },
      type: "signal.text",
      data: { text: "hi" },
    })),
    getSpaceMessageDetails: vi.fn(),
    getSpaceDispatchTrace: vi.fn(async () => ({
      query: {
        spaceId: "demo",
        dispatchId: "dispatch-1",
      },
      trace: {
        dispatch: {
          dispatchId: "dispatch-1",
          idempotencyKey: "idem-1",
          sourceEventId: "evt-1",
          targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
          status: "dispatching",
          firstSeenAt: "2026-03-09T00:00:00.000Z",
          lastAttemptAt: "2026-03-09T00:00:01.000Z",
          attemptCount: 1,
          latestAttemptId: "attempt-1",
        },
        latestAttempt: {
          attemptId: "attempt-1",
          dispatchId: "dispatch-1",
          idempotencyKey: "idem-1",
          attemptNo: 1,
          status: "waiting_result",
          daemonSessionId: "daemon-session-1",
          leaseEpoch: 1,
          createdAt: "2026-03-09T00:00:00.000Z",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: null,
          errorCode: null,
          errorMessage: null,
        },
        recentOpsDecisions: [],
        replySignal: null,
      },
    })),
    getSpaceDispatchLookup: vi.fn(async () => ({
      query: {
        spaceId: "demo",
        sourceSignalId: "sig-source-1",
        clientMessageId: null,
        targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
      },
      matches: [
        {
          dispatchId: "dispatch-1",
          sourceSignalId: "sig-source-1",
          targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
          status: "dispatching",
          attemptCount: 1,
          latestAttemptId: "attempt-1",
          latestAttemptStatus: "waiting_result",
          latestAttemptErrorCode: null,
          latestAttemptErrorMessage: null,
        },
      ],
    })),
    getSpaceWakeProgress: vi.fn(async () => ({
      query: {
        spaceId: "demo",
        clientMessageId: "client-message-1",
        targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
      },
      items: [
        {
          clientMessageId: "client-message-1",
          sourceSignalId: "sig-source-1",
          dispatchId: "dispatch-1",
          targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
          targetLabel: "@watcher",
          phase: "running",
          message: "@watcher is working on this computer...",
          updatedAtMs: 1_805_000_000_000,
          terminal: false,
        },
      ],
    })),
    getActiveSpaceWakeProgress: vi.fn(async () => ({
      query: {
        spaceId: "demo",
        targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
      },
      items: [
        {
          clientMessageId: "client-message-1",
          sourceSignalId: "sig-source-1",
          dispatchId: "dispatch-1",
          targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
          targetLabel: "@watcher",
          phase: "running",
          message: "@watcher is working on this computer...",
          updatedAtMs: 1_805_000_000_000,
          terminal: false,
        },
      ],
    })),
    postSpaceWakeStop: vi.fn(async () => ({
      ok: false,
      status: "unsupported",
      reasonCode: "agent_controller_interface.stop_unsupported",
      runtimeCoordinatorExecutionId: null,
      targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
      cancellationState: {
        status: "unsupported",
        reasonCode: "agent_controller_interface.stop_unsupported",
        observedAtMs: 1_805_000_000_000,
      },
    })),
    respondToSpaceAgentInteraction: vi.fn(async () => ({
      ok: true,
      respondedAtMs: 1_805_000_000_000,
      status: "accepted",
    })),
    getSpaceMembers: vi.fn(async () => ({
      spaceId: "demo",
      generatedAt: "2026-03-06T00:00:00.000Z",
      summary: {
        totalCount: 1,
        humanCount: 1,
        agentCount: 0,
        liveNowCount: 0,
      },
      humans: [
        {
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Mira",
          profileKind: "human",
          mentionAlias: null,
          status: "active",
          memberSource: "space_creator",
          memberSourceLabel: "Creator",
          addedAt: "2026-03-06T00:00:00.000Z",
          removedAt: null,
          createdAt: "2026-03-06T00:00:00.000Z",
          updatedAt: "2026-03-06T00:00:00.000Z",
          addedByProfileId: null,
          addedByOwnerUserId: null,
          addedByDisplayName: null,
          removedByProfileId: null,
          removedByOwnerUserId: null,
          removalReason: null,
          firstEnteredAt: "2026-03-06T00:00:00.000Z",
          lastEnteredAt: "2026-03-06T00:00:00.000Z",
          lastSeenAt: "2026-03-06T00:00:00.000Z",
          lastSeenLabel: "Seen just now",
          liveNow: false,
          ownerUserId: "owner-001",
          ownerName: "Mira",
        },
      ],
      agents: [],
    })),
    getSpaceIdentityDirectory: vi.fn(async () => ({
      spaceId: "demo",
      generatedAt: "2026-03-06T00:00:00.000Z",
      entries: [
        {
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Mira",
          profileKind: "human",
          mentionAlias: null,
          ownerUserId: "owner-001",
          ownerName: "Mira",
          agentControllerRef: null,
        },
      ],
    })),
    getSpaceMemberDirectory: vi.fn(async () => ({
      spaceId: "demo",
      generatedAt: "2026-03-06T00:00:00.000Z",
      members: [
        {
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          displayName: "Mira",
          primaryMentionLabel: "Mira",
          mentionLabels: ["Mira"],
          mentionAlias: null,
          labelSource: "profile_name",
          lookupTokens: ["mira", "11111111-1111-4111-8111-111111111111"],
          preferredLookupToken: "mira",
          profileIdShort: "11111",
          allowedRelations: {
            wake: false,
            reference: false,
            mention: true,
          },
          ownerUserId: "owner-001",
          ownerName: "Mira",
          agentCard: null,
          spaceRole: null,
        },
      ],
    })),
    addSpaceMembers: vi.fn(async () => ({
      addedMemberIds: [VALID_TARGET_AGENT_PROFILE_ID],
      alreadyMemberIds: [],
      items: [
        buildOfflineAgentMemberSnapshot({
          profileId: VALID_TARGET_AGENT_PROFILE_ID,
          profileName: "Ops Bot",
          agentControllerRef: "builtin:ops-bot",
          ownerName: "Mira",
        }),
      ],
    })),
    addCenterAgentToSpace: vi.fn(async () => ({
      addedMemberIds: [VALID_TARGET_AGENT_PROFILE_ID],
      alreadyMemberIds: [],
      items: [],
    })),
    addOrganizationDirectoryProfilesToSpace: vi.fn(async () => ({
      addedMemberIds: [VALID_HUMAN_PROFILE_ID, VALID_TARGET_AGENT_PROFILE_ID],
      alreadyMemberIds: [],
      items: [],
    })),
    joinOrganizationPublicSpace: vi.fn(async () => ({
      addedMemberIds: [VALID_HUMAN_PROFILE_ID],
      alreadyMemberIds: [],
      items: [],
    })),
    removeSpaceMembers: vi.fn(async () => ({
      removedMemberIds: [VALID_TARGET_AGENT_PROFILE_ID],
      alreadyAbsentMemberIds: [],
    })),
    leaveSpace: vi.fn(async () => ({
      leftProfileId: VALID_HUMAN_PROFILE_ID,
      status: "left",
    })),
    getSpaceMeta: vi.fn(async () => ({
      spaceId: "demo",
      guide: "Be concise and helpful.",
    })),
    getSpaceBoard: vi.fn(async () => ({
      space: {
        id: "demo",
        name: "Launch Room",
        purpose: "Coordinate the launch.",
        guide: "Be concise and helpful.",
      },
      members: {
        totalCount: 2,
        humanCount: 1,
        agentCount: 1,
        centerAgentPresent: false,
      },
      workingNow: [],
      recentOutcomes: [],
    })),
    getSpaceContract: vi.fn(async () => ({
      version: 1,
      updatedAt: "2026-03-19T00:00:00.000Z",
      updatedBy: "system",
      dispatchPolicy: { mode: "mention_only" },
      publicationMode: "collaboration",
      allowedActions: ["post_message", "post_status", "stay_silent"],
      resultArchivePolicy: { mode: "all_final_results" },
      authorityOrder: "default",
      entryBrief: "default",
      dispatchBrief: "default",
    })),
    patchSpaceContract: vi.fn(async () => ({
      version: 2,
      updatedAt: "2026-03-19T00:01:00.000Z",
      updatedBy: "11111111-1111-4111-8111-111111111111",
      dispatchPolicy: { mode: "mention_only" },
      publicationMode: "raw_context_sharing",
      allowedActions: ["post_status", "stay_silent"],
      resultArchivePolicy: { mode: "space_reply_only" },
      authorityOrder: "default",
      entryBrief: "none",
      dispatchBrief: "default",
    })),
    getSpaceBootstrap: vi.fn(async () => buildBootstrapPayload()),
    getSpaceBootstrapWithTiming: vi.fn(async () => ({
      metrics: [
        {
          name: "openmeld_bootstrap_total",
          description: "OpenMeld space bootstrap total",
          durationMs: 42,
        },
      ],
      payload: buildBootstrapPayload(),
      serverTiming:
        'openmeld_bootstrap_total;dur=42;desc="OpenMeld space bootstrap total"',
    })),
    getSpaceStatus: vi.fn(async () => ({
      spaceId: "demo",
      generatedAt: "2026-03-21T00:00:00.000Z",
      name: "demo",
      organizationVisibility: "private",
      accessMode: "protected",
      passwordProtected: true,
      dispatchPolicy: { mode: "mention_only" },
      publicationMode: "collaboration",
      allowedActions: ["post_message", "post_status", "stay_silent"],
      resultArchivePolicy: { mode: "all_final_results" },
      entryBrief: "default",
      dispatchBrief: "default",
      members: {
        totalCount: 2,
        humanCount: 1,
        agentCount: 1,
        liveNowCount: 1,
        liveHumanCount: 1,
        liveAgentCount: 0,
      },
      latestVisibleUpdate: {
        signalId: "sig-2",
        signalType: "signal.status",
        createdAt: "2026-03-21T00:00:00.000Z",
        actorProfileId: VALID_TARGET_AGENT_PROFILE_ID,
        actorName: "Ops Bot",
        previewText: "done",
      },
    })),
    listSpaceThreads: vi.fn(async () => ({
      threads: [],
      previews: [],
    })),
    getSpaceUpdates: vi.fn(async () => ({
      signals: [
        {
          v: 1,
          id: "sig-2",
          spaceId: "demo",
          ts: 2,
          profile: {
            kind: "agent",
            profileId: VALID_TARGET_AGENT_PROFILE_ID,
            profileName: "Ops Bot",
          },
          type: "signal.status",
          data: {
            actorProfileId: VALID_TARGET_AGENT_PROFILE_ID,
            actorName: "Ops Bot",
            dispatchId: "dispatch-1",
            generatedBy: "agent",
            status: "done",
            text: "done",
          },
        },
      ],
    })),
    getSpaceDispatchResult: vi.fn(async () => ({
      resultRef: "dispatch-result:result-1",
      dispatchId: "dispatch-1",
      spaceId: "demo",
      actorProfileId: VALID_TARGET_AGENT_PROFILE_ID,
      replyToSignalId: "sig-1",
      resultKind: "status",
      statusType: "done",
      previewText: "done",
      publicOutcome: "post_status",
      publishedSignalId: "sig-2",
      createdAt: "2026-03-21T00:00:00.000Z",
    })),
    createSpaceDiagnosticReport: vi.fn(async () => ({
      diagnosticReportId: "diag_1",
      spaceId: "demo",
      reportedSignalId: "sig-reported-1",
      replyToSignalId: "sig-source-1",
      threadId: null,
      problemType: "reply_problem",
      reporterProfileId: VALID_HUMAN_PROFILE_ID,
      createdAtMs: 1_805_000_000_000,
      wakePointers: [
        {
          spaceId: "demo",
          clientMessageId: "client-message-1",
          sourceSignalId: "sig-source-1",
          targetProfileId: VALID_TARGET_AGENT_PROFILE_ID,
        },
      ],
      wakePointerDerivation: {
        status: "exact",
        reasonCodes: ["diagnostic_report.reply_target_exact"],
      },
    })),
    updateSpaceMeta: vi.fn(async () => ({
      spaceId: "demo",
      guide: "Updated guideline",
    })),
    putSpaceContract: vi.fn(async () => ({
      version: 2,
      updatedAt: "2026-03-19T00:01:00.000Z",
      updatedBy: "11111111-1111-4111-8111-111111111111",
      dispatchPolicy: { mode: "mention_only" },
      publicationMode: "collaboration",
      allowedActions: ["post_message", "post_status", "stay_silent"],
      resultArchivePolicy: { mode: "all_final_results" },
      authorityOrder: "default",
      entryBrief: "default",
      dispatchBrief: "default",
    })),
    getSpaceCursor: vi.fn(async () => ({
      spaceId: "demo",
      profileId: "11111111-1111-4111-8111-111111111111",
      lastSeenTs: 123,
    })),
    updateSpaceCursor: vi.fn(async () => ({
      spaceId: "demo",
      profileId: "11111111-1111-4111-8111-111111111111",
      lastSeenTs: 456,
    })),
    ...(input?.coreOverrides ?? {}),
  };

  const authRpc: AuthRpcMock = {
    ping: vi.fn(async () => ({ ok: true, service: "openmeld-auth" })),
    inspectDbState: vi.fn(async () => buildDbSnapshot("auth")),
    resolveRequestAuth: vi.fn(async () => ({
      ok: true,
      claims: {
        authenticated: true,
        requestId: "req-test",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human",
        ownerIds: [],
        authMethod: "session",
      },
    })),
    resolveProfile: vi.fn(async () => ({
      ok: true,
      resolvedProfile: {
        openMeldProfileId: "11111111-1111-4111-8111-111111111111",
        profileName: "Mira",
        profileKind: "human",
        ownerUserId: "owner-001",
      },
    })),
    listProfiles: vi.fn(async () =>
      buildListProfilesResult([
        buildAuthProfileRpcItem({
          openMeldProfileId: VALID_HUMAN_PROFILE_ID,
          profileName: "Mira",
          profileKind: "human",
        }),
        buildAuthProfileRpcItem({
          openMeldProfileId: VALID_TARGET_AGENT_PROFILE_ID,
          profileName: "Ops Bot",
          profileKind: "agent",
          ownerName: "Mira",
        }),
      ])
    ),
    listProfileSpaceHistory: vi.fn(async () => ({
      ok: true,
      items: [],
    })),
    querySpaceDeletionTombstones: vi.fn(async () => ({
      ok: true,
      items: [],
    })),
    upsertProfileSpaceHistory: vi.fn(async () => ({
      ok: true,
      item: {
        profileId: "11111111-1111-4111-8111-111111111111",
        gatewayHost: "localhost:8080",
        spaceId: "demo",
        spaceName: "ops-room",
        creatorProfileId: "11111111-1111-4111-8111-111111111111",
        creatorKind: "human",
        spaceCreatedAt: "2026-02-24T00:00:00.000Z",
        spaceUpdatedAt: "2026-02-24T00:00:01.000Z",
        lastJoinedAt: "2026-02-24T00:00:02.000Z",
        lastSeenTs: 5,
        pinnedAt: null,
        status: "active",
        createdAt: "2026-02-24T00:00:00.000Z",
        updatedAt: "2026-02-24T00:00:03.000Z",
      },
      spaceIndexOverlay: {
        repairAttempted: false,
        status: "applied",
        updated: true,
      },
    })),
    upsertSpaceDeletionTombstone: vi.fn(async () => ({
      ok: true,
      item: {
        gatewayHost: "localhost:8080",
        spaceId: "demo",
        spaceName: "ops-room",
        creatorProfileId: "11111111-1111-4111-8111-111111111111",
        creatorKind: "human",
        deletedByProfileId: "11111111-1111-4111-8111-111111111111",
        deletedByProfileName: "Mira",
        deletedByOwnerUserId: "owner-001",
        deletedAt: "2026-03-12T00:00:00.000Z",
        createdAt: "2026-03-12T00:00:00.000Z",
        updatedAt: "2026-03-12T00:00:00.000Z",
      },
    })),
    updateProfileSpaceHistoryStatus: vi.fn(async () => ({
      ok: true,
      item: {
        profileId: "11111111-1111-4111-8111-111111111111",
        gatewayHost: "localhost:8080",
        spaceId: "demo",
        status: "removed",
        updatedAt: "2026-02-24T00:00:03.000Z",
      },
    })),
    ...(input?.authOverrides ?? {}),
  };

  const env = {
    OPENMELD_CORE_WORKER: {
      fetch: rpc.fetch,
      ping: rpc.ping,
      inspectDbState: rpc.inspectDbState,
      inspectDispatchStorageReadiness: rpc.inspectDispatchStorageReadiness,
      createSpace: rpc.createSpace,
      centerAgentGetOrganizationDirectory:
        rpc.centerAgentGetOrganizationDirectory,
      getCurrentOrganizationAgentRuntimeOverview:
        rpc.getCurrentOrganizationAgentRuntimeOverview,
      getCurrentOrganizationDirectory: rpc.getCurrentOrganizationDirectory,
      getCurrentOrganizationProfileDirectory:
        rpc.getCurrentOrganizationProfileDirectory,
      recordCurrentOrganizationWebActivity:
        rpc.recordCurrentOrganizationWebActivity,
      getCurrentOrganizationMemberOpenMeldServiceStatuses:
        rpc.getCurrentOrganizationMemberOpenMeldServiceStatuses,
      getCurrentOrganizationSpaceDirectory:
        rpc.getCurrentOrganizationSpaceDirectory,
      getCurrentOrganizationSpaceDirectoryWithMemberCounts:
        rpc.getCurrentOrganizationSpaceDirectoryWithMemberCounts,
      readCenterAgentOrganizationMemoryPolicy:
        rpc.readCenterAgentOrganizationMemoryPolicy,
      setCenterAgentOrganizationMemoryPolicy:
        rpc.setCenterAgentOrganizationMemoryPolicy,
      readOrganizationInformationProtectionPolicy:
        rpc.readOrganizationInformationProtectionPolicy,
      setOrganizationInformationProtectionPolicy:
        rpc.setOrganizationInformationProtectionPolicy,
      readCurrentOrganizationFeedbackReportingPolicy:
        rpc.readCurrentOrganizationFeedbackReportingPolicy,
      setCurrentOrganizationFeedbackReportingPolicy:
        rpc.setCurrentOrganizationFeedbackReportingPolicy,
      wipeCurrentMemberCenterAgentMemory:
        rpc.wipeCurrentMemberCenterAgentMemory,
      listAccountSpaces: rpc.listAccountSpaces,
      listAccountSpaceActiveWakeSummary: rpc.listAccountSpaceActiveWakeSummary,
      deleteSpace: rpc.deleteSpace,
      upsertSpacePassword: rpc.upsertSpacePassword,
      clearSpacePassword: rpc.clearSpacePassword,
      listSignals: rpc.listSignals,
      postSignal: rpc.postSignal,
      getSpaceDispatchTrace: rpc.getSpaceDispatchTrace,
      getSpaceMessageDetails: rpc.getSpaceMessageDetails,
      getSpaceDispatchLookup: rpc.getSpaceDispatchLookup,
      getActiveSpaceWakeProgress: rpc.getActiveSpaceWakeProgress,
      getSpaceWakeProgress: rpc.getSpaceWakeProgress,
      postSpaceWakeStop: rpc.postSpaceWakeStop,
      respondToSpaceAgentInteraction: rpc.respondToSpaceAgentInteraction,
      getSpaceMembers: rpc.getSpaceMembers,
      getSpaceIdentityDirectory: rpc.getSpaceIdentityDirectory,
      getSpaceMemberDirectory: rpc.getSpaceMemberDirectory,
      addSpaceMembers: rpc.addSpaceMembers,
      addCenterAgentToSpace: rpc.addCenterAgentToSpace,
      addOrganizationDirectoryProfilesToSpace:
        rpc.addOrganizationDirectoryProfilesToSpace,
      joinOrganizationPublicSpace: rpc.joinOrganizationPublicSpace,
      removeSpaceMembers: rpc.removeSpaceMembers,
      leaveSpace: rpc.leaveSpace,
      getSpaceMeta: rpc.getSpaceMeta,
      getSpaceBoard: rpc.getSpaceBoard,
      getSpaceContract: rpc.getSpaceContract,
      patchSpaceContract: rpc.patchSpaceContract,
      getSpaceStatus: rpc.getSpaceStatus,
      getSpaceBootstrap: rpc.getSpaceBootstrap,
      getSpaceBootstrapWithTiming: rpc.getSpaceBootstrapWithTiming,
      listSpaceThreads: rpc.listSpaceThreads,
      getSpaceUpdates: rpc.getSpaceUpdates,
      getSpaceDispatchResult: rpc.getSpaceDispatchResult,
      createSpaceDiagnosticReport: rpc.createSpaceDiagnosticReport,
      updateSpaceMeta: rpc.updateSpaceMeta,
      putSpaceContract: rpc.putSpaceContract,
      getSpaceCursor: rpc.getSpaceCursor,
      updateSpaceCursor: rpc.updateSpaceCursor,
    },
    OPENMELD_AUTH_WORKER: authRpc,
    OPENMELD_OBSERVABILITY: { writeDataPoint },
  } as unknown as CloudflareBindings;

  return {
    env,
    rpc,
    authRpc,
    writeDataPoint,
  };
}

describe("gateway root routes", () => {
  it("returns canonical gateway health payload", async () => {
    const { env } = makeEnv();
    const response = await app.fetch(
      new Request("http://local/health"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "openmeld-gateway",
      releaseSha: null,
    });
  });

  it("reports the exact release source the running version was deployed from", async () => {
    const { env } = makeEnv();
    const releaseSha = "0123456789abcdef0123456789abcdef01234567";
    const response = await app.fetch(
      new Request("http://local/health"),
      { ...env, RELEASE_SHA: releaseSha },
      TEST_EXECUTION_CONTEXT
    );

    await expect(response.json()).resolves.toMatchObject({ releaseSha });
  });
});

describe("gateway http forwarding", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes createSpace in the root service document", async () => {
    const response = await app.request("http://local/");
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      endpoints?: Record<string, string>;
    };
    expect(payload.endpoints?.getSpaceStatus).toBe(
      "GET /v1/spaces/:spaceId/status"
    );
    expect(payload.endpoints?.postSignal).toBe(
      "POST /v1/spaces/:spaceId/signals"
    );
    expect(payload.endpoints?.listSignals).toBe(
      "GET /v1/spaces/:spaceId/signals"
    );
    expect(payload.endpoints?.getSpaceMembers).toBe(
      "GET /v1/spaces/:spaceId/members"
    );
    expect(payload.endpoints?.getSpaceIdentityDirectory).toBe(
      "GET /v1/spaces/:spaceId/identity-directory"
    );
    expect(payload.endpoints?.getSpaceMemberDirectory).toBe(
      "GET /v1/spaces/:spaceId/member-directory"
    );
    expect(payload.endpoints?.getSpaceEntryResolution).toBe(
      "GET /v1/spaces/:spaceId/entry-resolution"
    );
    expect(payload.endpoints?.addSpaceMembers).toBe(
      "POST /v1/spaces/:spaceId/members"
    );
    expect(payload.endpoints?.removeSpaceMembers).toBe(
      "POST /v1/spaces/:spaceId/members/remove"
    );
    expect(payload.endpoints?.leaveSpace).toBe(
      "POST /v1/spaces/:spaceId/leave"
    );
    expect(payload.endpoints?.joinSpace).toBe("POST /v1/spaces/:spaceId/join");
    expect(payload.endpoints?.addCenterAgentToSpace).toBe(
      "POST /v1/spaces/:spaceId/center-agent"
    );
    expect(payload.endpoints?.addOrganizationDirectoryProfilesToSpace).toBe(
      "POST /v1/spaces/:spaceId/organization-directory-profiles"
    );
    expect(payload.endpoints?.listSpaceThreads).toBe(
      "GET /v1/spaces/:spaceId/threads"
    );
    expect(payload.endpoints?.createSpaceThread).toBe(
      "POST /v1/spaces/:spaceId/threads"
    );
    expect(Object.keys(payload.endpoints ?? {}).sort()).toEqual([
      "addCenterAgentToSpace",
      "addOrganizationDirectoryProfilesToSpace",
      "addSpaceMembers",
      "createSpaceThread",
      "getSpaceConversationState",
      "getSpaceEntryResolution",
      "getSpaceIdentityDirectory",
      "getSpaceLinkPreviews",
      "getSpaceMemberDirectory",
      "getSpaceMembers",
      "getSpaceStatus",
      "joinSpace",
      "leaveSpace",
      "listSignals",
      "listSpaceThreads",
      "postSignal",
      "removeSpaceMembers",
    ]);
  });

  it("fails closed when OPENMELD_AUTH_WORKER binding is missing", async () => {
    const { env, rpc } = makeEnv();
    const envWithoutAuth = {
      OPENMELD_CORE_WORKER: env.OPENMELD_CORE_WORKER,
    } as unknown as CloudflareBindings;
    const request = new Request("http://local/v1/spaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "smoke-gw", visibility: "private" }),
    });

    const response = await app.fetch(
      request,
      envWithoutAuth,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(503);
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("gateway.misconfigured");
    expect(payload.error?.message).toBe(
      "missing worker binding: OPENMELD_AUTH_WORKER"
    );
    expect(payload.error?.requestId).toBeTruthy();
    expect(rpc.createSpace).not.toHaveBeenCalled();
  });

  it("fails closed when OPENMELD_CORE_WORKER binding is missing", async () => {
    const { env, rpc } = makeEnv();
    const envWithoutCore = {
      OPENMELD_AUTH_WORKER: env.OPENMELD_AUTH_WORKER,
    } as unknown as CloudflareBindings;
    const request = new Request("http://local/v1/spaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "smoke-gw", visibility: "private" }),
    });

    const response = await app.fetch(
      request,
      envWithoutCore,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(503);
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("gateway.misconfigured");
    expect(payload.error?.message).toBe(
      "missing worker binding: OPENMELD_CORE_WORKER"
    );
    expect(payload.error?.requestId).toBeTruthy();
    expect(rpc.createSpace).not.toHaveBeenCalled();
  });

  it("returns 502 when auth upstream fails during resolveRequestAuth", async () => {
    const { env, rpc, authRpc } = makeEnv({
      authOverrides: {
        resolveRequestAuth: vi.fn(async () => ({
          ok: false,
          code: "auth.upstream_unreachable",
          message: "auth upstream unavailable",
        })),
      },
    });
    const request = new Request("http://local/v1/spaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "smoke-gw" }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(502);
    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("upstream_unreachable");
    expect(payload.error?.message).toBe("auth upstream unavailable");
    expect(payload.error?.requestId).toBeTruthy();
    expect(authRpc.resolveProfile).not.toHaveBeenCalled();
    expect(rpc.createSpace).not.toHaveBeenCalled();
  });

  it("returns diagnostics chain payload from gateway/auth/core", async () => {
    const { env, rpc, authRpc } = makeEnv();
    const request = new Request("http://local/v1/diagnostics/chain", {
      method: "GET",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      ok?: boolean;
      service?: string;
      auth?: { service?: string };
      core?: { service?: string };
      db?: DbDiagnosticsPayload;
      profile?: {
        profileId?: string;
        profileKind?: string;
        profileName?: string;
      };
    };
    expect(payload.ok).toBe(true);
    expect(payload.service).toBe("openmeld-gateway");
    expect(payload.auth?.service).toBe("openmeld-auth");
    expect(payload.core?.service).toBe("openmeld-core");
    expect(payload.db?.contractVersion).toBe(DB_FACT_SCHEMA_VERSION);
    expect(payload.db?.auth?.subject).toBe("auth");
    expect(payload.db?.core?.subject).toBe("core");
    expect(payload.db?.auth?.target?.databaseId).toBeNull();
    expect(payload.db?.auth?.target?.databaseName).toBeNull();
    expect(payload.db?.auth?.target?.resolvedFrom).toBe(
      "runtime_binding_present"
    );
    expect(payload.db?.core?.target?.databaseId).toBeNull();
    expect(payload.db?.core?.target?.databaseName).toBeNull();
    expect(payload.db?.core?.target?.resolvedFrom).toBe(
      "runtime_binding_present"
    );
    expect(
      payload.db?.auth &&
        Object.hasOwn(payload.db.auth, "declaredFallbackPaths")
    ).toBe(false);
    expect(
      payload.db?.core && Object.hasOwn(payload.db.core, "observedFallbackHits")
    ).toBe(false);
    expect(payload.profile?.profileId).toBe(
      "11111111-1111-4111-8111-111111111111"
    );
    expect(rpc.ping).toHaveBeenCalledTimes(1);
    expect(authRpc.ping).toHaveBeenCalledTimes(1);
    expect(rpc.inspectDbState).toHaveBeenCalledTimes(1);
    expect(rpc.inspectDispatchStorageReadiness).toHaveBeenCalledTimes(1);
    expect(authRpc.inspectDbState).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when core dispatch storage is not ready", async () => {
    const { env } = makeEnv({
      coreOverrides: {
        inspectDispatchStorageReadiness: vi.fn(async () => ({
          ready: false,
          detail:
            "Shared OPENMELD_DB migration is missing required index openMeldDaemon_dispatch_ledger_idempotency_key_unique. Apply the shared DB gate before starting Core.",
          checkedAt: "2026-04-07T00:00:00.000Z",
        })),
      },
    });
    const request = new Request("http://local/v1/diagnostics/chain", {
      method: "GET",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(503);
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("upstream_unreachable");
    expect(payload.error?.message).toContain(
      "Core dispatch storage is not ready"
    );
    expect(payload.error?.message).toContain(
      "openMeldDaemon_dispatch_ledger_idempotency_key_unique"
    );
    expect(payload.error?.requestId).toBeTruthy();
  });

  it("returns 502 when core diagnostics ping fails", async () => {
    const { env } = makeEnv({
      coreOverrides: {
        ping: vi.fn(() => {
          throw new Error(
            'Cannot access "ping" due to missing local dev session'
          );
        }),
      },
    });
    const request = new Request("http://local/v1/diagnostics/chain", {
      method: "GET",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(502);
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("upstream_unreachable");
    expect(payload.error?.message).toContain("missing local dev session");
    expect(payload.error?.requestId).toBeTruthy();
  });

  it("returns 502 when core db diagnostics inspect fails", async () => {
    const { env } = makeEnv({
      coreOverrides: {
        inspectDbState: vi.fn(() => {
          throw new Error("inspect db state unavailable");
        }),
      },
    });
    const request = new Request("http://local/v1/diagnostics/chain", {
      method: "GET",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(502);
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("upstream_unreachable");
    expect(payload.error?.message).toContain("inspect db state unavailable");
    expect(payload.error?.requestId).toBeTruthy();
  });

  it("returns 401 for forged profile headers when auth claims are unauthenticated", async () => {
    const { env, rpc, authRpc } = makeEnv({
      authOverrides: {
        resolveRequestAuth: vi.fn(async () => ({
          ok: true,
          claims: {
            authenticated: false,
            requestId: "req-auth-401",
            ownerIds: [],
            authMethod: "none",
          },
        })),
      },
    });
    const request = new Request("http://local/v1/spaces", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-openmeld-profile-id": "forged-profile",
        "x-openmeld-profile-kind": "agent",
      },
      body: JSON.stringify({ name: "smoke-gw" }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(401);
    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("auth.unauthenticated");
    expect(payload.error?.message).toBe("authentication required");
    expect(payload.error?.requestId).toBe("req-auth-401");
    expect(authRpc.resolveProfile).not.toHaveBeenCalled();
    expect(rpc.createSpace).not.toHaveBeenCalled();
  });

  it("returns 404 when explicit profile cannot be resolved", async () => {
    const { env, rpc } = makeEnv({
      authOverrides: {
        resolveProfile: vi.fn(async () => ({
          ok: false,
          code: "profile.not_found",
          message: "profile not found",
        })),
      },
    });
    const request = new Request("http://local/v1/spaces", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-openmeld-profile-id": "agt_45678901-4567-4567-8567-45678901abcd",
      },
      body: JSON.stringify({ name: "smoke-gw" }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(404);
    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("profile.not_found");
    expect(payload.error?.message).toBe("profile not found");
    expect(payload.error?.requestId).toBe("req-test");
    expect(rpc.createSpace).not.toHaveBeenCalled();
  });

  it("returns 400 when explicit profile input is invalid", async () => {
    const { env, rpc } = makeEnv({
      authOverrides: {
        resolveProfile: vi.fn(async () => ({
          ok: false,
          code: "profile.invalid_input",
          message: "profileId must be a UUID or agt_<UUID>",
        })),
      },
    });
    const request = new Request("http://local/v1/spaces", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-openmeld-profile-id": "not-a-valid-profile-id",
      },
      body: JSON.stringify({ name: "smoke-gw" }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("profile.invalid_input");
    expect(payload.error?.message).toBe(
      "profileId must be a UUID or agt_<UUID>"
    );
    expect(payload.error?.requestId).toBe("req-test");
    expect(rpc.createSpace).not.toHaveBeenCalled();
  });

  it("forwards POST /v1/spaces to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "smoke-gw", visibility: "private" }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      spaceId: "from-core-space-id",
    });
    expect(rpc.createSpace).toHaveBeenCalledWith({
      name: "smoke-gw",
      visibility: "private",
      context: EXPECTED_CORE_CONTEXT,
    });
    expect(response.headers.get("x-openmeld-request-id")).toBeTruthy();
  });

  it.each([
    {
      route: "/v1/organizations/current/directory",
      method: "getCurrentOrganizationDirectory" as const,
    },
    {
      route: "/v1/organizations/current/agent-runtime-overview",
      method: "getCurrentOrganizationAgentRuntimeOverview" as const,
    },
    {
      route: "/v1/organizations/current/center-agent/directory",
      method: "centerAgentGetOrganizationDirectory" as const,
    },
  ])("preserves legacy readiness and opt-in public reasons on $route", async ({
    route,
    method,
  }) => {
    const { env, rpc } = makeEnv();
    const generatedAt = "2026-10-27T00:00:00.000Z";
    const agentProfiles = [
      {
        profileId: VALID_CONTROLLER_AGENT_PROFILE_ID,
        publicWakeabilityReason: { code: "computer_offline" as const },
      },
      {
        profileId: VALID_VISITED_AGENT_PROFILE_ID,
        publicWakeabilityReason: null,
      },
    ].map(({ profileId, publicWakeabilityReason }) => {
      const member = buildOfflineAgentMemberSnapshot({
        profileId,
        profileName: "Agent",
        agentControllerRef: "builtin:codex",
        ownerName: "Mira",
      });
      return {
        organizationId: "org-1",
        profileId,
        profileName: member.profileName,
        profileHandle: profileId,
        profileKind: "agent" as const,
        isDefault: false as const,
        status: "active" as const,
        ownerUserId: member.ownerUserId,
        source: "cli_create",
        managedRole: null,
        createdByUserId: member.ownerUserId,
        creatorProfileId: null,
        lastUsedAt: null,
        createdAt: generatedAt,
        updatedAt: generatedAt,
        readiness: getAgentExecutionReadinessResponseSchema.parse({
          agentProfileId: profileId,
          agentControllerRef: member.agentControllerRef,
          agentExecutionReadiness:
            member.ownerWakeDiagnostics.agentExecutionReadiness,
          agentWakeAvailability: member.agentWakeAvailability,
          agentWakeRouteRegistration:
            member.ownerWakeDiagnostics.agentWakeRouteRegistration,
          generatedAt,
          ownerUserId: member.ownerUserId,
          primaryActionPlan: {
            action: "check_status",
            target: { kind: "status" },
          },
          profileName: member.profileName,
          publicWakeabilityReason,
          routeDeviceId: null,
          routeLane: null,
          runtimeDeviceDisplayName: null,
          wakeRouteEvidence: member.ownerWakeDiagnostics.wakeRouteEvidence,
          wakeRouteStatus: member.ownerWakeDiagnostics.wakeRouteStatus,
        }),
      };
    });
    const runtimeOverview =
      method === "getCurrentOrganizationAgentRuntimeOverview";
    const responseSchema = runtimeOverview
      ? organizationAgentRuntimeOverviewResponseSchema
      : organizationDirectoryResponseSchema;
    const canonical = responseSchema.parse({
      organizationId: "org-1",
      generatedAt,
      ...(runtimeOverview ? {} : { members: [] }),
      agentProfiles: runtimeOverview
        ? agentProfiles.map(({ profileId, readiness }) => ({
            profileId,
            readiness,
          }))
        : agentProfiles,
    });
    rpc[method].mockResolvedValue(canonical);
    // Desktop 0.1.38 predates this strict response field.
    const legacyReadinessSchema = getAgentExecutionReadinessResponseSchema.omit(
      {
        publicWakeabilityReason: true,
      }
    );
    const expectedReadiness = agentProfiles.map(({ readiness }) => readiness);

    for (const option of [undefined, "false", "unknown", "true"]) {
      const url = new URL(route, "http://local");
      if (option !== undefined) {
        url.searchParams.set("includePublicWakeabilityReason", option);
      }
      const response = await app.fetch(
        new Request(url),
        env,
        TEST_EXECUTION_CONTEXT
      );
      expect(response.status).toBe(200);
      const body = responseSchema.parse(await response.json());
      expect(body).toMatchObject({
        organizationId: "org-1",
        ...(runtimeOverview ? {} : { members: [] }),
      });
      expect(body.agentProfiles).toHaveLength(agentProfiles.length);
      const actualReadiness = body.agentProfiles.map(
        ({ readiness }) => readiness
      );
      if (option === "true") {
        expect(actualReadiness).toEqual(expectedReadiness);
      } else {
        expect(actualReadiness).toEqual(
          expectedReadiness.map(
            ({ publicWakeabilityReason, ...legacy }) => legacy
          )
        );
        for (const readiness of actualReadiness) {
          expect(legacyReadinessSchema.safeParse(readiness).success).toBe(true);
        }
      }
    }
    expect(rpc[method]).toHaveBeenCalledWith({
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("forwards the opt-in Center Agent directory scope to Core", async () => {
    const { env, rpc } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/directory?centerAgentOnly=true"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(200);
    expect(rpc.getCurrentOrganizationDirectory).toHaveBeenCalledWith({
      centerAgentOnly: true,
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("forwards the lightweight Profile Directory options without requesting runtime state", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/organizations/current/profile-directory?includeHumanProfileLastUsedAt=true&includeMemberLastActiveAt=true"
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      organizationId: "org-1",
      members: [],
      agentProfiles: [],
    });
    expect(rpc.getCurrentOrganizationProfileDirectory).toHaveBeenCalledWith({
      context: EXPECTED_CORE_CONTEXT,
      includeMemberLastActiveAt: true,
    });
    expect(
      rpc.getCurrentOrganizationAgentRuntimeOverview
    ).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true,
  ])("returns Profile Directory model configuration only with opt-in=%s", async (includeModelSelection) => {
    const { env, rpc } = makeEnv();
    const profile = {
      organizationId: "org-1",
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      profileName: "Agent",
      profileHandle: "agent",
      profileKind: "agent",
      isDefault: false,
      status: "active",
      ownerUserId: "user-1",
      source: "cli_create",
      managedRole: null,
      createdByUserId: "user-1",
      creatorProfileId: null,
      lastUsedAt: null,
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
      agentControllerRef: "builtin:codex",
      modelSelection: { modelId: "gpt-5.6-sol", reasoningLevel: "high" },
    };
    rpc.getCurrentOrganizationProfileDirectory.mockResolvedValue({
      organizationId: "org-1",
      generatedAt: profile.createdAt,
      members: [],
      agentProfiles: [profile],
    });
    const response = await app.fetch(
      new Request(
        `http://local/v1/organizations/current/profile-directory?includeModelSelection=${includeModelSelection}`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(200);
    const { modelSelection, ...legacyProfile } = profile;
    await expect(response.json()).resolves.toEqual({
      organizationId: "org-1",
      generatedAt: profile.createdAt,
      members: [],
      agentProfiles: [includeModelSelection ? profile : legacyProfile],
    });
    expect(rpc.getCurrentOrganizationProfileDirectory).toHaveBeenCalledWith({
      context: EXPECTED_CORE_CONTEXT,
      ...(includeModelSelection ? { includeModelSelection: true } : {}),
    });
    expect(
      rpc.getCurrentOrganizationAgentRuntimeOverview
    ).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true,
  ])("returns Agent avatar fields only with opt-in=%s", async (includeAgentAvatars) => {
    const { env, rpc } = makeEnv();
    const profile = {
      organizationId: "org-1",
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      profileName: "Agent",
      profileHandle: "agent",
      profileKind: "agent",
      isDefault: false,
      status: "active",
      ownerUserId: "user-1",
      source: "cli_create",
      managedRole: null,
      createdByUserId: "user-1",
      creatorProfileId: null,
      lastUsedAt: null,
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
      avatarStyle: "fluid",
      avatarModelId: "claude-opus-5-5",
      agentControllerRef: "builtin:codex",
    };
    rpc.getCurrentOrganizationProfileDirectory.mockResolvedValue({
      organizationId: "org-1",
      generatedAt: profile.createdAt,
      members: [],
      agentProfiles: [profile],
    });
    const response = await app.fetch(
      new Request(
        `http://local/v1/organizations/current/profile-directory?includeAgentAvatars=${includeAgentAvatars}`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(200);
    const { avatarStyle, avatarModelId, ...legacyProfile } = profile;
    const body = organizationProfileDirectoryResponseSchema.parse(
      await response.json()
    );
    expect(body).toMatchObject({
      agentProfiles: [
        includeAgentAvatars
          ? { ...legacyProfile, avatarStyle, avatarModelId }
          : legacyProfile,
      ],
    });
    if (!includeAgentAvatars) {
      expect(body).not.toHaveProperty("agentProfiles.0.avatarStyle");
      expect(body).not.toHaveProperty("agentProfiles.0.avatarModelId");
    }
  });

  it("forwards only dynamic Agent runtime options to the runtime overview", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/organizations/current/agent-runtime-overview?agentProfileWorkRecoveryVersion=2"
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      organizationId: "org-1",
      agentProfiles: [],
    });
    expect(rpc.getCurrentOrganizationAgentRuntimeOverview).toHaveBeenCalledWith(
      {
        agentProfileWorkRecoveryVersion: 2,
        context: EXPECTED_CORE_CONTEXT,
      }
    );
    expect(rpc.getCurrentOrganizationProfileDirectory).not.toHaveBeenCalled();
  });

  it("forwards explicit Web member activity to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/organizations/current/member-activity/web",
      { method: "POST" }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      lastActiveAt: "2026-08-28T03:00:00.000Z",
      organizationId: "org-1",
      userId: "owner-001",
    });
    expect(rpc.recordCurrentOrganizationWebActivity).toHaveBeenCalledWith({
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("forwards a foreground Space visit without browser-selected identity or time", async () => {
    const { env, rpc } = makeEnv();
    const response = await app.fetch(
      new Request(
        `http://local/v1/spaces/${"a".repeat(64)}/member-activity/web`,
        { method: "POST" }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(200);
    expect(rpc.recordCurrentOrganizationWebActivity).toHaveBeenCalledWith({
      context: EXPECTED_CORE_CONTEXT,
      spaceId: "a".repeat(64),
    });
  });

  it("only exposes requested Organization directory activity fields", async () => {
    const getCurrentOrganizationDirectory = vi.fn(async () => ({
      organizationId: "org-1",
      generatedAt: "2026-08-01T00:00:00.000Z",
      members: [
        {
          memberId: "member-1",
          organizationId: "org-1",
          userId: "user-1",
          role: "member",
          joinedAt: "2026-07-01T00:00:00.000Z",
          lastActiveAt: "2026-08-01T00:00:00.000Z",
          user: {
            id: "user-1",
            name: "Mira",
            email: "mira@example.com",
            image: null,
          },
          humanProfile: {
            lastUsedAt: "2026-07-31T23:59:00.000Z",
            profileId: VALID_HUMAN_PROFILE_ID,
            profileName: "Mira",
            profileHandle: "mira",
            status: "active" as const,
          },
        },
      ],
      agentProfiles: [],
    }));
    const { env } = makeEnv({
      coreOverrides: { getCurrentOrganizationDirectory },
    });

    const legacyResponse = await app.fetch(
      new Request("http://local/v1/organizations/current/directory"),
      env,
      TEST_EXECUTION_CONTEXT
    );
    const enrichedResponse = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/directory?agentProfileWorkRecoveryVersion=2&includeHumanProfileLastUsedAt=true&includeMemberLastActiveAt=true"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(legacyResponse.status).toBe(200);
    const legacyPayload = (await legacyResponse.json()) as {
      members: { humanProfile: Record<string, unknown> | null }[];
    };
    expect(legacyPayload).toMatchObject({
      members: [
        {
          humanProfile: {
            profileId: VALID_HUMAN_PROFILE_ID,
          },
        },
      ],
    });
    expect(legacyPayload.members[0]?.humanProfile).not.toHaveProperty(
      "lastUsedAt"
    );
    expect(legacyPayload.members[0]).not.toHaveProperty("lastActiveAt");
    await expect(enrichedResponse.json()).resolves.toMatchObject({
      members: [
        {
          lastActiveAt: "2026-08-01T00:00:00.000Z",
          humanProfile: {
            lastUsedAt: "2026-07-31T23:59:00.000Z",
            profileId: VALID_HUMAN_PROFILE_ID,
          },
        },
      ],
    });
    expect(getCurrentOrganizationDirectory).toHaveBeenNthCalledWith(1, {
      context: EXPECTED_CORE_CONTEXT,
    });
    expect(getCurrentOrganizationDirectory).toHaveBeenNthCalledWith(2, {
      agentProfileWorkRecoveryVersion: 2,
      context: EXPECTED_CORE_CONTEXT,
      includeMemberLastActiveAt: true,
    });
  });

  it("forwards current Organization member OpenMeld Service statuses to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/organizations/current/member-openmeld-service-statuses"
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      generatedAt: "2026-07-21T00:00:00.000Z",
      members: [{ state: "connected", userId: "user-1" }],
      organizationId: "org-1",
    });
    expect(
      rpc.getCurrentOrganizationMemberOpenMeldServiceStatuses
    ).toHaveBeenCalledWith({ context: EXPECTED_CORE_CONTEXT });
  });

  it("forwards GET /v1/organizations/current/spaces to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/organizations/current/spaces");

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      organizationId: "org-1",
      spaces: [
        {
          spaceId: "demo",
          organizationId: "org-1",
          visibility: "public",
          joined: false,
        },
      ],
    });
    expect(rpc.getCurrentOrganizationSpaceDirectory).toHaveBeenCalledWith({
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("forwards the versioned member-count Space directory to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/organizations/current/spaces-with-member-counts"
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      organizationId: "org-1",
      spaces: [{ activeMemberCount: 4, spaceId: "demo" }],
    });
    expect(
      rpc.getCurrentOrganizationSpaceDirectoryWithMemberCounts
    ).toHaveBeenCalledWith({ context: EXPECTED_CORE_CONTEXT });
  });

  it("forwards an owner GET /v1/organizations/current/center-agent-memory/organization-policy to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/organizations/current/center-agent-memory/organization-policy"
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      organizationId: "org-1",
      organizationMemoryOptIn: false,
      provider: "zep_cloud",
      updatedByUserId: null,
    });
    expect(rpc.readCenterAgentOrganizationMemoryPolicy).toHaveBeenCalledWith({
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("forwards an owner PUT /v1/organizations/current/center-agent-memory/organization-policy to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/organizations/current/center-agent-memory/organization-policy",
      {
        body: JSON.stringify({ organizationMemoryOptIn: true }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      organizationId: "org-1",
      organizationMemoryOptIn: true,
      provider: "zep_cloud",
      updatedByUserId: "owner-001",
    });
    expect(rpc.setCenterAgentOrganizationMemoryPolicy).toHaveBeenCalledWith({
      context: EXPECTED_CORE_CONTEXT,
      organizationMemoryOptIn: true,
    });
  });

  it("preserves the Core authorization error for member organization-memory policy writes", async () => {
    const setCenterAgentOrganizationMemoryPolicy = vi.fn(() =>
      Promise.reject(
        createCoreRpcHttpError({
          code: "organization.role_required",
          reason:
            "Only an Organization owner or admin can manage the Center Agent.",
          status: 403,
        })
      )
    );
    const { env } = makeEnv({
      coreOverrides: { setCenterAgentOrganizationMemoryPolicy },
    });
    const request = new Request(
      "http://local/v1/organizations/current/center-agent-memory/organization-policy",
      {
        body: JSON.stringify({ organizationMemoryOptIn: true }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "organization.role_required",
        message:
          "Only an Organization owner or admin can manage the Center Agent.",
      },
    });
    expect(setCenterAgentOrganizationMemoryPolicy).toHaveBeenCalledWith({
      context: EXPECTED_CORE_CONTEXT,
      organizationMemoryOptIn: true,
    });
  });

  it("forwards an admin GET /v1/organizations/current/information-protection to Core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/organizations/current/information-protection"
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      organizationId: "org-1",
      protectedInformation:
        "Unreleased Board forecasts and acquisition planning materials.",
      updatedAt: "2026-07-21T00:00:00.000Z",
      updatedByUserId: "owner-001",
    });
    expect(
      rpc.readOrganizationInformationProtectionPolicy
    ).toHaveBeenCalledWith({ context: EXPECTED_CORE_CONTEXT });
  });

  it("forwards an admin PUT /v1/organizations/current/information-protection to Core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/organizations/current/information-protection",
      {
        body: JSON.stringify({
          protectedInformation:
            "Unreleased Board forecasts and acquisition planning materials.",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      organizationId: "org-1",
      protectedInformation:
        "Unreleased Board forecasts and acquisition planning materials.",
      updatedAt: "2026-07-21T00:01:00.000Z",
      updatedByUserId: "owner-001",
    });
    expect(rpc.setOrganizationInformationProtectionPolicy).toHaveBeenCalledWith(
      {
        context: EXPECTED_CORE_CONTEXT,
        protectedInformation:
          "Unreleased Board forecasts and acquisition planning materials.",
      }
    );
  });

  it("preserves the Core authorization error for member information-protection reads", async () => {
    const readOrganizationInformationProtectionPolicy = vi.fn(() =>
      Promise.reject(
        createCoreRpcHttpError({
          code: "organization.role_required",
          reason:
            "Only an Organization owner or admin can manage information protection.",
          status: 403,
        })
      )
    );
    const { env } = makeEnv({
      coreOverrides: { readOrganizationInformationProtectionPolicy },
    });
    const request = new Request(
      "http://local/v1/organizations/current/information-protection"
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "organization.role_required",
        message:
          "Only an Organization owner or admin can manage information protection.",
      },
    });
    expect(readOrganizationInformationProtectionPolicy).toHaveBeenCalledWith({
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("forwards GET /v1/organizations/current/feedback-reporting-policy to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/organizations/current/feedback-reporting-policy"
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      organizationId: "org-1",
      reportingEnabled: true,
      updatedByUserId: null,
    });
    expect(
      rpc.readCurrentOrganizationFeedbackReportingPolicy
    ).toHaveBeenCalledWith({ context: EXPECTED_CORE_CONTEXT });
  });

  it("forwards PUT /v1/organizations/current/feedback-reporting-policy to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/organizations/current/feedback-reporting-policy",
      {
        body: JSON.stringify({ reportingEnabled: false }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      organizationId: "org-1",
      reportingEnabled: false,
      updatedByUserId: "owner-001",
    });
    expect(
      rpc.setCurrentOrganizationFeedbackReportingPolicy
    ).toHaveBeenCalledWith({
      context: EXPECTED_CORE_CONTEXT,
      reportingEnabled: false,
    });
  });

  it("reads the updated feedback reporting policy after a PUT", async () => {
    let reportingEnabled = true;
    const readCurrentOrganizationFeedbackReportingPolicy = vi.fn(async () => ({
      organizationId: "org-1",
      reportingEnabled,
      updatedByUserId: reportingEnabled ? null : "owner-001",
    }));
    const setCurrentOrganizationFeedbackReportingPolicy = vi.fn(
      (input: { reportingEnabled: boolean }) => {
        reportingEnabled = input.reportingEnabled;
        return {
          organizationId: "org-1",
          reportingEnabled,
          updatedByUserId: "owner-001",
        };
      }
    );
    const { env } = makeEnv({
      coreOverrides: {
        readCurrentOrganizationFeedbackReportingPolicy,
        setCurrentOrganizationFeedbackReportingPolicy,
      },
    });

    const putResponse = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/feedback-reporting-policy",
        {
          body: JSON.stringify({ reportingEnabled: false }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    const getResponse = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/feedback-reporting-policy"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(putResponse.status).toBe(200);
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toEqual({
      organizationId: "org-1",
      reportingEnabled: false,
      updatedByUserId: "owner-001",
    });
  });

  it("returns 401 before reading a feedback reporting policy without authentication", async () => {
    const { env, rpc } = makeEnv({
      authOverrides: {
        resolveRequestAuth: vi.fn(async () => ({
          ok: true,
          claims: {
            authenticated: false,
            requestId: "req-feedback-policy-401",
            ownerIds: [],
            authMethod: "none",
          },
        })),
      },
    });
    const request = new Request(
      "http://local/v1/organizations/current/feedback-reporting-policy"
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "auth.unauthenticated" },
    });
    expect(
      rpc.readCurrentOrganizationFeedbackReportingPolicy
    ).not.toHaveBeenCalled();
  });

  it("preserves the Core membership rejection for feedback reporting policy reads", async () => {
    const readCurrentOrganizationFeedbackReportingPolicy = vi.fn(() =>
      Promise.reject(
        createCoreRpcHttpError({
          code: "organization.membership_required",
          reason: "Active Organization membership is required.",
          status: 403,
        })
      )
    );
    const { env } = makeEnv({
      coreOverrides: { readCurrentOrganizationFeedbackReportingPolicy },
    });
    const request = new Request(
      "http://local/v1/organizations/current/feedback-reporting-policy"
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "organization.membership_required" },
    });
    expect(readCurrentOrganizationFeedbackReportingPolicy).toHaveBeenCalledWith(
      { context: EXPECTED_CORE_CONTEXT }
    );
  });

  it("preserves the Core owner-or-admin rejection for feedback reporting policy writes", async () => {
    const setCurrentOrganizationFeedbackReportingPolicy = vi.fn(() =>
      Promise.reject(
        createCoreRpcHttpError({
          code: "organization.role_required",
          reason: "Only an Organization owner or admin may change this policy.",
          status: 403,
        })
      )
    );
    const { env } = makeEnv({
      coreOverrides: { setCurrentOrganizationFeedbackReportingPolicy },
    });
    const request = new Request(
      "http://local/v1/organizations/current/feedback-reporting-policy",
      {
        body: JSON.stringify({ reportingEnabled: false }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "organization.role_required" },
    });
    expect(setCurrentOrganizationFeedbackReportingPolicy).toHaveBeenCalledWith({
      context: EXPECTED_CORE_CONTEXT,
      reportingEnabled: false,
    });
  });

  it("forwards POST /v1/organizations/current/center-agent-memory/wipe-self to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/organizations/current/center-agent-memory/wipe-self",
      { method: "POST" }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      organizationId: "org-1",
      provider: "zep_cloud",
      status: "deleted",
      userId: "owner-001",
    });
    expect(rpc.wipeCurrentMemberCenterAgentMemory).toHaveBeenCalledWith({
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("rejects empty POST /v1/spaces before forwarding to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces", {
      method: "POST",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("invalid_json");
    expect(payload.error?.message).toBe("Invalid JSON");
    expect(rpc.createSpace).not.toHaveBeenCalled();
  });

  it("forwards GET /v1/spaces/:spaceId/members to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces/demo/members");

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      spaceId: "demo",
      summary: {
        totalCount: 1,
        humanCount: 1,
        agentCount: 0,
      },
    });
    expect(rpc.getSpaceMembers).toHaveBeenCalledWith({
      spaceId: "demo",
      spaceAccess: expect.objectContaining({
        actor: expect.objectContaining({
          kind: "authenticated",
          requestContext: EXPECTED_CORE_CONTEXT,
        }),
        proof: expect.objectContaining({ kind: "none" }),
      }),
    });
  });

  it("forwards GET /v1/spaces/:spaceId/member-directory to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/spaces/demo/member-directory",
      {
        headers: {
          [OPENMELD_HEADER_SPACE_ADDRESSING_VERSION]:
            OPENMELD_SPACE_ADDRESSING_VERSION,
        },
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      spaceId: "demo",
      members: [
        {
          profileId: "11111111-1111-4111-8111-111111111111",
          allowedRelations: {
            wake: false,
            reference: false,
            mention: true,
          },
        },
      ],
    });
    expect(rpc.getSpaceMemberDirectory).toHaveBeenCalledWith(
      {
        spaceId: "demo",
        spaceAccess: expect.objectContaining({
          actor: expect.objectContaining({
            kind: "authenticated",
            requestContext: EXPECTED_CORE_CONTEXT,
          }),
          proof: expect.objectContaining({ kind: "none" }),
        }),
      },
      OPENMELD_SPACE_ADDRESSING_VERSION,
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    );
    expect(rpc.getSpaceMembers).not.toHaveBeenCalled();
  });

  it("forwards GET /v1/spaces/:spaceId/bootstrap to one core RPC", async () => {
    const { env, rpc, writeDataPoint } = makeEnv();
    const request = new Request(
      "http://local/v1/spaces/demo/bootstrap?recent=1&limit=30&signalType=signal.text&signalType=signal.status&includeAgentStreamPresence=true"
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    expect(response.headers.get("server-timing")).toBe(
      'openmeld_bootstrap_total;dur=42;desc="OpenMeld space bootstrap total"'
    );
    await expect(response.json()).resolves.toMatchObject({
      status: {
        spaceId: "demo",
      },
      members: {
        spaceId: "demo",
      },
      history: {
        signals: [],
        nextCursor: null,
      },
      threads: {
        threads: [],
        previews: [],
      },
    });
    expect(rpc.getSpaceBootstrapWithTiming).toHaveBeenCalledWith(
      {
        spaceId: "demo",
        recent: true,
        limit: 30,
        includeAgentStreamPresence: true,
        signalTypes: ["signal.text", "signal.status"],
        spaceAccess: expect.objectContaining({
          actor: expect.objectContaining({
            kind: "authenticated",
            requestContext: EXPECTED_CORE_CONTEXT,
          }),
          proof: expect.objectContaining({ kind: "none" }),
        }),
      },
      OPENMELD_SPACE_ADDRESSING_VERSION,
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    );
    expect(rpc.getSpaceBootstrap).not.toHaveBeenCalled();
    expect(rpc.getSpaceStatus).not.toHaveBeenCalled();
    expect(rpc.getSpaceMembers).not.toHaveBeenCalled();
    expect(rpc.listSignals).not.toHaveBeenCalled();
    expect(rpc.listSpaceThreads).not.toHaveBeenCalled();
    const bootstrapTimingPoint = writeDataPoint.mock.calls
      .map((call) => call[0] as { blobs?: string[]; doubles?: number[] })
      .find(
        (point) =>
          point.blobs?.[0] === "gateway.openmeld.space.bootstrap_server_timing"
      );
    expect(bootstrapTimingPoint?.blobs?.[4]).toBe("openmeld_bootstrap_total");
    expect(bootstrapTimingPoint?.doubles?.[1]).toBe(42);
  });

  it.each([
    false,
    true,
  ])("only exposes model recovery to an opted-in bootstrap reader: %s", async (supported) => {
    const { env, rpc } = makeEnv();
    const original = await rpc.getSpaceBootstrapWithTiming();
    const recovery = {
      type: "recovery",
      state: "waiting",
      attempt: 2,
      maxAttempts: 5,
      nextRetryAtMs: 7000,
    } as const;
    rpc.getSpaceBootstrapWithTiming.mockResolvedValue({
      ...original,
      payload: {
        ...original.payload,
        activeAgentStreamPresences: [
          {
            v: 1,
            spaceId: "demo",
            streamId: "stream:sub_1",
            sequence: 2,
            profileId: "agt_11111111-1111-4111-8111-111111111111",
            triggerMessageId: "signal_1",
            dispatchId: "dispatch_1",
            state: "streaming",
            gapDetected: false,
            createdAtMs: 1000,
            updatedAtMs: 2000,
            expiresAtMs: 60_000,
            recovery,
          },
        ],
      },
    });
    const response = await app.fetch(
      new Request(
        `http://local/v1/spaces/demo/bootstrap?includeAgentStreamPresence=true${supported ? "&includeAgentStreamRecovery=true" : ""}`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      activeAgentStreamPresences: { recovery?: unknown }[];
    };
    expect(body.activeAgentStreamPresences[0]?.recovery).toEqual(
      supported ? recovery : undefined
    );
  });

  it("forwards GET /v1/spaces/:spaceId/dispatches/:dispatchId/trace to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/spaces/demo/dispatches/dispatch-1/trace",
      {
        headers: {
          "x-openmeld-space-password": "pass-01",
        },
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      query: {
        spaceId: "demo",
        dispatchId: "dispatch-1",
      },
      trace: {
        dispatch: {
          status: "dispatching",
        },
      },
    });
    expect(rpc.getSpaceDispatchTrace).toHaveBeenCalledWith({
      spaceId: "demo",
      dispatchId: "dispatch-1",
      password: "pass-01",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it.each([
    undefined,
    "true",
    "false",
  ])("forwards only the supported Message Details thread opt-in %s", async (value) => {
    const { env, rpc } = makeEnv();
    rpc.getSpaceMessageDetails.mockRejectedValue(
      createCoreRpcHttpError({
        code: "space.access_denied",
        reason: "Access denied",
        status: 403,
      })
    );
    const response = await app.fetch(
      new Request(
        `http://local/v1/spaces/demo/message-details?signalId=message-1${value === undefined ? "" : `&includeThreadContext=${value}`}`,
        { headers: { "x-openmeld-space-password": "pass-01" } }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    if (value === "false") {
      expect(response.status).toBe(400);
      expect(rpc.getSpaceMessageDetails).not.toHaveBeenCalled();
      return;
    }
    expect(response.status).toBe(403);
    expect(rpc.getSpaceMessageDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: "demo",
        signalId: "message-1",
        password: "pass-01",
        includeThreadContext: value === "true" ? true : undefined,
        context: EXPECTED_CORE_CONTEXT,
      })
    );
  });

  it("asks Core to resolve exact Remote Agent runtime diagnostics for detailed traces", async () => {
    const { env, rpc } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/spaces/demo/dispatches/dispatch-1/trace?includeRemoteAgentRuntimeDiagnostics=true",
        { headers: { "x-openmeld-space-dispatch-trace-response-version": "4" } }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(rpc.getSpaceDispatchTrace).toHaveBeenCalledWith({
      spaceId: "demo",
      dispatchId: "dispatch-1",
      includeRemoteAgentRuntimeDiagnostics: true,
      responseContractVersion: 4,
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it.each([
    "2",
    "3",
    "4",
    "5",
    "6",
    String(SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION),
  ])("negotiates dispatch trace response version %s without changing the public route", async (version) => {
    const { env, rpc } = makeEnv();
    const response = await app.fetch(
      new Request("http://local/v1/spaces/demo/dispatches/dispatch-1/trace", {
        headers: {
          "x-openmeld-space-dispatch-trace-response-version": version,
        },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(rpc.getSpaceDispatchTrace).toHaveBeenCalledWith({
      context: EXPECTED_CORE_CONTEXT,
      dispatchId: "dispatch-1",
      responseContractVersion: Number(version),
      spaceId: "demo",
    });
  });

  it.each([
    undefined,
    "2",
    "3",
  ])("explains how older detailed-trace clients can continue (version %s)", async (version) => {
    const { env, rpc } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/spaces/demo/dispatches/dispatch-1/trace?includeRemoteAgentRuntimeDiagnostics=true",
        {
          headers: version
            ? { "x-openmeld-space-dispatch-trace-response-version": version }
            : {},
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      "Update OpenMeld CLI, or run the trace without --details."
    );
    expect(rpc.getSpaceDispatchTrace).not.toHaveBeenCalled();
  });

  it("rejects unsupported dispatch trace response versions before Core RPC", async () => {
    const { env, rpc } = makeEnv();
    const response = await app.fetch(
      new Request("http://local/v1/spaces/demo/dispatches/dispatch-1/trace", {
        headers: {
          "x-openmeld-space-dispatch-trace-response-version": String(
            SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION + 1
          ),
        },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(rpc.getSpaceDispatchTrace).not.toHaveBeenCalled();
  });

  it("passes dispatch trace compatibility reason strings through from core RPC", async () => {
    const { env, rpc } = makeEnv({
      coreOverrides: {
        getSpaceDispatchTrace: vi.fn(async () => ({
          query: {
            spaceId: "demo",
            dispatchId: "dispatch-binding-1",
          },
          trace: {
            dispatch: {
              dispatchId: "dispatch-binding-1",
              status: "failed_terminal",
            },
            latestAttempt: {
              errorCode: "agent_profile_binding.lookup_failed",
              errorMessage:
                "controller.binding.lookup_failed mapped during compatibility window",
            },
            recentOpsDecisions: [
              {
                decisionCode: "agent_profile_binding.lookup_failed",
              },
            ],
          },
        })),
      },
    });
    const response = await app.fetch(
      new Request(
        "http://local/v1/spaces/demo/dispatches/dispatch-binding-1/trace"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      trace: {
        latestAttempt: {
          errorCode: "agent_profile_binding.lookup_failed",
        },
        recentOpsDecisions: [
          {
            decisionCode: "agent_profile_binding.lookup_failed",
          },
        ],
      },
    });
    expect(rpc.getSpaceDispatchTrace).toHaveBeenCalledWith({
      spaceId: "demo",
      dispatchId: "dispatch-binding-1",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("forwards GET /v1/spaces/:spaceId/dispatches/lookup to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/spaces/demo/dispatches/lookup?sourceSignalId=sig-source-1&targetProfileId=agt_56789012-5678-4678-8678-56789012abcd",
      {
        method: "GET",
        headers: {
          "x-openmeld-space-password": "pass-lookup",
        },
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      query: {
        spaceId: "demo",
        sourceSignalId: "sig-source-1",
        clientMessageId: null,
        targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
      },
      matches: [
        expect.objectContaining({
          dispatchId: "dispatch-1",
          targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
        }),
      ],
    });
    expect(rpc.getSpaceDispatchLookup).toHaveBeenCalledWith({
      spaceId: "demo",
      sourceSignalId: "sig-source-1",
      targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
      password: "pass-lookup",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("passes dispatch lookup compatibility reason strings through from core RPC", async () => {
    const { env, rpc } = makeEnv({
      coreOverrides: {
        getSpaceDispatchLookup: vi.fn(async () => ({
          query: {
            spaceId: "demo",
            sourceSignalId: "sig-binding-1",
            clientMessageId: null,
            targetProfileId: null,
          },
          matches: [
            {
              dispatchId: "dispatch-binding-1",
              sourceSignalId: "sig-binding-1",
              targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
              status: "failed_terminal",
              attemptCount: 1,
              latestAttemptId: "attempt-binding-1",
              latestAttemptStatus: "failed_terminal",
              latestAttemptErrorCode: "agent_profile_binding.disabled",
              latestAttemptErrorMessage:
                "controller.binding.disabled mapped during compatibility window",
            },
          ],
        })),
      },
    });

    const response = await app.fetch(
      new Request(
        "http://local/v1/spaces/demo/dispatches/lookup?sourceSignalId=sig-binding-1"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      matches: [
        {
          latestAttemptErrorCode: "agent_profile_binding.disabled",
          latestAttemptErrorMessage:
            "controller.binding.disabled mapped during compatibility window",
        },
      ],
    });
    expect(rpc.getSpaceDispatchLookup).toHaveBeenCalledWith({
      spaceId: "demo",
      sourceSignalId: "sig-binding-1",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("passes empty dispatch lookup matches without synthesizing canDispatch readiness", async () => {
    const { env, rpc } = makeEnv({
      coreOverrides: {
        getSpaceDispatchLookup: vi.fn(async () => ({
          query: {
            spaceId: "demo",
            sourceSignalId: "sig-reference-only",
            clientMessageId: null,
            targetProfileId: null,
          },
          matches: [],
        })),
      },
    });

    const response = await app.fetch(
      new Request(
        "http://local/v1/spaces/demo/dispatches/lookup?sourceSignalId=sig-reference-only"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toEqual({
      query: {
        spaceId: "demo",
        sourceSignalId: "sig-reference-only",
        clientMessageId: null,
        targetProfileId: null,
      },
      matches: [],
    });
    expect(payload).not.toHaveProperty("canDispatch");
    expect(rpc.getSpaceDispatchLookup).toHaveBeenCalledWith({
      spaceId: "demo",
      sourceSignalId: "sig-reference-only",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("passes dispatch lookup policy snapshot compatibility reasons through from core RPC", async () => {
    const { env, rpc } = makeEnv({
      coreOverrides: {
        getSpaceDispatchLookup: vi.fn(async () => ({
          query: {
            spaceId: "demo",
            sourceSignalId: "sig-stale-policy-1",
            clientMessageId: null,
            targetProfileId: null,
          },
          matches: [
            {
              dispatchId: "dispatch-stale-policy-1",
              sourceSignalId: "sig-stale-policy-1",
              targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
              status: "blocked",
              attemptCount: 0,
              latestAttemptId: null,
              latestAttemptStatus: null,
              latestAttemptErrorCode: "policy_version_mismatch",
              latestAttemptErrorMessage:
                "stale_policy: recorded dispatch policy evidence no longer matches current policy",
            },
          ],
        })),
      },
    });

    const response = await app.fetch(
      new Request(
        "http://local/v1/spaces/demo/dispatches/lookup?sourceSignalId=sig-stale-policy-1"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      matches: [
        {
          latestAttemptErrorCode: "policy_version_mismatch",
          latestAttemptErrorMessage:
            "stale_policy: recorded dispatch policy evidence no longer matches current policy",
        },
      ],
    });
    expect(payload).not.toHaveProperty("claimResult");
    expect(payload).not.toHaveProperty("lease");
    expect(rpc.getSpaceDispatchLookup).toHaveBeenCalledWith({
      spaceId: "demo",
      sourceSignalId: "sig-stale-policy-1",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("rejects invalid GET /v1/spaces/:spaceId/dispatches/lookup query before forwarding", async () => {
    const { env, rpc } = makeEnv();

    const response = await app.fetch(
      new Request(
        "http://local/v1/spaces/demo/dispatches/lookup?sourceSignalId="
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(rpc.getSpaceDispatchLookup).not.toHaveBeenCalled();
  });

  it("forwards client-message dispatch lookup to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/spaces/demo/dispatches/lookup?clientMessageId=client-message-1",
      { method: "GET" }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    expect(rpc.getSpaceDispatchLookup).toHaveBeenCalledWith({
      spaceId: "demo",
      clientMessageId: "client-message-1",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("forwards GET /v1/spaces/:spaceId/wake-progress to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/spaces/demo/wake-progress?clientMessageId=client-message-1&includeTiming=true&includePreviewText=true&includeSourceContext=true&includeWaitReason=true&includeWakeStopEligibility=true&targetProfileId=agt_56789012-5678-4678-8678-56789012abcd",
      {
        method: "GET",
        headers: {
          "x-openmeld-space-password": "pass-wake-progress",
        },
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      query: {
        spaceId: "demo",
        clientMessageId: "client-message-1",
        targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
      },
      items: [
        expect.objectContaining({
          phase: "running",
          targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
        }),
      ],
    });
    expect(rpc.getSpaceWakeProgress).toHaveBeenCalledWith({
      spaceId: "demo",
      clientMessageId: "client-message-1",
      includeTiming: true,
      includePreviewText: true,
      includeSourceContext: true,
      includeWaitReason: true,
      includeWakeStopEligibility: true,
      targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
      password: "pass-wake-progress",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("forwards GET /v1/spaces/:spaceId/active-wake-progress to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/spaces/demo/active-wake-progress?includePageInfo=true&includeTiming=true&includePreviewText=true&includeSourceContext=true&includeWaitReason=true&includeWakeStopEligibility=true&sourceProfileId=human-profile-1&targetProfileId=agt_56789012-5678-4678-8678-56789012abcd",
      {
        method: "GET",
        headers: {
          "x-openmeld-space-password": "pass-active-wake-progress",
        },
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      query: {
        spaceId: "demo",
        targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
      },
      items: [
        expect.objectContaining({
          phase: "running",
          targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
        }),
      ],
    });
    expect(rpc.getActiveSpaceWakeProgress).toHaveBeenCalledWith({
      spaceId: "demo",
      includePageInfo: true,
      includeTiming: true,
      includePreviewText: true,
      includeSourceContext: true,
      includeWaitReason: true,
      includeWakeStopEligibility: true,
      sourceProfileId: "human-profile-1",
      targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
      password: "pass-active-wake-progress",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("forwards POST /v1/spaces/:spaceId/wake-stop to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const requestBody = {
      reason: "user_requested",
      target: {
        by: "source_signal",
        sourceSignalId: "sig-source-1",
        targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
      },
    };
    const request = new Request("http://local/v1/spaces/demo/wake-stop", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-openmeld-space-password": "pass-wake-stop",
      },
      body: JSON.stringify(requestBody),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      status: "unsupported",
      reasonCode: "agent_controller_interface.stop_unsupported",
      runtimeCoordinatorExecutionId: null,
      targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
      cancellationState: {
        status: "unsupported",
        reasonCode: "agent_controller_interface.stop_unsupported",
        observedAtMs: 1_805_000_000_000,
      },
    });
    expect(rpc.postSpaceWakeStop).toHaveBeenCalledWith({
      spaceId: "demo",
      body: requestBody,
      password: "pass-wake-stop",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("rejects invalid POST /v1/spaces/:spaceId/wake-stop body before forwarding", async () => {
    const { env, rpc } = makeEnv();
    const response = await app.fetch(
      new Request("http://local/v1/spaces/demo/wake-stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dispatchId: "dispatch-1",
          target: {
            by: "source_signal",
            sourceSignalId: "sig-source-1",
            targetProfileId: "agt_56789012-5678-4678-8678-56789012abcd",
          },
        }),
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(rpc.postSpaceWakeStop).not.toHaveBeenCalled();
  });

  it("forwards a local agent interaction response with the authenticated context", async () => {
    const { env, rpc } = makeEnv();
    const requestBody = {
      interactionId: "interaction-1",
      response: {
        kind: "question",
        answers: [
          {
            questionId: "scope",
            values: ["workspace"],
          },
        ],
      },
      runtimeCoordinatorExecutionId: "rce-1",
    };
    const response = await app.fetch(
      new Request("http://local/v1/spaces/demo/agent-interactions/respond", {
        body: JSON.stringify(requestBody),
        headers: {
          "content-type": "application/json",
          "x-openmeld-space-password": "pass-interaction",
        },
        method: "POST",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      respondedAtMs: 1_805_000_000_000,
      status: "accepted",
    });
    expect(rpc.respondToSpaceAgentInteraction).toHaveBeenCalledWith({
      requestCredential: { kind: "cli_credential" },
      body: requestBody,
      context: EXPECTED_CORE_CONTEXT,
      password: "pass-interaction",
      spaceId: "demo",
    });
  });

  it("passes credential facts to a sensitive operation only, never in the request context", async () => {
    const taskCredential = {
      executionToken: `rcet_v1_${"a".repeat(64)}`,
      runId: "run-1",
      runtimeCoordinatorExecutionId: "rcx-1",
      tokenFingerprint: `etfp_v1_${"c".repeat(32)}`,
    };
    const { authRpc, env, rpc } = makeEnv({
      authOverrides: {
        resolveRequestAuth: vi.fn(async () => ({
          ok: true,
          claims: {
            authenticated: true,
            requestId: "req-test",
            profileId: "11111111-1111-4111-8111-111111111111",
            profileKind: "human",
            ownerIds: [],
            authMethod: "session",
            credentialKind: "interactive_session",
          },
        })),
        resolveRequestCredentialKind: vi.fn(async () => ({
          credentialKind: "interactive_session" as const,
        })),
      },
      coreOverrides: {
        respondToSpaceAgentInteraction: vi.fn(async () => ({
          ok: true,
          respondedAtMs: 1_805_000_000_000,
          status: "accepted",
        })),
      },
    });
    const send = (headers: Record<string, string>) =>
      app.fetch(
        new Request("http://local/v1/spaces/demo/agent-interactions/respond", {
          body: JSON.stringify({
            interactionId: "interaction-1",
            response: {
              kind: "question",
              answers: [{ questionId: "scope", values: ["workspace"] }],
            },
            runtimeCoordinatorExecutionId: "rce-1",
          }),
          headers: { "content-type": "application/json", ...headers },
          method: "POST",
        }),
        env,
        TEST_EXECUTION_CONTEXT
      );

    expect(
      (
        await send({
          "x-openmeld-credential-confirmation": "c".repeat(32),
          "x-openmeld-task-credential":
            encodeTaskCredentialHeader(taskCredential),
        })
      ).status
    ).toBe(200);
    const [forwarded] = vi.mocked(rpc.respondToSpaceAgentInteraction).mock
      .calls[0] as [Record<string, unknown>];
    expect(forwarded.requestCredential).toEqual({
      confirmationId: "c".repeat(32),
      kind: "interactive_session",
      taskCredential,
    });
    expect(JSON.stringify(forwarded.context)).not.toContain("rcet_v1_");

    // A cached session that a CLI has held since is re-read and demoted.
    vi.mocked(rpc.respondToSpaceAgentInteraction).mockClear();
    authRpc.resolveRequestCredentialKind?.mockResolvedValueOnce({
      credentialKind: "cli_credential",
    });
    expect((await send({})).status).toBe(200);
    const [demoted] = vi.mocked(rpc.respondToSpaceAgentInteraction).mock
      .calls[0] as [Record<string, unknown>];
    expect(demoted.requestCredential).toEqual({ kind: "cli_credential" });

    vi.mocked(rpc.respondToSpaceAgentInteraction).mockClear();
    const malformed = await send({ "x-openmeld-task-credential": "%%%" });
    expect(malformed.status).toBe(400);
    expect(rpc.respondToSpaceAgentInteraction).not.toHaveBeenCalled();
  });

  it("preserves active Wake progress store errors from core RPC", async () => {
    const { env, rpc } = makeEnv({
      coreOverrides: {
        getActiveSpaceWakeProgress: vi.fn(() => {
          throw createStructuredRpcHttpError({
            status: 503,
            code: "space.wake_progress.store_unavailable",
            message: "wake progress store is unavailable",
          });
        }),
      },
    });
    const request = new Request(
      "http://local/v1/spaces/demo/active-wake-progress",
      { method: "GET" }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "space.wake_progress.store_unavailable",
        message: "wake progress store is unavailable",
        requestId: "req-test",
      },
    });
    expect(rpc.getActiveSpaceWakeProgress).toHaveBeenCalledWith({
      spaceId: "demo",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("rejects invalid GET /v1/spaces/:spaceId/wake-progress query before forwarding", async () => {
    const { env, rpc } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/spaces/demo/wake-progress?clientMessageId="),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(rpc.getSpaceWakeProgress).not.toHaveBeenCalled();
  });

  it("forwards canonical builtin agentControllerRef in core RPC context for agent requests", async () => {
    const { env, rpc } = makeEnv({
      authOverrides: {
        resolveRequestAuth: vi.fn(async () => ({
          ok: true,
          claims: {
            authenticated: true,
            requestId: "req-test",
            profileId: "agt_12345678-1234-4234-8234-123456789abc",
            profileKind: "agent",
            ownerIds: ["owner-001"],
            authMethod: "session",
          },
        })),
        resolveProfile: vi.fn(async () => ({
          ok: true,
          resolvedProfile: {
            openMeldProfileId: "agt_12345678-1234-4234-8234-123456789abc",
            profileName: "Codex Agent",
            profileKind: "agent",
            ownerUserId: "owner-001",
            ownerName: "Mira",
            agentControllerRef: "builtin:codex",
          },
        })),
      },
    });

    const response = await app.fetch(
      new Request("http://local/v1/spaces/demo/meta", {
        headers: {
          authorization: "Bearer token",
        },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(rpc.getSpaceMeta).toHaveBeenCalledWith({
      spaceId: "demo",
      context: {
        actorContext: {
          requestId: "req-test",
          openMeldProfileId: VALID_CONTROLLER_AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Codex Agent",
          ownerUserId: "owner-001",
          ownerName: "Mira",
          agentControllerRef: "builtin:codex",
        },
      },
    });
  });

  it("preserves ingress flow metadata when building canonical core RPC context", async () => {
    const { env, rpc } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/spaces/demo/meta", {
        headers: {
          authorization: "Bearer token",
          "x-openmeld-agent-controller-conversation-id": "ctx-456",
          "x-openmeld-dispatch-chain-id": "chain-456",
          "x-openmeld-auto-relay-depth": "3",
          "x-openmeld-visited-profile-ids":
            "agt_12345678-1234-4234-8234-123456789abc, agt_23456789-2345-4234-8234-23456789abcd",
          "x-openmeld-visited-profile-ids-hash": "stable32:4567abcd",
          "x-openmeld-profile-id": "forged-profile",
          "x-openmeld-owner-user-id": "forged-owner",
        },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(rpc.getSpaceMeta).toHaveBeenCalledWith({
      spaceId: "demo",
      context: {
        actorContext: {
          ...EXPECTED_CORE_CONTEXT.actorContext,
          dispatchChainId: "chain-456",
          autoRelayDepth: 3,
          visitedProfileIds: [
            VALID_CONTROLLER_AGENT_PROFILE_ID,
            VALID_VISITED_AGENT_PROFILE_ID,
          ],
          visitedProfileIdsHash: "stable32:4567abcd",
        },
        agentControllerConversationId: "ctx-456",
      },
    });
  });

  it("proxies daemon route observation requests to core fetch", async () => {
    const upstreamFetch = vi.fn(async (_request: Request) =>
      Response.json({
        observedAt: "2026-04-14T00:00:00.000Z",
        profileId: VALID_TARGET_AGENT_PROFILE_ID,
        route: {
          online: true,
          daemonSessionId: "daemon-session-1",
          deviceId: "device-1",
          connectionGeneration: 7,
          leaseEpoch: 3,
          lastHeartbeatMs: 1234,
        },
      })
    );
    const { env } = makeEnv({
      coreOverrides: {
        fetch: upstreamFetch,
      },
    });

    const response = await app.fetch(
      new Request(
        `http://local/v1/daemon/routes/${encodeURIComponent(VALID_TARGET_AGENT_PROFILE_ID)}`,
        {
          headers: {
            authorization: "Bearer token",
          },
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const upstreamRequest = upstreamFetch.mock.calls[0]?.[0];
    if (!(upstreamRequest instanceof Request)) {
      throw new TypeError("Missing upstream request");
    }
    expect(new URL(upstreamRequest.url).pathname).toBe(
      `/v1/daemon/routes/${encodeURIComponent(VALID_TARGET_AGENT_PROFILE_ID)}`
    );
    expect(upstreamRequest.headers.get("x-openmeld-owner-user-id")).toBe(
      "owner-001"
    );
    expect(upstreamRequest.headers.get("x-openmeld-profile-id")).toBe(
      VALID_HUMAN_PROFILE_ID
    );
    await expect(response.json()).resolves.toMatchObject({
      profileId: VALID_TARGET_AGENT_PROFILE_ID,
      route: {
        online: true,
        daemonSessionId: "daemon-session-1",
      },
    });
  });

  it("forwards POST /v1/spaces/:spaceId/members to core RPC with resolved members", async () => {
    const { env, rpc, authRpc } = makeEnv({
      authOverrides: {
        resolveProfile: buildResolveProfileByIdMock([
          buildAuthProfileRpcItem({
            openMeldProfileId: VALID_HUMAN_PROFILE_ID,
            profileName: "Mira",
            profileKind: "human",
            ownerName: "Mira",
          }),
          buildAuthProfileRpcItem({
            openMeldProfileId: VALID_TARGET_AGENT_PROFILE_ID,
            profileName: "Ops Bot",
            profileKind: "agent",
            ownerName: "Mira",
          }),
        ]),
      },
    });
    const request = new Request("http://local/v1/spaces/demo/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberProfileIds: [VALID_TARGET_AGENT_PROFILE_ID],
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      addedMemberIds: [VALID_TARGET_AGENT_PROFILE_ID],
    });
    expect(authRpc.resolveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        openMeldProfileId: VALID_TARGET_AGENT_PROFILE_ID,
        requestId: "req-test",
      })
    );
    expect(rpc.addSpaceMembers).toHaveBeenCalledWith({
      requestCredential: { kind: "cli_credential" },
      spaceId: "demo",
      members: [
        {
          profileId: VALID_TARGET_AGENT_PROFILE_ID,
          profileName: "Ops Bot",
          profileKind: "agent",
          ownerUserId: "owner-001",
          ownerName: "Mira",
          agentControllerRef: null,
        },
      ],
      context: EXPECTED_CORE_CONTEXT_WITH_OWNER_NAME,
    });
  });

  it("forwards POST /v1/spaces/:spaceId/join to Core without resolving arbitrary members", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces/demo/join", {
      method: "POST",
      headers: { "x-openmeld-space-password": "space-secret" },
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      addedMemberIds: [VALID_HUMAN_PROFILE_ID],
      alreadyMemberIds: [],
    });
    expect(rpc.joinOrganizationPublicSpace).toHaveBeenCalledWith({
      spaceId: "demo",
      password: "space-secret",
      context: EXPECTED_CORE_CONTEXT,
    });
    expect(rpc.addSpaceMembers).not.toHaveBeenCalled();
  });

  it("forwards the displayed Center Agent identity to Core", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces/demo/center-agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedCenterAgentProfileId: VALID_TARGET_AGENT_PROFILE_ID,
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(200);
    expect(rpc.addCenterAgentToSpace).toHaveBeenCalledWith({
      context: EXPECTED_CORE_CONTEXT,
      expectedCenterAgentProfileId: VALID_TARGET_AGENT_PROFILE_ID,
      spaceId: "demo",
    });
  });

  it("forwards Organization Directory profile ids to Core without resolving owner-scoped profiles", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/spaces/demo/organization-directory-profiles",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directoryProfileIds: [
            VALID_HUMAN_PROFILE_ID,
            VALID_TARGET_AGENT_PROFILE_ID,
          ],
          expectedCenterAgentProfileId: VALID_TARGET_AGENT_PROFILE_ID,
        }),
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(200);
    expect(rpc.addOrganizationDirectoryProfilesToSpace).toHaveBeenCalledWith({
      context: EXPECTED_CORE_CONTEXT,
      directoryProfileIds: [
        VALID_HUMAN_PROFILE_ID,
        VALID_TARGET_AGENT_PROFILE_ID,
      ],
      expectedCenterAgentProfileId: VALID_TARGET_AGENT_PROFILE_ID,
      spaceId: "demo",
    });
    expect(rpc.addSpaceMembers).not.toHaveBeenCalled();
  });

  it("dedupes repeated member profile ids before forwarding POST /members", async () => {
    const { env, rpc } = makeEnv({
      authOverrides: {
        resolveProfile: buildResolveProfileByIdMock([
          buildAuthProfileRpcItem({
            openMeldProfileId: VALID_HUMAN_PROFILE_ID,
            profileName: "Mira",
            profileKind: "human",
            ownerName: "Mira",
          }),
          buildAuthProfileRpcItem({
            openMeldProfileId: VALID_TARGET_AGENT_PROFILE_ID,
            profileName: "Ops Bot",
            profileKind: "agent",
            ownerName: "Mira",
          }),
        ]),
      },
    });
    const request = new Request("http://local/v1/spaces/demo/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberProfileIds: [
          VALID_TARGET_AGENT_PROFILE_ID,
          VALID_TARGET_AGENT_PROFILE_ID,
        ],
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    expect(rpc.addSpaceMembers).toHaveBeenCalledWith({
      requestCredential: { kind: "cli_credential" },
      spaceId: "demo",
      members: [
        {
          profileId: VALID_TARGET_AGENT_PROFILE_ID,
          profileName: "Ops Bot",
          profileKind: "agent",
          ownerUserId: "owner-001",
          ownerName: "Mira",
          agentControllerRef: null,
        },
      ],
      context: EXPECTED_CORE_CONTEXT_WITH_OWNER_NAME,
    });
  });

  it("resolves POST /members by requested profile ids while preserving input order", async () => {
    const { env, rpc } = makeEnv({
      authOverrides: {
        resolveProfile: buildResolveProfileByIdMock([
          buildAuthProfileRpcItem({
            openMeldProfileId: VALID_HUMAN_PROFILE_ID,
            profileName: "Mira",
            profileKind: "human",
            ownerName: "Mira",
          }),
          buildAuthProfileRpcItem({
            openMeldProfileId: VALID_CONCURRENT_AGENT_PROFILE_ID_C,
            profileName: "Agent 9",
            profileKind: "agent",
            ownerName: "Mira",
          }),
          buildAuthProfileRpcItem({
            openMeldProfileId: VALID_CONCURRENT_AGENT_PROFILE_ID_A,
            profileName: "Agent 7",
            profileKind: "agent",
            ownerName: "Mira",
          }),
          buildAuthProfileRpcItem({
            openMeldProfileId: VALID_CONCURRENT_AGENT_PROFILE_ID_B,
            profileName: "Agent 8",
            profileKind: "agent",
            ownerName: "Mira",
          }),
        ]),
      },
      coreOverrides: {
        addSpaceMembers: vi.fn(async () => ({
          addedMemberIds: [
            VALID_CONCURRENT_AGENT_PROFILE_ID_A,
            VALID_CONCURRENT_AGENT_PROFILE_ID_B,
            VALID_CONCURRENT_AGENT_PROFILE_ID_C,
          ],
          alreadyMemberIds: [],
          items: [],
        })),
      },
    });
    const request = new Request("http://local/v1/spaces/demo/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberProfileIds: [
          VALID_CONCURRENT_AGENT_PROFILE_ID_A,
          VALID_CONCURRENT_AGENT_PROFILE_ID_B,
          VALID_CONCURRENT_AGENT_PROFILE_ID_C,
        ],
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    expect(rpc.addSpaceMembers).toHaveBeenCalledWith({
      requestCredential: { kind: "cli_credential" },
      spaceId: "demo",
      members: [
        {
          profileId: VALID_CONCURRENT_AGENT_PROFILE_ID_A,
          profileName: "Agent 7",
          profileKind: "agent",
          ownerUserId: "owner-001",
          ownerName: "Mira",
          agentControllerRef: null,
        },
        {
          profileId: VALID_CONCURRENT_AGENT_PROFILE_ID_B,
          profileName: "Agent 8",
          profileKind: "agent",
          ownerUserId: "owner-001",
          ownerName: "Mira",
          agentControllerRef: null,
        },
        {
          profileId: VALID_CONCURRENT_AGENT_PROFILE_ID_C,
          profileName: "Agent 9",
          profileKind: "agent",
          ownerUserId: "owner-001",
          ownerName: "Mira",
          agentControllerRef: null,
        },
      ],
      context: EXPECTED_CORE_CONTEXT_WITH_OWNER_NAME,
    });
  });

  it("does not treat a disabled member Profile as resolvable after Auth rejects it", async () => {
    const { env, rpc } = makeEnv({
      authOverrides: {
        resolveProfile: vi.fn((input?: { openMeldProfileId?: string }) => {
          if (
            !input?.openMeldProfileId ||
            input.openMeldProfileId === VALID_HUMAN_PROFILE_ID
          ) {
            return {
              ok: true,
              resolvedProfile: {
                openMeldProfileId: VALID_HUMAN_PROFILE_ID,
                profileName: "Mira",
                profileKind: "human",
                ownerUserId: "owner-001",
                ownerName: "Mira",
              },
            };
          }
          return {
            ok: false,
            code: "profile.not_found",
            message: "profile not found",
          };
        }),
      },
    });
    const request = new Request("http://local/v1/spaces/demo/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberProfileIds: [VALID_DISABLED_AGENT_PROFILE_ID],
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(404);
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    expect(payload.error?.code).toBe("profile.not_found");
    expect(payload.error?.message).toBe("profile not found");
    expect(rpc.addSpaceMembers).not.toHaveBeenCalled();
  });

  it("returns 400 when profile lookup returns structured failure before forwarding POST /members", async () => {
    const invalidMemberProfileId = VALID_AUTH_REJECTED_AGENT_PROFILE_ID;
    const { env, rpc } = makeEnv({
      authOverrides: {
        resolveProfile: vi.fn((input?: { openMeldProfileId?: string }) => {
          if (
            !input?.openMeldProfileId ||
            input.openMeldProfileId === VALID_HUMAN_PROFILE_ID
          ) {
            return {
              ok: true,
              resolvedProfile: {
                openMeldProfileId: VALID_HUMAN_PROFILE_ID,
                profileName: "Mira",
                profileKind: "human",
                ownerUserId: "owner-001",
                ownerName: "Mira",
              },
            };
          }
          return {
            ok: false,
            code: "profile.invalid_input",
            message: "profileId must be a UUID or agt_<UUID>",
          };
        }),
      },
    });
    const request = new Request("http://local/v1/spaces/demo/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberProfileIds: [invalidMemberProfileId],
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    expect(payload.error?.code).toBe("profile.invalid_input");
    expect(payload.error?.message).toBe(
      "profileId must be a UUID or agt_<UUID>"
    );
    expect(rpc.addSpaceMembers).not.toHaveBeenCalled();
  });

  it("maps legacy password_required errors while forwarding POST /members", async () => {
    const { env, rpc } = makeEnv({
      authOverrides: {
        listProfiles: vi.fn(async () =>
          buildListProfilesResult([
            buildAuthProfileRpcItem({
              openMeldProfileId: VALID_HUMAN_PROFILE_ID,
              profileName: "Mira",
              profileKind: "human",
            }),
          ])
        ),
      },
      coreOverrides: {
        addSpaceMembers: vi.fn(() => {
          throw new Error("HTTP 401: space password required");
        }),
      },
    });

    const request = new Request("http://local/v1/spaces/demo/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberProfileIds: [VALID_HUMAN_PROFILE_ID],
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(401);

    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.error?.code).toBe("space.password_required");
    expect(payload.error?.message).toBe("space password required");
    expect(payload.error?.requestId).toBeTruthy();
    expect(rpc.addSpaceMembers).toHaveBeenCalledTimes(1);
  });

  it("maps legacy password_invalid errors while forwarding POST /members", async () => {
    const { env, rpc } = makeEnv({
      authOverrides: {
        listProfiles: vi.fn(async () =>
          buildListProfilesResult([
            buildAuthProfileRpcItem({
              openMeldProfileId: VALID_HUMAN_PROFILE_ID,
              profileName: "Mira",
              profileKind: "human",
            }),
          ])
        ),
      },
      coreOverrides: {
        addSpaceMembers: vi.fn(() => {
          throw new Error("HTTP 403: space password invalid");
        }),
      },
    });

    const request = new Request("http://local/v1/spaces/demo/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberProfileIds: [VALID_HUMAN_PROFILE_ID],
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(403);

    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.error?.code).toBe("space.password_invalid");
    expect(payload.error?.message).toBe("space password invalid");
    expect(payload.error?.requestId).toBeTruthy();
    expect(rpc.addSpaceMembers).toHaveBeenCalledTimes(1);
  });

  it("returns 502 when member lookup throws before forwarding POST /members", async () => {
    const flakyMemberProfileId = VALID_FLAKY_AGENT_PROFILE_ID;
    const { env, rpc } = makeEnv({
      authOverrides: {
        resolveProfile: vi.fn((input?: { openMeldProfileId?: string }) => {
          if (
            !input?.openMeldProfileId ||
            input.openMeldProfileId === VALID_HUMAN_PROFILE_ID
          ) {
            return {
              ok: true,
              resolvedProfile: {
                openMeldProfileId: VALID_HUMAN_PROFILE_ID,
                profileName: "Mira",
                profileKind: "human",
                ownerUserId: "owner-001",
                ownerName: "Mira",
              },
            };
          }
          if (!flakyMemberProfileId) {
            throw new Error("member profile id is required");
          }
          throw new Error("auth upstream unavailable");
        }),
      },
    });
    const request = new Request("http://local/v1/spaces/demo/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberProfileIds: [flakyMemberProfileId],
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(502);
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    expect(payload.error?.code).toBe("upstream_unreachable");
    expect(payload.error?.message).toBe("auth upstream unavailable");
    expect(rpc.addSpaceMembers).not.toHaveBeenCalled();
  });

  it("fails POST /members with 404 when one requested member is missing from profile lookup", async () => {
    const { env, rpc } = makeEnv({
      authOverrides: {
        resolveProfile: buildResolveProfileByIdMock([
          buildAuthProfileRpcItem({
            openMeldProfileId: VALID_HUMAN_PROFILE_ID,
            profileName: "Mira",
            profileKind: "human",
            ownerName: "Mira",
          }),
          buildAuthProfileRpcItem({
            openMeldProfileId: VALID_CONCURRENT_AGENT_PROFILE_ID_A,
            profileName: "Agent A",
            profileKind: "agent",
          }),
        ]),
      },
    });
    const request = new Request("http://local/v1/spaces/demo/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberProfileIds: [
          VALID_CONCURRENT_AGENT_PROFILE_ID_A,
          VALID_CONCURRENT_AGENT_PROFILE_ID_B,
        ],
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "profile.not_found",
        message: `profile not found: ${VALID_CONCURRENT_AGENT_PROFILE_ID_B}`,
      },
    });
    expect(rpc.addSpaceMembers).not.toHaveBeenCalled();
  });

  it("forwards POST /members/remove to core RPC after deduping member profile ids", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces/demo/members/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberProfileIds: [
          VALID_TARGET_AGENT_PROFILE_ID,
          VALID_TARGET_AGENT_PROFILE_ID,
        ],
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      removedMemberIds: [VALID_TARGET_AGENT_PROFILE_ID],
      alreadyAbsentMemberIds: [],
    });
    expect(rpc.removeSpaceMembers).toHaveBeenCalledWith({
      spaceId: "demo",
      memberProfileIds: [VALID_TARGET_AGENT_PROFILE_ID],
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("rejects invalid POST /members/remove payloads before forwarding", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces/demo/members/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberProfileIds: [],
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(response.headers.get("x-openmeld-request-id")).toBe("req-test");
    expect(payload.error?.code).toBe("invalid_payload");
    expect(payload.error?.message).toContain(
      "expected array to have >=1 items"
    );
    expect(payload.error?.requestId).toBe("req-test");
    expect(rpc.removeSpaceMembers).not.toHaveBeenCalled();
  });

  it("preserves core structured errors while forwarding POST /members/remove", async () => {
    const { env, rpc } = makeEnv({
      coreOverrides: {
        removeSpaceMembers: vi.fn(() => {
          throw createStructuredRpcHttpError({
            status: 400,
            code: "space.members.creator_forbidden",
            message: "space creator cannot be removed from this space",
          });
        }),
      },
    });
    const request = new Request("http://local/v1/spaces/demo/members/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberProfileIds: [VALID_MEMBER_NOTICE_ACTOR_PROFILE_ID],
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    expect(payload.error?.code).toBe("space.members.creator_forbidden");
    expect(payload.error?.message).toBe(
      "space creator cannot be removed from this space"
    );
    expect(rpc.removeSpaceMembers).toHaveBeenCalledTimes(1);
  });

  it("forwards POST /leave to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces/demo/leave", {
      method: "POST",
      headers: {
        "x-openmeld-space-password": "pass-01",
      },
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      leftProfileId: VALID_HUMAN_PROFILE_ID,
      status: "left",
    });
    expect(rpc.leaveSpace).toHaveBeenCalledWith({
      spaceId: "demo",
      password: "pass-01",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("preserves core structured errors while forwarding POST /leave", async () => {
    const { env, rpc } = makeEnv({
      coreOverrides: {
        leaveSpace: vi.fn(() => {
          throw createStructuredRpcHttpError({
            status: 400,
            code: "space.leave_space.creator_forbidden",
            message:
              "The space creator cannot leave this space. Delete the space instead when only you remain.",
          });
        }),
      },
    });
    const request = new Request("http://local/v1/spaces/demo/leave", {
      method: "POST",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    expect(payload.error?.code).toBe("space.leave_space.creator_forbidden");
    expect(payload.error?.message).toBe(
      "The space creator cannot leave this space. Delete the space instead when only you remain."
    );
    expect(rpc.leaveSpace).toHaveBeenCalledTimes(1);
  });

  it("forwards DELETE /v1/spaces/:spaceId to core RPC and records a tombstone", async () => {
    const { env, rpc, authRpc } = makeEnv({
      coreOverrides: {
        getSpaceMeta: vi.fn(async () => ({
          spaceId: "demo",
          name: "ops-room",
          creator: {
            profileId: "11111111-1111-4111-8111-111111111111",
            profile: "11111111-1111-4111-8111-111111111111",
            kind: "human",
          },
        })),
      },
    });
    const request = new Request("http://localhost:8080/v1/spaces/demo", {
      method: "DELETE",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      spaceId: "demo",
      deleted: true,
    });
    expect(rpc.getSpaceMeta).toHaveBeenCalledWith({
      spaceId: "demo",
      context: EXPECTED_CORE_CONTEXT,
    });
    expect(rpc.deleteSpace).toHaveBeenCalledWith({
      requestCredential: { kind: "cli_credential" },
      spaceId: "demo",
      context: EXPECTED_CORE_CONTEXT,
    });
    expect(authRpc.upsertSpaceDeletionTombstone).toHaveBeenCalledWith({
      headers: expect.not.objectContaining({
        "x-openmeld-space-password": expect.anything(),
      }),
      requestId: "req-test",
      openMeldProfileId: "11111111-1111-4111-8111-111111111111",
      spaceId: "demo",
      gatewayHost: "localhost:8080",
      spaceName: "ops-room",
      creatorProfileId: "11111111-1111-4111-8111-111111111111",
      creatorKind: "human",
      deletedByProfileId: "11111111-1111-4111-8111-111111111111",
      deletedByProfileName: "Mira",
      deletedByOwnerUserId: "owner-001",
      deletedAt: expect.any(String),
    });
  });

  it("prefers forwarded host headers when recording a delete tombstone", async () => {
    const { env, authRpc } = makeEnv({
      coreOverrides: {
        getSpaceMeta: vi.fn(async () => ({
          spaceId: "demo",
          name: "ops-room",
          creator: {
            profileId: "11111111-1111-4111-8111-111111111111",
            profile: "11111111-1111-4111-8111-111111111111",
            kind: "human",
          },
        })),
      },
    });
    const request = new Request(
      "https://gateway.openmeld.invalid/v1/spaces/demo",
      {
        method: "DELETE",
        headers: {
          host: "localhost:8080",
        },
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    expect(authRpc.upsertSpaceDeletionTombstone).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayHost: "localhost:8080",
      })
    );
  });

  it("forwards x-openmeld-space-password on DELETE /v1/spaces/:spaceId", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces/demo", {
      method: "DELETE",
      headers: {
        "x-openmeld-space-password": "pass-for-delete",
      },
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    expect(rpc.getSpaceMeta).toHaveBeenCalledWith({
      spaceId: "demo",
      password: "pass-for-delete",
      context: EXPECTED_CORE_CONTEXT,
    });
    expect(rpc.deleteSpace).toHaveBeenCalledWith({
      requestCredential: { kind: "cli_credential" },
      spaceId: "demo",
      password: "pass-for-delete",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("does not fail DELETE /v1/spaces/:spaceId when tombstone sync fails", async () => {
    const { env } = makeEnv({
      coreOverrides: {
        getSpaceMeta: vi.fn(async () => ({
          spaceId: "demo",
          name: "ops-room",
          creator: {
            profileId: "11111111-1111-4111-8111-111111111111",
            profile: "11111111-1111-4111-8111-111111111111",
            kind: "human",
          },
        })),
      },
      authOverrides: {
        upsertSpaceDeletionTombstone: vi.fn(async () => ({
          ok: false,
          code: "upstream_unavailable",
          message: "auth unavailable",
        })),
      },
    });
    const request = new Request("http://localhost:8080/v1/spaces/demo", {
      method: "DELETE",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      spaceId: "demo",
      deleted: true,
    });
  });

  it("forwards PUT /v1/spaces/:spaceId/password to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces/demo/password", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        password: "pass-123",
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      spaceId: "demo",
      passwordProtected: true,
    });
    expect(rpc.upsertSpacePassword).toHaveBeenCalledWith({
      spaceId: "demo",
      password: "pass-123",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("returns invalid_password_payload for non-string PUT /v1/spaces/:spaceId/password body", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces/demo/password", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        password: 123,
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("invalid_password_payload");
    expect(payload.error?.message).toBe("Invalid password payload");
    expect(rpc.upsertSpacePassword).not.toHaveBeenCalled();
  });

  it("returns invalid_password_payload for missing password field on PUT /v1/spaces/:spaceId/password", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces/demo/password", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("invalid_password_payload");
    expect(payload.error?.message).toBe("Invalid password payload");
    expect(rpc.upsertSpacePassword).not.toHaveBeenCalled();
  });

  it("returns invalid_password_payload for unknown field on PUT /v1/spaces/:spaceId/password", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces/demo/password", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        password: "pass-123",
        unknown: true,
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("invalid_password_payload");
    expect(payload.error?.message).toBe("Invalid password payload");
    expect(rpc.upsertSpacePassword).not.toHaveBeenCalled();
  });

  it("forwards DELETE /v1/spaces/:spaceId/password to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces/demo/password", {
      method: "DELETE",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      spaceId: "demo",
      passwordProtected: false,
    });
    expect(rpc.clearSpacePassword).toHaveBeenCalledWith({
      spaceId: "demo",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("passes approved agent creator id for owner human deletion", async () => {
    const agentCreatorProfileId = "agt_67890123-6789-4789-8789-67890123abcd";
    const { env, rpc, authRpc } = makeEnv({
      coreOverrides: {
        getSpaceMeta: vi.fn(async () => ({
          spaceId: "demo",
          creator: {
            profileId: agentCreatorProfileId,
            profile: agentCreatorProfileId,
            kind: "agent",
          },
        })),
      },
      authOverrides: {
        resolveProfile: vi.fn((input?: { openMeldProfileId?: string }) => {
          if (input?.openMeldProfileId === agentCreatorProfileId) {
            return {
              ok: true,
              resolvedProfile: {
                openMeldProfileId: agentCreatorProfileId,
                profileName: "Owner Agent",
                profileKind: "agent",
                ownerUserId: "owner-001",
              },
            };
          }
          return {
            ok: true,
            resolvedProfile: {
              openMeldProfileId: "11111111-1111-4111-8111-111111111111",
              profileName: "Mira",
              profileKind: "human",
              ownerUserId: "owner-001",
            },
          };
        }),
      },
    });
    const request = new Request("http://local/v1/spaces/demo", {
      method: "DELETE",
      headers: {
        "x-openmeld-space-password": "secret-for-space-only",
      },
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    expect(rpc.deleteSpace).toHaveBeenCalledWith({
      requestCredential: { kind: "cli_credential" },
      spaceId: "demo",
      approvedAgentCreatorProfileId: agentCreatorProfileId,
      password: "secret-for-space-only",
      context: EXPECTED_CORE_CONTEXT,
    });
    expect(rpc.getSpaceMeta).toHaveBeenCalledWith({
      spaceId: "demo",
      password: "secret-for-space-only",
      context: EXPECTED_CORE_CONTEXT,
    });
    expect(authRpc.resolveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        openMeldProfileId: agentCreatorProfileId,
        headers: expect.not.objectContaining({
          "x-openmeld-space-password": expect.anything(),
        }),
      })
    );
  });

  it("does not pass approval for non-owner human deleting agent-created space", async () => {
    const agentCreatorProfileId = "agt_78901234-7890-4890-8890-78901234abcd";
    const { env, rpc } = makeEnv({
      coreOverrides: {
        getSpaceMeta: vi.fn(async () => ({
          spaceId: "demo",
          creator: {
            profileId: agentCreatorProfileId,
            profile: agentCreatorProfileId,
            kind: "agent",
          },
        })),
        deleteSpace: vi.fn(
          (input?: { approvedAgentCreatorProfileId?: string }) => {
            if (!input?.approvedAgentCreatorProfileId) {
              const error = new Error(
                "agent-created spaces require owner human confirmation"
              ) as Error & { status?: number };
              error.status = 403;
              throw error;
            }
            return { spaceId: "demo", deleted: true as const };
          }
        ),
      },
      authOverrides: {
        resolveProfile: vi.fn((input?: { openMeldProfileId?: string }) => {
          if (input?.openMeldProfileId === agentCreatorProfileId) {
            return {
              ok: true,
              resolvedProfile: {
                openMeldProfileId: agentCreatorProfileId,
                profileName: "Other Owner Agent",
                profileKind: "agent",
                ownerUserId: "owner-999",
              },
            };
          }
          return {
            ok: true,
            resolvedProfile: {
              openMeldProfileId: "11111111-1111-4111-8111-111111111111",
              profileName: "Mira",
              profileKind: "human",
              ownerUserId: "owner-001",
            },
          };
        }),
      },
    });
    const request = new Request("http://local/v1/spaces/demo", {
      method: "DELETE",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(403);
    expect(rpc.deleteSpace).toHaveBeenCalledWith({
      requestCredential: { kind: "cli_credential" },
      spaceId: "demo",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("returns upstream error when creator-owner lookup is temporarily unavailable", async () => {
    const agentCreatorProfileId = "agt_89012345-8901-4901-8901-89012345abcd";
    const { env, rpc } = makeEnv({
      coreOverrides: {
        getSpaceMeta: vi.fn(async () => ({
          spaceId: "demo",
          creator: {
            profileId: agentCreatorProfileId,
            profile: agentCreatorProfileId,
            kind: "agent",
          },
        })),
      },
      authOverrides: {
        resolveProfile: vi.fn((input?: { openMeldProfileId?: string }) => {
          if (input?.openMeldProfileId === agentCreatorProfileId) {
            throw new Error("auth upstream unavailable");
          }
          return {
            ok: true,
            resolvedProfile: {
              openMeldProfileId: "11111111-1111-4111-8111-111111111111",
              profileName: "Mira",
              profileKind: "human",
              ownerUserId: "owner-001",
            },
          };
        }),
      },
    });
    const request = new Request("http://local/v1/spaces/demo", {
      method: "DELETE",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "upstream_unreachable",
        message: "auth upstream unavailable",
      },
    });
    expect(rpc.deleteSpace).not.toHaveBeenCalled();
  });

  it("returns upstream error when creator-owner lookup reports structured failure", async () => {
    const agentCreatorProfileId = "agt_90123456-9012-4012-8012-90123456abcd";
    const { env, rpc } = makeEnv({
      coreOverrides: {
        getSpaceMeta: vi.fn(async () => ({
          spaceId: "demo",
          creator: {
            profileId: agentCreatorProfileId,
            profile: agentCreatorProfileId,
            kind: "agent",
          },
        })),
      },
      authOverrides: {
        resolveProfile: vi.fn((input?: { openMeldProfileId?: string }) => {
          if (input?.openMeldProfileId === agentCreatorProfileId) {
            return {
              ok: false,
              code: "auth.upstream_unreachable",
              message: "auth upstream unavailable",
            };
          }
          return {
            ok: true,
            resolvedProfile: {
              openMeldProfileId: "11111111-1111-4111-8111-111111111111",
              profileName: "Mira",
              profileKind: "human",
              ownerUserId: "owner-001",
            },
          };
        }),
      },
    });
    const request = new Request("http://local/v1/spaces/demo", {
      method: "DELETE",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "upstream_unreachable",
        message: "auth upstream unavailable",
      },
    });
    expect(rpc.deleteSpace).not.toHaveBeenCalled();
  });

  it("rejects POST /v1/spaces when payload contains forged creator", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-openmeld-profile-id": "11111111-1111-4111-8111-111111111111",
        "x-openmeld-profile-name": "Mira",
        "x-openmeld-profile": "mira--abcd1234",
      },
      body: JSON.stringify({
        name: "smoke-gw",
        guide: "Be concise",
        creator: {
          kind: "agent",
          profileId: "forged-id",
          profileName: "forged-name",
          profile: "forged-profile",
        },
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("invalid_payload");
    expect(payload.error?.message).toBe(
      'Invalid create payload: unknown field "creator"'
    );
    expect(rpc.createSpace).not.toHaveBeenCalled();
  });

  it("forwards POST /v1/spaces password as canonical string", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "smoke-gw",
        visibility: "private",
        password: "  trim this pass  ",
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    expect(rpc.createSpace).toHaveBeenCalledWith({
      name: "smoke-gw",
      visibility: "private",
      password: "trim this pass",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("returns 400 for malformed JSON on POST /v1/spaces", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("invalid_json");
    expect(payload.error?.message).toBe("Invalid JSON");
    expect(rpc.createSpace).not.toHaveBeenCalled();
  });

  it("returns 400 for array JSON on POST /v1/spaces", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "[]",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("invalid_json");
    expect(payload.error?.message).toBe("Invalid JSON");
    expect(rpc.createSpace).not.toHaveBeenCalled();
  });

  it("returns 400 for null JSON on POST /v1/spaces", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("invalid_json");
    expect(payload.error?.message).toBe("Invalid JSON");
    expect(rpc.createSpace).not.toHaveBeenCalled();
  });

  it("returns 400 for primitive JSON on POST /v1/spaces", async () => {
    const invalidBodies = ["true", "1", '"raw-string"'] as const;

    for (const body of invalidBodies) {
      const { env, rpc } = makeEnv();
      const request = new Request("http://local/v1/spaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });

      const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
      expect(response.status).toBe(400);
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: { code?: string; message?: string };
      };
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe("invalid_json");
      expect(payload.error?.message).toBe("Invalid JSON");
      expect(rpc.createSpace).not.toHaveBeenCalled();
    }
  });

  it("forwards GET /signals to core RPC", async () => {
    const { env, rpc, authRpc } = makeEnv({
      coreOverrides: {
        listSignals: vi.fn(async () => ({
          signals: [
            {
              type: "signal.text",
              data: {
                text: "ok",
                files: [
                  {
                    fileId: "file-1",
                    revision: 1,
                    name: "diagram.png",
                    mimeType: "image/png",
                    sizeBytes: 1024,
                    imageDimensions: { width: 800, height: 600 },
                  },
                ],
              },
            },
          ],
          nextCursor: null,
        })),
      },
    });

    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "GET",
      headers: {
        "x-openmeld-request-id": "req-123",
        "x-openmeld-profile-id": "11111111-1111-4111-8111-111111111111",
      },
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      signals: [
        {
          type: "signal.text",
          data: {
            text: "ok",
            files: [
              {
                fileId: "file-1",
                revision: 1,
                name: "diagram.png",
                mimeType: "image/png",
                sizeBytes: 1024,
              },
            ],
          },
        },
      ],
      nextCursor: null,
    });

    const capableResponse = await app.fetch(
      new Request("http://local/v1/spaces/demo/signals", {
        headers: {
          [OPENMELD_HEADER_SPACE_IMAGE_GEOMETRY_VERSION]:
            OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION,
        },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );
    await expect(capableResponse.json()).resolves.toMatchObject({
      signals: [
        {
          data: {
            files: [{ imageDimensions: { width: 800, height: 600 } }],
          },
        },
      ],
    });
    expect(rpc.listSignals).toHaveBeenCalledWith(
      {
        spaceId: "demo",
        spaceAccess: expectedAuthenticatedSpaceAccess("demo"),
      },
      OPENMELD_SPACE_ADDRESSING_VERSION,
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    );
    expect(authRpc.resolveRequestAuth).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "req-123" })
    );
    expect(response.headers.get("x-openmeld-request-id")).toBe("req-test");
  });

  it("forwards x-openmeld-space-password on GET /signals", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "GET",
      headers: {
        "x-openmeld-space-password": "pass-01",
      },
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    expect(rpc.listSignals).toHaveBeenCalledWith(
      {
        spaceId: "demo",
        spaceAccess: expectedAuthenticatedSpaceAccess("demo", "pass-01"),
      },
      OPENMELD_SPACE_ADDRESSING_VERSION,
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    );
  });

  it("retries GET /signals once for transient upstream errors", async () => {
    const { env, rpc } = makeEnv({
      coreOverrides: {
        listSignals: vi
          .fn()
          .mockRejectedValueOnce(new Error("failed to call service: core"))
          .mockResolvedValueOnce({
            signals: [{ type: "signal.text", data: { text: "retry-ok" } }],
            nextCursor: null,
          }),
      },
    });

    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "GET",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      signals: [{ type: "signal.text", data: { text: "retry-ok" } }],
      nextCursor: null,
    });
    expect(rpc.listSignals).toHaveBeenCalledTimes(2);
  });

  it("forwards signals query params to core RPC", async () => {
    const { env, rpc } = makeEnv({
      coreOverrides: {
        listSignals: vi.fn(async () => ({
          signals: [{ type: "signal.text", data: { text: "page-1" } }],
          nextCursor: "cursor-2",
        })),
      },
    });

    const request = new Request(
      "http://local/v1/spaces/demo/signals?afterTs=123&limit=2&cursor=cursor-1&recent=1",
      {
        method: "GET",
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      signals: [{ type: "signal.text", data: { text: "page-1" } }],
      nextCursor: "cursor-2",
    });
    expect(rpc.listSignals).toHaveBeenCalledWith(
      {
        spaceId: "demo",
        afterTs: 123,
        limit: 2,
        cursor: "cursor-1",
        recent: true,
        spaceAccess: expectedAuthenticatedSpaceAccess("demo"),
      },
      OPENMELD_SPACE_ADDRESSING_VERSION,
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    );
  });

  it("rejects invalid afterTs query values with 400 and does not call core", async () => {
    const invalidQueries = [
      "afterTs=abc",
      "afterTs=-1",
      "afterTs=123abc",
      "afterTs=1.5",
      "afterTs=8640000000000001",
    ];
    const auditSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    for (const query of invalidQueries) {
      const { env, rpc } = makeEnv();
      const request = new Request(
        `http://local/v1/spaces/demo/signals?${query}`,
        {
          method: "GET",
        }
      );

      const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
      expect(response.status).toBe(400);

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: { code?: string; message?: string };
      };
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe("bad_request");
      expect(payload.error?.message).toBe("Invalid afterTs");
      expect(rpc.listSignals).not.toHaveBeenCalled();
    }

    expect(auditSpy).toHaveBeenCalledTimes(invalidQueries.length);
    for (const call of auditSpy.mock.calls) {
      const auditEvent = parseAuditLogEntry(call[0]);
      expect(auditEvent.event).toBe("http.forward");
      expect(auditEvent.route).toBe("/v1/spaces/:spaceId/signals");
      expect(auditEvent.method).toBe("GET");
      expect(auditEvent.status).toBe(400);
      expect(String(auditEvent.reason ?? "")).toContain(
        "invalid_query_param afterTs="
      );
    }
  });

  it("rejects invalid limit query values with 400 and does not call core", async () => {
    const invalidQueries = [
      "limit=abc",
      "limit=-1",
      "limit=123abc",
      "limit=1.5",
    ];
    const auditSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    for (const query of invalidQueries) {
      const { env, rpc } = makeEnv();
      const request = new Request(
        `http://local/v1/spaces/demo/signals?${query}`,
        {
          method: "GET",
        }
      );

      const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
      expect(response.status).toBe(400);

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: { code?: string; message?: string };
      };
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe("bad_request");
      expect(payload.error?.message).toBe("Invalid limit");
      expect(rpc.listSignals).not.toHaveBeenCalled();
    }

    expect(auditSpy).toHaveBeenCalledTimes(invalidQueries.length);
    for (const call of auditSpy.mock.calls) {
      const auditEvent = parseAuditLogEntry(call[0]);
      expect(auditEvent.event).toBe("http.forward");
      expect(auditEvent.route).toBe("/v1/spaces/:spaceId/signals");
      expect(auditEvent.method).toBe("GET");
      expect(auditEvent.status).toBe(400);
      expect(String(auditEvent.reason ?? "")).toContain(
        "invalid_query_param limit="
      );
    }
  });

  it("returns upstream_error for legacy HTTP error strings", async () => {
    const { env } = makeEnv({
      coreOverrides: {
        listSignals: vi.fn(() => {
          throw new Error("HTTP 400: Invalid profileIdentity");
        }),
      },
    });

    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "GET",
    });
    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("upstream_error");
    expect(payload.error?.message).toBe("Invalid profileIdentity");
    expect(payload.error?.requestId).toBeTruthy();
  });

  it("maps deterministic legacy 404 space errors to gateway error codes", async () => {
    const cases = [
      {
        legacyMessage: "HTTP 404: invalid space id: expected 64-char hex id",
        gatewayCode: "invalid_space_id",
        gatewayMessage: "invalid space id: expected 64-char hex id",
      },
      {
        legacyMessage: "HTTP 404: space not found",
        gatewayCode: "space.not_found",
        gatewayMessage: "space not found",
      },
    ] as const;

    for (const testCase of cases) {
      const { env } = makeEnv({
        coreOverrides: {
          listSignals: vi.fn(() => {
            throw new Error(testCase.legacyMessage);
          }),
        },
      });

      const request = new Request("http://local/v1/spaces/demo/signals", {
        method: "GET",
      });
      const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
      expect(response.status).toBe(404);

      const payload = (await response.json()) as {
        ok: boolean;
        error?: { code?: string; message?: string; requestId?: string };
      };
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe(testCase.gatewayCode);
      expect(payload.error?.message).toBe(testCase.gatewayMessage);
      expect(payload.error?.requestId).toBeTruthy();
    }
  });

  it("maps legacy password HTTP error strings to gateway password error codes", async () => {
    const cases = [
      {
        legacyMessage: "HTTP 401: space password required",
        gatewayCode: "space.password_required",
        gatewayMessage: "space password required",
        status: 401,
      },
      {
        legacyMessage: "HTTP 403: space password invalid",
        gatewayCode: "space.password_invalid",
        gatewayMessage: "space password invalid",
        status: 403,
      },
    ] as const;

    for (const testCase of cases) {
      const { env } = makeEnv({
        coreOverrides: {
          listSignals: vi.fn(() => {
            throw new Error(testCase.legacyMessage);
          }),
        },
      });

      const request = new Request("http://local/v1/spaces/demo/signals", {
        method: "GET",
      });
      const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
      expect(response.status).toBe(testCase.status);

      const payload = (await response.json()) as {
        ok: boolean;
        error?: { code?: string; message?: string; requestId?: string };
      };
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe(testCase.gatewayCode);
      expect(payload.error?.message).toBe(testCase.gatewayMessage);
      expect(payload.error?.requestId).toBeTruthy();
    }
  });

  it("preserves error code for JSON-packed legacy HTTP error strings", async () => {
    const { env } = makeEnv({
      coreOverrides: {
        listSignals: vi.fn(() => {
          throw new Error(
            'HTTP 404: {"ok":false,"error":{"code":"invalid_space_id","message":"Invalid space id"}}'
          );
        }),
      },
    });

    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "GET",
    });
    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(404);

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("invalid_space_id");
    expect(payload.error?.message).toBe("Invalid space id");
    expect(payload.error?.requestId).toBeTruthy();
  });

  it("returns upstream_error from structured RPC errors", async () => {
    const { env } = makeEnv({
      coreOverrides: {
        listSignals: vi.fn(() => {
          const error = new Error("Invalid afterTs") as Error & {
            status?: unknown;
          };
          error.status = 422;
          throw error;
        }),
      },
    });

    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "GET",
    });
    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(422);

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("upstream_error");
    expect(payload.error?.message).toBe("Invalid afterTs");
    expect(payload.error?.requestId).toBeTruthy();
  });

  it("maps invalid_create_payload from structured RPC errors to invalid_payload", async () => {
    const { env } = makeEnv({
      coreOverrides: {
        listSignals: vi.fn(() => {
          const error = new Error("Invalid create payload") as Error & {
            status?: number;
            code?: string;
          };
          error.status = 400;
          error.code = "invalid_create_payload";
          throw error;
        }),
      },
    });

    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "GET",
    });
    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("invalid_payload");
    expect(payload.error?.message).toBe("Invalid create payload");
    expect(payload.error?.requestId).toBeTruthy();
  });

  it("maps structured RPC error codes to gateway error codes", async () => {
    const mappingCases = [
      {
        coreCode: "bad_request",
        gatewayCode: "bad_request",
        status: 400,
      },
      {
        coreCode: "invalid_json",
        gatewayCode: "invalid_json",
        status: 400,
      },
      {
        coreCode: "invalid_payload",
        gatewayCode: "invalid_payload",
        status: 400,
      },
      {
        coreCode: "invalid_space_id",
        gatewayCode: "invalid_space_id",
        status: 404,
      },
      {
        coreCode: "profile.not_found",
        gatewayCode: "profile.not_found",
        status: 404,
      },
      {
        coreCode: "profile_not_found",
        gatewayCode: "profile.not_found",
        status: 404,
      },
      {
        coreCode: "profile.invalid_input",
        gatewayCode: "profile.invalid_input",
        status: 400,
      },
      {
        coreCode: "profile_invalid_input",
        gatewayCode: "profile.invalid_input",
        status: 400,
      },
      {
        coreCode: "space.not_found",
        gatewayCode: "space.not_found",
        status: 404,
      },
      {
        coreCode: "space.addressing.target_invalid",
        gatewayCode: "space.addressing.target_invalid",
        status: 422,
      },
      {
        coreCode: "space.wake.handoff_seed_failed",
        gatewayCode: "space.wake.handoff_seed_failed",
        status: 422,
      },
      {
        coreCode: "space.wake.target_invalid",
        gatewayCode: "space.wake.target_invalid",
        status: 422,
      },
      {
        coreCode: "space.password_invalid",
        gatewayCode: "space.password_invalid",
        status: 401,
      },
      {
        coreCode: "space.password_too_short",
        gatewayCode: "space.password_too_short",
        status: 400,
      },
      {
        coreCode: "space.publication_mode.owner_required",
        gatewayCode: "space.publication_mode.owner_required",
        status: 403,
      },
      {
        coreCode: "space.publication_mode.password_not_configured",
        gatewayCode: "space.publication_mode.password_not_configured",
        status: 409,
      },
    ] as const;

    for (const testCase of mappingCases) {
      const { env } = makeEnv({
        coreOverrides: {
          listSignals: vi.fn(() => {
            const error = new Error(`mapped ${testCase.coreCode}`) as Error & {
              status?: number;
              code?: string;
            };
            error.status = testCase.status;
            error.code = testCase.coreCode;
            throw error;
          }),
        },
      });

      const request = new Request("http://local/v1/spaces/demo/signals", {
        method: "GET",
      });
      const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
      expect(response.status).toBe(testCase.status);

      const payload = (await response.json()) as {
        ok: boolean;
        error?: { code?: string; message?: string; requestId?: string };
      };
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe(testCase.gatewayCode);
      expect(payload.error?.message).toBe(`mapped ${testCase.coreCode}`);
      expect(payload.error?.requestId).toBeTruthy();
    }
  });

  it("passes through whitelisted password error codes from structured RPC errors", async () => {
    const { env } = makeEnv({
      coreOverrides: {
        listSignals: vi.fn(() => {
          const error = new Error("password required") as Error & {
            status?: number;
            code?: string;
          };
          error.status = 401;
          error.code = "space.password_required";
          throw error;
        }),
      },
    });

    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "GET",
    });
    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(401);

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("space.password_required");
    expect(payload.error?.message).toBe("password required");
    expect(payload.error?.requestId).toBeTruthy();
  });

  it("passes through invalid_password_payload from structured RPC errors", async () => {
    const { env } = makeEnv({
      coreOverrides: {
        listSignals: vi.fn(() => {
          const error = new Error("Invalid password payload") as Error & {
            status?: number;
            code?: string;
          };
          error.status = 400;
          error.code = "invalid_password_payload";
          throw error;
        }),
      },
    });

    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "GET",
    });
    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("invalid_password_payload");
    expect(payload.error?.message).toBe("Invalid password payload");
    expect(payload.error?.requestId).toBeTruthy();
  });

  it("extracts structured RPC errors from Error.cause", async () => {
    const { env } = makeEnv({
      coreOverrides: {
        listSignals: vi.fn(() => {
          const error = new Error("HTTP 404: fallback message") as Error & {
            cause?: unknown;
          };
          error.cause = {
            status: 404,
            message: "Invalid space id",
          };
          throw error;
        }),
      },
    });

    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "GET",
    });
    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(404);

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("upstream_error");
    expect(payload.error?.message).toBe("Invalid space id");
    expect(payload.error?.requestId).toBeTruthy();
  });

  it("falls back to 502 when RPC HTTP error string contains non-error status", async () => {
    const { env } = makeEnv({
      coreOverrides: {
        listSignals: vi.fn(() => {
          throw new Error(
            "HTTP 200: invalid JSON response (Unexpected token '{')"
          );
        }),
      },
    });

    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "GET",
    });
    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(502);

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("upstream_unreachable");
    expect(payload.error?.message).toContain("HTTP 200: invalid JSON response");
    expect(payload.error?.requestId).toBeTruthy();
  });

  it("forwards POST /signals using the shared normal message body contract", async () => {
    const { env, rpc } = makeEnv();
    const body = {
      text: "hello",
      files: [
        {
          fileId: "file-1",
          revision: 1,
          name: "diagram.png",
          mimeType: "image/png",
          sizeBytes: 1024,
          imageDimensions: { width: 800, height: 600 },
        },
      ],
    };
    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    expect(rpc.postSignal).toHaveBeenCalledWith(
      {
        spaceId: "demo",
        profile: {
          kind: "human",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Mira",
        },
        text: "hello",
        files: [
          {
            fileId: "file-1",
            revision: 1,
            name: "diagram.png",
            mimeType: "image/png",
            sizeBytes: 1024,
          },
        ],
        authoringPolicy: "user_authored",
        context: EXPECTED_CORE_CONTEXT,
      },
      undefined,
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    );
    expect(body.files[0]?.imageDimensions).toEqual({ width: 800, height: 600 });
  });

  it("forwards POST /signals attachment references to Core", async () => {
    const { env, rpc } = makeEnv();
    const attachments = [
      {
        id: "attachment-1",
        mimeType: "image/png",
        sizeBytes: 1024,
        width: 800,
        height: 600,
        fileName: "diagram.png",
      },
    ];
    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Here is the diagram.",
        attachments,
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(200);
    expect(rpc.postSignal).toHaveBeenCalledWith(
      {
        spaceId: "demo",
        profile: {
          kind: "human",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Mira",
        },
        text: "Here is the diagram.",
        attachments,
        authoringPolicy: "user_authored",
        context: EXPECTED_CORE_CONTEXT,
      },
      undefined,
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    );
  });

  it("preserves invalid attachment reference errors from Core", async () => {
    const coreError = new Error(
      'HTTP 422: {"ok":false,"error":{"code":"attachment_reference_invalid","message":"One or more attachment references are invalid for this Space."}}'
    );
    const { env } = makeEnv({
      coreOverrides: {
        postSignal: vi.fn(() => Promise.reject(coreError)),
      },
    });
    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Here is the diagram.",
        attachments: [
          {
            id: "missing-attachment",
            mimeType: "image/png",
            sizeBytes: 1024,
          },
        ],
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };

    expect(response.status).toBe(422);
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatchObject({
      code: "attachment_reference_invalid",
      message: "One or more attachment references are invalid for this Space.",
    });
  });

  it("rejects user-authored Wake POST /signals without calling Core RPC when clientMessageId is missing", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "@Demo Agent(wake) hello",
        messageEnvelope: {
          text: "@Demo Agent(wake) hello",
          activationTargets: [VALID_TARGET_AGENT_PROFILE_ID],
          referenceTargets: [],
        },
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe(
      SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_ERROR_CODE
    );
    expect(payload.error?.message).toBe(
      "Wake requests from user-authored signal posts require clientMessageId."
    );
    expect(rpc.postSignal).not.toHaveBeenCalled();
  });

  it("forwards user-authored Wake POST /signals when clientMessageId is present", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "@Demo Agent(wake) hello",
        messageEnvelope: {
          text: "@Demo Agent(wake) hello",
          activationTargets: [VALID_TARGET_AGENT_PROFILE_ID],
          referenceTargets: [],
        },
        meta: {
          clientMessageId: "client-message-1",
        },
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(200);
    expect(rpc.postSignal).toHaveBeenCalledWith(
      {
        spaceId: "demo",
        profile: {
          kind: "human",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Mira",
        },
        text: "@Demo Agent(wake) hello",
        authoringPolicy: "user_authored",
        messageEnvelope: {
          text: "@Demo Agent(wake) hello",
          activationTargets: [VALID_TARGET_AGENT_PROFILE_ID],
          referenceTargets: [],
        },
        meta: {
          clientMessageId: "client-message-1",
        },
        context: EXPECTED_CORE_CONTEXT,
      },
      undefined,
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    );
  });

  it("forwards POST /signals meta to core RPC", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Mira added Demo Bot to this space.",
        meta: {
          purpose: "space_membership_join_notice",
          targetProfileId: VALID_MEMBER_NOTICE_TARGET_PROFILE_ID,
          targetProfileKind: "agent",
          targetProfileName: "Demo Bot",
          addedByProfileId: VALID_MEMBER_NOTICE_ACTOR_PROFILE_ID,
          addedByDisplayName: "Mira",
        },
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    expect(rpc.postSignal).toHaveBeenCalledWith(
      {
        spaceId: "demo",
        profile: {
          kind: "human",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Mira",
        },
        text: "Mira added Demo Bot to this space.",
        authoringPolicy: "user_authored",
        meta: {
          purpose: "space_membership_join_notice",
          targetProfileId: VALID_MEMBER_NOTICE_TARGET_PROFILE_ID,
          targetProfileKind: "agent",
          targetProfileName: "Demo Bot",
          addedByProfileId: VALID_MEMBER_NOTICE_ACTOR_PROFILE_ID,
          addedByDisplayName: "Mira",
        },
        context: EXPECTED_CORE_CONTEXT,
      },
      undefined,
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    );
  });

  it("preserves legacy addressing for old clients", async () => {
    const { env, rpc } = makeEnv({
      coreOverrides: {
        postSignal: vi.fn(async () => ({
          v: 1,
          id: "evt-1",
          spaceId: "demo",
          ts: 1,
          profile: {
            kind: "human",
            profileId: "11111111-1111-4111-8111-111111111111",
            profileName: "Mira",
          },
          type: "signal.text",
          data: {
            text: "hello",
            messageEnvelope: {
              text: "hello",
              activationTargets: [],
              referenceTargets: ["agt_9a7252af-d284-4c4a-bf1c-ceeb96656b71"],
            },
          },
        })),
      },
    });
    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "hello",
        messageEnvelope: {
          text: "hello",
          activationTargets: [],
          referenceTargets: ["agt_9a7252af-d284-4c4a-bf1c-ceeb96656b71"],
        },
        replyTo: {
          signalId: "sig-current-reply",
          profileId: "agt_9a7252af-d284-4c4a-bf1c-ceeb96656b71",
          profileKind: "agent",
          profileName: "Phase 2a Agent",
          previewText: "Previous reply",
        },
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data?: {
        messageEnvelope?: {
          ccTargets?: string[];
        };
      };
    };
    expect(payload.data?.messageEnvelope?.ccTargets).toEqual([]);
    expect(rpc.postSignal).toHaveBeenCalledWith(
      {
        spaceId: "demo",
        profile: {
          kind: "human",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Mira",
        },
        text: "hello",
        authoringPolicy: "user_authored",
        messageEnvelope: {
          text: "hello",
          activationTargets: [],
          referenceTargets: ["agt_9a7252af-d284-4c4a-bf1c-ceeb96656b71"],
        },
        replyTo: {
          signalId: "sig-current-reply",
          profileId: "agt_9a7252af-d284-4c4a-bf1c-ceeb96656b71",
          profileKind: "agent",
          profileName: "Phase 2a Agent",
          previewText: "Previous reply",
        },
        context: EXPECTED_CORE_CONTEXT,
      },
      undefined,
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    );
  });

  it("preserves Human Mention fields for current clients", async () => {
    const humanMentionTargetId = "22222222-2222-4222-8222-222222222222";
    const { env, rpc } = makeEnv({
      coreOverrides: {
        postSignal: vi.fn(async () => ({
          v: 1,
          id: "evt-current-addressing",
          spaceId: "demo",
          ts: 1,
          profile: {
            kind: "human",
            profileId: VALID_HUMAN_PROFILE_ID,
            profileName: "Mira",
          },
          type: "signal.text",
          data: {
            text: "@Felix please review",
            messageEnvelope: {
              text: "@Felix please review",
              activationTargets: [],
              referenceTargets: [],
              mentionTargets: [humanMentionTargetId],
            },
          },
        })),
      },
    });
    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [OPENMELD_HEADER_SPACE_ADDRESSING_VERSION]:
          OPENMELD_SPACE_ADDRESSING_VERSION,
      },
      body: JSON.stringify({
        text: "@Felix please review",
        messageEnvelope: {
          text: "@Felix please review",
          activationTargets: [],
          referenceTargets: [],
          mentionTargets: [humanMentionTargetId],
        },
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          mentionTargets: [humanMentionTargetId],
        },
      },
    });
    expect(rpc.postSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        messageEnvelope: expect.objectContaining({
          mentionTargets: [humanMentionTargetId],
        }),
      }),
      OPENMELD_SPACE_ADDRESSING_VERSION,
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    );
  });

  it("does not emit signal_posted runtime evidence before success payload validation", async () => {
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const { env, rpc } = makeEnv({
      coreOverrides: {
        postSignal: vi.fn(async () => ({ ok: true })),
      },
    });
    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "hello",
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(502);
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("upstream_error");
    expect(rpc.postSignal).toHaveBeenCalledTimes(1);
    expect(
      infoSpy.mock.calls.some(([entry]) =>
        isRuntimeEvidenceEvent(entry, "gateway.openmeld.space.signal_posted")
      )
    ).toBe(false);
    expect(
      infoSpy.mock.calls.some(
        ([entry]) =>
          isRuntimeEvidenceEvent(
            entry,
            "gateway.openmeld.space.signal_post_failed"
          ) && entry.reasonCode === "invalid_success_payload"
      )
    ).toBe(true);
  });

  it("emits Diagnostic Report runtime evidence from the validated report pointers", async () => {
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/spaces/demo/diagnostic-reports",
      {
        method: "POST",
        headers: {
          "cf-ray": "cf-ray-123",
          "content-type": "application/json",
          traceparent:
            "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
        },
        body: JSON.stringify({
          reportedSignalId: "sig-reported-1",
          problemType: "reply_problem",
        }),
      }
    );

    try {
      const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

      expect(response.status).toBe(201);
      expect(rpc.createSpaceDiagnosticReport).toHaveBeenCalledWith({
        spaceId: "demo",
        body: {
          reportedSignalId: "sig-reported-1",
          problemType: "reply_problem",
        },
        context: EXPECTED_CORE_CONTEXT,
      });
      const createdEvidence = infoSpy.mock.calls
        .map(([entry]) => entry)
        .find((entry) =>
          isRuntimeEvidenceEvent(
            entry,
            "gateway.openmeld.space.diagnostic_report_created"
          )
        );
      expect(createdEvidence).toEqual(
        expect.objectContaining({
          event: "gateway.openmeld.space.diagnostic_report_created",
          workerName: "openmeld-gateway",
          runtimeKind: "rpc",
          status: "succeeded",
          operation: "createDiagnosticReport",
          route: "/v1/spaces/:spaceId/diagnostic-reports",
          method: "POST",
          statusCode: 201,
          reasonCode: "exact",
          cfRayId: "cf-ray-123",
          requestId: "req-test",
          traceId: "0123456789abcdef0123456789abcdef",
          spaceId: "demo",
          clientMessageId: "client-message-1",
          sourceSignalId: "sig-source-1",
          targetProfileId: VALID_TARGET_AGENT_PROFILE_ID,
          replySignalId: "sig-reported-1",
          activationTargetCount: 1,
        })
      );
      expect(createdEvidence).not.toHaveProperty("resultRef");
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("does not retry POST /signals when upstream transient error occurs", async () => {
    const { env, rpc } = makeEnv({
      coreOverrides: {
        postSignal: vi
          .fn()
          .mockRejectedValueOnce(new Error("failed to call service: core")),
      },
    });

    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "hello",
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(502);
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("upstream_unreachable");
    expect(rpc.postSignal).toHaveBeenCalledTimes(1);
  });

  it("returns invalid_payload on invalid signal post body", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "signal.text" }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("invalid_payload");
    expect(rpc.postSignal).not.toHaveBeenCalled();
  });

  it("returns upstream_unreachable when RPC call fails unexpectedly", async () => {
    const { env } = makeEnv({
      coreOverrides: {
        listSignals: vi.fn(() => {
          throw new Error("network down");
        }),
      },
    });

    const request = new Request("http://local/v1/spaces/demo/signals", {
      method: "GET",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(502);

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("upstream_unreachable");
    expect(payload.error?.message).toContain("network down");
    expect(payload.error?.requestId).toBeTruthy();
  });
  it("forwards GET /meta to core RPC", async () => {
    const { env, rpc } = makeEnv({
      coreOverrides: {
        getSpaceMeta: vi.fn(async () => ({
          spaceId: "demo",
          purpose: "Coordinate launch reviews.",
          guide: "Stay clear and kind.",
          storageUsage: {
            usedBytes: 2048,
            softLimitBytes: 4096,
            usagePercent: 50,
          },
        })),
      },
    });

    const request = new Request("http://local/v1/spaces/demo/meta", {
      method: "GET",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      spaceId: "demo",
      purpose: "Coordinate launch reviews.",
      guide: "Stay clear and kind.",
      storageUsage: {
        usedBytes: 2048,
        softLimitBytes: 4096,
        usagePercent: 50,
      },
    });
    expect(rpc.getSpaceMeta).toHaveBeenCalledWith({
      spaceId: "demo",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("forwards PATCH /meta to core RPC", async () => {
    const { env, rpc } = makeEnv({
      coreOverrides: {
        updateSpaceMeta: vi.fn(async () => ({
          spaceId: "demo",
          name: "Launch Room",
          purpose: "Coordinate launch reviews.",
          guide: "Updated guideline",
        })),
      },
    });

    const request = new Request("http://local/v1/spaces/demo/meta", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "  Launch Room  ",
        purpose: "Coordinate launch reviews.",
        guide: "Updated guideline",
      }),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      spaceId: "demo",
      name: "Launch Room",
      purpose: "Coordinate launch reviews.",
      guide: "Updated guideline",
    });
    expect(rpc.updateSpaceMeta).toHaveBeenCalledWith({
      spaceId: "demo",
      name: "Launch Room",
      purpose: "Coordinate launch reviews.",
      guide: "Updated guideline",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("forwards GET /contract to core RPC", async () => {
    const { env, rpc } = makeEnv();

    const request = new Request("http://local/v1/spaces/demo/contract", {
      method: "GET",
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: 1,
      updatedAt: "2026-03-19T00:00:00.000Z",
      updatedBy: "system",
      dispatchPolicy: { mode: "mention_only" },
      publicationMode: "collaboration",
      allowedActions: ["post_message", "post_status", "stay_silent"],
      resultArchivePolicy: { mode: "all_final_results" },
      authorityOrder: "default",
      entryBrief: "default",
      dispatchBrief: "default",
    });
    expect(rpc.getSpaceContract).toHaveBeenCalledWith({
      spaceId: "demo",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("forwards GET /board to core RPC and validates the projection", async () => {
    const { env, rpc } = makeEnv();

    const request = new Request("http://local/v1/spaces/demo/board", {
      method: "GET",
      headers: {
        "x-openmeld-space-password": "secret-board",
      },
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      space: {
        id: "demo",
        name: "Launch Room",
        purpose: "Coordinate the launch.",
        guide: "Be concise and helpful.",
      },
      members: {
        totalCount: 2,
        humanCount: 1,
        agentCount: 1,
        centerAgentPresent: false,
      },
      workingNow: [],
      recentOutcomes: [],
    });
    expect(rpc.getSpaceBoard).toHaveBeenCalledWith({
      spaceId: "demo",
      spaceAccess: expectedAuthenticatedSpaceAccess("demo", "secret-board"),
    });
  });

  it("narrows legacy status permissions before forwarding PATCH /contract", async () => {
    const { env, rpc } = makeEnv();
    const contractPatch = {
      publicationMode: "raw_context_sharing",
      allowedActions: ["post_status", "stay_silent"],
      resultArchivePolicy: { mode: "space_reply_only" },
      entryBrief: "none",
    };

    const request = new Request("http://local/v1/spaces/demo/contract", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-openmeld-space-password": "secret-contract",
      },
      body: JSON.stringify(contractPatch),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: 2,
      updatedAt: "2026-03-19T00:01:00.000Z",
      updatedBy: "11111111-1111-4111-8111-111111111111",
      dispatchPolicy: { mode: "mention_only" },
      publicationMode: "raw_context_sharing",
      allowedActions: ["post_status", "stay_silent"],
      resultArchivePolicy: { mode: "space_reply_only" },
      authorityOrder: "default",
      entryBrief: "none",
      dispatchBrief: "default",
    });
    expect(rpc.patchSpaceContract).toHaveBeenCalledWith({
      spaceId: "demo",
      contractPatch: { ...contractPatch, allowedActions: ["stay_silent"] },
      password: "secret-contract",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("forwards GET /status to core RPC", async () => {
    const { env, rpc } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/spaces/demo/status", {
        method: "GET",
        headers: {
          "x-openmeld-space-password": "secret-status",
        },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        spaceId: "demo",
        organizationVisibility: "private",
        latestVisibleUpdate: expect.objectContaining({
          signalId: "sig-2",
          signalType: "signal.status",
        }),
      })
    );
    expect(rpc.getSpaceStatus).toHaveBeenCalledWith({
      spaceId: "demo",
      spaceAccess: expectedAuthenticatedSpaceAccess("demo", "secret-status"),
    });
  });

  it("forwards GET /updates to core RPC", async () => {
    const { env, rpc } = makeEnv();

    const request = new Request(
      "http://local/v1/spaces/demo/updates?afterSignalId=sig-1&limit=25",
      {
        method: "GET",
        headers: {
          "x-openmeld-space-password": "secret-updates",
        },
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      signals: [
        expect.objectContaining({
          id: "sig-2",
          type: "signal.status",
        }),
      ],
    });
    expect(rpc.getSpaceUpdates).toHaveBeenCalledWith(
      {
        spaceId: "demo",
        afterSignalId: "sig-1",
        limit: 25,
        password: "secret-updates",
        context: EXPECTED_CORE_CONTEXT,
      },
      OPENMELD_SPACE_ADDRESSING_VERSION,
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    );
  });

  it("rejects invalid GET /updates query before forwarding", async () => {
    const { env, rpc } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/spaces/demo/updates?afterSignalId="),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(rpc.getSpaceUpdates).not.toHaveBeenCalled();
  });

  it("forwards GET /result by dispatchId to core RPC", async () => {
    const { env, rpc } = makeEnv();

    const request = new Request(
      "http://local/v1/spaces/demo/result?dispatchId=dispatch-1",
      {
        method: "GET",
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        resultRef: "dispatch-result:result-1",
        dispatchId: "dispatch-1",
      })
    );
    expect(rpc.getSpaceDispatchResult).toHaveBeenCalledWith(
      {
        spaceId: "demo",
        dispatchId: "dispatch-1",
        context: EXPECTED_CORE_CONTEXT,
      },
      OPENMELD_SPACE_ADDRESSING_VERSION,
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    );
  });

  it("forwards GET /result by resultRef to core RPC", async () => {
    const { env, rpc } = makeEnv();

    const response = await app.fetch(
      new Request(
        "http://local/v1/spaces/demo/result?resultRef=dispatch-result%3Aresult-1"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(rpc.getSpaceDispatchResult).toHaveBeenCalledWith(
      {
        spaceId: "demo",
        resultRef: "dispatch-result:result-1",
        context: EXPECTED_CORE_CONTEXT,
      },
      OPENMELD_SPACE_ADDRESSING_VERSION,
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    );
  });

  it("rejects invalid GET /result query before forwarding", async () => {
    const { env, rpc } = makeEnv();

    const response = await app.fetch(
      new Request(
        "http://local/v1/spaces/demo/result?dispatchId=dispatch-1&resultRef=dispatch-result%3Aresult-1"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(rpc.getSpaceDispatchResult).not.toHaveBeenCalled();
  });

  it("narrows legacy status permissions before forwarding PUT /contract", async () => {
    const { env, rpc } = makeEnv();
    const contract = {
      dispatchPolicy: { mode: "mention_only" },
      publicationMode: "collaboration",
      allowedActions: ["post_message", "post_status", "stay_silent"],
      resultArchivePolicy: { mode: "all_final_results" },
      authorityOrder: "default",
      entryBrief: "default",
      dispatchBrief: "default",
    };

    const request = new Request("http://local/v1/spaces/demo/contract", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(contract),
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: 2,
      updatedAt: "2026-03-19T00:01:00.000Z",
      updatedBy: "11111111-1111-4111-8111-111111111111",
      ...contract,
    });
    expect(rpc.putSpaceContract).toHaveBeenCalledWith({
      spaceId: "demo",
      contract: {
        ...contract,
        allowedActions: ["post_message", "stay_silent"],
      },
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("forwards GET /cursors/:profileId to core RPC", async () => {
    const { env, rpc } = makeEnv({
      coreOverrides: {
        getSpaceCursor: vi.fn(async () => ({
          spaceId: "demo",
          profileId: "11111111-1111-4111-8111-111111111111",
          lastSeenTs: 222,
        })),
      },
    });

    const request = new Request(
      "http://local/v1/spaces/demo/cursors/11111111-1111-4111-8111-111111111111",
      {
        method: "GET",
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      spaceId: "demo",
      profileId: "11111111-1111-4111-8111-111111111111",
      lastSeenTs: 222,
    });
    expect(rpc.getSpaceCursor).toHaveBeenCalledWith({
      spaceId: "demo",
      profileId: "11111111-1111-4111-8111-111111111111",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("returns 404 when GET /cursors/:profileId mismatches resolved profile", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/spaces/demo/cursors/profileIdentity-002",
      {
        method: "GET",
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(404);
    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("profile.not_found");
    expect(payload.error?.message).toBe("profile not found");
    expect(payload.error?.requestId).toBe("req-test");
    expect(rpc.getSpaceCursor).not.toHaveBeenCalled();
  });

  it("returns 400 + audit log on invalid profileId for GET /cursors/:profileId", async () => {
    const { env, rpc } = makeEnv();
    const invalidActorId = "a".repeat(65);
    const auditSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const request = new Request(
      `http://local/v1/spaces/demo/cursors/${invalidActorId}`,
      {
        method: "GET",
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("bad_request");
    expect(payload.error?.message).toBe("Invalid profileId");
    expect(rpc.getSpaceCursor).not.toHaveBeenCalled();
    expect(auditSpy).toHaveBeenCalledTimes(1);
    const auditEvent = parseAuditLogEntry(auditSpy.mock.calls[0]?.[0]);
    expect(auditEvent.event).toBe("http.forward");
    expect(auditEvent.route).toBe("/v1/spaces/:spaceId/cursors/:profileId");
    expect(auditEvent.method).toBe("GET");
    expect(auditEvent.status).toBe(400);
    expect(String(auditEvent.reason ?? "")).toContain(
      "invalid_profile_id_param"
    );
  });

  it("forwards PATCH /cursors/:profileId role and mention alias to core RPC", async () => {
    const { env, rpc } = makeEnv({
      coreOverrides: {
        updateSpaceCursor: vi.fn(async () => ({
          spaceId: "demo",
          profileId: "11111111-1111-4111-8111-111111111111",
          role: "Spaceship Engineer",
          mentionAlias: "ops-bot",
        })),
      },
    });

    const request = new Request(
      "http://local/v1/spaces/demo/cursors/11111111-1111-4111-8111-111111111111",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          role: "Spaceship Engineer",
          mentionAlias: "ops-bot",
        }),
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      spaceId: "demo",
      profileId: "11111111-1111-4111-8111-111111111111",
      role: "Spaceship Engineer",
      mentionAlias: "ops-bot",
    });
    expect(rpc.updateSpaceCursor).toHaveBeenCalledWith({
      spaceId: "demo",
      profileId: "11111111-1111-4111-8111-111111111111",
      role: "Spaceship Engineer",
      mentionAlias: "ops-bot",
      context: EXPECTED_CORE_CONTEXT,
    });
  });

  it("returns 404 when PATCH /cursors/:profileId mismatches resolved profile", async () => {
    const { env, rpc } = makeEnv();
    const request = new Request(
      "http://local/v1/spaces/demo/cursors/profileIdentity-002",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lastSeenTs: 123 }),
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(404);
    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("profile.not_found");
    expect(payload.error?.message).toBe("profile not found");
    expect(payload.error?.requestId).toBe("req-test");
    expect(rpc.updateSpaceCursor).not.toHaveBeenCalled();
  });

  it("returns 400 + audit log on invalid profileId for PATCH /cursors/:profileId", async () => {
    const { env, rpc } = makeEnv();
    const invalidActorId = "a".repeat(65);
    const auditSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const request = new Request(
      `http://local/v1/spaces/demo/cursors/${invalidActorId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lastSeenTs: 123 }),
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("bad_request");
    expect(payload.error?.message).toBe("Invalid profileId");
    expect(rpc.updateSpaceCursor).not.toHaveBeenCalled();
    expect(auditSpy).toHaveBeenCalledTimes(1);
    const auditEvent = parseAuditLogEntry(auditSpy.mock.calls[0]?.[0]);
    expect(auditEvent.event).toBe("http.forward");
    expect(auditEvent.route).toBe("/v1/spaces/:spaceId/cursors/:profileId");
    expect(auditEvent.method).toBe("PATCH");
    expect(auditEvent.status).toBe(400);
    expect(String(auditEvent.reason ?? "")).toContain(
      "invalid_profile_id_param"
    );
  });

  it("returns 400 + audit log on invalid PATCH /cursors body", async () => {
    const { env, rpc } = makeEnv();
    const retiredCursorField = ["role", "Instructions"].join("");
    const auditSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const request = new Request(
      "http://local/v1/spaces/demo/cursors/11111111-1111-4111-8111-111111111111",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "Spaceship Engineer",
          [retiredCursorField]: "Design robust architecture constraints.",
        }),
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("bad_request");
    expect(payload.error?.message).toBe(
      `Unrecognized key: "${retiredCursorField}"`
    );
    expect(rpc.updateSpaceCursor).not.toHaveBeenCalled();
    expect(auditSpy).toHaveBeenCalledTimes(1);
    const auditEvent = parseAuditLogEntry(auditSpy.mock.calls[0]?.[0]);
    expect(auditEvent.event).toBe("http.forward");
    expect(auditEvent.route).toBe("/v1/spaces/:spaceId/cursors/:profileId");
    expect(auditEvent.method).toBe("PATCH");
    expect(auditEvent.status).toBe(400);
    expect(String(auditEvent.reason ?? "")).toContain(
      "invalid_patch_cursor_body"
    );
  });

  it("forwards GET /profiles/:profileId/spaces to auth RPC", async () => {
    const { env, authRpc } = makeEnv({
      authOverrides: {
        listProfileSpaceHistory: vi.fn(async () => ({
          ok: true,
          items: [
            {
              profileId: "11111111-1111-4111-8111-111111111111",
              gatewayHost: "localhost:8080",
              spaceId: "demo",
              spaceName: "ops-room",
              creatorProfileId: "11111111-1111-4111-8111-111111111111",
              creatorKind: "human",
              spaceCreatedAt: "2026-02-24T00:00:00.000Z",
              spaceUpdatedAt: "2026-02-24T00:00:01.000Z",
              lastJoinedAt: "2026-02-24T00:00:02.000Z",
              lastSeenTs: 7,
              pinnedAt: "2026-02-24T00:00:04.000Z",
              status: "active",
              createdAt: "2026-02-24T00:00:00.000Z",
              updatedAt: "2026-02-24T00:00:03.000Z",
            },
          ],
        })),
      },
    });

    const request = new Request(
      "http://local/v1/profiles/11111111-1111-4111-8111-111111111111/spaces?gatewayHost=localhost:8080&status=active&limit=20&pinned=true",
      {
        method: "GET",
        headers: { "x-openmeld-space-password": "secret-for-space-only" },
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          profileId: "11111111-1111-4111-8111-111111111111",
          gatewayHost: "localhost:8080",
          spaceId: "demo",
          spaceName: "ops-room",
          creatorProfileId: "11111111-1111-4111-8111-111111111111",
          creatorKind: "human",
          spaceCreatedAt: "2026-02-24T00:00:00.000Z",
          spaceUpdatedAt: "2026-02-24T00:00:01.000Z",
          lastJoinedAt: "2026-02-24T00:00:02.000Z",
          lastSeenTs: 7,
          pinnedAt: "2026-02-24T00:00:04.000Z",
          status: "active",
          createdAt: "2026-02-24T00:00:00.000Z",
          updatedAt: "2026-02-24T00:00:03.000Z",
        },
      ],
    });
    expect(authRpc.listProfileSpaceHistory).toHaveBeenCalledWith({
      headers: expect.not.objectContaining({
        "x-openmeld-space-password": expect.anything(),
      }),
      requestId: "req-test",
      openMeldProfileId: "11111111-1111-4111-8111-111111111111",
      gatewayHost: "localhost:8080",
      status: ["active"],
      limit: 20,
      pinned: true,
    });
  });

  it("forwards the active Wake summary with the Account Space Index host scope", async () => {
    const { env, rpc } = makeEnv({
      coreOverrides: {
        listAccountSpaceActiveWakeSummary: vi.fn(async () => ({
          generatedAtMs: 1000,
          items: [{ activeWakeCount: 1, spaceId: "space-one" }],
        })),
      },
    });

    const response = await app.fetch(
      new Request(
        "http://local/v1/account/spaces/active-wake-summary?gatewayHost=localhost%3A8080&selectedProfileId=11111111-1111-4111-8111-111111111111"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      generatedAtMs: 1000,
      items: [{ activeWakeCount: 1, spaceId: "space-one" }],
    });
    expect(rpc.listAccountSpaceActiveWakeSummary).toHaveBeenCalledWith({
      gatewayHost: "localhost:8080",
      ownerUserId: "owner-001",
      selectedProfileId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("keeps older active Wake clients on the current Gateway host scope", async () => {
    const { env, rpc } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/account/spaces/active-wake-summary?selectedProfileId=11111111-1111-4111-8111-111111111111"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(rpc.listAccountSpaceActiveWakeSummary).toHaveBeenCalledWith({
      gatewayHost: "local",
      ownerUserId: "owner-001",
      selectedProfileId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("forwards GET /v1/account/spaces to Core AccountSpaces", async () => {
    const { env, rpc, authRpc } = makeEnv({
      coreOverrides: {
        listAccountSpaces: vi.fn(async () => ({
          pinnedItems: [
            {
              creatorKind: "human",
              creatorOwnerUserId: "owner-001",
              creatorProfileId: "11111111-1111-4111-8111-111111111111",
              creatorProfileName: "Mira",
              gatewayHost: "localhost:8080",
              joinedProfiles: [
                {
                  lastJoinedAt: "2026-02-24T00:00:02.000Z",
                  pinnedAt: "2026-02-24T00:00:04.000Z",
                  profileId: "11111111-1111-4111-8111-111111111111",
                  profileName: "Mira",
                },
              ],
              lastJoinedAt: "2026-02-24T00:00:02.000Z",
              lastSeenTs: 7,
              openProfileId: "11111111-1111-4111-8111-111111111111",
              openProfileName: "Mira",
              organizationId: "org-1",
              pinnedAt: "2026-02-24T00:00:04.000Z",
              pinnedProfileIds: ["11111111-1111-4111-8111-111111111111"],
              spaceCreatedAt: "2026-02-24T00:00:00.000Z",
              spaceId: "demo",
              spaceName: "ops-room",
              spaceUpdatedAt: "2026-02-24T00:00:01.000Z",
              status: "active",
              updatedAt: "2026-02-24T00:00:03.000Z",
              visibility: "private",
            },
          ],
          spaceItems: [],
        })),
      },
    });

    const request = new Request(
      "http://local/v1/account/spaces?gatewayHost=localhost%3A8080&scope=account&selectedProfileId=11111111-1111-4111-8111-111111111111&limit=20",
      {
        method: "GET",
        headers: { "x-openmeld-space-password": "secret-for-space-only" },
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pinnedItems: [
        {
          creatorKind: "human",
          creatorOwnerUserId: "owner-001",
          creatorProfileId: "11111111-1111-4111-8111-111111111111",
          creatorProfileName: "Mira",
          gatewayHost: "localhost:8080",
          joinedProfiles: [
            {
              lastJoinedAt: "2026-02-24T00:00:02.000Z",
              pinnedAt: "2026-02-24T00:00:04.000Z",
              profileId: "11111111-1111-4111-8111-111111111111",
              profileName: "Mira",
            },
          ],
          lastJoinedAt: "2026-02-24T00:00:02.000Z",
          lastSeenTs: 7,
          openProfileId: "11111111-1111-4111-8111-111111111111",
          openProfileName: "Mira",
          organizationId: "org-1",
          pinnedAt: "2026-02-24T00:00:04.000Z",
          pinnedProfileIds: ["11111111-1111-4111-8111-111111111111"],
          spaceCreatedAt: "2026-02-24T00:00:00.000Z",
          spaceId: "demo",
          spaceName: "ops-room",
          spaceUpdatedAt: "2026-02-24T00:00:01.000Z",
          status: "active",
          updatedAt: "2026-02-24T00:00:03.000Z",
          visibility: "private",
        },
      ],
      spaceItems: [],
    });
    expect(rpc.listAccountSpaces).toHaveBeenCalledWith({
      gatewayHost: "localhost:8080",
      includeDeletedSpaces: false,
      includeDirectoryPreviews: false,
      limit: 20,
      ownerUserId: "owner-001",
      scope: "account",
      selectedProfileId: "11111111-1111-4111-8111-111111111111",
    });
    expect(authRpc.listProfileSpaceHistory).not.toHaveBeenCalled();
  });

  it("forwards opt-in AccountSpaces fields to Core", async () => {
    const { env, rpc, authRpc } = makeEnv({
      coreOverrides: {
        listAccountSpaces: vi.fn(async () => ({
          pinnedItems: [],
          spaceItems: [
            {
              creatorKind: "human",
              creatorOwnerUserId: "owner-001",
              creatorProfileId: "11111111-1111-4111-8111-111111111111",
              creatorProfileName: "Mira",
              gatewayHost: "localhost:8080",
              joinedProfiles: [
                {
                  lastJoinedAt: "2026-02-24T00:00:02.000Z",
                  pinnedAt: null,
                  profileId: "11111111-1111-4111-8111-111111111111",
                  profileName: "Mira",
                },
              ],
              lastJoinedAt: "2026-02-24T00:00:02.000Z",
              lastSeenTs: 7,
              openProfileId: "11111111-1111-4111-8111-111111111111",
              openProfileName: "Mira",
              organizationId: "org-1",
              pinnedAt: null,
              pinnedProfileIds: [],
              spaceCreatedAt: "2026-02-24T00:00:00.000Z",
              spaceId: "demo",
              spaceName: "Mira's OpenMeld Welcoming Space",
              directMessageProfileIds: null,
              spacePurpose: "openmeld_welcoming_space",
              spaceUpdatedAt: "2026-02-24T00:00:01.000Z",
              status: "active",
              updatedAt: "2026-02-24T00:00:03.000Z",
              visibility: "public",
            },
          ],
        })),
      },
    });

    const request = new Request(
      "http://local/v1/account/spaces?gatewayHost=localhost%3A8080&scope=account&selectedProfileId=11111111-1111-4111-8111-111111111111&limit=20&includeDirectMessageProfileIds=true&includePurposes=true&includeDeletedSpaces=true&includeDirectoryPreviews=true",
      { method: "GET" }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pinnedItems: [],
      spaceItems: [
        expect.objectContaining({
          spaceId: "demo",
          spaceName: "Mira's OpenMeld Welcoming Space",
          spacePurpose: "openmeld_welcoming_space",
        }),
      ],
    });
    expect(rpc.listAccountSpaces).toHaveBeenCalledWith({
      gatewayHost: "localhost:8080",
      includeDeletedSpaces: true,
      includeDirectMessageProfileIds: true,
      includeDirectoryPreviews: true,
      includePurposes: true,
      limit: 20,
      ownerUserId: "owner-001",
      scope: "account",
      selectedProfileId: "11111111-1111-4111-8111-111111111111",
    });
    expect(authRpc.listProfileSpaceHistory).not.toHaveBeenCalled();
  });

  it("rejects GET /v1/account/spaces when selectedProfileId does not match the authenticated profile", async () => {
    const { env, rpc, authRpc } = makeEnv();
    const auditSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const request = new Request(
      "http://local/v1/account/spaces?gatewayHost=localhost%3A8080&scope=profile&selectedProfileId=agt_22222222-2222-4222-8222-222222222222&limit=20",
      { method: "GET" }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "profile.not_found",
        message: "profile not found",
      },
    });
    expect(rpc.listAccountSpaces).not.toHaveBeenCalled();
    expect(authRpc.listProfileSpaceHistory).not.toHaveBeenCalled();
    expect(auditSpy).toHaveBeenCalledTimes(1);
    const auditEvent = parseAuditLogEntry(auditSpy.mock.calls[0]?.[0]);
    expect(auditEvent.route).toBe("/v1/account/spaces");
    expect(auditEvent.status).toBe(404);
    expect(String(auditEvent.reason ?? "")).toContain("profile_mismatch");
  });

  it("forwards PATCH /profiles/:profileId/spaces/:spaceId to auth RPC", async () => {
    const { env, authRpc } = makeEnv();
    const request = new Request(
      "http://local/v1/profiles/11111111-1111-4111-8111-111111111111/spaces/demo",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-openmeld-space-password": "secret-for-space-only",
        },
        body: JSON.stringify({
          gatewayHost: "localhost:8080",
          spaceName: "ops-room",
          pinnedAt: null,
          status: "active",
        }),
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      item: {
        profileId: "11111111-1111-4111-8111-111111111111",
        gatewayHost: "localhost:8080",
        spaceId: "demo",
        spaceName: "ops-room",
        creatorProfileId: "11111111-1111-4111-8111-111111111111",
        creatorKind: "human",
        spaceCreatedAt: "2026-02-24T00:00:00.000Z",
        spaceUpdatedAt: "2026-02-24T00:00:01.000Z",
        lastJoinedAt: "2026-02-24T00:00:02.000Z",
        lastSeenTs: 5,
        pinnedAt: null,
        status: "active",
        createdAt: "2026-02-24T00:00:00.000Z",
        updatedAt: "2026-02-24T00:00:03.000Z",
      },
      spaceIndexOverlay: {
        repairAttempted: false,
        status: "applied",
        updated: true,
      },
    });
    expect(authRpc.upsertProfileSpaceHistory).toHaveBeenCalledWith({
      headers: expect.not.objectContaining({
        "x-openmeld-space-password": expect.anything(),
      }),
      requestId: "req-test",
      openMeldProfileId: "11111111-1111-4111-8111-111111111111",
      spaceId: "demo",
      gatewayHost: "localhost:8080",
      spaceName: "ops-room",
      pinnedAt: null,
      status: "active",
    });
  });

  it("forwards PATCH /profiles/:profileId/spaces/:spaceId/status with schema shape", async () => {
    const { env, authRpc } = makeEnv({
      authOverrides: {
        updateProfileSpaceHistoryStatus: vi.fn(async () => ({
          ok: true,
          item: {
            profileId: "11111111-1111-4111-8111-111111111111",
            gatewayHost: "localhost:8080",
            spaceId: "demo",
            status: "removed",
            updatedAt: "2026-02-24T00:00:03.000Z",
          },
        })),
      },
    });

    const request = new Request(
      "http://local/v1/profiles/11111111-1111-4111-8111-111111111111/spaces/demo/status",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-openmeld-space-password": "secret-for-space-only",
        },
        body: JSON.stringify({
          gatewayHost: "localhost:8080",
          status: "removed",
          reason: "space.not_found",
        }),
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      profileId: "11111111-1111-4111-8111-111111111111",
      gatewayHost: "localhost:8080",
      spaceId: "demo",
      status: "removed",
      updatedAt: "2026-02-24T00:00:03.000Z",
    });
    expect(authRpc.updateProfileSpaceHistoryStatus).toHaveBeenCalledWith({
      headers: expect.not.objectContaining({
        "x-openmeld-space-password": expect.anything(),
      }),
      requestId: "req-test",
      openMeldProfileId: "11111111-1111-4111-8111-111111111111",
      spaceId: "demo",
      gatewayHost: "localhost:8080",
      status: "removed",
      reason: "space.not_found",
    });
  });

  it("preserves typed auth RPC error codes for profile-space routes", async () => {
    const scenarios: Array<{
      request: Request;
      coreOverrides?: Partial<CoreRpcMock>;
      authOverrides?: Partial<AuthRpcMock>;
      expected: {
        status: number;
        code: string;
        message: string;
      };
    }> = [
      {
        request: new Request(
          "http://local/v1/profiles/11111111-1111-4111-8111-111111111111/spaces?gatewayHost=localhost:8080",
          { method: "GET" }
        ),
        authOverrides: {
          listProfileSpaceHistory: vi.fn(async () => ({
            ok: false,
            code: "profile.not_found",
            message: "profile not found",
          })),
        },
        expected: {
          status: 404,
          code: "profile.not_found",
          message: "profile not found",
        },
      },
      {
        request: new Request(
          "http://local/v1/profiles/11111111-1111-4111-8111-111111111111/spaces/demo",
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              gatewayHost: "localhost:8080",
              status: "active",
            }),
          }
        ),
        authOverrides: {
          upsertProfileSpaceHistory: vi.fn(async () => ({
            ok: false,
            code: "profile.invalid_input",
            message: "invalid profile input",
          })),
        },
        expected: {
          status: 400,
          code: "profile.invalid_input",
          message: "invalid profile input",
        },
      },
      {
        request: new Request(
          "http://local/v1/profiles/11111111-1111-4111-8111-111111111111/spaces/demo/status",
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              gatewayHost: "localhost:8080",
              status: "removed",
              reason: "space.not_found",
            }),
          }
        ),
        authOverrides: {
          updateProfileSpaceHistoryStatus: vi.fn(async () => ({
            ok: false,
            code: "profile.not_found",
            message: "profile not found",
          })),
        },
        expected: {
          status: 404,
          code: "profile.not_found",
          message: "profile not found",
        },
      },
      {
        request: new Request(
          "http://local/v1/spaces/deletion-tombstones/query",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              gatewayHost: "localhost:8080",
              spaceIds: ["demo"],
            }),
          }
        ),
        authOverrides: {
          querySpaceDeletionTombstones: vi.fn(async () => ({
            ok: false,
            code: "profile.invalid_input",
            message: "invalid profile input",
          })),
        },
        expected: {
          status: 400,
          code: "profile.invalid_input",
          message: "invalid profile input",
        },
      },
      {
        request: new Request("http://local/v1/spaces/demo/deletion-tombstone", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            gatewayHost: "localhost:8080",
          }),
        }),
        coreOverrides: {
          getSpaceMeta: vi.fn(() =>
            Promise.reject(
              createStructuredRpcHttpError({
                status: 404,
                code: "space.not_found",
                message: "space not found",
              })
            )
          ),
        },
        authOverrides: {
          upsertSpaceDeletionTombstone: vi.fn(async () => ({
            ok: false,
            code: "profile.not_found",
            message: "profile not found",
          })),
        },
        expected: {
          status: 404,
          code: "profile.not_found",
          message: "profile not found",
        },
      },
    ];

    for (const scenario of scenarios) {
      const { env } = makeEnv({
        coreOverrides: scenario.coreOverrides,
        authOverrides: scenario.authOverrides,
      });
      const response = await app.fetch(
        scenario.request,
        env,
        TEST_EXECUTION_CONTEXT
      );
      expect(response.status).toBe(scenario.expected.status);

      const payload = (await response.json()) as {
        ok: boolean;
        error?: { code?: string; message?: string; requestId?: string };
      };
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe(scenario.expected.code);
      expect(payload.error?.message).toBe(scenario.expected.message);
      expect(payload.error?.requestId).toBe("req-test");
    }
  });

  it("returns 404 when profile id mismatches on /profiles/:profileId/spaces", async () => {
    const { env, authRpc } = makeEnv();
    const request = new Request(
      "http://local/v1/profiles/profileIdentity-002/spaces?gatewayHost=localhost:8080",
      {
        method: "GET",
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(404);
    expect(authRpc.listProfileSpaceHistory).not.toHaveBeenCalled();
  });

  it("forwards POST /spaces/deletion-tombstones/query to auth RPC", async () => {
    const { env, authRpc } = makeEnv({
      authOverrides: {
        querySpaceDeletionTombstones: vi.fn(async () => ({
          ok: true,
          items: [
            {
              gatewayHost: "localhost:8080",
              spaceId: "demo",
              spaceName: "ops-room",
              creatorProfileId: "11111111-1111-4111-8111-111111111111",
              creatorKind: "human",
              deletedByProfileId: "11111111-1111-4111-8111-111111111111",
              deletedByProfileName: "Mira",
              deletedByOwnerUserId: "owner-001",
              deletedAt: "2026-03-12T00:00:00.000Z",
              createdAt: "2026-03-12T00:00:00.000Z",
              updatedAt: "2026-03-12T00:00:00.000Z",
            },
          ],
        })),
      },
    });

    const request = new Request(
      "http://local/v1/spaces/deletion-tombstones/query",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openmeld-space-password": "secret-for-space-only",
        },
        body: JSON.stringify({
          gatewayHost: "localhost:8080",
          spaceIds: ["demo"],
        }),
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          gatewayHost: "localhost:8080",
          spaceId: "demo",
          spaceName: "ops-room",
          creatorProfileId: "11111111-1111-4111-8111-111111111111",
          creatorKind: "human",
          deletedByProfileId: "11111111-1111-4111-8111-111111111111",
          deletedByProfileName: "Mira",
          deletedByOwnerUserId: "owner-001",
          deletedAt: "2026-03-12T00:00:00.000Z",
          createdAt: "2026-03-12T00:00:00.000Z",
          updatedAt: "2026-03-12T00:00:00.000Z",
        },
      ],
    });
    expect(authRpc.querySpaceDeletionTombstones).toHaveBeenCalledWith({
      headers: expect.not.objectContaining({
        "x-openmeld-space-password": expect.anything(),
      }),
      requestId: "req-test",
      openMeldProfileId: "11111111-1111-4111-8111-111111111111",
      gatewayHost: "localhost:8080",
      spaceIds: ["demo"],
    });
  });

  it("forwards PUT /spaces/:spaceId/deletion-tombstone to auth RPC", async () => {
    const { env, authRpc, rpc } = makeEnv({
      coreOverrides: {
        getSpaceMeta: vi.fn(() =>
          Promise.reject(
            createStructuredRpcHttpError({
              status: 404,
              code: "space.not_found",
              message: "space not found",
            })
          )
        ),
      },
    });
    const request = new Request(
      "http://local/v1/spaces/demo/deletion-tombstone",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-openmeld-space-password": "secret-for-space-only",
        },
        body: JSON.stringify({
          gatewayHost: "localhost:8080",
          spaceName: "ops-room",
        }),
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      item: {
        gatewayHost: "localhost:8080",
        spaceId: "demo",
        spaceName: "ops-room",
        creatorProfileId: "11111111-1111-4111-8111-111111111111",
        creatorKind: "human",
        deletedByProfileId: "11111111-1111-4111-8111-111111111111",
        deletedByProfileName: "Mira",
        deletedByOwnerUserId: "owner-001",
        deletedAt: "2026-03-12T00:00:00.000Z",
        createdAt: "2026-03-12T00:00:00.000Z",
        updatedAt: "2026-03-12T00:00:00.000Z",
      },
    });
    expect(rpc.getSpaceMeta).toHaveBeenCalledWith({
      spaceId: "demo",
      context: expect.objectContaining({
        actorContext: expect.objectContaining({
          requestId: "req-test",
          openMeldProfileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
        }),
      }),
    });
    expect(authRpc.upsertSpaceDeletionTombstone).toHaveBeenCalledWith({
      headers: expect.not.objectContaining({
        "x-openmeld-space-password": expect.anything(),
      }),
      requestId: "req-test",
      openMeldProfileId: "11111111-1111-4111-8111-111111111111",
      spaceId: "demo",
      gatewayHost: "localhost:8080",
      spaceName: "ops-room",
    });
  });

  it("rejects PUT /spaces/:spaceId/deletion-tombstone when the space still exists", async () => {
    const { env, authRpc } = makeEnv();
    const request = new Request(
      "http://local/v1/spaces/demo/deletion-tombstone",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          gatewayHost: "localhost:8080",
        }),
      }
    );

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "bad_request",
        message: "space must be deleted before writing a tombstone",
      },
    });
    expect(authRpc.upsertSpaceDeletionTombstone).not.toHaveBeenCalled();
  });
});

function parseAuditLogEntry(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
