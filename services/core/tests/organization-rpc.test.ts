import {
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
  SignalTextEnvelope,
} from "@openmeld/schemas/types";
import { OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE } from "@openmeld/space";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ApplyAcceptedBindingAuthorizationPoliciesInput,
  applyAcceptedBindingAuthorizationPolicies,
} from "../src/agent-profile-binding/application/organization-binding-authorization-policy-service";
// biome-ignore lint/performance/noNamespaceImport: Vitest must spy on the live ESM exports used by the RPC orchestration module.
import * as centerAgentWakePublicationService from "../src/center-agent/application/center-agent-wake-publication-service";
import type { CenterAgentWakePublicationRecord } from "../src/center-agent/infrastructure/d1/center-agent-wake-publication-repo";
// biome-ignore lint/performance/noNamespaceImport: Vitest must spy on the live ESM export used by the RPC orchestration module.
import * as runtimeTransportClient from "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client";
import type { CoreBindings } from "../src/lib/bindings";
// biome-ignore lint/performance/noNamespaceImport: Vitest must spy on the live ESM export used by the RPC orchestration module.
import * as organizationComputersService from "../src/organizations/organization-computers-service";
import { encryptSlackSearchAuthorization } from "../src/remote-agent/application/slack-search-authorization";
import {
  rpcAddCenterAgentToSpace,
  rpcAddOrganizationDirectoryProfilesToSpace,
  rpcAddSpaceMembers,
  rpcAuthorizeAgentProfileBindingForOrganization,
  rpcBulkAuthorizeAgentProfileBindingsForOrganization,
  rpcCenterAgentAddAgentProfilesToSpace,
  rpcCenterAgentAddMembersToSpace,
  rpcCenterAgentCreateAgentProfile,
  rpcCenterAgentCreateSpace,
  rpcCenterAgentListComputers,
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
  rpcCenterAgentRecordConnectorActionAudit,
  rpcCenterAgentRemoveAgentProfilesFromSpace,
  rpcCenterAgentSearchSlackMessages,
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
  rpcGetCurrentOrganizationComputers,
  rpcGetCurrentOrganizationDirectory,
  rpcGetCurrentOrganizationSpaceDirectory,
  rpcGetCurrentOrganizationSpaceDirectoryWithMemberCounts,
  rpcGetOrganizationBindingAuthorizationPreference,
  rpcJoinOrganizationPublicSpace,
  rpcLeaveSpace,
  rpcListCenterAgentAuditJournal,
  rpcListCurrentUserAgentProfileOrganizationWakeAccess,
  rpcListOrganizationBindingAuthorizationProfiles,
  rpcListOrganizationBindingAuthorizations,
  rpcOpenCenterAgentDirectMessageSpace,
  rpcOpenDirectMessageSpace,
  rpcPatchSpaceContract,
  rpcPostCenterAgentWakePublicationSignal,
  rpcReadCenterAgentOrganizationMemoryPolicy,
  rpcReadOrganizationInformationProtectionPolicy,
  rpcRemoveSpaceMembers,
  rpcRevokeAgentProfileBindingForOrganization,
  rpcSaveOrganizationWakeAccessChoice,
  rpcSetCenterAgentOrganizationMemoryPolicy,
  rpcSetOrganizationBindingAuthorizationPreference,
  rpcSetOrganizationInformationProtectionPolicy,
  rpcSetSpaceAccessMode,
  rpcUpdateCenterAgentModel,
  rpcUpdateCenterAgentOperatingState,
  rpcUpdateCenterAgentProfile,
  rpcUpsertSpacePassword,
} from "../src/rpc/methods";
// biome-ignore lint/performance/noNamespaceImport: Vitest must spy on the live ESM export used by the RPC orchestration module.
import * as currentDeviceTargetService from "../src/start/application/current-device-target-service";

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("organization Core RPC", () => {
  it("rejects organization directory reads when the active user is not an organization member", async () => {
    const env = buildEnv({
      members: [],
    });

    await expect(
      rpcGetCurrentOrganizationDirectory(env, {
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

  it("authorizes the current primary Binding for the active Organization only through the Core authorization table", async () => {
    const db = createOrganizationRpcDb({
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
      members: [memberRow("member-a", "org-a", "user-a")],
    });
    const env = buildEnv({ db });

    const response = await rpcAuthorizeAgentProfileBindingForOrganization(env, {
      agentProfileId: AGENT_PROFILE_ID,
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });

    expect(response).toMatchObject({
      agentProfileId: AGENT_PROFILE_ID,
      authorizedBy: "user-a",
      bindingId: `binding-${AGENT_PROFILE_ID}`,
      organizationId: "org-a",
      status: "authorized",
    });
    expect(db.authorizationWrites).toEqual([
      {
        bindingId: `binding-${AGENT_PROFILE_ID}`,
        organizationId: "org-a",
      },
    ]);
    expect(db.disallowedWrites).toEqual([]);
  });

  it("authorizes a caller personal Agent Profile Binding for the active collaboration Organization", async () => {
    const db = createOrganizationRpcDb({
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
      members: [
        memberRow("member-personal", "org-personal", "user-a", "owner"),
        memberRow("member-acme", "org-acme", "user-a", "owner"),
      ],
      personalOrganizations: [
        { organizationId: "org-personal", userId: "user-a" },
      ],
    });
    const env = buildEnv({ db });
    const context = buildContext({
      activeOrganizationId: "org-acme",
      userId: "user-a",
    });

    await expect(
      rpcAuthorizeAgentProfileBindingForOrganization(env, {
        agentProfileId: AGENT_PROFILE_ID,
        context,
      })
    ).resolves.toMatchObject({
      agentProfileId: AGENT_PROFILE_ID,
      authorizedBy: "user-a",
      bindingId: `binding-${AGENT_PROFILE_ID}`,
      organizationId: "org-acme",
      status: "authorized",
    });
    await expect(
      rpcRevokeAgentProfileBindingForOrganization(env, {
        agentProfileId: AGENT_PROFILE_ID,
        context,
      })
    ).resolves.toMatchObject({
      agentProfileId: AGENT_PROFILE_ID,
      bindingId: `binding-${AGENT_PROFILE_ID}`,
      organizationId: "org-acme",
      revoked: true,
      status: "revoked",
    });
    expect(db.authorizationWrites).toEqual([
      {
        bindingId: `binding-${AGENT_PROFILE_ID}`,
        organizationId: "org-acme",
      },
    ]);
    expect(db.authorizationDeletes).toEqual([
      {
        bindingId: `binding-${AGENT_PROFILE_ID}`,
        organizationId: "org-acme",
      },
    ]);
  });

  it("rejects authorizing a personal Center Agent Binding for another Organization", async () => {
    const db = createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({
          organizationId: "org-personal",
          ownerUserId: "user-a",
        }),
      ],
      members: [
        memberRow("member-personal", "org-personal", "user-a", "owner"),
        memberRow("member-acme", "org-acme", "user-a", "owner"),
      ],
      personalOrganizations: [
        { organizationId: "org-personal", userId: "user-a" },
      ],
    });
    const env = buildEnv({ db });

    await expect(
      rpcAuthorizeAgentProfileBindingForOrganization(env, {
        agentProfileId: AGENT_PROFILE_ID,
        context: buildContext({
          activeOrganizationId: "org-acme",
          userId: "user-a",
        }),
      })
    ).rejects.toMatchObject({
      code: "organization_binding_authorization.managed_profile_org_mismatch",
      status: 403,
    });
    expect(db.authorizationWrites).toEqual([]);
  });

  it("bulk-authorizes only the caller's current Agent Profile Bindings for the requested Organization", async () => {
    const db = createOrganizationRpcDb({
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
        {
          organizationId: "org-a",
          ownerUserId: "user-b",
          profileHandle: "other",
          profileId: "agt_00000000-0000-4000-8000-000000000004",
          profileName: "Other",
          status: "active",
        },
      ],
      members: [memberRow("member-a", "org-a", "user-a")],
    });
    const env = buildEnv({ db });

    const response = await rpcBulkAuthorizeAgentProfileBindingsForOrganization(
      env,
      {
        organizationId: "org-a",
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
      }
    );

    expect(response).toMatchObject({
      authorizedCount: 2,
      alreadyAuthorizedCount: 0,
      organizationId: "org-a",
    });
    expect(response.authorizations.map((item) => item.agentProfileId)).toEqual([
      AGENT_PROFILE_ID,
      SECOND_AGENT_PROFILE_ID,
    ]);
    expect(db.authorizationWrites).toEqual([
      {
        bindingId: `binding-${AGENT_PROFILE_ID}`,
        organizationId: "org-a",
      },
      {
        bindingId: `binding-${SECOND_AGENT_PROFILE_ID}`,
        organizationId: "org-a",
      },
    ]);
  });

  it("bulk-authorizes caller personal Agent Profile Bindings into the requested Organization", async () => {
    const db = createOrganizationRpcDb({
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
      members: [
        memberRow("member-personal", "org-personal", "user-a", "owner"),
        memberRow("member-acme", "org-acme", "user-a", "owner"),
      ],
      personalOrganizations: [
        { organizationId: "org-personal", userId: "user-a" },
      ],
    });
    const env = buildEnv({ db });

    const response = await rpcBulkAuthorizeAgentProfileBindingsForOrganization(
      env,
      {
        organizationId: "org-acme",
        context: buildContext({
          activeOrganizationId: "org-personal",
          userId: "user-a",
        }),
      }
    );

    expect(response).toMatchObject({
      authorizedCount: 1,
      alreadyAuthorizedCount: 0,
      organizationId: "org-acme",
    });
    expect(response.authorizations).toEqual([
      expect.objectContaining({
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: `binding-${AGENT_PROFILE_ID}`,
        organizationId: "org-acme",
        status: "authorized",
      }),
    ]);
    expect(db.authorizationWrites).toEqual([
      {
        bindingId: `binding-${AGENT_PROFILE_ID}`,
        organizationId: "org-acme",
      },
    ]);
  });

  it("bulk Wake Access skips a personal Center Agent while keeping ordinary personal Agents", async () => {
    const db = createOrganizationRpcDb({
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
          ownerUserId: "user-a",
          profileId: SECOND_AGENT_PROFILE_ID,
        }),
      ],
      members: [
        memberRow("member-personal", "org-personal", "user-a", "owner"),
        memberRow("member-acme", "org-acme", "user-a", "owner"),
      ],
      personalOrganizations: [
        { organizationId: "org-personal", userId: "user-a" },
      ],
    });
    const env = buildEnv({ db });

    const response = await rpcBulkAuthorizeAgentProfileBindingsForOrganization(
      env,
      {
        organizationId: "org-acme",
        context: buildContext({
          activeOrganizationId: "org-personal",
          userId: "user-a",
        }),
      }
    );

    expect(response.authorizations.map((item) => item.agentProfileId)).toEqual([
      AGENT_PROFILE_ID,
    ]);
    expect(db.authorizationWrites).toEqual([
      {
        bindingId: `binding-${AGENT_PROFILE_ID}`,
        organizationId: "org-acme",
      },
    ]);
  });

  it("rejects bulk authorization when any requested Agent Profile is not caller-owned in that Organization", async () => {
    const env = buildEnv({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-b",
          profileHandle: "other",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Other",
          status: "active",
        },
      ],
      members: [memberRow("member-a", "org-a", "user-a")],
    });

    await expect(
      rpcBulkAuthorizeAgentProfileBindingsForOrganization(env, {
        agentProfileIds: [SECOND_AGENT_PROFILE_ID],
        organizationId: "org-a",
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-a",
        }),
      })
    ).rejects.toMatchObject({
      code: "organization_binding_authorization.profile_owner_mismatch",
      status: 403,
    });
  });

  it("stores the per-user per-Organization Binding authorization preference", async () => {
    const db = createOrganizationRpcDb({
      agentProfiles: [],
      members: [memberRow("member-a", "org-a", "user-a")],
    });
    const env = buildEnv({ db });
    const context = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });

    await expect(
      rpcGetOrganizationBindingAuthorizationPreference(env, {
        organizationId: "org-a",
        context,
      })
    ).resolves.toMatchObject({
      autoAuthorizeAgentProfileBindings: false,
      organizationId: "org-a",
      updatedAt: null,
      userId: "user-a",
    });

    await expect(
      rpcSetOrganizationBindingAuthorizationPreference(env, {
        autoAuthorizeAgentProfileBindings: true,
        organizationId: "org-a",
        context,
      })
    ).resolves.toMatchObject({
      autoAuthorizeAgentProfileBindings: true,
      organizationId: "org-a",
      userId: "user-a",
    });

    await expect(
      rpcGetOrganizationBindingAuthorizationPreference(env, {
        organizationId: "org-a",
        context,
      })
    ).resolves.toMatchObject({
      autoAuthorizeAgentProfileBindings: true,
    });
  });

  it("saves current and future Organization Wake access in one atomic batch", async () => {
    const db = createOrganizationRpcDb({
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
          organizationId: "org-personal",
          ownerUserId: "user-a",
          profileHandle: "planner",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Planner",
          status: "active",
        },
      ],
      members: [
        memberRow("member-personal", "org-personal", "user-a", "owner"),
        memberRow("member-acme", "org-acme", "user-a", "owner"),
      ],
      personalOrganizations: [
        { organizationId: "org-personal", userId: "user-a" },
      ],
    });
    const env = buildEnv({ db });

    await expect(
      rpcSaveOrganizationWakeAccessChoice(env, {
        context: buildContext({
          activeOrganizationId: "org-personal",
          userId: "user-a",
        }),
        enableWakeAccess: true,
        organizationId: "org-acme",
      })
    ).resolves.toMatchObject({
      alreadyAuthorizedCount: 0,
      authorizedCount: 2,
      organizationId: "org-acme",
      preference: {
        autoAuthorizeAgentProfileBindings: true,
        organizationId: "org-acme",
        userId: "user-a",
      },
    });
    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(db.authorizationWrites).toEqual([
      {
        bindingId: `binding-${AGENT_PROFILE_ID}`,
        organizationId: "org-acme",
      },
      {
        bindingId: `binding-${SECOND_AGENT_PROFILE_ID}`,
        organizationId: "org-acme",
      },
    ]);
  });

  it("defaults untouched Center Agent organization memory on", async () => {
    const db = createOrganizationRpcDb({
      agentProfiles: [],
      members: [
        memberRow("member-a", "org-a", "user-a", "owner"),
        memberRow("member-b", "org-a", "user-b", "member"),
      ],
    });
    const env = buildEnv({ db });

    await expect(
      rpcReadCenterAgentOrganizationMemoryPolicy(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-b",
        }),
      })
    ).resolves.toMatchObject({
      organizationId: "org-a",
      organizationMemoryOptIn: true,
      provider: "zep_cloud",
      updatedByUserId: null,
    });
  });

  it("preserves an explicit off choice and lets owners idempotently update it", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db });

    await expect(
      rpcReadCenterAgentOrganizationMemoryPolicy(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "user-b",
        }),
      })
    ).resolves.toMatchObject({
      organizationId: "org-a",
      organizationMemoryOptIn: false,
      provider: "zep_cloud",
      updatedByUserId: "user-a",
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
    expect(db.centerAgentMemoryPolicyWrites).toEqual([
      {
        organizationId: "org-a",
        organizationMemoryOptIn: true,
        updatedByUserId: "user-a",
      },
      {
        organizationId: "org-a",
        organizationMemoryOptIn: true,
        updatedByUserId: "user-a",
      },
    ]);
  });

  it("rejects Center Agent organization memory policy writes from non-admin members", async () => {
    const db = createOrganizationRpcDb({
      agentProfiles: [],
      members: [memberRow("member-a", "org-a", "user-a", "member")],
    });
    const env = buildEnv({ db });

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
    expect(db.centerAgentMemoryPolicyWrites).toEqual([]);
  });

  it("lets only owners and admins read or update Organization information protection", async () => {
    const db = createOrganizationRpcDb({
      agentProfiles: [],
      members: [
        memberRow("member-owner", "org-a", "user-owner", "owner"),
        memberRow("member-admin", "org-a", "user-admin", "admin"),
        memberRow("member-member", "org-a", "user-member", "member"),
      ],
    });
    const env = buildEnv({ db });

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
    expect(db.informationProtectionPolicyWrites).toEqual([]);

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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db });

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
    expect(db.informationProtectionPolicyWrites).toEqual([
      {
        organizationId: "org-a",
        protectedInformation: null,
        updatedByUserId: "user-admin",
      },
    ]);
  });

  it("applies personal and preference authorization policies after a Binding becomes enabled primary", async () => {
    const db = createOrganizationRpcDb({
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
      bindingAuthorizationPreferences: [
        preferenceRow({
          autoAuthorizeAgentProfileBindings: true,
          organizationId: "org-a",
          userId: "user-a",
        }),
      ],
      members: [
        memberRow("member-personal", "org-personal", "user-a", "owner"),
        memberRow("member-a", "org-a", "user-a"),
      ],
      personalOrganizations: [
        { organizationId: "org-personal", userId: "user-a" },
      ],
    });

    await expect(
      applyAcceptedBindingAuthorizationPolicies({
        activeOrganizationId: "org-a",
        actorProfileId: HUMAN_PROFILE_ID,
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: `binding-${AGENT_PROFILE_ID}`,
        db: db as unknown as D1Database,
        nowMs: 1_700_000_000_001,
        ownerUserId: "user-a",
      })
    ).resolves.toEqual([
      {
        organizationId: "org-personal",
        source: "personal",
        status: "authorized",
      },
      {
        organizationId: "org-a",
        source: "preference",
        status: "authorized",
      },
    ]);
    expect(db.authorizationWrites).toEqual([
      {
        bindingId: `binding-${AGENT_PROFILE_ID}`,
        organizationId: "org-personal",
      },
      {
        bindingId: `binding-${AGENT_PROFILE_ID}`,
        organizationId: "org-a",
      },
    ]);
  });

  it("carries reconnected Binding authorizations forward and records one audit row per carried authorization", async () => {
    const oldBindingId = "binding-old";
    const newBindingId = `binding-${AGENT_PROFILE_ID}`;
    const db = createOrganizationRpcDb({
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
      authorizations: [
        authorizationRow({
          agentProfileId: AGENT_PROFILE_ID,
          authorizedBy: "user-a",
          bindingId: oldBindingId,
          createdAtMs: 1_700_000_000_000,
          organizationId: "org-a",
        }),
        authorizationRow({
          agentProfileId: AGENT_PROFILE_ID,
          authorizedBy: "user-b",
          bindingId: oldBindingId,
          createdAtMs: 1_700_000_000_000,
          organizationId: "org-b",
        }),
      ],
      members: [
        memberRow("member-a", "org-a", "user-a", "owner"),
        memberRow("member-b", "org-a", "user-b"),
      ],
      personalOrganizations: [{ organizationId: "org-a", userId: "user-a" }],
    });

    await applyAcceptedBindingAuthorizationPolicies({
      activeOrganizationId: "org-a",
      actorProfileId: HUMAN_PROFILE_ID,
      agentProfileId: AGENT_PROFILE_ID,
      bindingId: newBindingId,
      db: db as unknown as D1Database,
      nowMs: 1_700_000_000_010,
      ownerUserId: "user-a",
      previousBindingId: oldBindingId,
    } satisfies ApplyAcceptedBindingAuthorizationPoliciesInput);

    expect(db.authorizationWrites).toEqual([
      { bindingId: newBindingId, organizationId: "org-a" },
      { bindingId: newBindingId, organizationId: "org-b" },
    ]);
    expect(db.centerAgentAuditRows).toHaveLength(2);
    expect(
      db.centerAgentAuditRows.map((row) => ({
        action: row.action,
        actorProfileId: row.actorProfileId,
        organizationId: row.organizationId,
        resourceType: row.resourceType,
      }))
    ).toEqual([
      {
        action: "carry_over_binding_authorization",
        actorProfileId: HUMAN_PROFILE_ID,
        organizationId: "org-a",
        resourceType: "organization_binding_authorization",
      },
      {
        action: "carry_over_binding_authorization",
        actorProfileId: HUMAN_PROFILE_ID,
        organizationId: "org-b",
        resourceType: "organization_binding_authorization",
      },
    ]);
  });

  it("does not carry a Center Agent Binding authorization into another Organization", async () => {
    const oldBindingId = "binding-old";
    const newBindingId = `binding-${AGENT_PROFILE_ID}`;
    const db = createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({
          organizationId: "org-a",
          ownerUserId: "user-a",
        }),
      ],
      authorizations: [
        authorizationRow({
          agentProfileId: AGENT_PROFILE_ID,
          authorizedBy: "user-a",
          bindingId: oldBindingId,
          createdAtMs: 1_700_000_000_000,
          organizationId: "org-a",
        }),
        authorizationRow({
          agentProfileId: AGENT_PROFILE_ID,
          authorizedBy: "user-b",
          bindingId: oldBindingId,
          createdAtMs: 1_700_000_000_000,
          organizationId: "org-b",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
      personalOrganizations: [{ organizationId: "org-a", userId: "user-a" }],
    });

    await applyAcceptedBindingAuthorizationPolicies({
      activeOrganizationId: "org-a",
      actorProfileId: HUMAN_PROFILE_ID,
      agentProfileId: AGENT_PROFILE_ID,
      bindingId: newBindingId,
      db: db as unknown as D1Database,
      nowMs: 1_700_000_000_010,
      ownerUserId: "user-a",
      previousBindingId: oldBindingId,
    } satisfies ApplyAcceptedBindingAuthorizationPoliciesInput);

    expect(db.authorizationWrites).toEqual([
      { bindingId: newBindingId, organizationId: "org-a" },
    ]);
    expect(db.centerAgentAuditRows).toHaveLength(1);
    expect(db.centerAgentAuditRows[0]).toMatchObject({
      action: "carry_over_binding_authorization",
      organizationId: "org-a",
    });
  });

  it("filters the organization directory to the active Organization and reuses agent readiness projection", async () => {
    const env = buildEnv({
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

  it("omits Organization member activity unless the caller opts in", async () => {
    const env = buildEnv({
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

  it("reads member activity from the identity store when local state is separate", async () => {
    const member = memberRow("member-a", "org-a", "user-a");
    const identityDb = createOrganizationRpcDb({
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
    const localStateDb = createOrganizationRpcDb({
      agentProfiles: [],
      memberActivities: [],
      members: [],
    });
    const env = buildEnv({
      agentProfiles: [],
      db: identityDb,
      localStateDb,
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
    const env = buildEnv({
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

  it("fails closed when Auth returns Directory identity for another Organization", async () => {
    const env = buildEnv({
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
    const env = buildEnv({
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
    const db = createOrganizationRpcDb({
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

    const env = buildEnv({ db });
    const lookupOwnerService = vi
      .spyOn(runtimeTransportClient, "lookupRuntimeTransportOwnerService")
      .mockResolvedValue({
        online: false,
        reasonCode: "daemon.session.not_found",
      });

    await expect(
      rpcCenterAgentReadMemberOpenMeldServiceStatus(env, {
        context: buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db });
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportOwnerService"
    ).mockResolvedValue({
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
        context: buildContext({
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
  });

  it("lists computer setup context for the verified represented member", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db });
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
        context: buildContext({
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db });
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
        context: buildContext({
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db });
    vi.spyOn(
      currentDeviceTargetService,
      "listLocalRuntimesUseCase"
    ).mockResolvedValue(createOwnerLocalRuntimesWithUsageLimits());
    vi.spyOn(
      currentDeviceTargetService,
      "getCurrentLocalRuntimeReplyReadinessUseCase"
    ).mockResolvedValue(createMissingCurrentComputerReadiness());
    const request = {
      context: buildContext({
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db });
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
        context: buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db });
    const listLocalRuntimes = vi.spyOn(
      currentDeviceTargetService,
      "listLocalRuntimesUseCase"
    );

    await expect(
      rpcCenterAgentListComputers(env, {
        context: buildContext({
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db });
    const lookupOwnerService = vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportOwnerService"
    );

    await expect(
      rpcCenterAgentReadMemberOpenMeldServiceStatus(env, {
        context: buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([]);
  });

  it("fails closed before reading Computers for a user outside the current Organization", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db });
    const listComputers = vi.spyOn(
      organizationComputersService,
      "listOrganizationComputers"
    );

    await expect(
      rpcCenterAgentReadMemberComputers(env, {
        context: buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([]);
  });

  it("reports unknown instead of fabricating an offline state when the member Service lookup fails", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportOwnerService"
    ).mockRejectedValue(new Error("Runtime Transport unavailable"));

    await expect(
      rpcCenterAgentReadMemberOpenMeldServiceStatus(env, {
        context: buildContext({
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

  it("includes active personal Agent Profiles with Organization Wake Access in the organization directory", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db });

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
      { organizationId: "org-personal", profileId: AGENT_PROFILE_ID },
      { organizationId: "org-a", profileId: SECOND_AGENT_PROFILE_ID },
    ]);
  });

  it("excludes a personal Center Agent from another Organization's directory even with Wake Access", async () => {
    const db = createOrganizationRpcDb({
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
          ownerUserId: "user-a",
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
    const env = buildEnv({ db });

    const response = await rpcGetCurrentOrganizationDirectory(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });

    expect(response.agentProfiles.map((profile) => profile.profileId)).toEqual([
      AGENT_PROFILE_ID,
    ]);
  });

  it("falls back to readable names for organization directory members with empty auth names", async () => {
    const env = buildEnv({
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
        ownerUserId: "user-a",
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
    const db = createOrganizationRpcDb({
      agentProfiles,
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const authWorker = {
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
    const env = buildEnv({
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

    expect([...db.centerAgentDesignations.values()]).toHaveLength(1);
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
    const env = buildEnv({
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
    const db = createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow()],
      centerAgentDesignationReadbackOverride: centerAgentDesignationRow({
        agentProfileId: SECOND_AGENT_PROFILE_ID,
        designatedBy: "user-a",
        organizationId: "org-a",
      }),
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const env = buildEnv({ db, remoteAgentRuntimeEnabled: "true" });

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
    expect(db.centerAgentDesignations.get("org-a")?.agentProfileId).toBe(
      AGENT_PROFILE_ID
    );
  });

  it("rejects an ordinary Agent Profile with Organization Wake Access as Center Agent", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, remoteAgentRuntimeEnabled: "true" });
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
    const env = buildEnv({
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
    const env = buildEnv({
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
    const env = buildEnv({
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
    const env = buildEnv({
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

  it("designates Remote Agent by writing a hosted Binding, Organization authorization, and audit entries", async () => {
    const db = createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
          managedRole: "center_agent",
          status: "active",
        },
      ],
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const env = buildEnv({
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

    expect([...db.bindingRows.values()]).toEqual([
      expect.objectContaining({
        agentControllerConversationId: null,
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        agentProfileId: AGENT_PROFILE_ID,
        bindingState: "enabled_primary",
        hostedRuntimeIdentityJson: JSON.stringify(
          HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
        ),
        ownerId: "user-a",
        runtimeKind: "hosted_center_agent",
        openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
      }),
    ]);
    const hostedBindingId = [...db.bindingRows.values()][0]?.bindingId;
    expect(db.authorizationWrites).toEqual([
      { bindingId: hostedBindingId, organizationId: "org-a" },
    ]);
    expect(db.centerAgentAuditRows.map((row) => row.action)).toEqual([
      "authorize_remote_center_agent_binding",
      "designate_remote_center_agent",
    ]);
  });

  it("lets every member read the Center Agent model while only owners and admins can change it", async () => {
    const db = createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({
          organizationId: "org-a",
          ownerUserId: "owner-user",
        }),
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
    db.bindingRows.set(
      bindingKey("owner_account", "owner-user", AGENT_PROFILE_ID),
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
        ownerId: "owner-user",
        ownerKind: "owner_account",
        reasonCode: null,
        reasoningLevel: null,
        runtimeKind: "hosted_center_agent",
        updatedAtMs: 1_700_000_000_000,
        openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
      }
    );
    const env = buildEnv({ db, remoteAgentRuntimeEnabled: "true" });
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
        displayName: "Grok 4.6",
        modelId: "x-ai/grok-4.6",
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
        preference: {
          kind: "selected_model",
          modelId: "deepseek/deepseek-v4-flash",
        },
      })
    ).resolves.toMatchObject({
      canManage: true,
      changed: true,
      configurationRevision: 5,
      effectiveModel: {
        displayName: "DeepSeek V4 Flash",
        modelId: "deepseek/deepseek-v4-flash",
      },
    });
    await expect(
      rpcGetCenterAgentModel(env, { context: ownerContext })
    ).resolves.toMatchObject({
      canManage: true,
      configurationRevision: 5,
      preference: {
        kind: "selected_model",
        modelId: "deepseek/deepseek-v4-flash",
      },
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
  });

  it("keeps only the Center Agent's own Organization authorization when replacing its hosted Binding", async () => {
    const previousBindingId = `binding-${AGENT_PROFILE_ID}`;
    const db = createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({
          organizationId: "org-a",
          ownerUserId: "user-a",
        }),
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
    const env = buildEnv({
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

    const hostedBindingId = [...db.bindingRows.values()].find(
      (binding) => binding.runtimeKind === "hosted_center_agent"
    )?.bindingId;
    expect(db.authorizationWrites).toEqual([
      { bindingId: hostedBindingId, organizationId: "org-a" },
    ]);
    expect(
      db.centerAgentAuditRows
        .filter((row) => row.action === "carry_over_binding_authorization")
        .map((row) => row.organizationId)
    ).toEqual(["org-a"]);
  });

  it("lets organization owners and admins update the Center Agent profile name through Auth", async () => {
    const db = createOrganizationRpcDb({
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
          ownerUserId: "user-a",
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
    const env = buildEnv({ authWorker, db });

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
  });

  it("maps an unavailable Auth profile-update RPC method to the stable Center Agent error", async () => {
    const authWorker = {
      updateCenterAgentProfileInOrganization: vi.fn(() =>
        Promise.reject(
          new Error("The RPC receiver does not implement the method")
        )
      ),
    };
    const env = buildEnv({
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
    const env = buildEnv({
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
        profileName: "Operations Center Agent",
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
    const db = createOrganizationRpcDb({
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
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const env = buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentCreateSpace(env, {
        context: buildContext({
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
        context: buildContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Codex",
          userId: "user-a",
        }),
        name: "Planning",
        visibility: "private",
      })
    ).resolves.toMatchObject({
      attribution: { actorProfileId: AGENT_PROFILE_ID, onBehalfOf: null },
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
        context: buildContext({
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
  });

  it("allows only the Organization creator to pause or resume the Center Agent", async () => {
    const db = createOrganizationRpcDb({
      agentProfiles: [managedCenterAgentProfileRow({ ownerUserId: "creator" })],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "creator",
          organizationId: "org-a",
        }),
      ],
      members: [
        memberRow("member-creator", "org-a", "creator", "owner"),
        memberRow("member-admin", "org-a", "admin-user", "admin"),
      ],
      organizations: [
        {
          createdByUserId: "creator",
          name: "Acme",
          organizationId: "org-a",
          slug: "acme",
        },
      ],
    });
    const env = buildEnv({ db });

    await expect(
      rpcGetCenterAgentOperatingState(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "admin-user",
        }),
      })
    ).resolves.toMatchObject({
      canChangeOperatingState: false,
      operatingState: "active",
    });
    await expect(
      rpcUpdateCenterAgentOperatingState(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "admin-user",
        }),
        operatingState: "paused",
      })
    ).rejects.toMatchObject({
      code: "center_agent.creator_required",
      status: 403,
    });
    await expect(
      rpcUpdateCenterAgentOperatingState(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "creator",
        }),
        operatingState: "paused",
      })
    ).resolves.toMatchObject({
      canChangeOperatingState: true,
      changed: true,
      operatingState: "paused",
    });
  });

  it("fails closed when Organization creator evidence is missing", async () => {
    const db = createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({ ownerUserId: "admin-user" }),
      ],
      centerAgentDesignations: [
        centerAgentDesignationRow({
          agentProfileId: AGENT_PROFILE_ID,
          designatedBy: "admin-user",
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-admin", "org-a", "admin-user", "admin")],
      organizations: [
        {
          createdByUserId: null,
          name: "Acme",
          organizationId: "org-a",
          slug: "acme",
        },
      ],
    });
    const env = buildEnv({ db });

    await expect(
      rpcGetCenterAgentOperatingState(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "admin-user",
        }),
      })
    ).resolves.toMatchObject({ canChangeOperatingState: false });
    await expect(
      rpcUpdateCenterAgentOperatingState(env, {
        context: buildContext({
          activeOrganizationId: "org-a",
          userId: "admin-user",
        }),
        operatingState: "paused",
      })
    ).rejects.toMatchObject({
      code: "center_agent.creator_required",
      status: 403,
    });
  });

  it("records Center Agent audit entries with on-behalf-of attribution", async () => {
    const db = createOrganizationRpcDb({
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
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    spaceStub.rpcPatchMeta.mockImplementationOnce(async (request) => ({
      accessMode: "members_only" as const,
      name: request.name ?? "Untitled space",
      organizationId: request.organizationId ?? "org-a",
      passwordProtected: false,
      spaceId: request.spaceId,
      visibility: request.visibility ?? "private",
    }));
    const env = buildEnv({ db, spaceStub });
    const agentContext = buildContext({
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
      })
    );

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
    const db = createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "owner-user",
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
          source: "user_created",
          status: "active",
          updatedAt: "2026-07-06T00:00:00.000Z",
          openMeldProfileId: SECOND_AGENT_PROFILE_ID,
        },
      })),
    };
    const env = buildEnv({ authWorker, db });

    await expect(
      rpcCenterAgentCreateAgentProfile(env, {
        context: buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([
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
    const db = createOrganizationRpcDb({
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
      rpcCenterAgentCreateAgentProfile(buildEnv({ authWorker, db }), {
        context: buildContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          userId: "user-a",
        }),
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
    expect(db.centerAgentAuditRows).toEqual([]);
  });

  it("adds Agent Profiles to Spaces through the Space member contract", async () => {
    const db = createOrganizationRpcDb({
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
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentAddAgentProfilesToSpace(env, {
        agentProfileIds: [SECOND_AGENT_PROFILE_ID],
        context: buildContext({
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
        addedMemberIds: [SECOND_AGENT_PROFILE_ID],
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
        ],
        spaceId: JOINED_PRIVATE_SPACE_ID,
      })
    );
    expect(db.centerAgentAuditRows).toEqual([
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
    const db = createOrganizationRpcDb({
      agentProfiles: [
        {
          managedRole: "center_agent",
          organizationId: "org-a",
          ownerUserId: "user-a",
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
    const env = buildEnv({ db, spaceStub });
    const context = buildContext({
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
        ],
        spaceId: created.spaceId,
      })
    );
    expect(db.centerAgentAuditRows).toEqual([
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentAddMembersToSpace(env, {
        context: buildContext({
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
    const db = createOrganizationRpcDb({
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
      members: [memberRow("member-a", "org-a", "user-a", "owner")],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentRemoveAgentProfilesFromSpace(env, {
        agentProfileIds: [SECOND_AGENT_PROFILE_ID],
        context: buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentUpdateSpaceSettings(env, {
        accessMode: "protected",
        context: buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([
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
    const db = createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
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
    const env = buildEnv({ db, spaceStub });
    const context = buildContext({
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

    await expect(
      rpcCenterAgentPostSpaceMessage(env, {
        context,
        onBehalfOf: { profileId: HUMAN_PROFILE_ID },
        referenceProfileIds: [HUMAN_PROFILE_ID],
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
            referenceTargets: [HUMAN_PROFILE_ID],
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
          referenceTargets: [HUMAN_PROFILE_ID],
          text: "I moved the launch notes into this Space.",
        },
        spaceId: JOINED_PRIVATE_SPACE_ID,
        text: "I moved the launch notes into this Space.",
      })
    );
    expect(db.centerAgentAuditRows).toEqual([
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

  it("rejects a Center Agent plain post that References a non-member", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentPostSpaceMessage(env, {
        context: buildContext({
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

  it("posts an audited top-level Slack channel message", async () => {
    const db = createOrganizationRpcDb({
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
        expect(db.centerAgentAuditRows).toEqual([
          expect.objectContaining({ action: "post_slack_channel_message" }),
        ]);
        return Promise.resolve(
          Response.json({ ok: true, ts: "1710000000.001" })
        );
      }
      throw new Error(`Unexpected Slack API request: ${pathname}`);
    });
    vi.stubGlobal("fetch", slackFetch);
    const env = buildEnv({ db, slackBotToken: "xoxb-test" });

    const context = buildContext({
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
        publicationSource: {
          executionId: "remote_agent_submission_release",
          kind: "remote_agent_execution",
        },
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
        publicationSource: {
          executionId: "remote_agent_submission_release",
          kind: "remote_agent_execution",
        },
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
        publicationSource: {
          executionId: "remote_agent_submission_release",
          kind: "remote_agent_execution",
        },
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
    ).toHaveLength(1);
    expect(db.centerAgentAuditRows).toEqual([
      expect.objectContaining({
        action: "post_slack_channel_message",
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        organizationId: "org-a",
        resourceId: "C123",
        resourceType: "slack_channel",
      }),
    ]);

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
      entries: [
        expect.objectContaining({ action: "post_slack_channel_message" }),
      ],
      organizationId: "org-a",
    });
  });

  it("posts and deduplicates an exact Slack thread separately from the channel", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, slackBotToken: "xoxb-test" });
    const request = {
      channelName: "ok8-okok",
      context: buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([
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
        context: buildContext({
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, slackBotToken: "xoxb-test" });
    const request = {
      contentBase64: btoa(String.fromCharCode(...bytes)),
      contentSha256,
      context: buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, slackBotToken: "xoxb-test" });
    const request = {
      channelName: "#Release",
      context: buildContext({
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
    const db = createOrganizationRpcDb({
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
      rpcCenterAgentReadSlackWorkspaceDirectory(buildEnv({ db }), {
        context: buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([]);
  });

  it("classifies Slack workspace membership by identity link before email", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, slackBotToken: "xoxb-test" });

    await expect(
      rpcCenterAgentReadSlackWorkspaceDirectory(env, {
        context: buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, slackBotToken: "xoxb-test" });

    await expect(
      rpcCenterAgentListSlackChannels(env, {
        context: buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, slackBotToken: "xoxb-test" });

    await expect(
      rpcCenterAgentReadSlackChannelMembers(env, {
        channelName: "#ok8-okok",
        context: buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([
      expect.objectContaining({
        action: "read_slack_channel_members",
        resourceId: "C_OK8",
        resourceType: "slack_channel",
      }),
    ]);
  });

  it("reads Slack history only after proving the Center Agent is in the channel", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, slackBotToken: "xoxb-test" });

    await expect(
      rpcCenterAgentReadSlackChannelHistory(env, {
        channelName: "ok8-okok",
        context: buildContext({
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
        context: buildContext({
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
        context: buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, slackBotToken: "xoxb-test" });

    await expect(
      rpcCenterAgentReadSlackFile(env, {
        channelName: "ok8-okok",
        context: buildContext({
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
        context: buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([
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

  it("searches public Slack messages with authorization bound to the requester", async () => {
    const cryptoKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({
      db,
      slackBotToken: "xoxb-test",
      slackTokenCryptoKey: cryptoKey,
    });
    const context = buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([
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
        buildEnv({ db, slackTokenCryptoKey: cryptoKey }),
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({
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
        context: buildContext({
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
    expect(JSON.stringify(db.centerAgentAuditRows)).not.toContain(
      "private launch details"
    );
  });

  it("returns empty evidence without publishing a second Slack response", async () => {
    const cryptoKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({
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
        context: buildContext({
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db });
    const context = buildContext({
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
      code: "center_agent.connector_action_speaker_required",
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
      expect(db.centerAgentAuditRows.at(-1)).toMatchObject({
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
    const db = createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
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
    const env = buildEnv({ db, spaceStub });

    const wakeInput = {
      agentProfileIds: [SECOND_AGENT_PROFILE_ID],
      context: buildContext({
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
    const firstWake = await rpcCenterAgentWakeAgentProfilesInSpace(
      env,
      wakeInput
    );
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
    expect(db.centerAgentAuditRows).toEqual([
      expect.objectContaining({
        action: "wake_agent_profiles_in_space",
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        organizationId: "org-a",
        resourceId: JOINED_PRIVATE_SPACE_ID,
        resourceType: "space",
      }),
      expect.objectContaining({
        action: "wake_agent_profiles_in_space",
        actorProfileId: AGENT_PROFILE_ID,
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
  });

  it("rejects a direct Center Agent Wake after a Reference member is removed", async () => {
    const db = createOrganizationRpcDb({
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
      rpcCenterAgentWakeAgentProfilesInSpace(buildEnv({ db, spaceStub }), {
        agentProfileIds: [SECOND_AGENT_PROFILE_ID],
        context: buildContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          requestId:
            "remote-agent-tool:openmeld_wake_agent_profiles_in_space:removed_reference",
          userId: "user-a",
        }),
        onBehalfOf: { profileId: HUMAN_PROFILE_ID },
        referenceProfileIds: [HUMAN_PROFILE_ID],
        spaceId: JOINED_PRIVATE_SPACE_ID,
        text: "Review with the removed member as context.",
      })
    ).rejects.toMatchObject({
      code: "space.addressing.target_invalid",
      status: 422,
    });
    expect(spaceStub.rpcPostSignalOnceByClientMessageId).toHaveBeenCalledTimes(
      1
    );
  });

  it("preserves structured References through the complete delegated Center Agent Wake path", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });
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

    const wake = await rpcCenterAgentWakeAgentProfilesInSpace(env, {
      agentProfileIds: [SECOND_AGENT_PROFILE_ID],
      completionMode: "resume_parent_when_all_terminal",
      context: {
        ...buildContext({
          activeOrganizationId: "org-a",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          requestId:
            "remote-agent-tool:openmeld_wake_agent_profiles_in_space:delegated_reference",
          userId: "user-a",
        }),
        agentControllerConversationId: "submission-parent",
      },
      onBehalfOf: { profileId: HUMAN_PROFILE_ID },
      referenceProfileIds: [HUMAN_PROFILE_ID],
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
          referenceTargets: [HUMAN_PROFILE_ID],
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
        (child) => child.task.targetProfileId === HUMAN_PROFILE_ID
      )
    ).toBe(false);
    expect(wake.signal.data.messageEnvelope).toEqual({
      activationTargets: [SECOND_AGENT_PROFILE_ID],
      referenceTargets: [HUMAN_PROFILE_ID],
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
    const env = buildEnv({ spaceStub });

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
        ...buildContext({
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
      referenceTargets: [HUMAN_PROFILE_ID],
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
          referenceTargets: [HUMAN_PROFILE_ID],
        },
      },
    });
    expect(spaceStub.rpcPostSignalOnceByClientMessageId).toHaveBeenCalledWith(
      expect.objectContaining({
        messageEnvelope: {
          activationTargets: [SECOND_AGENT_PROFILE_ID],
          referenceTargets: [HUMAN_PROFILE_ID],
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
    const db = createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-a",
          ownerUserId: "user-a",
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
    const env = buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentWakeAgentProfilesInSpace(env, {
        agentProfileIds: [SECOND_AGENT_PROFILE_ID],
        context: buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([]);
  });

  it("reads Space context through the Center Agent bootstrap contract", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentReadSpaceContext(env, {
        context: buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([
      expect.objectContaining({
        action: "read_space_context",
        actorProfileId: AGENT_PROFILE_ID,
        organizationId: "org-a",
        resourceId: JOINED_PRIVATE_SPACE_ID,
        resourceType: "space",
      }),
    ]);
  });

  it("uses the Center Agent's own Space access when listing shared files", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentListSpaceFiles(env, {
        context: buildContext({
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
        query: { parentId: null, view: "trash" },
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

  it("rejects Center Agent Space context reads outside the active Organization", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentReadSpaceContext(env, {
        context: buildContext({
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentReadSpaceContext(env, {
        afterSignalId: "signal-anchor",
        context: buildContext({
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
    const db = createOrganizationRpcDb({
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
      text: "Latest reply",
      ts: TEST_NOW_MS + 2,
    });
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
      initialSignals: [rootSignal, firstReply, latestReply],
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
    const env = buildEnv({ db, spaceStub });
    const context = buildContext({
      activeOrganizationId: "org-a",
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      userId: "user-a",
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
        signals: [firstReply, latestReply],
        truncated: true,
      },
    });
    expect(spaceStub.rpcGetBootstrapWithTiming).not.toHaveBeenCalled();
  });

  it("reads recent dispatch history for a Space, including errorCode and errorMessage for a failed dispatch", async () => {
    // Fixture mirrors the real 2026-07-10 dogfooding incident (W-CA-CAP1):
    // errorCode "runtime.turn.failed" with an OpenAI 400 JSON errorMessage.
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });

    const response = await rpcCenterAgentReadDispatchHistory(env, {
      context: buildContext({
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
    expect(db.centerAgentAuditRows).toEqual([
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });

    await expect(
      rpcCenterAgentReadDispatchHistory(env, {
        context: buildContext({
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
    const db = createOrganizationRpcDb({
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
      organizations: [
        {
          name: "Acme Labs",
          organizationId: "org-a",
          slug: "acme-labs",
        },
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = buildEnv({
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
    expect(spaceStub.rpcPostSignalOnceByClientMessageId).toHaveBeenCalledTimes(
      2
    );
    expect(spaceStub.rpcPostSignalOnceByClientMessageId).toHaveBeenCalledWith(
      expect.objectContaining({
        authoringPolicy: "system_emitted",
        clientMessageId: `center-agent-dm-welcome:${first.spaceId}`,
        meta: expect.objectContaining({
          clientMessageId: `center-agent-dm-welcome:${first.spaceId}`,
          purpose: "center_agent_dm_welcome",
        }),
        profile: expect.objectContaining({
          kind: "agent",
          profileId: AGENT_PROFILE_ID,
          profileName: "Codex",
        }),
        spaceId: first.spaceId,
        text: "👋 Hi Ava — I'm the Center Agent for Acme Labs. Pick a starting point below, or tell me what you'd like to get done.",
      })
    );
    expect(spaceStub.rpcInitializeDirectMessageMeta).toHaveBeenCalledTimes(1);
    expect(spaceStub.rpcPostMembers).toHaveBeenCalledTimes(1);
    expect(spaceStub.rpcPostSignalOnceByClientMessageId).toHaveBeenCalledTimes(
      2
    );
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
      "welcome",
      "response_validation",
      "total_created",
      "membership",
      "designation",
      "human_member",
      "center_agent_member",
      "reusable_candidate_lookup",
      "direct_message_open",
      "welcome",
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
    const db = createOrganizationRpcDb({
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
        agentProfiles.push(
          managedCenterAgentProfileRow({ ownerUserId: "owner-user" })
        );
        return {
          ok: true,
          profile: {
            createdAt: "2026-07-06T00:00:00.000Z",
            createdByUserId: "owner-user",
            creatorProfileId: null,
            isDefault: false,
            lastUsedAt: null,
            managedRole: "center_agent",
            ownerUserId: "owner-user",
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
    const env = buildEnv({
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
        designatedBy: "owner-user",
        organizationId: "org-a",
      },
      organizationId: "org-a",
    });
    expect(ownerOpen).toMatchObject({
      centerAgentProfileId: AGENT_PROFILE_ID,
      organizationId: "org-a",
    });
    expect(db.centerAgentDesignations).toHaveLength(1);
    expect([...db.bindingRows.values()]).toEqual([
      expect.objectContaining({
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        agentProfileId: AGENT_PROFILE_ID,
        bindingState: "enabled_primary",
        createdByProfileId: HUMAN_PROFILE_ID,
        hostedRuntimeIdentityJson: JSON.stringify(
          HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
        ),
        ownerId: "owner-user",
        runtimeKind: "hosted_center_agent",
        openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
      }),
    ]);
    const hostedBindingId = [...db.bindingRows.values()][0]?.bindingId;
    expect(db.authorizationWrites).toEqual([
      { bindingId: hostedBindingId, organizationId: "org-a" },
    ]);
    expect(db.centerAgentAuditRows.map((row) => row.action)).toEqual([
      "authorize_remote_center_agent_binding",
      "designate_remote_center_agent",
    ]);
    expect(
      authWorker.ensureCenterAgentProfileInOrganization
    ).toHaveBeenCalledTimes(1);
    expect(
      authWorker.ensureCenterAgentProfileInOrganization
    ).toHaveBeenCalledWith({
      organizationId: "org-a",
      ownerUserId: "owner-user",
    });
    expect(spaceStub.rpcPostSignalOnceByClientMessageId).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({
          profileId: AGENT_PROFILE_ID,
          profileName: "Center Agent",
        }),
        spaceId: inviteeOpen.spaceId,
        text: "👋 Hi Ava — I'm the Center Agent for Acme Labs. Pick a starting point below, or tell me what you'd like to get done.",
      })
    );
  });

  it("keeps the owner-first Center Agent designation bootstrap path working", async () => {
    const agentProfiles: Parameters<
      typeof createOrganizationRpcDb
    >[0]["agentProfiles"] = [];
    const db = createOrganizationRpcDb({
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
        agentProfiles.push(
          managedCenterAgentProfileRow({ ownerUserId: "owner-user" })
        );
        return {
          ok: true,
          profile: {
            createdAt: "2026-07-06T00:00:00.000Z",
            createdByUserId: "owner-user",
            creatorProfileId: null,
            isDefault: false,
            lastUsedAt: null,
            managedRole: "center_agent",
            ownerUserId: "owner-user",
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
    const env = buildEnv({
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
    expect(db.centerAgentDesignations).toHaveLength(1);
    expect([...db.bindingRows.values()]).toEqual([
      expect.objectContaining({
        agentProfileId: AGENT_PROFILE_ID,
        createdByProfileId: HUMAN_PROFILE_ID,
        ownerId: "owner-user",
        runtimeKind: "hosted_center_agent",
      }),
    ]);
    expect(
      authWorker.ensureCenterAgentProfileInOrganization
    ).toHaveBeenCalledTimes(1);
  });

  it("classifies an unavailable Auth bootstrap RPC during DM open", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({
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
          ownerUserId: "owner-user",
          requestId: context.actorContext.requestId,
          stage: "auth_rpc",
        })
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it("rethrows an unrelated Auth bootstrap RPC rejection without changing its identity", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({
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
          ownerUserId: "owner-user",
          requestId: context.actorContext.requestId,
          stage: "auth_rpc",
        })
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it("classifies an Auth bootstrap failure result while adding correlated diagnostics", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({
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
          ownerUserId: "owner-user",
          requestId: context.actorContext.requestId,
          stage: "auth_result",
        })
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it("preserves the Center Agent designation and DM while paused", async () => {
    const agentProfiles = [
      managedCenterAgentProfileRow({ ownerUserId: "owner-user" }),
    ];
    const db = createOrganizationRpcDb({
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
          ownerUserId: "owner-user",
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
    const env = buildEnv({
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

    expect(db.centerAgentDesignations).toHaveLength(1);
    expect(
      authWorker.ensureCenterAgentProfileInOrganization
    ).not.toHaveBeenCalled();
    expect(db.centerAgentAuditRows).toEqual([
      expect.objectContaining({
        action: "pause_center_agent",
        actorProfileId: HUMAN_PROFILE_ID,
        organizationId: "org-a",
        resourceId: AGENT_PROFILE_ID,
        resourceType: "agent_profile",
      }),
    ]);
  });

  it("posts the personal Center Agent DM welcome once", async () => {
    const db = createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-personal",
          ownerUserId: "user-a",
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
    const env = buildEnv({ db, spaceStub });
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
    expect(spaceStub.rpcPostSignalOnceByClientMessageId).toHaveBeenCalledTimes(
      2
    );
    expect(spaceStub.rpcListSignals).not.toHaveBeenCalled();
    expect(spaceStub.rpcPostSignalOnceByClientMessageId).toHaveBeenCalledWith(
      expect.objectContaining({
        authoringPolicy: "system_emitted",
        clientMessageId: `center-agent-dm-welcome:${first.spaceId}`,
        meta: expect.objectContaining({
          clientMessageId: `center-agent-dm-welcome:${first.spaceId}`,
          purpose: "center_agent_dm_welcome",
        }),
        profile: expect.objectContaining({
          kind: "agent",
          profileId: AGENT_PROFILE_ID,
          profileName: "Center Agent",
        }),
        spaceId: first.spaceId,
        text: "👋 Hi Ava — I'm your Center Agent. Pick a starting point below, or tell me what you'd like to get done.",
      })
    );
  });

  it("still opens the Center Agent DM when welcome delivery fails and retries later", async () => {
    const db = createOrganizationRpcDb({
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
      organizations: [
        {
          name: "Acme Labs",
          organizationId: "org-a",
          slug: "acme-labs",
        },
      ],
    });
    const spaceStub = createSpaceStub({ spaces: db.spaces });
    const env = buildEnv({ db, spaceStub });
    const memberContext = buildContext({
      activeOrganizationId: "org-a",
      requestId: "req-open-center-agent-dm",
      userId: "user-a",
    });
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    spaceStub.rpcPostSignal.mockRejectedValueOnce(
      new Error("welcome write failed")
    );

    try {
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
        created: false,
        spaceId: first.spaceId,
      });
      expect(
        spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledTimes(2);
      expect(spaceStub.rpcPostSignal).toHaveBeenCalledTimes(2);
      expect(
        spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({
          clientMessageId: `center-agent-dm-welcome:${first.spaceId}`,
          meta: expect.objectContaining({
            clientMessageId: `center-agent-dm-welcome:${first.spaceId}`,
            purpose: "center_agent_dm_welcome",
          }),
          spaceId: first.spaceId,
        })
      );
      expect(warnSpy).toHaveBeenCalledWith(
        "[core.center_agent.dm_welcome_delivery_failed]",
        expect.objectContaining({
          centerAgentProfileId: AGENT_PROFILE_ID,
          error: "welcome write failed",
          errorStack: expect.stringContaining("welcome write failed"),
          event: "core.center_agent.dm_welcome_delivery_failed",
          memberProfileId: HUMAN_PROFILE_ID,
          organizationId: "org-a",
          requestId: "req-open-center-agent-dm",
          spaceId: first.spaceId,
        })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("omits the greeting name when the Center Agent DM member name is missing", async () => {
    const db = createOrganizationRpcDb({
      agentProfiles: [
        {
          organizationId: "org-personal",
          ownerUserId: "user-a",
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
    const env = buildEnv({ db, spaceStub });
    const memberContext = buildContext({
      activeOrganizationId: "org-personal",
      profileName: "@",
      userId: "user-a",
    });

    const opened = await rpcOpenCenterAgentDirectMessageSpace(env, {
      context: memberContext,
    });

    expect(spaceStub.rpcPostSignalOnceByClientMessageId).toHaveBeenCalledTimes(
      1
    );
    expect(spaceStub.rpcPostSignalOnceByClientMessageId).toHaveBeenCalledWith(
      expect.objectContaining({
        clientMessageId: `center-agent-dm-welcome:${opened.spaceId}`,
        meta: expect.objectContaining({
          clientMessageId: `center-agent-dm-welcome:${opened.spaceId}`,
          purpose: "center_agent_dm_welcome",
        }),
        spaceId: opened.spaceId,
        text: "👋 I'm your Center Agent. Pick a starting point below, or tell me what you'd like to get done.",
      })
    );
  });

  it("opens one Center Agent DM per Organization member", async () => {
    const db = createOrganizationRpcDb({
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
      members: [
        memberRow("member-a", "org-a", "user-a", "member"),
        memberRow("member-b", "org-a", "user-b", "member"),
      ],
    });
    const env = buildEnv({
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db });

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
    const db = createOrganizationRpcDb({
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
        agentProfiles.push(
          managedCenterAgentProfileRow({ ownerUserId: "owner-user" })
        );
        return {
          ok: true,
          profile: {
            createdAt: "2026-07-06T00:00:00.000Z",
            createdByUserId: "owner-user",
            creatorProfileId: null,
            isDefault: false,
            lastUsedAt: null,
            managedRole: "center_agent",
            ownerUserId: "owner-user",
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
    const env = buildEnv({
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
    expect(db.centerAgentDesignations).toHaveLength(0);
    expect(db.bindingRows).toHaveLength(0);
    expect(db.authorizationWrites).toEqual([]);
    expect(db.disallowedWrites).toEqual([]);
  });

  it("rejects extra members in a Center Agent DM while ordinary DMs still forward member adds", async () => {
    const centerAgentDirectMessageSpaceId =
      "3333333333333333333333333333333333333333333333333333333333333333";
    const ordinaryDirectMessageSpaceId =
      "4444444444444444444444444444444444444444444444444444444444444444";
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });
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

  it("rejects Center Agent DM member, lifecycle, and access mutations while ordinary DMs still forward them", async () => {
    const centerAgentDirectMessageSpaceId =
      "5555555555555555555555555555555555555555555555555555555555555555";
    const ordinaryDirectMessageSpaceId =
      "6666666666666666666666666666666666666666666666666666666666666666";
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });
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

  it("resolves Organization profiles before converting a Direct Message", async () => {
    const spaceId =
      "7777777777777777777777777777777777777777777777777777777777777777";
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });
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
      addedMemberIds: [AGENT_PROFILE_ID],
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

  it("repairs incomplete Direct Message membership without rewriting its origin", async () => {
    const pairKey = `${HUMAN_PROFILE_ID}:${AGENT_PROFILE_ID}`;
    const spaceId = resolveTestNamedSpaceId(`dm-v1:org-a:${pairKey}:0`);
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });

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
    const env = buildEnv({
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });

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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({
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

  it("opens the Center Agent DM for a personal Agent Profile with Organization Wake Access", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });

    const response = await rpcOpenCenterAgentDirectMessageSpace(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });

    expect(response).toMatchObject({
      centerAgentProfileId: AGENT_PROFILE_ID,
      created: true,
      memberProfileId: HUMAN_PROFILE_ID,
      organizationId: "org-a",
    });
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
            profileName: "Codex",
          }),
        ]),
        spaceId: response.spaceId,
      })
    );
  });

  it("rejects the Center Agent DM for a personal Agent Profile without Organization Wake Access", async () => {
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });

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
    const env = buildEnv({
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
    const env = buildEnv({
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

  it("lists Organization Binding authorizations for the active Organization", async () => {
    const env = buildEnv({
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
      authorizations: [
        authorizationRow({
          agentProfileId: AGENT_PROFILE_ID,
          authorizedBy: "user-a",
          bindingId: `binding-${AGENT_PROFILE_ID}`,
          createdAtMs: 1_700_000_000_000,
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a")],
    });

    const response = await rpcListOrganizationBindingAuthorizations(env, {
      context: buildContext({
        activeOrganizationId: "org-a",
        userId: "user-a",
      }),
    });

    expect(response).toEqual({
      organizationId: "org-a",
      authorizations: [
        {
          agentProfileId: AGENT_PROFILE_ID,
          authorizedBy: "user-a",
          bindingId: `binding-${AGENT_PROFILE_ID}`,
          createdAt: "2023-11-14T22:13:20.000Z",
        },
      ],
    });
  });

  it("lists personal Agent Profile Binding authorizations written into the active Organization", async () => {
    const env = buildEnv({
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
          organizationId: "org-acme",
        }),
      ],
      members: [memberRow("member-acme", "org-acme", "user-a")],
    });

    const response = await rpcListOrganizationBindingAuthorizations(env, {
      context: buildContext({
        activeOrganizationId: "org-acme",
        userId: "user-a",
      }),
    });

    expect(response).toEqual({
      organizationId: "org-acme",
      authorizations: [
        {
          agentProfileId: AGENT_PROFILE_ID,
          authorizedBy: "user-a",
          bindingId: `binding-${AGENT_PROFILE_ID}`,
          createdAt: "2023-11-14T22:13:20.000Z",
        },
      ],
    });
  });

  it("lists only caller-owned target and personal Organization Wake Access profiles", async () => {
    const env = buildEnv({
      agentProfiles: [
        {
          organizationId: "org-acme",
          ownerUserId: "user-a",
          profileHandle: "acme-codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Acme Codex",
          status: "active",
        },
        {
          hasBinding: false,
          organizationId: "org-personal",
          ownerUserId: "user-a",
          profileHandle: "personal-assistant",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Personal Assistant",
          status: "active",
        },
        {
          organizationId: "org-other",
          ownerUserId: "user-a",
          profileHandle: "other-codex",
          profileId: "agt_00000000-0000-4000-8000-000000000004",
          profileName: "Other Codex",
          status: "active",
        },
        {
          organizationId: "org-acme",
          ownerUserId: "user-b",
          profileHandle: "teammate-codex",
          profileId: "agt_00000000-0000-4000-8000-000000000005",
          profileName: "Teammate Codex",
          status: "active",
        },
      ],
      authorizations: [
        authorizationRow({
          agentProfileId: AGENT_PROFILE_ID,
          authorizedBy: "user-a",
          bindingId: `binding-${AGENT_PROFILE_ID}`,
          createdAtMs: 1_700_000_000_000,
          organizationId: "org-acme",
        }),
      ],
      members: [memberRow("member-acme", "org-acme", "user-a")],
      personalOrganizations: [
        { organizationId: "org-personal", userId: "user-a" },
      ],
    });

    const response = await rpcListOrganizationBindingAuthorizationProfiles(
      env,
      {
        context: buildContext({
          activeOrganizationId: "org-acme",
          userId: "user-a",
        }),
        organizationId: "org-acme",
      }
    );

    expect(response).toEqual({
      organizationId: "org-acme",
      profiles: [
        {
          agentProfileId: AGENT_PROFILE_ID,
          authorized: true,
          authorizedAt: "2023-11-14T22:13:20.000Z",
          authorizedBy: "user-a",
          bindingId: `binding-${AGENT_PROFILE_ID}`,
          ownerUserId: "user-a",
          profileHandle: "acme-codex",
          profileName: "Acme Codex",
          profileOrganizationId: "org-acme",
          status: "authorized",
        },
        {
          agentProfileId: SECOND_AGENT_PROFILE_ID,
          authorized: false,
          authorizedAt: null,
          authorizedBy: null,
          bindingId: null,
          ownerUserId: "user-a",
          profileHandle: "personal-assistant",
          profileName: "Personal Assistant",
          profileOrganizationId: "org-personal",
          status: "binding_required",
        },
      ],
    });
  });

  it("lists which non-personal Organizations have Wake access to the current user's own Agent Profile bindings", async () => {
    const env = buildEnv({
      agentProfiles: [
        {
          organizationId: "org-acme",
          ownerUserId: "user-a",
          profileHandle: "acme-codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Acme Codex",
          status: "active",
        },
        {
          hasBinding: false,
          organizationId: "org-acme",
          ownerUserId: "user-a",
          profileHandle: "unbound-agent",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileName: "Unbound Agent",
          status: "active",
        },
      ],
      authorizations: [
        authorizationRow({
          agentProfileId: AGENT_PROFILE_ID,
          authorizedBy: "user-a",
          bindingId: `binding-${AGENT_PROFILE_ID}`,
          createdAtMs: 1_700_000_000_000,
          organizationId: "org-acme",
        }),
        authorizationRow({
          agentProfileId: AGENT_PROFILE_ID,
          authorizedBy: "user-a",
          bindingId: `binding-${AGENT_PROFILE_ID}`,
          createdAtMs: 1_700_000_000_000,
          organizationId: "org-personal",
        }),
      ],
      members: [memberRow("member-acme", "org-acme", "user-a")],
      organizations: [
        { name: "Acme", organizationId: "org-acme", slug: "acme" },
      ],
      personalOrganizations: [
        { organizationId: "org-personal", userId: "user-a" },
      ],
    });

    const response = await rpcListCurrentUserAgentProfileOrganizationWakeAccess(
      env,
      {
        context: buildContext({
          activeOrganizationId: "org-acme",
          userId: "user-a",
        }),
      }
    );

    expect(response).toEqual({
      profiles: [
        {
          agentProfileId: AGENT_PROFILE_ID,
          organizations: [
            {
              organizationId: "org-acme",
              organizationName: "Acme",
              organizationSlug: "acme",
            },
          ],
        },
      ],
    });
  });

  it("reports no organization Wake access when the current user has no authorized Bindings", async () => {
    const env = buildEnv({
      agentProfiles: [
        {
          organizationId: "org-acme",
          ownerUserId: "user-a",
          profileHandle: "acme-codex",
          profileId: AGENT_PROFILE_ID,
          profileName: "Acme Codex",
          status: "active",
        },
      ],
      members: [memberRow("member-acme", "org-acme", "user-a")],
    });

    const response = await rpcListCurrentUserAgentProfileOrganizationWakeAccess(
      env,
      {
        context: buildContext({
          activeOrganizationId: "org-acme",
          userId: "user-a",
        }),
      }
    );

    expect(response).toEqual({ profiles: [] });
  });

  it("revokes the active Organization Binding authorization idempotently", async () => {
    const db = createOrganizationRpcDb({
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
      authorizations: [
        authorizationRow({
          agentProfileId: AGENT_PROFILE_ID,
          authorizedBy: "user-a",
          bindingId: `binding-${AGENT_PROFILE_ID}`,
          createdAtMs: 1_700_000_000_000,
          organizationId: "org-a",
        }),
      ],
      members: [memberRow("member-a", "org-a", "user-a")],
    });
    const env = buildEnv({ db });
    const context = buildContext({
      activeOrganizationId: "org-a",
      userId: "user-a",
    });

    await expect(
      rpcRevokeAgentProfileBindingForOrganization(env, {
        agentProfileId: AGENT_PROFILE_ID,
        context,
      })
    ).resolves.toMatchObject({
      agentProfileId: AGENT_PROFILE_ID,
      bindingId: `binding-${AGENT_PROFILE_ID}`,
      organizationId: "org-a",
      revoked: true,
      status: "revoked",
    });
    await expect(
      rpcRevokeAgentProfileBindingForOrganization(env, {
        agentProfileId: AGENT_PROFILE_ID,
        context,
      })
    ).resolves.toMatchObject({
      agentProfileId: AGENT_PROFILE_ID,
      bindingId: `binding-${AGENT_PROFILE_ID}`,
      organizationId: "org-a",
      revoked: false,
      status: "missing",
    });
    expect(db.authorizationDeletes).toEqual([
      {
        bindingId: `binding-${AGENT_PROFILE_ID}`,
        organizationId: "org-a",
      },
    ]);
  });

  it("joins a public Organization Space through the Space DO member write path", async () => {
    const spaceStub = createSpaceStub();
    const env = buildEnv({
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
    const env = buildEnv({
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
    const db = createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({ ownerUserId: "owner-user" }),
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
    const env = buildEnv({ db, spaceStub });

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
            ownerUserId: "owner-user",
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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });

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
    const db = createOrganizationRpcDb({
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
    const env = buildEnv({ db, spaceStub });

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
    const db = createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({
          organizationId: "org-b",
          ownerUserId: "user-b",
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
    const env = buildEnv({ db, spaceStub });

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
    const db = createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({
          organizationId: "org-personal",
          ownerUserId: "user-a",
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
    const env = buildEnv({ db, spaceStub });

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
    const db = createOrganizationRpcDb({
      agentProfiles: [
        {
          ...managedCenterAgentProfileRow({ ownerUserId: "owner-user" }),
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
    const env = buildEnv({ db, spaceStub });

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
    const db = createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({ ownerUserId: "owner-user" }),
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
    const env = buildEnv({ db, spaceStub });

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
    const db = createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({ ownerUserId: "owner-user" }),
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
    const env = buildEnv({ db, spaceStub });

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
    const db = createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({ ownerUserId: "owner-user" }),
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
    const env = buildEnv({ db, spaceStub });

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
    const db = createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({ ownerUserId: "owner-user" }),
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
    const env = buildEnv({ db, spaceStub });

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
    const db = createOrganizationRpcDb({
      agentProfiles: [
        managedCenterAgentProfileRow({ ownerUserId: "owner-user" }),
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
    const env = buildEnv({ db, spaceStub });

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

function buildEnv(
  input: Partial<Parameters<typeof createOrganizationRpcDb>[0]> & {
    authWorker?: {
      createAgentProfileInOrganization?: ReturnType<typeof vi.fn>;
      ensureCenterAgentProfileInOrganization?: ReturnType<typeof vi.fn>;
      resolveOrganizationDirectoryAgentProfiles?: ReturnType<typeof vi.fn>;
      resolveOrganizationDirectoryMembers?: ReturnType<typeof vi.fn>;
      resolveProfileById?: ReturnType<typeof vi.fn>;
      updateCenterAgentProfileInOrganization?: ReturnType<typeof vi.fn>;
    };
    db?: ReturnType<typeof createOrganizationRpcDb>;
    localStateDb?: ReturnType<typeof createOrganizationRpcDb>;
    remoteAgentBlockedOrganizationIds?: string;
    remoteAgentWorker?: CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"];
    remoteAgentRuntimeEnabled?: string;
    observability?: CoreBindings["OPENMELD_OBSERVABILITY"];
    slackBotToken?: string;
    slackTokenCryptoKey?: string;
    spaceStub?: ReturnType<typeof createSpaceStub>;
    workerEnvironment?: string;
  }
): CoreBindings {
  const db =
    input.db ??
    createOrganizationRpcDb({
      agentProfiles: input.agentProfiles ?? [],
      authorizations: input.authorizations ?? [],
      bindingAuthorizationPreferences:
        input.bindingAuthorizationPreferences ?? [],
      centerAgentAuditJournal: input.centerAgentAuditJournal ?? [],
      centerAgentDesignations: input.centerAgentDesignations ?? [],
      centerAgentMemoryPolicies: input.centerAgentMemoryPolicies ?? [],
      dispatchLedgerEntries: input.dispatchLedgerEntries ?? [],
      memberActivities: input.memberActivities ?? [],
      members: input.members ?? [],
      organizations: input.organizations ?? [],
      personalOrganizations: input.personalOrganizations ?? [],
      slackWorkspaceBindings: input.slackWorkspaceBindings ?? [],
      spaceMemberships: input.spaceMemberships ?? [],
      spaces: input.spaces ?? [],
    });
  return {
    OPENMELD_AUTH_WORKER: {
      ...buildOrganizationDirectoryAuthProjection({
        agentProfiles: input.agentProfiles ?? db.agentProfiles,
        members: input.members ?? db.members,
      }),
      ...input.authWorker,
    },
    OPENMELD_DB: db as unknown as D1Database,
    OPENMELD_LOCAL_STATE_DB: input.localStateDb as unknown as
      | D1Database
      | undefined,
    OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS:
      input.remoteAgentBlockedOrganizationIds,
    OPENMELD_REMOTE_AGENT_WORKER: input.remoteAgentWorker,
    OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: input.remoteAgentRuntimeEnabled,
    SLACK_OPENMELD_BOT_TOKEN: input.slackBotToken,
    SLACK_OPENMELD_TOKEN_CRYPTO_KEY: input.slackTokenCryptoKey,
    OPENMELD_OBSERVABILITY: input.observability,
    OPENMELD_SPACES: createSpaceNamespace(
      input.spaceStub ?? createSpaceStub({ spaces: db.spaces })
    ),
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

function toDirectMessageSpaceIndexRow(space: ReturnType<typeof spaceRow>) {
  return {
    active_agent_count: space.activeAgentCount,
    active_human_count: space.activeHumanCount,
    active_member_count: space.activeMemberCount,
    direct_message_converted_at_ms: space.directMessageConvertedAtMs,
    direct_message_pair_key: space.directMessagePairKey,
    organization_id: space.organizationId,
    organization_visibility: space.visibility,
    space_id: space.spaceId,
    space_purpose: space.spacePurpose,
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

function preferenceRow(input: {
  autoAuthorizeAgentProfileBindings: boolean;
  createdAtMs?: number;
  organizationId: string;
  updatedAtMs?: number;
  userId: string;
}) {
  return {
    autoAuthorizeAgentProfileBindings: input.autoAuthorizeAgentProfileBindings,
    createdAtMs: input.createdAtMs ?? 1_700_000_000_000,
    id: `preference-${input.organizationId}-${input.userId}`,
    organizationId: input.organizationId,
    updatedAtMs: input.updatedAtMs ?? input.createdAtMs ?? 1_700_000_000_000,
    userId: input.userId,
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
  ownerUserId?: string;
  profileId?: string;
}) {
  return {
    organizationId: input?.organizationId ?? "org-a",
    ownerUserId: input?.ownerUserId ?? "user-a",
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

type CenterAgentPublicationOperationTestRow = {
  actor_profile_id: string;
  claim_expires_at_ms: number | null;
  claim_id: string | null;
  created_at_ms: number;
  destination_id: string;
  destination_kind: "slack_channel" | "slack_file";
  id: string;
  organization_id: string;
  represented_user_id: string;
  request_signature: string;
  response_json: string | null;
  source_id: string;
  source_kind:
    | "organization_document"
    | "remote_agent_execution"
    | "routine_run";
  source_revision: string;
  status: "completed" | "failed" | "outcome_unknown" | "pending";
  updated_at_ms: number;
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
  ownerKind: "owner_account";
  reasonCode: string | null;
  reasoningLevel: string | null;
  runtimeKind: "openmeld_service" | "hosted_center_agent";
  updatedAtMs: number;
  openMeldServiceRuntimeId: string;
};

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

function createOrganizationRpcDb(input: {
  agentProfiles: Array<{
    createdAt?: number;
    createdByUserId?: string | null;
    creatorProfileId?: string | null;
    hasBinding?: boolean;
    isDefault?: number;
    lastUsedAt?: number | null;
    managedRole?: string | null;
    organizationId: string;
    ownerUserId: string;
    profileHandle: string;
    profileId: string;
    profileName: string;
    source?: string;
    status: "active" | "disabled";
    updatedAt?: number;
  }>;
  authorizations?: ReturnType<typeof authorizationRow>[];
  bindingAuthorizationPreferences?: ReturnType<typeof preferenceRow>[];
  centerAgentAuditWriteFailures?: number;
  centerAgentDesignations?: ReturnType<typeof centerAgentDesignationRow>[];
  centerAgentDesignationReadbackOverride?: ReturnType<
    typeof centerAgentDesignationRow
  > | null;
  centerAgentAuditJournal?: CenterAgentAuditJournalTestRow[];
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
  const spaceRows = input.spaces ?? [];
  const authorizationRows = new Map<
    string,
    ReturnType<typeof authorizationRow>
  >();
  for (const authorization of input.authorizations ?? []) {
    authorizationRows.set(
      authorizationKey(authorization.organizationId, authorization.bindingId),
      authorization
    );
  }
  const preferenceRows = new Map<string, ReturnType<typeof preferenceRow>>();
  for (const preference of input.bindingAuthorizationPreferences ?? []) {
    preferenceRows.set(
      preferenceKey(preference.organizationId, preference.userId),
      preference
    );
  }
  const centerAgentDesignationRows = new Map<
    string,
    ReturnType<typeof centerAgentDesignationRow>
  >();
  for (const designation of input.centerAgentDesignations ?? []) {
    centerAgentDesignationRows.set(designation.organizationId, designation);
  }
  const bindingRows = new Map<string, AgentProfileBindingTestRow>();
  const centerAgentAuditRows = [...(input.centerAgentAuditJournal ?? [])];
  let remainingCenterAgentAuditWriteFailures =
    input.centerAgentAuditWriteFailures ?? 0;
  const centerAgentPublicationRows: CenterAgentPublicationOperationTestRow[] =
    [];
  const centerAgentMemoryPolicyRows = new Map<
    string,
    {
      organizationId: string;
      organizationMemoryOptIn: boolean;
      updatedByUserId: string | null;
    }
  >();
  for (const policy of input.centerAgentMemoryPolicies ?? []) {
    centerAgentMemoryPolicyRows.set(policy.organizationId, policy);
  }
  const centerAgentMemoryPolicyWrites: Array<{
    organizationId: string;
    organizationMemoryOptIn: boolean;
    updatedByUserId: string | null;
  }> = [];
  const informationProtectionPolicyRows = new Map(
    (input.informationProtectionPolicies ?? []).map((policy) => [
      policy.organizationId,
      policy,
    ])
  );
  const informationProtectionPolicyWrites: Array<{
    organizationId: string;
    protectedInformation: string | null;
    updatedByUserId: string;
  }> = [];
  const authorizationWrites: Array<{
    bindingId: string;
    organizationId: string;
  }> = [];
  const authorizationDeletes: Array<{
    bindingId: string;
    organizationId: string;
  }> = [];
  const disallowedWrites: string[] = [];

  const db = {
    authorizationWrites,
    bindingRows,
    centerAgentAuditRows,
    centerAgentMemoryPolicyWrites,
    informationProtectionPolicyWrites,
    batch: vi.fn(async (statements: D1PreparedStatement[]) => {
      const results: D1Result[] = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      return results;
    }),
    centerAgentDesignations: centerAgentDesignationRows,
    disallowedWrites,
    spaces: spaceRows,
    prepare: vi.fn((sql: string) => {
      const normalizedSql = sql.toLowerCase();
      return {
        bind: vi.fn((...args: unknown[]) => ({
          all: vi.fn(async () => ({
            results: resolveAllRows({
              agentProfiles: input.agentProfiles,
              args,
              authorizationRows,
              centerAgentAuditRows,
              centerAgentDesignationRows,
              dispatchLedgerEntries: input.dispatchLedgerEntries,
              memberActivities: input.memberActivities,
              members: input.members,
              normalizedSql,
              organizations: input.organizations,
              ownedDevices: input.ownedDevices,
              slackUserIdentityLinks: input.slackUserIdentityLinks,
              spaceMemberships: input.spaceMemberships,
              spaces: spaceRows,
            }),
          })),
          first: vi.fn(async () =>
            resolveFirstRow({
              bindingRows,
              agentProfiles: input.agentProfiles,
              args,
              authorizationRows,
              centerAgentDesignationRows,
              centerAgentDesignationReadbackOverride:
                input.centerAgentDesignationReadbackOverride,
              centerAgentMemoryPolicyRows,
              centerAgentPublicationRows,
              informationProtectionPolicyRows,
              members: input.members,
              nativeDeliveries: input.nativeDeliveries,
              normalizedSql,
              organizations: input.organizations,
              personalOrganizations: input.personalOrganizations,
              preferenceRows,
              slackWorkspaceBindings: input.slackWorkspaceBindings,
              spaces: spaceRows,
            })
          ),
          run: vi.fn(() => {
            if (
              normalizedSql.includes(
                "insert or ignore into center_agent_publication_operations"
              )
            ) {
              const existing = centerAgentPublicationRows.find(
                (row) =>
                  row.organization_id === String(args[1] ?? "") &&
                  row.actor_profile_id === String(args[2] ?? "") &&
                  row.source_kind === String(args[4] ?? "") &&
                  row.source_id === String(args[5] ?? "") &&
                  row.source_revision === String(args[6] ?? "") &&
                  row.destination_kind === String(args[7] ?? "") &&
                  row.destination_id === String(args[8] ?? "")
              );
              if (existing) {
                return createD1RunResult(0);
              }
              centerAgentPublicationRows.push({
                actor_profile_id: String(args[2] ?? ""),
                claim_expires_at_ms: Number(args[11] ?? 0),
                claim_id: String(args[10] ?? ""),
                created_at_ms: Number(args[12] ?? 0),
                destination_id: String(args[8] ?? ""),
                destination_kind: String(args[7] ?? "") as
                  | "slack_channel"
                  | "slack_file",
                id: String(args[0] ?? ""),
                organization_id: String(args[1] ?? ""),
                represented_user_id: String(args[3] ?? ""),
                request_signature: String(args[9] ?? ""),
                response_json: null,
                source_id: String(args[5] ?? ""),
                source_kind: String(args[4] ?? "") as
                  | "organization_document"
                  | "remote_agent_execution"
                  | "routine_run",
                source_revision: String(args[6] ?? ""),
                status: "pending",
                updated_at_ms: Number(args[13] ?? 0),
              });
              return createD1RunResult(1);
            }
            if (
              normalizedSql.includes(
                "update center_agent_publication_operations"
              )
            ) {
              if (normalizedSql.includes("response_json = ?")) {
                const row = centerAgentPublicationRows.find(
                  (candidate) =>
                    candidate.id === String(args[2] ?? "") &&
                    candidate.status === "pending" &&
                    candidate.claim_id === String(args[3] ?? "")
                );
                if (!row) {
                  return createD1RunResult(0);
                }
                row.response_json = String(args[0] ?? "");
                row.status = "completed";
                row.claim_id = null;
                row.claim_expires_at_ms = null;
                row.updated_at_ms = Number(args[1] ?? 0);
                return createD1RunResult(1);
              }
              if (normalizedSql.includes("status = ?")) {
                const row = centerAgentPublicationRows.find(
                  (candidate) =>
                    candidate.id === String(args[2] ?? "") &&
                    candidate.status === "pending" &&
                    candidate.claim_id === String(args[3] ?? "")
                );
                if (!row) {
                  return createD1RunResult(0);
                }
                row.status = String(args[0] ?? "") as
                  | "failed"
                  | "outcome_unknown";
                row.claim_id = null;
                row.claim_expires_at_ms = null;
                row.updated_at_ms = Number(args[1] ?? 0);
                return createD1RunResult(1);
              }
              if (normalizedSql.includes("status = 'pending'")) {
                const row = centerAgentPublicationRows.find(
                  (candidate) =>
                    candidate.id === String(args[3] ?? "") &&
                    candidate.status === "failed"
                );
                if (!row) {
                  return createD1RunResult(0);
                }
                row.status = "pending";
                row.claim_id = String(args[0] ?? "");
                row.claim_expires_at_ms = Number(args[1] ?? 0);
                row.updated_at_ms = Number(args[2] ?? 0);
                return createD1RunResult(1);
              }
              if (normalizedSql.includes("status = 'outcome_unknown'")) {
                const row = centerAgentPublicationRows.find(
                  (candidate) =>
                    candidate.id === String(args[1] ?? "") &&
                    candidate.status === "pending" &&
                    candidate.claim_id === String(args[2] ?? "") &&
                    (candidate.claim_expires_at_ms ??
                      Number.POSITIVE_INFINITY) <= Number(args[3] ?? 0)
                );
                if (!row) {
                  return createD1RunResult(0);
                }
                row.status = "outcome_unknown";
                row.claim_id = null;
                row.claim_expires_at_ms = null;
                row.updated_at_ms = Number(args[0] ?? 0);
                return createD1RunResult(1);
              }
            }
            if (
              normalizedSql.includes("insert into center_agent_designations")
            ) {
              const organizationId = String(args[0] ?? "");
              centerAgentDesignationRows.set(
                organizationId,
                centerAgentDesignationRow({
                  agentProfileId: String(args[1] ?? ""),
                  createdAtMs: Number(args[3] ?? 0),
                  designatedBy: String(args[2] ?? ""),
                  organizationId,
                })
              );
              return createD1RunResult(1);
            }
            if (
              normalizedSql.includes("update center_agent_designations") &&
              normalizedSql.includes("operating_state = ?")
            ) {
              const organizationId = String(args[3] ?? "");
              const designation =
                centerAgentDesignationRows.get(organizationId);
              if (!designation) {
                return createD1RunResult(0);
              }
              designation.operatingState = String(args[0]) as
                | "active"
                | "paused";
              designation.pausedAtMs =
                args[1] === null ? null : Number(args[1] ?? 0);
              designation.pausedByUserId =
                args[2] === null ? null : String(args[2] ?? "");
              return createD1RunResult(1);
            }
            if (
              normalizedSql.includes("insert into center_agent_audit_journal")
            ) {
              if (remainingCenterAgentAuditWriteFailures > 0) {
                remainingCenterAgentAuditWriteFailures -= 1;
                throw new Error("Test Center Agent audit write failure.");
              }
              centerAgentAuditRows.push({
                id: String(args[0] ?? ""),
                organizationId: String(args[1] ?? ""),
                actorProfileId: String(args[2] ?? ""),
                action: String(args[3] ?? ""),
                onBehalfOfProfileId:
                  args[4] === null ? null : String(args[4] ?? ""),
                onBehalfOfUserId:
                  args[5] === null ? null : String(args[5] ?? ""),
                onBehalfOfDisplayName:
                  args[6] === null ? null : String(args[6] ?? ""),
                resourceType: args[7] === null ? null : String(args[7] ?? ""),
                resourceId: args[8] === null ? null : String(args[8] ?? ""),
                sourceNativeDeliveryId:
                  args[9] === null ? null : String(args[9] ?? ""),
                sourceSpaceId:
                  args[10] === null ? null : String(args[10] ?? ""),
                createdAtMs: Number(args[11] ?? 0),
              });
              return createD1RunResult(1);
            }
            if (
              normalizedSql.includes("insert into center_agent_memory_policies")
            ) {
              const organizationId = String(args[0] ?? "");
              const organizationMemoryOptIn = args[1] === 1;
              const updatedByUserId =
                args[2] === null ? null : String(args[2] ?? "");
              centerAgentMemoryPolicyRows.set(organizationId, {
                organizationId,
                organizationMemoryOptIn,
                updatedByUserId,
              });
              centerAgentMemoryPolicyWrites.push({
                organizationId,
                organizationMemoryOptIn,
                updatedByUserId,
              });
              return createD1RunResult(1);
            }
            if (
              normalizedSql.includes(
                "insert into organization_information_protection_policies"
              )
            ) {
              const organizationId = String(args[0] ?? "");
              const protectedInformation = String(args[1] ?? "");
              const updatedByUserId = String(args[2] ?? "");
              const updatedAtMs = Number(args[4] ?? 0);
              informationProtectionPolicyRows.set(organizationId, {
                organizationId,
                protectedInformation,
                updatedAtMs,
                updatedByUserId,
              });
              informationProtectionPolicyWrites.push({
                organizationId,
                protectedInformation,
                updatedByUserId,
              });
              return createD1RunResult(1);
            }
            if (
              normalizedSql.includes(
                "delete from organization_information_protection_policies"
              )
            ) {
              const organizationId = String(args[0] ?? "");
              const deleted =
                informationProtectionPolicyRows.delete(organizationId);
              informationProtectionPolicyWrites.push({
                organizationId,
                protectedInformation: null,
                updatedByUserId:
                  input.members.find(
                    (member) => member.organizationId === organizationId
                  )?.userId ?? "",
              });
              return createD1RunResult(deleted ? 1 : 0);
            }
            if (
              normalizedSql.includes("update openmeld_profiles") &&
              normalizedSql.includes("set status = 'active'")
            ) {
              const profileId = String(args[1] ?? "");
              const organizationId = String(args[2] ?? "");
              const profile = input.agentProfiles.find(
                (item) =>
                  item.profileId === profileId &&
                  item.organizationId === organizationId
              );
              if (!profile) {
                return createD1RunResult(0);
              }
              profile.status = "active";
              return createD1RunResult(1);
            }
            if (
              normalizedSql.includes(
                "insert into organization_binding_authorizations"
              )
            ) {
              const organizationId = String(args[1] ?? "");
              const bindingId = String(args[2] ?? "");
              const key = authorizationKey(organizationId, bindingId);
              if (authorizationRows.has(key)) {
                return createD1RunResult(0);
              }
              authorizationRows.set(
                key,
                authorizationRow({
                  agentProfileId: agentProfileIdFromBindingId(bindingId),
                  authorizedBy: String(args[3] ?? ""),
                  bindingId,
                  createdAtMs: Number(args[4] ?? 0),
                  organizationId,
                })
              );
              authorizationWrites.push({ organizationId, bindingId });
              return createD1RunResult(1);
            }
            if (
              normalizedSql.includes(
                "update openmelddaemon_agent_profile_bindings"
              ) &&
              normalizedSql.includes(
                "configuration_revision = configuration_revision + 1"
              ) &&
              normalizedSql.includes("model_id = ?")
            ) {
              const ownerKind = String(args[3] ?? "") as "owner_account";
              const ownerId = String(args[4] ?? "");
              const agentProfileId = String(args[5] ?? "");
              const bindingId = String(args[6] ?? "");
              const expectedRevision = Number(args[7] ?? -1);
              const key = bindingKey(ownerKind, ownerId, agentProfileId);
              const binding = bindingRows.get(key);
              if (
                !binding ||
                binding.bindingId !== bindingId ||
                binding.configurationRevision !== expectedRevision
              ) {
                return createD1RunResult(0);
              }
              binding.modelId = args[0] === null ? null : String(args[0] ?? "");
              binding.reasoningLevel =
                args[1] === null ? null : String(args[1] ?? "");
              binding.configurationRevision += 1;
              binding.updatedAtMs = Number(args[2] ?? 0);
              return createD1RunResult(1);
            }
            if (
              normalizedSql.includes(
                "update openmelddaemon_agent_profile_bindings"
              ) &&
              normalizedSql.includes(
                "set\n            binding_state = 'disabled_historical'"
              )
            ) {
              const ownerKind = String(args[2] ?? "") as "owner_account";
              const ownerId = String(args[3] ?? "");
              const agentProfileId = String(args[4] ?? "");
              const bindingId = String(args[5] ?? "");
              const key = bindingKey(ownerKind, ownerId, agentProfileId);
              const binding = bindingRows.get(key);
              if (!binding || binding.bindingId !== bindingId) {
                return createD1RunResult(0);
              }
              binding.bindingState = "disabled_historical";
              binding.disabledAtMs = Number(args[0] ?? 0);
              binding.updatedAtMs = Number(args[1] ?? 0);
              bindingRows.delete(key);
              return createD1RunResult(1);
            }
            if (
              normalizedSql.includes(
                "insert into openmelddaemon_agent_profile_bindings"
              )
            ) {
              const ownerKind = String(args[1] ?? "") as "owner_account";
              const ownerId = String(args[2] ?? "");
              const agentProfileId = String(args[3] ?? "");
              bindingRows.set(bindingKey(ownerKind, ownerId, agentProfileId), {
                bindingId: String(args[0] ?? ""),
                ownerKind,
                ownerId,
                agentProfileId,
                openMeldServiceRuntimeId: String(args[4] ?? ""),
                runtimeKind: String(args[5] ?? "openmeld_service") as
                  | "openmeld_service"
                  | "hosted_center_agent",
                hostedRuntimeIdentityJson:
                  args[6] === null ? null : String(args[6] ?? ""),
                agentControllerRef: String(args[7] ?? ""),
                agentControllerConversationId:
                  args[8] === null ? null : String(args[8] ?? ""),
                bindingState: "enabled_primary",
                configurationRevision: 0,
                createdAtMs: Number(args[9] ?? 0),
                updatedAtMs: Number(args[10] ?? 0),
                disabledAtMs: null,
                createdByProfileId:
                  args[11] === null ? null : String(args[11] ?? ""),
                reasonCode: args[12] === null ? null : String(args[12] ?? ""),
                agentControllerPermissionMode:
                  args[13] === null ? null : String(args[13] ?? ""),
                modelId: args[14] === null ? null : String(args[14] ?? ""),
                openCodePermission:
                  args[15] === null ? null : String(args[15] ?? ""),
                reasoningLevel:
                  args[16] === null ? null : String(args[16] ?? ""),
              });
              return createD1RunResult(1);
            }
            if (
              normalizedSql.includes(
                "insert into organization_binding_authorization_preferences"
              )
            ) {
              const organizationId = String(args[1] ?? "");
              const userId = String(args[2] ?? "");
              preferenceRows.set(
                preferenceKey(organizationId, userId),
                preferenceRow({
                  autoAuthorizeAgentProfileBindings: args[3] === 1,
                  createdAtMs: Number(args[4] ?? 0),
                  organizationId,
                  updatedAtMs: Number(args[5] ?? 0),
                  userId,
                })
              );
              return createD1RunResult(1);
            }
            if (
              normalizedSql.includes(
                "delete from organization_binding_authorizations"
              )
            ) {
              const organizationId = String(args[0] ?? "");
              const bindingId = String(args[1] ?? "");
              const deleted = authorizationRows.delete(
                authorizationKey(organizationId, bindingId)
              );
              if (deleted) {
                authorizationDeletes.push({ organizationId, bindingId });
              }
              return createD1RunResult(deleted ? 1 : 0);
            }
            disallowedWrites.push(normalizedSql);
            return createD1RunResult(0);
          }),
        })),
      };
    }),
  };
  return {
    ...db,
    agentProfiles: input.agentProfiles,
    authorizationDeletes,
    members: input.members,
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
    ownerUserId: string;
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

function resolveFirstRow(input: {
  bindingRows: Map<string, AgentProfileBindingTestRow>;
  agentProfiles: Parameters<typeof createOrganizationRpcDb>[0]["agentProfiles"];
  args: unknown[];
  authorizationRows: Map<string, ReturnType<typeof authorizationRow>>;
  centerAgentDesignationRows: Map<
    string,
    ReturnType<typeof centerAgentDesignationRow>
  >;
  centerAgentDesignationReadbackOverride?: ReturnType<
    typeof centerAgentDesignationRow
  > | null;
  centerAgentMemoryPolicyRows: Map<
    string,
    {
      organizationId: string;
      organizationMemoryOptIn: boolean;
      updatedByUserId: string | null;
    }
  >;
  centerAgentPublicationRows: CenterAgentPublicationOperationTestRow[];
  informationProtectionPolicyRows: Map<
    string,
    {
      organizationId: string;
      protectedInformation: string;
      updatedAtMs: number;
      updatedByUserId: string | null;
    }
  >;
  members: Parameters<typeof createOrganizationRpcDb>[0]["members"];
  nativeDeliveries?: Parameters<
    typeof createOrganizationRpcDb
  >[0]["nativeDeliveries"];
  normalizedSql: string;
  organizations?: Parameters<
    typeof createOrganizationRpcDb
  >[0]["organizations"];
  personalOrganizations?: Array<{ organizationId: string; userId: string }>;
  preferenceRows: Map<string, ReturnType<typeof preferenceRow>>;
  slackWorkspaceBindings?: Array<{
    createdAtMs: number;
    organizationId: string;
    slackTeamId: string;
    updatedAtMs: number;
  }>;
  spaces?: ReturnType<typeof spaceRow>[];
}) {
  if (
    input.normalizedSql.includes(
      "from openmeldremoteagent_native_delivery_ledger"
    )
  ) {
    const lookup = String(input.args[0] ?? "");
    return (
      input.nativeDeliveries?.find((delivery) =>
        input.normalizedSql.includes("where delivery_id = ?")
          ? delivery.delivery_id === lookup
          : delivery.submission_id === lookup
      ) ?? null
    );
  }

  if (
    input.normalizedSql.includes("from center_agent_publication_operations")
  ) {
    return (
      input.centerAgentPublicationRows.find(
        (row) =>
          row.organization_id === String(input.args[0] ?? "") &&
          row.actor_profile_id === String(input.args[1] ?? "") &&
          row.source_kind === String(input.args[2] ?? "") &&
          row.source_id === String(input.args[3] ?? "") &&
          row.source_revision === String(input.args[4] ?? "") &&
          row.destination_kind === String(input.args[5] ?? "") &&
          row.destination_id === String(input.args[6] ?? "")
      ) ?? null
    );
  }

  if (
    input.normalizedSql.includes(
      "from openmeldremoteagent_slack_workspace_bindings"
    )
  ) {
    const organizationId = String(input.args[0] ?? "");
    const binding = input.slackWorkspaceBindings?.find(
      (item) => item.organizationId === organizationId
    );
    return binding
      ? {
          created_at_ms: binding.createdAtMs,
          organization_id: binding.organizationId,
          slack_team_id: binding.slackTeamId,
          updated_at_ms: binding.updatedAtMs,
        }
      : null;
  }

  if (input.normalizedSql.includes("from slack_workspace_tokens")) {
    return null;
  }

  if (
    input.normalizedSql.includes("from members") &&
    input.normalizedSql.includes("inner join openmeld_profiles as profiles") &&
    input.normalizedSql.includes("profiles.profile_kind = 'human'")
  ) {
    const organizationId = String(input.args[0] ?? "");
    const memberId = String(input.args[1] ?? "");
    const userId = String(input.args[2] ?? "");
    const member = input.members.find(
      (item) =>
        item.organizationId === organizationId &&
        item.memberId === memberId &&
        item.userId === userId
    );
    return member
      ? {
          member_id: member.memberId,
          profile_id: HUMAN_PROFILE_ID,
          profile_name: member.userName,
          role: member.role,
          user_id: member.userId,
        }
      : null;
  }

  if (
    input.normalizedSql.includes("from members") &&
    (input.normalizedSql.includes("select id, role") ||
      input.normalizedSql.includes("select role"))
  ) {
    const organizationId = String(input.args[0] ?? "");
    const userId = String(input.args[1] ?? "");
    const member = input.members.find(
      (member) =>
        member.organizationId === organizationId && member.userId === userId
    );
    return member ? { id: member.memberId, role: member.role } : null;
  }

  if (
    input.normalizedSql.includes("select") &&
    input.normalizedSql.includes("user_id") &&
    input.normalizedSql.includes("from members") &&
    input.normalizedSql.includes("role = 'owner'")
  ) {
    const organizationId = String(input.args[0] ?? "");
    const owner = input.members
      .filter(
        (member) =>
          member.organizationId === organizationId && member.role === "owner"
      )
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt ||
          left.memberId.localeCompare(right.memberId)
      )[0];
    return owner ? { user_id: owner.userId } : null;
  }

  if (
    input.normalizedSql.includes(
      "select organizations.id as organization_id"
    ) &&
    input.normalizedSql.includes("json_extract(organizations.metadata")
  ) {
    const userId = String(input.args[0] ?? "");
    const organization = input.personalOrganizations?.find(
      (item) => item.userId === userId
    );
    return organization
      ? { organization_id: organization.organizationId }
      : null;
  }

  if (
    input.normalizedSql.includes("from organizations") &&
    input.normalizedSql.includes("where id = ?")
  ) {
    const organizationId = String(input.args[0] ?? "");
    const organization = input.organizations?.find(
      (item) => item.organizationId === organizationId
    );
    if (input.normalizedSql.includes("created_by_user_id")) {
      const creatorUserId =
        organization?.createdByUserId ??
        input.members
          .filter(
            (member) =>
              member.organizationId === organizationId &&
              member.role === "owner"
          )
          .sort(
            (left, right) =>
              left.createdAt - right.createdAt ||
              left.memberId.localeCompare(right.memberId)
          )[0]?.userId ??
        null;
      return { created_by_user_id: creatorUserId };
    }
    return {
      metadata: organization?.metadata ?? null,
      name: organization?.name ?? "Test Organization",
      slug: organization?.slug ?? organizationId,
    };
  }

  if (
    input.normalizedSql.includes(
      "from organization_binding_authorization_preferences"
    )
  ) {
    const organizationId = String(input.args[0] ?? "");
    const userId = String(input.args[1] ?? "");
    const preference = input.preferenceRows.get(
      preferenceKey(organizationId, userId)
    );
    return preference
      ? {
          auto_authorize_agent_profile_bindings:
            preference.autoAuthorizeAgentProfileBindings ? 1 : 0,
          created_at: preference.createdAtMs,
          id: preference.id,
          organization_id: preference.organizationId,
          updated_at: preference.updatedAtMs,
          user_id: preference.userId,
        }
      : null;
  }

  if (input.normalizedSql.includes("from center_agent_memory_policies")) {
    const organizationId = String(input.args[0] ?? "");
    const policy = input.centerAgentMemoryPolicyRows.get(organizationId);
    return policy
      ? {
          organization_memory_opt_in: policy.organizationMemoryOptIn ? 1 : 0,
          updated_by_user_id: policy.updatedByUserId,
        }
      : null;
  }

  if (
    input.normalizedSql.includes(
      "from organization_information_protection_policies"
    )
  ) {
    const organizationId = String(input.args[0] ?? "");
    const policy =
      input.informationProtectionPolicyRows.get(organizationId) ?? null;
    return policy
      ? {
          organization_id: policy.organizationId,
          protected_information: policy.protectedInformation,
          updated_at_ms: policy.updatedAtMs,
          updated_by_user_id: policy.updatedByUserId,
        }
      : null;
  }

  if (input.normalizedSql.includes("from center_agent_designations")) {
    const organizationId = String(input.args[0] ?? "");
    const designation =
      input.centerAgentDesignationReadbackOverride === undefined
        ? input.centerAgentDesignationRows.get(organizationId)
        : input.centerAgentDesignationReadbackOverride;
    return designation
      ? {
          agent_profile_id: designation.agentProfileId,
          created_at: designation.createdAtMs,
          designated_by: designation.designatedBy,
          duty: null,
          operating_state: designation.operatingState,
          organization_id: designation.organizationId,
          paused_at: designation.pausedAtMs,
          paused_by_user_id: designation.pausedByUserId,
        }
      : null;
  }

  if (input.normalizedSql.includes("from openmeld_profiles as profiles")) {
    const organizationId = String(input.args[0] ?? "");
    const profileId = String(input.args.at(-1) ?? "");
    const agentProfile = input.agentProfiles.find(
      (profile) => profile.profileId === profileId
    );
    const hasAuthorizedBinding = input.authorizationRows.has(
      authorizationKey(organizationId, `binding-${profileId}`)
    );
    if (agentProfile) {
      return {
        has_authorized_binding: hasAuthorizedBinding ? 1 : 0,
        is_default: agentProfile.isDefault ?? 0,
        member_user_id: input.members.some(
          (member) =>
            member.organizationId === organizationId &&
            member.userId === agentProfile.ownerUserId
        )
          ? agentProfile.ownerUserId
          : null,
        managed_role: agentProfile.managedRole ?? null,
        organization_id: agentProfile.organizationId,
        owner_name: agentProfile.ownerUserId === "user-a" ? "Ava" : "Ben",
        owner_user_id: agentProfile.ownerUserId,
        profile_id: agentProfile.profileId,
        profile_kind: "agent",
        profile_name: agentProfile.profileName,
        profile_status: agentProfile.status,
      };
    }
    if (
      profileId === HUMAN_PROFILE_ID ||
      profileId === SECOND_HUMAN_PROFILE_ID
    ) {
      const member = input.members.find(
        (item) =>
          item.organizationId === organizationId && item.userId === "user-a"
      );
      return member
        ? {
            has_authorized_binding: 0,
            is_default: profileId === HUMAN_PROFILE_ID ? 1 : 0,
            member_user_id: member.userId,
            organization_id: null,
            owner_name: member.userName,
            owner_user_id: member.userId,
            profile_id: profileId,
            profile_kind: "human",
            profile_name: member.userName,
            profile_status: "active",
          }
        : null;
    }
    return null;
  }

  if (
    input.normalizedSql.includes("from openmeld_profiles") &&
    input.normalizedSql.includes("where profile_id = ?")
  ) {
    const profileId = String(input.args[0] ?? "");
    const agentProfile = input.agentProfiles.find(
      (profile) => profile.profileId === profileId
    );
    return agentProfile
      ? {
          managed_role: agentProfile.managedRole ?? null,
          organization_id: agentProfile.organizationId,
          owner_user_id: agentProfile.ownerUserId,
          profile_id: agentProfile.profileId,
          profile_kind: "agent",
          profile_name: agentProfile.profileName,
          status: agentProfile.status,
        }
      : null;
  }

  if (
    input.normalizedSql.includes("from openmeld_profiles") &&
    input.normalizedSql.includes("profile_id = ?") &&
    input.normalizedSql.includes("managed_role = ?") &&
    input.normalizedSql.includes("status = 'active'")
  ) {
    const organizationId = String(input.args[0] ?? "");
    const profileId = String(input.args[1] ?? "");
    const managedRole = String(input.args[2] ?? "");
    const agentProfile = input.agentProfiles.find(
      (profile) =>
        profile.organizationId === organizationId &&
        profile.profileId === profileId &&
        profile.managedRole === managedRole &&
        profile.status === "active"
    );
    return agentProfile
      ? {
          owner_user_id: agentProfile.ownerUserId,
          profile_id: agentProfile.profileId,
        }
      : null;
  }

  if (
    input.normalizedSql.includes("from openmeld_profiles") &&
    input.normalizedSql.includes("managed_role = ?") &&
    input.normalizedSql.includes("status = 'active'")
  ) {
    const organizationId = String(input.args[0] ?? "");
    const managedRole = String(input.args[1] ?? "");
    const agentProfile = input.agentProfiles
      .filter(
        (profile) =>
          profile.organizationId === organizationId &&
          profile.managedRole === managedRole &&
          profile.status === "active"
      )
      .sort(
        (left, right) =>
          (right.updatedAt ?? 1_700_000_000_000) -
            (left.updatedAt ?? 1_700_000_000_000) ||
          (right.createdAt ?? 1_700_000_000_000) -
            (left.createdAt ?? 1_700_000_000_000)
      )[0];
    return agentProfile
      ? {
          owner_user_id: agentProfile.ownerUserId,
          profile_id: agentProfile.profileId,
        }
      : null;
  }

  if (input.normalizedSql.includes("openmelddaemon_agent_profile_bindings")) {
    const ownerId = String(input.args[1] ?? "");
    const profileId = String(input.args[2] ?? "");
    const storedBinding = input.bindingRows.get(
      bindingKey("owner_account", ownerId, profileId)
    );
    if (storedBinding) {
      return mapAgentProfileBindingTestRow(storedBinding);
    }
    const agentProfile = input.agentProfiles.find(
      (profile) =>
        profile.profileId === profileId &&
        profile.ownerUserId === ownerId &&
        profile.hasBinding !== false
    );
    return agentProfile
      ? {
          agent_controller_conversation_id: null,
          agent_controller_permission_mode: "ask",
          agent_controller_ref: "builtin:codex",
          agent_profile_id: profileId,
          binding_id: `binding-${profileId}`,
          binding_state: "enabled_primary",
          configuration_revision: 0,
          hosted_runtime_identity_json: null,
          created_at_ms: 1_700_000_000_000,
          created_by_profile_id: HUMAN_PROFILE_ID,
          disabled_at_ms: null,
          model_id: null,
          owner_id: ownerId,
          runtime_kind: "openmeld_service",
          owner_kind: "owner_account",
          reason_code: null,
          reasoning_level: null,
          updated_at_ms: 1_700_000_000_000,
          openmeld_service_runtime_id: `runtime-${profileId}`,
        }
      : null;
  }

  if (
    input.normalizedSql.includes("from organization_binding_authorizations") &&
    !input.normalizedSql.includes("as authorizations")
  ) {
    const organizationId = String(input.args[0] ?? "");
    const bindingId = String(input.args[1] ?? "");
    const authorization = input.authorizationRows.get(
      authorizationKey(organizationId, bindingId)
    );
    return authorization === undefined
      ? null
      : {
          authorized_by: authorization.authorizedBy,
          binding_id: bindingId,
          created_at: authorization.createdAtMs,
          id: authorization.id,
          organization_id: organizationId,
        };
  }

  if (
    input.normalizedSql.includes("count(*) as count") &&
    input.normalizedSql.includes("from space_index_spaces") &&
    input.normalizedSql.includes("direct_message_pair_key")
  ) {
    const organizationId = String(input.args[0] ?? "");
    const pairKey = String(input.args[1] ?? "");
    const purpose = String(input.args[2] ?? "");
    return {
      count: (input.spaces ?? []).filter(
        (space) =>
          space.organizationId === organizationId &&
          space.directMessagePairKey === pairKey &&
          space.spacePurpose === purpose
      ).length,
    };
  }

  if (
    input.normalizedSql.includes("from space_index_spaces s") &&
    input.normalizedSql.includes("s.direct_message_pair_key = ?") &&
    !input.normalizedSql.includes("active_member_count")
  ) {
    const organizationId = String(input.args[0] ?? "");
    const pairKey = String(input.args[1] ?? "");
    const purpose = String(input.args[2] ?? "");
    const space = (input.spaces ?? []).find(
      (item) =>
        item.organizationId === organizationId &&
        item.directMessagePairKey === pairKey &&
        item.spacePurpose === purpose &&
        (!input.normalizedSql.includes(
          "s.direct_message_converted_at_ms is null"
        ) ||
          item.directMessageConvertedAtMs === null) &&
        item.status === "active"
    );
    return space ? toDirectMessageSpaceIndexRow(space) : null;
  }

  if (
    input.normalizedSql.includes("from space_index_spaces s") &&
    input.normalizedSql.includes("s.direct_message_pair_key = ?")
  ) {
    const organizationId = String(input.args[0] ?? "");
    const pairKey = String(input.args[1] ?? "");
    const purpose = String(input.args[2] ?? "");
    const space = (input.spaces ?? []).find(
      (item) =>
        item.organizationId === organizationId &&
        item.directMessagePairKey === pairKey &&
        item.spacePurpose === purpose &&
        (!input.normalizedSql.includes(
          "s.direct_message_converted_at_ms is null"
        ) ||
          item.directMessageConvertedAtMs === null) &&
        item.status === "active" &&
        typeof item.activeMemberCount === "number" &&
        item.activeMemberCount <= 2
    );
    return space ? toDirectMessageSpaceIndexRow(space) : null;
  }

  if (
    input.normalizedSql.includes("from space_index_spaces s") &&
    input.normalizedSql.includes("where s.space_id = ?")
  ) {
    const spaceId = String(input.args[0] ?? "");
    const space = (input.spaces ?? []).find(
      (item) =>
        item.spaceId === spaceId &&
        item.status === "active" &&
        (!input.normalizedSql.includes(
          "s.direct_message_converted_at_ms is null"
        ) ||
          item.directMessageConvertedAtMs === null)
    );
    return space ? toDirectMessageSpaceIndexRow(space) : null;
  }

  if (
    input.normalizedSql.includes("from space_index_spaces") &&
    input.normalizedSql.includes("where space_id = ?")
  ) {
    const spaceId = String(input.args[0] ?? "");
    const space = (input.spaces ?? []).find(
      (item) => item.spaceId === spaceId && item.status === "active"
    );
    return space
      ? {
          organization_id: space.organizationId,
          organization_visibility: space.visibility,
          space_id: space.spaceId,
        }
      : null;
  }

  return null;
}

function resolveAllRows(input: {
  agentProfiles: Parameters<typeof createOrganizationRpcDb>[0]["agentProfiles"];
  args: unknown[];
  authorizationRows?: Map<string, ReturnType<typeof authorizationRow>>;
  centerAgentAuditRows?: CenterAgentAuditJournalTestRow[];
  centerAgentDesignationRows?: Map<
    string,
    ReturnType<typeof centerAgentDesignationRow>
  >;
  dispatchLedgerEntries?: DispatchLedgerTestEntry[];
  memberActivities?: Parameters<
    typeof createOrganizationRpcDb
  >[0]["memberActivities"];
  members: Parameters<typeof createOrganizationRpcDb>[0]["members"];
  normalizedSql: string;
  organizations?: Parameters<
    typeof createOrganizationRpcDb
  >[0]["organizations"];
  ownedDevices?: Parameters<typeof createOrganizationRpcDb>[0]["ownedDevices"];
  slackUserIdentityLinks?: Parameters<
    typeof createOrganizationRpcDb
  >[0]["slackUserIdentityLinks"];
  spaceMemberships?: ReturnType<typeof spaceMembershipRow>[];
  spaces?: ReturnType<typeof spaceRow>[];
}) {
  if (input.normalizedSql.includes("from organization_member_activity")) {
    const organizationId = String(input.args[0] ?? "");
    return (input.memberActivities ?? [])
      .filter((activity) => activity.organizationId === organizationId)
      .sort((left, right) => left.userId.localeCompare(right.userId))
      .map((activity) => ({
        human_profile_id: activity.humanProfileId,
        last_active_at_ms: activity.lastActiveAtMs,
        organization_id: activity.organizationId,
        updated_at_ms: activity.lastActiveAtMs,
        user_id: activity.userId,
      }));
  }

  if (input.normalizedSql.includes("from openmelddaemon_owned_devices")) {
    const ownerUserId = String(input.args[0] ?? "");
    return (input.ownedDevices ?? [])
      .filter((device) => device.ownerUserId === ownerUserId)
      .sort(
        (left, right) =>
          right.updatedAtMs - left.updatedAtMs ||
          left.deviceId.localeCompare(right.deviceId)
      )
      .map((device) => ({
        connected_computer_id: null,
        device_id: device.deviceId,
        device_type: "laptop",
        first_seen_at_ms: device.firstSeenAtMs,
        last_observed_at_ms: device.lastObservedAtMs,
        observed_display_name: device.observedDisplayName,
        os_version: "15.5",
        owner_user_id: device.ownerUserId,
        platform_family: "macOS",
        updated_at_ms: device.updatedAtMs,
        user_display_name: null,
      }));
  }

  if (input.normalizedSql.includes("from slack_user_identity_links")) {
    const organizationId = String(input.args[0] ?? "");
    const slackTeamId = String(input.args[1] ?? "");
    const slackUserIds = new Set(
      input.args.slice(2).map((value) => String(value ?? ""))
    );
    return (input.slackUserIdentityLinks ?? [])
      .filter(
        (link) =>
          link.organizationId === organizationId &&
          link.slackTeamId === slackTeamId &&
          slackUserIds.has(link.slackUserId)
      )
      .map((link) => ({
        created_at_ms: link.createdAtMs,
        organization_id: link.organizationId,
        slack_team_id: link.slackTeamId,
        slack_user_id: link.slackUserId,
        source: link.source,
        openmeld_user_id: link.openmeldUserId,
      }));
  }

  if (
    input.normalizedSql.includes(
      "from openmelddaemon_dispatch_ledger as ledger"
    )
  ) {
    const spaceId = String(input.args[0] ?? "");
    const hasTargetProfileFilter = input.normalizedSql.includes(
      "and ledger.target_profile_id = ?"
    );
    const hasDispatchIdFilter = input.normalizedSql.includes(
      "and ledger.dispatch_id = ?"
    );
    let argIndex = 1;
    const targetProfileId = hasTargetProfileFilter
      ? String(input.args[argIndex++] ?? "")
      : null;
    const dispatchId = hasDispatchIdFilter
      ? String(input.args[argIndex++] ?? "")
      : null;
    const limit = Number(input.args[argIndex] ?? 10);

    return [...(input.dispatchLedgerEntries ?? [])]
      .filter((row) => row.spaceId === spaceId)
      .filter(
        (row) => !targetProfileId || row.targetProfileId === targetProfileId
      )
      .filter((row) => !dispatchId || row.dispatchId === dispatchId)
      .sort(
        (left, right) =>
          (right.lastAttemptAtMs ?? 0) - (left.lastAttemptAtMs ?? 0)
      )
      .slice(0, limit)
      .map((row) => ({
        attemptCount: row.attemptCount ?? 1,
        attemptCreatedAtMs: row.attemptCreatedAtMs ?? 0,
        attemptErrorCode: row.attemptErrorCode ?? null,
        attemptErrorMessage: row.attemptErrorMessage ?? null,
        attemptFinishedAtMs: row.attemptFinishedAtMs ?? null,
        attemptId: row.attemptId ?? null,
        attemptNo: row.attemptNo ?? 1,
        attemptStartedAtMs: row.attemptStartedAtMs ?? null,
        attemptStatus: row.attemptStatus ?? null,
        dispatchId: row.dispatchId,
        firstSeenAtMs: row.firstSeenAtMs ?? 0,
        lastAttemptAtMs: row.lastAttemptAtMs ?? 0,
        status: row.status,
        targetProfileId: row.targetProfileId,
      }));
  }

  if (input.normalizedSql.includes("from center_agent_audit_journal")) {
    const organizationId = String(input.args[0] ?? "");
    const excludesActions = input.normalizedSql.includes("action not in");
    const excludedActions = new Set(
      excludesActions
        ? input.args.slice(1, -1).map((value) => String(value ?? ""))
        : []
    );
    const limit = Number(input.args.at(-1) ?? 100);
    return [...(input.centerAgentAuditRows ?? [])]
      .filter(
        (row) =>
          row.organizationId === organizationId &&
          !excludedActions.has(row.action)
      )
      .sort(
        (left, right) =>
          right.createdAtMs - left.createdAtMs ||
          right.id.localeCompare(left.id)
      )
      .slice(0, limit)
      .map((row) => ({
        action: row.action,
        actor_profile_id: row.actorProfileId,
        context_load_estimated_token_count: null,
        context_load_included_message_count: null,
        context_load_manifest_id: null,
        context_manifest_estimated_token_count: null,
        context_manifest_included_message_count: null,
        context_manifest_truncated: null,
        created_at: row.createdAtMs,
        id: row.id,
        local_agent_client: null,
        on_behalf_of_display_name: row.onBehalfOfDisplayName,
        on_behalf_of_profile_id: row.onBehalfOfProfileId,
        on_behalf_of_user_id: row.onBehalfOfUserId,
        organization_id: row.organizationId,
        resource_id: row.resourceId,
        resource_type: row.resourceType,
        source_native_delivery_id: row.sourceNativeDeliveryId ?? null,
        source_space_id: row.sourceSpaceId ?? null,
      }));
  }

  if (
    input.normalizedSql.includes("from openmeld_profiles as profiles") &&
    input.normalizedSql.includes(
      "left join organization_binding_authorizations as authorizations"
    )
  ) {
    const authorizationOrganizationId = String(input.args[0] ?? "");
    const profileOrganizationIds = new Set(
      input.args.slice(1, -2).map((value) => String(value))
    );
    const userId = String(input.args.at(-2) ?? "");
    const preferredOrganizationId = String(input.args.at(-1) ?? "");
    return input.agentProfiles
      .filter(
        (profile) =>
          profileOrganizationIds.has(profile.organizationId) &&
          profile.ownerUserId === userId &&
          profile.status === "active"
      )
      .sort(
        (left, right) =>
          (left.organizationId === preferredOrganizationId ? 0 : 1) -
            (right.organizationId === preferredOrganizationId ? 0 : 1) ||
          left.profileName.localeCompare(right.profileName, undefined, {
            sensitivity: "base",
          }) ||
          left.profileId.localeCompare(right.profileId)
      )
      .map((profile) => {
        const bindingId =
          profile.hasBinding === false ? null : `binding-${profile.profileId}`;
        const authorization = bindingId
          ? input.authorizationRows?.get(
              authorizationKey(authorizationOrganizationId, bindingId)
            )
          : null;
        return {
          agent_profile_id: profile.profileId,
          authorized_at: authorization?.createdAtMs ?? null,
          authorized_by: authorization?.authorizedBy ?? null,
          binding_id: bindingId,
          owner_user_id: profile.ownerUserId,
          profile_handle: profile.profileHandle,
          profile_name: profile.profileName,
          profile_organization_id: profile.organizationId,
        };
      });
  }

  if (
    input.normalizedSql.includes(
      "inner join openmelddaemon_agent_profile_bindings as bindings"
    ) &&
    input.normalizedSql.includes("bindings.binding_state = 'enabled_primary'")
  ) {
    const organizationId = String(input.args[0] ?? "");
    const userId = String(input.args[1] ?? "");
    const requestedProfileIds = new Set(
      input.args.slice(2).map((value) => String(value))
    );
    return input.agentProfiles
      .filter(
        (profile) =>
          profile.organizationId === organizationId &&
          profile.ownerUserId === userId &&
          profile.status === "active" &&
          (requestedProfileIds.size === 0 ||
            requestedProfileIds.has(profile.profileId))
      )
      .map((profile) => ({
        agent_profile_id: profile.profileId,
        binding_id: `binding-${profile.profileId}`,
        managed_role: profile.managedRole ?? null,
        organization_id: profile.organizationId,
        owner_user_id: profile.ownerUserId,
      }));
  }

  if (
    input.normalizedSql.includes("from members") &&
    input.normalizedSql.includes("inner join users")
  ) {
    const organizationId = String(input.args[0] ?? "");
    return input.members
      .filter((member) => member.organizationId === organizationId)
      .map((member) => {
        const humanProfile = organizationRpcHumanProfile(member.userId);
        return {
          human_profile_handle: humanProfile?.profileHandle ?? null,
          human_profile_id: humanProfile?.profileId ?? null,
          human_profile_last_used_at: humanProfile?.lastUsedAt ?? null,
          human_profile_name: humanProfile?.profileName ?? null,
          human_profile_status: humanProfile?.status ?? null,
          member_created_at: member.createdAt,
          member_id: member.memberId,
          organization_id: member.organizationId,
          role: member.role,
          user_email: member.userEmail,
          user_id: member.userId,
          user_image: member.userImage,
          user_name: member.userName,
        };
      });
  }

  if (
    input.normalizedSql.includes(
      "from organization_binding_authorizations as authorizations"
    ) &&
    input.normalizedSql.includes("profiles.profile_handle")
  ) {
    const organizationId = String(input.args[0] ?? "");
    const authorizedOrganizationId = String(input.args[1] ?? organizationId);
    const profilesById = new Map<
      string,
      Parameters<typeof createOrganizationRpcDb>[0]["agentProfiles"][number]
    >();

    for (const profile of input.agentProfiles) {
      if (profile.organizationId === organizationId) {
        profilesById.set(profile.profileId, profile);
      }
    }

    for (const authorization of input.authorizationRows?.values() ?? []) {
      if (authorization.organizationId !== authorizedOrganizationId) {
        continue;
      }
      const profile = input.agentProfiles.find(
        (candidate) =>
          candidate.profileId === authorization.agentProfileId &&
          candidate.status === "active"
      );
      if (profile) {
        profilesById.set(profile.profileId, profile);
      }
    }

    return [...profilesById.values()]
      .map((profile) =>
        buildOrganizationDirectoryAgentProfileRow({
          members: input.members,
          profile,
        })
      )
      .sort(
        (left, right) =>
          left.profile_name.localeCompare(right.profile_name, undefined, {
            sensitivity: "base",
          }) || left.profile_id.localeCompare(right.profile_id)
      );
  }

  if (
    input.normalizedSql.includes("directory_agents") &&
    input.normalizedSql.includes("left join users")
  ) {
    const organizationId = String(input.args[0] ?? "");
    const directoryProfiles = new Map<
      string,
      (typeof input.agentProfiles)[number]
    >();
    for (const profile of input.agentProfiles) {
      if (profile.organizationId === organizationId) {
        directoryProfiles.set(profile.profileId, profile);
      }
    }
    for (const authorization of input.authorizationRows?.values() ?? []) {
      if (authorization.organizationId !== organizationId) {
        continue;
      }
      const profile = input.agentProfiles.find(
        (item) =>
          item.profileId === authorization.agentProfileId &&
          item.status === "active"
      );
      if (profile) {
        directoryProfiles.set(profile.profileId, profile);
      }
    }
    return [...directoryProfiles.values()]
      .map((profile) =>
        buildOrganizationDirectoryAgentProfileRow({
          members: input.members,
          profile,
        })
      )
      .sort(
        (left, right) =>
          left.profile_name.localeCompare(right.profile_name, undefined, {
            sensitivity: "base",
          }) || left.profile_id.localeCompare(right.profile_id)
      );
  }

  if (
    input.normalizedSql.includes("from openmeld_profiles") &&
    input.normalizedSql.includes("profile_kind = 'agent'")
  ) {
    const organizationId = String(input.args[0] ?? "");
    return input.agentProfiles
      .filter((profile) => profile.organizationId === organizationId)
      .map((profile) =>
        buildOrganizationDirectoryAgentProfileRow({
          members: input.members,
          profile,
        })
      );
  }

  if (
    input.normalizedSql.includes("from organization_binding_authorizations") &&
    input.normalizedSql.includes("where binding_id = ?")
  ) {
    const bindingId = String(input.args[0] ?? "");
    return [...(input.authorizationRows?.values() ?? [])]
      .filter((authorization) => authorization.bindingId === bindingId)
      .sort(
        (left, right) =>
          left.createdAtMs - right.createdAtMs ||
          left.organizationId.localeCompare(right.organizationId)
      )
      .map((authorization) => ({
        authorized_by: authorization.authorizedBy,
        binding_id: authorization.bindingId,
        created_at: authorization.createdAtMs,
        id: authorization.id,
        organization_id: authorization.organizationId,
      }));
  }

  if (
    input.normalizedSql.includes(
      "from organization_binding_authorizations as authorizations"
    )
  ) {
    const organizationId = String(input.args[0] ?? "");
    return [...(input.authorizationRows?.values() ?? [])]
      .filter(
        (authorization) => authorization.organizationId === organizationId
      )
      .filter((authorization) =>
        input.agentProfiles.some(
          (profile) =>
            profile.profileId === authorization.agentProfileId &&
            profile.status === "active"
        )
      )
      .sort(
        (left, right) =>
          right.createdAtMs - left.createdAtMs ||
          left.agentProfileId.localeCompare(right.agentProfileId) ||
          left.bindingId.localeCompare(right.bindingId)
      )
      .map((authorization) => ({
        agent_profile_id: authorization.agentProfileId,
        authorized_by: authorization.authorizedBy,
        binding_id: authorization.bindingId,
        created_at: authorization.createdAtMs,
        id: authorization.id,
        organization_id: authorization.organizationId,
      }));
  }

  if (input.normalizedSql.includes("from space_index_spaces s")) {
    const ownerUserId = String(input.args[0] ?? "");
    const organizationId = String(input.args[1] ?? "");
    const limit = Number(input.args[2] ?? 500);
    return (input.spaces ?? [])
      .filter(
        (space) =>
          space.organizationId === organizationId && space.status === "active"
      )
      .map((space) => {
        const joinedAtValues = (input.spaceMemberships ?? [])
          .filter(
            (membership) =>
              membership.spaceId === space.spaceId &&
              membership.ownerUserId === ownerUserId &&
              membership.status === "active"
          )
          .map((membership) => membership.addedAtMs);
        const latestJoinedAtMs =
          joinedAtValues.length > 0 ? Math.max(...joinedAtValues) : null;
        return { space, latestJoinedAtMs };
      })
      .filter(
        ({ latestJoinedAtMs, space }) =>
          space.visibility === "public" || latestJoinedAtMs !== null
      )
      .sort((left, right) => {
        const joinedOrder =
          Number(left.latestJoinedAtMs === null) -
          Number(right.latestJoinedAtMs === null);
        if (joinedOrder !== 0) {
          return joinedOrder;
        }
        const leftJoinedAt = left.latestJoinedAtMs ?? 0;
        const rightJoinedAt = right.latestJoinedAtMs ?? 0;
        if (rightJoinedAt !== leftJoinedAt) {
          return rightJoinedAt - leftJoinedAt;
        }
        const leftUpdatedAt =
          left.space.spaceUpdatedAtMs ?? left.space.sourceUpdatedAtMs;
        const rightUpdatedAt =
          right.space.spaceUpdatedAtMs ?? right.space.sourceUpdatedAtMs;
        if (rightUpdatedAt !== leftUpdatedAt) {
          return rightUpdatedAt - leftUpdatedAt;
        }
        const nameOrder = (
          left.space.spaceName ?? "Untitled space"
        ).localeCompare(right.space.spaceName ?? "Untitled space");
        if (nameOrder !== 0) {
          return nameOrder;
        }
        return left.space.spaceId.localeCompare(right.space.spaceId);
      })
      .slice(0, limit)
      .map(({ latestJoinedAtMs, space }) => ({
        center_agent_profile_id:
          input.centerAgentDesignationRows?.get(space.organizationId)
            ?.agentProfileId ?? null,
        direct_message_pair_key: space.directMessagePairKey,
        direct_message_converted_at_ms: space.directMessageConvertedAtMs,
        latest_joined_at_ms: latestJoinedAtMs,
        organization_id: space.organizationId,
        organization_visibility: space.visibility,
        source_updated_at_ms: space.sourceUpdatedAtMs,
        space_created_at_ms: space.spaceCreatedAtMs,
        space_id: space.spaceId,
        space_name: space.spaceName,
        space_purpose: space.spacePurpose,
        space_updated_at_ms: space.spaceUpdatedAtMs,
      }));
  }

  if (
    input.normalizedSql.includes(
      "from openmelddaemon_agent_profile_bindings"
    ) &&
    input.normalizedSql.includes("where owner_kind = ?") &&
    input.normalizedSql.includes("binding_state = 'enabled_primary'")
  ) {
    const ownerId = String(input.args[1] ?? "");
    return input.agentProfiles
      .filter(
        (profile) =>
          profile.ownerUserId === ownerId &&
          profile.status === "active" &&
          profile.hasBinding !== false
      )
      .sort((left, right) => left.profileId.localeCompare(right.profileId))
      .map((profile) => ({
        agent_controller_conversation_id: null,
        agent_controller_permission_mode: null,
        agent_controller_ref: "claude-code",
        agent_profile_id: profile.profileId,
        binding_id: `binding-${profile.profileId}`,
        binding_state: "enabled_primary",
        created_at_ms: profile.createdAt ?? 0,
        created_by_profile_id: null,
        disabled_at_ms: null,
        hosted_runtime_identity_json: null,
        model_id: null,
        opencode_permission: null,
        owner_id: ownerId,
        owner_kind: "owner_account",
        reason_code: null,
        reasoning_level: null,
        runtime_kind: "openmeld_service",
        updated_at_ms: profile.updatedAt ?? 0,
        openmeld_service_runtime_id: `runtime-${profile.profileId}`,
      }));
  }

  if (
    input.normalizedSql.includes("from organizations") &&
    input.normalizedSql.includes("where id in")
  ) {
    const requestedIds = new Set(input.args.map((value) => String(value)));
    return (input.organizations ?? [])
      .filter((organization) => requestedIds.has(organization.organizationId))
      .map((organization) => ({
        id: organization.organizationId,
        name: organization.name,
        slug: organization.slug,
      }));
  }

  if (
    input.normalizedSql.includes("from organization_binding_authorizations") &&
    input.normalizedSql.includes("where binding_id = ?") &&
    !input.normalizedSql.includes("join")
  ) {
    const bindingId = String(input.args[0] ?? "");
    return [...(input.authorizationRows?.values() ?? [])]
      .filter((authorization) => authorization.bindingId === bindingId)
      .sort(
        (left, right) =>
          left.createdAtMs - right.createdAtMs ||
          left.organizationId.localeCompare(right.organizationId)
      )
      .map((authorization) => ({
        authorized_by: authorization.authorizedBy,
        binding_id: authorization.bindingId,
        created_at: authorization.createdAtMs,
        id: `authorization-${authorization.organizationId}-${authorization.bindingId}`,
        organization_id: authorization.organizationId,
      }));
  }

  return [];
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

function authorizationKey(organizationId: string, bindingId: string): string {
  return `${organizationId}:${bindingId}`;
}

function bindingKey(
  ownerKind: "owner_account",
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

function preferenceKey(organizationId: string, userId: string): string {
  return `${organizationId}:${userId}`;
}

function agentProfileIdFromBindingId(bindingId: string): string {
  return bindingId.startsWith("binding-")
    ? bindingId.slice("binding-".length)
    : bindingId;
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
    initialSignals?: SignalTextEnvelope[];
    listThreadSignalsResponse?: ListSpaceThreadSignalsResponse;
    listThreadsResponse?: ListSpaceThreadsResponse;
    spaces?: ReturnType<typeof spaceRow>[];
    unjoinedSpaceIds?: readonly string[];
  } = {}
) {
  const spaces = input.spaces ?? [];
  const memberProfileIdsBySpace = new Map(
    Object.entries(input.initialActiveMemberProfileIdsBySpace ?? {}).map(
      ([spaceId, profileIds]) => [spaceId, new Set(profileIds)] as const
    )
  );
  const signals: SignalTextEnvelope[] = [...(input.initialSignals ?? [])];
  const patchSpaceMeta = vi.fn(
    (request: {
      accessMode?:
        | "members_only"
        | "protected"
        | "public"
        | "public_view_join_password";
      name?: string;
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
    (request: {
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
        (signal) =>
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
      (request: { query?: { view?: "active" | "trash" }; spaceId: string }) =>
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
    rpcPostMembers: vi.fn(
      (request: {
        members: Array<{ profileId: string; profileKind?: string }>;
        requireActorMembership?: boolean;
        spaceId: string;
      }) => {
        if (
          request.requireActorMembership === true &&
          input.unjoinedSpaceIds?.includes(request.spaceId)
        ) {
          return Promise.reject(
            Object.assign(
              new Error("Join this Space before adding other members."),
              {
                code: "space.membership_required",
                status: 403,
              }
            )
          );
        }
        let memberProfileIds = memberProfileIdsBySpace.get(request.spaceId);
        if (!memberProfileIds) {
          memberProfileIds = new Set();
          memberProfileIdsBySpace.set(request.spaceId, memberProfileIds);
        }
        for (const member of request.members) {
          memberProfileIds.add(member.profileId);
        }
        const space = spaces.find((item) => item.spaceId === request.spaceId);
        if (space) {
          space.activeMemberCount = request.members.length;
          space.activeHumanCount = request.members.filter(
            (member) => member.profileKind === "human"
          ).length;
          space.activeAgentCount = request.members.filter(
            (member) => member.profileKind === "agent"
          ).length;
        }
        return Promise.resolve({
          addedMemberIds: request.members.map((member) => member.profileId),
          alreadyMemberIds: [],
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

function createD1RunResult(changes: number): D1Result {
  return {
    meta: { changes },
    results: [],
    success: true,
  } as unknown as D1Result;
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
