import type {
  PostgreSQLBinding,
  PostgresDatabase,
  QueryConfig,
} from "@openmeld/db/postgresql";
import {
  type ProjectSpaceIndexSnapshotInput,
  projectActiveSpaceIndexSnapshot,
} from "../src/space-index/space-index-projection-service";
import { observePostgresDatabase } from "../test-support/postgresql-query.test-support";
import { env as workerEnv } from "../test-support/worker-env";
import { createWorkerPostgresFixture } from "./postgresql.test-support";

const organizationPostgresObservers = vi.hoisted(
  () => new WeakMap<PostgreSQLBinding, PostgresDatabase>()
);
const organizationFixtures = new WeakMap<
  PostgreSQLBinding,
  Awaited<ReturnType<typeof createOrganizationRpcDb>>
>();
vi.mock("@openmeld/db/postgresql", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@openmeld/db/postgresql")>();
  return {
    ...actual,
    getPostgresDatabase: (bindings: {
      OPENMELD_POSTGRESQL?: PostgreSQLBinding;
    }) =>
      (bindings.OPENMELD_POSTGRESQL &&
        organizationPostgresObservers.get(bindings.OPENMELD_POSTGRESQL)) ??
      actual.getPostgresDatabase(bindings),
  };
});
const memberAgentsFeature = vi.hoisted(() => ({ enabled: false }));
vi.mock("../src/member-agent/member-agents-feature", () => ({
  isMemberAgentsEnabled: () => memberAgentsFeature.enabled,
  isRequestChainEnforced: () => memberAgentsFeature.enabled,
}));
function organizationFixture(env: CoreBindings) {
  const fixture =
    env.OPENMELD_POSTGRESQL &&
    organizationFixtures.get(env.OPENMELD_POSTGRESQL);
  if (!fixture) {
    throw new Error("Expected an isolated native Organization fixture");
  }
  return fixture;
}

import {
  agentProfileIdSchema,
  authProfileViewSchema,
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
  HOSTED_CENTER_AGENT_RUNTIME_IDENTITY,
  OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS,
  validateSpaceSignalClientMessageIdPolicy,
} from "@openmeld/schemas";
import type {
  GetSpaceThreadResponse,
  ListSpaceThreadSignalsResponse,
  ListSpaceThreadsResponse,
  LocalRuntimesResponse,
  OpenMeldRequestContext,
  PostSpaceWakeStopResponse,
  SignalEnvelope,
  SignalTextEnvelope,
} from "@openmeld/schemas/types";
import { OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE } from "@openmeld/space";
import { afterEach, describe, expect, it, vi } from "vitest";
// biome-ignore lint/performance/noNamespaceImport: Spy on the usage read boundary while exercising organization authorization and projection.
import * as agentProfileUsage from "../src/agent-execution/application/agent-profile-usage";
// biome-ignore lint/performance/noNamespaceImport: Vitest spies on the shared batch read used by RPC readiness orchestration.
import * as localRuntimeExpectedRoutesService from "../src/agent-profile-binding/application/local-runtime-expected-routes-service";
import { MAX_ENABLED_PRIMARY_BINDING_OWNERS_PER_AGENT_PROFILE } from "../src/agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
// biome-ignore lint/performance/noNamespaceImport: Vitest must spy on the live ESM exports used by the RPC orchestration module.
import * as centerAgentWakePublicationService from "../src/center-agent/application/center-agent-wake-publication-service";
import type { CenterAgentWakePublicationRecord } from "../src/center-agent/infrastructure/postgresql/center-agent-wake-publication-repo";
// biome-ignore lint/performance/noNamespaceImport: Vitest must spy on the live ESM export used by the RPC orchestration module.
import * as runtimeTransportClient from "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client";
import { CenterAgentRpcEntrypoint } from "../src/index";
import type { CoreBindings } from "../src/lib/bindings";
// biome-ignore lint/performance/noNamespaceImport: Vitest must spy on the live ESM export used by the RPC orchestration module.
import * as organizationComputersService from "../src/organizations/organization-computers-service";
// biome-ignore lint/performance/noNamespaceImport: Vitest must spy on the live ESM export used by the Slack publication service.
import * as slackFinalReplyPresentation from "../src/remote-agent/application/slack-final-reply-presentation";
import { encryptSlackSearchAuthorization } from "../src/remote-agent/application/slack-search-authorization";
import {
  projectTeamSafeOrganizationDirectoryReadiness,
  rpcAddCenterAgentToSpace,
  rpcAddOrganizationDirectoryProfilesToSpace,
  rpcAddSpaceMembers,
  rpcCenterAgentAddAgentProfilesToSpace,
  rpcCenterAgentAddMembersToSpace,
  rpcCenterAgentCreateAgentProfile,
  rpcCenterAgentCreateSpace,
  rpcCenterAgentListComputers,
  rpcCenterAgentListLocalAgentInstallations,
  rpcCenterAgentListOrganizationMembers,
  rpcCenterAgentListSlackChannels,
  rpcCenterAgentListSpaceFiles,
  rpcCenterAgentPostSlackChannelMessage,
  rpcCenterAgentPostSlackFile,
  rpcCenterAgentPostSlackThreadMessage,
  rpcCenterAgentPostSpaceMessage,
  rpcCenterAgentReadDispatchHistory,
  rpcCenterAgentReadMemberComputers,
  rpcCenterAgentReadMemberOpenMeldServiceStatus,
  rpcCenterAgentReadSlackChannelHistory,
  rpcCenterAgentReadSlackChannelMembers,
  rpcCenterAgentReadSlackFile,
  rpcCenterAgentReadSlackWorkspaceDirectory,
  rpcCenterAgentReadSpaceAuthoringContract,
  rpcCenterAgentReadSpaceContext,
  rpcCenterAgentReadSpaceWakeProgress,
  rpcCenterAgentRecordConnectorActionAudit,
  rpcCenterAgentRemoveAgentProfilesFromSpace,
  rpcCenterAgentRequestOpenMeldToolsUpdate,
  rpcCenterAgentSearchSlackMessages,
  rpcCenterAgentSelectLocalAgentInstallation,
  rpcCenterAgentSetOpenMeldToolsMaintenance,
  rpcCenterAgentStopSpaceWake,
  rpcCenterAgentUpdateSpaceSettings,
  rpcCenterAgentWakeAgentProfilesInSpace,
  rpcClearSpacePassword,
  rpcConvertDirectMessageToSpace,
  rpcDeleteSpace,
  rpcDesignateCenterAgent,
  rpcGetCenterAgentDesignation,
  rpcGetCenterAgentDirectMessageSpaceProjection,
  rpcGetCenterAgentModel,
  rpcGetCenterAgentOperatingState,
  rpcGetCurrentOrganizationAgentRuntimeOverview,
  rpcGetCurrentOrganizationComputers,
  rpcGetCurrentOrganizationDirectory,
  rpcGetCurrentOrganizationProfileDirectory,
  rpcGetCurrentOrganizationSpaceDirectory,
  rpcGetCurrentOrganizationSpaceDirectoryWithMemberCounts,
  rpcJoinOrganizationPublicSpace,
  rpcLeaveSpace,
  rpcListCenterAgentAuditJournal,
  rpcOpenCenterAgentDirectMessageSpace,
  rpcOpenDirectMessageSpace,
  rpcPatchSpaceContract,
  rpcPostCenterAgentWakePublicationSignal,
  rpcReadCenterAgentOrganizationMemoryPolicy,
  rpcReadOrganizationInformationProtectionPolicy,
  rpcRecordCenterAgentAudit,
  rpcRecordCurrentOrganizationMemberPresence,
  rpcRecordCurrentOrganizationWebActivity,
  rpcRemoteAgentOpenDirectMessageSpace,
  rpcRemoveSpaceMembers,
  rpcSetCenterAgentOrganizationMemoryPolicy,
  rpcSetOrganizationInformationProtectionPolicy,
  rpcSetSpaceAccessMode,
  rpcUpdateCenterAgentModel,
  rpcUpdateCenterAgentOperatingState,
  rpcUpdateCenterAgentProfile,
  rpcUpsertSpacePassword,
} from "../src/rpc/methods";
// biome-ignore lint/performance/noNamespaceImport: Vitest must spy on the live ESM export used by the RPC orchestration module.
import * as currentDeviceTargetService from "../src/start/application/current-device-target-service";

const MUTATION_QUERY_PATTERN = /\b(?:INSERT INTO|UPDATE|DELETE FROM)\s/iu;
const BINDING_WRITE_PATTERN =
  /\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+"openmeld"\."openMeldDaemon_agent_profile_bindings"/iu;
const DESIGNATION_INSERT_PATTERN =
  /INSERT INTO\s+"openmeld"\."center_agent_designations"/iu;
const DESIGNATION_READ_PATTERN =
  /FROM\s+"openmeld"\."center_agent_designations"/iu;

const HUMAN_PROFILE_ID = "00000000-0000-4000-8000-000000000001";
const SECOND_HUMAN_PROFILE_ID = "00000000-0000-4000-8000-000000000010";
const AGENT_PROFILE_ID = "agt_00000000-0000-4000-8000-000000000002";
const SECOND_AGENT_PROFILE_ID = "agt_00000000-0000-4000-8000-000000000003";
const JOINED_PRIVATE_SPACE_ID =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const JOINED_PUBLIC_SPACE_ID =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const UNJOINED_PUBLIC_SPACE_ID =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const UNJOINED_PRIVATE_SPACE_ID =
  "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const OTHER_ORG_PUBLIC_SPACE_ID =
  "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const TEST_NOW_MS = Date.parse("2026-07-08T00:00:00.000Z");
const CENTER_AGENT_WAKE_CLIENT_MESSAGE_ID_PATTERN = /^ca-wake:/;
const EVIDENCE_VERSION_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function createCenterAgentRpcEntrypoint(
  env: CoreBindings
): CenterAgentRpcEntrypoint {
  const entrypoint = Object.create(
    CenterAgentRpcEntrypoint.prototype
  ) as CenterAgentRpcEntrypoint;
  Reflect.set(entrypoint, "env", env);
  return entrypoint;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("organization Core RPC", () => {
  it.each([
    false,
    true,
  ])("rejects organization directory reads when the active user is not an organization member (Center Agent only: %s)", async (centerAgentOnly) => {
    const env = await buildEnv({
      members: [],
    });

    await expect(
      rpcGetCurrentOrganizationDirectory(env, {
        centerAgentOnly,
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
      })
    ).rejects.toMatchObject({
      code: "organization.membership_required",
      status: 403,
    });
  });

  it("defaults untouched Center Agent organization memory on", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [],
      members: [
        memberRow("member-a", "org-a", "user-a", "owner"),
        memberRow("member-b", "org-a", "user-b", "member"),
      ],
    });
    const env = await buildEnv({ db });

    await expect(
      rpcReadCenterAgentOrganizationMemoryPolicy(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-b",
        }),
      })
    ).resolves.toEqual({
      organizationId: "org-a",
      organizationMemoryOptIn: true,
      provider: "zep_cloud",
      updatedByUserId: null,
    });
    await expect(
      rpcReadCenterAgentOrganizationMemoryPolicy(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-b",
        }),
        includeAvailability: true,
      })
    ).resolves.toMatchObject({
      organizationMemoryOptIn: true,
      availability: "unavailable",
    });
  });

  it("preserves an explicit off choice and lets owners idempotently update it", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [],
      centerAgentMemoryPolicies: [
        {
          organizationId: "org-a",
          organizationMemoryOptIn: false,
          updatedByUserId: "user-a",
        },
      ],
      members: [
        memberRow("member-a", "org-a", "user-a", "owner"),
        memberRow("member-b", "org-a", "user-b", "member"),
      ],
    });
    const env = await buildEnv({ db });

    await expect(
      rpcReadCenterAgentOrganizationMemoryPolicy(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-b",
        }),
      })
    ).resolves.toEqual({
      organizationId: "org-a",
      organizationMemoryOptIn: false,
      provider: "zep_cloud",
      updatedByUserId: "user-a",
    });
    await expect(
      rpcReadCenterAgentOrganizationMemoryPolicy(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-b",
        }),
        includeAvailability: true,
      })
    ).resolves.toMatchObject({
      organizationMemoryOptIn: false,
      availability: "disabled",
    });

    const ownerContext = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });
    await expect(
      rpcSetCenterAgentOrganizationMemoryPolicy(env, {
        context: ownerContext,
        organizationMemoryOptIn: true,
      })
    ).resolves.toMatchObject({
      organizationId: "org-a",
      organizationMemoryOptIn: true,
      updatedByUserId: "user-a",
    });
    await expect(
      rpcSetCenterAgentOrganizationMemoryPolicy(env, {
        context: ownerContext,
        organizationMemoryOptIn: true,
      })
    ).resolves.toMatchObject({
      organizationId: "org-a",
      organizationMemoryOptIn: true,
      updatedByUserId: "user-a",
    });
    expect(await db.readMemoryPolicies()).toEqual([
      {
        organizationId: "org-a",
        organizationMemoryOptIn: true,
        updatedByUserId: "user-a",
      },
    ]);
  });

  it("rejects Center Agent organization memory policy writes from non-admin members", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
    });
    const env = await buildEnv({ db });

    await expect(
      rpcSetCenterAgentOrganizationMemoryPolicy(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        organizationMemoryOptIn: true,
      })
    ).rejects.toMatchObject({
      code: "organization.role_required",
      cause: {
        code: "organization.role_required",
        message:
          "Only an Organization owner or admin can manage the Center Agent.",
        status: 403,
      },
      status: 403,
    });
    expect(await db.readMemoryPolicies()).toEqual([]);
  });

  it("lets only owners and admins read or update Organization information protection", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [],
      members: [
        memberRow("member-owner", "org-a", "user-owner", "owner"),
        memberRow("member-admin", "org-a", "user-admin", "admin"),
        memberRow("member-member", "org-a", "user-member", "member"),
      ],
    });
    const env = await buildEnv({ db });

    await expect(
      rpcReadOrganizationInformationProtectionPolicy(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-member",
        }),
      })
    ).rejects.toMatchObject({
      code: "organization.role_required",
      status: 403,
    });
    await expect(
      rpcSetOrganizationInformationProtectionPolicy(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-member",
        }),
        protectedInformation: "Private customer pricing.",
      })
    ).rejects.toMatchObject({
      code: "organization.role_required",
      status: 403,
    });
    expect(await db.readInformationPolicies()).toEqual([]);

    await expect(
      rpcSetOrganizationInformationProtectionPolicy(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-admin",
        }),
        protectedInformation:
          "Customer contract pricing and unreleased Board forecasts.",
      })
    ).resolves.toMatchObject({
      organizationId: "org-a",
      protectedInformation:
        "Customer contract pricing and unreleased Board forecasts.",
      updatedByUserId: "user-admin",
    });

    await expect(
      rpcReadOrganizationInformationProtectionPolicy(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-owner",
        }),
      })
    ).resolves.toMatchObject({
      organizationId: "org-a",
      protectedInformation:
        "Customer contract pricing and unreleased Board forecasts.",
      updatedByUserId: "user-admin",
    });
  });

  it("lets an admin clear the additional Organization policy", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [],
      informationProtectionPolicies: [
        {
          organizationId: "org-a",
          protectedInformation: "Private renewal pricing.",
          updatedAtMs: TEST_NOW_MS,
          updatedByUserId: "user-admin",
        },
      ],
      members: [memberRow("member-admin", "org-a", "user-admin", "admin")],
    });
    const env = await buildEnv({ db });

    await expect(
      rpcSetOrganizationInformationProtectionPolicy(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-admin",
        }),
        protectedInformation: null,
      })
    ).resolves.toMatchObject({
      organizationId: "org-a",
      protectedInformation: null,
      updatedByUserId: "user-admin",
    });
    expect(await db.readInformationPolicies()).toEqual([]);
  });

  it("filters the organization directory to the active Organization and reuses agent readiness projection", async () => {
    const env = await buildEnv({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
        {
          organizationId: "org-b",
          ownerUserId: "user-b",
          profileHandle: "other",
          profileId: "agt_00000000-0000-4000-8000-000000000003",
          profileName: "Other",
          status: "active",
        },
      ],
      members: [
        memberRow("member-a", "org-a", "user-a"),
        memberRow("member-b", "org-b", "user-b"),
      ],
      memberActivities: [
        {
          humanProfileId: HUMAN_PROFILE_ID,
          lastActiveAtMs: Date.parse("2026-07-07T23:45:00.000Z"),
          organizationId: "org-a",
          userId: "user-a",
        },
      ],
    });

    const response = await rpcGetCurrentOrganizationDirectory(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
      includeMemberLastActiveAt: true,
    });

    expect(response.organizationId).toBe("org-a");
    expect(response.members.map((member) => member.userId)).toEqual(["user-a"]);
    expect(response.members[0]?.humanProfile?.lastUsedAt).toBe(
      "2023-11-14T22:13:20.000Z"
    );
    expect(response.members[0]?.lastActiveAt).toBe("2026-07-07T23:45:00.000Z");
    expect(response.agentProfiles.map((agent) => agent.profileId)).toEqual([
      AGENT_PROFILE_ID,
    ]);
    expect(
      response.agentProfiles[0]?.readiness.agentExecutionReadiness
        .agentProfileId
    ).toBe(AGENT_PROFILE_ID);
  });

  it.each([
    "user-a",
    "user-b",
  ])("shows Controller branding to Organization member %s without private runtime reads", async (viewerUserId) => {
    const env = await buildEnv({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      members: [
        memberRow("member-a", "org-a", "user-a"),
        memberRow("member-b", "org-a", "user-b"),
      ],
    });
    const lookupRoutes = vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportRoutesBatch"
    );
    const lookupOwnerService = vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportOwnerService"
    );
    const readOperationalContexts = vi.spyOn(
      runtimeTransportClient,
      "readRuntimeTransportAgentProfileOperationalContexts"
    );

    const response = await rpcGetCurrentOrganizationProfileDirectory(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: viewerUserId,
      }),
    });

    expect(response).toMatchObject({
      organizationId: "org-a",
      agentProfiles: [
        {
          agentControllerRef: "builtin:codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
        },
      ],
      members: expect.arrayContaining([
        expect.objectContaining({ userId: viewerUserId }),
      ]),
    });
    expect(lookupRoutes).not.toHaveBeenCalled();
    expect(lookupOwnerService).not.toHaveBeenCalled();
    expect(readOperationalContexts).not.toHaveBeenCalled();
    expect(response.agentProfiles[0]).not.toHaveProperty("modelSelection");
    const db = organizationFixture(env);
    await db.bindingRows.set(
      "binding-model",
      agentProfileBindingTestRow({
        bindingId: "binding-model",
        ownerId: "user-a",
      })
    );
    const withModels = await rpcGetCurrentOrganizationProfileDirectory(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: viewerUserId,
      }),
      includeModelSelection: true,
    });
    expect(withModels.agentProfiles[0]).toMatchObject({
      agentControllerRef: "builtin:codex",
      modelSelection: { modelId: "gpt-5.6-sol", reasoningLevel: "high" },
    });
    expect(withModels.agentProfiles[0]).not.toHaveProperty("primaryBinding");
    expect(withModels.agentProfiles[0]).not.toHaveProperty("readiness");
    expect(withModels.agentProfiles[0]).not.toHaveProperty(
      "agentControllerConversationId"
    );
    expect(lookupRoutes).not.toHaveBeenCalled();
    expect(lookupOwnerService).not.toHaveBeenCalled();
    expect(readOperationalContexts).not.toHaveBeenCalled();
    await db.fixture.operator.query(
      'REVOKE SELECT ON "openmeld"."openMeldDaemon_agent_profile_bindings" FROM openmeld_pg_runtime'
    );
    const unavailable = await rpcGetCurrentOrganizationProfileDirectory(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: viewerUserId,
      }),
      includeModelSelection: true,
    });
    expect(unavailable.agentProfiles[0]).toMatchObject({
      profileName: "Codex",
      agentControllerRef: null,
    });
    expect(unavailable.agentProfiles[0]).not.toHaveProperty("modelSelection");
  });

  it.each([
    false,
    true,
  ])("batches Agent runtime lookups and exposes only opted-in usage (%s)", async (includeUsageLimits) => {
    const usageLimits = [
      {
        key: "weekly",
        label: "Weekly usage",
        status: "available" as const,
        usedPercent: 92,
        resetsAt: "2026-09-22T00:00:00Z",
        observedAt: "2026-09-15T00:00:00Z",
      },
    ];
    vi.spyOn(agentProfileUsage, "readAgentProfileUsage").mockResolvedValue(
      usageLimits
    );
    const resolveProfileById = vi.fn();
    const resolveProfilesByIds = vi.fn(
      async (input: { profileIds: string[] }) => ({
        ok: true as const,
        profiles: Object.fromEntries(
          input.profileIds.map((profileId) => [
            profileId,
            {
              ownerUserId: "user-a",
              profileKind: "agent" as const,
              profileId,
              profileName:
                profileId === AGENT_PROFILE_ID ? "Codex" : "Reviewer",
              profileHandle: "agent",
              status: "active" as const,
              defaultProjectId: null,
            },
          ])
        ),
      })
    );
    const env = await buildEnv({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "reviewer",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Reviewer",
          status: "active",
        },
      ],
      authWorker: { resolveProfileById, resolveProfilesByIds },
      members: [memberRow("member-a", "org-a", "user-a")],
    });
    const lookupRoutes = vi
      .spyOn(runtimeTransportClient, "lookupRuntimeTransportRoutesBatch")
      .mockResolvedValue({
        routes: {
          [AGENT_PROFILE_ID]: {
            online: false,
            reasonCode: "daemon.profile.offline",
          },
          [SECOND_AGENT_PROFILE_ID]: {
            online: false,
            reasonCode: "daemon.profile.offline",
          },
        },
      });
    const lookupOwnerService = vi
      .spyOn(runtimeTransportClient, "lookupRuntimeTransportOwnerService")
      .mockResolvedValue({
        online: false,
        reasonCode: "daemon.session.not_found",
      });
    vi.spyOn(
      runtimeTransportClient,
      "readRuntimeTransportAgentProfileOperationalContexts"
    ).mockResolvedValue({
      contexts: [
        {
          operationalContext: {
            status: "working",
            waitingCount: 0,
          },
          targetProfileId: AGENT_PROFILE_ID,
        },
        {
          operationalContext: {
            status: "idle",
            waitingCount: 0,
          },
          targetProfileId: SECOND_AGENT_PROFILE_ID,
        },
      ],
    });
    // A slow database preload must not delay independent Runtime Transport
    // reads. Hold the native Binding query without replacing its SQL behavior.
    let releaseBindingRead: () => void = () => undefined;
    const bindingReadGate = new Promise<void>((resolve) => {
      releaseBindingRead = resolve;
    });
    let markBindingReadStarted: () => void = () => undefined;
    const bindingReadStarted = new Promise<void>((resolve) => {
      markBindingReadStarted = resolve;
    });
    const fixture = organizationFixture(env);
    organizationPostgresObservers.set(
      fixture.binding,
      observePostgresDatabase(fixture.db, (query) => {
        if (
          query.text.includes(
            'FROM "openmeld"."openMeldDaemon_agent_profile_bindings"'
          )
        ) {
          markBindingReadStarted();
          return bindingReadGate;
        }
      })
    );
    const overview = rpcGetCurrentOrganizationAgentRuntimeOverview(env, {
      includeUsageLimits,
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });
    let response: Awaited<typeof overview>;
    try {
      await Promise.race([
        bindingReadStarted,
        overview.then(() => {
          throw new Error("The expected native Binding preload did not start.");
        }),
      ]);
      expect(lookupRoutes).toHaveBeenCalledOnce();
      expect(lookupOwnerService).toHaveBeenCalledOnce();
    } finally {
      releaseBindingRead();
      try {
        response = await overview;
      } finally {
        organizationPostgresObservers.set(fixture.binding, fixture.db);
      }
    }

    expect(response.agentProfiles.map((profile) => profile.profileId)).toEqual([
      AGENT_PROFILE_ID,
      SECOND_AGENT_PROFILE_ID,
    ]);
    for (const profile of response.agentProfiles) {
      expect(profile.readiness.usageLimits).toEqual(
        includeUsageLimits ? usageLimits : undefined
      );
    }
    expect(response.agentProfiles[0]).toMatchObject({
      operationalContext: { status: "working" },
      readiness: {
        agentExecutionReadiness: { displayState: "not_ready" },
        agentWakeAvailability: { category: "unavailable" },
      },
    });
    expect(lookupRoutes).toHaveBeenCalledOnce();
    expect(lookupRoutes).toHaveBeenCalledWith({
      blockForgottenDevices: true,
      env,
      ownerUserId: "user-a",
      profileIds: [AGENT_PROFILE_ID, SECOND_AGENT_PROFILE_ID],
    });
    expect(lookupOwnerService).toHaveBeenCalledOnce();
    expect(resolveProfileById).not.toHaveBeenCalled();
    expect(resolveProfilesByIds).toHaveBeenCalledExactlyOnceWith({
      profileIds: [AGENT_PROFILE_ID, SECOND_AGENT_PROFILE_ID],
    });
  });

  it("keeps quota numbers of another member's Agents owner-only", async () => {
    const readUsage = vi
      .spyOn(agentProfileUsage, "readAgentProfileUsage")
      .mockResolvedValue([
        {
          key: "weekly",
          label: "Weekly usage",
          status: "available" as const,
          usedPercent: 92,
          resetsAt: "2026-09-22T00:00:00Z",
          observedAt: "2026-09-15T00:00:00Z",
        },
      ]);
    const env = await buildEnv({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      authWorker: {
        resolveProfileById: vi.fn(),
        resolveProfilesByIds: vi.fn(
          async (input: { profileIds: string[] }) => ({
            ok: true as const,
            profiles: Object.fromEntries(
              input.profileIds.map((profileId) => [
                profileId,
                {
                  ownerUserId: "user-a",
                  profileKind: "agent" as const,
                  profileId,
                  profileName: "Codex",
                  profileHandle: "codex",
                  status: "active" as const,
                  defaultProjectId: null,
                },
              ])
            ),
          })
        ),
      },
      members: [
        memberRow("member-a", "org-a", "user-a"),
        memberRow("member-b", "org-a", "user-b"),
      ],
    });
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportRoutesBatch"
    ).mockResolvedValue({
      routes: {
        [AGENT_PROFILE_ID]: {
          online: false,
          reasonCode: "daemon.profile.offline",
        },
      },
    });
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportOwnerService"
    ).mockResolvedValue({
      online: false,
      reasonCode: "daemon.session.not_found",
    });
    vi.spyOn(
      runtimeTransportClient,
      "readRuntimeTransportAgentProfileOperationalContexts"
    ).mockResolvedValue({ contexts: [] });

    const colleagueView = await rpcGetCurrentOrganizationAgentRuntimeOverview(
      env,
      {
        includeUsageLimits: true,
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-b",
        }),
      }
    );
    expect(colleagueView.agentProfiles.map((agent) => agent.profileId)).toEqual(
      [AGENT_PROFILE_ID]
    );
    expect(colleagueView.agentProfiles[0]?.readiness).not.toHaveProperty(
      "usageLimits"
    );

    const ownerView = await rpcGetCurrentOrganizationAgentRuntimeOverview(env, {
      includeUsageLimits: true,
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });
    expect(ownerView.agentProfiles[0]?.readiness.usageLimits).toHaveLength(1);
    expect(readUsage).toHaveBeenCalledOnce();
  });

  it("does not reload the runtime catalog to check Organization Agent readiness", async () => {
    const profiles = [
      {
        organizationId: "org-a",
        ownerUserId: "user-a",
        profileHandle: "codex",
        profileId: AGENT_PROFILE_ID,
        profileName: "Codex",
        status: "active" as const,
      },
      {
        organizationId: "org-a",
        ownerUserId: "user-a",
        profileHandle: "reviewer",
        profileId: SECOND_AGENT_PROFILE_ID,
        profileName: "Reviewer",
        status: "active" as const,
      },
    ];
    const db = await createOrganizationRpcDb({
      agentProfiles: profiles,
      members: [memberRow("member-a", "org-a", "user-a")],
    });
    for (const profile of profiles) {
      await db.bindingRows.set(
        bindingKey("owner_account", "user-a", profile.profileId),
        agentProfileBindingTestRow({
          agentProfileId: profile.profileId,
          bindingId: `binding-${profile.profileId}`,
          openMeldServiceRuntimeId: "runtime-user-a",
          ownerId: "user-a",
        })
      );
    }
    const env = await buildEnv({ db });
    const localWakeRouteReport = {
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      expectedRoutesContractVersion: "v4" as const,
      includedProfileIds: profiles.map((profile) => profile.profileId),
      lane: "dev-local" as const,
      reportedAtMs: Date.parse("2026-07-08T00:00:00.000Z"),
      skippedProfiles: [],
      workingFolderObservations: profiles.map((profile) => ({
        bindingId: `binding-${profile.profileId}`,
        configurationRevision: 1,
        defaultProjectId: null,
        localProjectBindingGeneration: null,
        observedAtMs: Date.parse("2026-07-08T00:00:00.000Z"),
        profileId: profile.profileId,
        reasonCode: null,
        source: "profile_workspace" as const,
        status: "ready" as const,
      })),
    };
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportRoutesBatch"
    ).mockResolvedValue({
      routes: Object.fromEntries(
        profiles.map((profile) => [
          profile.profileId,
          {
            capabilities: {},
            connectionGeneration: 1,
            daemonSessionId: "daemon-session-1",
            deviceId: "device-1",
            executionCompatibility: {
              expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
              observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
              reasonCode: "daemon.runtime_contract.compatible" as const,
              status: "compatible" as const,
            },
            lane: "dev-local" as const,
            lastHeartbeatMs: Date.parse("2026-07-08T00:00:00.000Z"),
            leaseEpoch: 1,
            localWakeRouteReport,
            online: true as const,
            serviceVersion: "999.0.0",
          },
        ])
      ),
    });
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportOwnerService"
    ).mockResolvedValue({
      online: false,
      reasonCode: "daemon.session.not_found",
    });
    vi.spyOn(
      runtimeTransportClient,
      "readRuntimeTransportAgentProfileOperationalContexts"
    ).mockResolvedValue({ contexts: [] });
    const readExpectedRoutes = vi.spyOn(
      localRuntimeExpectedRoutesService,
      "readLocalRuntimeExpectedRoutes"
    );

    const response = await rpcGetCurrentOrganizationAgentRuntimeOverview(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });

    expect(response.agentProfiles).toHaveLength(2);
    expect(readExpectedRoutes).not.toHaveBeenCalled();
  });

  it("keeps owner readiness details while sharing only the allowlisted Usage fact with another active member", async () => {
    const env = await buildEnv({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      members: [
        memberRow("member-a", "org-a", "user-a", "owner"),
        memberRow("member-b", "org-a", "user-b", "member"),
      ],
      authWorker: {
        resolveProfilesByIds: vi.fn().mockResolvedValue({
          ok: true,
          profiles: {
            [AGENT_PROFILE_ID]: {
              ownerUserId: "user-a",
              profileHandle: "codex",
              profileId: AGENT_PROFILE_ID,
              profileKind: "agent",
              profileName: "Codex",
              status: "active",
            },
          },
        }),
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: {
            ownerUserId: "user-a",
            profileHandle: "codex",
            profileId: AGENT_PROFILE_ID,
            profileKind: "agent",
            profileName: "Codex",
            status: "active",
          },
        }),
      },
    });

    const ownerDirectory = await rpcGetCurrentOrganizationDirectory(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });
    const memberDirectory = await rpcGetCurrentOrganizationDirectory(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-b",
      }),
    });
    const ownerReadiness = ownerDirectory.agentProfiles[0]?.readiness;
    const memberReadiness = memberDirectory.agentProfiles[0]?.readiness;

    expect(ownerReadiness).toMatchObject({
      agentControllerRef: "builtin:codex",
      ownerUserId: "user-a",
      primaryBinding: {
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: `binding-${AGENT_PROFILE_ID}`,
      },
      profileName: "Codex",
      publicProfileConfiguration: {
        agentControllerRef: "builtin:codex",
      },
    });
    expect(memberReadiness?.agentWakeAvailability).toMatchObject({
      action: "none",
      category: ownerReadiness?.agentWakeAvailability.category,
      reasonCode: null,
      status: ownerReadiness?.agentWakeAvailability.status,
    });
    expect(memberReadiness).toMatchObject({
      agentControllerRef: null,
      agentExecutionReadiness: {
        facts: {
          binding: {
            reasonCodes: [],
            routable: false,
            source: "not_checked",
          },
          claim: {
            executionBlocked: false,
            grantsClaimSuccess: false,
            reasonCodes: [],
            source: "not_checked",
          },
          localService: {
            reachable: false,
            reasonCodes: [],
            refreshable: false,
            source: "not_checked",
          },
          profile: {
            active: false,
            reasonCodes: [],
            source: "not_checked",
          },
          providerAccount: {
            blocked: false,
            expiresAtMs: null,
            observedAtMs: null,
            provider: null,
            reasonCodes: [],
            source: "not_checked",
          },
          providerConversation: {
            agentControllerConversationId: null,
            errorCode: null,
            errorMessage: null,
            errorType: null,
            expiresAtMs: null,
            method: null,
            observedAtMs: null,
            provider: null,
            ready: false,
            reasonCodes: [],
            required: false,
            source: "unavailable",
            status: "unavailable",
          },
          readinessImpact: {
            blocked: false,
            expiresAtMs: null,
            impactKind: null,
            observedAtMs: null,
            reasonCodes: [],
            source: "not_checked",
          },
          route: {
            deviceId: null,
            lane: null,
            observedAt: null,
            online: false,
            reasonCodes: [],
            source: "not_checked",
          },
          runtime: {
            ready: false,
            reasonCodes: [],
            source: "not_checked",
          },
          service: {
            executionCompatible: false,
            observedEpoch: null,
            reasonCodes: [],
            source: "not_checked",
          },
        },
        primaryAction: "none",
        reasonCodes: [],
      },
      publicProfileConfiguration: {
        agentControllerRef: "builtin:codex",
      },
      agentWakeRouteRegistration: {
        daemonSessionId: null,
        deviceId: null,
        lane: null,
        reasonCode: null,
        reportedAtMs: null,
        serviceVersion: null,
        status: "unavailable",
      },
      ownerUserId: null,
      primaryActionPlan: { action: "none", target: null },
      primaryBinding: null,
      profileName: null,
      routeDeviceId: null,
      routeLane: null,
      runtimeDeviceDisplayName: null,
      wakeRouteEvidence: {
        reasonCode: "not_requested",
        status: "unavailable",
      },
      wakeRouteStatus: { status: "unavailable" },
    });

    const privateOwnerReadiness = structuredClone(ownerReadiness);
    if (!privateOwnerReadiness) {
      throw new Error("owner readiness fixture was not returned");
    }
    privateOwnerReadiness.agentExecutionReadiness.facts.providerAccount = {
      blocked: true,
      expiresAtMs: 1_800_000_000_000,
      observedAtMs: 1_790_000_000_000,
      provider: "codex",
      reasonCodes: ["provider.account.private"],
      source: "wake_failure",
    };
    privateOwnerReadiness.agentExecutionReadiness.facts.providerConversation = {
      agentControllerConversationId: "conversation-private",
      errorCode: "provider.private_error",
      errorMessage: "Private provider failure details",
      errorType: "provider.private_type",
      expiresAtMs: 1_800_000_000_000,
      method: "codex_app_server_thread_resume",
      observedAtMs: 1_790_000_000_000,
      provider: "codex",
      ready: false,
      reasonCodes: ["provider.conversation.private"],
      required: true,
      source: "runtime_reporting",
      status: "failed",
    };
    privateOwnerReadiness.agentExecutionReadiness.facts.readinessImpact = {
      blocked: true,
      expiresAtMs: 1_800_000_000_000,
      impactKind: "local_execution",
      observedAtMs: 1_790_000_000_000,
      reasonCodes: ["readiness.impact.private"],
      source: "wake_failure",
    };
    privateOwnerReadiness.agentExecutionReadiness.facts.route = {
      deviceId: "device-private",
      lane: "dev-local",
      observedAt: "2026-07-08T00:00:00.000Z",
      online: true,
      reasonCodes: ["route.private"],
      source: "daemon_route",
    };
    privateOwnerReadiness.agentExecutionReadiness.facts.service = {
      ...privateOwnerReadiness.agentExecutionReadiness.facts.service,
      executionCompatible: false,
      observedEpoch: "private-service-epoch",
      reasonCodes: ["service.private"],
      source: "runtime_transport",
    };
    privateOwnerReadiness.agentExecutionReadiness.facts.runtime = {
      ready: false,
      reasonCodes: ["runtime.private"],
      source: "prepare_readiness",
    };
    privateOwnerReadiness.agentExecutionReadiness.primaryAction =
      "fix_provider_account";
    privateOwnerReadiness.agentExecutionReadiness.reasonCodes = [
      "readiness.private",
    ];
    privateOwnerReadiness.agentWakeAvailability = {
      action: "fix_provider_account",
      badgeLabel: "Private provider state",
      category: "unavailable",
      isRefreshing: false,
      label: "Private provider repair",
      phase: "provider_blocked",
      reasonCode: "provider.private",
      status: "unavailable_for_wake",
      summary: "Private provider repair summary",
      tooltip: "Private provider repair tooltip",
    };
    privateOwnerReadiness.agentWakeRouteRegistration = {
      daemonSessionId: "daemon-session-private",
      deviceId: "device-private",
      lane: "dev-local",
      reasonCode: "registration.private",
      reportedAtMs: 1_790_000_000_000,
      serviceVersion: "private-service-version",
      status: "registered",
    };
    privateOwnerReadiness.primaryActionPlan = {
      action: "fix_provider_account",
      target: { kind: "provider_account", provider: "codex" },
    };
    privateOwnerReadiness.routeDeviceId = "device-private";
    privateOwnerReadiness.routeLane = "dev-local";
    privateOwnerReadiness.runtimeDeviceDisplayName = "Private computer";
    privateOwnerReadiness.wakeRouteEvidence = {
      observedAt: "2026-07-08T00:00:00.000Z",
      reasonCode: "online",
      status: "online",
    };
    privateOwnerReadiness.wakeRouteStatus = {
      connectionGeneration: 7,
      daemonSessionId: "daemon-session-private",
      deviceId: "device-private",
      lane: "dev-local",
      lastHeartbeatMs: 1_790_000_000_000,
      leaseEpoch: 3,
      status: "ready",
    };

    const projectedReadiness = projectTeamSafeOrganizationDirectoryReadiness(
      privateOwnerReadiness
    );
    const serializedProjection = JSON.stringify(projectedReadiness);
    expect(projectedReadiness.agentWakeAvailability).toMatchObject({
      action: "none",
      category: "unavailable",
      phase: "unavailable",
      reasonCode: null,
      status: "unavailable_for_wake",
    });
    expect(projectedReadiness.publicProfileConfiguration).toMatchObject({
      agentControllerRef: "builtin:codex",
    });
    expect(serializedProjection).not.toContain("private");
    expect(serializedProjection).not.toContain("binding-");
    expect(serializedProjection).not.toContain("user-a");

    const usageExhaustedOwnerReadiness = structuredClone(privateOwnerReadiness);
    usageExhaustedOwnerReadiness.agentWakeAvailability.reasonCode =
      "usage_exhausted";
    const usageExhaustedProjection =
      projectTeamSafeOrganizationDirectoryReadiness(
        usageExhaustedOwnerReadiness
      );
    expect(usageExhaustedProjection.agentWakeAvailability).toMatchObject({
      action: "none",
      badgeLabel: "Unavailable",
      category: "unavailable",
      label: "Usage Limit reached",
      phase: "unavailable",
      reasonCode: "usage_exhausted",
      status: "unavailable_for_wake",
      summary: "This Agent reached a Usage Limit and cannot start new work.",
      tooltip: "Usage Limit reached",
    });
    expect(
      usageExhaustedProjection.agentExecutionReadiness.reasonCodes
    ).toEqual([]);
    expect(JSON.stringify(usageExhaustedProjection)).not.toContain("private");
  });

  it("pages the narrow Center Agent member list without resolving Agent Profiles", async () => {
    const resolveAgentProfiles = vi.fn(() =>
      Promise.reject(
        new Error("The narrow member list must not resolve Agent Profiles.")
      )
    );
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-b", "org-a", "user-b"),
        memberRow("member-a", "org-a", "user-a", "owner"),
      ],
    });
    const env = await buildEnv({
      authWorker: {
        resolveOrganizationDirectoryAgentProfiles: resolveAgentProfiles,
      },
      db,
    });
    const context = buildCenterAgentContext({
      activeOrganizationId: "org-a",
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      userId: "user-a",
    });

    const firstPage = await rpcCenterAgentListOrganizationMembers(env, {
      context,
      limit: 1,
    });
    expect(firstPage).toMatchObject({
      organizationId: "org-a",
      totalMembers: 2,
    });
    expect(firstPage.members.map((member) => member.user.name)).toEqual([
      "Ava",
    ]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(firstPage).not.toHaveProperty("agentProfiles");

    const secondPage = await rpcCenterAgentListOrganizationMembers(env, {
      context,
      cursor: firstPage.nextCursor ?? undefined,
      limit: 1,
    });
    expect(secondPage.members.map((member) => member.user.name)).toEqual([
      "Ben",
    ]);
    expect(secondPage.nextCursor).toBeNull();
    expect(resolveAgentProfiles).not.toHaveBeenCalled();
    expect(
      (await db.readCenterAgentAuditRows()).map((row) => row.action)
    ).toEqual(["read_org_directory", "read_org_directory"]);
  });

  it("omits Organization member activity unless the caller opts in", async () => {
    const env = await buildEnv({
      agentProfiles: [],
      members: [memberRow("member-a", "org-a", "user-a")],
      memberActivities: [
        {
          humanProfileId: HUMAN_PROFILE_ID,
          lastActiveAtMs: Date.parse("2026-07-07T23:45:00.000Z"),
          organizationId: "org-a",
          userId: "user-a",
        },
      ],
    });

    const response = await rpcGetCurrentOrganizationDirectory(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });

    expect(response.members[0]).not.toHaveProperty("lastActiveAt");
  });

  it("records explicit Web use as the signed-in Human member's latest activity", async () => {
    const memberActivities: Array<{
      humanProfileId: string;
      lastActiveAtMs: number;
      organizationId: string;
      userId: string;
    }> = [];
    const db = await createOrganizationRpcDb({
      agentProfiles: [],
      memberActivities,
      members: [memberRow("member-a", "org-a", "user-a")],
    });
    const env = await buildEnv({ db });
    vi.spyOn(Date, "now").mockReturnValue(TEST_NOW_MS);

    const response = await rpcRecordCurrentOrganizationWebActivity(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });

    expect(response).toEqual({
      lastActiveAt: "2026-07-08T00:00:00.000Z",
      organizationId: "org-a",
      userId: "user-a",
    });
    expect(await organizationFixture(env).readMemberActivities()).toEqual([
      {
        humanProfileId: HUMAN_PROFILE_ID,
        lastActiveAtMs: TEST_NOW_MS,
        organizationId: "org-a",
        userId: "user-a",
      },
    ]);
  });

  it.each([
    "activity",
    "presence",
  ])("rejects Web %s from an Agent Profile without writing member activity", async (kind) => {
    const memberActivities: Array<{
      humanProfileId: string;
      lastActiveAtMs: number;
      organizationId: string;
      userId: string;
    }> = [];
    const env = await buildEnv({
      db: await createOrganizationRpcDb({
        agentProfiles: [],
        memberActivities,
        members: [memberRow("member-a", "org-a", "user-a")],
      }),
    });

    await expect(
      (kind === "activity"
        ? rpcRecordCurrentOrganizationWebActivity
        : rpcRecordCurrentOrganizationMemberPresence)(env, {
        report: {
          sessionId: "b6334814-cf7b-4aa3-8b60-5c2100b336db",
          sequence: 1,
          foreground: true,
          interaction: true,
        },
        context: buildContext({
          activeOrganizationId: "org-a",
          profileKind: "agent",
          userId: "user-a",
        }),
      })
    ).rejects.toMatchObject({
      code: "organization.context_required",
      status: 403,
    });
    expect(await organizationFixture(env).readMemberActivities()).toEqual([]);
  });

  it.each([
    "activity",
    "presence",
  ])("rejects Web %s when the selected Human Profile is not the member's current profile", async (kind) => {
    const memberActivities: Array<{
      humanProfileId: string;
      lastActiveAtMs: number;
      organizationId: string;
      userId: string;
    }> = [];
    const env = await buildEnv({
      db: await createOrganizationRpcDb({
        agentProfiles: [],
        memberActivities,
        members: [memberRow("member-a", "org-a", "user-a")],
      }),
    });

    await expect(
      (kind === "activity"
        ? rpcRecordCurrentOrganizationWebActivity
        : rpcRecordCurrentOrganizationMemberPresence)(env, {
        report: {
          sessionId: "b6334814-cf7b-4aa3-8b60-5c2100b336db",
          sequence: 1,
          foreground: true,
          interaction: true,
        },
        context: buildContext({
          activeOrganizationId: "org-a",
          profileId: SECOND_HUMAN_PROFILE_ID,
          userId: "user-a",
        }),
      })
    ).rejects.toMatchObject({
      code: "organization.context_unavailable",
      status: 409,
    });
    expect(await organizationFixture(env).readMemberActivities()).toEqual([]);
  });

  it("reads Auth-owned member activity from the single PostgreSQL database", async () => {
    const member = memberRow("member-a", "org-a", "user-a");
    const identityDb = await createOrganizationRpcDb({
      agentProfiles: [],
      memberActivities: [
        {
          humanProfileId: HUMAN_PROFILE_ID,
          lastActiveAtMs: Date.parse("2026-07-07T23:45:00.000Z"),
          organizationId: "org-a",
          userId: "user-a",
        },
      ],
      members: [member],
    });
    const env = await buildEnv({
      agentProfiles: [],
      db: identityDb,
      members: [member],
    });

    const response = await rpcGetCurrentOrganizationDirectory(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
      includeMemberLastActiveAt: true,
    });

    expect(response.members[0]?.lastActiveAt).toBe("2026-07-07T23:45:00.000Z");
  });

  it("fails closed when the Auth-owned member projection is unavailable", async () => {
    const env = await buildEnv({
      authWorker: { resolveOrganizationDirectoryMembers: undefined },
      members: [memberRow("member-a", "org-a", "user-a")],
    });

    await expect(
      rpcGetCurrentOrganizationDirectory(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
      })
    ).rejects.toMatchObject({
      code: "organization.directory_unavailable",
      status: 503,
    });
  });

  it("reads only the designated Center Agent without member or unrelated runtime projections", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow(),
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "other",
          profileId: "agt_00000000-0000-4000-8000-000000000003",
          profileName: "Other",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const memberRead = vi.fn(() =>
      Promise.reject(new Error("Settings must not read the member directory."))
    );
    const env = await buildEnv({
      db,
      authWorker: { resolveOrganizationDirectoryMembers: memberRead },
    });
    const operationalReads = vi.spyOn(
      runtimeTransportClient,
      "readRuntimeTransportAgentProfileOperationalContexts"
    );
    const response = await rpcGetCurrentOrganizationDirectory(env, {
      centerAgentOnly: true,
      includeMemberLastActiveAt: true,
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });
    expect(response.members).toEqual([]);
    expect(response.agentProfiles.map((profile) => profile.profileId)).toEqual([
      AGENT_PROFILE_ID,
    ]);
    expect(response.agentProfiles[0]?.isCenterAgent).toBe(true);
    expect(
      response.agentProfiles[0]?.readiness.agentExecutionReadiness
        .agentProfileId
    ).toBe(AGENT_PROFILE_ID);
    expect(memberRead).not.toHaveBeenCalled();
    expect(operationalReads).not.toHaveBeenCalled();
  });

  it("fails closed when Auth returns Directory identity for another Organization", async () => {
    const env = await buildEnv({
      authWorker: {
        resolveOrganizationDirectoryMembers: vi.fn(async () => ({
          members: [],
          ok: true,
          organizationId: "org-b",
        })),
      },
      members: [memberRow("member-a", "org-a", "user-a")],
    });

    await expect(
      rpcGetCurrentOrganizationDirectory(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
      })
    ).rejects.toMatchObject({
      code: "organization.directory_unavailable",
      status: 503,
    });
  });

  it("fails closed when Auth injects an Agent Profile outside Core's authorized id set", async () => {
    const rogueProfile = {
      organizationId: "org-personal",
      ownerUserId: "user-a",
      profileHandle: "rogue",
      profileId: AGENT_PROFILE_ID,
      profileName: "Rogue",
      status: "active" as const,
    };
    const env = await buildEnv({
      authWorker: {
        resolveOrganizationDirectoryAgentProfiles: vi.fn(
          async (request: { organizationId: string }) => ({
            additionalAgentProfiles: [
              buildOrganizationDirectoryAgentProfileIdentity({
                members: [],
                profile: rogueProfile,
              }),
            ],
            ok: true,
            organizationAgentProfiles: [],
            organizationId: request.organizationId,
          })
        ),
      },
      members: [memberRow("member-a", "org-a", "user-a")],
    });

    await expect(
      rpcGetCurrentOrganizationDirectory(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
      })
    ).rejects.toMatchObject({
      code: "organization.directory_unavailable",
      status: 503,
    });
  });

  it("lets the designated Center Agent read one current member's coarse OpenMeld Service state", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-a", "org-a", "user-a", "owner"),
        memberRow("member-b", "org-a", "user-b"),
      ],
    });

    const env = await buildEnv({ db });
    const lookupOwnerService = vi
      .spyOn(runtimeTransportClient, "lookupRuntimeTransportOwnerService")
      .mockResolvedValue({
        online: false,
        reasonCode: "daemon.session.not_found",
      });

    await expect(
      rpcCenterAgentReadMemberOpenMeldServiceStatus(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        memberUserId: "user-b",
      })
    ).resolves.toMatchObject({
      member: {
        state: "not_connected",
        userId: "user-b",
      },
      organizationId: "org-a",
    });
    expect(lookupOwnerService).toHaveBeenCalledWith({
      blockForgottenDevices: true,
      env,
      ownerUserId: "user-b",
    });
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "read_member_openmeld_service_status",
        actorProfileId: AGENT_PROFILE_ID,
        organizationId: "org-a",
        resourceId: "user-b",
        resourceType: "organization_member",
      }),
    ]);
    const memberContext = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });
    await expect(
      rpcListCenterAgentAuditJournal(env, {
        actionSet: "v11",
        context: memberContext,
      })
    ).resolves.toEqual({ entries: [], organizationId: "org-a" });
    await expect(
      rpcListCenterAgentAuditJournal(env, {
        actionSet: "v12",
        context: memberContext,
      })
    ).resolves.toMatchObject({
      entries: [
        expect.objectContaining({
          action: "read_member_openmeld_service_status",
        }),
      ],
      organizationId: "org-a",
    });
  });

  it("uses only the freshest session for each member device and lane", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-a", "org-a", "user-a", "owner"),
        memberRow("member-b", "org-a", "user-b"),
      ],
      ownedDevices: [
        {
          deviceId: "device-b",
          firstSeenAtMs: 1000,
          lastObservedAtMs: 2000,
          observedDisplayName: "Teammate Mac",
          ownerUserId: "user-b",
          updatedAtMs: 2000,
        },
      ],
    });
    const env = await buildEnv({ db });
    const lookupOwnerService = vi
      .spyOn(runtimeTransportClient, "lookupRuntimeTransportOwnerService")
      .mockResolvedValue({
        online: true,
        sessions: [
          {
            capabilities: {},
            connectionGeneration: 2,
            daemonSessionId: "session-current",
            deviceId: "device-b",
            executionCompatibility: {
              expectedEpoch: "runtime-contract-v2",
              observedEpoch: "runtime-contract-v1",
              reasonCode: "daemon.runtime_contract.mismatch",
              status: "update_required",
            },
            lane: "prod",
            lastHeartbeatMs: 2000,
            serviceVersion: "0.3.65",
          },
          {
            capabilities: {},
            connectionGeneration: 1,
            daemonSessionId: "session-replaced",
            deviceId: "device-b",
            executionCompatibility: {
              expectedEpoch: "runtime-contract-v1",
              observedEpoch: "runtime-contract-v1",
              reasonCode: "daemon.runtime_contract.compatible",
              status: "compatible",
            },
            lane: "prod",
            lastHeartbeatMs: 1000,
            serviceVersion: "0.3.64",
          },
        ],
      });

    await expect(
      rpcCenterAgentReadMemberOpenMeldServiceStatus(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        memberUserId: "user-b",
      })
    ).resolves.toMatchObject({
      member: {
        state: "needs_attention",
        userId: "user-b",
      },
      organizationId: "org-a",
    });
    await expect(
      rpcGetCurrentOrganizationComputers(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          profileId: "00000000-0000-4000-8000-000000000001",
          profileKind: "human",
          userId: "user-a",
        }),
      })
    ).resolves.toMatchObject({
      computers: [
        expect.objectContaining({
          ownerUserId: "user-b",
          serviceState: "needs_attention",
        }),
      ],
      organizationId: "org-a",
    });
    expect(
      lookupOwnerService.mock.calls.every(
        ([request]) => request.ownerUserId === "user-b"
      )
    ).toBe(true);
  });

  it("lists computer setup context for the verified represented member", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-a", "org-a", "user-a", "owner"),
        memberRow("member-b", "org-a", "user-b"),
      ],
    });
    const env = await buildEnv({ db });
    const listLocalRuntimes = vi
      .spyOn(currentDeviceTargetService, "listLocalRuntimesUseCase")
      .mockResolvedValue({
        currentConnectedComputerId: null,
        currentDeviceId: null,
        currentRuntimeLane: null,
        legacyDeviceEvidence: [],
        localRuntimes: [],
      });

    await expect(
      rpcCenterAgentListComputers(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        speakerMember: { memberId: "member-b", userId: "user-b" },
      })
    ).resolves.toEqual({
      computers: [],
      organizationId: "org-a",
    });
    expect(listLocalRuntimes).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-b" })
    );
    expect(listLocalRuntimes.mock.calls[0]?.[0]).not.toHaveProperty(
      "connectionIdentityAdoption"
    );
  });

  it("includes owner-only Computer diagnostics only when the verified requester asks for them", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-a", "org-a", "user-a", "owner"),
        memberRow("member-b", "org-a", "user-b"),
      ],
    });
    const env = await buildEnv({ db });
    const localRuntimes = {
      currentConnectedComputerId: null,
      currentDeviceId: null,
      currentRuntimeLane: null,
      legacyDeviceEvidence: [],
      localRuntimes: [],
    };
    vi.spyOn(
      currentDeviceTargetService,
      "listLocalRuntimesUseCase"
    ).mockResolvedValue(localRuntimes);
    vi.spyOn(
      currentDeviceTargetService,
      "getCurrentLocalRuntimeReplyReadinessUseCase"
    ).mockResolvedValue(createMissingCurrentComputerReadiness());

    await expect(
      rpcCenterAgentListComputers(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        includeDiagnostics: true,
        speakerMember: { memberId: "member-b", userId: "user-b" },
      })
    ).resolves.toEqual({
      computers: [],
      diagnostics: {
        currentComputerFileAccess: {
          code: "computer.current_missing",
          message: "No current Computer is connected to this account.",
          status: "unavailable",
        },
        currentLocalRuntimeReplyReadiness:
          createMissingCurrentComputerReadiness(),
        localRuntimes: {
          currentConnectedComputerId: null,
          currentDeviceId: null,
          currentRuntimeLane: null,
          localRuntimes: [],
        },
      },
      organizationId: "org-a",
    });
  });

  it("requires an explicit opt-in before owner diagnostics include usage limits", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const env = await buildEnv({ db });
    vi.spyOn(
      currentDeviceTargetService,
      "listLocalRuntimesUseCase"
    ).mockResolvedValue(createOwnerLocalRuntimesWithUsageLimits());
    vi.spyOn(
      currentDeviceTargetService,
      "getCurrentLocalRuntimeReplyReadinessUseCase"
    ).mockResolvedValue(createMissingCurrentComputerReadiness());
    const request = {
      context: buildCenterAgentContext({
        activeOrganizationId: "org-a",
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        profileId: AGENT_PROFILE_ID,
        profileKind: "agent" as const,
        userId: "user-a",
      }),
      includeDiagnostics: true,
      speakerMember: { memberId: "member-a", userId: "user-a" },
    };

    const legacyResponse = await rpcCenterAgentListComputers(env, request);
    expect(
      legacyResponse.diagnostics?.localRuntimes.localRuntimes[0]
        ?.executionTargets[0]?.capabilities[0]?.details
    ).not.toHaveProperty("usageLimits");

    const optedInResponse = await rpcCenterAgentListComputers(env, {
      ...request,
      includeUsageLimits: "true",
    });
    expect(
      optedInResponse.diagnostics?.localRuntimes.localRuntimes[0]
        ?.executionTargets[0]?.capabilities[0]?.details?.usageLimits
    ).toEqual([
      expect.objectContaining({
        key: "codex:primary",
        usedPercent: 62,
      }),
    ]);
  });

  it("reads one teammate's Computers through the existing team-safe projection", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-a", "org-a", "user-a", "owner"),
        memberRow("member-b", "org-a", "user-b"),
      ],
    });
    const env = await buildEnv({ db });
    const listComputers = vi
      .spyOn(organizationComputersService, "listOrganizationComputers")
      .mockResolvedValue({
        computers: [
          {
            computerId: "computer-b",
            deviceDisplayName: "Maya’s Mac",
            deviceType: "laptop",
            lastSeenAtMs: 1000,
            localAgents: [
              {
                agentControllerRef: "builtin:codex",
                details: {
                  capabilities: {
                    approvals: true,
                    cancel: true,
                    interrupt: true,
                    modelSelection: true,
                    nativeEventStream: true,
                    permissionModes: true,
                    structuredUserInput: false,
                  },
                  checkedAt: "2026-08-19T00:00:00.000Z",
                  launch: { installChoiceCount: 1, status: "ready" },
                  models: [{ displayName: "GPT-5.5" }],
                  nativeInterface: "codex-app-server",
                  status: "ready",
                  usageLimits: [
                    {
                      key: "codex:primary",
                      label: "5-hour usage",
                      observedAt: "2026-08-19T00:00:00.000Z",
                      resetsAt: "2026-08-19T05:00:00.000Z",
                      status: "available",
                      usedPercent: 63,
                    },
                  ],
                  version: "0.148.0",
                },
                enabled: true,
                status: "ready",
              },
            ],
            osVersion: "15.6",
            ownerUserId: "user-b",
            platformFamily: "macOS",
            serviceState: "connected",
          },
        ],
        generatedAt: "2026-08-19T00:00:00.000Z",
        organizationId: "org-a",
      });

    await expect(
      rpcCenterAgentReadMemberComputers(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        includeUsageLimits: "true",
        memberUserId: "user-b",
      })
    ).resolves.toMatchObject({
      computers: [
        expect.objectContaining({
          localAgents: [
            expect.objectContaining({
              details: expect.objectContaining({
                usageLimits: [
                  expect.objectContaining({
                    key: "codex:primary",
                    usedPercent: 63,
                  }),
                ],
              }),
            }),
          ],
          ownerUserId: "user-b",
        }),
      ],
      memberUserId: "user-b",
      organizationId: "org-a",
    });
    expect(listComputers).toHaveBeenCalledWith(
      expect.objectContaining({ memberUserIds: ["user-b"] })
    );
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "read_member_computers",
        resourceId: "user-b",
        resourceType: "organization_member",
      }),
    ]);
    const memberContext = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });
    await expect(
      rpcListCenterAgentAuditJournal(env, {
        actionSet: "v18",
        context: memberContext,
      })
    ).resolves.toEqual({ entries: [], organizationId: "org-a" });
    await expect(
      rpcListCenterAgentAuditJournal(env, {
        actionSet: "v19",
        context: memberContext,
      })
    ).resolves.toMatchObject({
      entries: [expect.objectContaining({ action: "read_member_computers" })],
      organizationId: "org-a",
    });
  });

  it("fails closed before listing computers for an unverified represented member", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const env = await buildEnv({ db });
    const listLocalRuntimes = vi.spyOn(
      currentDeviceTargetService,
      "listLocalRuntimesUseCase"
    );

    await expect(
      rpcCenterAgentListComputers(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        speakerMember: {
          memberId: "member-outside",
          userId: "user-outside",
        },
      })
    ).rejects.toMatchObject({
      code: "center_agent.computer_setup_speaker_required",
      status: 403,
    });
    expect(listLocalRuntimes).not.toHaveBeenCalled();
  });

  it("fails closed before reading Service state for a user outside the current Organization", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const env = await buildEnv({ db });
    const lookupOwnerService = vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportOwnerService"
    );

    await expect(
      rpcCenterAgentReadMemberOpenMeldServiceStatus(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        memberUserId: "user-outside-org",
      })
    ).rejects.toMatchObject({
      code: "center_agent.member_not_found",
      status: 404,
    });
    expect(lookupOwnerService).not.toHaveBeenCalled();
    expect(await db.readCenterAgentAuditRows()).toEqual([]);
  });

  it("fails closed before changing a Computer for a speaker outside the current Organization", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const env = await buildEnv({ db });
    const controlOpenMeldTools = vi.spyOn(
      runtimeTransportClient,
      "controlRuntimeTransportOpenMeldTools"
    );
    const manageInstallations = vi.spyOn(
      runtimeTransportClient,
      "manageRuntimeTransportLocalAgentInstallation"
    );
    const request = {
      context: buildCenterAgentContext({
        activeOrganizationId: "org-a",
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        profileId: AGENT_PROFILE_ID,
        profileKind: "agent" as const,
        userId: "user-a",
      }),
      speakerMember: {
        memberId: "member-outside",
        userId: "user-outside",
      },
    };

    await expect(
      rpcCenterAgentRequestOpenMeldToolsUpdate(env, request)
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      rpcCenterAgentSetOpenMeldToolsMaintenance(env, {
        ...request,
        automaticUpdatesEnabled: false,
      })
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      rpcCenterAgentListLocalAgentInstallations(env, {
        ...request,
        agentId: "codex",
      })
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      rpcCenterAgentSelectLocalAgentInstallation(env, {
        ...request,
        agentId: "codex",
        confirmed: true,
        installationId: "install-chatgpt",
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(controlOpenMeldTools).not.toHaveBeenCalled();
    expect(manageInstallations).not.toHaveBeenCalled();
  });

  it("fails closed before reading Computers for a user outside the current Organization", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const env = await buildEnv({ db });
    const listComputers = vi.spyOn(
      organizationComputersService,
      "listOrganizationComputers"
    );

    await expect(
      rpcCenterAgentReadMemberComputers(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        memberUserId: "user-outside-org",
      })
    ).rejects.toMatchObject({
      code: "center_agent.member_not_found",
      status: 404,
    });
    expect(listComputers).not.toHaveBeenCalled();
    expect(await db.readCenterAgentAuditRows()).toEqual([]);
  });

  it("reports unknown instead of fabricating an offline state when the member Service lookup fails", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-a", "org-a", "user-a", "owner"),
        memberRow("member-b", "org-a", "user-b"),
      ],
    });
    const env = await buildEnv({ db });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportOwnerService"
    ).mockRejectedValue(new Error("Runtime Transport unavailable"));

    await expect(
      rpcCenterAgentReadMemberOpenMeldServiceStatus(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        memberUserId: "user-b",
      })
    ).resolves.toMatchObject({
      member: {
        state: "unknown",
        userId: "user-b",
      },
      organizationId: "org-a",
    });
  });

  it("excludes personal Agent Profiles from another Organization even with legacy Wake Access", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-personal",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "planner",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Planner",
          status: "active",
        },
        {
          organizationId: "org-personal",
          ownerUserId: "user-a",
          profileHandle: "disabled",
          profileId: "agt_00000000-0000-4000-8000-000000000004",
          profileName: "Disabled",
          status: "disabled",
        },
      ],
      authorizations: [
        authorizationRow({
          agentProfileId: AGENT_PROFILE_ID,
          authorizedBy: "user-a",
          bindingId: `binding-${AGENT_PROFILE_ID}`,
          createdAtMs: 1_700_000_000_000,
          organizationId: "org-a",
        }),
        authorizationRow({
          agentProfileId: "agt_00000000-0000-4000-8000-000000000004",
          authorizedBy: "user-a",
          bindingId: "binding-agt_00000000-0000-4000-8000-000000000004",
          createdAtMs: 1_700_000_000_000,
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const env = await buildEnv({ db });

    const response = await rpcGetCurrentOrganizationDirectory(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });

    expect(
      response.agentProfiles.map((profile) => ({
        organizationId: profile.organizationId,
        profileId: profile.profileId,
      }))
    ).toEqual([
      { organizationId: "org-a", profileId: SECOND_AGENT_PROFILE_ID },
    ]);
  });

  it("excludes all personal Agent Profiles from another Organization even with legacy Wake Access", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-personal",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
        managedCenterAgentProfileRow({
          organizationId: "org-personal",
          profileId: SECOND_AGENT_PROFILE_ID,
        }),
      ],
      authorizations: [
        authorizationRow({
          agentProfileId: AGENT_PROFILE_ID,
          authorizedBy: "user-a",
          bindingId: `binding-${AGENT_PROFILE_ID}`,
          createdAtMs: 1_700_000_000_000,
          organizationId: "org-a",
        }),
        authorizationRow({
          agentProfileId: SECOND_AGENT_PROFILE_ID,
          authorizedBy: "user-a",
          bindingId: `binding-${SECOND_AGENT_PROFILE_ID}`,
          createdAtMs: 1_700_000_000_000,
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const env = await buildEnv({ db });

    const response = await rpcGetCurrentOrganizationDirectory(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });

    expect(response.agentProfiles).toEqual([]);
  });

  it("falls back to readable names for organization directory members with empty auth names", async () => {
    const env = await buildEnv({
      agentProfiles: [],
      members: [
        {
          ...memberRow("member-a", "org-a", "user-a"),
          userEmail: "github-oauth@example.com",
          userName: "",
        },
        {
          ...memberRow("member-b", "org-a", "user-b"),
          userEmail: "@example.com",
          userName: null as unknown as string,
        },
      ],
    });

    const response = await rpcGetCurrentOrganizationDirectory(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });

    expect(
      response.members.map((member) => ({
        name: member.user.name,
        userId: member.userId,
      }))
    ).toEqual([
      { userId: "user-a", name: "github-oauth" },
      { userId: "user-b", name: "Member" },
    ]);
  });

  it("designates the managed Center Agent profile and derives directory status from that designation", async () => {
    const agentProfiles = [
      {
        organizationId: "org-a",
        ownerUserId: null,
        profileHandle: "codex",
        profileId: AGENT_PROFILE_ID,
        profileName: "Codex",
        managedRole: "center_agent",
        status: "active" as const,
      },
      {
        organizationId: "org-a",
        ownerUserId: "user-a",
        profileHandle: "planner",
        profileId: SECOND_AGENT_PROFILE_ID,
        profileName: "Planner",
        status: "active" as const,
      },
    ];
    const db = await createOrganizationRpcDb({
      agentProfiles,
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const authWorker = {
      resolveProfilesByIds: vi.fn(
        async (request: { profileIds: string[] }) => ({
          ok: true,
          profiles: Object.fromEntries(
            request.profileIds.map((profileId) => {
              const profile = agentProfiles.find(
                (item) => item.profileId === profileId
              );
              return [
                profileId,
                profile
                  ? {
                      ownerUserId: profile.ownerUserId,
                      profileHandle: profile.profileHandle,
                      profileId: profile.profileId,
                      profileKind: "agent",
                      profileName: profile.profileName,
                      status: profile.status,
                    }
                  : null,
              ];
            })
          ),
        })
      ),
      resolveProfileById: vi.fn(
        (input: { openMeldProfileId?: string | null }) => {
          const profile = agentProfiles.find(
            (item) => item.profileId === input.openMeldProfileId
          );
          return Promise.resolve(
            profile
              ? {
                  ok: true,
                  profile: {
                    ownerUserId: profile.ownerUserId,
                    profileHandle: profile.profileHandle,
                    profileId: profile.profileId,
                    profileKind: "agent" as const,
                    profileName: profile.profileName,
                    status: profile.status,
                  },
                }
              : {
                  ok: false,
                  code: "profile.not_found",
                  message: "Profile not found.",
                }
          );
        }
      ),
    };
    const env = await buildEnv({
      authWorker,
      db,
      remoteAgentWorker: { submitConversationTurn: vi.fn() },
      remoteAgentRuntimeEnabled: "true",
    });
    const ownerContext = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });

    await expect(
      rpcDesignateCenterAgent(env, {
        agentProfileId: AGENT_PROFILE_ID,
        context: ownerContext,
        runtime: "remote_agent",
      })
    ).resolves.toMatchObject({
      designation: { agentProfileId: AGENT_PROFILE_ID, duty: null },
      status: "designated",
    });
    await expect(
      rpcDesignateCenterAgent(env, {
        agentProfileId: SECOND_AGENT_PROFILE_ID,
        context: ownerContext,
        runtime: "remote_agent",
      })
    ).rejects.toMatchObject({
      code: "center_agent.profile_invalid",
    });

    expect([...(await db.centerAgentDesignations.values())]).toHaveLength(1);
    await expect(
      rpcGetCenterAgentDesignation(env, { context: ownerContext })
    ).resolves.toMatchObject({
      designation: { agentProfileId: AGENT_PROFILE_ID, duty: null },
      organizationId: "org-a",
    });

    const directory = await rpcGetCurrentOrganizationDirectory(env, {
      context: ownerContext,
    });
    const centerAgentProfile = directory.agentProfiles.find(
      (profile) => profile.profileId === AGENT_PROFILE_ID
    );
    const ordinaryProfile = directory.agentProfiles.find(
      (profile) => profile.profileId === SECOND_AGENT_PROFILE_ID
    );
    expect(centerAgentProfile).toMatchObject({
      isCenterAgent: true,
      readiness: {
        agentWakeAvailability: {
          badgeLabel: "Available",
        },
      },
    });
    expect(ordinaryProfile).toMatchObject({
      isCenterAgent: false,
    });
  });

  it("rejects direct local-agent-backed Center Agent designation while the hosted feature bar is pending", async () => {
    const env = await buildEnv({
      agentProfiles: [managedCenterAgentProfileRow()],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      remoteAgentRuntimeEnabled: "true",
    });

    await expect(
      rpcDesignateCenterAgent(env, {
        agentProfileId: AGENT_PROFILE_ID,
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        runtime: "self_hosted",
      })
    ).rejects.toMatchObject({
      code: "center_agent.local_runtime_hidden",
      status: 403,
    });
  });

  it("returns designation_not_ready when the written Center Agent designation is not visible to dispatch", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow(),
        {
          organizationId: "org-a",
          ownerUserId: "user-b",
          profileHandle: "other-agent",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Other Agent",
          status: "active",
          hasBinding: false,
        },
      ],
      centerAgentDesignationReadbackRace: centerAgentDesignationRow({
        agentProfileId: SECOND_AGENT_PROFILE_ID,
        designatedBy: "user-a",
        organizationId: "org-a",
      }),
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const env = await buildEnv({ db, remoteAgentRuntimeEnabled: "true" });

    await expect(
      rpcDesignateCenterAgent(env, {
        agentProfileId: AGENT_PROFILE_ID,
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        runtime: "remote_agent",
      })
    ).rejects.toMatchObject({
      code: "center_agent.designation_not_ready",
      status: 409,
    });
    expect(
      (await db.centerAgentDesignations.get("org-a"))?.agentProfileId
    ).toBe(SECOND_AGENT_PROFILE_ID);
  });

  it("rejects an ordinary Agent Profile with Organization Wake Access as Center Agent", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-personal",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      authorizations: [
        authorizationRow({
          agentProfileId: AGENT_PROFILE_ID,
          authorizedBy: "user-a",
          bindingId: `binding-${AGENT_PROFILE_ID}`,
          createdAtMs: 1_700_000_000_000,
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-personal", "org-personal", "user-a", "owner"),
        memberRow("member-a", "org-a", "user-a", "owner"),
      ],
    });
    const env = await buildEnv({ db, remoteAgentRuntimeEnabled: "true" });
    const ownerContext = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });

    await expect(
      rpcDesignateCenterAgent(env, {
        agentProfileId: AGENT_PROFILE_ID,
        context: ownerContext,
        runtime: "remote_agent",
      })
    ).rejects.toMatchObject({
      code: "center_agent.profile_invalid",
    });
  });

  it("projects Remote Agent runtime as selectable when the global switch is on", async () => {
    const env = await buildEnv({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      remoteAgentRuntimeEnabled: "true",
    });

    const response = await rpcGetCenterAgentDesignation(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });

    expect(response.remoteRuntimeAvailability).toEqual({ selectable: true });
  });

  it("projects Remote Agent runtime as not selectable for blocked Organizations", async () => {
    const env = await buildEnv({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      remoteAgentBlockedOrganizationIds: "org-a",
      remoteAgentRuntimeEnabled: "true",
    });

    const response = await rpcGetCenterAgentDesignation(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });

    expect(response.remoteRuntimeAvailability).toEqual({
      selectable: false,
      reasonCode: "organization_blocked",
    });
  });

  it("projects Remote Agent runtime as not selectable when the global switch is off", async () => {
    const env = await buildEnv({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      remoteAgentRuntimeEnabled: "false",
    });

    const response = await rpcGetCenterAgentDesignation(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });

    expect(response.remoteRuntimeAvailability).toEqual({
      selectable: false,
      reasonCode: "remote_runtime_disabled",
    });
  });

  it("fails closed when the Remote Agent runtime policy cannot be evaluated", async () => {
    const env = await buildEnv({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      remoteAgentRuntimeEnabled: "true",
    });
    Object.defineProperty(env, "OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED", {
      get: () => {
        throw new Error("policy source unavailable");
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const response = await rpcGetCenterAgentDesignation(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
      });

      expect(response.remoteRuntimeAvailability).toEqual({
        selectable: false,
        reasonCode: "remote_runtime_policy_unavailable",
      });
      expect(warn).toHaveBeenCalledWith(
        "[core.center_agent.remote_runtime_policy_projection_failed]",
        expect.objectContaining({ organizationId: "org-a" })
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("designates Remote Agent by writing a hosted Binding without retired Wake authorization", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          managedRole: "center_agent",
          status: "active",
        },
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const env = await buildEnv({
      db,
      remoteAgentRuntimeEnabled: "true",
    });
    const ownerContext = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });

    await expect(
      rpcDesignateCenterAgent(env, {
        agentProfileId: AGENT_PROFILE_ID,
        context: ownerContext,
        runtime: "remote_agent",
      })
    ).resolves.toMatchObject({
      designation: { agentProfileId: AGENT_PROFILE_ID, duty: null },
      organizationId: "org-a",
      status: "designated",
    });

    expect([...(await db.bindingRows.values())]).toEqual([
      expect.objectContaining({
        agentControllerConversationId: null,
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        agentProfileId: AGENT_PROFILE_ID,
        bindingState: "enabled_primary",
        hostedRuntimeIdentityJson: JSON.stringify(
          HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
        ),
        ownerId: "org-a",
        ownerKind: "organization",
        runtimeKind: "hosted_center_agent",
        openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
      }),
    ]);
    expect(
      (await db.readCenterAgentAuditRows()).map((row) => row.action)
    ).toEqual(["designate_remote_center_agent"]);
  });

  it("pauses only Remote Agent designation behind the rollout gate", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({ organizationId: "org-a" }),
      ],
      members: [memberRow("member-owner", "org-a", "owner-user", "owner")],
    });

    await expect(
      rpcDesignateCenterAgent(
        await buildEnv({
          db,
          remoteAgentDesignationEnabled: "false",
          remoteAgentRuntimeEnabled: "true",
        }),
        {
          agentProfileId: AGENT_PROFILE_ID,
          context: buildContext({
            activeOrganizationId: "org-a",
            userId: "owner-user",
          }),
          runtime: "remote_agent",
        }
      )
    ).rejects.toMatchObject({
      code: "center_agent.remote_designation_paused",
      status: 503,
    });
    expect(db.bindingWriteEvents).toEqual([]);
    expect(await db.readCenterAgentAuditRows()).toEqual([]);
  });

  it("does not let lazy Center Agent setup bypass the rollout gate", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({ organizationId: "org-a" }),
      ],
      members: [
        memberRow("member-owner", "org-a", "owner-user", "owner"),
        memberRow("member-invitee", "org-a", "user-a", "member"),
      ],
      organizations: [
        {
          name: "Acme Labs",
          organizationId: "org-a",
          slug: "acme-labs",
        },
      ],
    });

    await expect(
      rpcOpenCenterAgentDirectMessageSpace(
        await buildEnv({
          db,
          remoteAgentDesignationEnabled: "false",
          remoteAgentRuntimeEnabled: "true",
        }),
        {
          context: buildContext({
            activeOrganizationId: "org-a",
            userId: "user-a",
          }),
        }
      )
    ).rejects.toMatchObject({
      code: "center_agent.remote_designation_paused",
      status: 503,
    });
    expect(db.bindingWriteEvents).toEqual([]);
    expect(await db.centerAgentDesignations.size()).toBe(0);
    expect(db.spaces).toEqual([]);
  });

  it("rejects unmigrated personal bindings without entering personal runtime admission", async () => {
    const ownerBindingKey = bindingKey(
      "owner_account",
      "owner-user",
      AGENT_PROFILE_ID
    );
    const ownerBinding: AgentProfileBindingTestRow = {
      agentControllerConversationId: "codex-session-1",
      agentControllerPermissionMode: "codex:fullAccess",
      agentControllerRef: "builtin:codex",
      agentProfileId: AGENT_PROFILE_ID,
      bindingId: "binding-owner-local",
      bindingState: "enabled_primary",
      configurationRevision: 2,
      createdAtMs: 1_700_000_000_000,
      createdByProfileId: HUMAN_PROFILE_ID,
      disabledAtMs: null,
      hostedRuntimeIdentityJson: null,
      modelId: "gpt-5.6-sol",
      openCodePermission: null,
      ownerId: "owner-user",
      ownerKind: "owner_account",
      reasonCode: null,
      reasoningLevel: "high",
      runtimeKind: "openmeld_service",
      updatedAtMs: 1_700_000_000_000,
      openMeldServiceRuntimeId: "runtime-owner",
    };
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({ organizationId: "org-a" }),
      ],
      legacyPersonalBindings: [ownerBinding],
      members: [
        memberRow("member-owner", "org-a", "owner-user", "owner"),
        memberRow("member-admin", "org-a", "admin-user", "admin"),
      ],
    });
    const acquireMutation = vi
      .spyOn(
        runtimeTransportClient,
        "acquireRuntimeTransportAgentProfileExecutionTargetMutation"
      )
      .mockResolvedValue({
        reasonCode: "runtime_coordinator.active_execution",
        status: "blocked",
      });
    const env = await buildEnv({ db, remoteAgentRuntimeEnabled: "true" });

    await expect(
      rpcDesignateCenterAgent(env, {
        agentProfileId: AGENT_PROFILE_ID,
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "admin-user",
        }),
        runtime: "remote_agent",
      })
    ).rejects.toMatchObject({
      code: "center_agent.binding_owner_invalid",
      status: 409,
    });
    expect(acquireMutation).not.toHaveBeenCalled();
    expect(await db.bindingRows.snapshot()).toEqual(
      new Map([[ownerBindingKey, ownerBinding]])
    );
    expect(await db.readCenterAgentAuditRows()).toEqual([]);
  });

  it("keeps an already-hosted Remote Agent designation idempotent during active work", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          ...managedCenterAgentProfileRow({ organizationId: "org-a" }),
          hasBinding: false,
        },
      ],
      members: [memberRow("member-owner", "org-a", "owner-user", "owner")],
    });
    await db.bindingRows.set(
      bindingKey("organization", "org-a", AGENT_PROFILE_ID),
      agentProfileBindingTestRow({
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        bindingId: "binding-hosted-current",
        hostedRuntimeIdentityJson: JSON.stringify(
          HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
        ),
        openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        ownerId: "org-a",
        ownerKind: "organization",
        runtimeKind: "hosted_center_agent",
      })
    );
    const acquireMutation = vi
      .spyOn(
        runtimeTransportClient,
        "acquireRuntimeTransportAgentProfileExecutionTargetMutation"
      )
      .mockResolvedValue({
        reasonCode: "runtime_coordinator.active_execution",
        status: "blocked",
      });

    await expect(
      rpcDesignateCenterAgent(
        await buildEnv({ db, remoteAgentRuntimeEnabled: "true" }),
        {
          agentProfileId: AGENT_PROFILE_ID,
          context: buildContext({
            activeOrganizationId: "org-a",
            userId: "owner-user",
          }),
          runtime: "remote_agent",
        }
      )
    ).resolves.toMatchObject({ status: "designated" });
    expect(acquireMutation).not.toHaveBeenCalled();
    expect(db.bindingWriteEvents).toEqual([]);
  });

  it("does not treat a corrupted hosted identity as an active-work no-op", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          ...managedCenterAgentProfileRow({ organizationId: "org-a" }),
          hasBinding: false,
        },
      ],
      members: [memberRow("member-owner", "org-a", "owner-user", "owner")],
    });
    await db.bindingRows.set(
      bindingKey("organization", "org-a", AGENT_PROFILE_ID),
      agentProfileBindingTestRow({
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        bindingId: "binding-hosted-corrupted",
        hostedRuntimeIdentityJson: JSON.stringify({
          ...HOSTED_CENTER_AGENT_RUNTIME_IDENTITY,
          logicalRuntimeId: "hosted:wrong",
        }),
        openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        ownerId: "org-a",
        ownerKind: "organization",
        runtimeKind: "hosted_center_agent",
      })
    );
    const acquireMutation = vi
      .spyOn(
        runtimeTransportClient,
        "acquireRuntimeTransportAgentProfileExecutionTargetMutation"
      )
      .mockResolvedValue({
        reasonCode: "runtime_coordinator.active_execution",
        status: "blocked",
      });

    await expect(
      rpcDesignateCenterAgent(
        await buildEnv({ db, remoteAgentRuntimeEnabled: "true" }),
        {
          agentProfileId: AGENT_PROFILE_ID,
          context: buildContext({
            activeOrganizationId: "org-a",
            userId: "owner-user",
          }),
          runtime: "remote_agent",
        }
      )
    ).rejects.toMatchObject({
      code: "center_agent.binding_owner_invalid",
      status: 409,
    });
    expect(acquireMutation).not.toHaveBeenCalled();
    expect(db.bindingWriteEvents).toEqual([]);
  });

  it("fails closed before admission or writes when Binding owner inventory exceeds the safety limit", async () => {
    const centerAgentAuditJournal: CenterAgentAuditJournalTestRow[] = [];
    const legacyPersonalBindings = Array.from(
      { length: MAX_ENABLED_PRIMARY_BINDING_OWNERS_PER_AGENT_PROFILE + 1 },
      (_, index) => {
        const ownerId = `legacy-owner-${index.toString().padStart(2, "0")}`;
        return agentProfileBindingTestRow({
          bindingId: `binding-${ownerId}`,
          ownerId,
        });
      }
    );
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          ...managedCenterAgentProfileRow({ organizationId: "org-a" }),
          hasBinding: false,
        },
      ],
      centerAgentAuditJournal,
      legacyPersonalBindings,
      members: [
        memberRow("member-owner", "org-a", "owner-user", "owner"),
        memberRow("member-admin", "org-a", "admin-user", "admin"),
      ],
    });
    const originalBindings = new Map(
      (await db.bindingRows.entries()).map(([key, binding]) => [
        key,
        { ...binding },
      ])
    );
    const acquireMutation = vi
      .spyOn(
        runtimeTransportClient,
        "acquireRuntimeTransportAgentProfileExecutionTargetMutation"
      )
      .mockResolvedValue({
        expiresAtMs: TEST_NOW_MS + 30_000,
        operationId: "operation-unexpected",
        status: "acquired",
      });

    await expect(
      rpcDesignateCenterAgent(
        await buildEnv({ db, remoteAgentRuntimeEnabled: "true" }),
        {
          agentProfileId: AGENT_PROFILE_ID,
          context: buildContext({
            activeOrganizationId: "org-a",
            userId: "admin-user",
          }),
          runtime: "remote_agent",
        }
      )
    ).rejects.toMatchObject({
      code: "center_agent.binding_owner_inventory_exceeded",
      status: 503,
    });
    expect(acquireMutation).not.toHaveBeenCalled();
    expect(await db.bindingRows.snapshot()).toEqual(originalBindings);
    expect(db.bindingWriteEvents).toEqual([]);
    expect(await db.authorizationRows.size()).toBe(0);
    expect(await db.readCenterAgentAuditRows()).toEqual([]);
  });

  it.each([
    {
      preference: {
        kind: "selected_model" as const,
        modelId: "deepseek/deepseek-v4-flash",
      },
      modelId: "deepseek/deepseek-v4-flash",
      displayName: "DeepSeek V4 Flash",
    },
    {
      preference: { kind: "system_default" as const },
      modelId: "anthropic/claude-opus-5.5",
      displayName: "Claude Opus 5.5",
    },
  ])("persists authorized Center Agent model and reasoning updates for $preference.kind", async ({
    preference,
    modelId,
    displayName,
  }) => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({ organizationId: "org-a" }),
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "owner-user",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-owner", "org-a", "owner-user", "owner"),
        memberRow("member-admin", "org-a", "admin-user", "admin"),
        memberRow("member-ordinary", "org-a", "member-user", "member"),
      ],
    });
    await db.bindingRows.set(
      bindingKey("organization", "org-a", AGENT_PROFILE_ID),
      {
        agentControllerConversationId: null,
        agentControllerPermissionMode: null,
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding-center-agent",
        bindingState: "enabled_primary",
        configurationRevision: 4,
        createdAtMs: 1_700_000_000_000,
        createdByProfileId: HUMAN_PROFILE_ID,
        disabledAtMs: null,
        hostedRuntimeIdentityJson: JSON.stringify(
          HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
        ),
        modelId: null,
        openCodePermission: null,
        ownerId: "org-a",
        ownerKind: "organization",
        reasonCode: null,
        reasoningLevel: null,
        runtimeKind: "hosted_center_agent",
        updatedAtMs: 1_700_000_000_000,
        openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
      }
    );
    const env = await buildEnv({ db, remoteAgentRuntimeEnabled: "true" });
    const memberContext = buildContext({
      activeOrganizationId: "org-a",
      userId: "member-user",
    });
    const adminContext = buildContext({
      activeOrganizationId: "org-a",
      userId: "admin-user",
    });
    const ownerContext = buildContext({
      activeOrganizationId: "org-a",
      userId: "owner-user",
    });

    await expect(
      rpcGetCenterAgentModel(env, { context: memberContext })
    ).resolves.toMatchObject({
      canManage: false,
      configurationRevision: 4,
      effectiveModel: {
        displayName: "Claude Opus 5.5",
        modelId: "anthropic/claude-opus-5.5",
      },
      preference: { kind: "system_default" },
    });
    await expect(
      rpcUpdateCenterAgentModel(env, {
        context: memberContext,
        expectedConfigurationRevision: 4,
        preference: {
          kind: "selected_model",
          modelId: "deepseek/deepseek-v4-flash",
        },
      })
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      rpcUpdateCenterAgentModel(env, {
        context: adminContext,
        expectedConfigurationRevision: 4,
        preference,
        reasoningLevel: "high",
      })
    ).resolves.toMatchObject({
      canManage: true,
      changed: true,
      configurationRevision: 5,
      effectiveModel: {
        displayName,
        modelId,
      },
      reasoningLevel: "high",
      effectiveReasoningLevel: "high",
    });
    await expect(
      rpcGetCenterAgentModel(env, { context: ownerContext })
    ).resolves.toMatchObject({
      canManage: true,
      configurationRevision: 5,
      preference: {
        kind: "selected_model",
        modelId,
      },
      reasoningLevel: "high",
      effectiveReasoningLevel: "high",
    });
    await expect(
      rpcUpdateCenterAgentModel(env, {
        context: ownerContext,
        expectedConfigurationRevision: 4,
        preference: { kind: "system_default" },
      })
    ).rejects.toMatchObject({
      code: "center_agent.model_configuration_changed",
      status: 409,
    });
    await expect(
      rpcUpdateCenterAgentModel(env, {
        context: ownerContext,
        expectedConfigurationRevision: 5,
        preference: { kind: "system_default" },
        reasoningLevel: null,
      })
    ).resolves.toMatchObject({
      changed: true,
      configurationRevision: 6,
      preference: { kind: "system_default" },
      reasoningLevel: null,
      effectiveReasoningLevel: "medium",
    });
  });

  it("does not carry legacy Organization authorization when replacing a hosted Center Agent Binding", async () => {
    const previousBindingId = `binding-${AGENT_PROFILE_ID}`;
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({ organizationId: "org-a" }),
      ],
      authorizations: [
        authorizationRow({
          agentProfileId: AGENT_PROFILE_ID,
          authorizedBy: "user-a",
          bindingId: previousBindingId,
          createdAtMs: 1_700_000_000_000,
          organizationId: "org-a",
        }),
        authorizationRow({
          agentProfileId: AGENT_PROFILE_ID,
          authorizedBy: "user-b",
          bindingId: previousBindingId,
          createdAtMs: 1_700_000_000_000,
          organizationId: "org-b",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const env = await buildEnv({
      db,
      remoteAgentRuntimeEnabled: "true",
    });

    await rpcDesignateCenterAgent(env, {
      agentProfileId: AGENT_PROFILE_ID,
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
      runtime: "remote_agent",
    });
    expect(
      (await db.readCenterAgentAuditRows())
        .filter((row) => row.action === "carry_over_binding_authorization")
        .map((row) => row.organizationId)
    ).toEqual([]);
  });

  it("lets organization owners and admins update the Center Agent profile name through Auth", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-a", "org-a", "user-a", "owner"),
        memberRow("member-b", "org-a", "user-b", "admin"),
      ],
    });
    const authWorker = {
      updateCenterAgentProfileInOrganization: vi.fn(async () => ({
        ok: true,
        profile: {
          createdAt: "2026-07-06T00:00:00.000Z",
          createdByUserId: "user-a",
          creatorProfileId: null,
          isDefault: false,
          lastUsedAt: null,
          managedRole: "center_agent",
          ownerUserId: null,
          profileHandle: "operations-center-agent",
          profileKind: "agent",
          profileName: "Operations Center Agent",
          source: "auth_bootstrap",
          status: "active",
          updatedAt: "2026-07-06T00:00:00.000Z",
          openMeldProfileId: AGENT_PROFILE_ID,
        },
      })),
    };
    const env = await buildEnv({ authWorker, db });

    await expect(
      rpcUpdateCenterAgentProfile(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        profileName: "Operations Center Agent",
      })
    ).resolves.toMatchObject({
      organizationId: "org-a",
      profile: {
        profileHandle: "operations-center-agent",
        profileName: "Operations Center Agent",
        openMeldProfileId: AGENT_PROFILE_ID,
      },
    });
    await expect(
      rpcUpdateCenterAgentProfile(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-b",
        }),
        profileName: "Operations Center Agent",
      })
    ).resolves.toMatchObject({
      organizationId: "org-a",
    });
    expect(
      authWorker.updateCenterAgentProfileInOrganization
    ).toHaveBeenCalledWith({
      organizationId: "org-a",
      profileId: AGENT_PROFILE_ID,
      profileName: "Operations Center Agent",
    });
    await rpcUpdateCenterAgentProfile(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
      avatar: { kind: "bot", type: "mech", palette: "balanced" },
    });
    expect(
      authWorker.updateCenterAgentProfileInOrganization
    ).toHaveBeenLastCalledWith({
      organizationId: "org-a",
      profileId: AGENT_PROFILE_ID,
      avatarStyle: "mech",
      avatarOptions: { palette: "balanced" },
      expectedAvatarOptions: null,
    });
  });

  it("rolls back a Center Agent profile image only after an explicit rejected save", async () => {
    const update = vi.fn().mockResolvedValue({
      ok: false,
      code: "profile.validation_error",
      message: "This avatar changed.",
    });
    const env = await buildEnv({
      agentProfiles: [managedCenterAgentProfileRow()],
      authWorker: { updateCenterAgentProfileInOrganization: update },
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const put = vi.fn().mockResolvedValue({});
    const remove = vi.fn().mockResolvedValue(undefined);
    env.OPENMELD_ACCOUNT_AVATARS = {
      put,
      delete: remove,
    } as unknown as R2Bucket;
    env.OPENMELD_GATEWAY_URL = "https://gateway.openmeld.invalid";
    const input = {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
      avatar: {
        kind: "image" as const,
        dataUrl: "data:image/webp;base64,UklGRgAAAABXRUJQ",
      },
    };
    await expect(rpcUpdateCenterAgentProfile(env, input)).rejects.toMatchObject(
      { status: 409 }
    );
    expect(put).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(put.mock.calls[0]?.[0]);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        avatarStyle: "custom",
        expectedAvatarOptions: null,
        avatarOptions: {
          imageUrl: expect.stringContaining(
            "https://gateway.openmeld.invalid/"
          ),
        },
      })
    );
    // A lost reply can follow a committed write. Do not delete that image.
    update.mockRejectedValueOnce(new Error("reply lost"));
    await expect(rpcUpdateCenterAgentProfile(env, input)).rejects.toThrow();
    expect(put).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("maps an unavailable Auth profile-update RPC method to the stable Center Agent error", async () => {
    const authWorker = {
      updateCenterAgentProfileInOrganization: vi.fn(() =>
        Promise.reject(
          new Error("The RPC receiver does not implement the method")
        )
      ),
    };
    const env = await buildEnv({
      agentProfiles: [managedCenterAgentProfileRow()],
      authWorker,
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });

    await expect(
      rpcUpdateCenterAgentProfile(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        profileName: "Operations Center Agent",
      })
    ).rejects.toMatchObject({
      cause: {
        code: "center_agent.profile_update_unavailable",
        status: 503,
      },
      code: "center_agent.profile_update_unavailable",
      status: 503,
    });
  });

  it("rejects Center Agent profile updates from ordinary organization members", async () => {
    const authWorker = {
      updateCenterAgentProfileInOrganization: vi.fn(),
    };
    const env = await buildEnv({
      agentProfiles: [managedCenterAgentProfileRow()],
      authWorker,
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
    });

    await expect(
      rpcUpdateCenterAgentProfile(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        avatar: {
          kind: "image",
          dataUrl: "data:image/webp;base64,UklGRgAAAABXRUJQ",
        },
      })
    ).rejects.toMatchObject({
      code: "organization.role_required",
      status: 403,
    });
    expect(
      authWorker.updateCenterAgentProfileInOrganization
    ).not.toHaveBeenCalled();
  });

  it("rejects non-designated callers and blocks Center Agent tools while paused", async () => {
    const spaceStub = createSpaceStub();
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "planner",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Planner",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentCreateSpace(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Planner",
          userId: "user-a",
        }),
        name: "Planning",
        visibility: "private",
      })
    ).rejects.toMatchObject({
      code: "center_agent.not_designated",
      status: 403,
    });
    expect(spaceStub.rpcPatchMeta).not.toHaveBeenCalled();

    await expect(
      rpcCenterAgentCreateSpace(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Codex",
          userId: "user-a",
        }),
        name: "Planning",
        onBehalfOf: { profileId: HUMAN_PROFILE_ID },
        visibility: "private",
      })
    ).resolves.toMatchObject({
      attribution: {
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOf: { profileId: HUMAN_PROFILE_ID, userId: "user-a" },
      },
      organizationId: "org-a",
      resource: { type: "space" },
    });

    await expect(
      rpcUpdateCenterAgentOperatingState(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        operatingState: "paused",
      })
    ).resolves.toMatchObject({
      changed: true,
      operatingState: "paused",
    });
    await expect(
      rpcCenterAgentCreateSpace(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Codex",
          userId: "user-a",
        }),
        name: "While paused",
        visibility: "private",
      })
    ).rejects.toMatchObject({
      code: "center_agent.paused",
      status: 409,
    });
    await expect(
      rpcUpdateCenterAgentOperatingState(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        operatingState: "active",
      })
    ).resolves.toMatchObject({
      changed: true,
      operatingState: "active",
    });
    await expect(
      rpcCenterAgentCreateSpace(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Codex",
          userId: "user-a",
        }),
        name: "After resume",
        onBehalfOf: { profileId: HUMAN_PROFILE_ID },
        visibility: "private",
      })
    ).resolves.toMatchObject({ organizationId: "org-a" });
  });

  it.each([
    ["owner", true],
    ["admin", true],
    ["member", false],
  ] as const)("uses current %s membership for pause authority after the creator is gone", async (role, allowed) => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "deleted-creator",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("current-member", "org-a", "user-a", role)],
      organizations: [
        {
          createdByUserId: null,
          name: "Acme",
          organizationId: "org-a",
          slug: "acme",
        },
      ],
    });
    const env = await buildEnv({ db });
    const context = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });
    await expect(
      rpcGetCenterAgentOperatingState(env, { context })
    ).resolves.toMatchObject({
      canChangeOperatingState: allowed,
      operatingState: "active",
    });
    const result = rpcUpdateCenterAgentOperatingState(env, {
      context,
      operatingState: "paused",
    });
    if (allowed) {
      await expect(result).resolves.toMatchObject({
        canChangeOperatingState: true,
        changed: true,
        operatingState: "paused",
      });
    } else {
      await expect(result).rejects.toMatchObject({
        code: "organization.role_required",
        status: 403,
      });
    }
  });

  it.each([
    ["missing", undefined],
    ["invalid", { profileId: SECOND_HUMAN_PROFILE_ID }],
  ])("rejects %s represented humans before writing", async (_case, onBehalfOf) => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const spaceStub = createSpaceStub();
    await expect(
      rpcCenterAgentCreateSpace(await buildEnv({ db, spaceStub }), {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Center Agent",
          userId: "user-a",
        }),
        name: "No owner",
        ...(onBehalfOf ? { onBehalfOf } : {}),
        visibility: "private",
      })
    ).rejects.toMatchObject({
      code:
        _case === "missing"
          ? "center_agent.represented_member_required"
          : "invalid_payload",
      status: _case === "missing" ? 403 : 400,
    });
    expect(spaceStub.rpcPatchMeta).not.toHaveBeenCalled();
    expect(spaceStub.rpcPatchMetaWithPasswordAtomic).not.toHaveBeenCalled();
  });

  it("records Center Agent audit entries with on-behalf-of attribution", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });
    const agentContext = buildCenterAgentContext({
      activeOrganizationId: "org-a",
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      profileName: AGENT_PROFILE_ID,
      userId: "user-a",
    });

    const created = await rpcCenterAgentCreateSpace(env, {
      accessMode: "members_only",
      context: agentContext,
      name: "Leadership Sync",
      onBehalfOf: { profileId: HUMAN_PROFILE_ID },
      visibility: "private",
    });
    expect(created.meta).toEqual({
      accessMode: "members_only",
      name: "Leadership Sync",
      organizationId: "org-a",
      passwordProtected: false,
      spaceId: created.spaceId,
      visibility: "private",
    });
    expect(created.attribution).toEqual({
      actorProfileId: AGENT_PROFILE_ID,
      onBehalfOf: {
        displayName: "Ava",
        profileId: HUMAN_PROFILE_ID,
        userId: "user-a",
      },
    });
    expect(spaceStub.rpcPatchMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        creator: expect.objectContaining({ profileName: "Codex" }),
        initialOwnerMember: expect.objectContaining({
          ownerUserId: "user-a",
          profileId: HUMAN_PROFILE_ID,
          profileKind: "human",
        }),
      })
    );
    expect(spaceStub.rpcPostMembers).not.toHaveBeenCalled();

    await expect(
      rpcListCenterAgentAuditJournal(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
      })
    ).resolves.toMatchObject({
      entries: [
        {
          action: "create_space",
          actorProfileId: AGENT_PROFILE_ID,
          onBehalfOf: {
            displayName: "Ava",
            profileId: HUMAN_PROFILE_ID,
            userId: "user-a",
          },
          resource: { id: created.spaceId, type: "space" },
        },
      ],
      organizationId: "org-a",
    });
  });

  it("creates Agent Profiles through the organization-scoped Auth RPC and records Center Agent audit", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "owner-user",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-owner", "org-a", "owner-user", "owner"),
        memberRow("member-a", "org-a", "user-a", "member"),
      ],
    });
    const authWorker = {
      createAgentProfileInOrganization: vi.fn(async () => ({
        ok: true,
        profile: {
          createdAt: "2026-07-06T00:00:00.000Z",
          createdByUserId: "user-a",
          creatorProfileId: AGENT_PROFILE_ID,
          isDefault: false,
          lastUsedAt: null,
          managedRole: null,
          ownerUserId: "user-a",
          profileHandle: "release-agent",
          profileKind: "agent",
          profileName: "Release Agent",
          source: "center_agent_create",
          status: "active",
          updatedAt: "2026-07-06T00:00:00.000Z",
          openMeldProfileId: SECOND_AGENT_PROFILE_ID,
        },
      })),
    };
    const env = await buildEnv({ authWorker, db });

    await expect(
      rpcCenterAgentCreateAgentProfile(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          requestId: "request-create-release-agent",
          userId: "owner-user",
        }),
        onBehalfOf: { profileId: HUMAN_PROFILE_ID },
        profileName: "Release Agent",
      })
    ).resolves.toMatchObject({
      organizationId: "org-a",
      profile: {
        profileName: "Release Agent",
        openMeldProfileId: SECOND_AGENT_PROFILE_ID,
      },
      resource: { id: SECOND_AGENT_PROFILE_ID, type: "agent_profile" },
    });
    expect(authWorker.createAgentProfileInOrganization).toHaveBeenCalledWith({
      createdByUserId: "user-a",
      creationActorProfileId: AGENT_PROFILE_ID,
      idempotencyKey:
        "center-agent:create-agent-profile:request-create-release-agent:Release Agent",
      organizationId: "org-a",
      ownerUserId: "user-a",
      profileName: "Release Agent",
      source: "center_agent_create",
    });
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "create_agent_profile",
        actorProfileId: AGENT_PROFILE_ID,
        organizationId: "org-a",
        resourceId: SECOND_AGENT_PROFILE_ID,
        resourceType: "agent_profile",
      }),
    ]);
  });

  it("maps an unavailable Auth profile-create RPC method to the stable Center Agent error", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const authWorker = {
      createAgentProfileInOrganization: vi.fn(() =>
        Promise.reject(
          new Error("The RPC receiver does not implement the method")
        )
      ),
    };

    await expect(
      rpcCenterAgentCreateAgentProfile(await buildEnv({ authWorker, db }), {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        onBehalfOf: { profileId: HUMAN_PROFILE_ID },
        profileName: "Release Agent",
      })
    ).rejects.toMatchObject({
      cause: {
        code: "center_agent.profile_create_unavailable",
        status: 503,
      },
      code: "center_agent.profile_create_unavailable",
      message:
        'HTTP 503: {"ok":false,"error":{"code":"center_agent.profile_create_unavailable","message":"Agent Profile creation is unavailable."}}',
      status: 503,
    });
    expect(await db.readCenterAgentAuditRows()).toEqual([]);
  });

  it("adds Agent Profiles to Spaces through the Space member contract", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "planner",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Planner",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Joined room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentAddAgentProfilesToSpace(env, {
        agentProfileIds: [SECOND_AGENT_PROFILE_ID],
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        onBehalfOf: { profileId: HUMAN_PROFILE_ID },
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    ).resolves.toMatchObject({
      agentProfileIds: [SECOND_AGENT_PROFILE_ID],
      attribution: {
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOf: {
          displayName: "Ava",
          profileId: HUMAN_PROFILE_ID,
          userId: "user-a",
        },
      },
      membership: {
        addedMemberIds: [SECOND_AGENT_PROFILE_ID, HUMAN_PROFILE_ID],
      },
      organizationId: "org-a",
      resource: { id: JOINED_PRIVATE_SPACE_ID, type: "space" },
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        members: [
          expect.objectContaining({
            profileId: SECOND_AGENT_PROFILE_ID,
            profileKind: "agent",
            profileName: "Planner",
          }),
          expect.objectContaining({
            ownerUserId: "user-a",
            profileId: HUMAN_PROFILE_ID,
            profileKind: "human",
            profileName: "Ava",
          }),
        ],
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    );
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "add_agent_profiles_to_space",
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        organizationId: "org-a",
        resourceId: JOINED_PRIVATE_SPACE_ID,
        resourceType: "space",
      }),
    ]);
  });

  it("creates a Space, adds Organization members and Agent Profiles, then wakes the Agent Profiles", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "center-agent",
          profileId: AGENT_PROFILE_ID,
          profileName: "Center Agent",
          status: "active",
        },
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "planner",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Planner",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-a", "org-a", "user-a", "owner"),
        memberRow("member-b", "org-a", "user-b", "member"),
      ],
    });
    const spaceStub = createSpaceStub({
      enforceAddressingTargetMembership: true,
      spaces: db.spaces,
    });
    const env = await buildEnv({ db, spaceStub });
    const context = buildCenterAgentContext({
      activeOrganizationId: "org-a",
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      profileName: "Center Agent",
      userId: "user-a",
    });

    const created = await rpcCenterAgentCreateSpace(env, {
      context,
      name: "Friday Demo",
      onBehalfOf: { profileId: HUMAN_PROFILE_ID },
      visibility: "private",
    });
    const members = await rpcCenterAgentAddMembersToSpace(env, {
      context,
      memberUserIds: ["user-b", "user-external"],
      spaceId: created.spaceId,
      speakerMember: { memberId: "member-a", userId: "user-a" },
    });
    const agents = await rpcCenterAgentAddAgentProfilesToSpace(env, {
      agentProfileIds: [SECOND_AGENT_PROFILE_ID],
      context,
      onBehalfOf: { profileId: HUMAN_PROFILE_ID },
      spaceId: created.spaceId,
    });
    const wake = await rpcCenterAgentWakeAgentProfilesInSpace(env, {
      agentProfileIds: [SECOND_AGENT_PROFILE_ID],
      context,
      onBehalfOf: { profileId: HUMAN_PROFILE_ID },
      spaceId: created.spaceId,
      text: "Prepare the Friday demo.",
    });

    expect(members).toMatchObject({
      attribution: {
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOf: { profileId: HUMAN_PROFILE_ID, userId: "user-a" },
      },
      membership: { addedMemberIds: [SECOND_HUMAN_PROFILE_ID] },
      results: [
        {
          memberUserId: "user-b",
          profileId: SECOND_HUMAN_PROFILE_ID,
          status: "added",
        },
        {
          code: "not_organization_member",
          memberUserId: "user-external",
          message:
            "This user is not an active member of the current Organization.",
          status: "rejected",
        },
      ],
      spaceId: created.spaceId,
    });
    expect(agents.membership.addedMemberIds).toEqual([SECOND_AGENT_PROFILE_ID]);
    if (wake.publicationStatus === "pending") {
      throw new Error("direct Center Agent Wake must be accepted");
    }
    expect(wake.signal.data.messageEnvelope?.activationTargets).toEqual([
      SECOND_AGENT_PROFILE_ID,
    ]);
    expect(spaceStub.rpcPostMembers).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        members: [
          expect.objectContaining({
            ownerUserId: "user-b",
            profileId: SECOND_HUMAN_PROFILE_ID,
            profileKind: "human",
            profileName: "Ben",
          }),
        ],
        spaceId: created.spaceId,
      })
    );
    expect(spaceStub.rpcPostMembers).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        members: [
          expect.objectContaining({
            profileId: SECOND_AGENT_PROFILE_ID,
            profileKind: "agent",
          }),
          expect.objectContaining({
            ownerUserId: "user-a",
            profileId: HUMAN_PROFILE_ID,
            profileKind: "human",
          }),
        ],
        spaceId: created.spaceId,
      })
    );
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({ action: "create_space" }),
      expect.objectContaining({
        action: "add_members_to_space",
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        organizationId: "org-a",
        resourceId: created.spaceId,
        resourceType: "space",
      }),
      expect.objectContaining({ action: "add_agent_profiles_to_space" }),
      expect.objectContaining({ action: "wake_agent_profiles_in_space" }),
    ]);

    const v2Audit = await rpcListCenterAgentAuditJournal(env, {
      actionSet: "v2",
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });
    expect(
      v2Audit.entries.some((entry) => entry.action === "add_members_to_space")
    ).toBe(false);
    await expect(
      rpcListCenterAgentAuditJournal(env, {
        actionSet: "v3",
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
      })
    ).resolves.toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ action: "add_members_to_space" }),
      ]),
    });
  });

  it("rejects every non-member without writing Space membership", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Launch",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentAddMembersToSpace(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        memberUserIds: ["user-external-1", "user-external-2"],
        spaceId: JOINED_PRIVATE_SPACE_ID,
        speakerMember: { memberId: "member-a", userId: "user-a" },
      })
    ).resolves.toMatchObject({
      membership: {
        addedMemberIds: [],
        alreadyMemberIds: [],
        items: [],
      },
      results: [
        {
          code: "not_organization_member",
          memberUserId: "user-external-1",
          status: "rejected",
        },
        {
          code: "not_organization_member",
          memberUserId: "user-external-2",
          status: "rejected",
        },
      ],
    });
    expect(spaceStub.rpcPostMembers).not.toHaveBeenCalled();
  });

  it("removes Agent Profiles from Spaces through the Space member contract", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "planner",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Planner",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentRemoveAgentProfilesFromSpace(env, {
        agentProfileIds: [SECOND_AGENT_PROFILE_ID],
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        onBehalfOf: { profileId: HUMAN_PROFILE_ID },
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    ).resolves.toMatchObject({
      agentProfileIds: [SECOND_AGENT_PROFILE_ID],
      attribution: {
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOf: {
          displayName: "Ava",
          profileId: HUMAN_PROFILE_ID,
          userId: "user-a",
        },
      },
      membership: {
        removedMemberIds: [SECOND_AGENT_PROFILE_ID],
      },
      organizationId: "org-a",
      resource: { id: JOINED_PRIVATE_SPACE_ID, type: "space" },
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });
    expect(spaceStub.rpcRemoveMembers).toHaveBeenCalledWith({
      context: expect.any(Object),
      memberProfileIds: [SECOND_AGENT_PROFILE_ID],
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "remove_agent_profiles_from_space",
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        organizationId: "org-a",
        resourceId: JOINED_PRIVATE_SPACE_ID,
        resourceType: "space",
      }),
    ]);
  });

  it("updates Space settings through the Space owner contracts", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Launch Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentUpdateSpaceSettings(env, {
        accessMode: "protected",
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        guide: "Keep decisions explicit.",
        onBehalfOf: { profileId: HUMAN_PROFILE_ID },
        password: "secret-passphrase",
        purpose: "Coordinate the launch",
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    ).resolves.toMatchObject({
      accessModeState: {
        accessMode: "protected",
        passwordProtected: true,
        spaceId: JOINED_PRIVATE_SPACE_ID,
      },
      attribution: {
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOf: {
          displayName: "Ava",
          profileId: HUMAN_PROFILE_ID,
          userId: "user-a",
        },
      },
      meta: {
        purpose: "Coordinate the launch",
        spaceId: JOINED_PRIVATE_SPACE_ID,
      },
      organizationId: "org-a",
      resource: { id: JOINED_PRIVATE_SPACE_ID, type: "space" },
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });
    expect(spaceStub.rpcSetAccessMode).toHaveBeenCalledWith({
      accessMode: "protected",
      context: expect.any(Object),
      password: "secret-passphrase",
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });
    expect(spaceStub.rpcPatchMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.any(Object),
        guide: "Keep decisions explicit.",
        purpose: "Coordinate the launch",
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    );
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "update_space_settings",
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        organizationId: "org-a",
        resourceId: JOINED_PRIVATE_SPACE_ID,
        resourceType: "space",
      }),
    ]);
  });

  it("advertises structured Reference support before posting a plain Space message", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "center-agent",
          profileId: AGENT_PROFILE_ID,
          profileName: "Center Agent",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Launch Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({
      enforceAddressingTargetMembership: true,
      initialActiveMemberProfileIdsBySpace: {
        [JOINED_PRIVATE_SPACE_ID]: [HUMAN_PROFILE_ID],
      },
      spaces: db.spaces,
    });
    const env = await buildEnv({ db, spaceStub });
    const context = buildCenterAgentContext({
      activeOrganizationId: "org-a",
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      userId: "user-a",
    });

    await expect(
      rpcCenterAgentReadSpaceAuthoringContract(env, {
        context,
        requestedAddressingModel: "wake_reference_mention",
      })
    ).resolves.toEqual({
      addressingModel: "wake_reference_mention",
      structuredMentionTargets: true,
      structuredReferenceTargets: true,
    });

    await expect(
      createCenterAgentRpcEntrypoint(env).centerAgentPostSpaceMessage({
        context,
        mentionProfileIds: [HUMAN_PROFILE_ID],
        onBehalfOf: { profileId: HUMAN_PROFILE_ID },
        referenceProfileIds: [],
        spaceId: JOINED_PRIVATE_SPACE_ID,
        text: "I moved the launch notes into this Space.",
      })
    ).resolves.toMatchObject({
      attribution: {
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOf: {
          displayName: "Ava",
          profileId: HUMAN_PROFILE_ID,
          userId: "user-a",
        },
      },
      organizationId: "org-a",
      signal: {
        data: {
          messageEnvelope: {
            activationTargets: [],
            mentionTargets: [HUMAN_PROFILE_ID],
            referenceTargets: [],
            text: "I moved the launch notes into this Space.",
          },
          text: "I moved the launch notes into this Space.",
        },
        profile: {
          kind: "agent",
          profileId: AGENT_PROFILE_ID,
          profileName: "Center Agent",
        },
        spaceId: JOINED_PRIVATE_SPACE_ID,
        type: "signal.text",
      },
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });
    expect(spaceStub.rpcPostSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        authoringPolicy: "user_authored",
        messageEnvelope: {
          activationTargets: [],
          mentionTargets: [HUMAN_PROFILE_ID],
          referenceTargets: [],
          text: "I moved the launch notes into this Space.",
        },
        spaceAddressingVersion: "1",
        spaceId: JOINED_PRIVATE_SPACE_ID,
        text: "I moved the launch notes into this Space.",
      })
    );
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "post_space_message",
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        organizationId: "org-a",
        resourceId: JOINED_PRIVATE_SPACE_ID,
        resourceType: "space",
      }),
    ]);
  });

  it("keeps an old Remote Agent compatible after Space normalizes a Human Reference into a Mention", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Launch Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({
      enforceAddressingTargetMembership: true,
      initialActiveMemberProfileIdsBySpace: {
        [JOINED_PRIVATE_SPACE_ID]: [HUMAN_PROFILE_ID],
      },
      spaces: db.spaces,
    });
    spaceStub.rpcPostSignal.mockImplementationOnce(async (request) => ({
      data: {
        messageEnvelope: {
          activationTargets: [],
          mentionTargets: [HUMAN_PROFILE_ID],
          referenceTargets: [],
          text: request.text,
        },
        text: request.text,
      },
      id: "signal_999",
      profile: {
        ...request.profile,
        kind: request.profile.kind ?? "agent",
      },
      spaceId: request.spaceId,
      ts: TEST_NOW_MS,
      type: "signal.text" as const,
      v: 1 as const,
    }));
    const env = await buildEnv({ db, spaceStub });
    const context = buildCenterAgentContext({
      activeOrganizationId: "org-a",
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      userId: "user-a",
    });

    await expect(
      rpcCenterAgentReadSpaceAuthoringContract(env, { context })
    ).resolves.toEqual({
      addressingModel: "wake_reference",
      structuredReferenceTargets: true,
    });

    const result = await createCenterAgentRpcEntrypoint(
      env
    ).centerAgentPostSpaceMessage({
      context,
      onBehalfOf: { profileId: HUMAN_PROFILE_ID },
      referenceProfileIds: [HUMAN_PROFILE_ID],
      spaceId: JOINED_PRIVATE_SPACE_ID,
      text: "Please review the launch notes.",
    });

    expect(spaceStub.rpcPostSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [HUMAN_PROFILE_ID],
          text: "Please review the launch notes.",
        },
      })
    );
    expect(result.signal.data.messageEnvelope).toEqual({
      activationTargets: [],
      ccTargets: [],
      referenceTargets: [HUMAN_PROFILE_ID],
      text: "Please review the launch notes.",
    });
  });

  it("rejects a Center Agent plain post that References a non-member", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Launch Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({
      enforceAddressingTargetMembership: true,
      initialActiveMemberProfileIdsBySpace: {
        [JOINED_PRIVATE_SPACE_ID]: [HUMAN_PROFILE_ID],
      },
      spaces: db.spaces,
    });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentPostSpaceMessage(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        onBehalfOf: { profileId: HUMAN_PROFILE_ID },
        referenceProfileIds: [SECOND_HUMAN_PROFILE_ID],
        spaceId: JOINED_PRIVATE_SPACE_ID,
        text: "Use the non-member as context.",
      })
    ).rejects.toMatchObject({
      code: "space.addressing.target_invalid",
      status: 422,
    });
    expect(spaceStub.rpcPostSignal).toHaveBeenCalledTimes(1);
  });

  it("marks current Center Agent Space posts before target-kind validation", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Launch Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({
      enforceAddressingTargetMembership: true,
      initialActiveMemberProfileIdsBySpace: {
        [JOINED_PRIVATE_SPACE_ID]: [HUMAN_PROFILE_ID],
      },
      spaces: db.spaces,
    });

    await rpcCenterAgentPostSpaceMessage(await buildEnv({ db, spaceStub }), {
      context: buildCenterAgentContext({
        activeOrganizationId: "org-a",
        profileId: AGENT_PROFILE_ID,
        profileKind: "agent",
        userId: "user-a",
      }),
      mentionProfileIds: [],
      referenceProfileIds: [HUMAN_PROFILE_ID],
      spaceId: JOINED_PRIVATE_SPACE_ID,
      text: "Please review the launch notes.",
    });
    expect(spaceStub.rpcPostSignal).toHaveBeenCalledWith(
      expect.objectContaining({ spaceAddressingVersion: "1" })
    );
  });

  it("posts ordered Slack messages with independent retry identities", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      slackWorkspaceBindings: [
        {
          createdAtMs: TEST_NOW_MS,
          organizationId: "org-a",
          slackTeamId: "T123",
          updatedAtMs: TEST_NOW_MS,
        },
      ],
    });
    let postedMessageCount = 0;
    const slackFetch = vi.fn<typeof fetch>((request) => {
      const pathname = new URL(String(request)).pathname;
      if (pathname === "/api/conversations.list") {
        return Promise.resolve(
          Response.json({
            channels: [
              {
                id: "C123",
                is_archived: false,
                is_member: true,
                is_private: false,
                name: "release",
              },
            ],
            ok: true,
            response_metadata: { next_cursor: "" },
          })
        );
      }
      if (pathname === "/api/chat.postMessage") {
        postedMessageCount += 1;
        return Promise.resolve(
          Response.json({
            ok: true,
            ts: `1710000000.00${postedMessageCount}`,
          })
        );
      }
      throw new Error(`Unexpected Slack API request: ${pathname}`);
    });
    vi.stubGlobal("fetch", slackFetch);
    const env = await buildEnv({ db, slackBotToken: "xoxb-test" });

    const context = buildCenterAgentContext({
      activeOrganizationId: "org-a",
      agentControllerConversationId: "remote_agent_submission_release",
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      userId: "user-a",
    });
    const slackChannelMessageText = [
      "`<https://github.com/amplifthq/reply/pull/154|#154 fix P0>`",
      "See `[Open Space](https://openmeld.ai/o/amplift/spaces/space_123)`.",
      "Notify `<@U123456>`.",
    ].join("\n");
    const publicationSource = (operationId: string) =>
      ({
        executionId: "remote_agent_submission_release",
        kind: "remote_agent_execution",
        operationId,
      }) as const;

    await expect(
      rpcCenterAgentPostSlackChannelMessage(env, {
        channelName: "#Release",
        context,
        speakerMember: { memberId: "member-missing", userId: "user-a" },
        text: "The release is ready.",
      })
    ).rejects.toMatchObject({
      code: "center_agent.slack_channel_speaker_required",
      status: 403,
    });
    expect(slackFetch).not.toHaveBeenCalled();

    await expect(
      rpcCenterAgentPostSlackChannelMessage(env, {
        channelName: "#Release",
        context,
        publicationSource: publicationSource("release-message-1"),
        speakerMember: { memberId: "member-a", userId: "user-a" },
        text: slackChannelMessageText,
      })
    ).resolves.toMatchObject({
      attribution: {
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOf: { profileId: HUMAN_PROFILE_ID, userId: "user-a" },
      },
      channelName: "release",
      joinedChannel: false,
      messageTs: "1710000000.001",
      organizationId: "org-a",
    });
    expect(slackFetch).toHaveBeenLastCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({
        body: JSON.stringify({
          blocks: [
            {
              text: [
                "[#154 fix P0](https://github.com/amplifthq/reply/pull/154)",
                "See [Open Space](https://openmeld.ai/o/amplift/spaces/space_123).",
                "Notify <@U123456>.",
              ].join("\n"),
              type: "markdown",
            },
          ],
          channel: "C123",
          text: [
            "<https://github.com/amplifthq/reply/pull/154|#154 fix P0>",
            "See <https://openmeld.ai/o/amplift/spaces/space_123|Open Space>.",
            "Notify <@U123456>.",
          ].join("\n"),
        }),
      })
    );
    await expect(
      rpcCenterAgentPostSlackChannelMessage(env, {
        channelName: "#Release",
        context,
        publicationSource: publicationSource("release-message-1"),
        speakerMember: { memberId: "member-a", userId: "user-a" },
        text: slackChannelMessageText,
      })
    ).resolves.toMatchObject({
      messageTs: "1710000000.001",
    });
    await expect(
      rpcCenterAgentPostSlackChannelMessage(env, {
        channelName: "#Release",
        context,
        publicationSource: publicationSource("release-message-1"),
        speakerMember: { memberId: "member-a", userId: "user-a" },
        text: "Changed release text.",
      })
    ).rejects.toMatchObject({
      code: "center_agent.publication_conflict",
      status: 409,
    });
    await expect(
      rpcCenterAgentPostSlackChannelMessage(env, {
        channelName: "#Release",
        context,
        publicationSource: publicationSource("release-message-2"),
        speakerMember: { memberId: "member-a", userId: "user-a" },
        text: "Changed release text.",
      })
    ).resolves.toMatchObject({
      messageTs: "1710000000.002",
    });
    await expect(
      rpcCenterAgentPostSlackChannelMessage(env, {
        channelName: "#Release",
        context,
        publicationSource: {
          executionId: "model_chosen_execution",
          kind: "remote_agent_execution",
        },
        speakerMember: { memberId: "member-a", userId: "user-a" },
        text: slackChannelMessageText,
      })
    ).rejects.toMatchObject({
      code: "center_agent.publication_source_invalid",
      status: 409,
    });
    expect(
      slackFetch.mock.calls.filter(
        ([request]) =>
          new URL(String(request)).pathname === "/api/chat.postMessage"
      )
    ).toHaveLength(2);
    expect(await db.readCenterAgentAuditRows()).toEqual(
      Array.from({ length: 2 }, () =>
        expect.objectContaining({
          action: "post_slack_channel_message",
          actorProfileId: AGENT_PROFILE_ID,
          onBehalfOfProfileId: HUMAN_PROFILE_ID,
          organizationId: "org-a",
          resourceId: "C123",
          resourceType: "slack_channel",
        })
      )
    );

    const memberContext = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });
    await expect(
      rpcListCenterAgentAuditJournal(env, { context: memberContext })
    ).resolves.toEqual({ entries: [], organizationId: "org-a" });
    await expect(
      rpcListCenterAgentAuditJournal(env, {
        actionSet: "v2",
        context: memberContext,
      })
    ).resolves.toMatchObject({
      entries: Array.from({ length: 2 }, () =>
        expect.objectContaining({ action: "post_slack_channel_message" })
      ),
      organizationId: "org-a",
    });
  });

  it("distinguishes a retryable preparation failure from an ambiguous Slack outcome", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      slackWorkspaceBindings: [
        {
          createdAtMs: TEST_NOW_MS,
          organizationId: "org-a",
          slackTeamId: "T123",
          updatedAtMs: TEST_NOW_MS,
        },
      ],
    });
    let closeNextSlackRequest = false;
    const slackFetch = vi.fn<typeof fetch>((request) => {
      const pathname = new URL(String(request)).pathname;
      if (pathname === "/api/conversations.list") {
        return Promise.resolve(
          Response.json({
            channels: [
              {
                id: "C123",
                is_archived: false,
                is_member: true,
                is_private: false,
                name: "release",
              },
            ],
            ok: true,
            response_metadata: { next_cursor: "" },
          })
        );
      }
      if (pathname === "/api/chat.postMessage") {
        if (closeNextSlackRequest) {
          closeNextSlackRequest = false;
          return Promise.reject(new Error("socket closed"));
        }
        return Promise.resolve(
          Response.json({ ok: true, ts: "1710000000.001" })
        );
      }
      throw new Error(`Unexpected Slack API request: ${pathname}`);
    });
    vi.stubGlobal("fetch", slackFetch);
    const env = await buildEnv({ db, slackBotToken: "xoxb-test" });
    const context = buildCenterAgentContext({
      activeOrganizationId: "org-a",
      agentControllerConversationId: "remote_agent_submission_release",
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      userId: "user-a",
    });
    const request = {
      channelName: "#Release",
      context,
      publicationSource: {
        executionId: "remote_agent_submission_release",
        kind: "remote_agent_execution" as const,
        operationId: "release-message-preparation-retry",
      },
      speakerMember: { memberId: "member-a", userId: "user-a" },
      text: "Retry this exact message after local preparation recovers.",
    };

    vi.spyOn(
      slackFinalReplyPresentation,
      "buildSlackFinalReplyPresentation"
    ).mockRejectedValueOnce(
      new Error("Slack presentation runtime was temporarily unavailable.")
    );

    await expect(
      rpcCenterAgentPostSlackChannelMessage(env, request)
    ).rejects.toThrow(
      "Slack presentation runtime was temporarily unavailable."
    );
    expect(
      slackFetch.mock.calls.filter(
        ([requestUrl]) =>
          new URL(String(requestUrl)).pathname === "/api/chat.postMessage"
      )
    ).toHaveLength(0);
    expect(await db.readCenterAgentAuditRows()).toHaveLength(0);

    await expect(
      rpcCenterAgentPostSlackChannelMessage(env, request)
    ).resolves.toMatchObject({
      messageTs: "1710000000.001",
    });
    expect(
      slackFetch.mock.calls.filter(
        ([requestUrl]) =>
          new URL(String(requestUrl)).pathname === "/api/chat.postMessage"
      )
    ).toHaveLength(1);
    expect(await db.readCenterAgentAuditRows()).toHaveLength(1);

    closeNextSlackRequest = true;
    const ambiguousRequest = {
      ...request,
      publicationSource: {
        ...request.publicationSource,
        operationId: "release-message-ambiguous-outcome",
      },
      text: "Do not retry this message after an ambiguous provider outcome.",
    };
    await expect(
      rpcCenterAgentPostSlackChannelMessage(env, ambiguousRequest)
    ).rejects.toMatchObject({
      publicationOutcome: "unknown",
    });
    await expect(
      rpcCenterAgentPostSlackChannelMessage(env, ambiguousRequest)
    ).rejects.toMatchObject({
      code: "center_agent.publication_outcome_unknown",
      status: 409,
    });
    expect(
      slackFetch.mock.calls.filter(
        ([requestUrl]) =>
          new URL(String(requestUrl)).pathname === "/api/chat.postMessage"
      )
    ).toHaveLength(2);
    expect(await db.readCenterAgentAuditRows()).toHaveLength(2);
  });

  it("posts and deduplicates an exact Slack thread separately from the channel", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      nativeDeliveries: [
        nativeDeliveryLedgerRow({
          deliveryId: "delivery-interactive-proposal",
          submissionId: "remote_agent_submission_proposal",
        }),
        nativeDeliveryLedgerRow({
          deliveryId: "delivery-routine-proposal",
          routineRunId: "routine-run-proposal",
          submissionId: "remote_agent_submission_routine_proposal",
        }),
      ],
      slackWorkspaceBindings: [
        {
          createdAtMs: TEST_NOW_MS,
          organizationId: "org-a",
          slackTeamId: "T123",
          updatedAtMs: TEST_NOW_MS,
        },
      ],
    });
    const postedBodies: unknown[] = [];
    const slackFetch = vi.fn<typeof fetch>((request, init) => {
      const pathname = new URL(String(request)).pathname;
      if (pathname === "/api/chat.getPermalink") {
        return Promise.resolve(
          Response.json({
            ok: true,
            permalink:
              "https://openmeld.slack.com/archives/C123/p1786979718999999?thread_ts=1786979718.343639&cid=C123",
          })
        );
      }
      if (pathname === "/api/conversations.info") {
        expect(new URL(String(request)).searchParams.get("channel")).toBe(
          "C123"
        );
        return Promise.resolve(
          Response.json({
            channel: {
              id: "C123",
              is_member: true,
              is_private: false,
              name: "ok8-okok",
            },
            ok: true,
          })
        );
      }
      if (pathname === "/api/conversations.list") {
        return Promise.resolve(
          Response.json({
            channels: [
              {
                id: "C123",
                is_archived: false,
                is_member: true,
                is_private: false,
                name: "ok8-okok",
              },
            ],
            ok: true,
            response_metadata: { next_cursor: "" },
          })
        );
      }
      if (pathname === "/api/chat.postMessage") {
        postedBodies.push(JSON.parse(String(init?.body)));
        return Promise.resolve(
          Response.json({ ok: true, ts: `1787091616.${postedBodies.length}` })
        );
      }
      throw new Error(`Unexpected Slack API request: ${pathname}`);
    });
    vi.stubGlobal("fetch", slackFetch);
    const env = await buildEnv({ db, slackBotToken: "xoxb-test" });
    const request = {
      channelName: "ok8-okok",
      context: buildCenterAgentContext({
        activeOrganizationId: "org-a",
        agentControllerConversationId: "remote_agent_submission_proposal",
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        profileId: AGENT_PROFILE_ID,
        profileKind: "agent" as const,
        userId: "user-a",
      }),
      publicationSource: {
        executionId: "remote_agent_submission_proposal",
        kind: "remote_agent_execution" as const,
      },
      speakerMember: { memberId: "member-a", userId: "user-a" },
      text: "Here is the proposed next step.",
    };

    await expect(
      rpcCenterAgentPostSlackThreadMessage(env, {
        ...request,
        threadPermalink:
          "https://openmeld.slack.com/archives/C123/p1786979718999999",
      })
    ).resolves.toMatchObject({ messageTs: "1787091616.1" });
    await expect(
      rpcCenterAgentPostSlackThreadMessage(env, {
        ...request,
        threadPermalink:
          "https://openmeld.slack.com/archives/C123/p1786979718999999",
      })
    ).resolves.toMatchObject({ messageTs: "1787091616.1" });
    await expect(
      rpcCenterAgentPostSlackChannelMessage(env, request)
    ).resolves.toMatchObject({ messageTs: "1787091616.2" });
    await expect(
      rpcCenterAgentPostSlackThreadMessage(env, {
        ...request,
        threadPermalink:
          "https://other.slack.com/archives/C_OTHER/p1786979718999999",
      })
    ).rejects.toMatchObject({
      code: "center_agent.slack_thread_target_invalid",
      status: 409,
    });

    expect(postedBodies).toEqual([
      expect.objectContaining({
        channel: "C123",
        text: "Here is the proposed next step.",
        thread_ts: "1786979718.343639",
      }),
      expect.objectContaining({
        channel: "C123",
        text: "Here is the proposed next step.",
      }),
    ]);
    expect(postedBodies[1]).not.toHaveProperty("thread_ts");
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "post_slack_channel_message",
        resourceId: "C123:1786979718.343639",
        resourceType: "slack_channel",
      }),
      expect.objectContaining({
        action: "post_slack_channel_message",
        resourceId: "C123",
        resourceType: "slack_channel",
      }),
    ]);

    await expect(
      rpcCenterAgentPostSlackThreadMessage(env, {
        ...request,
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerConversationId:
            "remote_agent_submission_routine_proposal",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent" as const,
          userId: "user-a",
        }),
        publicationSource: {
          executionId: "remote_agent_submission_routine_proposal",
          kind: "remote_agent_execution",
        },
        threadTs: "1786979718.343639",
      })
    ).rejects.toMatchObject({
      code: "center_agent.publication_source_invalid",
      status: 409,
    });
    expect(postedBodies).toHaveLength(2);
  });

  it("uploads and deduplicates a Slack file in the originating interactive thread", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      nativeDeliveries: [
        nativeDeliveryLedgerRow({
          deliveryId: "delivery-slack-file",
          slackChannelId: "C123",
          slackTeamId: "T123",
          slackThreadTs: "1786979718.343639",
          submissionId: "remote_agent_submission_slack_file",
        }),
      ],
      slackWorkspaceBindings: [
        {
          createdAtMs: TEST_NOW_MS,
          organizationId: "org-a",
          slackTeamId: "T123",
          updatedAtMs: TEST_NOW_MS,
        },
      ],
    });
    const bytes = new TextEncoder().encode("release asset");
    const contentSha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
    )
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const completedUploads: unknown[] = [];
    const slackFetch = vi.fn<typeof fetch>((request, init) => {
      const url = new URL(String(request));
      if (url.pathname === "/api/conversations.info") {
        expect(url.searchParams.get("channel")).toBe("C123");
        return Promise.resolve(
          Response.json({
            channel: {
              id: "C123",
              is_member: true,
              is_private: false,
              name: "ok8-okok",
            },
            ok: true,
          })
        );
      }
      if (url.pathname === "/api/conversations.list") {
        return Promise.resolve(
          Response.json({
            channels: [
              {
                id: "C123",
                is_archived: false,
                is_member: true,
                is_private: false,
                name: "ok8-okok",
              },
            ],
            ok: true,
            response_metadata: { next_cursor: "" },
          })
        );
      }
      if (url.pathname === "/api/files.getUploadURLExternal") {
        return Promise.resolve(
          Response.json({
            file_id: "F_RELEASE_ASSET",
            ok: true,
            upload_url: "https://files.slack.com/upload/v1/release-asset",
          })
        );
      }
      if (url.pathname === "/upload/v1/release-asset") {
        expect(init?.method).toBe("POST");
        expect(new Uint8Array(init?.body as ArrayBuffer)).toEqual(bytes);
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      if (url.pathname === "/api/files.completeUploadExternal") {
        completedUploads.push(JSON.parse(String(init?.body)));
        return Promise.resolve(Response.json({ files: [], ok: true }));
      }
      throw new Error(`Unexpected Slack API request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", slackFetch);
    const env = await buildEnv({ db, slackBotToken: "xoxb-test" });
    const request = {
      contentBase64: btoa(String.fromCharCode(...bytes)),
      contentSha256,
      context: buildCenterAgentContext({
        activeOrganizationId: "org-a",
        agentControllerConversationId: "remote_agent_submission_slack_file",
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        profileId: AGENT_PROFILE_ID,
        profileKind: "agent" as const,
        userId: "user-a",
      }),
      currentThread: true as const,
      fileName: "release-asset.txt",
      initialComment: "Attached release asset.",
      publicationSource: {
        executionId: "remote_agent_submission_slack_file",
        kind: "remote_agent_execution" as const,
      },
      speakerMember: { memberId: "member-a", userId: "user-a" },
      title: "Release asset",
    };

    await expect(
      rpcCenterAgentPostSlackFile(env, request)
    ).resolves.toMatchObject({
      channelName: "ok8-okok",
      file: {
        fileId: "F_RELEASE_ASSET",
        name: "release-asset.txt",
        sizeBytes: bytes.byteLength,
      },
      joinedChannel: false,
      organizationId: "org-a",
    });
    await expect(
      rpcCenterAgentPostSlackFile(env, request)
    ).resolves.toMatchObject({ file: { fileId: "F_RELEASE_ASSET" } });
    expect(completedUploads).toEqual([
      {
        channel_id: "C123",
        files: [{ id: "F_RELEASE_ASSET", title: "Release asset" }],
        initial_comment: "Attached release asset.",
        thread_ts: "1786979718.343639",
      },
    ]);
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "post_slack_file",
        resourceType: "slack_file",
      }),
    ]);
    const memberContext = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });
    await expect(
      rpcListCenterAgentAuditJournal(env, {
        actionSet: "v20",
        context: memberContext,
      })
    ).resolves.toEqual({ entries: [], organizationId: "org-a" });
    await expect(
      rpcListCenterAgentAuditJournal(env, {
        actionSet: "v21",
        context: memberContext,
      })
    ).resolves.toMatchObject({
      entries: [expect.objectContaining({ action: "post_slack_file" })],
      organizationId: "org-a",
    });
  });

  it("allows an exact Slack publication retry when the audit write fails before sending", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentAuditWriteFailures: 1,
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      slackWorkspaceBindings: [
        {
          createdAtMs: TEST_NOW_MS,
          organizationId: "org-a",
          slackTeamId: "T123",
          updatedAtMs: TEST_NOW_MS,
        },
      ],
    });
    const slackFetch = vi.fn<typeof fetch>((request) => {
      const pathname = new URL(String(request)).pathname;
      if (pathname === "/api/conversations.list") {
        return Promise.resolve(
          Response.json({
            channels: [
              {
                id: "C123",
                is_archived: false,
                is_member: true,
                is_private: false,
                name: "release",
              },
            ],
            ok: true,
            response_metadata: { next_cursor: "" },
          })
        );
      }
      if (pathname === "/api/chat.postMessage") {
        return Promise.resolve(
          Response.json({ ok: true, ts: "1710000000.002" })
        );
      }
      throw new Error(`Unexpected Slack API request: ${pathname}`);
    });
    vi.stubGlobal("fetch", slackFetch);
    const env = await buildEnv({ db, slackBotToken: "xoxb-test" });
    const request = {
      channelName: "#Release",
      context: buildCenterAgentContext({
        activeOrganizationId: "org-a",
        agentControllerConversationId: "remote_agent_submission_retry",
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        profileId: AGENT_PROFILE_ID,
        profileKind: "agent" as const,
        userId: "user-a",
      }),
      publicationSource: {
        executionId: "remote_agent_submission_retry",
        kind: "remote_agent_execution" as const,
      },
      speakerMember: { memberId: "member-a", userId: "user-a" },
      text: "The release is ready.",
    };

    await expect(
      rpcCenterAgentPostSlackChannelMessage(env, request)
    ).rejects.toThrow("Test Center Agent audit write failure.");
    expect(
      slackFetch.mock.calls.filter(
        ([slackRequest]) =>
          new URL(String(slackRequest)).pathname === "/api/chat.postMessage"
      )
    ).toHaveLength(0);

    await expect(
      rpcCenterAgentPostSlackChannelMessage(env, request)
    ).resolves.toMatchObject({
      messageTs: "1710000000.002",
    });
    expect(
      slackFetch.mock.calls.filter(
        ([slackRequest]) =>
          new URL(String(slackRequest)).pathname === "/api/chat.postMessage"
      )
    ).toHaveLength(1);
  });

  it("returns a clear next step when Slack is not connected", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });

    await expect(
      rpcCenterAgentReadSlackWorkspaceDirectory(await buildEnv({ db }), {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
      })
    ).resolves.toEqual({
      message: "Slack isn't connected to this Organization yet.",
      nextAction: "Open Center Agent → Channels and choose Connect Slack.",
      organizationId: "org-a",
      reasonCode: "slack_not_connected",
      status: "unavailable",
    });
    expect(await db.readCenterAgentAuditRows()).toEqual([]);
  });

  it("classifies Slack workspace membership by identity link before email", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      slackWorkspaceBindings: [
        {
          createdAtMs: TEST_NOW_MS,
          organizationId: "org-a",
          slackTeamId: "T123",
          updatedAtMs: TEST_NOW_MS,
        },
      ],
      slackUserIdentityLinks: [
        {
          createdAtMs: TEST_NOW_MS,
          organizationId: "org-a",
          slackTeamId: "T123",
          slackUserId: "U_MORGAN",
          source: "explicit",
          openmeldUserId: "user-a",
        },
      ],
    });
    const slackFetch = vi.fn<typeof fetch>((request) => {
      const url = new URL(String(request));
      expect(url.pathname).toBe("/api/users.list");
      return Promise.resolve(
        Response.json({
          members: [
            {
              deleted: false,
              id: "U_AVA",
              is_bot: false,
              name: "ava",
              profile: {
                display_name: "Ava",
                email: "USER-A@example.com",
                real_name: "Ava",
                title: "Founder",
              },
            },
            {
              deleted: false,
              id: "U_MORGAN",
              is_bot: false,
              name: "morgan",
              profile: {
                display_name: "Morgan",
                email: "user-b@example.com",
                real_name: "Morgan Lee",
                title: "Staff Engineer",
              },
            },
            {
              deleted: false,
              id: "U_PRIVATE",
              is_bot: false,
              is_restricted: true,
              name: "private",
              profile: {
                display_name: "Private Guest",
                real_name: "Private Guest",
              },
            },
          ],
          ok: true,
          response_metadata: { next_cursor: "" },
        })
      );
    });
    vi.stubGlobal("fetch", slackFetch);
    const env = await buildEnv({ db, slackBotToken: "xoxb-test" });

    await expect(
      rpcCenterAgentReadSlackWorkspaceDirectory(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        includeMemberUserId: true,
        limit: 200,
      })
    ).resolves.toMatchObject({
      members: [
        {
          displayName: "Ava",
          openMeldMembership: {
            matchedBy: "email",
            memberDisplayName: "Ava",
            memberUserId: "user-a",
            status: "member",
          },
        },
        {
          displayName: "Morgan",
          openMeldMembership: {
            matchedBy: "identity_link",
            memberDisplayName: "Ava",
            memberUserId: "user-a",
            status: "member",
          },
        },
        {
          displayName: "Private Guest",
          isGuest: true,
          openMeldMembership: {
            reason: "email_unavailable",
            status: "unknown",
          },
        },
      ],
      nextCursor: null,
      organizationId: "org-a",
    });
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "read_slack_workspace_directory",
        actorProfileId: AGENT_PROFILE_ID,
        organizationId: "org-a",
        resourceId: "T123",
        resourceType: "slack_workspace",
      }),
    ]);
    const memberContext = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });
    await expect(
      rpcListCenterAgentAuditJournal(env, {
        actionSet: "v5",
        context: memberContext,
      })
    ).resolves.toEqual({ entries: [], organizationId: "org-a" });
    await expect(
      rpcListCenterAgentAuditJournal(env, {
        actionSet: "v6",
        context: memberContext,
      })
    ).resolves.toMatchObject({
      entries: [
        expect.objectContaining({
          action: "read_slack_workspace_directory",
        }),
      ],
      organizationId: "org-a",
    });
  });

  it("lists Slack channels with the Center Agent membership state", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      slackWorkspaceBindings: [
        {
          createdAtMs: TEST_NOW_MS,
          organizationId: "org-a",
          slackTeamId: "T123",
          updatedAtMs: TEST_NOW_MS,
        },
      ],
    });
    const slackFetch = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          channels: [
            {
              id: "C_OK8",
              is_archived: false,
              is_member: true,
              is_private: false,
              name: "ok8-okok",
              num_members: 12,
            },
          ],
          ok: true,
          response_metadata: { next_cursor: "" },
        })
      )
    );
    vi.stubGlobal("fetch", slackFetch);
    const env = await buildEnv({ db, slackBotToken: "xoxb-test" });

    await expect(
      rpcCenterAgentListSlackChannels(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        limit: 100,
      })
    ).resolves.toMatchObject({
      channels: [
        {
          channelName: "ok8-okok",
          isMember: true,
          isPrivate: false,
          memberCount: 12,
        },
      ],
      nextCursor: null,
      organizationId: "org-a",
    });
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "list_slack_channels",
        actorProfileId: AGENT_PROFILE_ID,
        organizationId: "org-a",
        resourceId: "T123",
        resourceType: "slack_workspace",
      }),
    ]);
    const memberContext = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });
    await expect(
      rpcListCenterAgentAuditJournal(env, {
        actionSet: "v10",
        context: memberContext,
      })
    ).resolves.toEqual({ entries: [], organizationId: "org-a" });
    await expect(
      rpcListCenterAgentAuditJournal(env, {
        actionSet: "v11",
        context: memberContext,
      })
    ).resolves.toMatchObject({
      entries: [expect.objectContaining({ action: "list_slack_channels" })],
      organizationId: "org-a",
    });
  });

  it("reads human members only after proving the Center Agent is in the Slack channel", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      slackWorkspaceBindings: [
        {
          createdAtMs: TEST_NOW_MS,
          organizationId: "org-a",
          slackTeamId: "T123",
          updatedAtMs: TEST_NOW_MS,
        },
      ],
    });
    const slackFetch = vi.fn<typeof fetch>((request) => {
      const url = new URL(String(request));
      if (url.pathname === "/api/conversations.list") {
        return Promise.resolve(
          Response.json({
            channels: [
              {
                id: "C_OK8",
                is_archived: false,
                is_member: true,
                is_private: false,
                name: "ok8-okok",
              },
            ],
            ok: true,
            response_metadata: { next_cursor: "" },
          })
        );
      }
      if (url.pathname === "/api/conversations.members") {
        return Promise.resolve(
          Response.json({
            members: ["U_AVA", "U_MORGAN"],
            ok: true,
            response_metadata: { next_cursor: "" },
          })
        );
      }
      if (url.pathname === "/api/users.list") {
        return Promise.resolve(
          Response.json({
            members: [
              {
                deleted: false,
                id: "U_AVA",
                is_bot: false,
                name: "ava",
                profile: {
                  display_name: "Ava",
                  email: "USER-A@example.com",
                  real_name: "Ava",
                },
              },
              {
                deleted: false,
                id: "U_MORGAN",
                is_bot: false,
                name: "morgan",
                profile: {
                  display_name: "Morgan",
                  email: "morgan@example.com",
                  real_name: "Morgan Lee",
                },
              },
              {
                deleted: false,
                id: "U_NOT_IN_CHANNEL",
                is_bot: false,
                name: "outside",
                profile: { display_name: "Outside" },
              },
            ],
            ok: true,
            response_metadata: { next_cursor: "" },
          })
        );
      }
      throw new Error(`Unexpected Slack API request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", slackFetch);
    const env = await buildEnv({ db, slackBotToken: "xoxb-test" });

    await expect(
      rpcCenterAgentReadSlackChannelMembers(env, {
        channelName: "#ok8-okok",
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        includeChannelId: true,
        limit: 200,
      })
    ).resolves.toMatchObject({
      channelId: "C_OK8",
      channelName: "ok8-okok",
      members: [
        {
          displayName: "Ava",
          openMeldMembership: { status: "member" },
        },
        {
          displayName: "Morgan",
          openMeldMembership: { status: "not_member" },
        },
      ],
      nextCursor: null,
      organizationId: "org-a",
    });
    expect(
      slackFetch.mock.calls.some(
        ([request]) =>
          new URL(String(request)).pathname === "/api/conversations.join"
      )
    ).toBe(false);
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "read_slack_channel_members",
        resourceId: "C_OK8",
        resourceType: "slack_channel",
      }),
    ]);
  });

  it("reads Slack history only after proving the Center Agent is in the channel", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      slackWorkspaceBindings: [
        {
          createdAtMs: TEST_NOW_MS,
          organizationId: "org-a",
          slackTeamId: "T123",
          updatedAtMs: TEST_NOW_MS,
        },
      ],
    });
    const slackFetch = vi.fn<typeof fetch>((request) => {
      const url = new URL(String(request));
      if (url.pathname === "/api/conversations.list") {
        return Promise.resolve(
          Response.json({
            channels: [
              {
                id: "C_OK8",
                is_archived: false,
                is_member: true,
                is_private: false,
                name: "ok8-okok",
              },
            ],
            ok: true,
            response_metadata: { next_cursor: "" },
          })
        );
      }
      if (url.pathname === "/api/conversations.history") {
        return Promise.resolve(
          Response.json({
            messages: [
              {
                files: [
                  {
                    id: "F_RELEASE_NOTES",
                    mimetype: "text/markdown",
                    name: "release-notes.md",
                    permalink:
                      "https://openmeld-dev.slack.com/files/U_AVA/F_RELEASE_NOTES/release-notes",
                    size: 13,
                  },
                ],
                text: null,
                ts: "1710000004.000400",
                user: "U_AVA",
              },
              {
                text: "Latest release update",
                ts: "1710000003.000350",
                user: "U_AVA",
              },
              {
                bot_id: "B_CENTER_AGENT",
                bot_profile: { name: "OpenMeld Center Agent" },
                subtype: "bot_message",
                text: "Earlier summary",
                ts: "1710000002.000300",
              },
            ],
            ok: true,
            response_metadata: { next_cursor: "" },
          })
        );
      }
      if (url.pathname === "/api/users.list") {
        return Promise.resolve(
          Response.json({
            members: [
              {
                deleted: false,
                id: "U_AVA",
                is_bot: false,
                name: "ava",
                profile: { display_name: "Ava", real_name: "Ava" },
              },
            ],
            ok: true,
            response_metadata: { next_cursor: "" },
          })
        );
      }
      throw new Error(`Unexpected Slack API request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", slackFetch);
    const env = await buildEnv({ db, slackBotToken: "xoxb-test" });

    await expect(
      rpcCenterAgentReadSlackChannelHistory(env, {
        channelName: "ok8-okok",
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        expectedChannelId: "C_RENAMED",
        includeFiles: true,
        limit: 15,
      })
    ).rejects.toMatchObject({
      code: "slack.channel_identity_changed",
      status: 409,
    });

    await expect(
      rpcCenterAgentReadSlackChannelHistory(env, {
        channelName: "ok8-okok",
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        includeFiles: true,
        limit: 15,
      })
    ).resolves.toMatchObject({
      channelName: "ok8-okok",
      messages: [
        {
          authorDisplayName: "Ava",
          authorSlackUserId: "U_AVA",
          files: [
            {
              fileId: "F_RELEASE_NOTES",
              mimeType: "text/markdown",
              name: "release-notes.md",
              permalink:
                "https://openmeld-dev.slack.com/files/U_AVA/F_RELEASE_NOTES/release-notes",
              sizeBytes: 13,
            },
          ],
          isAuthorBot: false,
          text: null,
        },
        {
          authorDisplayName: "Ava",
          authorSlackUserId: "U_AVA",
          files: [],
          isAuthorBot: false,
          text: "Latest release update",
        },
        {
          authorDisplayName: "OpenMeld Center Agent",
          authorSlackUserId: null,
          files: [],
          isAuthorBot: true,
          text: "Earlier summary",
        },
      ],
      nextCursor: null,
      organizationId: "org-a",
    });
    const legacyCompatibleResponse =
      await rpcCenterAgentReadSlackChannelHistory(env, {
        channelName: "ok8-okok",
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        limit: 15,
      });
    expect(legacyCompatibleResponse).toMatchObject({
      channelName: "ok8-okok",
      messages: [
        expect.not.objectContaining({ files: expect.anything() }),
        expect.not.objectContaining({ files: expect.anything() }),
        expect.not.objectContaining({ files: expect.anything() }),
      ],
    });
    expect(
      slackFetch.mock.calls.some(
        ([request]) =>
          new URL(String(request)).pathname === "/api/conversations.join"
      )
    ).toBe(false);
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "read_slack_channel_history",
        resourceId: "C_OK8",
        resourceType: "slack_channel",
      }),
      expect.objectContaining({
        action: "read_slack_channel_history",
        resourceId: "C_OK8",
        resourceType: "slack_channel",
      }),
    ]);
  });

  it("downloads a Slack file only after Core confirms the connected channel owns it", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      slackWorkspaceBindings: [
        {
          createdAtMs: TEST_NOW_MS,
          organizationId: "org-a",
          slackTeamId: "T123",
          updatedAtMs: TEST_NOW_MS,
        },
      ],
    });
    const bytes = new TextEncoder().encode("release notes");
    const slackFetch = vi.fn<typeof fetch>((request) => {
      const url = new URL(String(request));
      if (url.pathname === "/api/conversations.list") {
        return Promise.resolve(
          Response.json({
            channels: [
              {
                id: "C_OK8",
                is_archived: false,
                is_member: true,
                is_private: false,
                name: "ok8-okok",
              },
            ],
            ok: true,
            response_metadata: { next_cursor: "" },
          })
        );
      }
      if (url.pathname === "/api/files.info") {
        return Promise.resolve(
          Response.json({
            file: {
              channels: ["C_OK8"],
              id: "F_RELEASE_NOTES",
              mimetype: "text/markdown",
              name: "release-notes.md",
              permalink:
                "https://openmeld-dev.slack.com/files/U_AVA/F_RELEASE_NOTES/release-notes",
              size: bytes.byteLength,
              url_private_download:
                "https://files.slack.com/files-pri/T123-F_RELEASE_NOTES/download/release-notes.md",
            },
            ok: true,
          })
        );
      }
      if (url.hostname === "files.slack.com") {
        return Promise.resolve(new Response(bytes));
      }
      throw new Error(`Unexpected Slack API request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", slackFetch);
    const env = await buildEnv({ db, slackBotToken: "xoxb-test" });

    await expect(
      rpcCenterAgentReadSlackFile(env, {
        channelName: "ok8-okok",
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        fileId: "F_RELEASE_NOTES",
      })
    ).resolves.toEqual({
      channelName: "ok8-okok",
      contentBase64: "cmVsZWFzZSBub3Rlcw==",
      file: {
        fileId: "F_RELEASE_NOTES",
        mimeType: "text/markdown",
        name: "release-notes.md",
        permalink:
          "https://openmeld-dev.slack.com/files/U_AVA/F_RELEASE_NOTES/release-notes",
        sizeBytes: bytes.byteLength,
      },
      organizationId: "org-a",
    });
    await expect(
      rpcCenterAgentReadSlackFile(env, {
        channelId: "C_OK8",
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        fileId: "F_RELEASE_NOTES",
      })
    ).resolves.toEqual({
      contentBase64: "cmVsZWFzZSBub3Rlcw==",
      file: {
        fileId: "F_RELEASE_NOTES",
        mimeType: "text/markdown",
        name: "release-notes.md",
        permalink:
          "https://openmeld-dev.slack.com/files/U_AVA/F_RELEASE_NOTES/release-notes",
        sizeBytes: bytes.byteLength,
      },
      organizationId: "org-a",
    });
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "read_slack_file",
        resourceId: "F_RELEASE_NOTES",
        resourceType: "slack_file",
      }),
      expect.objectContaining({
        action: "read_slack_file",
        resourceId: "F_RELEASE_NOTES",
        resourceType: "slack_file",
      }),
    ]);
    const memberContext = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });
    await expect(
      rpcListCenterAgentAuditJournal(env, {
        actionSet: "v20",
        context: memberContext,
      })
    ).resolves.toEqual({ entries: [], organizationId: "org-a" });
    await expect(
      rpcListCenterAgentAuditJournal(env, {
        actionSet: "v21",
        context: memberContext,
      })
    ).resolves.toMatchObject({
      entries: [
        expect.objectContaining({ action: "read_slack_file" }),
        expect.objectContaining({ action: "read_slack_file" }),
      ],
      organizationId: "org-a",
    });
  });

  it.each([
    "read_channel_file",
    "post_channel_file",
  ] as const)("keeps %s out of older client projections", async (action) => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const env = await buildEnv({ db });
    await rpcRecordCenterAgentAudit(env, {
      context: buildCenterAgentContext({
        activeOrganizationId: "org-a",
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        userId: "user-a",
        profileId: AGENT_PROFILE_ID,
        profileKind: "agent",
      }),
      action,
      resource: { id: "file", type: "feishu_file" },
    });
    const context = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });
    await expect(
      rpcListCenterAgentAuditJournal(env, { context, actionSet: "v21" })
    ).resolves.toMatchObject({ entries: [] });
    await expect(
      rpcListCenterAgentAuditJournal(env, { context, actionSet: "v22" })
    ).resolves.toMatchObject({
      entries: [expect.objectContaining({ action })],
    });
  });

  it("searches public Slack messages with authorization bound to the requester", async () => {
    const cryptoKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      slackWorkspaceBindings: [
        {
          createdAtMs: TEST_NOW_MS,
          organizationId: "org-a",
          slackTeamId: "T123",
          updatedAtMs: TEST_NOW_MS,
        },
      ],
    });
    const searchAuthorization = {
      encryptedAuthorization: await encryptSlackSearchAuthorization({
        actionToken: "event-bound-action-token",
        cryptoKey,
        memberId: "member-a",
        organizationId: "org-a",
        slackTeamId: "T123",
        slackUserId: "U123",
        sourceChannelId: "C_ORIGIN",
        sourceThreadTs: "1710000000.000100",
        openMeldUserId: "user-a",
      }),
    };
    const slackFetch = vi.fn<typeof fetch>((request, init) => {
      const pathname = new URL(String(request)).pathname;
      if (pathname === "/api/assistant.search.context") {
        expect(JSON.parse(String(init?.body))).toEqual({
          action_token: "event-bound-action-token",
          channel_types: ["public_channel"],
          content_types: ["messages"],
          include_bots: false,
          include_context_messages: true,
          limit: 8,
          query: "project gizmo status",
        });
        return Promise.resolve(
          Response.json({
            ok: true,
            response_metadata: { next_cursor: "" },
            results: {
              messages: [
                {
                  author_name: "Ava",
                  author_user_id: "U_AVA",
                  channel_id: "C_RELEASE",
                  channel_name: "release",
                  content: "The Gizmo release is ready.",
                  is_author_bot: false,
                  message_ts: "1710000000.001",
                  permalink:
                    "https://example.slack.com/archives/C_RELEASE/p1710000000001",
                  team_id: "T123",
                },
              ],
            },
          })
        );
      }
      throw new Error(`Unexpected Slack API request: ${pathname}`);
    });
    vi.stubGlobal("fetch", slackFetch);
    const env = await buildEnv({
      db,
      slackBotToken: "xoxb-test",
      slackTokenCryptoKey: cryptoKey,
    });
    const context = buildCenterAgentContext({
      activeOrganizationId: "org-a",
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      userId: "user-a",
    });

    await expect(
      rpcCenterAgentSearchSlackMessages(env, {
        context,
        includeBots: false,
        query: "project gizmo status",
        searchAuthorization,
        speakerMember: { memberId: "member-a", userId: "user-a" },
      })
    ).resolves.toEqual({
      messages: [
        {
          authorName: "Ava",
          authorUserId: "U_AVA",
          channelId: "C_RELEASE",
          channelName: "release",
          content: "The Gizmo release is ready.",
          contextMessages: [],
          isAuthorBot: false,
          messageTs: "1710000000.001",
          permalink:
            "https://example.slack.com/archives/C_RELEASE/p1710000000001",
        },
      ],
      moreResultsAvailable: false,
      organizationId: "org-a",
      status: "found",
    });
    expect(slackFetch).toHaveBeenCalledTimes(1);
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "search_slack_messages",
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        organizationId: "org-a",
        resourceId: "T123",
        resourceType: "slack_workspace",
      }),
    ]);
    const memberContext = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });
    await expect(
      rpcListCenterAgentAuditJournal(env, {
        actionSet: "v6",
        context: memberContext,
      })
    ).resolves.toEqual({ entries: [], organizationId: "org-a" });
    await expect(
      rpcListCenterAgentAuditJournal(env, {
        actionSet: "v7",
        context: memberContext,
      })
    ).resolves.toMatchObject({
      entries: [expect.objectContaining({ action: "search_slack_messages" })],
      organizationId: "org-a",
    });

    const fetchCallCount = slackFetch.mock.calls.length;
    await expect(
      rpcCenterAgentSearchSlackMessages(env, {
        context,
        includeBots: false,
        query: "project gizmo status",
        searchAuthorization: {
          encryptedAuthorization: await encryptSlackSearchAuthorization({
            actionToken: "event-bound-action-token",
            cryptoKey,
            memberId: "member-other",
            organizationId: "org-a",
            slackTeamId: "T123",
            slackUserId: "U123",
            sourceChannelId: "C_ORIGIN",
            sourceThreadTs: "1710000000.000100",
            openMeldUserId: "user-a",
          }),
        },
        speakerMember: { memberId: "member-a", userId: "user-a" },
      })
    ).resolves.toEqual({
      organizationId: "org-a",
      reason:
        "This Slack search authorization does not belong to the current requester or workspace.",
      status: "forbidden",
    });
    expect(slackFetch).toHaveBeenCalledTimes(fetchCallCount);

    await expect(
      rpcCenterAgentSearchSlackMessages(
        await buildEnv({ db, slackTokenCryptoKey: cryptoKey }),
        {
          context,
          includeBots: false,
          query: "project gizmo status",
          searchAuthorization,
          speakerMember: { memberId: "member-a", userId: "user-a" },
        }
      )
    ).resolves.toEqual({
      organizationId: "org-a",
      reason: "Slack search is unavailable right now. Try again later.",
      status: "unavailable",
    });
    expect(slackFetch).toHaveBeenCalledTimes(fetchCallCount);
  });

  it("returns a structured rate-limit result without leaking the Slack query into audit", async () => {
    const cryptoKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      slackWorkspaceBindings: [
        {
          createdAtMs: TEST_NOW_MS,
          organizationId: "org-a",
          slackTeamId: "T123",
          updatedAtMs: TEST_NOW_MS,
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json(
            { error: "ratelimited", ok: false },
            { headers: { "retry-after": "30" }, status: 429 }
          )
        )
      )
    );
    const env = await buildEnv({
      db,
      slackBotToken: "xoxb-test",
      slackTokenCryptoKey: cryptoKey,
    });
    const encryptedAuthorization = await encryptSlackSearchAuthorization({
      actionToken: "event-bound-action-token",
      cryptoKey,
      memberId: "member-a",
      organizationId: "org-a",
      slackTeamId: "T123",
      slackUserId: "U123",
      sourceChannelId: "C_ORIGIN",
      sourceThreadTs: "1710000000.000100",
      openMeldUserId: "user-a",
    });

    await expect(
      rpcCenterAgentSearchSlackMessages(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        query: "private launch details",
        searchAuthorization: {
          encryptedAuthorization,
        },
        speakerMember: { memberId: "member-a", userId: "user-a" },
      })
    ).resolves.toEqual({
      organizationId: "org-a",
      reason:
        "Slack search is temporarily rate limited. Wait before trying again.",
      retryAfterSeconds: 30,
      status: "rate_limited",
    });
    expect(JSON.stringify(await db.readCenterAgentAuditRows())).not.toContain(
      "private launch details"
    );
  });

  it("returns empty evidence without publishing a second Slack response", async () => {
    const cryptoKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      slackWorkspaceBindings: [
        {
          createdAtMs: TEST_NOW_MS,
          organizationId: "org-a",
          slackTeamId: "T123",
          updatedAtMs: TEST_NOW_MS,
        },
      ],
    });
    const slackFetch = vi.fn<typeof fetch>((request) => {
      const pathname = new URL(String(request)).pathname;
      if (pathname === "/api/assistant.search.context") {
        return Promise.resolve(
          Response.json({
            ok: true,
            response_metadata: { next_cursor: "" },
            results: { messages: [] },
          })
        );
      }
      throw new Error(`Unexpected Slack API request: ${pathname}`);
    });
    vi.stubGlobal("fetch", slackFetch);
    const env = await buildEnv({
      db,
      slackBotToken: "xoxb-test",
      slackTokenCryptoKey: cryptoKey,
    });
    const encryptedAuthorization = await encryptSlackSearchAuthorization({
      actionToken: "event-bound-action-token",
      cryptoKey,
      memberId: "member-a",
      organizationId: "org-a",
      slackTeamId: "T123",
      slackUserId: "U123",
      sourceChannelId: "C_ORIGIN",
      sourceThreadTs: "1710000000.000100",
      openMeldUserId: "user-a",
    });

    await expect(
      rpcCenterAgentSearchSlackMessages(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        query: "project gizmo status",
        searchAuthorization: {
          encryptedAuthorization,
        },
        speakerMember: { memberId: "member-a", userId: "user-a" },
      })
    ).resolves.toEqual({
      messages: [],
      moreResultsAvailable: false,
      organizationId: "org-a",
      status: "found",
    });
    expect(slackFetch).toHaveBeenCalledTimes(1);
  });

  it("records attributed connector write attempts and outcomes in Core", async () => {
    const connectionName = "github-user-a";
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      connectorConnection: {
        connectionName,
        organizationId: "org-a",
        scope: "member",
        service: "github",
        status: "active",
        userId: "user-a",
      },
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const env = await buildEnv({ db });
    const context = buildCenterAgentContext({
      activeOrganizationId: "org-a",
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      userId: "user-a",
    });

    await expect(
      rpcCenterAgentRecordConnectorActionAudit(env, {
        actionId: "github.create_issue",
        context,
        operationId: "batch:abcdef:0",
        outcome: "attempted",
        service: "github",
        speakerMember: { memberId: "member-missing", userId: "user-a" },
      })
    ).rejects.toMatchObject({
      code: "center_agent.member_actor_required",
      status: 403,
    });

    for (const [outcome, action] of [
      ["attempted", "execute_connector_action"],
      ["completed", "complete_connector_action"],
      ["failed", "fail_connector_action"],
      ["outcome_unknown", "record_connector_action_outcome_unknown"],
    ] as const) {
      await expect(
        rpcCenterAgentRecordConnectorActionAudit(env, {
          actionId: "github.create_issue",
          connectionName,
          context,
          operationId: `batch:abcdef:${outcome}`,
          outcome,
          service: "github",
          speakerMember: { memberId: "member-a", userId: "user-a" },
        })
      ).resolves.toMatchObject({
        attribution: {
          actorProfileId: AGENT_PROFILE_ID,
          onBehalfOf: { profileId: HUMAN_PROFILE_ID, userId: "user-a" },
        },
        recorded: true,
      });
      expect((await db.readCenterAgentAuditRows()).at(-1)).toMatchObject({
        action,
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        organizationId: "org-a",
        resourceId: `github:github.create_issue:batch:abcdef:${outcome}`,
        resourceType: "connector_action",
      });
    }

    const memberContext = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });
    await expect(
      rpcListCenterAgentAuditJournal(env, { context: memberContext })
    ).resolves.toEqual({ entries: [], organizationId: "org-a" });
    await expect(
      rpcListCenterAgentAuditJournal(env, {
        actionSet: "v4",
        context: memberContext,
      })
    ).resolves.toEqual({ entries: [], organizationId: "org-a" });
    await expect(
      rpcListCenterAgentAuditJournal(env, {
        actionSet: "v5",
        context: memberContext,
      })
    ).resolves.toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ action: "execute_connector_action" }),
        expect.objectContaining({ action: "complete_connector_action" }),
        expect.objectContaining({ action: "fail_connector_action" }),
        expect.objectContaining({
          action: "record_connector_action_outcome_unknown",
        }),
      ]),
      organizationId: "org-a",
    });
  });

  it("wakes Agent Profiles in a Space as the Center Agent", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "center-agent",
          profileId: AGENT_PROFILE_ID,
          profileName: "Center Agent",
          status: "active",
        },
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "launch-agent",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Launch Agent",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Launch Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({
      enforceAddressingTargetMembership: true,
      initialActiveMemberProfileIdsBySpace: {
        [JOINED_PRIVATE_SPACE_ID]: [
          HUMAN_PROFILE_ID,
          SECOND_AGENT_PROFILE_ID,
          SECOND_HUMAN_PROFILE_ID,
        ],
      },
      spaces: db.spaces,
    });
    const env = await buildEnv({ db, spaceStub });

    const wakeInput = {
      agentProfileIds: [SECOND_AGENT_PROFILE_ID],
      context: buildCenterAgentContext({
        activeOrganizationId: "org-a",
        profileId: AGENT_PROFILE_ID,
        profileKind: "agent" as const,
        requestId:
          "remote-agent-tool:openmeld_wake_agent_profiles_in_space:flue_submission_123",
        userId: "user-a",
      }),
      onBehalfOf: { profileId: HUMAN_PROFILE_ID },
      referenceProfileIds: [HUMAN_PROFILE_ID],
      spaceId: JOINED_PRIVATE_SPACE_ID,
      text: "Please review the launch checklist.",
    };
    const firstWake =
      await createCenterAgentRpcEntrypoint(
        env
      ).centerAgentWakeAgentProfilesInSpace(wakeInput);
    if (firstWake.publicationStatus === "pending") {
      throw new Error("direct Center Agent Wake must be accepted");
    }

    expect(firstWake).toMatchObject({
      agentProfileIds: [SECOND_AGENT_PROFILE_ID],
      attribution: {
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOf: {
          displayName: "Ava",
          profileId: HUMAN_PROFILE_ID,
          userId: "user-a",
        },
      },
      organizationId: "org-a",
      signal: {
        data: {
          messageEnvelope: {
            activationTargets: [SECOND_AGENT_PROFILE_ID],
            referenceTargets: [HUMAN_PROFILE_ID],
            text: "Please review the launch checklist.",
          },
          text: "Please review the launch checklist.",
        },
        profile: {
          kind: "agent",
          profileId: AGENT_PROFILE_ID,
          profileName: "Center Agent",
        },
        spaceId: JOINED_PRIVATE_SPACE_ID,
        type: "signal.text",
      },
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });
    expect(firstWake.signal.data.meta?.clientMessageId).toMatch(
      CENTER_AGENT_WAKE_CLIENT_MESSAGE_ID_PATTERN
    );
    expect(spaceStub.rpcPostSignal).toHaveBeenCalledTimes(1);
    expect(spaceStub.rpcPostSignalOnceByClientMessageId).toHaveBeenCalledWith(
      expect.objectContaining({
        authoringPolicy: "user_authored",
        clientMessageId: firstWake.signal.data.meta?.clientMessageId,
        messageEnvelope: {
          activationTargets: [SECOND_AGENT_PROFILE_ID],
          referenceTargets: [HUMAN_PROFILE_ID],
          text: "Please review the launch checklist.",
        },
        meta: {
          clientMessageId: firstWake.signal.data.meta?.clientMessageId,
        },
        spaceId: JOINED_PRIVATE_SPACE_ID,
        text: "Please review the launch checklist.",
      })
    );
    const secondWake = await rpcCenterAgentWakeAgentProfilesInSpace(
      env,
      wakeInput
    );
    if (secondWake.publicationStatus === "pending") {
      throw new Error("idempotent Center Agent Wake must remain accepted");
    }
    expect(secondWake.signal.id).toBe(firstWake.signal.id);
    expect(spaceStub.rpcPostSignalOnceByClientMessageId).toHaveBeenCalledTimes(
      2
    );
    expect(spaceStub.rpcPostSignal).toHaveBeenCalledTimes(1);
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "wake_agent_profiles_in_space",
        actorProfileId: AGENT_PROFILE_ID,
        id: `center-agent-wake:${firstWake.signal.data.meta?.clientMessageId}`,
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        organizationId: "org-a",
        resourceId: JOINED_PRIVATE_SPACE_ID,
        resourceType: "space",
      }),
    ]);

    const legacyCompatibleWake = await rpcCenterAgentWakeAgentProfilesInSpace(
      env,
      {
        ...wakeInput,
        referenceProfileIds: undefined,
      }
    );
    if (legacyCompatibleWake.publicationStatus === "pending") {
      throw new Error("direct Center Agent Wake must be accepted");
    }
    expect(legacyCompatibleWake.signal.data.meta?.clientMessageId).toBe(
      "ca-wake:4sm6ik41xte2"
    );

    const alternateReferenceWake = await rpcCenterAgentWakeAgentProfilesInSpace(
      env,
      {
        ...wakeInput,
        referenceProfileIds: [SECOND_HUMAN_PROFILE_ID],
      }
    );
    if (alternateReferenceWake.publicationStatus === "pending") {
      throw new Error("direct Center Agent Wake must be accepted");
    }
    expect(alternateReferenceWake.signal.data.meta?.clientMessageId).not.toBe(
      firstWake.signal.data.meta?.clientMessageId
    );
    expect(alternateReferenceWake.signal.data.meta?.clientMessageId).not.toBe(
      legacyCompatibleWake.signal.data.meta?.clientMessageId
    );

    const currentWake = await rpcCenterAgentWakeAgentProfilesInSpace(env, {
      ...wakeInput,
      mentionProfileIds: [],
    });
    if (currentWake.publicationStatus === "pending") {
      throw new Error("direct Center Agent Wake must be accepted");
    }
    expect(currentWake.signal.data.meta?.clientMessageId).not.toBe(
      firstWake.signal.data.meta?.clientMessageId
    );
    expect(
      spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({ spaceAddressingVersion: "1" })
    );
  });

  it("rejects a direct Center Agent Wake after a mentioned Human is removed", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow(),
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "launch-agent",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Launch Agent",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Launch Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({
      enforceAddressingTargetMembership: true,
      initialActiveMemberProfileIdsBySpace: {
        [JOINED_PRIVATE_SPACE_ID]: [HUMAN_PROFILE_ID, SECOND_AGENT_PROFILE_ID],
      },
      spaces: db.spaces,
    });
    await spaceStub.rpcRemoveMembers({
      memberProfileIds: [HUMAN_PROFILE_ID],
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });

    await expect(
      rpcCenterAgentWakeAgentProfilesInSpace(
        await buildEnv({ db, spaceStub }),
        {
          agentProfileIds: [SECOND_AGENT_PROFILE_ID],
          context: buildCenterAgentContext({
            activeOrganizationId: "org-a",
            profileId: AGENT_PROFILE_ID,
            profileKind: "agent",
            requestId:
              "remote-agent-tool:openmeld_wake_agent_profiles_in_space:removed_reference",
            userId: "user-a",
          }),
          mentionProfileIds: [HUMAN_PROFILE_ID],
          onBehalfOf: { profileId: HUMAN_PROFILE_ID },
          referenceProfileIds: [],
          spaceId: JOINED_PRIVATE_SPACE_ID,
          text: "Review with the removed member as context.",
        }
      )
    ).rejects.toMatchObject({
      code: "space.addressing.target_invalid",
      status: 422,
    });
    expect(spaceStub.rpcPostSignalOnceByClientMessageId).toHaveBeenCalledTimes(
      1
    );
  });

  it("preserves Human Mentions and Agent References through a delegated Center Agent Wake", async () => {
    const planningAgentProfileId = "agt_00000000-0000-4000-8000-000000000009";
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow(),
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "reviewer",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Reviewer",
          status: "active",
        },
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "planner",
          profileId: planningAgentProfileId,
          profileName: "Planner",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      nativeDeliveries: [
        nativeDeliveryLedgerRow({
          deliveryId: "delivery-delegated-references-parent",
          submissionId: "submission-parent",
        }),
      ],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Launch Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({
      enforceAddressingTargetMembership: true,
      initialActiveMemberProfileIdsBySpace: {
        [JOINED_PRIVATE_SPACE_ID]: [
          HUMAN_PROFILE_ID,
          planningAgentProfileId,
          SECOND_AGENT_PROFILE_ID,
        ],
      },
      spaces: db.spaces,
    });
    const env = await buildEnv({ db, spaceStub });
    const preparePublication = vi
      .spyOn(
        centerAgentWakePublicationService,
        "prepareCenterAgentWakePublication"
      )
      .mockImplementation(
        async ({
          command,
          nowMs,
        }): Promise<CenterAgentWakePublicationRecord> => ({
          acceptedAtMs: null,
          attemptCount: 0,
          claimExpiresAtMs: null,
          claimId: null,
          command,
          completedAtMs: null,
          createdAtMs: nowMs,
          delegationId: command.delegationId,
          lastError: null,
          nextAttemptAtMs: nowMs,
          organizationId: command.organizationId,
          publicationId: command.clientMessageId,
          signal: null,
          spaceId: command.spaceId,
          state: "pending",
          updatedAtMs: nowMs,
        })
      );
    vi.spyOn(
      centerAgentWakePublicationService,
      "executeCenterAgentWakePublication"
    ).mockImplementation(async ({ publishSignal }) => {
      const command = preparePublication.mock.calls[0]?.[0].command;
      if (!command) {
        throw new Error("delegated Wake command was not prepared");
      }
      const signal = await publishSignal(command);
      if (signal.type !== "signal.text") {
        throw new Error("delegated Wake must publish a text signal");
      }
      return {
        attribution: command.attribution,
        signal,
        status: "accepted",
      };
    });

    const wake = await createCenterAgentRpcEntrypoint(
      env
    ).centerAgentWakeAgentProfilesInSpace({
      agentProfileIds: [SECOND_AGENT_PROFILE_ID],
      completionMode: "resume_parent_when_all_terminal",
      context: {
        ...buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          requestId:
            "remote-agent-tool:openmeld_wake_agent_profiles_in_space:delegated_reference",
          userId: "user-a",
        }),
        agentControllerConversationId: "submission-parent",
      },
      mentionProfileIds: [HUMAN_PROFILE_ID],
      onBehalfOf: { profileId: HUMAN_PROFILE_ID },
      referenceProfileIds: [planningAgentProfileId],
      spaceId: JOINED_PRIVATE_SPACE_ID,
      text: "Review the launch checklist with Ava as context.",
    });

    if (wake.publicationStatus === "pending") {
      throw new Error("delegated Center Agent Wake must be accepted");
    }
    expect(preparePublication).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({
          activationTargets: [SECOND_AGENT_PROFILE_ID],
          mentionTargets: [HUMAN_PROFILE_ID],
          referenceTargets: [planningAgentProfileId],
          spaceAddressingVersion: "1",
        }),
      })
    );
    expect(wake.childTasks).toEqual([
      expect.objectContaining({
        task: expect.objectContaining({
          targetProfileId: SECOND_AGENT_PROFILE_ID,
        }),
      }),
    ]);
    expect(
      wake.childTasks?.some(
        (child) =>
          child.task.targetProfileId === HUMAN_PROFILE_ID ||
          child.task.targetProfileId === planningAgentProfileId
      )
    ).toBe(false);
    expect(wake.signal.data.messageEnvelope).toEqual({
      activationTargets: [SECOND_AGENT_PROFILE_ID],
      mentionTargets: [HUMAN_PROFILE_ID],
      referenceTargets: [planningAgentProfileId],
      text: "Review the launch checklist with Ava as context.",
    });
  });

  it("keeps accepted delegated publications idempotent while validating new retries", async () => {
    const spaceStub = createSpaceStub({
      enforceAddressingTargetMembership: true,
      initialActiveMemberProfileIdsBySpace: {
        [JOINED_PRIVATE_SPACE_ID]: [HUMAN_PROFILE_ID, SECOND_AGENT_PROFILE_ID],
      },
    });
    const env = await buildEnv({
      nativeDeliveries: [
        nativeDeliveryLedgerRow({
          deliveryId: "delivery-idempotent-publication-parent",
          submissionId: "submission-parent",
        }),
      ],
      spaceStub,
    });

    const publicationInput: Parameters<
      typeof rpcPostCenterAgentWakePublicationSignal
    >[1] = {
      activationTargets: [SECOND_AGENT_PROFILE_ID],
      attribution: {
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOf: {
          displayName: "Ava",
          profileId: HUMAN_PROFILE_ID,
          userId: "user-a",
        },
      },
      clientMessageId: "ca-wake:delegated-reference",
      completionMode: "resume_parent_when_all_terminal",
      context: {
        ...buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        agentControllerConversationId: "submission-parent",
      },
      delegationId: "delegation-1",
      fallbackAgentProfileId: null,
      organizationId: "org-a",
      parentSubmissionId: "submission-parent",
      profile: {
        kind: "agent",
        profileId: AGENT_PROFILE_ID,
        profileName: "Center Agent",
      },
      mentionTargets: [HUMAN_PROFILE_ID],
      referenceTargets: [],
      spaceId: JOINED_PRIVATE_SPACE_ID,
      subscriptionIds: ["subscription-1"],
      text: "Review the launch checklist with Ava as context.",
      v: 1,
    };
    const signal = await rpcPostCenterAgentWakePublicationSignal(
      env,
      publicationInput
    );
    const retrySignal = await rpcPostCenterAgentWakePublicationSignal(
      env,
      publicationInput
    );

    expect(signal).toMatchObject({
      data: {
        messageEnvelope: {
          activationTargets: [SECOND_AGENT_PROFILE_ID],
          mentionTargets: [HUMAN_PROFILE_ID],
          referenceTargets: [],
        },
      },
    });
    expect(spaceStub.rpcPostSignalOnceByClientMessageId).toHaveBeenCalledWith(
      expect.objectContaining({
        messageEnvelope: {
          activationTargets: [SECOND_AGENT_PROFILE_ID],
          mentionTargets: [HUMAN_PROFILE_ID],
          referenceTargets: [],
          text: "Review the launch checklist with Ava as context.",
        },
      })
    );
    expect(retrySignal.id).toBe(signal.id);

    await spaceStub.rpcRemoveMembers({
      memberProfileIds: [HUMAN_PROFILE_ID],
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });
    const acceptedAfterRemoval = await rpcPostCenterAgentWakePublicationSignal(
      env,
      publicationInput
    );
    expect(acceptedAfterRemoval.id).toBe(signal.id);

    const unpublishedRetryInput = {
      ...publicationInput,
      clientMessageId: "ca-wake:delegated-reference-unpublished",
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        rpcPostCenterAgentWakePublicationSignal(env, unpublishedRetryInput)
      ).rejects.toMatchObject({
        code: "space.addressing.target_invalid",
        status: 422,
      });
    }
    expect(spaceStub.rpcPostSignalOnceByClientMessageId).toHaveBeenCalledTimes(
      5
    );
    expect(spaceStub.rpcPostSignal).toHaveBeenCalledTimes(1);
  });

  it("rejects Center Agent Space wake attribution to the Center Agent itself", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "center-agent",
          profileId: AGENT_PROFILE_ID,
          profileName: "Center Agent",
          status: "active",
        },
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "launch-agent",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Launch Agent",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Launch Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentWakeAgentProfilesInSpace(env, {
        agentProfileIds: [SECOND_AGENT_PROFILE_ID],
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        onBehalfOf: { profileId: AGENT_PROFILE_ID },
        spaceId: JOINED_PRIVATE_SPACE_ID,
        text: "Please review the launch checklist.",
      })
    ).rejects.toMatchObject({
      code: "center_agent.on_behalf_of_center_agent_disallowed",
      status: 400,
    });
    expect(spaceStub.rpcPostSignalOnceByClientMessageId).not.toHaveBeenCalled();
    expect(await db.readCenterAgentAuditRows()).toEqual([]);
  });

  it("reads Space context through the Center Agent bootstrap contract", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Launch Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentReadSpaceContext(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        limit: 25,
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    ).resolves.toMatchObject({
      bootstrap: {
        history: { nextCursor: null, signals: [] },
        status: { name: "Launch Room", spaceId: JOINED_PRIVATE_SPACE_ID },
        threads: { previews: [], threads: [] },
      },
      organizationId: "org-a",
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });
    expect(spaceStub.rpcGetBootstrapWithTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 25,
        recent: true,
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    );
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "read_space_context",
        actorProfileId: AGENT_PROFILE_ID,
        organizationId: "org-a",
        resourceId: JOINED_PRIVATE_SPACE_ID,
        resourceType: "space",
      }),
    ]);
  });

  it("preserves Human Mentions for current Center Agent context reads without changing legacy reads", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Launch Room",
          visibility: "private",
        }),
      ],
    });
    const text = "Ava, please review the launch notes.";
    const mentionedSignal: SignalTextEnvelope = {
      ...createTextSignal({
        id: "signal-human-mention",
        text,
        ts: TEST_NOW_MS,
      }),
      data: {
        messageEnvelope: {
          activationTargets: [],
          mentionTargets: [HUMAN_PROFILE_ID],
          referenceTargets: [],
          text,
        },
        text,
      },
    };
    const env = await buildEnv({
      db,
      spaceStub: createSpaceStub({
        initialSignals: [mentionedSignal],
        spaces: db.spaces,
      }),
    });
    const context = buildCenterAgentContext({
      activeOrganizationId: "org-a",
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      userId: "user-a",
    });
    const entrypoint = createCenterAgentRpcEntrypoint(env);

    const current = await entrypoint.centerAgentReadSpaceContext({
      context,
      requestedAddressingModel: "wake_reference_mention",
      scope: "history",
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });
    const legacy = await entrypoint.centerAgentReadSpaceContext({
      context,
      scope: "history",
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });

    expect(current).toMatchObject({
      context: {
        signals: [
          {
            data: {
              messageEnvelope: {
                mentionTargets: [HUMAN_PROFILE_ID],
                referenceTargets: [],
              },
            },
          },
        ],
      },
    });
    expect(legacy).toMatchObject({
      context: {
        signals: [
          {
            data: {
              messageEnvelope: {
                ccTargets: [],
                referenceTargets: [HUMAN_PROFILE_ID],
              },
            },
          },
        ],
      },
    });
  });

  it("uses the Center Agent's own Space access when listing shared files", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Launch Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentListSpaceFiles(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        parentId: null,
        spaceId: JOINED_PRIVATE_SPACE_ID,
        view: "trash",
      })
    ).resolves.toMatchObject({
      capabilities: { canRead: true, canWrite: true },
      entries: [],
      parentId: null,
      spaceId: JOINED_PRIVATE_SPACE_ID,
      view: "trash",
    });
    expect(spaceStub.rpcListSpaceFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { parentId: null, view: "trash", origin: "artifact" },
        spaceAccess: expect.objectContaining({
          actor: expect.objectContaining({
            kind: "authenticated",
            requestContext: expect.objectContaining({
              actorContext: expect.objectContaining({
                openMeldProfileId: AGENT_PROFILE_ID,
              }),
            }),
          }),
        }),
      })
    );
  });

  it("projects Remote Agent file responses without display geometry and negotiates origin independently", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Launch Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const originBearingFile = {
      createdAt: "2026-08-23T00:00:00.000Z",
      createdBy: {
        displayName: "Ava",
        profileId: HUMAN_PROFILE_ID,
        profileKind: "human" as const,
      },
      id: "file-1",
      kind: "file" as const,
      latestRevision: {
        imageDimensions: { width: 300, height: 900 },
        createdAt: "2026-08-23T00:00:00.000Z",
        createdBy: {
          displayName: "Ava",
          profileId: HUMAN_PROFILE_ID,
          profileKind: "human" as const,
        },
        fileId: "file-1",
        id: "revision-1",
        mimeType: "text/markdown",
        revision: 1,
        sizeBytes: 12,
      },
      name: "brief.md",
      origin: "artifact" as const,
      parentId: null,
      path: "/brief.md",
      spaceId: JOINED_PRIVATE_SPACE_ID,
      trashedAt: null,
      trashedBy: null,
      updatedAt: "2026-08-23T00:00:00.000Z",
      updatedBy: {
        displayName: "Ava",
        profileId: HUMAN_PROFILE_ID,
        profileKind: "human" as const,
      },
    };
    spaceStub.rpcListSpaceFiles.mockResolvedValue({
      breadcrumbs: [{ id: null, name: "Files" }],
      capabilities: { canRead: true as const, canWrite: true },
      entries: [originBearingFile],
      origin: "artifact" as const,
      parentId: null,
      spaceId: JOINED_PRIVATE_SPACE_ID,
      view: "active" as const,
    } as unknown as Awaited<ReturnType<typeof spaceStub.rpcListSpaceFiles>>);
    const env = await buildEnv({ db, spaceStub });
    const context = buildCenterAgentContext({
      activeOrganizationId: "org-a",
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      userId: "user-a",
    });
    const entrypoint = createCenterAgentRpcEntrypoint(env);

    // An already-published Remote Agent has no `requestedOriginModel` field
    // and never sends it — this is exactly that shape.
    const legacy = await entrypoint.centerAgentListSpaceFiles({
      context,
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });
    const current = await entrypoint.centerAgentListSpaceFiles({
      context,
      requestedOriginModel: "origin_aware",
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });

    expect(JSON.stringify(legacy)).not.toContain("origin");
    expect(legacy.entries[0]).not.toHaveProperty("origin");
    expect(current).toMatchObject({
      entries: [{ origin: "artifact" }],
      origin: "artifact",
    });
    expect(JSON.stringify(legacy)).not.toContain("imageDimensions");
    expect(JSON.stringify(current)).not.toContain("imageDimensions");
    expect(originBearingFile.latestRevision.imageDimensions).toEqual({
      width: 300,
      height: 900,
    });
  });

  it("rejects Center Agent Space context reads outside the active Organization", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-b",
          spaceId: OTHER_ORG_PUBLIC_SPACE_ID,
          spaceName: "Other Org Room",
          visibility: "public",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentReadSpaceContext(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        spaceId: OTHER_ORG_PUBLIC_SPACE_ID,
      })
    ).rejects.toMatchObject({
      code: "center_agent.space_org_mismatch",
      status: 403,
    });
    expect(spaceStub.rpcGetBootstrapWithTiming).not.toHaveBeenCalled();
  });

  it("returns a bounded delta without loading the broad Space bootstrap", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Launch Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentReadSpaceContext(env, {
        afterSignalId: "signal-anchor",
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        limit: 10,
        scope: "delta",
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    ).resolves.toEqual({
      context: {
        afterSignalId: "signal-anchor",
        scope: "delta",
        signals: [],
        truncated: false,
      },
      organizationId: "org-a",
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });
    expect(spaceStub.rpcListSignalsResult).toHaveBeenCalledWith(
      expect.objectContaining({
        afterSignalId: "signal-anchor",
        limit: 11,
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    );
    expect(spaceStub.rpcGetBootstrapWithTiming).not.toHaveBeenCalled();
  });

  it("keeps source, thread, and history reads exact, ordered, and explicit about truncation", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Launch Room",
          visibility: "private",
        }),
      ],
    });
    const threadId = "thr_11111111-1111-4111-8111-111111111111";
    const rootSignal = createTextSignal({
      id: "signal-root",
      text: "Root",
      ts: TEST_NOW_MS,
    });
    const firstReply = createTextSignal({
      id: "signal-reply-1",
      text: "First reply",
      ts: TEST_NOW_MS + 1,
    });
    const latestReply = createTextSignal({
      id: "signal-reply-2",
      text: `${"x".repeat(4000)}selected remainder`,
      ts: TEST_NOW_MS + 2,
    });
    // Public terminal notice captured by normal CLI history on 2026-10-09;
    // identifiers and text are anonymized, with the envelope shape retained.
    const failureNotice: Extract<
      SignalEnvelope,
      { type: "signal.system_notice" }
    > = {
      v: 1,
      id: "signal-failure-notice",
      spaceId: JOINED_PRIVATE_SPACE_ID,
      ts: TEST_NOW_MS + 3,
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      type: "signal.system_notice",
      data: {
        noticeType: "terminal_failure",
        actorProfileId: AGENT_PROFILE_ID,
        actorName: "Runner",
        dispatchId: "dispatch-refused",
        replyTo: {
          signalId: latestReply.id,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Runner",
          previewText: "Original message",
        },
        reasonCode: "usage_exhausted",
        failureStage: "execution",
        text: "The AI account used by Runner reached its Usage Limit.",
        generatedBy: "openmeld",
      },
    };
    const createdAt = new Date(TEST_NOW_MS).toISOString();
    const thread = {
      createdAt,
      createdByProfileId: HUMAN_PROFILE_ID,
      rootSignalId: rootSignal.id,
      spaceId: JOINED_PRIVATE_SPACE_ID,
      threadId,
      updatedAt: createdAt,
    };
    const placements = [
      {
        createdAt,
        placement: "root" as const,
        signalId: rootSignal.id,
        threadId,
      },
      {
        createdAt,
        placement: "thread" as const,
        signalId: firstReply.id,
        threadId,
      },
      {
        createdAt,
        placement: "thread" as const,
        signalId: latestReply.id,
        threadId,
      },
    ];
    const spaceStub = createSpaceStub({
      getThreadResponse: { rootSignal, thread },
      initialSignals: [rootSignal, firstReply, latestReply, failureNotice],
      listThreadSignalsResponse: {
        placements,
        signals: [rootSignal, firstReply, latestReply],
      },
      listThreadsResponse: {
        previews: [
          {
            placements,
            replyCount: 2,
            signals: [rootSignal, firstReply, latestReply],
            threadId,
          },
        ],
        threads: [thread],
      },
      spaces: db.spaces,
    });
    const env = await buildEnv({ db, spaceStub });
    const context = buildCenterAgentContext({
      activeOrganizationId: "org-a",
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      userId: "user-a",
    });

    const noticeRequest = {
      context,
      scope: "source_evidence" as const,
      sourceSignalId: failureNotice.id,
      spaceId: JOINED_PRIVATE_SPACE_ID,
    };
    const noticeEvidence = await rpcCenterAgentReadSpaceContext(
      env,
      noticeRequest
    );
    expect(noticeEvidence).toMatchObject({
      context: {
        scope: "source_evidence",
        message: {
          author: { profileKind: "system", profileName: "OpenMeld System" },
          content: { text: failureNotice.data.text, truncated: false },
          replyToSignalId: latestReply.id,
          sourceRef: {
            id: failureNotice.id,
            version: expect.stringMatching(EVIDENCE_VERSION_PATTERN),
          },
        },
        nextOffset: null,
      },
    });
    await expect(
      rpcCenterAgentReadSpaceContext(env, {
        ...noticeRequest,
        version: `sha256:${"0".repeat(64)}`,
      })
    ).rejects.toThrow("space.evidence_version_unavailable");

    const exactRequest = {
      context,
      scope: "source_evidence" as const,
      sourceSignalId: latestReply.id,
      spaceId: JOINED_PRIVATE_SPACE_ID,
    };
    const exact = await rpcCenterAgentReadSpaceContext(env, exactRequest);
    if (!("context" in exact) || exact.context.scope !== "source_evidence") {
      throw new Error("Expected an exact message page");
    }
    expect(exact.context.message.content.text).toBe("x".repeat(4000));
    expect(exact.context.nextOffset).toBe(4000);
    const version = exact.context.message.sourceRef.version;
    expect(version).toMatch(EVIDENCE_VERSION_PATTERN);
    await expect(
      rpcCenterAgentReadSpaceContext(env, {
        ...exactRequest,
        version,
        offset: 4000,
      })
    ).resolves.toMatchObject({
      context: {
        message: {
          content: { text: "selected remainder" },
          sourceRef: { version },
        },
        nextOffset: null,
      },
    });
    await expect(
      rpcCenterAgentReadSpaceContext(env, {
        ...exactRequest,
        version: `sha256:${"0".repeat(64)}`,
      })
    ).rejects.toThrow("space.evidence_version_unavailable");
    await expect(
      rpcCenterAgentReadSpaceContext(env, {
        ...exactRequest,
        offset: 4000,
      })
    ).rejects.toMatchObject({ code: "invalid_payload" });
    await expect(
      rpcCenterAgentReadSpaceContext(env, {
        context,
        scope: "thread_evidence",
        threadId,
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    ).resolves.toMatchObject({
      context: {
        scope: "thread_evidence",
        sourceRef: {
          kind: "thread",
          threadId,
          version: expect.stringMatching(EVIDENCE_VERSION_PATTERN),
        },
        truncated: true,
      },
    });

    await expect(
      rpcCenterAgentReadSpaceContext(env, {
        context,
        scope: "source",
        sourceSignalId: latestReply.id,
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    ).resolves.toMatchObject({
      context: {
        scope: "source",
        signals: [latestReply],
        sourceSignalId: latestReply.id,
        threadContext: {
          rootSignalId: rootSignal.id,
          threadId,
        },
        truncated: false,
      },
    });

    await expect(
      rpcCenterAgentReadSpaceContext(env, {
        context,
        limit: 3,
        scope: "thread",
        spaceId: JOINED_PRIVATE_SPACE_ID,
        threadId,
      })
    ).resolves.toMatchObject({
      context: {
        scope: "thread",
        signals: [rootSignal, firstReply, latestReply],
        threadId,
        truncated: false,
      },
    });

    await expect(
      rpcCenterAgentReadSpaceContext(env, {
        context,
        limit: 2,
        scope: "thread",
        spaceId: JOINED_PRIVATE_SPACE_ID,
        threadId,
      })
    ).resolves.toMatchObject({
      context: {
        scope: "thread",
        signals: [rootSignal, latestReply],
        threadId,
        truncated: true,
      },
    });

    await expect(
      rpcCenterAgentReadSpaceContext(env, {
        context,
        limit: 2,
        scope: "history",
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    ).resolves.toMatchObject({
      context: {
        scope: "history",
        signals: [latestReply, failureNotice],
        truncated: true,
      },
    });
    expect(spaceStub.rpcGetBootstrapWithTiming).not.toHaveBeenCalled();
  });

  it("reads recent dispatch history for a Space, including errorCode and errorMessage for a failed dispatch", async () => {
    // Fixture mirrors the real 2026-07-10 dogfooding incident (W-CA-CAP1):
    // errorCode "runtime.turn.failed" with an OpenAI 400 JSON errorMessage.
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      dispatchLedgerEntries: [
        {
          attemptCreatedAtMs: 1_700_000_000_000,
          attemptErrorCode: "runtime.turn.failed",
          attemptErrorMessage:
            '{"type":"error","error":{"type":"invalid_request_error","code":"invalid_value","message":"Invalid value: \'max\'. Supported values are: ...","param":"reasoning.effort"},"requestBody":{"prompt":"must-not-reach-center-agent"},"status":400}',
          attemptFinishedAtMs: 1_700_000_360_000,
          attemptId: "attempt-incident-1",
          attemptStartedAtMs: 1_700_000_010_000,
          attemptStatus: "failed_terminal",
          dispatchId: "dispatch-incident-1",
          firstSeenAtMs: 1_700_000_000_000,
          lastAttemptAtMs: 1_700_000_360_000,
          spaceId: JOINED_PRIVATE_SPACE_ID,
          status: "failed_terminal",
          targetProfileId: SECOND_AGENT_PROFILE_ID,
        },
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Launch Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    const response = await rpcCenterAgentReadDispatchHistory(env, {
      context: buildCenterAgentContext({
        activeOrganizationId: "org-a",
        profileId: AGENT_PROFILE_ID,
        profileKind: "agent",
        userId: "user-a",
      }),
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });
    expect(response).toMatchObject({
      entries: [
        {
          dispatchId: "dispatch-incident-1",
          latestAttempt: {
            errorCode: "runtime.turn.failed",
            errorMessage:
              "invalid_value (invalid_request_error): Invalid value: 'max'. Supported values are: ...",
            status: "failed_terminal",
          },
          status: "failed_terminal",
          targetProfileId: SECOND_AGENT_PROFILE_ID,
        },
      ],
      organizationId: "org-a",
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });
    expect(JSON.stringify(response)).not.toContain(
      "must-not-reach-center-agent"
    );
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "read_dispatch_history",
        actorProfileId: AGENT_PROFILE_ID,
        organizationId: "org-a",
        resourceId: JOINED_PRIVATE_SPACE_ID,
        resourceType: "space",
      }),
    ]);
  });

  it("rejects Center Agent dispatch history reads outside the active Organization", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      spaces: [
        spaceRow({
          organizationId: "org-b",
          spaceId: OTHER_ORG_PUBLIC_SPACE_ID,
          spaceName: "Other Org Room",
          visibility: "public",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentReadDispatchHistory(env, {
        context: buildCenterAgentContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
        spaceId: OTHER_ORG_PUBLIC_SPACE_ID,
      })
    ).rejects.toMatchObject({
      code: "center_agent.space_org_mismatch",
      status: 403,
    });
  });

  it("opens the Center Agent DM as one lazy private Space", async () => {
    const writeDataPoint = vi.fn();
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
      organizations: [
        {
          name: "Acme Labs",
          organizationId: "org-a",
          slug: "acme-labs",
        },
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({
      db,
      observability: { writeDataPoint },
      spaceStub,
      workerEnvironment: "test",
    });
    const memberContext = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });

    const first = await rpcOpenCenterAgentDirectMessageSpace(env, {
      context: memberContext,
    });
    const second = await rpcOpenCenterAgentDirectMessageSpace(env, {
      context: memberContext,
    });

    expect(first).toMatchObject({
      centerAgentProfileId: AGENT_PROFILE_ID,
      created: true,
      memberProfileId: HUMAN_PROFILE_ID,
      organizationId: "org-a",
    });
    expect(second).toMatchObject({
      centerAgentProfileId: AGENT_PROFILE_ID,
      created: false,
      memberProfileId: HUMAN_PROFILE_ID,
      organizationId: "org-a",
      spaceId: first.spaceId,
    });
    expect(
      db.spaces.filter((space) => space.spaceId === first.spaceId)
    ).toHaveLength(1);
    expect(spaceStub.rpcInitializeDirectMessageMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-a",
        pairKey: `${HUMAN_PROFILE_ID}:${AGENT_PROFILE_ID}`,
        purpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
        spaceId: first.spaceId,
        visibility: "private",
      })
    );
    expect(spaceStub.rpcPostMembers).toHaveBeenLastCalledWith(
      expect.objectContaining({
        members: expect.arrayContaining([
          expect.objectContaining({
            profileId: HUMAN_PROFILE_ID,
            profileKind: "human",
          }),
          expect.objectContaining({
            profileId: AGENT_PROFILE_ID,
            profileKind: "agent",
          }),
        ]),
        spaceId: first.spaceId,
      })
    );
    expect(spaceStub.rpcPostSignalOnceByClientMessageId).not.toHaveBeenCalled();
    expect(spaceStub.rpcInitializeDirectMessageMeta).toHaveBeenCalledTimes(1);
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledTimes(1);
    expect(spaceStub.rpcListSignals).not.toHaveBeenCalled();
    const reasonCodeIndex =
      OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS.indexOf("reasonCode");
    const requestIdIndex =
      OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS.indexOf("requestId");
    const reasonCodes = writeDataPoint.mock.calls.map(
      (call) => (call[0] as { blobs: string[] }).blobs[reasonCodeIndex]
    );
    expect(reasonCodes).toEqual([
      "membership",
      "designation",
      "human_member",
      "center_agent_member",
      "reusable_candidate_lookup",
      "legacy_candidate_lookup",
      "generation_count",
      "meta_upsert",
      "members_upsert",
      "direct_message_open",
      "response_validation",
      "total_created",
      "membership",
      "designation",
      "human_member",
      "center_agent_member",
      "reusable_candidate_lookup",
      "direct_message_open",
      "response_validation",
      "total_existing",
    ]);
    expect(
      writeDataPoint.mock.calls.every(
        (call) =>
          (call[0] as { blobs: string[] }).blobs[requestIdIndex] ===
          "request-org-rpc-test"
      )
    ).toBe(true);
  });

  it("lets an invited member initialize the Center Agent designation when opening the DM first", async () => {
    const agentProfiles: Parameters<
      typeof createOrganizationRpcDb
    >[0]["agentProfiles"] = [];
    const db = await createOrganizationRpcDb({
      agentProfiles,
      members: [
        memberRow("member-owner", "org-a", "owner-user", "owner"),
        memberRow("member-invitee", "org-a", "user-a", "member"),
      ],
      organizations: [
        {
          name: "Acme Labs",
          organizationId: "org-a",
          slug: "acme-labs",
        },
      ],
    });
    const authWorker = {
      ensureCenterAgentProfileInOrganization: vi.fn(() => {
        agentProfiles.push(managedCenterAgentProfileRow({}));
        return {
          ok: true,
          profile: {
            createdAt: "2026-07-06T00:00:00.000Z",
            createdByUserId: "owner-user",
            creatorProfileId: null,
            isDefault: false,
            lastUsedAt: null,
            managedRole: "center_agent",
            ownerUserId: null,
            profileHandle: "center-agent",
            profileKind: "agent",
            profileName: "Center Agent",
            source: "auth_bootstrap",
            status: "active",
            updatedAt: "2026-07-06T00:00:00.000Z",
            openMeldProfileId: AGENT_PROFILE_ID,
          },
        };
      }),
    };
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({
      authWorker,
      db,
      remoteAgentRuntimeEnabled: "true",
      spaceStub,
    });
    const inviteeContext = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });

    const inviteeOpen = await rpcOpenCenterAgentDirectMessageSpace(env, {
      context: inviteeContext,
    });
    const designationAfterInviteeOpen = await rpcGetCenterAgentDesignation(
      env,
      {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "owner-user",
        }),
      }
    );
    const ownerOpen = await rpcOpenCenterAgentDirectMessageSpace(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "owner-user",
      }),
    });

    expect(inviteeOpen).toMatchObject({
      centerAgentProfileId: AGENT_PROFILE_ID,
      created: true,
      memberProfileId: HUMAN_PROFILE_ID,
      organizationId: "org-a",
    });
    expect(designationAfterInviteeOpen).toMatchObject({
      designation: {
        agentProfileId: AGENT_PROFILE_ID,
        designatedBy: "user-a",
        organizationId: "org-a",
      },
      organizationId: "org-a",
    });
    expect(ownerOpen).toMatchObject({
      centerAgentProfileId: AGENT_PROFILE_ID,
      organizationId: "org-a",
    });
    expect(await db.centerAgentDesignations.size()).toBe(1);
    expect([...(await db.bindingRows.values())]).toEqual([
      expect.objectContaining({
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        agentProfileId: AGENT_PROFILE_ID,
        bindingState: "enabled_primary",
        createdByProfileId: HUMAN_PROFILE_ID,
        hostedRuntimeIdentityJson: JSON.stringify(
          HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
        ),
        ownerId: "org-a",
        ownerKind: "organization",
        runtimeKind: "hosted_center_agent",
        openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
      }),
    ]);
    expect(
      (await db.readCenterAgentAuditRows()).map((row) => row.action)
    ).toEqual(["designate_remote_center_agent"]);
    expect(
      authWorker.ensureCenterAgentProfileInOrganization
    ).toHaveBeenCalledTimes(1);
    expect(
      authWorker.ensureCenterAgentProfileInOrganization
    ).toHaveBeenCalledWith({
      organizationId: "org-a",
      createdByUserId: "user-a",
    });
    expect(spaceStub.rpcPostSignalOnceByClientMessageId).not.toHaveBeenCalled();
  });

  it("keeps the owner-first Center Agent designation bootstrap path working", async () => {
    const agentProfiles: Parameters<
      typeof createOrganizationRpcDb
    >[0]["agentProfiles"] = [];
    const db = await createOrganizationRpcDb({
      agentProfiles,
      members: [memberRow("member-owner", "org-a", "owner-user", "owner")],
      organizations: [
        {
          name: "Acme Labs",
          organizationId: "org-a",
          slug: "acme-labs",
        },
      ],
    });
    const authWorker = {
      ensureCenterAgentProfileInOrganization: vi.fn(() => {
        agentProfiles.push(managedCenterAgentProfileRow({}));
        return {
          ok: true,
          profile: {
            createdAt: "2026-07-06T00:00:00.000Z",
            createdByUserId: "owner-user",
            creatorProfileId: null,
            isDefault: false,
            lastUsedAt: null,
            managedRole: "center_agent",
            ownerUserId: null,
            profileHandle: "center-agent",
            profileKind: "agent",
            profileName: "Center Agent",
            source: "auth_bootstrap",
            status: "active",
            updatedAt: "2026-07-06T00:00:00.000Z",
            openMeldProfileId: AGENT_PROFILE_ID,
          },
        };
      }),
    };
    const env = await buildEnv({
      authWorker,
      db,
      remoteAgentRuntimeEnabled: "true",
      spaceStub: createSpaceStub({ spaces: db.spaces }),
    });

    const ownerOpen = await rpcOpenCenterAgentDirectMessageSpace(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "owner-user",
      }),
    });

    expect(ownerOpen).toMatchObject({
      centerAgentProfileId: AGENT_PROFILE_ID,
      created: true,
      organizationId: "org-a",
    });
    expect(await db.centerAgentDesignations.size()).toBe(1);
    expect([...(await db.bindingRows.values())]).toEqual([
      expect.objectContaining({
        agentProfileId: AGENT_PROFILE_ID,
        createdByProfileId: HUMAN_PROFILE_ID,
        ownerId: "org-a",
        ownerKind: "organization",
        runtimeKind: "hosted_center_agent",
      }),
    ]);
    expect(
      authWorker.ensureCenterAgentProfileInOrganization
    ).toHaveBeenCalledTimes(1);
  });

  it("classifies an unavailable Auth bootstrap RPC during DM open", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [],
      members: [memberRow("member-owner", "org-a", "owner-user", "owner")],
      organizations: [
        {
          name: "Acme Labs",
          organizationId: "org-a",
          slug: "acme-labs",
        },
      ],
    });
    const authWorker = {
      ensureCenterAgentProfileInOrganization: vi.fn(() =>
        Promise.reject(
          new Error("The RPC receiver does not implement the method")
        )
      ),
    };
    const env = await buildEnv({
      authWorker,
      db,
      remoteAgentRuntimeEnabled: "true",
      spaceStub: createSpaceStub({ spaces: db.spaces }),
    });
    const context = buildContext({
      activeOrganizationId: "org-a",
      requestId: "req-auth-bootstrap-dm-open",
      userId: "owner-user",
    });
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      await expect(
        rpcOpenCenterAgentDirectMessageSpace(env, { context })
      ).rejects.toMatchObject({
        cause: {
          code: "center_agent.profile_bootstrap_unavailable",
          status: 503,
        },
        code: "center_agent.profile_bootstrap_unavailable",
        status: 503,
      });
      expect(errorLog).toHaveBeenCalledWith(
        "[core.center_agent.profile_bootstrap_unavailable]",
        expect.objectContaining({
          event: "core.center_agent.profile_bootstrap_unavailable",
          organizationId: "org-a",
          createdByUserId: "owner-user",
          requestId: context.actorContext.requestId,
          stage: "auth_rpc",
        })
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it("rethrows an unrelated Auth bootstrap RPC rejection without changing its identity", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [],
      members: [memberRow("member-owner", "org-a", "owner-user", "owner")],
      organizations: [
        {
          name: "Acme Labs",
          organizationId: "org-a",
          slug: "acme-labs",
        },
      ],
    });
    const rejection = new Error("Auth bootstrap transport failed");
    const authWorker = {
      ensureCenterAgentProfileInOrganization: vi.fn(() =>
        Promise.reject(rejection)
      ),
    };
    const env = await buildEnv({
      authWorker,
      db,
      remoteAgentRuntimeEnabled: "true",
      spaceStub: createSpaceStub({ spaces: db.spaces }),
    });
    const context = buildContext({
      activeOrganizationId: "org-a",
      requestId: "req-auth-bootstrap-rejection",
      userId: "owner-user",
    });
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      await expect(
        rpcOpenCenterAgentDirectMessageSpace(env, { context })
      ).rejects.toBe(rejection);
      expect(errorLog).toHaveBeenCalledWith(
        "[core.center_agent.profile_bootstrap_unavailable]",
        expect.objectContaining({
          error: rejection.message,
          errorName: "Error",
          event: "core.center_agent.profile_bootstrap_unavailable",
          organizationId: "org-a",
          createdByUserId: "owner-user",
          requestId: context.actorContext.requestId,
          stage: "auth_rpc",
        })
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it("classifies an Auth bootstrap failure result while adding correlated diagnostics", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [],
      members: [memberRow("member-owner", "org-a", "owner-user", "owner")],
      organizations: [
        {
          name: "Acme Labs",
          organizationId: "org-a",
          slug: "acme-labs",
        },
      ],
    });
    const authWorker = {
      ensureCenterAgentProfileInOrganization: vi.fn(() => ({
        code: "profile.internal_error",
        message: "profile storage unavailable",
        ok: false,
      })),
    };
    const env = await buildEnv({
      authWorker,
      db,
      remoteAgentRuntimeEnabled: "true",
      spaceStub: createSpaceStub({ spaces: db.spaces }),
    });
    const context = buildContext({
      activeOrganizationId: "org-a",
      requestId: "req-auth-bootstrap-rejected",
      userId: "owner-user",
    });
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      await expect(
        rpcOpenCenterAgentDirectMessageSpace(env, { context })
      ).rejects.toMatchObject({
        code: "center_agent.profile.internal_error",
        status: 409,
      });
      expect(errorLog).toHaveBeenCalledWith(
        "[core.center_agent.profile_bootstrap_failed]",
        expect.objectContaining({
          authCode: "profile.internal_error",
          event: "core.center_agent.profile_bootstrap_failed",
          organizationId: "org-a",
          createdByUserId: "owner-user",
          requestId: context.actorContext.requestId,
          stage: "auth_result",
        })
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it("preserves the Center Agent designation and DM while paused", async () => {
    const agentProfiles = [managedCenterAgentProfileRow({})];
    const db = await createOrganizationRpcDb({
      agentProfiles,
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "owner-user",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-owner", "org-a", "owner-user", "owner"),
        memberRow("member-invitee", "org-a", "user-a", "member"),
      ],
    });
    const authWorker = {
      ensureCenterAgentProfileInOrganization: vi.fn(() => ({
        ok: true,
        profile: {
          createdAt: "2026-07-06T00:00:00.000Z",
          createdByUserId: "owner-user",
          creatorProfileId: null,
          isDefault: false,
          lastUsedAt: null,
          managedRole: "center_agent",
          ownerUserId: null,
          profileHandle: "center-agent",
          profileKind: "agent",
          profileName: "Center Agent",
          source: "auth_bootstrap",
          status: "active",
          updatedAt: "2026-07-06T00:00:00.000Z",
          openMeldProfileId: AGENT_PROFILE_ID,
        },
      })),
    };
    const env = await buildEnv({
      authWorker,
      db,
      remoteAgentRuntimeEnabled: "true",
      spaceStub: createSpaceStub({ spaces: db.spaces }),
    });

    await expect(
      rpcUpdateCenterAgentOperatingState(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "owner-user",
        }),
        operatingState: "paused",
      })
    ).resolves.toMatchObject({
      changed: true,
      operatingState: "paused",
    });
    await expect(
      rpcGetCenterAgentDesignation(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
      })
    ).resolves.toMatchObject({
      designation: {
        agentProfileId: AGENT_PROFILE_ID,
      },
      organizationId: "org-a",
    });
    await expect(
      rpcOpenCenterAgentDirectMessageSpace(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
      })
    ).resolves.toMatchObject({
      centerAgentProfileId: AGENT_PROFILE_ID,
      organizationId: "org-a",
    });

    expect(await db.centerAgentDesignations.size()).toBe(1);
    expect(
      authWorker.ensureCenterAgentProfileInOrganization
    ).not.toHaveBeenCalled();
    expect(await db.readCenterAgentAuditRows()).toEqual([
      expect.objectContaining({
        action: "pause_center_agent",
        actorProfileId: HUMAN_PROFILE_ID,
        organizationId: "org-a",
        resourceId: AGENT_PROFILE_ID,
        resourceType: "agent_profile",
      }),
    ]);
  });

  it("opens and reuses the personal Center Agent DM without publishing messages", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-personal",
          ownerUserId: null,
          profileHandle: "center",
          profileId: AGENT_PROFILE_ID,
          profileName: "Center Agent",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-personal",
        }),
      ],
      members: [memberRow("member-a", "org-personal", "user-a", "owner")],
      organizations: [
        {
          metadata: JSON.stringify({ personal: true }),
          name: "Ava's OpenMeld",
          organizationId: "org-personal",
          slug: "personal-user-a",
        },
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });
    const memberContext = buildContext({
      activeOrganizationId: "org-personal",
      profileName: "Ava Example",
      userId: "user-a",
    });

    const first = await rpcOpenCenterAgentDirectMessageSpace(env, {
      context: memberContext,
    });
    const second = await rpcOpenCenterAgentDirectMessageSpace(env, {
      context: memberContext,
    });

    expect(second.spaceId).toBe(first.spaceId);
    expect(spaceStub.rpcPostSignalOnceByClientMessageId).not.toHaveBeenCalled();
    expect(spaceStub.rpcListSignals).not.toHaveBeenCalled();
  });

  it("opens one Center Agent DM per Organization member", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-a", "org-a", "user-a", "member"),
        memberRow("member-b", "org-a", "user-b", "member"),
      ],
    });
    const env = await buildEnv({
      db,
      spaceStub: createSpaceStub({ spaces: db.spaces }),
    });

    const first = await rpcOpenCenterAgentDirectMessageSpace(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });
    const second = await rpcOpenCenterAgentDirectMessageSpace(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        profileId: SECOND_HUMAN_PROFILE_ID,
        profileName: "Ben",
        userId: "user-b",
      }),
    });

    expect(first.memberProfileId).toBe(HUMAN_PROFILE_ID);
    expect(second.memberProfileId).toBe(SECOND_HUMAN_PROFILE_ID);
    expect(first.spaceId).not.toBe(second.spaceId);
    expect(db.spaces.map((space) => space.directMessagePairKey).sort()).toEqual(
      [
        `${HUMAN_PROFILE_ID}:${AGENT_PROFILE_ID}`,
        `${SECOND_HUMAN_PROFILE_ID}:${AGENT_PROFILE_ID}`,
      ].sort()
    );
  });

  it("projects the current member Center Agent DM and removes it from the Organization Space directory", async () => {
    const centerAgentPairKey = `${HUMAN_PROFILE_ID}:${AGENT_PROFILE_ID}`;
    const ordinarySpaceId =
      "1111111111111111111111111111111111111111111111111111111111111111";
    const centerAgentDirectMessageSpaceId =
      "2222222222222222222222222222222222222222222222222222222222222222";
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
      spaces: [
        spaceRow({
          activeAgentCount: 1,
          activeHumanCount: 1,
          activeMemberCount: 2,
          directMessagePairKey: centerAgentPairKey,
          organizationId: "org-a",
          spaceId: centerAgentDirectMessageSpaceId,
          spaceName: "Ava and Codex",
          spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
          visibility: "private",
        }),
        spaceRow({
          organizationId: "org-a",
          spaceId: ordinarySpaceId,
          spaceName: "Project Room",
          visibility: "private",
        }),
      ],
      spaceMemberships: [
        spaceMembershipRow({
          addedAtMs: 1_700_000_100_000,
          ownerUserId: "user-a",
          profileId: HUMAN_PROFILE_ID,
          spaceId: centerAgentDirectMessageSpaceId,
        }),
        spaceMembershipRow({
          addedAtMs: 1_700_000_090_000,
          ownerUserId: "user-a",
          profileId: HUMAN_PROFILE_ID,
          spaceId: ordinarySpaceId,
        }),
      ],
    });
    const context = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });
    const env = await buildEnv({ db });

    await expect(
      rpcGetCenterAgentDirectMessageSpaceProjection(env, { context })
    ).resolves.toMatchObject({
      organizationId: "org-a",
      projection: {
        centerAgentProfileId: AGENT_PROFILE_ID,
        isCenterAgentDirectMessageSpace: true,
        memberProfileId: HUMAN_PROFILE_ID,
        organizationId: "org-a",
        spaceId: centerAgentDirectMessageSpaceId,
      },
    });

    const directory = await rpcGetCurrentOrganizationSpaceDirectory(env, {
      context,
    });
    expect(directory.spaces.map((space) => space.spaceId)).toEqual([
      ordinarySpaceId,
    ]);
  });

  it("keeps Center Agent GET projections read-only when no designation exists", async () => {
    const agentProfiles: Parameters<
      typeof createOrganizationRpcDb
    >[0]["agentProfiles"] = [];
    const db = await createOrganizationRpcDb({
      agentProfiles,
      members: [memberRow("member-owner", "org-a", "owner-user", "owner")],
      organizations: [
        {
          name: "Acme Labs",
          organizationId: "org-a",
          slug: "acme-labs",
        },
      ],
    });
    const authWorker = {
      ensureCenterAgentProfileInOrganization: vi.fn(() => {
        agentProfiles.push(managedCenterAgentProfileRow({}));
        return {
          ok: true,
          profile: {
            createdAt: "2026-07-06T00:00:00.000Z",
            createdByUserId: "owner-user",
            creatorProfileId: null,
            isDefault: false,
            lastUsedAt: null,
            managedRole: "center_agent",
            ownerUserId: null,
            profileHandle: "center-agent",
            profileKind: "agent",
            profileName: "Center Agent",
            source: "auth_bootstrap",
            status: "active",
            updatedAt: "2026-07-06T00:00:00.000Z",
            openMeldProfileId: AGENT_PROFILE_ID,
          },
        };
      }),
    };
    const env = await buildEnv({
      authWorker,
      db,
      remoteAgentRuntimeEnabled: "true",
    });
    const context = buildContext({
      activeOrganizationId: "org-a",
      userId: "owner-user",
    });

    await expect(
      rpcGetCenterAgentDesignation(env, { context })
    ).resolves.toMatchObject({
      designation: null,
      organizationId: "org-a",
    });
    await expect(
      rpcGetCenterAgentDirectMessageSpaceProjection(env, { context })
    ).resolves.toMatchObject({
      organizationId: "org-a",
      projection: null,
    });

    expect(
      authWorker.ensureCenterAgentProfileInOrganization
    ).not.toHaveBeenCalled();
    expect(agentProfiles).toEqual([]);
    expect(await db.centerAgentDesignations.size()).toBe(0);
    expect(await db.bindingRows.size()).toBe(0);
    expect(
      db.calls.filter((query) => MUTATION_QUERY_PATTERN.test(query.text))
    ).toEqual([]);
  });

  it("rejects extra members in a Center Agent DM while ordinary DMs still forward member adds", async () => {
    const centerAgentDirectMessageSpaceId =
      "3333333333333333333333333333333333333333333333333333333333333333";
    const ordinaryDirectMessageSpaceId =
      "4444444444444444444444444444444444444444444444444444444444444444";
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "planner",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Planner",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
      spaces: [
        spaceRow({
          activeAgentCount: 1,
          activeHumanCount: 1,
          activeMemberCount: 2,
          directMessagePairKey: `${HUMAN_PROFILE_ID}:${AGENT_PROFILE_ID}`,
          organizationId: "org-a",
          spaceId: centerAgentDirectMessageSpaceId,
          spaceName: "Ava and Codex",
          spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
          visibility: "private",
        }),
        spaceRow({
          activeAgentCount: 1,
          activeHumanCount: 1,
          activeMemberCount: 2,
          directMessagePairKey: `${HUMAN_PROFILE_ID}:${SECOND_AGENT_PROFILE_ID}`,
          organizationId: "org-a",
          spaceId: ordinaryDirectMessageSpaceId,
          spaceName: "Ava and Planner",
          spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });
    const context = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });
    const extraMember = {
      agentControllerRef: null,
      ownerName: "Ava",
      ownerUserId: "user-a",
      profileId: SECOND_AGENT_PROFILE_ID,
      profileKind: "agent" as const,
      profileName: "Planner",
    };

    await expect(
      rpcAddSpaceMembers(env, {
        context,
        members: [extraMember],
        spaceId: centerAgentDirectMessageSpaceId,
      })
    ).rejects.toMatchObject({
      code: "space.forbidden",
      status: 403,
    });
    expect(spaceStub.rpcPostMembers).not.toHaveBeenCalled();

    await expect(
      rpcAddSpaceMembers(env, {
        context,
        members: [
          {
            ...extraMember,
            profileId: AGENT_PROFILE_ID,
            profileName: "Codex",
          },
        ],
        spaceId: ordinaryDirectMessageSpaceId,
      })
    ).resolves.toMatchObject({
      addedMemberIds: [AGENT_PROFILE_ID],
    });
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        members: [
          expect.objectContaining({
            profileId: AGENT_PROFILE_ID,
          }),
        ],
        spaceId: ordinaryDirectMessageSpaceId,
      })
    );
  });

  it("keeps Space member writes inside the Agent Profile's canonical Organization", async () => {
    const spaceId =
      "abababababababababababababababababababababababababababababababab";
    const sameOrganizationAgentProfileId = AGENT_PROFILE_ID;
    const foreignAgentProfileId = SECOND_AGENT_PROFILE_ID;
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "same-org-agent",
          profileId: sameOrganizationAgentProfileId,
          profileName: "Same Organization Agent",
          status: "active",
        },
        {
          organizationId: "org-b",
          ownerUserId: "user-a",
          profileHandle: "foreign-agent",
          profileId: foreignAgentProfileId,
          profileName: "Foreign Agent",
          status: "active",
        },
      ],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
      spaces: [
        spaceRow({
          organizationId: "org-b",
          spaceId,
          spaceName: "Stale Organization B Projection",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId,
          spaceName: "Canonical Organization A Room",
          visibility: "private",
        }),
      ],
    });
    const env = await buildEnv({ db, spaceStub });
    const context = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });
    const sameOrganizationAgent = {
      agentControllerRef: null,
      ownerName: "Ava",
      ownerUserId: "user-a",
      profileId: sameOrganizationAgentProfileId,
      profileKind: "agent" as const,
      profileName: "Same Organization Agent",
    };
    const humanMember = {
      agentControllerRef: null,
      ownerName: "Ava",
      ownerUserId: "user-a",
      profileId: HUMAN_PROFILE_ID,
      profileKind: "human" as const,
      profileName: "Ava",
    };

    await expect(
      rpcAddSpaceMembers(env, {
        context,
        members: [sameOrganizationAgent, humanMember],
        password: "space-password",
        spaceId,
      })
    ).resolves.toMatchObject({
      addedMemberIds: [sameOrganizationAgentProfileId, HUMAN_PROFILE_ID],
    });
    expect(spaceStub.rpcGetMeta).toHaveBeenCalledWith({
      context,
      password: "space-password",
      spaceId,
    });
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledTimes(1);

    const foreignAgent = {
      ...sameOrganizationAgent,
      profileId: foreignAgentProfileId,
      profileName: "Foreign Agent",
    };
    // Exercise the Core DTO seam directly so an older Gateway/client cannot
    // bypass canonical Space and Agent Profile Organization validation.
    await expect(
      rpcAddSpaceMembers(env, {
        context,
        members: [foreignAgent],
        spaceId,
      })
    ).rejects.toMatchObject({
      code: "agent_profile.organization_mismatch",
      status: 403,
    });
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledTimes(1);

    await expect(
      rpcAddSpaceMembers(env, {
        context,
        members: [
          {
            ...sameOrganizationAgent,
            profileKind: "human",
          },
        ],
        spaceId,
      })
    ).rejects.toMatchObject({
      code: "space.member_profile_kind_mismatch",
      status: 409,
    });
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledTimes(1);

    spaceStub.rpcGetMeta.mockRejectedValueOnce(
      new Error("canonical Space metadata lookup failed")
    );
    await expect(
      rpcAddSpaceMembers(env, {
        context,
        members: [sameOrganizationAgent],
        spaceId,
      })
    ).rejects.toMatchObject({
      code: "space.organization_lookup_failed",
      status: 503,
    });
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledTimes(1);

    await db.fixture.operator.query(
      'REVOKE SELECT ON "openmeld"."openmeld_profiles" FROM openmeld_pg_runtime'
    );
    await expect(
      rpcAddSpaceMembers(env, {
        context,
        members: [sameOrganizationAgent],
        spaceId,
      })
    ).rejects.toMatchObject({
      code: "agent_profile.organization_lookup_failed",
      status: 503,
    });
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledTimes(1);
  });

  it("adds an ordinary Agent Profile and its owner Human Profile together", async () => {
    const spaceId =
      "acacacacacacacacacacacacacacacacacacacacacacacacacacacacacacacac";
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-b",
          profileHandle: "ben-planner",
          profileId: AGENT_PROFILE_ID,
          profileName: "Ben Planner",
          status: "active",
        },
      ],
      members: [
        memberRow("member-a", "org-a", "user-a", "member"),
        memberRow("member-b", "org-a", "user-b", "member"),
      ],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId,
          spaceName: "Planning",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });
    const context = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });

    await expect(
      rpcAddSpaceMembers(env, {
        context,
        members: [
          {
            agentControllerRef: null,
            ownerName: "Ben",
            ownerUserId: "user-b",
            profileId: AGENT_PROFILE_ID,
            profileKind: "agent",
            profileName: "Ben Planner",
          },
        ],
        spaceId,
      })
    ).resolves.toMatchObject({
      addedMemberIds: [AGENT_PROFILE_ID, SECOND_HUMAN_PROFILE_ID],
    });
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledWith({
      context,
      members: [
        expect.objectContaining({
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
        }),
        expect.objectContaining({
          ownerUserId: "user-b",
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Ben",
        }),
      ],
      spaceId,
    });
  });

  it("lets only the owner add their MemberAgent, still with the owner, once MemberAgents are on", async () => {
    const spaceId =
      "aeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeae";
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-b",
          profileHandle: "ben-planner",
          profileId: AGENT_PROFILE_ID,
          profileName: "Ben Planner",
          status: "active",
        },
      ],
      members: [
        memberRow("member-a", "org-a", "user-a", "member"),
        memberRow("member-b", "org-a", "user-b", "member"),
      ],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId,
          spaceName: "Planning",
          visibility: "private",
        }),
      ],
    });
    await db.fixture.operator.query(
      `INSERT INTO "openmeld"."member_agents" (id, organization_id, owner_user_id, harness_kind, source, created_at, updated_at) VALUES ('ma-ben', 'org-a', 'user-b', 'claude-code', 'detected', 1, 1)`
    );
    await db.fixture.operator.query(
      `UPDATE "openmeld"."openmeld_profiles" SET member_agent_id = 'ma-ben' WHERE profile_id = '${AGENT_PROFILE_ID}'`
    );
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });
    const agent = {
      agentControllerRef: null,
      ownerName: "Ben",
      ownerUserId: "user-b",
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent" as const,
      profileName: "Ben Planner",
    };
    memberAgentsFeature.enabled = true;
    try {
      await expect(
        rpcAddSpaceMembers(env, {
          context: buildContext({
            activeOrganizationId: "org-a",
            userId: "user-a",
          }),
          members: [agent],
          spaceId,
        })
      ).rejects.toMatchObject({
        code: "agent_access.request_required",
        status: 409,
      });
      expect(spaceStub.rpcPostMembers).not.toHaveBeenCalled();

      await expect(
        rpcAddSpaceMembers(env, {
          context: buildContext({
            activeOrganizationId: "org-a",
            userId: "user-b",
          }),
          members: [agent],
          spaceId,
        })
      ).resolves.toMatchObject({
        addedMemberIds: [AGENT_PROFILE_ID, SECOND_HUMAN_PROFILE_ID],
      });
      expect(spaceStub.rpcPostMembers).toHaveBeenCalledWith(
        expect.objectContaining({
          members: [
            expect.objectContaining({ profileId: AGENT_PROFILE_ID }),
            expect.objectContaining({
              ownerUserId: "user-b",
              profileId: SECOND_HUMAN_PROFILE_ID,
              profileKind: "human",
            }),
          ],
        })
      );
    } finally {
      memberAgentsFeature.enabled = false;
    }
  });

  it("does not expand managed Agent Profile membership to an owner Human", async () => {
    const spaceId =
      "adadadadadadadadadadadadadadadadadadadadadadadadadadadadadadadad";
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: null,
          profileHandle: "center-agent",
          profileId: AGENT_PROFILE_ID,
          profileName: "Center Agent",
          status: "active",
        },
      ],
      members: [
        memberRow("member-a", "org-a", "user-a", "member"),
        memberRow("member-b", "org-a", "user-b", "member"),
      ],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId,
          spaceName: "Managed agents",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });
    const context = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });

    await rpcAddSpaceMembers(env, {
      context,
      members: [
        {
          agentControllerRef: null,
          ownerName: "Ben",
          ownerUserId: "user-b",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Center Agent",
        },
      ],
      spaceId,
    });

    expect(spaceStub.rpcPostMembers).toHaveBeenCalledWith({
      context,
      members: [expect.objectContaining({ profileId: AGENT_PROFILE_ID })],
      spaceId,
    });
  });

  it("does not expand a designated Center Agent with legacy unmanaged identity", async () => {
    const spaceId =
      "aeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeae";
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: null,
          organizationId: "org-a",
          ownerUserId: "user-b",
          profileHandle: "legacy-center-agent",
          profileId: AGENT_PROFILE_ID,
          profileName: "Center Agent",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-a", "org-a", "user-a", "member"),
        memberRow("member-b", "org-a", "user-b", "member"),
      ],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId,
          spaceName: "Legacy Center Agent",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });
    const context = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });

    await rpcAddSpaceMembers(env, {
      context,
      members: [
        {
          agentControllerRef: null,
          ownerName: "Ben",
          ownerUserId: "user-b",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Center Agent",
        },
      ],
      spaceId,
    });

    expect(spaceStub.rpcPostMembers).toHaveBeenCalledWith({
      context,
      members: [expect.objectContaining({ profileId: AGENT_PROFILE_ID })],
      spaceId,
    });
  });

  it("rejects Center Agent DM member, lifecycle, and access mutations while ordinary DMs still forward them", async () => {
    const centerAgentDirectMessageSpaceId =
      "5555555555555555555555555555555555555555555555555555555555555555";
    const ordinaryDirectMessageSpaceId =
      "6666666666666666666666666666666666666666666666666666666666666666";
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "planner",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Planner",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
      spaces: [
        spaceRow({
          activeAgentCount: 1,
          activeHumanCount: 1,
          activeMemberCount: 2,
          directMessagePairKey: `${HUMAN_PROFILE_ID}:${AGENT_PROFILE_ID}`,
          organizationId: "org-a",
          spaceId: centerAgentDirectMessageSpaceId,
          spaceName: "Ava and Codex",
          spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
          visibility: "private",
        }),
        spaceRow({
          activeAgentCount: 1,
          activeHumanCount: 1,
          activeMemberCount: 2,
          directMessagePairKey: `${HUMAN_PROFILE_ID}:${SECOND_AGENT_PROFILE_ID}`,
          organizationId: "org-a",
          spaceId: ordinaryDirectMessageSpaceId,
          spaceName: "Ava and Planner",
          spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });
    const context = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });

    await expect(
      readCenterAgentDirectMessageForbiddenError(
        rpcRemoveSpaceMembers(env, {
          context,
          memberProfileIds: [HUMAN_PROFILE_ID],
          spaceId: centerAgentDirectMessageSpaceId,
        })
      )
    ).resolves.toMatchObject({
      code: "space.forbidden",
      message: expect.stringContaining(
        "Center Agent Direct Messages cannot remove members."
      ),
      status: 403,
    });
    await expect(
      readCenterAgentDirectMessageForbiddenError(
        rpcLeaveSpace(env, {
          context,
          spaceId: centerAgentDirectMessageSpaceId,
        })
      )
    ).resolves.toMatchObject({
      code: "space.forbidden",
      message: expect.stringContaining(
        "Center Agent Direct Messages cannot be left."
      ),
      status: 403,
    });
    await expect(
      readCenterAgentDirectMessageForbiddenError(
        rpcDeleteSpace(env, {
          context,
          spaceId: centerAgentDirectMessageSpaceId,
        })
      )
    ).resolves.toMatchObject({
      code: "space.forbidden",
      message: expect.stringContaining(
        "Center Agent Direct Messages cannot be deleted."
      ),
      status: 403,
    });
    await expect(
      readCenterAgentDirectMessageForbiddenError(
        rpcSetSpaceAccessMode(env, {
          accessMode: "public_view_join_password",
          context,
          password: "join-password",
          spaceId: centerAgentDirectMessageSpaceId,
        })
      )
    ).resolves.toMatchObject({
      code: "space.forbidden",
      message: expect.stringContaining(
        "Center Agent Direct Messages cannot change access settings."
      ),
      status: 403,
    });
    await expect(
      readCenterAgentDirectMessageForbiddenError(
        rpcUpsertSpacePassword(env, {
          context,
          password: "join-password",
          spaceId: centerAgentDirectMessageSpaceId,
        })
      )
    ).resolves.toMatchObject({
      code: "space.forbidden",
      message: expect.stringContaining(
        "Center Agent Direct Messages cannot change access passwords."
      ),
      status: 403,
    });
    await expect(
      readCenterAgentDirectMessageForbiddenError(
        rpcClearSpacePassword(env, {
          context,
          spaceId: centerAgentDirectMessageSpaceId,
        })
      )
    ).resolves.toMatchObject({
      code: "space.forbidden",
      message: expect.stringContaining(
        "Center Agent Direct Messages cannot change access passwords."
      ),
      status: 403,
    });
    await expect(
      readCenterAgentDirectMessageForbiddenError(
        rpcPatchSpaceContract(env, {
          context,
          contractPatch: { publicationMode: "raw_context_sharing" },
          spaceId: centerAgentDirectMessageSpaceId,
        })
      )
    ).resolves.toMatchObject({
      code: "space.forbidden",
      message: expect.stringContaining(
        "Center Agent Direct Messages cannot change publication mode."
      ),
      status: 403,
    });

    expect(spaceStub.rpcRemoveMembers).not.toHaveBeenCalled();
    expect(spaceStub.rpcLeaveSpace).not.toHaveBeenCalled();
    expect(spaceStub.rpcDelete).not.toHaveBeenCalled();
    expect(spaceStub.rpcSetAccessMode).not.toHaveBeenCalled();
    expect(spaceStub.rpcUpsertPassword).not.toHaveBeenCalled();
    expect(spaceStub.rpcClearPassword).not.toHaveBeenCalled();
    expect(spaceStub.rpcPatchContract).not.toHaveBeenCalled();

    await expect(
      rpcRemoveSpaceMembers(env, {
        context,
        memberProfileIds: [SECOND_AGENT_PROFILE_ID],
        spaceId: ordinaryDirectMessageSpaceId,
      })
    ).resolves.toMatchObject({
      removedMemberIds: [SECOND_AGENT_PROFILE_ID],
    });
    await expect(
      rpcLeaveSpace(env, {
        context,
        spaceId: ordinaryDirectMessageSpaceId,
      })
    ).resolves.toMatchObject({
      leftProfileId: HUMAN_PROFILE_ID,
      status: "left",
    });
    await expect(
      rpcDeleteSpace(env, {
        context,
        spaceId: ordinaryDirectMessageSpaceId,
      })
    ).resolves.toMatchObject({ deleted: true });
    await expect(
      rpcSetSpaceAccessMode(env, {
        accessMode: "public_view_join_password",
        context,
        password: "join-password",
        spaceId: ordinaryDirectMessageSpaceId,
      })
    ).resolves.toMatchObject({
      accessMode: "public_view_join_password",
    });
    await expect(
      rpcUpsertSpacePassword(env, {
        context,
        password: "join-password",
        spaceId: ordinaryDirectMessageSpaceId,
      })
    ).resolves.toMatchObject({ passwordProtected: true });
    await expect(
      rpcClearSpacePassword(env, {
        context,
        spaceId: ordinaryDirectMessageSpaceId,
      })
    ).resolves.toMatchObject({ passwordProtected: false });
    await expect(
      rpcPatchSpaceContract(env, {
        context,
        contractPatch: { publicationMode: "raw_context_sharing" },
        spaceId: ordinaryDirectMessageSpaceId,
      })
    ).resolves.toMatchObject({
      publicationMode: "raw_context_sharing",
    });
  });

  it("opens a generic Direct Message Space idempotently", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });
    const context = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });

    const first = await rpcOpenDirectMessageSpace(env, {
      context,
      targetProfileId: AGENT_PROFILE_ID,
    });
    const second = await rpcOpenDirectMessageSpace(env, {
      context,
      targetProfileId: AGENT_PROFILE_ID,
    });

    expect(first).toMatchObject({
      created: true,
      memberProfileId: HUMAN_PROFILE_ID,
      organizationId: "org-a",
      targetProfileId: AGENT_PROFILE_ID,
    });
    expect(second).toMatchObject({
      created: false,
      spaceId: first.spaceId,
    });
    expect(db.spaces).toHaveLength(1);
  });

  it("creates fresh Sessions for any Human–Agent pair only with MemberAgents enabled", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "reviewer",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "PR Reviewer",
          status: "active",
        },
      ],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });
    const context = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });
    const creationId = "00000000-0000-4000-8000-000000000051";
    await expect(
      rpcOpenDirectMessageSpace(env, {
        context,
        targetProfileId: AGENT_PROFILE_ID,
        creationId,
      })
    ).rejects.toMatchObject({
      code: "direct_message.new_session_requires_center",
    });
    memberAgentsFeature.enabled = true;
    try {
      const ordinary = await rpcOpenDirectMessageSpace(env, {
        context,
        targetProfileId: AGENT_PROFILE_ID,
      });
      const first = await rpcOpenDirectMessageSpace(env, {
        context,
        targetProfileId: AGENT_PROFILE_ID,
        creationId,
      });
      const retry = await rpcOpenDirectMessageSpace(env, {
        context,
        targetProfileId: AGENT_PROFILE_ID,
        creationId,
      });
      const next = await rpcOpenDirectMessageSpace(env, {
        context,
        targetProfileId: AGENT_PROFILE_ID,
        creationId: "00000000-0000-4000-8000-000000000052",
      });
      expect(first).toMatchObject({
        created: true,
        creationId,
        memberProfileId: HUMAN_PROFILE_ID,
        targetProfileId: AGENT_PROFILE_ID,
      });
      expect(retry).toMatchObject({ created: false, spaceId: first.spaceId });
      expect(
        new Set([ordinary.spaceId, first.spaceId, next.spaceId]).size
      ).toBe(3);
      expect(spaceStub.rpcInitializeDirectMessageMeta).toHaveBeenLastCalledWith(
        expect.objectContaining({
          name: "New chat",
          pairKey: [HUMAN_PROFILE_ID, AGENT_PROFILE_ID].sort().join(":"),
        })
      );
      // Agent–Agent pairs keep reusing their one Direct Message.
      await expect(
        rpcOpenDirectMessageSpace(env, {
          context: buildContext({
            activeOrganizationId: "org-a",
            userId: "user-a",
            profileKind: "agent",
          }),
          targetProfileId: SECOND_AGENT_PROFILE_ID,
          creationId,
        })
      ).rejects.toMatchObject({
        code: "direct_message.new_session_requires_center",
      });
    } finally {
      memberAgentsFeature.enabled = false;
    }
  });

  it("lets either owned Agent open the same DM without adding their Humans", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
        {
          organizationId: "org-a",
          ownerUserId: "user-b",
          profileHandle: "reviewer",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Reviewer",
          status: "active",
        },
      ],
      members: [
        memberRow("member-a", "org-a", "user-a"),
        memberRow("member-b", "org-a", "user-b"),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });
    const first = await rpcOpenDirectMessageSpace(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
        profileKind: "agent",
      }),
      targetProfileId: SECOND_AGENT_PROFILE_ID,
    });
    const second = await rpcOpenDirectMessageSpace(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-b",
        profileId: SECOND_AGENT_PROFILE_ID,
        profileKind: "agent",
      }),
      targetProfileId: AGENT_PROFILE_ID,
    });
    expect(second).toMatchObject({ spaceId: first.spaceId, created: false });
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledTimes(1);
    expect(
      spaceStub.rpcPostMembers.mock.calls[0]?.[0].members
        .map((member) => member.profileId)
        .sort()
    ).toEqual([AGENT_PROFILE_ID, SECOND_AGENT_PROFILE_ID].sort());
    await expect(
      rpcOpenDirectMessageSpace(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-b",
          profileKind: "agent",
        }),
        targetProfileId: SECOND_HUMAN_PROFILE_ID,
      })
    ).rejects.toMatchObject({
      code: "direct_message.caller_forbidden",
      status: 403,
    });
  });

  it("lets the Center create a fresh Human chat or delegate in an ordinary Agent DM", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow(),
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });
    const context = buildCenterAgentContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
      profileKind: "agent",
    });
    const creationId = "00000000-0000-4000-8000-000000000041";
    const first = await rpcRemoteAgentOpenDirectMessageSpace(env, {
      context,
      targetProfileId: HUMAN_PROFILE_ID,
      creationId,
    });
    const retry = await rpcRemoteAgentOpenDirectMessageSpace(env, {
      context,
      targetProfileId: HUMAN_PROFILE_ID,
      creationId,
    });
    const next = await rpcRemoteAgentOpenDirectMessageSpace(env, {
      context,
      targetProfileId: HUMAN_PROFILE_ID,
      creationId: "00000000-0000-4000-8000-000000000042",
    });
    expect(retry.spaceId).toBe(first.spaceId);
    expect(next.spaceId).not.toBe(first.spaceId);
    const agentDm = await rpcRemoteAgentOpenDirectMessageSpace(env, {
      context,
      targetProfileId: SECOND_AGENT_PROFILE_ID,
    });
    const request = {
      context,
      spaceId: agentDm.spaceId,
      targetProfileId: SECOND_AGENT_PROFILE_ID,
      message: {
        clientMessageId: "00000000-0000-4000-8000-000000000043",
        text: "Review the release checklist.",
        wake: true,
      },
    };
    const sent = await rpcRemoteAgentOpenDirectMessageSpace(env, request);
    const resent = await rpcRemoteAgentOpenDirectMessageSpace(env, request);
    expect(sent.signal).toMatchObject({
      profile: { profileId: AGENT_PROFILE_ID },
      data: {
        messageEnvelope: {
          activationTargets: [SECOND_AGENT_PROFILE_ID],
          referenceTargets: [],
        },
      },
    });
    expect(resent.signal?.id).toBe(sent.signal?.id);
    expect(spaceStub.rpcInitializeDirectMessageMeta).toHaveBeenLastCalledWith(
      expect.objectContaining({ ownerUserIds: ["user-a"] })
    );
    await expect(
      rpcRemoteAgentOpenDirectMessageSpace(env, {
        context,
        targetProfileId: SECOND_AGENT_PROFILE_ID,
        creationId,
      })
    ).rejects.toMatchObject({
      code: "direct_message.new_session_requires_center",
    });
    await expect(
      rpcRemoteAgentOpenDirectMessageSpace(env, {
        ...request,
        spaceId: undefined,
      })
    ).rejects.toMatchObject({ code: "direct_message.wake_requires_space" });
    await expect(
      rpcRemoteAgentOpenDirectMessageSpace(env, {
        ...request,
        targetProfileId: HUMAN_PROFILE_ID,
      })
    ).rejects.toMatchObject({ code: "direct_message.wake_requires_agent" });
  });

  it("resolves Organization profiles before converting a Direct Message", async () => {
    const spaceId =
      "7777777777777777777777777777777777777777777777777777777777777777";
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
      spaces: [
        spaceRow({
          activeAgentCount: 0,
          activeHumanCount: 2,
          activeMemberCount: 2,
          directMessagePairKey: `${HUMAN_PROFILE_ID}:${SECOND_HUMAN_PROFILE_ID}`,
          organizationId: "org-a",
          spaceId,
          spaceName: "Ava and Felix",
          spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });
    const context = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });

    await expect(
      rpcConvertDirectMessageToSpace(env, {
        context,
        name: "Ava, Felix, and Codex",
        profileIds: [AGENT_PROFILE_ID],
        spaceId,
      })
    ).resolves.toMatchObject({
      accessMode: "members_only",
      addedMemberIds: [AGENT_PROFILE_ID, HUMAN_PROFILE_ID],
      name: "Ava, Felix, and Codex",
      spaceId,
    });
    expect(spaceStub.rpcConvertDirectMessageToSpace).toHaveBeenCalledWith({
      context,
      members: [
        expect.objectContaining({
          ownerUserId: "user-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Codex",
        }),
        expect.objectContaining({
          ownerUserId: "user-a",
          profileId: HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Ava",
        }),
      ],
      name: "Ava, Felix, and Codex",
      spaceId,
    });

    await expect(
      rpcConvertDirectMessageToSpace(env, {
        context,
        name: "Invalid target",
        profileIds: [SECOND_AGENT_PROFILE_ID],
        spaceId,
      })
    ).rejects.toMatchObject({
      code: "direct_message.target_not_found",
      status: 404,
    });
  });

  it("adds an existing Agent's owner when another member converts the Direct Message", async () => {
    const spaceId =
      "7878787878787878787878787878787878787878787878787878787878787878";
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-b",
          profileHandle: "existing-agent",
          profileId: AGENT_PROFILE_ID,
          profileName: "Existing Agent",
          status: "active",
        },
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "new-agent",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "New Agent",
          status: "active",
        },
      ],
      members: [
        memberRow("member-a", "org-a", "user-a", "member"),
        memberRow("member-b", "org-a", "user-b", "member"),
      ],
      spaces: [
        spaceRow({
          activeAgentCount: 1,
          activeHumanCount: 1,
          activeMemberCount: 2,
          directMessagePairKey: `${HUMAN_PROFILE_ID}:${AGENT_PROFILE_ID}`,
          organizationId: "org-a",
          spaceId,
          spaceName: "Ava and Existing Agent",
          spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({
      initialActiveMemberProfileIdsBySpace: {
        [spaceId]: [HUMAN_PROFILE_ID, AGENT_PROFILE_ID],
      },
      spaces: db.spaces,
    });
    const env = await buildEnv({ db, spaceStub });
    const context = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });

    await expect(
      rpcConvertDirectMessageToSpace(env, {
        context,
        name: "Ava and the Agents",
        profileIds: [SECOND_AGENT_PROFILE_ID],
        spaceId,
      })
    ).resolves.toMatchObject({
      addedMemberIds: [SECOND_AGENT_PROFILE_ID, SECOND_HUMAN_PROFILE_ID],
    });
    expect(spaceStub.rpcConvertDirectMessageToSpace).toHaveBeenCalledWith({
      context,
      members: [
        expect.objectContaining({
          profileId: SECOND_AGENT_PROFILE_ID,
          profileKind: "agent",
        }),
        expect.objectContaining({
          ownerUserId: "user-b",
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileKind: "human",
        }),
      ],
      name: "Ava and the Agents",
      spaceId,
    });
  });

  it("repairs incomplete Direct Message membership without rewriting its origin", async () => {
    const pairKey = `${HUMAN_PROFILE_ID}:${AGENT_PROFILE_ID}`;
    const spaceId = resolveTestNamedSpaceId(`dm-v1:org-a:${pairKey}:0`);
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
      spaces: [
        spaceRow({
          activeAgentCount: 0,
          activeHumanCount: 1,
          activeMemberCount: 1,
          directMessagePairKey: pairKey,
          organizationId: "org-a",
          spaceId,
          spaceName: "Felix and Codex",
          spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    const response = await rpcOpenDirectMessageSpace(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
      targetProfileId: AGENT_PROFILE_ID,
    });

    expect(response).toMatchObject({ created: false, spaceId });
    expect(spaceStub.rpcInitializeDirectMessageMeta).not.toHaveBeenCalled();
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledTimes(1);
    expect(db.spaces.find((space) => space.spaceId === spaceId)).toMatchObject({
      activeAgentCount: 1,
      activeHumanCount: 1,
      activeMemberCount: 2,
    });
  });

  it("rejects self Direct Messages with a stable error code", async () => {
    const env = await buildEnv({
      members: [memberRow("member-a", "org-a", "user-a", "member")],
    });

    await expect(
      rpcOpenDirectMessageSpace(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        targetProfileId: HUMAN_PROFILE_ID,
      })
    ).rejects.toMatchObject({
      code: "direct_message.self_not_allowed",
      status: 400,
    });
  });

  it("creates the next Direct Message generation after an origin Space degrades", async () => {
    const pairKey = `${HUMAN_PROFILE_ID}:${AGENT_PROFILE_ID}`;
    const degradedSpaceId = resolveTestNamedSpaceId(`dm-v1:org-a:${pairKey}:0`);
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
      spaces: [
        spaceRow({
          activeAgentCount: 1,
          activeHumanCount: 2,
          activeMemberCount: 3,
          directMessagePairKey: pairKey,
          organizationId: "org-a",
          spaceId: degradedSpaceId,
          spaceName: "Felix and Codex plus Ada",
          spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
          visibility: "private",
        }),
      ],
    });
    const env = await buildEnv({
      db,
      spaceStub: createSpaceStub({ spaces: db.spaces }),
    });

    const response = await rpcOpenDirectMessageSpace(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
      targetProfileId: AGENT_PROFILE_ID,
    });

    expect(response.created).toBe(true);
    expect(response.spaceId).not.toBe(degradedSpaceId);
    expect(db.spaces.map((space) => space.spaceId).sort()).toEqual(
      [degradedSpaceId, response.spaceId].sort()
    );
    expect(
      db.spaces.find((space) => space.spaceId === response.spaceId)
        ?.activeMemberCount
    ).toBe(2);
  });

  it("creates the next Direct Message generation after conversion even when two members remain", async () => {
    const pairKey = `${HUMAN_PROFILE_ID}:${AGENT_PROFILE_ID}`;
    const convertedSpaceId = resolveTestNamedSpaceId(
      `dm-v1:org-a:${pairKey}:0`
    );
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
      spaces: [
        spaceRow({
          activeAgentCount: 1,
          activeHumanCount: 1,
          activeMemberCount: 2,
          directMessageConvertedAtMs: 1_786_113_764_181,
          directMessagePairKey: pairKey,
          organizationId: "org-a",
          spaceId: convertedSpaceId,
          spaceName: "Converted collaboration",
          spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
          visibility: "private",
        }),
      ],
    });
    const env = await buildEnv({
      db,
      spaceStub: createSpaceStub({ spaces: db.spaces }),
    });

    const response = await rpcOpenDirectMessageSpace(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
      targetProfileId: AGENT_PROFILE_ID,
    });

    expect(response.created).toBe(true);
    expect(response.spaceId).not.toBe(convertedSpaceId);
    expect(db.spaces).toHaveLength(2);
  });

  it("converges concurrent Direct Message opens for the same generation", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
    });
    const env = await buildEnv({
      db,
      spaceStub: createSpaceStub({ spaces: db.spaces }),
    });
    const context = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });

    const [first, second] = await Promise.all([
      rpcOpenDirectMessageSpace(env, {
        context,
        targetProfileId: AGENT_PROFILE_ID,
      }),
      rpcOpenDirectMessageSpace(env, {
        context,
        targetProfileId: AGENT_PROFILE_ID,
      }),
    ]);

    expect(first.spaceId).toBe(second.spaceId);
    expect(db.spaces).toHaveLength(1);
  });

  it("reuses and marks an undegraded legacy Center Agent DM Space", async () => {
    const legacySpaceId = resolveTestNamedSpaceId(
      `center-agent-dm-v1:org-a:${HUMAN_PROFILE_ID}:${AGENT_PROFILE_ID}`
    );
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
      spaces: [
        spaceRow({
          activeAgentCount: 1,
          activeHumanCount: 1,
          activeMemberCount: 2,
          organizationId: "org-a",
          spaceId: legacySpaceId,
          spaceName: "Ava and Codex",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    const response = await rpcOpenCenterAgentDirectMessageSpace(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });

    expect(response).toMatchObject({
      created: false,
      spaceId: legacySpaceId,
    });
    expect(spaceStub.rpcInitializeDirectMessageMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        pairKey: `${HUMAN_PROFILE_ID}:${AGENT_PROFILE_ID}`,
        purpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
        spaceId: legacySpaceId,
      })
    );
  });

  it("does not reuse a degraded legacy Center Agent DM Space", async () => {
    const legacySpaceId = resolveTestNamedSpaceId(
      `center-agent-dm-v1:org-a:${HUMAN_PROFILE_ID}:${AGENT_PROFILE_ID}`
    );
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
      spaces: [
        spaceRow({
          activeAgentCount: 1,
          activeHumanCount: 2,
          activeMemberCount: 3,
          organizationId: "org-a",
          spaceId: legacySpaceId,
          spaceName: "Ava and Codex plus Ada",
          visibility: "private",
        }),
      ],
    });
    const env = await buildEnv({
      db,
      spaceStub: createSpaceStub({ spaces: db.spaces }),
    });

    const response = await rpcOpenCenterAgentDirectMessageSpace(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });

    expect(response.created).toBe(true);
    expect(response.spaceId).not.toBe(legacySpaceId);
    expect(db.spaces).toHaveLength(2);
  });

  it("rejects the Center Agent DM for a personal Agent Profile even with legacy Wake Access", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-personal",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      authorizations: [
        authorizationRow({
          agentProfileId: AGENT_PROFILE_ID,
          authorizedBy: "user-a",
          bindingId: `binding-${AGENT_PROFILE_ID}`,
          createdAtMs: 1_700_000_000_000,
          organizationId: "org-a",
        }),
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-personal", "org-personal", "user-a", "owner"),
        memberRow("member-a", "org-a", "user-a", "member"),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcOpenCenterAgentDirectMessageSpace(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
      })
    ).rejects.toMatchObject({
      code: "center_agent.profile_not_found",
      status: 409,
    });
    expect(spaceStub.rpcPostMembers).not.toHaveBeenCalled();
  });

  it("rejects the Center Agent DM for a personal Agent Profile without Organization Wake Access", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-personal",
          ownerUserId: null,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          status: "active",
        },
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-personal", "org-personal", "user-a", "owner"),
        memberRow("member-a", "org-a", "user-a", "member"),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcOpenCenterAgentDirectMessageSpace(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
      })
    ).rejects.toMatchObject({
      code: "center_agent.profile_not_found",
      status: 409,
    });
    expect(spaceStub.rpcPostMembers).not.toHaveBeenCalled();
  });

  it("rejects organization Space directory reads when the active user is not an organization member", async () => {
    const env = await buildEnv({
      members: [],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: UNJOINED_PUBLIC_SPACE_ID,
          spaceName: "Public Space",
          visibility: "public",
        }),
      ],
    });

    await expect(
      rpcGetCurrentOrganizationSpaceDirectory(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
      })
    ).rejects.toMatchObject({
      code: "organization.membership_required",
      status: 403,
    });
  });

  it("lists joined Organization Spaces plus unjoined public Spaces in the active Organization", async () => {
    const env = await buildEnv({
      members: [memberRow("member-a", "org-a", "user-a")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Private Joined",
          visibility: "private",
          sourceUpdatedAtMs: 1_700_000_010_000,
        }),
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PUBLIC_SPACE_ID,
          spaceName: "Public Joined",
          visibility: "public",
          sourceUpdatedAtMs: 1_700_000_020_000,
        }),
        spaceRow({
          organizationId: "org-a",
          spaceId: UNJOINED_PUBLIC_SPACE_ID,
          spaceName: "Public Directory",
          visibility: "public",
          sourceUpdatedAtMs: 1_700_000_030_000,
        }),
        spaceRow({
          organizationId: "org-a",
          spaceId: UNJOINED_PRIVATE_SPACE_ID,
          spaceName: "Private Hidden",
          visibility: "private",
          sourceUpdatedAtMs: 1_700_000_040_000,
        }),
        spaceRow({
          organizationId: "org-b",
          spaceId: OTHER_ORG_PUBLIC_SPACE_ID,
          spaceName: "Other Org Public",
          visibility: "public",
          sourceUpdatedAtMs: 1_700_000_050_000,
        }),
      ],
      spaceMemberships: [
        spaceMembershipRow({
          addedAtMs: 1_700_000_100_000,
          ownerUserId: "user-a",
          profileId: HUMAN_PROFILE_ID,
          spaceId: JOINED_PRIVATE_SPACE_ID,
        }),
        spaceMembershipRow({
          addedAtMs: 1_700_000_090_000,
          ownerUserId: "user-a",
          profileId: HUMAN_PROFILE_ID,
          spaceId: JOINED_PUBLIC_SPACE_ID,
        }),
      ],
    });

    const response = await rpcGetCurrentOrganizationSpaceDirectory(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });

    expect(response.organizationId).toBe("org-a");
    expect(response.spaces[0]).not.toHaveProperty("activeMemberCount");
    expect(
      response.spaces.map((space) => ({
        joined: space.joined,
        spaceId: space.spaceId,
        visibility: space.visibility,
      }))
    ).toEqual([
      {
        joined: true,
        spaceId: JOINED_PRIVATE_SPACE_ID,
        visibility: "private",
      },
      { joined: true, spaceId: JOINED_PUBLIC_SPACE_ID, visibility: "public" },
      {
        joined: false,
        spaceId: UNJOINED_PUBLIC_SPACE_ID,
        visibility: "public",
      },
    ]);

    const responseWithMemberCounts =
      await rpcGetCurrentOrganizationSpaceDirectoryWithMemberCounts(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
      });
    expect(
      responseWithMemberCounts.spaces.map((space) => space.activeMemberCount)
    ).toEqual([null, null, null]);
  });

  it("joins a public Organization Space through the Space DO member write path", async () => {
    const spaceStub = createSpaceStub();
    const env = await buildEnv({
      members: [memberRow("member-a", "org-a", "user-a")],
      spaceStub,
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: UNJOINED_PUBLIC_SPACE_ID,
          spaceName: "Public Directory",
          visibility: "public",
        }),
      ],
    });

    const response = await rpcJoinOrganizationPublicSpace(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
      password: "space-secret",
      spaceId: UNJOINED_PUBLIC_SPACE_ID,
    });

    expect(response).toEqual({
      addedMemberIds: [HUMAN_PROFILE_ID],
      alreadyMemberIds: [],
      items: [],
    });
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledWith({
      context: expect.any(Object),
      members: [
        expect.objectContaining({
          ownerUserId: "user-a",
          profileId: HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Ava",
        }),
      ],
      password: "space-secret",
      spaceId: UNJOINED_PUBLIC_SPACE_ID,
    });
  });

  it("rejects public-join requests for private Organization Spaces before member writes", async () => {
    const spaceStub = createSpaceStub();
    const env = await buildEnv({
      members: [memberRow("member-a", "org-a", "user-a")],
      spaceStub,
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: UNJOINED_PRIVATE_SPACE_ID,
          spaceName: "Private Hidden",
          visibility: "private",
        }),
      ],
    });

    await expect(
      rpcJoinOrganizationPublicSpace(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        spaceId: UNJOINED_PRIVATE_SPACE_ID,
      })
    ).rejects.toMatchObject({
      code: "space.join.private",
      status: 403,
    });
    expect(spaceStub.rpcPostMembers).not.toHaveBeenCalled();
  });

  it("atomically adds active human and agent profiles from the Organization Directory", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow({})],
      members: [
        memberRow("member-owner", "org-a", "owner-user", "owner"),
        memberRow("member-a", "org-a", "user-a", "member"),
      ],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Team Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    const response = await rpcAddOrganizationDirectoryProfilesToSpace(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
      directoryProfileIds: [HUMAN_PROFILE_ID, AGENT_PROFILE_ID],
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });

    expect(response.addedMemberIds).toEqual([
      HUMAN_PROFILE_ID,
      AGENT_PROFILE_ID,
    ]);
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledTimes(1);
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        members: [
          expect.objectContaining({
            ownerUserId: "user-a",
            profileId: HUMAN_PROFILE_ID,
            profileKind: "human",
          }),
          expect.objectContaining({
            ownerUserId: null,
            profileId: AGENT_PROFILE_ID,
            profileKind: "agent",
          }),
        ],
        requireActorMembership: true,
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    );
  });

  it("requires the caller to already be an active member of the target Space", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: UNJOINED_PUBLIC_SPACE_ID,
          spaceName: "Public Room",
          visibility: "public",
        }),
      ],
    });
    const spaceStub = createSpaceStub({
      spaces: db.spaces,
      unjoinedSpaceIds: [UNJOINED_PUBLIC_SPACE_ID],
    });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcAddOrganizationDirectoryProfilesToSpace(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        directoryProfileIds: [HUMAN_PROFILE_ID],
        spaceId: UNJOINED_PUBLIC_SPACE_ID,
      })
    ).rejects.toMatchObject({
      code: "space.membership_required",
      status: 403,
    });
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledTimes(1);
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        requireActorMembership: true,
        spaceId: UNJOINED_PUBLIC_SPACE_ID,
      })
    );
  });

  it("rejects a non-default Human Profile that is not exposed by the Organization Directory", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Team Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcAddOrganizationDirectoryProfilesToSpace(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        directoryProfileIds: [SECOND_HUMAN_PROFILE_ID],
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    ).rejects.toMatchObject({
      code: "organization_directory.profile_unavailable",
      status: 409,
    });
    expect(spaceStub.rpcPostMembers).not.toHaveBeenCalled();
  });

  it("rejects the whole Directory batch when one profile is outside the active Organization", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({
          organizationId: "org-b",
          profileId: SECOND_AGENT_PROFILE_ID,
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Team Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcAddOrganizationDirectoryProfilesToSpace(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        directoryProfileIds: [HUMAN_PROFILE_ID, SECOND_AGENT_PROFILE_ID],
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    ).rejects.toMatchObject({
      code: "organization_directory.profile_unavailable",
      status: 409,
    });
    expect(spaceStub.rpcPostMembers).not.toHaveBeenCalled();
  });

  it("rejects a Center Agent from another Organization even when its Binding has Wake Access", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({
          organizationId: "org-personal",
          profileId: SECOND_AGENT_PROFILE_ID,
        }),
      ],
      authorizations: [
        authorizationRow({
          agentProfileId: SECOND_AGENT_PROFILE_ID,
          authorizedBy: "user-a",
          bindingId: `binding-${SECOND_AGENT_PROFILE_ID}`,
          createdAtMs: 1_700_000_000_000,
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Team Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcAddOrganizationDirectoryProfilesToSpace(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        directoryProfileIds: [SECOND_AGENT_PROFILE_ID],
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    ).rejects.toMatchObject({
      code: "organization_directory.profile_unavailable",
      status: 409,
    });
    expect(spaceStub.rpcPostMembers).not.toHaveBeenCalled();
  });

  it("rejects disabled Directory profiles before writing any Space members", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [
        {
          ...managedCenterAgentProfileRow({}),
          status: "disabled",
        },
      ],
      members: [
        memberRow("member-owner", "org-a", "owner-user", "owner"),
        memberRow("member-a", "org-a", "user-a", "member"),
      ],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Team Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcAddOrganizationDirectoryProfilesToSpace(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        directoryProfileIds: [HUMAN_PROFILE_ID, AGENT_PROFILE_ID],
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    ).rejects.toMatchObject({
      code: "organization_directory.profile_unavailable",
      status: 409,
    });
    expect(spaceStub.rpcPostMembers).not.toHaveBeenCalled();
  });

  it("rejects stale Center Agent identity before adding a Directory batch", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow({})],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "owner-user",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-owner", "org-a", "owner-user", "owner"),
        memberRow("member-a", "org-a", "user-a", "member"),
      ],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Team Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcAddOrganizationDirectoryProfilesToSpace(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        directoryProfileIds: [SECOND_AGENT_PROFILE_ID],
        expectedCenterAgentProfileId: SECOND_AGENT_PROFILE_ID,
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    ).rejects.toMatchObject({
      code: "center_agent.designation_changed",
      status: 409,
    });
    expect(spaceStub.rpcPostMembers).not.toHaveBeenCalled();
  });

  it("adds the designated Center Agent to an ordinary Space a member belongs to", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow({})],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "owner-user",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-owner", "org-a", "owner-user", "owner"),
        memberRow("member-a", "org-a", "user-a", "member"),
      ],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Team Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    const response = await rpcAddCenterAgentToSpace(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
      expectedCenterAgentProfileId: AGENT_PROFILE_ID,
      spaceId: JOINED_PRIVATE_SPACE_ID,
    });

    expect(response).toEqual({
      addedMemberIds: [AGENT_PROFILE_ID],
      alreadyMemberIds: [],
      items: [],
    });
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        members: [
          expect.objectContaining({
            profileId: AGENT_PROFILE_ID,
            profileKind: "agent",
            profileName: "Center Agent",
          }),
        ],
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    );
  });

  it("rejects a stale displayed Center Agent identity before writing Space membership", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow({})],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "owner-user",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-owner", "org-a", "owner-user", "owner"),
        memberRow("member-a", "org-a", "user-a", "member"),
      ],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Team Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcAddCenterAgentToSpace(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        expectedCenterAgentProfileId: SECOND_AGENT_PROFILE_ID,
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    ).rejects.toMatchObject({
      code: "center_agent.designation_changed",
      status: 409,
    });
    expect(spaceStub.rpcPostMembers).not.toHaveBeenCalled();
  });

  it("rejects adding the Center Agent to a Space in a different Organization", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow({})],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "owner-user",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-owner", "org-a", "owner-user", "owner"),
        memberRow("member-a", "org-a", "user-a", "member"),
      ],
      spaces: [
        spaceRow({
          organizationId: "org-b",
          spaceId: OTHER_ORG_PUBLIC_SPACE_ID,
          spaceName: "Other Org Space",
          visibility: "public",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcAddCenterAgentToSpace(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        expectedCenterAgentProfileId: AGENT_PROFILE_ID,
        spaceId: OTHER_ORG_PUBLIC_SPACE_ID,
      })
    ).rejects.toMatchObject({
      code: "space.organization_mismatch",
      status: 403,
    });
    expect(spaceStub.rpcPostMembers).not.toHaveBeenCalled();
  });

  it("keeps Center Agent identity management available while paused", async () => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow({})],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "owner-user",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-owner", "org-a", "owner-user", "owner"),
        memberRow("member-a", "org-a", "user-a", "member"),
      ],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PRIVATE_SPACE_ID,
          spaceName: "Team Room",
          visibility: "private",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = await buildEnv({ db, spaceStub });

    await expect(
      rpcUpdateCenterAgentOperatingState(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "owner-user",
        }),
        operatingState: "paused",
      })
    ).resolves.toMatchObject({ operatingState: "paused" });

    await expect(
      rpcAddCenterAgentToSpace(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
        expectedCenterAgentProfileId: AGENT_PROFILE_ID,
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    ).resolves.toMatchObject({
      addedMemberIds: [AGENT_PROFILE_ID],
      alreadyMemberIds: [],
    });
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledOnce();
  });
});

describe("Center Agent Wake Stop delegation", () => {
  const stopBody = {
    target: {
      by: "source_signal" as const,
      sourceSignalId: "signal-center-wake",
      targetProfileId: SECOND_AGENT_PROFILE_ID,
    },
  };
  const centerContext = (submissionId?: string) =>
    buildCenterAgentContext({
      activeOrganizationId: "org-a",
      ...(submissionId ? { agentControllerConversationId: submissionId } : {}),
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      userId: "user-a",
    });
  const setup = async (withDelivery: boolean) => {
    const db = await createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "user-a",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
      nativeDeliveries: withDelivery
        ? [
            nativeDeliveryLedgerRow({
              deliveryId: "delivery-center-stop",
              submissionId: "submission-center-stop",
            }),
          ]
        : [],
      spaces: [
        spaceRow({
          organizationId: "org-a",
          spaceId: JOINED_PUBLIC_SPACE_ID,
          spaceName: "Stop test",
          visibility: "public",
        }),
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const stop = vi.fn(
      (input: {
        context: OpenMeldRequestContext;
      }): Promise<PostSpaceWakeStopResponse> => {
        if (input.context.actorContext.profileKind === "agent") {
          return Promise.reject(
            Object.assign(new Error("Only the requester can stop this Wake"), {
              status: 403,
            })
          );
        }
        return Promise.resolve({
          cancellationState: {
            observedAtMs: TEST_NOW_MS,
            reasonCode: "runtime_coordinator.pre_agent_stop_requested",
            status: "cancelled" as const,
          },
          ok: true as const,
          runtimeCoordinatorExecutionId: null,
          status: "cancelled" as const,
          stopMode: "openmeld_owned_pre_agent" as const,
          targetProfileId: SECOND_AGENT_PROFILE_ID,
        });
      }
    );
    Object.assign(spaceStub, { rpcPostWakeStop: stop });
    return { env: await buildEnv({ db, spaceStub }), spaceStub, stop };
  };

  it("uses the same Space Stop RPC for a verified current requester", async () => {
    const { env, stop } = await setup(true);
    await expect(
      rpcCenterAgentStopSpaceWake(env, {
        body: stopBody,
        context: centerContext("submission-center-stop"),
        spaceId: JOINED_PUBLIC_SPACE_ID,
        speakerMember: { memberId: "member-a", userId: "user-a" },
      })
    ).resolves.toMatchObject({ status: "cancelled" });
    expect(stop).toHaveBeenCalledTimes(2);
    expect(
      stop.mock.calls.map(([request]) => request.context.actorContext)
    ).toEqual([
      expect.objectContaining({
        openMeldProfileId: AGENT_PROFILE_ID,
        profileKind: "agent",
      }),
      expect.objectContaining({
        openMeldProfileId: HUMAN_PROFILE_ID,
        ownerUserId: "user-a",
        profileKind: "human",
      }),
    ]);
  });

  it("does not turn membership alone into Stop authority", async () => {
    const { env, stop } = await setup(false);
    await expect(
      rpcCenterAgentStopSpaceWake(env, {
        body: stopBody,
        context: centerContext(),
        spaceId: JOINED_PUBLIC_SPACE_ID,
        speakerMember: { memberId: "member-a", userId: "user-a" },
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(stop).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        context: expect.objectContaining({
          actorContext: expect.objectContaining({ profileKind: "agent" }),
        }),
      })
    );
  });

  it("does not call Space Stop across Organizations", async () => {
    const { env, stop } = await setup(true);
    await expect(
      rpcCenterAgentStopSpaceWake(env, {
        body: stopBody,
        context: centerContext("submission-center-stop"),
        spaceId: OTHER_ORG_PUBLIC_SPACE_ID,
        speakerMember: { memberId: "member-a", userId: "user-a" },
      })
    ).rejects.toMatchObject({ status: 404 });
    expect(stop).not.toHaveBeenCalled();
  });

  it("keeps a Space-authorized self-Stop without requiring a Human requester", async () => {
    const { env, stop } = await setup(false);
    stop.mockResolvedValueOnce({
      ok: true,
      runtimeCoordinatorExecutionId: null,
      status: "cancelled",
      stopMode: "openmeld_owned_pre_agent",
      targetProfileId: SECOND_AGENT_PROFILE_ID,
      cancellationState: {
        observedAtMs: TEST_NOW_MS,
        reasonCode: "space.wake_stopped_before_send",
        status: "cancelled",
      },
    });
    await expect(
      rpcCenterAgentStopSpaceWake(env, {
        body: stopBody,
        context: centerContext(),
        spaceId: JOINED_PUBLIC_SPACE_ID,
      })
    ).resolves.toMatchObject({ status: "cancelled" });
    expect(stop).toHaveBeenCalledOnce();
    expect(stop.mock.calls[0]?.[0].context.actorContext.profileKind).toBe(
      "agent"
    );
  });

  it("does not retry an uncertain self-Stop as a Human", async () => {
    const { env, stop } = await setup(true);
    stop.mockRejectedValueOnce(
      Object.assign(new Error("Cancellation unavailable"), { status: 503 })
    );
    await expect(
      rpcCenterAgentStopSpaceWake(env, {
        body: stopBody,
        context: centerContext("submission-center-stop"),
        spaceId: JOINED_PUBLIC_SPACE_ID,
        speakerMember: { memberId: "member-a", userId: "user-a" },
      })
    ).rejects.toMatchObject({ status: 503 });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("does not replace a missing Center UUID with a Human early-Stop fence", async () => {
    const { env, stop } = await setup(true);
    stop.mockResolvedValueOnce({
      ok: false,
      status: "not_found",
      runtimeCoordinatorExecutionId: null,
      targetProfileId: SECOND_AGENT_PROFILE_ID,
      reasonCode: "space.wake_stop_target_not_found",
      cancellationState: {
        observedAtMs: TEST_NOW_MS,
        reasonCode: "space.wake_stop_target_not_found",
        status: "not_requested",
      },
    });
    await expect(
      rpcCenterAgentStopSpaceWake(env, {
        body: {
          target: {
            by: "client_message",
            clientMessageId: "00000000-0000-4000-8000-000000000094",
            targetProfileId: SECOND_AGENT_PROFILE_ID,
          },
        },
        context: centerContext("submission-center-stop"),
        spaceId: JOINED_PUBLIC_SPACE_ID,
        speakerMember: { memberId: "member-a", userId: "user-a" },
      })
    ).resolves.toMatchObject({ status: "not_found" });
    expect(stop).toHaveBeenCalledOnce();
  });

  it.each([
    false,
    true,
  ])("delegates a UUID only after resolving an existing source (found: %s)", async (found) => {
    const { env, stop, spaceStub } = await setup(true);
    const lookup = vi.fn(async () => ({
      matches: found
        ? [
            {
              sourceSignalId: stopBody.target.sourceSignalId,
              targetProfileId: SECOND_AGENT_PROFILE_ID,
            },
          ]
        : [],
    }));
    Object.assign(spaceStub, { rpcGetDispatchLookup: lookup });
    const result = rpcCenterAgentStopSpaceWake(env, {
      body: {
        target: {
          by: "client_message",
          clientMessageId: "00000000-0000-4000-8000-000000000094",
          targetProfileId: SECOND_AGENT_PROFILE_ID,
        },
      },
      context: centerContext("submission-center-stop"),
      spaceId: JOINED_PUBLIC_SPACE_ID,
      speakerMember: { memberId: "member-a", userId: "user-a" },
    });
    if (found) {
      await expect(result).resolves.toMatchObject({ status: "cancelled" });
      expect(stop).toHaveBeenLastCalledWith(
        expect.objectContaining({
          body: stopBody,
          context: expect.objectContaining({
            actorContext: expect.objectContaining({ profileKind: "human" }),
          }),
        })
      );
    } else {
      await expect(result).rejects.toMatchObject({ status: 403 });
      expect(stop).toHaveBeenCalledOnce();
    }
  });

  it("keeps the Center's own authorized Stop eligibility when the requester cannot read that Space", async () => {
    const { env, spaceStub } = await setup(true);
    const progress = {
      items: [
        {
          clientMessageId: "client-1",
          dispatchId: "dispatch-1",
          sourceSignalId: "signal-center-wake",
          targetProfileId: SECOND_AGENT_PROFILE_ID,
          wakeStopEligibility: { status: "eligible" as const },
        },
      ],
    };
    const read = vi.fn((input: { context: OpenMeldRequestContext }) => {
      if (input.context.actorContext.profileKind === "human") {
        return Promise.reject(
          Object.assign(new Error("Space access denied"), { status: 403 })
        );
      }
      return Promise.resolve(progress);
    });
    Object.assign(spaceStub, { rpcGetActiveWakeProgress: read });
    await expect(
      rpcCenterAgentReadSpaceWakeProgress(env, {
        context: centerContext("submission-center-stop"),
        spaceId: JOINED_PUBLIC_SPACE_ID,
        speakerMember: { memberId: "member-a", userId: "user-a" },
      })
    ).resolves.toMatchObject({
      items: [{ wakeStopEligibility: { status: "eligible" } }],
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("shows a verified requester's Stop eligibility on the exact Wake", async () => {
    const { env, spaceStub } = await setup(true);
    const wake = {
      clientMessageId: "client-1",
      dispatchId: "dispatch-1",
      sourceSignalId: "signal-center-wake",
      targetProfileId: SECOND_AGENT_PROFILE_ID,
    };
    const eligible = {
      controlMode: "cancel" as const,
      reasonCode: null,
      reliability: "native_cancel" as const,
      status: "eligible" as const,
    };
    Object.assign(spaceStub, {
      rpcGetActiveWakeProgress: vi.fn(
        (input: { context: OpenMeldRequestContext }) =>
          Promise.resolve({
            items: [
              {
                ...wake,
                wakeStopEligibility:
                  input.context.actorContext.profileKind === "human"
                    ? eligible
                    : null,
              },
            ],
          })
      ),
    });
    const response = await rpcCenterAgentReadSpaceWakeProgress(env, {
      context: centerContext("submission-center-stop"),
      spaceId: JOINED_PUBLIC_SPACE_ID,
      speakerMember: { memberId: "member-a", userId: "user-a" },
    });
    expect(response.items[0]?.wakeStopEligibility).toEqual(eligible);
  });
});

async function buildEnv(
  input: Partial<Parameters<typeof createOrganizationRpcDb>[0]> & {
    authWorker?: {
      createAgentProfileInOrganization?: ReturnType<typeof vi.fn>;
      ensureCenterAgentProfileInOrganization?: ReturnType<typeof vi.fn>;
      resolveOrganizationDirectoryAgentProfiles?: ReturnType<typeof vi.fn>;
      resolveOrganizationDirectoryMembers?: ReturnType<typeof vi.fn>;
      resolveProfileById?: ReturnType<typeof vi.fn>;
      resolveProfilesByIds?: ReturnType<typeof vi.fn>;
      updateCenterAgentProfileInOrganization?: ReturnType<typeof vi.fn>;
    };
    db?: Awaited<ReturnType<typeof createOrganizationRpcDb>>;
    remoteAgentBlockedOrganizationIds?: string;
    remoteAgentDesignationEnabled?: string;
    remoteAgentWorker?: CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"];
    remoteAgentRuntimeEnabled?: string;
    observability?: CoreBindings["OPENMELD_OBSERVABILITY"];
    slackBotToken?: string;
    slackTokenCryptoKey?: string;
    spaceStub?: ReturnType<typeof createSpaceStub>;
    workerEnvironment?: string;
  }
): Promise<CoreBindings> {
  const db =
    input.db ??
    (await createOrganizationRpcDb({
      agentProfiles: input.agentProfiles ?? [],
      authorizations: input.authorizations ?? [],
      centerAgentAuditJournal: input.centerAgentAuditJournal ?? [],
      centerAgentDesignations: input.centerAgentDesignations ?? [],
      centerAgentMemoryPolicies: input.centerAgentMemoryPolicies ?? [],
      dispatchLedgerEntries: input.dispatchLedgerEntries ?? [],
      memberActivities: input.memberActivities ?? [],
      nativeDeliveries: input.nativeDeliveries ?? [],
      members: input.members ?? [],
      organizations: input.organizations ?? [],
      personalOrganizations: input.personalOrganizations ?? [],
      slackWorkspaceBindings: input.slackWorkspaceBindings ?? [],
      spaceMemberships: input.spaceMemberships ?? [],
      spaces: input.spaces ?? [],
    }));
  organizationFixtures.set(db.binding, db);
  const spaceStub = input.spaceStub ?? createSpaceStub({ spaces: db.spaces });
  spaceStub.setProjectionWriter((snapshot) =>
    projectActiveSpaceIndexSnapshot({ ...snapshot, db: db.db })
  );
  for (const operation of [
    "createAgentProfileInOrganization",
    "ensureCenterAgentProfileInOrganization",
    "updateCenterAgentProfileInOrganization",
  ] as const) {
    const mock = input.authWorker?.[operation];
    const implementation = mock?.getMockImplementation();
    if (!(mock && implementation)) {
      continue;
    }
    mock.mockImplementation(async (...args: unknown[]) => {
      // Vitest 4 types loose mock implementations as callable or constructable.
      const result: unknown = await (
        implementation as (...args: unknown[]) => unknown
      )(...args);
      if (
        !result ||
        typeof result !== "object" ||
        Reflect.get(result, "ok") !== true
      ) {
        return result;
      }
      const parsed = authProfileViewSchema.safeParse(
        Reflect.get(result, "profile")
      );
      const request = args[0];
      const organizationId =
        request && typeof request === "object"
          ? Reflect.get(request, "organizationId")
          : undefined;
      if (
        parsed.success &&
        parsed.data.profileKind === "agent" &&
        agentProfileIdSchema.safeParse(parsed.data.openMeldProfileId).success &&
        typeof organizationId === "string"
      ) {
        const profile = parsed.data;
        await db.writeAgentProfile({
          profileId: profile.openMeldProfileId,
          profileHandle: profile.profileHandle,
          profileName: profile.profileName,
          organizationId: profile.organizationId ?? organizationId,
          ownerUserId: profile.ownerUserId,
          managedRole: profile.managedRole,
          source: profile.source,
          status: profile.status,
          createdByUserId: profile.createdByUserId,
          creatorProfileId: profile.creatorProfileId,
          createdAt: Date.parse(profile.createdAt),
          updatedAt: Date.parse(profile.updatedAt),
          lastUsedAt: profile.lastUsedAt
            ? Date.parse(profile.lastUsedAt)
            : null,
        });
      }
      return result;
    });
  }
  return {
    OPENMELD_AUTH_WORKER: {
      ...buildOrganizationDirectoryAuthProjection({
        agentProfiles: input.agentProfiles ?? db.agentProfiles,
        members: input.members ?? db.members,
      }),
      ...input.authWorker,
    },
    OPENMELD_POSTGRESQL: db.binding,
    OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS:
      input.remoteAgentBlockedOrganizationIds,
    OPENMELD_REMOTE_AGENT_DESIGNATION_ENABLED:
      input.remoteAgentDesignationEnabled ?? "true",
    OPENMELD_REMOTE_AGENT_WORKER: input.remoteAgentWorker,
    OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: input.remoteAgentRuntimeEnabled,
    OPENMELD_RUNTIME_TRANSPORT: {
      get: vi.fn(() => ({
        rpcAcquireAgentProfileControllerMutation: vi.fn(
          async (request: { operationId: string }) => ({
            expiresAtMs: Date.now() + 300_000,
            operationId: request.operationId,
            status: "acquired" as const,
          })
        ),
        rpcReleaseAgentProfileControllerMutation: vi.fn(async () => ({
          status: "released" as const,
        })),
      })),
      idFromName: vi.fn((ownerUserId: string) => ownerUserId),
    },
    SLACK_OPENMELD_BOT_TOKEN: input.slackBotToken,
    SLACK_OPENMELD_TOKEN_CRYPTO_KEY: input.slackTokenCryptoKey,
    OPENMELD_OBSERVABILITY: input.observability,
    OPENMELD_SPACES: createSpaceNamespace(spaceStub),
    OPENMELD_WORKER_ENVIRONMENT: input.workerEnvironment,
  } as unknown as CoreBindings;
}

function buildOrganizationDirectoryAuthProjection(input: {
  agentProfiles?: Parameters<
    typeof createOrganizationRpcDb
  >[0]["agentProfiles"];
  members?: Parameters<typeof createOrganizationRpcDb>[0]["members"];
}) {
  const agentProfiles = input.agentProfiles ?? [];
  const members = input.members ?? [];
  return {
    resolveOrganizationDirectoryAgentProfiles: vi.fn(
      async (request: {
        additionalAgentProfileIds: string[];
        organizationId: string;
      }) => ({
        additionalAgentProfiles: agentProfiles
          .filter(
            (profile) =>
              profile.organizationId !== request.organizationId &&
              request.additionalAgentProfileIds.includes(profile.profileId)
          )
          .map((profile) =>
            buildOrganizationDirectoryAgentProfileIdentity({
              members,
              profile,
            })
          ),
        ok: true as const,
        organizationAgentProfiles: agentProfiles
          .filter(
            (profile) => profile.organizationId === request.organizationId
          )
          .map((profile) =>
            buildOrganizationDirectoryAgentProfileIdentity({
              members,
              profile,
            })
          ),
        organizationId: request.organizationId,
      })
    ),
    resolveOrganizationDirectoryMembers: vi.fn(
      async (request: { organizationId: string }) => ({
        members: members
          .filter((member) => member.organizationId === request.organizationId)
          .map((member) => {
            const humanProfile = organizationRpcHumanProfile(member.userId);
            const emailLocalPart = member.userEmail.split("@")[0]?.trim();
            return {
              humanProfile: humanProfile
                ? {
                    lastUsedAt: new Date(humanProfile.lastUsedAt).toISOString(),
                    profileHandle: humanProfile.profileHandle,
                    profileId: humanProfile.profileId,
                    profileName: humanProfile.profileName,
                    status: humanProfile.status,
                  }
                : null,
              joinedAt: new Date(member.createdAt).toISOString(),
              memberId: member.memberId,
              organizationId: member.organizationId,
              role: member.role,
              user: {
                email: member.userEmail,
                id: member.userId,
                image: member.userImage,
                name: member.userName?.trim() || emailLocalPart || "Member",
              },
              userId: member.userId,
            };
          }),
        ok: true as const,
        organizationId: request.organizationId,
      })
    ),
  };
}

function buildOrganizationDirectoryAgentProfileIdentity(input: {
  members: Parameters<typeof createOrganizationRpcDb>[0]["members"];
  profile: Parameters<
    typeof createOrganizationRpcDb
  >[0]["agentProfiles"][number];
}) {
  const ownerName = input.members.find(
    (member) => member.userId === input.profile.ownerUserId
  )?.userName;
  return {
    createdAt: new Date(
      input.profile.createdAt ?? 1_700_000_000_000
    ).toISOString(),
    createdByUserId: input.profile.createdByUserId ?? null,
    creatorProfileId: input.profile.creatorProfileId ?? null,
    isDefault: false as const,
    lastUsedAt:
      input.profile.lastUsedAt === null ||
      input.profile.lastUsedAt === undefined
        ? null
        : new Date(input.profile.lastUsedAt).toISOString(),
    managedRole: input.profile.managedRole ?? null,
    organizationId: input.profile.organizationId,
    ...(ownerName?.trim() ? { ownerName: ownerName.trim() } : {}),
    ownerUserId: input.profile.ownerUserId,
    profileHandle: input.profile.profileHandle,
    profileId: input.profile.profileId,
    profileKind: "agent" as const,
    profileName: input.profile.profileName,
    source: input.profile.source ?? "cli_create",
    status: input.profile.status,
    updatedAt: new Date(
      input.profile.updatedAt ?? 1_700_000_000_000
    ).toISOString(),
  };
}

function buildCenterAgentContext(
  input: Parameters<typeof buildContext>[0]
): OpenMeldRequestContext {
  const context = buildContext(input);
  const { ownerUserId: _auditOnlyUserId, ...actor } = context.actorContext;
  return {
    ...context,
    actorContext: {
      ...actor,
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      callerPrincipalId: actor.openMeldProfileId,
    },
  };
}

function buildContext(input: {
  activeOrganizationId: string;
  agentControllerRef?: OpenMeldRequestContext["actorContext"]["agentControllerRef"];
  agentControllerConversationId?: string;
  profileId?: string;
  profileKind?: "agent" | "human";
  profileName?: string;
  requestId?: string;
  userId: string;
}): OpenMeldRequestContext {
  const profileKind = input.profileKind ?? "human";
  return {
    activeOrganizationId: input.activeOrganizationId,
    ...(input.agentControllerConversationId
      ? {
          agentControllerConversationId: input.agentControllerConversationId,
        }
      : {}),
    actorContext: {
      ...(input.agentControllerRef
        ? { agentControllerRef: input.agentControllerRef }
        : {}),
      callerPrincipalId: input.userId,
      profileKind,
      profileName:
        input.profileName ?? (profileKind === "agent" ? "Codex" : "Ava"),
      requestId: input.requestId ?? "request-org-rpc-test",
      ownerUserId: input.userId,
      openMeldProfileId:
        input.profileId ??
        (profileKind === "agent" ? AGENT_PROFILE_ID : HUMAN_PROFILE_ID),
    },
  };
}

function memberRow(
  memberId: string,
  organizationId: string,
  userId: string,
  role = "member"
) {
  return {
    memberId,
    organizationId,
    userId,
    role,
    createdAt: 1_700_000_000_000,
    userName: userId === "user-a" ? "Ava" : "Ben",
    userEmail: `${userId}@example.com`,
    userImage: null,
  };
}

function spaceRow(input: {
  activeAgentCount?: number | null;
  activeHumanCount?: number | null;
  activeMemberCount?: number | null;
  directMessageConvertedAtMs?: number | null;
  directMessagePairKey?: string | null;
  organizationId: string;
  sourceUpdatedAtMs?: number;
  spaceCreatedAtMs?: number;
  spaceId: string;
  spaceName: string | null;
  spacePurpose?: string | null;
  spaceUpdatedAtMs?: number | null;
  status?: "active" | "deleted";
  visibility: "public" | "private";
}) {
  return {
    activeAgentCount: input.activeAgentCount ?? null,
    activeHumanCount: input.activeHumanCount ?? null,
    activeMemberCount: input.activeMemberCount ?? null,
    directMessageConvertedAtMs: input.directMessageConvertedAtMs ?? null,
    directMessagePairKey: input.directMessagePairKey ?? null,
    organizationId: input.organizationId,
    sourceUpdatedAtMs: input.sourceUpdatedAtMs ?? 1_700_000_000_000,
    spaceCreatedAtMs: input.spaceCreatedAtMs ?? 1_699_999_990_000,
    spaceId: input.spaceId,
    spaceName: input.spaceName,
    spacePurpose: input.spacePurpose ?? null,
    spaceUpdatedAtMs: input.spaceUpdatedAtMs ?? input.sourceUpdatedAtMs ?? 0,
    status: input.status ?? "active",
    visibility: input.visibility,
  };
}

function spaceMembershipRow(input: {
  addedAtMs: number;
  ownerUserId: string;
  profileId: string;
  spaceId: string;
  status?: "active" | "removed";
}) {
  return {
    addedAtMs: input.addedAtMs,
    ownerUserId: input.ownerUserId,
    profileId: input.profileId,
    spaceId: input.spaceId,
    status: input.status ?? "active",
  };
}

function authorizationRow(input: {
  agentProfileId: string;
  authorizedBy: string;
  bindingId: string;
  createdAtMs: number;
  organizationId: string;
}) {
  return {
    id: `authorization-${input.organizationId}-${input.bindingId}`,
    ...input,
  };
}

function centerAgentDesignationRow(input: {
  agentProfileId: string;
  createdAtMs?: number;
  designatedBy: string;
  operatingState?: "active" | "paused";
  organizationId: string;
  pausedAtMs?: number | null;
  pausedByUserId?: string | null;
}) {
  return {
    agentProfileId: input.agentProfileId,
    createdAtMs: input.createdAtMs ?? 1_700_000_000_000,
    designatedBy: input.designatedBy,
    operatingState: input.operatingState ?? "active",
    organizationId: input.organizationId,
    pausedAtMs: input.pausedAtMs ?? null,
    pausedByUserId: input.pausedByUserId ?? null,
  };
}

function managedCenterAgentProfileRow(input?: {
  organizationId?: string;
  profileId?: string;
}) {
  return {
    organizationId: input?.organizationId ?? "org-a",
    ownerUserId: null,
    profileHandle: "center-agent",
    profileId: input?.profileId ?? AGENT_PROFILE_ID,
    profileName: "Center Agent",
    managedRole: "center_agent",
    status: "active" as const,
  };
}

type CenterAgentAuditJournalTestRow = {
  action: string;
  actorProfileId: string;
  createdAtMs: number;
  id: string;
  onBehalfOfDisplayName: string | null;
  onBehalfOfProfileId: string | null;
  onBehalfOfUserId: string | null;
  organizationId: string;
  resourceId: string | null;
  resourceType: string | null;
  sourceNativeDeliveryId?: string | null;
  sourceSpaceId?: string | null;
};

// Fixture rows for the W-CA-CAP1 Center Agent dispatch history RPC. Fields
// mirror listRecentDispatchLedgerEntriesForSpace's own selection: the ledger
// aggregate (dispatchId/status/timestamps) joined with its latest attempt
// (attempt status, errorCode, errorMessage).
type DispatchLedgerTestEntry = {
  attemptCount?: number;
  attemptCreatedAtMs?: number;
  attemptErrorCode?: string | null;
  attemptErrorMessage?: string | null;
  attemptFinishedAtMs?: number | null;
  attemptId?: string | null;
  attemptNo?: number;
  attemptStartedAtMs?: number | null;
  attemptStatus?: string | null;
  dispatchId: string;
  firstSeenAtMs?: number;
  lastAttemptAtMs?: number;
  spaceId: string;
  status: string;
  targetProfileId: string;
};

type AgentProfileBindingTestRow = {
  agentControllerConversationId: string | null;
  agentControllerPermissionMode: string | null;
  agentControllerRef: string;
  agentProfileId: string;
  bindingId: string;
  bindingState: "enabled_primary" | "disabled_historical";
  configurationRevision: number;
  createdAtMs: number;
  createdByProfileId: string | null;
  disabledAtMs: number | null;
  hostedRuntimeIdentityJson: string | null;
  modelId: string | null;
  openCodePermission: string | null;
  ownerId: string;
  ownerKind: "owner_account" | "organization";
  reasonCode: string | null;
  reasoningLevel: string | null;
  runtimeKind: "openmeld_service" | "hosted_center_agent";
  updatedAtMs: number;
  openMeldServiceRuntimeId: string;
};

function agentProfileBindingTestRow(
  input: Pick<AgentProfileBindingTestRow, "bindingId" | "ownerId"> &
    Partial<Omit<AgentProfileBindingTestRow, "bindingId" | "ownerId">>
): AgentProfileBindingTestRow {
  return {
    agentControllerConversationId: null,
    agentControllerPermissionMode: "codex:fullAccess",
    agentControllerRef: "builtin:codex",
    agentProfileId: AGENT_PROFILE_ID,
    bindingState: "enabled_primary",
    configurationRevision: 1,
    createdAtMs: 1_700_000_000_000,
    createdByProfileId: HUMAN_PROFILE_ID,
    disabledAtMs: null,
    hostedRuntimeIdentityJson: null,
    modelId: "gpt-5.6-sol",
    openCodePermission: null,
    ownerKind: "owner_account",
    reasonCode: "center_agent.remote_agent_designation",
    reasoningLevel: "high",
    runtimeKind: "openmeld_service",
    updatedAtMs: 1_700_000_000_000,
    openMeldServiceRuntimeId: `runtime-${input.ownerId}`,
    ...input,
  };
}

function nativeDeliveryLedgerRow(input: {
  deliveryId: string;
  routineRunId?: string | null;
  slackChannelId?: string | null;
  slackTeamId?: string | null;
  slackThreadTs?: string | null;
  submissionId: string;
}) {
  return {
    accepted_at_ms: TEST_NOW_MS,
    accepted_probe_next_due_at_ms: null,
    anonymous_member_speaker_json: null,
    attempt_id: null,
    binding_id: "binding-center-agent",
    callback_received_at_ms: null,
    completed_at_ms: null,
    controller_binding_updated_at_ms: null,
    controller_stored_agent_controller_ref: null,
    controller_stored_agent_controller_ref_status: null,
    conversation_kind: "space",
    created_at_ms: TEST_NOW_MS,
    deadline_probe_enqueued_at_ms: null,
    delivery_id: input.deliveryId,
    dispatch_id: `dispatch-${input.deliveryId}`,
    execution_evidence_at_ms: TEST_NOW_MS,
    execution_evidence_sequence: 1,
    execution_recovery_submit_request_json: null,
    failure_code: null,
    failure_detail: null,
    final_publication_ambiguity_deadline_at_ms: null,
    final_publication_attempt_count: 0,
    final_publication_claim_expires_at_ms: null,
    final_publication_claim_id: null,
    final_publication_claimed_at_ms: null,
    final_publication_next_attempt_at_ms: null,
    final_publication_payload_json: null,
    final_publication_provider_progress_sequence: null,
    final_publication_state: null,
    idempotency_key: `idempotency-${input.deliveryId}`,
    message_channel_connection_id: null,
    message_channel_locator_json: null,
    message_channel_provider: null,
    on_behalf_of_display_name: "Ava",
    on_behalf_of_profile_id: HUMAN_PROFILE_ID,
    on_behalf_of_user_id: "user-a",
    organization_id: "org-a",
    profile_id: AGENT_PROFILE_ID,
    provider_progress_card_id: null,
    provider_progress_claim_expires_at_ms: null,
    provider_progress_claim_id: null,
    provider_progress_claimed_at_ms: null,
    provider_progress_failure_code: null,
    provider_progress_message_id: null,
    provider_progress_pending_card_id: null,
    provider_progress_pending_sequence: null,
    provider_progress_pending_source_offset: null,
    provider_progress_pending_text_hash: null,
    provider_progress_publication_idempotency_key: null,
    provider_progress_rollover_index: 0,
    provider_progress_sequence: null,
    provider_progress_source_offset: 0,
    provider_progress_state: null,
    provider_publication_idempotency_key: null,
    provider_publication_result_id: null,
    published_signal_id: null,
    retired_deadline_failure_code: null,
    retired_deadline_failure_published_signal_id: null,
    retired_deadline_failure_reconciled_at_ms: null,
    routine_name_snapshot: null,
    routine_run_id: input.routineRunId ?? null,
    slack_channel_id: input.slackChannelId ?? null,
    slack_team_id: input.slackTeamId ?? null,
    slack_thread_ts: input.slackThreadTs ?? null,
    slack_working_status_turn_id: null,
    source_client_message_id: null,
    space_id: JOINED_PUBLIC_SPACE_ID,
    status: "accepted" as const,
    submission_id: input.submissionId,
    submitted_at_ms: TEST_NOW_MS,
    thread_context_json: null,
    trigger_message_id: `signal-${input.deliveryId}`,
    trigger_text: "Test Center Agent request",
    updated_at_ms: TEST_NOW_MS,
    worker_request_id: null,
    worker_submit_request_json: null,
  };
}

async function createOrganizationRpcDb(input: {
  agentProfiles: Array<{
    createdAt?: number;
    createdByUserId?: string | null;
    creatorProfileId?: string | null;
    hasBinding?: boolean;
    isDefault?: number;
    lastUsedAt?: number | null;
    managedRole?: string | null;
    organizationId: string;
    ownerUserId: string | null;
    profileHandle: string;
    profileId: string;
    profileName: string;
    source?: string;
    status: "active" | "disabled";
    updatedAt?: number;
  }>;
  authorizations?: ReturnType<typeof authorizationRow>[];
  legacyPersonalBindings?: AgentProfileBindingTestRow[];
  centerAgentAuditWriteFailures?: number;
  centerAgentDesignations?: ReturnType<typeof centerAgentDesignationRow>[];
  centerAgentDesignationReadbackRace?: ReturnType<
    typeof centerAgentDesignationRow
  > | null;
  centerAgentAuditJournal?: CenterAgentAuditJournalTestRow[];
  connectorConnection?: {
    connectionName: string;
    organizationId: string;
    scope: "member" | "shared";
    service: "github" | "gmail";
    status: "active" | "disconnected";
    userId: string | null;
  };
  dispatchLedgerEntries?: DispatchLedgerTestEntry[];
  memberActivities?: Array<{
    humanProfileId: string;
    lastActiveAtMs: number;
    organizationId: string;
    userId: string;
  }>;
  members: ReturnType<typeof memberRow>[];
  nativeDeliveries?: ReturnType<typeof nativeDeliveryLedgerRow>[];
  ownedDevices?: Array<{
    deviceId: string;
    firstSeenAtMs: number;
    lastObservedAtMs: number | null;
    observedDisplayName: string | null;
    ownerUserId: string;
    updatedAtMs: number;
  }>;
  centerAgentMemoryPolicies?: Array<{
    organizationId: string;
    organizationMemoryOptIn: boolean;
    updatedByUserId: string | null;
  }>;
  informationProtectionPolicies?: Array<{
    organizationId: string;
    protectedInformation: string;
    updatedAtMs: number;
    updatedByUserId: string | null;
  }>;
  organizations?: Array<{
    createdByUserId?: string | null;
    metadata?: string | null;
    name: string;
    organizationId: string;
    slug: string;
  }>;
  personalOrganizations?: Array<{ organizationId: string; userId: string }>;
  slackWorkspaceBindings?: Array<{
    createdAtMs: number;
    organizationId: string;
    slackTeamId: string;
    updatedAtMs: number;
  }>;
  slackUserIdentityLinks?: Array<{
    createdAtMs: number;
    organizationId: string;
    slackTeamId: string;
    slackUserId: string;
    source: "explicit" | "email_auto";
    openmeldUserId: string;
  }>;
  spaceMemberships?: ReturnType<typeof spaceMembershipRow>[];
  spaces?: ReturnType<typeof spaceRow>[];
}) {
  const fixture = await createWorkerPostgresFixture(workerEnv, {
    beforeOwnerGuards: Boolean(input.legacyPersonalBindings),
  });
  const orgIds = new Set<string>();
  const userIds = new Set<string>();
  const addOwner = (organizationId?: string | null, userId?: string | null) => {
    if (organizationId) {
      orgIds.add(organizationId);
    }
    if (userId) {
      userIds.add(userId);
    }
  };
  for (const member of input.members) {
    addOwner(member.organizationId, member.userId);
  }
  for (const profile of input.agentProfiles) {
    addOwner(profile.organizationId, profile.ownerUserId);
    addOwner(null, profile.createdByUserId);
  }
  for (const org of input.organizations ?? []) {
    addOwner(org.organizationId, org.createdByUserId);
  }
  for (const org of input.personalOrganizations ?? []) {
    addOwner(org.organizationId, org.userId);
  }
  for (const row of input.centerAgentDesignations ?? []) {
    addOwner(row.organizationId, row.designatedBy);
    addOwner(null, row.pausedByUserId);
  }
  for (const row of input.centerAgentAuditJournal ?? []) {
    addOwner(row.organizationId, row.onBehalfOfUserId);
  }
  for (const row of input.authorizations ?? []) {
    addOwner(row.organizationId, row.authorizedBy);
  }
  for (const row of input.centerAgentMemoryPolicies ?? []) {
    addOwner(row.organizationId, row.updatedByUserId);
  }
  for (const row of input.informationProtectionPolicies ?? []) {
    addOwner(row.organizationId, row.updatedByUserId);
  }
  for (const row of input.memberActivities ?? []) {
    addOwner(row.organizationId, row.userId);
  }
  if (input.connectorConnection) {
    addOwner(
      input.connectorConnection.organizationId,
      input.connectorConnection.userId
    );
  }
  for (const row of input.legacyPersonalBindings ?? []) {
    addOwner(null, row.ownerId);
  }
  // Stable caller fixtures are real parents even when a test exercises a non-member denial.
  userIds.add("user-a");
  userIds.add("user-b");
  orgIds.add("org-a");
  for (const userId of userIds) {
    const member = input.members.find((row) => row.userId === userId);
    await fixture.writeRow(
      "users",
      {
        id: userId,
        name: member?.userName ?? userId,
        email: member?.userEmail ?? `${userId}@example.com`,
        image: member?.userImage ?? null,
      },
      ["id"]
    );
  }
  for (const orgId of orgIds) {
    const org = input.organizations?.find(
      (row) => row.organizationId === orgId
    );
    const personal = input.personalOrganizations?.find(
      (row) => row.organizationId === orgId
    );
    const creator =
      org?.createdByUserId ??
      personal?.userId ??
      input.members.find(
        (row) => row.organizationId === orgId && row.role === "owner"
      )?.userId ??
      null;
    await fixture.writeRow(
      "organizations",
      {
        id: orgId,
        name: org?.name ?? "Test Organization",
        slug: org?.slug ?? orgId,
        metadata:
          org?.metadata ??
          (personal ? JSON.stringify({ personal: true }) : null),
        created_by_user_id: creator,
        created_at: TEST_NOW_MS,
      },
      ["id"]
    );
  }
  for (const userId of ["user-a", "user-b"]) {
    const human = organizationRpcHumanProfile(userId);
    if (human) {
      await fixture.writeRow(
        "openmeld_profiles",
        {
          profile_id: human.profileId,
          profile_name: human.profileName,
          profile_handle: human.profileHandle,
          profile_kind: "human",
          is_default: 1,
          status: "active",
          owner_user_id: userId,
          source: "auth_bootstrap",
          last_used_at: human.lastUsedAt,
        },
        ["profile_id"]
      );
    }
  }
  async function writeAgentProfile(
    profile: Parameters<
      typeof createOrganizationRpcDb
    >[0]["agentProfiles"][number]
  ) {
    const { owner_name: _projectionOnly, ...row } =
      buildOrganizationDirectoryAgentProfileRow({
        members: input.members,
        profile,
      });
    await fixture.writeRow(
      "openmeld_profiles",
      {
        ...row,
        profile_kind: "agent",
        source:
          profile.source ??
          (profile.managedRole === "center_agent" ? "migration" : "cli_create"),
      },
      ["profile_id"]
    );
  }
  for (const profile of input.agentProfiles) {
    await writeAgentProfile(profile);
  }
  for (const member of input.members) {
    await fixture.writeRow(
      "members",
      {
        id: member.memberId,
        organization_id: member.organizationId,
        user_id: member.userId,
        role: member.role,
        created_at: member.createdAt,
      },
      ["id"]
    );
  }
  for (const profile of input.agentProfiles) {
    if (profile.hasBinding === false || !profile.ownerUserId) {
      continue;
    }
    await fixture.writeRow(
      "openMeldDaemon_agent_profile_bindings",
      mapAgentProfileBindingTestRow(
        agentProfileBindingTestRow({
          bindingId: `binding-${profile.profileId}`,
          ownerId: profile.ownerUserId,
          agentProfileId: profile.profileId,
          configurationRevision: 0,
          agentControllerPermissionMode: "codex:fullAccess",
          modelId: null,
          reasoningLevel: null,
          reasonCode: null,
        })
      ),
      ["binding_id"]
    );
  }
  for (const row of input.legacyPersonalBindings ?? []) {
    await fixture.writeRow(
      "openMeldDaemon_agent_profile_bindings",
      mapAgentProfileBindingTestRow(row),
      ["binding_id"]
    );
  }
  if (input.legacyPersonalBindings) {
    const migrations = workerEnv.TEST_POSTGRESQL_OWNER_GUARDS_AND_LATER;
    if (!migrations?.length) {
      throw new Error("The immutable owner guard migrations are required");
    }
    for (const sql of migrations) {
      await fixture.operator.query(sql);
    }
  }
  for (const row of input.authorizations ?? []) {
    if (
      !(await fixture
        .rows("openMeldDaemon_agent_profile_bindings", ["binding_id"])
        .has(row.bindingId))
    ) {
      const profile = input.agentProfiles.find(
        (profile) => profile.profileId === row.agentProfileId
      );
      if (!profile) {
        throw new Error(
          "An authorization fixture requires its real Agent Profile parent"
        );
      }
      const hosted = profile.managedRole === "center_agent";
      await fixture.writeRow(
        "openMeldDaemon_agent_profile_bindings",
        mapAgentProfileBindingTestRow(
          agentProfileBindingTestRow({
            bindingId: row.bindingId,
            agentProfileId: row.agentProfileId,
            ownerId: hosted
              ? profile.organizationId
              : (profile.ownerUserId ?? row.authorizedBy),
            ownerKind: hosted ? "organization" : "owner_account",
            ...(hosted
              ? {
                  agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
                  hostedRuntimeIdentityJson: JSON.stringify(
                    HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
                  ),
                  openMeldServiceRuntimeId:
                    HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
                  runtimeKind: "hosted_center_agent",
                }
              : {
                  bindingState: "disabled_historical",
                  disabledAtMs: TEST_NOW_MS,
                }),
          })
        ),
        ["binding_id"]
      );
    }
    await fixture.writeRow(
      "organization_binding_authorizations",
      {
        id: row.id,
        organization_id: row.organizationId,
        binding_id: row.bindingId,
        authorized_by: row.authorizedBy,
        created_at: row.createdAtMs,
      },
      ["id"]
    );
  }
  for (const row of input.centerAgentDesignations ?? []) {
    await fixture.writeRow(
      "center_agent_designations",
      {
        organization_id: row.organizationId,
        agent_profile_id: row.agentProfileId,
        designated_by: row.designatedBy,
        operating_state: row.operatingState,
        paused_at: row.pausedAtMs,
        paused_by_user_id: row.pausedByUserId,
        created_at: row.createdAtMs,
      },
      ["organization_id"]
    );
  }
  for (const row of input.centerAgentMemoryPolicies ?? []) {
    await fixture.writeRow(
      "center_agent_memory_policies",
      {
        organization_id: row.organizationId,
        organization_memory_opt_in: row.organizationMemoryOptIn ? 1 : 0,
        updated_by_user_id: row.updatedByUserId,
        created_at_ms: TEST_NOW_MS,
        updated_at_ms: TEST_NOW_MS,
      },
      ["organization_id"]
    );
  }
  for (const row of input.informationProtectionPolicies ?? []) {
    await fixture.writeRow(
      "organization_information_protection_policies",
      {
        organization_id: row.organizationId,
        protected_information: row.protectedInformation,
        updated_by_user_id: row.updatedByUserId,
        created_at_ms: row.updatedAtMs,
        updated_at_ms: row.updatedAtMs,
      },
      ["organization_id"]
    );
  }
  for (const row of input.memberActivities ?? []) {
    await fixture.writeRow(
      "organization_member_activity",
      {
        organization_id: row.organizationId,
        user_id: row.userId,
        human_profile_id: row.humanProfileId,
        last_active_at_ms: row.lastActiveAtMs,
        updated_at_ms: row.lastActiveAtMs,
      },
      ["organization_id", "user_id"]
    );
  }
  for (const row of input.centerAgentAuditJournal ?? []) {
    await fixture.writeRow(
      "center_agent_audit_journal",
      {
        id: row.id,
        organization_id: row.organizationId,
        actor_profile_id: row.actorProfileId,
        action: row.action,
        on_behalf_of_profile_id: row.onBehalfOfProfileId,
        on_behalf_of_user_id: row.onBehalfOfUserId,
        on_behalf_of_display_name: row.onBehalfOfDisplayName,
        resource_id: row.resourceId,
        resource_type: row.resourceType,
        source_native_delivery_id: row.sourceNativeDeliveryId ?? null,
        source_space_id: row.sourceSpaceId ?? null,
        created_at: row.createdAtMs,
      },
      ["id"]
    );
  }
  const spaces = input.spaces ?? [];
  for (const space of spaces) {
    await fixture.writeRow(
      "space_index_spaces",
      {
        space_id: space.spaceId,
        organization_id: space.organizationId,
        organization_visibility: space.visibility,
        status: space.status,
        space_name: space.spaceName,
        space_purpose: space.spacePurpose,
        direct_message_pair_key: space.directMessagePairKey,
        direct_message_converted_at_ms: space.directMessageConvertedAtMs,
        active_member_count: space.activeMemberCount,
        active_human_count: space.activeHumanCount,
        active_agent_count: space.activeAgentCount,
        space_created_at_ms: space.spaceCreatedAtMs,
        space_updated_at_ms: space.spaceUpdatedAtMs,
        source_updated_at_ms: space.sourceUpdatedAtMs,
        projected_at_ms: space.sourceUpdatedAtMs,
        projection_event_id: `fixture:${space.spaceId}`,
      },
      ["space_id"]
    );
  }
  for (const row of input.spaceMemberships ?? []) {
    await fixture.writeRow(
      "space_index_memberships",
      {
        space_id: row.spaceId,
        profile_id: row.profileId,
        profile_kind_snapshot: row.profileId.startsWith("agt_")
          ? "agent"
          : "human",
        profile_name_snapshot:
          input.agentProfiles.find(
            (profile) => profile.profileId === row.profileId
          )?.profileName ?? "Ava",
        owner_user_id_snapshot: row.ownerUserId,
        status: row.status,
        member_source: "organization_directory",
        added_at_ms: row.addedAtMs,
        source_updated_at_ms: row.addedAtMs,
        projected_at_ms: row.addedAtMs,
        projection_event_id: `fixture:${row.spaceId}:${row.profileId}`,
      },
      ["space_id", "profile_id"]
    );
  }
  for (const row of input.ownedDevices ?? []) {
    await fixture.writeRow(
      "openMeldDaemon_owned_devices",
      {
        owner_user_id: row.ownerUserId,
        device_id: row.deviceId,
        observed_display_name: row.observedDisplayName,
        first_seen_at_ms: row.firstSeenAtMs,
        last_observed_at_ms: row.lastObservedAtMs,
        updated_at_ms: row.updatedAtMs,
        platform_family: "macOS",
        os_version: "15.5",
        device_type: "laptop",
      },
      ["owner_user_id", "device_id"]
    );
  }
  for (const row of input.slackWorkspaceBindings ?? []) {
    await fixture.writeRow(
      "openMeldRemoteAgent_slack_workspace_bindings",
      {
        slack_team_id: row.slackTeamId,
        organization_id: row.organizationId,
        created_at_ms: row.createdAtMs,
        updated_at_ms: row.updatedAtMs,
      },
      ["slack_team_id"]
    );
  }
  for (const row of input.slackUserIdentityLinks ?? []) {
    await fixture.writeRow(
      "slack_user_identity_links",
      {
        organization_id: row.organizationId,
        slack_team_id: row.slackTeamId,
        slack_user_id: row.slackUserId,
        openmeld_user_id: row.openmeldUserId,
        source: row.source,
        created_at_ms: row.createdAtMs,
      },
      ["slack_team_id", "slack_user_id"]
    );
  }
  for (const row of input.nativeDeliveries ?? []) {
    await fixture.writeRow("openMeldRemoteAgent_native_delivery_ledger", row, [
      "idempotency_key",
    ]);
  }
  if (input.connectorConnection) {
    const row = input.connectorConnection;
    await fixture.writeRow(
      "connector_connections",
      {
        connection_name: row.connectionName,
        organization_id: row.organizationId,
        user_id: row.userId ?? "user-a",
        scope: row.scope,
        service: row.service,
        status: row.status,
        created_at_ms: TEST_NOW_MS,
        updated_at_ms: TEST_NOW_MS,
      },
      ["connection_name"]
    );
  }
  for (const row of input.dispatchLedgerEntries ?? []) {
    await fixture.writeRow(
      "openMeldDaemon_dispatch_ledger",
      {
        dispatch_id: row.dispatchId,
        idempotency_key: `fixture:${row.dispatchId}`,
        space_id: row.spaceId,
        source_client_message_id: `client:${row.dispatchId}`,
        source_event_id: `signal:${row.dispatchId}`,
        target_profile_id: row.targetProfileId,
        dispatch_owner_kind: "owner_account",
        dispatch_owner_id: "user-a",
        status: row.status,
        first_seen_at_ms: row.firstSeenAtMs ?? 0,
        last_attempt_at_ms: row.lastAttemptAtMs ?? 0,
        attempt_count: row.attemptCount ?? 1,
        latest_attempt_id: row.attemptId ?? null,
      },
      ["idempotency_key"]
    );
    if (row.attemptId) {
      await fixture.writeRow(
        "openMeldDaemon_dispatch_attempts",
        {
          attempt_id: row.attemptId,
          dispatch_id: row.dispatchId,
          idempotency_key: `fixture:${row.dispatchId}`,
          attempt_no: row.attemptNo ?? 1,
          status: row.attemptStatus ?? "created",
          error_code: row.attemptErrorCode ?? null,
          error_message: row.attemptErrorMessage ?? null,
          created_at_ms: row.attemptCreatedAtMs ?? 0,
          started_at_ms: row.attemptStartedAtMs ?? null,
          finished_at_ms: row.attemptFinishedAtMs ?? null,
        },
        ["attempt_id"]
      );
    }
  }
  if (input.centerAgentAuditWriteFailures) {
    await fixture.operator.query(
      `CREATE SEQUENCE public.audit_fault_calls; CREATE FUNCTION public.audit_write_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('public.audit_fault_calls') <= ${input.centerAgentAuditWriteFailures} THEN RAISE EXCEPTION 'Test Center Agent audit write failure.'; END IF; RETURN NEW; END $$; CREATE TRIGGER audit_write_fault BEFORE INSERT ON "openmeld"."center_agent_audit_journal" FOR EACH ROW EXECUTE FUNCTION public.audit_write_fault(); GRANT USAGE ON SEQUENCE public.audit_fault_calls TO openmeld_pg_runtime`
    );
  }
  const calls: QueryConfig[] = [];
  const bindingWriteEvents: string[] = [];
  let designationWritten = false;
  let designationRaceApplied = false;
  const db = observePostgresDatabase(fixture.db, async (query) => {
    calls.push(query);
    if (BINDING_WRITE_PATTERN.test(query.text)) {
      bindingWriteEvents.push(query.text);
    }
    if (DESIGNATION_INSERT_PATTERN.test(query.text)) {
      designationWritten = true;
    }
    if (
      input.centerAgentDesignationReadbackRace &&
      designationWritten &&
      !designationRaceApplied &&
      DESIGNATION_READ_PATTERN.test(query.text)
    ) {
      designationRaceApplied = true;
      await fixture.operator.query({
        text: 'UPDATE "openmeld"."center_agent_designations" SET agent_profile_id = $1 WHERE organization_id = $2',
        values: [
          input.centerAgentDesignationReadbackRace.agentProfileId,
          input.centerAgentDesignationReadbackRace.organizationId,
        ],
      });
    }
  });
  organizationPostgresObservers.set(fixture.binding, db);
  const bindingSelect = `SELECT agent_controller_conversation_id AS "agentControllerConversationId", agent_controller_permission_mode AS "agentControllerPermissionMode", agent_controller_ref AS "agentControllerRef", agent_profile_id AS "agentProfileId", binding_id AS "bindingId", binding_state AS "bindingState", configuration_revision AS "configurationRevision", created_at_ms AS "createdAtMs", created_by_profile_id AS "createdByProfileId", disabled_at_ms AS "disabledAtMs", hosted_runtime_identity_json AS "hostedRuntimeIdentityJson", model_id AS "modelId", opencode_permission AS "openCodePermission", owner_id AS "ownerId", owner_kind AS "ownerKind", reason_code AS "reasonCode", reasoning_level AS "reasoningLevel", runtime_kind AS "runtimeKind", updated_at_ms AS "updatedAtMs", openmeld_service_runtime_id AS "openMeldServiceRuntimeId" FROM "openmeld"."openMeldDaemon_agent_profile_bindings" WHERE binding_state = 'enabled_primary'`;
  const readBindings = async () =>
    (
      await fixture.operator.query<AgentProfileBindingTestRow>(
        `${bindingSelect} ORDER BY binding_id`
      )
    ).rows;
  const bindingRows = {
    values: readBindings,
    async entries() {
      return (await readBindings()).map(
        (row) =>
          [
            bindingKey(row.ownerKind, row.ownerId, row.agentProfileId),
            row,
          ] as const
      );
    },
    async snapshot() {
      return new Map(await this.entries());
    },
    async size() {
      return (await readBindings()).length;
    },
    async get(key: string) {
      return (await this.entries()).find(
        ([candidate]) => candidate === key
      )?.[1];
    },
    async set(_key: string, row: AgentProfileBindingTestRow) {
      await fixture.operator.query({
        text: `DELETE FROM "openmeld"."openMeldDaemon_agent_profile_bindings" WHERE owner_kind = $1 AND owner_id = $2 AND agent_profile_id = $3 AND binding_state = 'enabled_primary' AND binding_id <> $4`,
        values: [row.ownerKind, row.ownerId, row.agentProfileId, row.bindingId],
      });
      await fixture.writeRow(
        "openMeldDaemon_agent_profile_bindings",
        mapAgentProfileBindingTestRow(row),
        ["binding_id"]
      );
    },
  };
  const readDesignations = async () =>
    (
      await fixture.operator.query<
        ReturnType<typeof centerAgentDesignationRow>
      >(
        `SELECT organization_id AS "organizationId", agent_profile_id AS "agentProfileId", designated_by AS "designatedBy", created_at AS "createdAtMs", operating_state AS "operatingState", paused_at AS "pausedAtMs", paused_by_user_id AS "pausedByUserId" FROM "openmeld"."center_agent_designations" ORDER BY organization_id`
      )
    ).rows;
  const centerAgentDesignations = {
    values: readDesignations,
    async size() {
      return (await readDesignations()).length;
    },
    async get(id: string) {
      return (await readDesignations()).find(
        (row) => row.organizationId === id
      );
    },
  };
  async function readCenterAgentAuditRows() {
    return (
      await fixture.operator.query<CenterAgentAuditJournalTestRow>(
        `SELECT id, organization_id AS "organizationId", actor_profile_id AS "actorProfileId", action, on_behalf_of_profile_id AS "onBehalfOfProfileId", on_behalf_of_user_id AS "onBehalfOfUserId", on_behalf_of_display_name AS "onBehalfOfDisplayName", resource_type AS "resourceType", resource_id AS "resourceId", source_native_delivery_id AS "sourceNativeDeliveryId", source_space_id AS "sourceSpaceId", created_at AS "createdAtMs" FROM "openmeld"."center_agent_audit_journal" ORDER BY created_at, id`
      )
    ).rows;
  }
  async function readMemberActivities() {
    return (
      await fixture.operator.query<{
        organizationId: string;
        userId: string;
        humanProfileId: string;
        lastActiveAtMs: number;
      }>(
        `SELECT organization_id AS "organizationId", user_id AS "userId", human_profile_id AS "humanProfileId", last_active_at_ms AS "lastActiveAtMs" FROM "openmeld"."organization_member_activity" ORDER BY organization_id, user_id`
      )
    ).rows;
  }
  async function readMemoryPolicies() {
    return (
      await fixture.operator.query<{
        organizationId: string;
        organizationMemoryOptIn: number;
        updatedByUserId: string | null;
      }>(
        `SELECT organization_id AS "organizationId", organization_memory_opt_in AS "organizationMemoryOptIn", updated_by_user_id AS "updatedByUserId" FROM "openmeld"."center_agent_memory_policies" ORDER BY organization_id`
      )
    ).rows.map((row) => ({
      ...row,
      organizationMemoryOptIn: row.organizationMemoryOptIn === 1,
    }));
  }
  async function readInformationPolicies() {
    return (
      await fixture.operator.query<{
        organizationId: string;
        protectedInformation: string;
        updatedByUserId: string | null;
      }>(
        `SELECT organization_id AS "organizationId", protected_information AS "protectedInformation", updated_by_user_id AS "updatedByUserId" FROM "openmeld"."organization_information_protection_policies" ORDER BY organization_id`
      )
    ).rows;
  }
  return {
    binding: fixture.binding,
    fixture,
    db,
    calls,
    bindingRows,
    bindingWriteEvents,
    centerAgentDesignations,
    readCenterAgentAuditRows,
    readMemberActivities,
    readMemoryPolicies,
    readInformationPolicies,
    authorizationRows: fixture.rows("organization_binding_authorizations", [
      "id",
    ]),
    spaces,
    agentProfiles: input.agentProfiles,
    members: input.members,
    writeAgentProfile,
  };
}

function buildOrganizationDirectoryAgentProfileRow(input: {
  members: ReturnType<typeof memberRow>[];
  profile: {
    createdAt?: number;
    createdByUserId?: string | null;
    creatorProfileId?: string | null;
    hasBinding?: boolean;
    isDefault?: number;
    lastUsedAt?: number | null;
    managedRole?: string | null;
    organizationId: string;
    ownerUserId: string | null;
    profileHandle: string;
    profileId: string;
    profileName: string;
    source?: string;
    status: "active" | "disabled";
    updatedAt?: number;
  };
}) {
  const owner = input.members.find(
    (member) => member.userId === input.profile.ownerUserId
  );
  return {
    created_at: input.profile.createdAt ?? 1_700_000_000_000,
    created_by_user_id: input.profile.createdByUserId ?? null,
    creator_profile_id: input.profile.creatorProfileId ?? null,
    is_default: input.profile.isDefault ?? 0,
    last_used_at: input.profile.lastUsedAt ?? null,
    managed_role: input.profile.managedRole ?? null,
    organization_id: input.profile.organizationId,
    owner_name: owner?.userName ?? null,
    owner_user_id: input.profile.ownerUserId,
    profile_handle: input.profile.profileHandle,
    profile_id: input.profile.profileId,
    profile_name: input.profile.profileName,
    source: input.profile.source ?? "cli_create",
    status: input.profile.status,
    updated_at: input.profile.updatedAt ?? 1_700_000_000_000,
  };
}

function organizationRpcHumanProfile(userId: string): {
  lastUsedAt: number;
  profileHandle: string;
  profileId: string;
  profileName: string;
  status: "active";
} | null {
  if (userId === "user-a") {
    return {
      lastUsedAt: 1_700_000_000_000,
      profileHandle: "ava",
      profileId: HUMAN_PROFILE_ID,
      profileName: "Ava",
      status: "active",
    };
  }
  if (userId === "user-b") {
    return {
      lastUsedAt: 1_700_000_000_000,
      profileHandle: "ben",
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileName: "Ben",
      status: "active",
    };
  }
  return null;
}

function bindingKey(
  ownerKind: "owner_account" | "organization",
  ownerId: string,
  agentProfileId: string
): string {
  return `${ownerKind}:${ownerId}:${agentProfileId}`;
}

function mapAgentProfileBindingTestRow(row: AgentProfileBindingTestRow) {
  return {
    agent_controller_conversation_id: row.agentControllerConversationId,
    agent_controller_permission_mode: row.agentControllerPermissionMode,
    agent_controller_ref: row.agentControllerRef,
    agent_profile_id: row.agentProfileId,
    binding_id: row.bindingId,
    binding_state: row.bindingState,
    configuration_revision: row.configurationRevision,
    created_at_ms: row.createdAtMs,
    created_by_profile_id: row.createdByProfileId,
    disabled_at_ms: row.disabledAtMs,
    hosted_runtime_identity_json: row.hostedRuntimeIdentityJson,
    model_id: row.modelId,
    opencode_permission: row.openCodePermission,
    owner_id: row.ownerId,
    owner_kind: row.ownerKind,
    reason_code: row.reasonCode,
    reasoning_level: row.reasoningLevel,
    runtime_kind: row.runtimeKind,
    updated_at_ms: row.updatedAtMs,
    openmeld_service_runtime_id: row.openMeldServiceRuntimeId,
  };
}

function buildTestSpaceBootstrap(input: {
  space: ReturnType<typeof spaceRow> | null;
  spaceId: string;
}) {
  const generatedAt = "2026-07-06T00:00:00.000Z";
  const name = input.space?.spaceName ?? null;
  const purpose = input.space?.spacePurpose ?? null;
  return {
    history: { nextCursor: null, signals: [] },
    members: {
      agents: [],
      generatedAt,
      humans: [],
      spaceId: input.spaceId,
      summary: {
        agentCount: 0,
        checkingAgentCount: 0,
        humanCount: 0,
        liveNowCount: 0,
        offlineAgentCount: 0,
        totalCount: 0,
        unavailableAgentCount: 0,
        wakeableAgentCount: 0,
      },
    },
    status: {
      accessMode: "public",
      allowedActions: ["post_message", "post_status", "stay_silent"],
      dispatchBrief: "default",
      dispatchPolicy: { mode: "mention_only" },
      entryBrief: "default",
      generatedAt,
      members: {
        agentCount: 0,
        humanCount: 0,
        liveAgentCount: 0,
        liveHumanCount: 0,
        liveNowCount: 0,
        totalCount: 0,
      },
      ...(name ? { name } : {}),
      passwordProtected: false,
      publicationMode: "collaboration",
      resultArchivePolicy: { mode: "space_reply_only" },
      spaceId: input.spaceId,
      ...(purpose ? { spacePurpose: purpose } : {}),
    },
    threads: { previews: [], threads: [] },
  };
}

function createTextSignal(input: {
  id: string;
  text: string;
  ts: number;
}): SignalTextEnvelope {
  return {
    data: { text: input.text },
    id: input.id,
    profile: {
      kind: "human",
      profileId: HUMAN_PROFILE_ID,
      profileName: "Felix",
    },
    spaceId: JOINED_PRIVATE_SPACE_ID,
    ts: input.ts,
    type: "signal.text",
    v: 1,
  };
}

function createSpaceStub(
  input: {
    enforceAddressingTargetMembership?: boolean;
    getThreadResponse?: GetSpaceThreadResponse;
    initialActiveMemberProfileIdsBySpace?: Readonly<
      Record<string, readonly string[]>
    >;
    initialSignals?: SignalEnvelope[];
    listThreadSignalsResponse?: ListSpaceThreadSignalsResponse;
    listThreadsResponse?: ListSpaceThreadsResponse;
    spaces?: ReturnType<typeof spaceRow>[];
    unjoinedSpaceIds?: readonly string[];
  } = {}
) {
  const spaces = input.spaces ?? [];
  let projectionWriter:
    | ((
        snapshot: Omit<ProjectSpaceIndexSnapshotInput, "db">
      ) => Promise<unknown>)
    | undefined;
  let revision = 0;
  async function projectSnapshot(
    spaceId: string,
    eventType: ProjectSpaceIndexSnapshotInput["eventType"]
  ) {
    const space = spaces.find((space) => space.spaceId === spaceId);
    if (!(space && projectionWriter)) {
      return;
    }
    const updatedAt = new Date(TEST_NOW_MS + ++revision).toISOString();
    await projectionWriter({
      eventType,
      metaRecord: {
        v: 1,
        spaceId,
        organizationId: space.organizationId,
        visibility: space.visibility,
        accessMode: "members_only",
        createdAt: new Date(space.spaceCreatedAtMs).toISOString(),
        updatedAt,
        ...(space.spaceName ? { name: space.spaceName } : {}),
        ...(space.spacePurpose ? { purpose: space.spacePurpose } : {}),
        ...(space.directMessagePairKey
          ? { directMessage: { pairKey: space.directMessagePairKey } }
          : {}),
      },
      memberRecords: [...(memberProfileIdsBySpace.get(spaceId) ?? [])].map(
        (profileId) => ({
          spaceId,
          profileId,
          profileKindSnapshot:
            memberKindsBySpace.get(spaceId)?.get(profileId) === "agent"
              ? "agent"
              : "human",
          profileNameSnapshot: profileId,
          ownerUserIdSnapshot:
            new Map([
              [HUMAN_PROFILE_ID, "user-a"],
              [SECOND_HUMAN_PROFILE_ID, "user-b"],
            ]).get(profileId) ?? null,
          ownerNameSnapshot: null,
          controllerRefSnapshot: null,
          status: "active",
          memberSource: "added_by_member",
          addedAt: updatedAt,
          removedAt: null,
          addedByProfileId: null,
          addedByOwnerUserId: null,
          addedByDisplayNameSnapshot: null,
          removedByProfileId: null,
          removedByOwnerUserId: null,
          removalReason: null,
          firstEnteredAt: null,
          lastEnteredAt: null,
          createdAt: updatedAt,
          updatedAt,
        })
      ),
    });
  }
  const memberProfileIdsBySpace = new Map(
    Object.entries(input.initialActiveMemberProfileIdsBySpace ?? {}).map(
      ([spaceId, profileIds]) => [spaceId, new Set(profileIds)] as const
    )
  );
  const memberKindsBySpace = new Map(
    [...memberProfileIdsBySpace].map(([spaceId, profileIds]) => [
      spaceId,
      new Map(
        [...profileIds].map((profileId) => [
          profileId,
          profileId.startsWith("agt_") ? "agent" : "human",
        ])
      ),
    ])
  );
  const signals: SignalEnvelope[] = [...(input.initialSignals ?? [])];
  const patchSpaceMeta = vi.fn(
    async (request: {
      accessMode?:
        | "members_only"
        | "protected"
        | "public"
        | "public_view_join_password";
      name?: string;
      creator?: { profileId: string; kind: "agent" | "human" };
      initialOwnerMember?: { profileId: string; profileKind: "human" };
      organizationId?: string;
      purpose?: string;
      spaceId: string;
      visibility?: "public" | "private";
    }) => {
      const existing = spaces.find(
        (space) => space.spaceId === request.spaceId
      );
      if (existing) {
        existing.organizationId =
          request.organizationId ?? existing.organizationId;
        existing.spaceName = request.name ?? existing.spaceName;
        existing.spacePurpose = request.purpose ?? existing.spacePurpose;
        existing.visibility = request.visibility ?? existing.visibility;
      } else {
        spaces.push(
          spaceRow({
            organizationId: request.organizationId ?? "org-a",
            spaceId: request.spaceId,
            spaceName: request.name ?? null,
            spacePurpose: request.purpose ?? null,
            visibility: request.visibility ?? "private",
          })
        );
      }
      if (!existing && request.initialOwnerMember) {
        const memberIds = new Set(
          [
            request.creator?.profileId,
            request.initialOwnerMember.profileId,
          ].filter((profileId): profileId is string => Boolean(profileId))
        );
        memberProfileIdsBySpace.set(request.spaceId, memberIds);
        memberKindsBySpace.set(
          request.spaceId,
          new Map([
            ...(request.creator
              ? [[request.creator.profileId, request.creator.kind] as const]
              : []),
            [request.initialOwnerMember.profileId, "human" as const],
          ])
        );
        const space = spaces.find((item) => item.spaceId === request.spaceId);
        if (space) {
          space.activeMemberCount = memberIds.size;
          space.activeHumanCount = 1;
          space.activeAgentCount = request.creator?.kind === "agent" ? 1 : 0;
        }
      }
      await projectSnapshot(request.spaceId, "space.meta_updated");
      return Promise.resolve({
        accessMode: request.accessMode ?? "public",
        name: request.name ?? "Untitled space",
        organizationId: request.organizationId ?? "org-a",
        ...(request.purpose === undefined ? {} : { purpose: request.purpose }),
        passwordProtected: false,
        spaceId: request.spaceId,
        visibility: request.visibility ?? "private",
      });
    }
  );
  const initializeDirectMessageMeta = vi.fn(
    async (request: {
      name?: string;
      organizationId: string;
      pairKey: string;
      purpose: string;
      spaceId: string;
      visibility: "public" | "private";
    }) => {
      const existing = spaces.find(
        (space) => space.spaceId === request.spaceId
      );
      const created = !existing;
      const row =
        existing ??
        spaceRow({
          organizationId: request.organizationId,
          spaceId: request.spaceId,
          spaceName: request.name ?? null,
          visibility: request.visibility,
        });
      row.directMessagePairKey = request.pairKey;
      row.organizationId = request.organizationId;
      row.spacePurpose = request.purpose;
      row.visibility = request.visibility;
      if (!existing) {
        spaces.push(row);
      }
      await projectSnapshot(request.spaceId, "space.meta_updated");
      return Promise.resolve({
        created,
        meta: {
          name: request.name ?? row.spaceName ?? "Untitled space",
          organizationId: request.organizationId,
          purpose: request.purpose,
          spaceId: request.spaceId,
          visibility: request.visibility,
        },
      });
    }
  );
  const listSignals = (request: {
    fromProfileIds?: readonly string[];
    signalTypes?: readonly string[];
    spaceId: string;
  }) =>
    Promise.resolve({
      nextCursor: null,
      signals: signals.filter(
        (signal) =>
          signal.spaceId === request.spaceId &&
          (!request.signalTypes?.length ||
            request.signalTypes.includes(signal.type)) &&
          (!request.fromProfileIds?.length ||
            request.fromProfileIds.includes(signal.profile.profileId))
      ),
    });
  type SignalPostRequest = {
    authoringPolicy?: "system_emitted" | "user_authored";
    messageEnvelope?: {
      activationTargets: string[];
      mentionTargets?: string[];
      referenceTargets: string[];
      text: string;
    };
    meta?: { clientMessageId?: string; purpose?: string };
    profile: {
      kind?: "agent" | "human" | "system";
      profileId: string;
      profileName?: string;
    };
    spaceId: string;
    text: string;
  };
  const assertAddressingTargetsAreActiveMembers = (
    request: SignalPostRequest
  ): void => {
    if (!input.enforceAddressingTargetMembership) {
      return;
    }
    const missingActivationTargetProfileId =
      request.messageEnvelope?.activationTargets.find(
        (profileId) =>
          !memberProfileIdsBySpace.get(request.spaceId)?.has(profileId)
      );
    if (missingActivationTargetProfileId) {
      const reason = `Wake target ${missingActivationTargetProfileId} is not an active Space member.`;
      throw Object.assign(new Error(reason), {
        code: "space.wake.target_invalid",
        reason,
        status: 422,
      });
    }
    const missingMentionTargetProfileId =
      request.messageEnvelope?.mentionTargets?.find(
        (profileId) =>
          !memberProfileIdsBySpace.get(request.spaceId)?.has(profileId)
      );
    if (missingMentionTargetProfileId) {
      const reason = `Human Mention target ${missingMentionTargetProfileId} is not an active Space member.`;
      throw Object.assign(new Error(reason), {
        code: "space.addressing.target_invalid",
        reason,
        status: 422,
      });
    }
    const missingReferenceTargetProfileId =
      request.messageEnvelope?.referenceTargets.find(
        (profileId) =>
          !memberProfileIdsBySpace.get(request.spaceId)?.has(profileId)
      );
    if (!missingReferenceTargetProfileId) {
      return;
    }
    const reason = `Reference target ${missingReferenceTargetProfileId} is not an active Space member.`;
    throw Object.assign(new Error(reason), {
      code: "space.addressing.target_invalid",
      reason,
      status: 422,
    });
  };
  const postSignal = vi.fn((request: SignalPostRequest) => {
    assertAddressingTargetsAreActiveMembers(request);
    const policyResult = validateSpaceSignalClientMessageIdPolicy({
      authoringPolicy: request.authoringPolicy,
      messageEnvelope: request.messageEnvelope,
      meta: request.meta,
    });
    if (!policyResult.ok) {
      return Promise.reject({
        code: policyResult.code,
        reason: policyResult.message,
        status: 400,
      });
    }
    const signal = {
      data: {
        ...(request.messageEnvelope
          ? { messageEnvelope: request.messageEnvelope }
          : {}),
        ...(request.meta ? { meta: request.meta } : {}),
        text: request.text,
      },
      id: `signal_${signals.length + 1}`,
      profile: {
        ...request.profile,
        kind: request.profile.kind ?? "agent",
      },
      spaceId: request.spaceId,
      ts: TEST_NOW_MS,
      type: "signal.text",
      v: 1,
    } as const;
    signals.push(signal);
    return Promise.resolve(signal);
  });
  const postSignalOnceByClientMessageId = vi.fn(
    (request: SignalPostRequest & { clientMessageId: string }) => {
      if (request.meta?.clientMessageId !== request.clientMessageId) {
        return Promise.reject({
          code: "space.signal.client_message_id_mismatch",
          reason:
            "The idempotent signal clientMessageId must match data.meta.clientMessageId.",
          status: 400,
        });
      }
      const policyResult = validateSpaceSignalClientMessageIdPolicy({
        authoringPolicy: request.authoringPolicy,
        messageEnvelope: request.messageEnvelope,
        meta: request.meta,
      });
      if (!policyResult.ok) {
        return Promise.reject({
          code: policyResult.code,
          reason: policyResult.message,
          status: 400,
        });
      }
      const existingSignal = signals.find(
        (signal): signal is SignalTextEnvelope =>
          signal.type === "signal.text" &&
          signal.spaceId === request.spaceId &&
          signal.data.meta?.clientMessageId === request.clientMessageId
      );
      if (existingSignal) {
        return Promise.resolve(existingSignal);
      }
      assertAddressingTargetsAreActiveMembers(request);
      return postSignal({
        ...request,
        meta: {
          ...(request.meta ?? {}),
          clientMessageId: request.clientMessageId,
        },
      });
    }
  );
  return {
    setProjectionWriter(writer: NonNullable<typeof projectionWriter>) {
      projectionWriter = writer;
    },
    rpcGetMeta: vi.fn((request: { spaceId: string }) => {
      const space = spaces.find((item) => item.spaceId === request.spaceId);
      if (!space) {
        return Promise.reject(
          Object.assign(new Error("Space was not found."), {
            code: "space.not_found",
            status: 404,
          })
        );
      }
      return Promise.resolve({
        ...(space.spaceName ? { name: space.spaceName } : {}),
        organizationId: space.organizationId,
        ...(space.spacePurpose ? { purpose: space.spacePurpose } : {}),
        spaceId: space.spaceId,
        visibility: space.visibility,
      });
    }),
    rpcGetIdentityDirectory: vi.fn((request: { spaceId: string }) => {
      const profileIds = [
        ...(memberProfileIdsBySpace.get(request.spaceId) ?? []),
      ];
      return Promise.resolve({
        entries: profileIds.map((profileId) => ({
          agentControllerRef: null,
          mentionAlias: null,
          ownerName: null,
          ownerUserId: null,
          profileId,
          profileKind: profileId.startsWith("agt_") ? "agent" : "human",
          profileName: profileId,
        })),
        generatedAt: new Date(TEST_NOW_MS).toISOString(),
        spaceId: request.spaceId,
      });
    }),
    rpcInitializeDirectMessageMeta: initializeDirectMessageMeta,
    rpcConvertDirectMessageToSpace: vi.fn(
      (request: {
        members: Array<{ profileId: string }>;
        name: string;
        spaceId: string;
      }) =>
        Promise.resolve({
          accessMode: "members_only" as const,
          addedMemberIds: request.members.map((member) => member.profileId),
          alreadyMemberIds: [],
          convertedAt: "2026-08-07T12:00:00.000Z",
          name: request.name,
          spaceId: request.spaceId,
        })
    ),
    rpcPatchMeta: patchSpaceMeta,
    rpcPatchMetaWithPasswordAtomic: patchSpaceMeta,
    rpcListSpaceFiles: vi.fn(
      (request: {
        query?: {
          view?: "active" | "trash";
          origin?: "artifact" | "all";
        };
        spaceId: string;
      }) =>
        Promise.resolve({
          breadcrumbs:
            request.query?.view === "trash"
              ? [
                  { id: null, name: "Files" },
                  { id: null, name: "Trash" },
                ]
              : [{ id: null, name: "Files" }],
          capabilities: { canRead: true as const, canWrite: true },
          entries: [],
          parentId: null,
          spaceId: request.spaceId,
          view: request.query?.view ?? "active",
          origin: request.query?.origin ?? "artifact",
        })
    ),
    rpcListSignals: vi.fn(listSignals),
    rpcListSignalsResult: vi.fn(
      async (request: Parameters<typeof listSignals>[0]) => ({
        ok: true,
        value: await listSignals(request),
      })
    ),
    rpcPostSignal: postSignal,
    rpcPostSignalOnceByClientMessageId: postSignalOnceByClientMessageId,
    rpcPostDirectMessageSignal: postSignalOnceByClientMessageId,
    rpcPostMembers: vi.fn(
      async (request: {
        members: Array<{ profileId: string; profileKind?: string }>;
        requireActorMembership?: boolean;
        spaceId: string;
      }) => {
        if (
          request.requireActorMembership === true &&
          input.unjoinedSpaceIds?.includes(request.spaceId)
        ) {
          throw Object.assign(
            new Error("Join this Space before adding other members."),
            {
              code: "space.membership_required",
              status: 403,
            }
          );
        }
        let memberProfileIds = memberProfileIdsBySpace.get(request.spaceId);
        if (!memberProfileIds) {
          memberProfileIds = new Set();
          memberProfileIdsBySpace.set(request.spaceId, memberProfileIds);
        }
        const memberKinds =
          memberKindsBySpace.get(request.spaceId) ?? new Map();
        memberKindsBySpace.set(request.spaceId, memberKinds);
        const addedMemberIds: string[] = [];
        const alreadyMemberIds: string[] = [];
        for (const member of request.members) {
          if (memberProfileIds.has(member.profileId)) {
            alreadyMemberIds.push(member.profileId);
          } else {
            addedMemberIds.push(member.profileId);
            memberProfileIds.add(member.profileId);
          }
          memberKinds.set(member.profileId, member.profileKind ?? "human");
        }
        const space = spaces.find((item) => item.spaceId === request.spaceId);
        if (space) {
          space.activeMemberCount = memberProfileIds.size;
          space.activeHumanCount = [...memberKinds.values()].filter(
            (kind) => kind === "human"
          ).length;
          space.activeAgentCount = [...memberKinds.values()].filter(
            (kind) => kind === "agent"
          ).length;
        }
        await projectSnapshot(request.spaceId, "space.members_updated");
        return Promise.resolve({
          addedMemberIds,
          alreadyMemberIds,
          items: [],
        });
      }
    ),
    rpcRemoveMembers: vi.fn(
      (request: { memberProfileIds: string[]; spaceId: string }) => {
        const memberProfileIds = memberProfileIdsBySpace.get(request.spaceId);
        for (const profileId of request.memberProfileIds) {
          memberProfileIds?.delete(profileId);
        }
        const space = spaces.find((item) => item.spaceId === request.spaceId);
        if (space) {
          space.activeMemberCount = Math.max(
            0,
            (space.activeMemberCount ?? 0) - request.memberProfileIds.length
          );
          space.activeAgentCount = Math.max(
            0,
            (space.activeAgentCount ?? 0) - request.memberProfileIds.length
          );
        }
        return Promise.resolve({
          alreadyAbsentMemberIds: [],
          removedMemberIds: request.memberProfileIds,
        });
      }
    ),
    rpcLeaveSpace: vi.fn((_request: { spaceId: string }) =>
      Promise.resolve({
        leftProfileId: HUMAN_PROFILE_ID,
        status: "left" as const,
      })
    ),
    rpcDelete: vi.fn((request: { spaceId: string }) =>
      Promise.resolve({
        deleted: true,
        spaceId: request.spaceId,
      })
    ),
    rpcUpsertPassword: vi.fn((request: { spaceId: string }) =>
      Promise.resolve({
        accessMode: "protected" as const,
        passwordProtected: true,
        spaceId: request.spaceId,
      })
    ),
    rpcClearPassword: vi.fn((request: { spaceId: string }) =>
      Promise.resolve({
        accessMode: "public" as const,
        passwordProtected: false,
        spaceId: request.spaceId,
      })
    ),
    rpcSetAccessMode: vi.fn(
      (request: {
        accessMode: "protected" | "public" | "public_view_join_password";
        spaceId: string;
      }) =>
        Promise.resolve({
          accessMode: request.accessMode,
          passwordProtected: request.accessMode === "protected",
          spaceId: request.spaceId,
        })
    ),
    rpcPatchContract: vi.fn(
      (request: {
        contractPatch: {
          publicationMode?: "collaboration" | "raw_context_sharing";
        };
        spaceId: string;
      }) =>
        Promise.resolve({
          allowedActions: ["post_message", "post_status", "stay_silent"],
          authorityOrder: "default",
          dispatchBrief: "default",
          dispatchPolicy: { mode: "mention_only" },
          entryBrief: "default",
          publicationMode:
            request.contractPatch.publicationMode ?? "collaboration",
          resultArchivePolicy: { mode: "all_final_results" },
          updatedAt: new Date(TEST_NOW_MS).toISOString(),
          updatedBy: HUMAN_PROFILE_ID,
          version: 1,
        })
    ),
    rpcGetBootstrapWithTiming: vi.fn((request: { spaceId: string }) =>
      Promise.resolve({
        metrics: [],
        payload: buildTestSpaceBootstrap({
          space:
            spaces.find((space) => space.spaceId === request.spaceId) ?? null,
          spaceId: request.spaceId,
        }),
        serverTiming: "",
      })
    ),
    rpcGetThreadResult: vi.fn(
      (request: { spaceId: string; threadId: string }) =>
        Promise.resolve({
          ok: true as const,
          value: input.getThreadResponse ?? {
            rootSignal: null,
            thread: {
              createdAt: new Date(TEST_NOW_MS).toISOString(),
              createdByProfileId: HUMAN_PROFILE_ID,
              rootSignalId: "signal-root",
              spaceId: request.spaceId,
              threadId: request.threadId,
              updatedAt: new Date(TEST_NOW_MS).toISOString(),
            },
          },
        })
    ),
    rpcListThreadSignalsResult: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: input.listThreadSignalsResponse ?? {
          placements: [],
          signals: [],
        },
      })
    ),
    rpcListThreadsResult: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: input.listThreadsResponse ?? { previews: [], threads: [] },
      })
    ),
  };
}

async function readCenterAgentDirectMessageForbiddenError(
  promise: Promise<unknown>
): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error(
    "Expected Center Agent Direct Message mutation to be rejected"
  );
}

function createSpaceNamespace(spaceStub: ReturnType<typeof createSpaceStub>) {
  let nextId = 1;
  return {
    newUniqueId: vi.fn(() => {
      const id = String(nextId++).padStart(64, "0");
      return { toString: () => id };
    }),
    idFromString: vi.fn((id: string) => id),
    idFromName: vi.fn((name: string) => {
      const id = resolveTestNamedSpaceId(name);
      return { toString: () => id };
    }),
    get: vi.fn(() => spaceStub),
  } as unknown as DurableObjectNamespace;
}

function resolveTestNamedSpaceId(name: string): string {
  const hash = Array.from(name).reduce(
    (value, char) => (value * 33n + BigInt(char.charCodeAt(0))) % 2n ** 256n,
    5381n
  );
  return hash.toString(16).padStart(64, "0");
}

function createOwnerLocalRuntimesWithUsageLimits(): LocalRuntimesResponse {
  return {
    currentDeviceId: null,
    currentRuntimeLane: null,
    localRuntimes: [
      {
        deviceDisplayName: "Owner Mac",
        deviceDisplayNameSource: "user",
        deviceId: "computer-owner",
        deviceType: "laptop",
        executionTargets: [
          {
            capabilities: [
              {
                agentControllerInterface: {
                  agentControllerRef: "builtin:codex",
                  auth: { status: "authenticated" },
                  capabilities: {
                    approvals: true,
                    cancel: true,
                    interrupt: true,
                    modelSelection: true,
                    nativeEventStream: true,
                    permissionModes: true,
                    structuredUserInput: true,
                  },
                  check: {
                    lastSucceededAt: "2026-08-19T00:00:00.000Z",
                    status: "succeeded",
                  },
                  checkedAt: "2026-08-19T00:00:00.000Z",
                  controllerId: "codex",
                  displayName: "Codex",
                  launch: {
                    argsPrefix: [],
                    commandPath: "/private/codex",
                    installChoiceCount: 1,
                    status: "ready",
                  },
                  message: null,
                  models: [],
                  nativeInterface: "codex-app-server",
                  schemaVersion: 1,
                  skills: [],
                  status: "ready",
                  usageLimits: [
                    {
                      key: "codex:primary",
                      label: "5-hour usage",
                      observedAt: "2026-08-19T00:00:00.000Z",
                      resetsAt: "2026-08-19T05:00:00.000Z",
                      status: "available",
                      usedPercent: 62,
                    },
                  ],
                  version: "0.148.0",
                },
                agentControllerRef: "builtin:codex",
                enabled: true,
                reasonCodes: [],
                status: "ready",
              },
            ],
            deviceId: "computer-owner",
            isCurrent: false,
            lastObservedAtMs: 1,
            localAgentCatalog: {
              detectedNotSupportedYet: 0,
              detectedSupported: 1,
              entries: [
                {
                  agentId: "codex",
                  detected: true,
                  displayName: "Codex",
                  enabled: true,
                  launchStatus: "ready",
                  lifecycleStatus: "active",
                  selectable: true,
                  selectableReason: null,
                  targetKind: "builtin",
                },
              ],
              needsChoice: 0,
              needsRepair: 0,
              notDetected: 0,
              totalBuiltins: 1,
            },
            localAgentControl: {
              refreshCatalog: true,
              setEnabled: true,
            },
            openMeldServiceRuntimeId: null,
            reasonCodes: [],
            runtimeLane: "prod",
            status: "ready",
            userFacingCommand: "openmeld",
          },
        ],
        firstSeenAtMs: 1,
        isCurrent: false,
        lastObservedAtMs: 1,
        osVersion: "15.6",
        platformFamily: "macOS",
      },
    ],
  };
}

function createMissingCurrentComputerReadiness() {
  return {
    canReplyFromThisComputer: false,
    currentTarget: { availability: "missing" as const },
    generatedAt: "2026-08-19T00:00:00.000Z",
    localComponents: {
      agentSetupCommand: "openmeld setup --view agent",
      cli: {
        commandContractVersion: null,
        installedPackageVersion: null,
        latestPackageVersion: null,
        reasonCodes: [],
        requiredCommandContractVersion: null,
        status: "unknown" as const,
        updatePolicy: "required" as const,
        wakeBlocked: false,
      },
      generatedAt: "2026-08-19T00:00:00.000Z",
      humanSetupCommand: "openmeld setup",
      schemaVersion: 1 as const,
      service: {
        installedVersion: null,
        latestVersion: null,
        reasonCodes: [],
        requiredVersion: null,
        status: "unknown" as const,
        updatePolicy: "required" as const,
        wakeBlocked: false,
      },
      setupAction: "connect_service" as const,
      setupActionDescription: "Connect OpenMeld Service on this computer.",
      setupActionLabel: "Connect OpenMeld Service",
      skills: {
        expectedBundleHash: null,
        expectedTargetCount: 0,
        installedBundleHash: null,
        reasonCodes: [],
        skillContractVersion: null,
        status: "unknown" as const,
        targetCount: null,
        updatePolicy: "required" as const,
        wakeBlocked: false,
      },
    },
    message: "No current Computer was found.",
    nextAction: "run_setup" as const,
    primaryBlocker: "current_runtime_missing" as const,
    runtime: {
      deviceDisplayName: null,
      deviceId: null,
      executionTargetStatus: null,
      lastObservedAtMs: null,
      openMeldServiceRuntimeId: null,
      reasonCodes: [],
      runtimeLane: null,
      signInOnlyBlockers: false,
    },
    service: {
      connected: false,
      executionCompatibility: null,
      matchingCurrentRuntime: false,
      reasonCodes: [],
      sessionDeviceId: null,
      sessionLane: null,
    },
    status: "blocked" as const,
  };
}
