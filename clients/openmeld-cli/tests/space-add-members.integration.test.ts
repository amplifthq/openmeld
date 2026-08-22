import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPACE_ADD_MEMBERS_PROGRESS_OVERVIEW_STAGES } from "../src/space/add-members-progress-contract";
import { runSpaceAddMembers } from "../src/space/command";
import {
  buildAgentDirectoryProfile,
  buildOrganizationDirectoryFixture,
  ORGANIZATION_DIRECTORY_FIXTURE_CENTER_AGENT_PROFILE_ID,
} from "./fixtures/organization-directory";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";

const SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const CURRENT_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_PROFILE_NAME = "felix-owner-profile";
const OWNER_NAME_OPAQUE = "b575a0f4-c06c-48f5-96a5-0bdfeb78278b";
const MEMBER_ONE_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER_TWO_ID = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER_THREE_ID = "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HUMAN_MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const READY_DAEMON_ROUTE_OBSERVATION = {
  observedAt: "2026-03-06T00:00:00.000Z",
  reasonCode: "online",
  status: "online",
} as const;
const BUILTIN_CAPABILITY_PREFIX_PATTERN = /^builtin:/;
const ANSI_ESCAPE_PATTERN = "\\x1B\\[[0-9;]*m";
const stripAnsi = (value: string | null): string =>
  (value ?? "").replace(new RegExp(ANSI_ESCAPE_PATTERN, "g"), "");

function buildCurrentReplyReadinessSnapshot(input: {
  agentBindingReady: boolean;
  profileId?: string;
}) {
  return {
    agentReplyReadiness: {
      replyReadiness: input.agentBindingReady ? "ready" : "blocked",
      reasonCodes: input.agentBindingReady
        ? []
        : ["agent_profile_binding.missing"],
      reasonText: input.agentBindingReady ? "Ready" : "Binding is missing",
    },
    daemonRouteObservation: READY_DAEMON_ROUTE_OBSERVATION,
    daemonStatus: {
      installed: true,
      status: "running",
      version: "0.3.2",
    },
    deviceReplyReadiness: {
      reasonCodes: [],
      reasonText: "Ready",
      replyReadiness: "ready",
      updatedAt: "2026-04-11T00:00:00.000Z",
      wakeableRouteCount: input.profileId ? 1 : 0,
    },
    displayRuntimeStatus: { status: "running" },
    gatewayChainReadiness: null,
    inventory: null,
    observedAt: "2026-04-11T00:00:00.000Z",
    openClawLocalDiagnostics: null,
    profileWorkspaceRuntimeResolution: {
      status: "ready",
      effectiveRuntimeWorkingDirectory: "/tmp/workspace",
    },
    runtimeProjection: null,
    runtimeStatus: { status: "running" },
    serviceManagerStatus: null,
  } as const;
}

async function flushPendingPromises(count = 20): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

async function waitForFakeTimerCondition(
  description: string,
  condition: () => boolean
): Promise<void> {
  // Keep time pinned at 0 so heartbeat timing remains under explicit test control.
  for (let index = 0; index < 2000; index += 1) {
    await vi.advanceTimersByTimeAsync(0);
    await flushPendingPromises();
    if (condition()) {
      return;
    }
  }
  throw new Error(`Timed out waiting for ${description}`);
}

const listOpenMeldProfilesMock = vi.hoisted(() => vi.fn());
const resolveOpenMeldProfileOrNullMock = vi.hoisted(() => vi.fn());
const listProfileSpaceHistoryMock = vi.hoisted(() => vi.fn());
const upsertProfileSpaceHistoryMock = vi.hoisted(() => vi.fn());
const fetchSpaceRequestWithTimeoutMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());
const multiselectMock = vi.hoisted(() => vi.fn());
const passwordPromptMock = vi.hoisted(() => vi.fn());
const textPromptMock = vi.hoisted(() => vi.fn());
const cancelMock = vi.hoisted(() => vi.fn());
const runConnectMock = vi.hoisted(() => vi.fn());
const canUseInteractivePromptsMock = vi.hoisted(() => vi.fn());
const promptSearchSelectMock = vi.hoisted(() => vi.fn());
const promptSearchMultiselectMock = vi.hoisted(() => vi.fn());
const promptSearchMultiselectWorkbenchMock = vi.hoisted(() => vi.fn());
const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const emitSpaceCommandPreflightMock = vi.hoisted(() => vi.fn());
const emitResolvedSpaceCommandPreflightMock = vi.hoisted(() => vi.fn());
const listAgentTargetStatesMock = vi.hoisted(() => vi.fn());
const resolveLocalServiceDemandMock = vi.hoisted(() => vi.fn());
const resolveCurrentReplyReadinessSnapshotMock = vi.hoisted(() => vi.fn());
const syncProfileWorkspaceStateMock = vi.hoisted(() => vi.fn());
const syncDeviceRuntimeStateProjectionMock = vi.hoisted(() => vi.fn());
const runAgentsRepairMock = vi.hoisted(() => vi.fn());
const runDoctorMock = vi.hoisted(() => vi.fn());
const resolveAgentProfilePrimaryAgentControllerReportMock = vi.hoisted(() =>
  vi.fn()
);
const syncAgentProfileRuntimeBindingFromCurrentReadinessMock = vi.hoisted(() =>
  vi.fn()
);

type RecordedFetchRequest = {
  url: string;
  init?: RequestInit;
};

let sharedFetchRequests: RecordedFetchRequest[] = [];
let sharedFetchImplementation: (
  request: RecordedFetchRequest
) => Promise<Response>;

async function forwardToSharedFetch(input: {
  url: string;
  init?: RequestInit;
}): Promise<Response> {
  const request: RecordedFetchRequest = {
    url: input.url,
    init: input.init,
  };
  sharedFetchRequests.push(request);
  return await sharedFetchImplementation(request);
}

const VALID_AUTH_STATE = {
  state: "valid" as const,
  session: {
    v: 1 as const,
    accessToken: "token-123",
    tokenType: "Bearer",
    authBaseUrl: "https://auth.openmeld.invalid",
    clientId: "openmeld-cli",
    createdAt: "2026-03-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "felix@example.com",
    },
  },
};

vi.mock("../src/config/openmeld-profiles-api", () => {
  return {
    listOpenMeldProfiles: (...args: unknown[]) =>
      listOpenMeldProfilesMock(...args),
    resolveOpenMeldProfileByIdOrName: (...args: unknown[]) =>
      resolveOpenMeldProfileOrNullMock(...args),
  };
});

vi.mock("../src/config/resolve-openmeld-profile", () => {
  return {
    resolveOpenMeldProfileOrNull: (...args: unknown[]) =>
      resolveOpenMeldProfileOrNullMock(...args),
  };
});

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/auth-session")
  >("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: (
      ...args: Parameters<typeof getAuthSessionStateMock>
    ) => getAuthSessionStateMock(...args),
  };
});

vi.mock("../src/config/profile-space-history-api", () => {
  class MockProfileSpaceHistoryApiError extends Error {
    readonly status: number | null;
    readonly code: string | null;
    readonly endpoint: string;
    readonly canFallbackToLocal: boolean;

    constructor(input: {
      message: string;
      status?: number | null;
      code?: string | null;
      endpoint?: string;
      canFallbackToLocal?: boolean;
    }) {
      super(input.message);
      this.name = "ProfileSpaceHistoryApiError";
      this.status =
        typeof input.status === "number" ? Math.trunc(input.status) : null;
      this.code = input.code ?? null;
      this.endpoint = input.endpoint ?? "mock-endpoint";
      this.canFallbackToLocal = input.canFallbackToLocal === true;
    }
  }

  return {
    listProfileSpaceHistory: (...args: unknown[]) =>
      listProfileSpaceHistoryMock(...args),
    upsertProfileSpaceHistory: (...args: unknown[]) =>
      upsertProfileSpaceHistoryMock(...args),
    updateProfileSpaceHistoryStatus: vi.fn(),
    resolveGatewayHost: vi.fn(() => "gateway.openmeld.invalid"),
    ProfileSpaceHistoryApiError: MockProfileSpaceHistoryApiError,
  };
});

vi.mock("../src/space/fetch-with-timeout", () => {
  return {
    fetchSpaceRequestWithTimeout: (...args: unknown[]) =>
      fetchSpaceRequestWithTimeoutMock(...args),
    resolveSpaceRequestTimeoutMsForDiagnostics: vi.fn(() => 10_000),
  };
});

vi.mock("@clack/prompts", () => {
  return {
    cancel: (...args: unknown[]) => cancelMock(...args),
    confirm: (...args: unknown[]) => confirmMock(...args),
    isCancel: (value: unknown) => isCancelMock(value),
    multiselect: (...args: unknown[]) => multiselectMock(...args),
    password: (...args: unknown[]) => passwordPromptMock(...args),
    select: (...args: unknown[]) => selectMock(...args),
    text: (...args: unknown[]) => textPromptMock(...args),
  };
});

vi.mock("../src/space/connect", () => {
  return {
    runConnect: (...args: unknown[]) => runConnectMock(...args),
  };
});

vi.mock("../src/space/preflight", () => ({
  emitSpaceCommandPreflight: (
    ...args: Parameters<typeof emitSpaceCommandPreflightMock>
  ) => emitSpaceCommandPreflightMock(...args),
  emitResolvedSpaceCommandPreflight: (
    ...args: Parameters<typeof emitResolvedSpaceCommandPreflightMock>
  ) => emitResolvedSpaceCommandPreflightMock(...args),
  emitSpaceFailureNextStep: vi.fn(),
  resolveSpaceFailureGuidance: vi.fn(),
}));

vi.mock("../src/ui/search-select", () => {
  return {
    promptSearchSelect: (...args: Parameters<typeof promptSearchSelectMock>) =>
      promptSearchSelectMock(...args),
    promptSearchMultiselect: (
      ...args: Parameters<typeof promptSearchMultiselectMock>
    ) => promptSearchMultiselectMock(...args),
    promptSearchMultiselectWorkbench: (
      ...args: Parameters<typeof promptSearchMultiselectWorkbenchMock>
    ) => promptSearchMultiselectWorkbenchMock(...args),
  };
});

vi.mock("../src/runtime/interaction", () => {
  return {
    canUseInteractivePrompts: (...args: unknown[]) =>
      canUseInteractivePromptsMock(...args),
  };
});

vi.mock("../src/local-service/lifecycle/local-service-demand", () => ({
  maybeAutoStopIdleLocalService: vi.fn(),
  resolveLocalServiceDemand: (
    ...args: Parameters<typeof resolveLocalServiceDemandMock>
  ) => resolveLocalServiceDemandMock(...args),
}));

vi.mock("../src/agents/registry", () => {
  return {
    listAgentTargetStates: (...args: unknown[]) =>
      listAgentTargetStatesMock(...args),
  };
});

vi.mock("../src/system/current-reply-readiness-snapshot", () => ({
  resolveCurrentReplyReadinessSnapshot: (
    ...args: Parameters<typeof resolveCurrentReplyReadinessSnapshotMock>
  ) => resolveCurrentReplyReadinessSnapshotMock(...args),
}));

vi.mock("../src/system/agent-profile-primary-binding", () => ({
  resolveAgentProfilePrimaryAgentControllerReport: (
    ...args: Parameters<
      typeof resolveAgentProfilePrimaryAgentControllerReportMock
    >
  ) => resolveAgentProfilePrimaryAgentControllerReportMock(...args),
}));

vi.mock("../src/system/profile-workspace-state", () => ({
  syncProfileWorkspaceState: (
    ...args: Parameters<typeof syncProfileWorkspaceStateMock>
  ) => syncProfileWorkspaceStateMock(...args),
}));

vi.mock("../src/local-service/reporting/device-runtime-state-sync", () => ({
  syncDeviceRuntimeStateProjection: (
    ...args: Parameters<typeof syncDeviceRuntimeStateProjectionMock>
  ) => syncDeviceRuntimeStateProjectionMock(...args),
}));

vi.mock("../src/commands/agents", async () => {
  const actual = await vi.importActual<typeof import("../src/commands/agents")>(
    "../src/commands/agents"
  );
  return {
    ...actual,
    runAgentsRepair: (...args: Parameters<typeof runAgentsRepairMock>) =>
      runAgentsRepairMock(...args),
  };
});

vi.mock("../src/commands/doctor", async () => {
  const actual = await vi.importActual<typeof import("../src/commands/doctor")>(
    "../src/commands/doctor"
  );
  return {
    ...actual,
    runDoctor: (...args: Parameters<typeof runDoctorMock>) =>
      runDoctorMock(...args),
  };
});

vi.mock("../src/system/ensure-agent-profile-runtime-binding", () => ({
  syncAgentProfileRuntimeBindingFromCurrentReadiness: (
    ...args: Parameters<
      typeof syncAgentProfileRuntimeBindingFromCurrentReadinessMock
    >
  ) => syncAgentProfileRuntimeBindingFromCurrentReadinessMock(...args),
}));

describe("space add-members notices", () => {
  beforeEach(() => {
    const profiles = [
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: OWNER_PROFILE_NAME,
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: MEMBER_ONE_ID,
        profileName: "my-claude",
        profileKind: "agent",
        ownerName: OWNER_NAME_OPAQUE,
      }),
      buildProfile({
        openMeldProfileId: MEMBER_TWO_ID,
        profileName: "my-codex",
        profileKind: "agent",
        ownerName: OWNER_NAME_OPAQUE,
      }),
      buildProfile({
        openMeldProfileId: MEMBER_THREE_ID,
        profileName: "my-gemini",
        profileKind: "agent",
        ownerName: OWNER_NAME_OPAQUE,
      }),
    ];

    resolveOpenMeldProfileOrNullMock.mockResolvedValue(profiles[0]);
    listOpenMeldProfilesMock.mockResolvedValue(profiles);
    listProfileSpaceHistoryMock.mockResolvedValue([]);
    upsertProfileSpaceHistoryMock.mockResolvedValue({ item: {} });
    getAuthSessionStateMock.mockReset().mockResolvedValue(VALID_AUTH_STATE);
    emitSpaceCommandPreflightMock.mockReset().mockResolvedValue({
      deviceReplyReadiness: {
        reasonCodes: [],
        reasonText: "Ready",
        replyReadiness: "ready",
        updatedAt: "2026-04-11T00:00:00.000Z",
        wakeableRouteCount: 1,
      },
      payload: {},
      serviceParticipationReadiness: {
        serviceReadiness: "ready",
        summaryText: "Ready",
        detailText:
          "OpenMeld Service is running and the local service link is available on this device",
        nextStepSummary: null,
        nextSteps: [],
        runtimeHeadline: "running",
      },
    });
    emitResolvedSpaceCommandPreflightMock.mockReset();
    confirmMock.mockReset().mockResolvedValue(true);
    isCancelMock.mockReset().mockReturnValue(false);
    selectMock.mockReset().mockResolvedValue("no");
    multiselectMock.mockReset();
    promptSearchSelectMock.mockReset();
    promptSearchMultiselectMock.mockReset();
    passwordPromptMock.mockReset();
    textPromptMock.mockReset();
    cancelMock.mockReset();
    runConnectMock.mockReset().mockResolvedValue(undefined);
    canUseInteractivePromptsMock.mockReset().mockReturnValue(false);
    listAgentTargetStatesMock.mockReset().mockResolvedValue([
      {
        agentId: "my-claude",
        displayName: "my-claude",
        launchStatus: "ready",
        selectable: true,
      },
      {
        agentId: "my-codex",
        displayName: "my-codex",
        launchStatus: "ready",
        selectable: true,
      },
      {
        agentId: "my-gemini",
        displayName: "my-gemini",
        launchStatus: "ready",
        selectable: true,
      },
    ]);
    resolveAgentProfilePrimaryAgentControllerReportMock
      .mockReset()
      .mockImplementation(
        ({
          profile,
        }: {
          profile?: {
            openMeldProfileId?: string;
            profileHandle?: string;
            profileKind?: string;
          };
        }) => {
          if (profile?.profileKind !== "agent") {
            return Promise.resolve(null);
          }
          if (profile.profileHandle === "ops-agent") {
            return Promise.resolve(null);
          }
          const agentControllerRefByProfileId = new Map<string, string>([
            [MEMBER_ONE_ID, "builtin:my-claude"],
            [MEMBER_TWO_ID, "builtin:my-codex"],
            [MEMBER_THREE_ID, "builtin:my-gemini"],
            [
              "agt_22222222-2222-4222-8222-222222222222",
              "builtin:repair-agent\n--spoof",
            ],
            [
              "agt_33333333-3333-4333-8333-333333333333",
              "builtin:repair-warning-agent\n--spoof",
            ],
          ]);
          const agentControllerRef =
            agentControllerRefByProfileId.get(
              profile.openMeldProfileId ?? ""
            ) ??
            (profile.profileHandle ? `builtin:${profile.profileHandle}` : null);
          if (!agentControllerRef) {
            return Promise.resolve(null);
          }
          return Promise.resolve({
            bindingState: "enabled_primary",
            capabilityId: agentControllerRef.replace(
              BUILTIN_CAPABILITY_PREFIX_PATTERN,
              ""
            ),
            capabilityKind: "builtin",
            agentControllerRef,
            localAgentId: agentControllerRef.replace(
              BUILTIN_CAPABILITY_PREFIX_PATTERN,
              ""
            ),
            primaryBinding: null,
            reasonCodes: [],
            routable: true,
          });
        }
      );
    resolveLocalServiceDemandMock.mockReset().mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: true,
      repairableReplyCandidateCount: 0,
      reason: "local execution routes are available",
      localExecutionRouteCount: 1,
      projection: null,
    });
    resolveCurrentReplyReadinessSnapshotMock
      .mockReset()
      .mockImplementation(
        async ({ profile }: { profile?: { openMeldProfileId?: string } }) =>
          buildCurrentReplyReadinessSnapshot({
            agentBindingReady: true,
            profileId: profile?.openMeldProfileId,
          })
      );
    syncProfileWorkspaceStateMock.mockReset().mockResolvedValue({
      invalidWorkspaceProfileIds: [],
      migratedProfileIds: [],
      missingWorkspaceProfileIds: [],
      mode: "repair",
      projectedProfileIds: [],
      provisionedProfileIds: [],
      reason: "projected agent profile workspaces look good",
      status: "ok",
    });
    syncDeviceRuntimeStateProjectionMock.mockReset().mockResolvedValue({
      disabledControllerIds: [],
      missingControllerIds: [],
      mode: "repair",
      projectedControllerIds: [],
      reason: "projected agent controllers look good",
      repairedControllerIds: [],
      repairRequiredControllerIds: [],
      status: "ok",
    });
    runAgentsRepairMock.mockReset().mockResolvedValue(undefined);
    runDoctorMock.mockReset().mockResolvedValue(undefined);
    syncAgentProfileRuntimeBindingFromCurrentReadinessMock
      .mockReset()
      .mockResolvedValue({
        agentProfileBindingEnsure: {
          outcome: "reused",
          reasonCodes: [],
          routable: true,
          source: "agent_profile_binding_api",
          status: "accepted",
        },
        runtimeReportSubmission: {
          agentControllerRef: "builtin:my-claude",
          agentControllerReportStatus: "accepted",
          deviceId: "device-1",
          lane: "dev-local",
          reasonCodes: [],
          registrationStatus: "reused",
          openMeldServiceRuntimeId: "runtime_opaque_1",
          source: "runtime_reporting_api",
          status: "submitted",
        },
      });

    sharedFetchRequests = [];
    let membersGetCount = 0;
    sharedFetchImplementation = (request) => {
      const method = String(request.init?.method ?? "GET").toUpperCase();
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
        method === "GET"
      ) {
        membersGetCount += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify(
              buildSpaceMembersSnapshot({
                agents:
                  membersGetCount === 1
                    ? []
                    : [
                        buildWakeableAgentSpaceMemberSnapshot({
                          profileId: MEMBER_ONE_ID,
                          profileName: "my-claude",
                        }),
                        buildWakeableAgentSpaceMemberSnapshot({
                          profileId: MEMBER_TWO_ID,
                          profileName: "my-codex",
                        }),
                        buildWakeableAgentSpaceMemberSnapshot({
                          profileId: MEMBER_THREE_ID,
                          profileName: "my-gemini",
                        }),
                      ],
              })
            ),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );
      }
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/signals`) &&
        method === "POST"
      ) {
        const body = JSON.parse(String(request.init?.body ?? "{}")) as {
          text?: string;
        };
        return Promise.resolve(createPostSignalResponse(body.text ?? ""));
      }
      if (request.url.includes("/v1/account/spaces") && method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify(buildAccountSpacesIndexResponse()), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        );
      }
      return Promise.reject(
        new Error(`Unexpected shared request: ${method} ${request.url}`)
      );
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const request = toRecordedFetchRequest(input, init);
      sharedFetchRequests.push(request);
      return await sharedFetchImplementation(request);
    });

    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: {
        url: string;
        init?: {
          method?: string;
          body?: string;
        };
      }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/meta`) &&
          method === "GET"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: SPACE_ID,
                organizationId: "org-1",
                visibility: "private",
                passwordProtected: true,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                addedMemberIds: [MEMBER_ONE_ID, MEMBER_TWO_ID],
                alreadyMemberIds: [],
                items: [
                  buildWakeableAgentSpaceMemberSnapshot({
                    profileId: MEMBER_ONE_ID,
                    profileName: "my-claude",
                    mentionAlias: "claude-alias",
                  }),
                  buildWakeableAgentSpaceMemberSnapshot({
                    profileId: MEMBER_TWO_ID,
                    profileName: "my-codex",
                  }),
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (input.url.includes("/cursors/") && method === "GET") {
          return Promise.resolve(
            new Response("{}", {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        if (input.url.includes("/cursors/") && method === "PATCH") {
          return Promise.resolve(
            new Response('{"mentionAlias":"configured"}', {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        return forwardToSharedFetch(input);
      }
    );
  });

  it("rejects conflicting member selectors", async () => {
    await withTempHome(async () => {
      await expect(
        withSilencedStdio(async () =>
          runSpaceAddMembers({
            all: true,
            members: [MEMBER_ONE_ID],
            space: SPACE_ID,
            view: "human",
          })
        )
      ).rejects.toThrow(
        "`openmeld space add-members`: use either --member <profile-id...> or --all, not both"
      );
    });
  });

  it("adds the Organization Center Agent through the directory successor endpoint", async () => {
    const centerAgentProfileId =
      ORGANIZATION_DIRECTORY_FIXTURE_CENTER_AGENT_PROFILE_ID;
    const defaultSharedFetchImplementation = sharedFetchImplementation;
    sharedFetchImplementation = async (request) => {
      const method = String(request.init?.method ?? "GET").toUpperCase();
      if (
        request.url.includes("/v1/organizations/current/directory") &&
        method === "GET"
      ) {
        return new Response(
          JSON.stringify(buildOrganizationDirectoryFixture()),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      return await defaultSharedFetchImplementation(request);
    };
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: { url: string; init?: RequestInit }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(
            `/v1/spaces/${SPACE_ID}/organization-directory-profiles`
          ) &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                addedMemberIds: [centerAgentProfileId],
                alreadyMemberIds: [],
                items: [
                  buildWakeableAgentSpaceMemberSnapshot({
                    profileId: centerAgentProfileId,
                    profileName: "Atlas",
                  }),
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        return forwardToSharedFetch(input);
      }
    );

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceAddMembers({
          baseUrl: "https://gateway.openmeld.invalid",
          members: [centerAgentProfileId],
          mode: "agents",
          membershipSource: "organization_directory",
          profile: CURRENT_PROFILE_ID,
          space: SPACE_ID,
          view: "agent",
        });
      });
    });

    const successorRequest = fetchSpaceRequestWithTimeoutMock.mock.calls
      .map((call) => call[0] as { url: string; init?: RequestInit })
      .find((request) =>
        request.url.includes(
          `/v1/spaces/${SPACE_ID}/organization-directory-profiles`
        )
      );
    expect(JSON.parse(String(successorRequest?.init?.body ?? "{}"))).toEqual({
      directoryProfileIds: [centerAgentProfileId],
      expectedCenterAgentProfileId: centerAgentProfileId,
    });
    expect(
      fetchSpaceRequestWithTimeoutMock.mock.calls.some((call) => {
        const request = call[0] as { url: string; init?: RequestInit };
        return (
          String(request.init?.method ?? "GET").toUpperCase() === "POST" &&
          (request.url.endsWith(`/v1/spaces/${SPACE_ID}/members`) ||
            request.url.endsWith(`/v1/spaces/${SPACE_ID}/center-agent`))
        );
      })
    ).toBe(false);
  });

  it("adds another member's Human Profile through the same directory successor endpoint", async () => {
    const humanProfileId =
      buildOrganizationDirectoryFixture().members[0]?.humanProfile?.profileId;
    if (!humanProfileId) {
      throw new Error(
        "Organization Directory fixture is missing its Human Profile"
      );
    }
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: { url: string; init?: RequestInit }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes("/v1/organizations/current/directory") &&
          method === "GET"
        ) {
          return Promise.resolve(
            new Response(JSON.stringify(buildOrganizationDirectoryFixture()), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        if (
          input.url.includes(
            `/v1/spaces/${SPACE_ID}/organization-directory-profiles`
          ) &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                addedMemberIds: [humanProfileId],
                alreadyMemberIds: [],
                items: [
                  buildHumanSpaceMemberSnapshot({
                    profileId: humanProfileId,
                    profileName: "Mira",
                  }),
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        return forwardToSharedFetch(input);
      }
    );

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceAddMembers({
          baseUrl: "https://gateway.openmeld.invalid",
          members: [humanProfileId],
          membershipSource: "organization_directory",
          mode: "profiles",
          profile: CURRENT_PROFILE_ID,
          space: SPACE_ID,
          view: "agent",
        });
      });
    });

    const successorRequest = fetchSpaceRequestWithTimeoutMock.mock.calls
      .map((call) => call[0] as { url: string; init?: RequestInit })
      .find((request) =>
        request.url.includes(
          `/v1/spaces/${SPACE_ID}/organization-directory-profiles`
        )
      );
    expect(JSON.parse(String(successorRequest?.init?.body ?? "{}"))).toEqual({
      directoryProfileIds: [humanProfileId],
    });
  });

  it("keeps an explicit non-Center Agent add free of designation assertions", async () => {
    const directory = buildOrganizationDirectoryFixture({
      agentProfiles: [
        buildAgentDirectoryProfile({
          isCenterAgent: false,
          profileId: MEMBER_ONE_ID,
        }),
      ],
    });
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: { url: string; init?: RequestInit }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes("/v1/organizations/current/directory") &&
          method === "GET"
        ) {
          return Promise.resolve(
            new Response(JSON.stringify(directory), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        if (
          input.url.includes(
            `/v1/spaces/${SPACE_ID}/organization-directory-profiles`
          ) &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                addedMemberIds: [MEMBER_ONE_ID],
                alreadyMemberIds: [],
                items: [
                  buildWakeableAgentSpaceMemberSnapshot({
                    profileId: MEMBER_ONE_ID,
                    profileName: "my-claude",
                  }),
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        return forwardToSharedFetch(input);
      }
    );

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceAddMembers({
          baseUrl: "https://gateway.openmeld.invalid",
          members: [MEMBER_ONE_ID],
          membershipSource: "organization_directory",
          mode: "agents",
          profile: CURRENT_PROFILE_ID,
          space: SPACE_ID,
          view: "agent",
        });
      });
    });

    const successorRequest = fetchSpaceRequestWithTimeoutMock.mock.calls
      .map((call) => call[0] as { url: string; init?: RequestInit })
      .find((request) =>
        request.url.includes(
          `/v1/spaces/${SPACE_ID}/organization-directory-profiles`
        )
      );
    expect(JSON.parse(String(successorRequest?.init?.body ?? "{}"))).toEqual({
      directoryProfileIds: [MEMBER_ONE_ID],
    });
  });

  it("keeps an explicit account-only profile on the existing membership writer", async () => {
    const defaultSharedFetchImplementation = sharedFetchImplementation;
    sharedFetchImplementation = async (request) => {
      const method = String(request.init?.method ?? "GET").toUpperCase();
      if (
        request.url.includes("/v1/organizations/current/directory") &&
        method === "GET"
      ) {
        return new Response(
          JSON.stringify(
            buildOrganizationDirectoryFixture({ agentProfiles: [] })
          ),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      return await defaultSharedFetchImplementation(request);
    };

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceAddMembers({
          baseUrl: "https://gateway.openmeld.invalid",
          members: [MEMBER_ONE_ID],
          membershipSource: "organization_directory",
          mode: "agents",
          profile: CURRENT_PROFILE_ID,
          space: SPACE_ID,
          view: "agent",
        });
      });
    });

    const membershipPosts = fetchSpaceRequestWithTimeoutMock.mock.calls
      .map((call) => call[0] as { url: string; init?: RequestInit })
      .filter(
        (request) =>
          String(request.init?.method ?? "GET").toUpperCase() === "POST" &&
          (request.url.includes(`/v1/spaces/${SPACE_ID}/members`) ||
            request.url.includes(
              `/v1/spaces/${SPACE_ID}/organization-directory-profiles`
            ))
      );
    expect(membershipPosts).toHaveLength(1);
    expect(membershipPosts[0]?.url).toContain(`/v1/spaces/${SPACE_ID}/members`);
    expect(JSON.parse(String(membershipPosts[0]?.init?.body ?? "{}"))).toEqual({
      memberProfileIds: [MEMBER_ONE_ID],
    });
  });

  it("rejects mixed Directory and account-only profiles before either writer runs", async () => {
    const humanProfileId =
      buildOrganizationDirectoryFixture().members[0]?.humanProfile?.profileId;
    if (!humanProfileId) {
      throw new Error(
        "Organization Directory fixture is missing its Human Profile"
      );
    }
    const defaultSharedFetchImplementation = sharedFetchImplementation;
    sharedFetchImplementation = async (request) => {
      const method = String(request.init?.method ?? "GET").toUpperCase();
      if (
        request.url.includes("/v1/organizations/current/directory") &&
        method === "GET"
      ) {
        return new Response(
          JSON.stringify(
            buildOrganizationDirectoryFixture({ agentProfiles: [] })
          ),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      return await defaultSharedFetchImplementation(request);
    };

    await withTempHome(async () => {
      await expect(
        withSilencedStdio(async () => {
          await runSpaceAddMembers({
            baseUrl: "https://gateway.openmeld.invalid",
            members: [MEMBER_ONE_ID, humanProfileId],
            membershipSource: "organization_directory",
            mode: "profiles",
            profile: CURRENT_PROFILE_ID,
            space: SPACE_ID,
            view: "agent",
          });
        })
      ).rejects.toThrow(
        "Cannot combine Organization Directory profiles with account-only profiles in one membership request."
      );
    });

    expect(
      fetchSpaceRequestWithTimeoutMock.mock.calls.some((call) => {
        const request = call[0] as { url: string; init?: RequestInit };
        const method = String(request.init?.method ?? "GET").toUpperCase();
        return (
          method === "POST" &&
          (request.url.includes(`/v1/spaces/${SPACE_ID}/members`) ||
            request.url.includes(
              `/v1/spaces/${SPACE_ID}/organization-directory-profiles`
            ))
        );
      })
    ).toBe(false);
  });

  it("rejects a locally resolved Center Agent mixed with an account-only profile before either writer runs", async () => {
    const centerAgentProfileId =
      ORGANIZATION_DIRECTORY_FIXTURE_CENTER_AGENT_PROFILE_ID;
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: OWNER_PROFILE_NAME,
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: MEMBER_ONE_ID,
        profileName: "my-claude",
        profileKind: "agent",
      }),
      buildProfile({
        openMeldProfileId: centerAgentProfileId,
        profileName: "Atlas",
        profileKind: "agent",
      }),
    ]);
    const defaultSharedFetchImplementation = sharedFetchImplementation;
    sharedFetchImplementation = async (request) => {
      const method = String(request.init?.method ?? "GET").toUpperCase();
      if (
        request.url.includes("/v1/organizations/current/directory") &&
        method === "GET"
      ) {
        return new Response(
          JSON.stringify(buildOrganizationDirectoryFixture()),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      return await defaultSharedFetchImplementation(request);
    };
    const writerRequests: string[] = [];
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: { url: string; init?: RequestInit }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          method === "POST" &&
          (input.url.includes(`/v1/spaces/${SPACE_ID}/members`) ||
            input.url.includes(
              `/v1/spaces/${SPACE_ID}/organization-directory-profiles`
            ))
        ) {
          writerRequests.push(input.url);
          throw new Error(`Unexpected membership writer request: ${input.url}`);
        }
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/meta`) &&
          method === "GET"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: SPACE_ID,
                organizationId: "org-1",
                visibility: "private",
                passwordProtected: true,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        return forwardToSharedFetch(input);
      }
    );

    await withTempHome(async () => {
      await expect(
        withSilencedStdio(async () => {
          await runSpaceAddMembers({
            baseUrl: "https://gateway.openmeld.invalid",
            members: [centerAgentProfileId, MEMBER_ONE_ID],
            membershipSource: "organization_directory",
            mode: "agents",
            profile: CURRENT_PROFILE_ID,
            space: SPACE_ID,
            view: "agent",
          });
        })
      ).rejects.toThrow(
        "Cannot combine Organization Directory profiles with account-only profiles in one membership request."
      );
    });

    expect(writerRequests).toEqual([]);
  });

  it("adds only Agent Profiles when add-agents selects all eligible profiles", async () => {
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: OWNER_PROFILE_NAME,
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: MEMBER_ONE_ID,
        profileName: "my-claude",
        profileKind: "agent",
      }),
      buildProfile({
        openMeldProfileId: HUMAN_MEMBER_ID,
        profileName: "teammate-human",
        profileKind: "human",
      }),
    ]);
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: { url: string; init?: RequestInit }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/meta`) &&
          method === "GET"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: SPACE_ID,
                organizationId: "org-1",
                visibility: "private",
                passwordProtected: true,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                addedMemberIds: [MEMBER_ONE_ID],
                alreadyMemberIds: [],
                items: [
                  buildWakeableAgentSpaceMemberSnapshot({
                    profileId: MEMBER_ONE_ID,
                    profileName: "my-claude",
                  }),
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (input.url.includes("/cursors/") && method === "GET") {
          return Promise.resolve(
            new Response("{}", {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        if (input.url.includes("/cursors/") && method === "PATCH") {
          return Promise.resolve(
            new Response('{"mentionAlias":"configured"}', {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        return forwardToSharedFetch(input);
      }
    );

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceAddMembers({
          all: true,
          baseUrl: "https://gateway.openmeld.invalid",
          membershipSource: "organization_directory",
          mode: "agents",
          profile: CURRENT_PROFILE_ID,
          space: SPACE_ID,
          view: "human",
        });
      });
    });

    const membersPost = fetchSpaceRequestWithTimeoutMock.mock.calls
      .map(
        (call) =>
          call[0] as { url: string; init?: { method?: string; body?: string } }
      )
      .find(
        (request) =>
          request.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          String(request.init?.method ?? "").toUpperCase() === "POST"
      );

    expect(
      JSON.parse(String(membersPost?.init?.body ?? "{}")) as {
        memberProfileIds?: string[];
      }
    ).toEqual({
      memberProfileIds: [MEMBER_ONE_ID],
    });
    expect(
      fetchSpaceRequestWithTimeoutMock.mock.calls.some((call) => {
        const request = call[0] as { url: string; init?: RequestInit };
        return request.url.includes(
          `/v1/spaces/${SPACE_ID}/organization-directory-profiles`
        );
      })
    ).toBe(false);
    expect(
      fetchSpaceRequestWithTimeoutMock.mock.calls.some((call) => {
        const request = call[0] as { url: string; init?: RequestInit };
        return request.url.includes("/v1/organizations/current/directory");
      })
    ).toBe(false);
  });

  it("adds only Human Profiles when add-human-profiles selects all eligible profiles", async () => {
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: OWNER_PROFILE_NAME,
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: MEMBER_ONE_ID,
        profileName: "my-claude",
        profileKind: "agent",
      }),
      buildProfile({
        openMeldProfileId: HUMAN_MEMBER_ID,
        profileName: "teammate-human",
        profileKind: "human",
      }),
    ]);
    let membersGetCount = 0;
    sharedFetchImplementation = (request) => {
      const method = String(request.init?.method ?? "GET").toUpperCase();
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
        method === "GET"
      ) {
        membersGetCount += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify(
              buildSpaceMembersSnapshot({
                agents: [],
                humans:
                  membersGetCount === 1
                    ? []
                    : [
                        buildHumanSpaceMemberSnapshot({
                          profileId: HUMAN_MEMBER_ID,
                          profileName: "teammate-human",
                        }),
                      ],
              })
            ),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );
      }
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/signals`) &&
        method === "POST"
      ) {
        const body = JSON.parse(String(request.init?.body ?? "{}")) as {
          text?: string;
        };
        return Promise.resolve(createPostSignalResponse(body.text ?? ""));
      }
      if (request.url.includes("/v1/account/spaces") && method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify(buildAccountSpacesIndexResponse()), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        );
      }
      return Promise.reject(
        new Error(`Unexpected shared request: ${method} ${request.url}`)
      );
    };
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: { url: string; init?: RequestInit }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/meta`) &&
          method === "GET"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: SPACE_ID,
                organizationId: "org-1",
                visibility: "private",
                passwordProtected: true,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                addedMemberIds: [HUMAN_MEMBER_ID],
                alreadyMemberIds: [],
                items: [
                  buildHumanSpaceMemberSnapshot({
                    profileId: HUMAN_MEMBER_ID,
                    profileName: "teammate-human",
                  }),
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (input.url.includes("/cursors/") && method === "GET") {
          return Promise.resolve(
            new Response("{}", {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        if (input.url.includes("/cursors/") && method === "PATCH") {
          return Promise.resolve(
            new Response('{"mentionAlias":"configured"}', {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        return forwardToSharedFetch(input);
      }
    );

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceAddMembers({
          all: true,
          baseUrl: "https://gateway.openmeld.invalid",
          mode: "human_profiles",
          profile: CURRENT_PROFILE_ID,
          space: SPACE_ID,
          view: "human",
        });
      });
    });

    const membersPost = fetchSpaceRequestWithTimeoutMock.mock.calls
      .map(
        (call) =>
          call[0] as { url: string; init?: { method?: string; body?: string } }
      )
      .find(
        (request) =>
          request.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          String(request.init?.method ?? "").toUpperCase() === "POST"
      );

    expect(
      JSON.parse(String(membersPost?.init?.body ?? "{}")) as {
        memberProfileIds?: string[];
      }
    ).toEqual({
      memberProfileIds: [HUMAN_MEMBER_ID],
    });
  });

  it("identifies each add command in agent result payloads", async () => {
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: OWNER_PROFILE_NAME,
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: MEMBER_ONE_ID,
        profileName: "my-claude",
        profileKind: "agent",
      }),
      buildProfile({
        openMeldProfileId: HUMAN_MEMBER_ID,
        profileName: "teammate-human",
        profileKind: "human",
      }),
    ]);
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: { url: string; init?: RequestInit }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/meta`) &&
          method === "GET"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: SPACE_ID,
                organizationId: "org-1",
                visibility: "private",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "POST"
        ) {
          const body = JSON.parse(String(input.init?.body ?? "{}")) as {
            memberProfileIds?: string[];
          };
          const profileId = body.memberProfileIds?.[0] ?? "";
          const item =
            profileId === HUMAN_MEMBER_ID
              ? buildHumanSpaceMemberSnapshot({
                  profileId: HUMAN_MEMBER_ID,
                  profileName: "teammate-human",
                })
              : buildWakeableAgentSpaceMemberSnapshot({
                  profileId: MEMBER_ONE_ID,
                  profileName: "my-claude",
                });
          return Promise.resolve(
            new Response(
              JSON.stringify({
                addedMemberIds: [profileId],
                alreadyMemberIds: [],
                items: [item],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        return forwardToSharedFetch(input);
      }
    );

    const cases = [
      {
        mode: "profiles" as const,
        members: [MEMBER_ONE_ID],
        command: "add-members",
      },
      {
        mode: "agents" as const,
        members: [MEMBER_ONE_ID],
        command: "add-agents",
      },
      {
        mode: "human_profiles" as const,
        members: [HUMAN_MEMBER_ID],
        command: "add-human-profiles",
      },
    ];

    for (const item of cases) {
      const captured = await withTempHome(async () =>
        withCapturedStdio(async () =>
          runSpaceAddMembers({
            baseUrl: "https://gateway.openmeld.invalid",
            members: item.members,
            mode: item.mode,
            profile: CURRENT_PROFILE_ID,
            space: SPACE_ID,
            view: "agent",
          })
        )
      );
      const resultEnvelope = parseJsonLines(captured.stdout).find(
        (line) => line.code === "space.add_members"
      );
      expect(resultEnvelope?.payload).toEqual(
        expect.objectContaining({
          command: item.command,
          profileAddMode: item.mode,
        })
      );
    }
  });

  it("rejects Human Profiles passed to add-agents before writing membership", async () => {
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: OWNER_PROFILE_NAME,
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: HUMAN_MEMBER_ID,
        profileName: "teammate-human",
        profileKind: "human",
      }),
    ]);

    await withTempHome(async () => {
      await expect(
        withSilencedStdio(async () =>
          runSpaceAddMembers({
            baseUrl: "https://gateway.openmeld.invalid",
            members: [HUMAN_MEMBER_ID],
            mode: "agents",
            profile: CURRENT_PROFILE_ID,
            space: SPACE_ID,
            view: "human",
          })
        )
      ).rejects.toThrow("invalid agent profile ID(s)");
      await expect(
        withSilencedStdio(async () =>
          runSpaceAddMembers({
            baseUrl: "https://gateway.openmeld.invalid",
            members: [HUMAN_MEMBER_ID],
            mode: "agents",
            profile: CURRENT_PROFILE_ID,
            space: SPACE_ID,
            view: "human",
          })
        )
      ).rejects.toThrow(
        `${HUMAN_MEMBER_ID} (this profile kind does not match this command)`
      );
    });

    expect(
      fetchSpaceRequestWithTimeoutMock.mock.calls.some((call) => {
        const request = call[0] as { url: string; init?: RequestInit };
        return (
          request.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          String(request.init?.method ?? "").toUpperCase() === "POST"
        );
      })
    ).toBe(false);
  });

  it("rejects Agent Profiles passed to add-human-profiles before writing membership", async () => {
    await withTempHome(async () => {
      await expect(
        withSilencedStdio(async () =>
          runSpaceAddMembers({
            baseUrl: "https://gateway.openmeld.invalid",
            members: [MEMBER_ONE_ID],
            mode: "human_profiles",
            profile: CURRENT_PROFILE_ID,
            space: SPACE_ID,
            view: "human",
          })
        )
      ).rejects.toThrow("invalid human profile ID(s)");
      await expect(
        withSilencedStdio(async () =>
          runSpaceAddMembers({
            baseUrl: "https://gateway.openmeld.invalid",
            members: [MEMBER_ONE_ID],
            mode: "human_profiles",
            profile: CURRENT_PROFILE_ID,
            space: SPACE_ID,
            view: "human",
          })
        )
      ).rejects.toThrow(
        `${MEMBER_ONE_ID} (this profile kind does not match this command)`
      );
    });

    expect(
      fetchSpaceRequestWithTimeoutMock.mock.calls.some((call) => {
        const request = call[0] as { url: string; init?: RequestInit };
        return (
          request.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          String(request.init?.method ?? "").toUpperCase() === "POST"
        );
      })
    ).toBe(false);
  });

  it("explains inactive, different-owner, and missing explicit profile IDs", async () => {
    const inactiveAgentId = "agt_44444444-4444-4444-8444-444444444444";
    const otherOwnerAgentId = "agt_55555555-5555-4555-8555-555555555555";
    const missingAgentId = "agt_66666666-6666-4666-8666-666666666666";
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: OWNER_PROFILE_NAME,
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: inactiveAgentId,
        profileName: "inactive-agent",
        profileKind: "agent",
        status: "inactive",
      }),
      buildProfile({
        openMeldProfileId: otherOwnerAgentId,
        profileName: "other-owner-agent",
        profileKind: "agent",
        ownerUserId: "user-someone-else",
      }),
    ]);

    await withTempHome(async () => {
      await expect(
        withSilencedStdio(async () =>
          runSpaceAddMembers({
            baseUrl: "https://gateway.openmeld.invalid",
            members: [inactiveAgentId, otherOwnerAgentId, missingAgentId],
            mode: "agents",
            profile: CURRENT_PROFILE_ID,
            space: SPACE_ID,
            view: "human",
          })
        )
      ).rejects.toThrow(
        `${inactiveAgentId} (this profile is not active), ${otherOwnerAgentId} (this profile belongs to a different account), ${missingAgentId} (this profile was not found in this account)`
      );
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    emitSpaceCommandPreflightMock.mockReset();
  });

  it("persists one member-join notice signal per successfully added member", async () => {
    let membersGetCount = 0;
    const defaultSharedFetchImplementation = sharedFetchImplementation;
    sharedFetchImplementation = async (request) => {
      const method = String(request.init?.method ?? "GET").toUpperCase();
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
        method === "GET"
      ) {
        membersGetCount += 1;
        return new Response(
          JSON.stringify(
            buildSpaceMembersSnapshot({
              agents:
                membersGetCount === 1
                  ? []
                  : [
                      buildWakeableAgentSpaceMemberSnapshot({
                        profileId: MEMBER_ONE_ID,
                        profileName: "my-claude",
                        mentionAlias: "claude-alias",
                      }),
                      buildWakeableAgentSpaceMemberSnapshot({
                        profileId: MEMBER_TWO_ID,
                        profileName: "my-codex",
                      }),
                      buildWakeableAgentSpaceMemberSnapshot({
                        profileId: MEMBER_THREE_ID,
                        profileName: "my-claude",
                      }),
                    ],
            })
          ),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      return await defaultSharedFetchImplementation(request);
    };

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID, MEMBER_TWO_ID],
          details: true,
          view: "human",
        });
      });
    });

    const signalPosts = sharedFetchRequests.filter(
      (request) =>
        request.url.includes(`/v1/spaces/${SPACE_ID}/signals`) &&
        String(request.init?.method ?? "").toUpperCase() === "POST"
    );

    expect(signalPosts).toHaveLength(2);

    const cursorPatchRequests = fetchSpaceRequestWithTimeoutMock.mock.calls
      .map(
        (call) =>
          call[0] as { url: string; init?: { method?: string; body?: string } }
      )
      .filter(
        (request) =>
          request.url.includes("/cursors/") &&
          String(request.init?.method ?? "").toUpperCase() === "PATCH"
      );

    expect(cursorPatchRequests).toEqual([]);

    const membersPost = fetchSpaceRequestWithTimeoutMock.mock.calls
      .map(
        (call) =>
          call[0] as { url: string; init?: { method?: string; body?: string } }
      )
      .find(
        (request) =>
          request.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          String(request.init?.method ?? "").toUpperCase() === "POST"
      );

    expect(membersPost).toBeDefined();
    expect(
      JSON.parse(String(membersPost?.init?.body ?? "{}")) as {
        memberProfileIds?: string[];
      }
    ).toEqual({
      memberProfileIds: [MEMBER_ONE_ID, MEMBER_TWO_ID],
    });

    const payloads = signalPosts.map(
      (request) =>
        JSON.parse(String(request.init?.body ?? "{}")) as {
          text?: string;
          meta?: {
            purpose?: string;
            targetProfileId?: string;
            targetProfileName?: string;
            targetMentionLabel?: string;
            addedByProfileId?: string;
            addedByDisplayName?: string;
          };
        }
    );

    expect(payloads.every((payload) => !("type" in payload))).toBe(true);
    expect(
      payloads.every(
        (payload) => payload.meta?.purpose === "space_membership_join_notice"
      )
    ).toBe(true);
    expect(payloads.map((payload) => payload.text)).toEqual([
      "felix-owner-profile added 🤖 my-claude to this space.",
      "felix-owner-profile added 🤖 my-codex to this space.",
    ]);
    expect(payloads.map((payload) => payload.meta?.targetProfileId)).toEqual([
      MEMBER_ONE_ID,
      MEMBER_TWO_ID,
    ]);
    expect(payloads.map((payload) => payload.meta?.targetProfileName)).toEqual([
      "my-claude",
      "my-codex",
    ]);
    expect(payloads.map((payload) => payload.meta?.targetMentionLabel)).toEqual(
      ["claude-alias", "my-codex"]
    );
    expect(payloads.map((payload) => payload.meta?.addedByProfileId)).toEqual([
      CURRENT_PROFILE_ID,
      CURRENT_PROFILE_ID,
    ]);
    expect(payloads.map((payload) => payload.meta?.addedByDisplayName)).toEqual(
      [OWNER_PROFILE_NAME, OWNER_PROFILE_NAME]
    );

    expect(upsertProfileSpaceHistoryMock).toHaveBeenCalledTimes(2);
    expect(upsertProfileSpaceHistoryMock).toHaveBeenNthCalledWith(1, {
      baseUrl: "https://gateway.openmeld.invalid",
      requestContext: {
        actorContext: {
          requestId: expect.any(String),
          openMeldProfileId: MEMBER_ONE_ID,
          profileKind: "agent",
          profileHandle: "my-claude",
          profileName: "my-claude",
          ownerUserId: "user-felix",
          ownerName: OWNER_NAME_OPAQUE,
        },
      },
      openMeldProfileId: MEMBER_ONE_ID,
      profileName: "my-claude",
      spaceId: SPACE_ID,
      body: {
        gatewayHost: "gateway.openmeld.invalid",
        status: "active",
        lastJoinedAt: expect.any(String),
      },
    });
    expect(upsertProfileSpaceHistoryMock).toHaveBeenNthCalledWith(2, {
      baseUrl: "https://gateway.openmeld.invalid",
      requestContext: {
        actorContext: {
          requestId: expect.any(String),
          openMeldProfileId: MEMBER_TWO_ID,
          profileKind: "agent",
          profileHandle: "my-codex",
          profileName: "my-codex",
          ownerUserId: "user-felix",
          ownerName: OWNER_NAME_OPAQUE,
        },
      },
      openMeldProfileId: MEMBER_TWO_ID,
      profileName: "my-codex",
      spaceId: SPACE_ID,
      body: {
        gatewayHost: "gateway.openmeld.invalid",
        status: "active",
        lastJoinedAt: expect.any(String),
      },
    });
  });

  it("renders a compact human success card for added members", async () => {
    const captured = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID],
          details: true,
          view: "human",
        })
      )
    );

    const plainStdout = stripAnsi(captured.stdout);
    expect(plainStdout).toContain("Added to This Space");
    expect(plainStdout).toContain("my-claude (agent)");
    expect(plainStdout).toContain("Broadcast 1 join notice");
    expect(plainStdout).not.toContain("Members update complete for");
    expect(plainStdout).not.toContain("Recorded 1 member join notice");
  });

  it("keeps explicit member adds compact by default in agent view", async () => {
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: {
        url: string;
        init?: {
          method?: string;
          body?: string;
        };
      }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                addedMemberIds: [MEMBER_ONE_ID],
                alreadyMemberIds: [],
                items: [
                  buildWakeableAgentSpaceMemberSnapshot({
                    profileId: MEMBER_ONE_ID,
                    profileName: "my-claude",
                  }),
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        return forwardToSharedFetch(input);
      }
    );

    const captured = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID],
          view: "agent",
        })
      )
    );

    const envelopes = parseJsonLines(captured.stdout);
    expect(envelopes.some((line) => line.code === "space.add_members")).toBe(
      true
    );
    expect(
      envelopes.some((line) => line.code === "space.add_members.progress")
    ).toBe(false);
    expect(emitSpaceCommandPreflightMock).not.toHaveBeenCalled();
    expect(listOpenMeldProfilesMock).toHaveBeenCalled();
    expect(listAgentTargetStatesMock).not.toHaveBeenCalled();
    expect(resolveCurrentReplyReadinessSnapshotMock).not.toHaveBeenCalled();
    expect(
      resolveAgentProfilePrimaryAgentControllerReportMock
    ).not.toHaveBeenCalled();
    expect(
      syncAgentProfileRuntimeBindingFromCurrentReadinessMock
    ).not.toHaveBeenCalled();
    expect(
      sharedFetchRequests.some((request) => {
        const method = String(request.init?.method ?? "GET").toUpperCase();
        return (
          method === "GET" &&
          request.url.includes(`/v1/spaces/${SPACE_ID}/members`)
        );
      })
    ).toBe(true);
    const joinNotice = sharedFetchRequests.find((request) => {
      const method = String(request.init?.method ?? "GET").toUpperCase();
      return (
        method === "POST" &&
        request.url.includes(`/v1/spaces/${SPACE_ID}/signals`)
      );
    });
    const joinNoticeBody = JSON.parse(
      String(joinNotice?.init?.body ?? "{}")
    ) as {
      text?: string;
    };
    expect(joinNoticeBody.text).toContain("my-claude");
    expect(joinNoticeBody.text).not.toContain(MEMBER_ONE_ID);
  });

  it("keeps explicit member adds compact by default in human view", async () => {
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: {
        url: string;
        init?: {
          method?: string;
          body?: string;
        };
      }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                addedMemberIds: [MEMBER_ONE_ID],
                alreadyMemberIds: [],
                items: [
                  buildWakeableAgentSpaceMemberSnapshot({
                    profileId: MEMBER_ONE_ID,
                    profileName: "my-claude",
                  }),
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        return forwardToSharedFetch(input);
      }
    );

    const captured = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID],
          view: "human",
        })
      )
    );

    const plainStdout = stripAnsi(captured.stdout);
    expect(plainStdout).toContain("Added to This Space");
    expect(plainStdout).toContain("my-claude (agent)");
    expect(emitSpaceCommandPreflightMock).not.toHaveBeenCalled();
    expect(listOpenMeldProfilesMock).toHaveBeenCalled();
    expect(listAgentTargetStatesMock).not.toHaveBeenCalled();
    expect(resolveCurrentReplyReadinessSnapshotMock).not.toHaveBeenCalled();
    expect(
      resolveAgentProfilePrimaryAgentControllerReportMock
    ).not.toHaveBeenCalled();
    expect(
      syncAgentProfileRuntimeBindingFromCurrentReadinessMock
    ).not.toHaveBeenCalled();
    expect(
      sharedFetchRequests.some((request) => {
        const method = String(request.init?.method ?? "GET").toUpperCase();
        return (
          method === "GET" &&
          request.url.includes(`/v1/spaces/${SPACE_ID}/members`)
        );
      })
    ).toBe(true);
  });

  it("short-polls Space membership projection for newly added wakeable members", async () => {
    let membersGetCount = 0;
    const defaultSharedFetchImplementation = sharedFetchImplementation;
    sharedFetchImplementation = async (request) => {
      const method = String(request.init?.method ?? "GET").toUpperCase();
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
        method === "GET"
      ) {
        membersGetCount += 1;
        return new Response(
          JSON.stringify(
            buildSpaceMembersSnapshot({
              agents:
                membersGetCount === 1
                  ? []
                  : [
                      buildWakeableAgentSpaceMemberSnapshot({
                        profileId: MEMBER_ONE_ID,
                        profileName: "my-claude",
                      }),
                    ],
            })
          ),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      return await defaultSharedFetchImplementation(request);
    };

    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: { url: string; init?: RequestInit }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "POST"
        ) {
          return new Response(
            JSON.stringify({
              addedMemberIds: [MEMBER_ONE_ID],
              alreadyMemberIds: [],
              items: [],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
        return forwardToSharedFetch(input);
      }
    );

    const captured = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID],
          details: true,
          view: "agent",
        })
      )
    );

    expect(membersGetCount).toBeGreaterThanOrEqual(2);
    expect(
      parseJsonLines(captured.stdout).some(
        (line) =>
          line.code === "space.add_members.progress" &&
          line.data?.stage === "add_members" &&
          line.data?.phase === "confirm_membership_projection"
      )
    ).toBe(true);
  });

  it("reuses the current confirmed Binding when adding a ready local agent member", async () => {
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID],
          details: true,
          view: "human",
        });
      });
    });

    expect(
      syncAgentProfileRuntimeBindingFromCurrentReadinessMock
    ).not.toHaveBeenCalled();
  });

  it("downgrades a ready local agent member to join-only when formal Binding cannot be confirmed", async () => {
    resolveCurrentReplyReadinessSnapshotMock.mockImplementation(
      async ({ profile }: { profile?: { openMeldProfileId?: string } }) =>
        buildCurrentReplyReadinessSnapshot({
          agentBindingReady: false,
          profileId: profile?.openMeldProfileId,
        })
    );
    syncAgentProfileRuntimeBindingFromCurrentReadinessMock.mockResolvedValueOnce(
      {
        agentProfileBindingEnsure: {
          reason: "binding_rejected",
          reasonCodes: ["agent_profile_binding.owner_mismatch"],
          routable: false,
          source: "agent_profile_binding_api",
          status: "rejected",
        },
        runtimeReportSubmission: {
          agentControllerRef: "builtin:my-claude",
          agentControllerReportStatus: "accepted",
          deviceId: "device-1",
          lane: "dev-local",
          reasonCodes: [],
          registrationStatus: "reused",
          openMeldServiceRuntimeId: "runtime_opaque_1",
          source: "runtime_reporting_api",
          status: "submitted",
        },
      }
    );
    resolveOpenMeldProfileOrNullMock.mockResolvedValueOnce(
      buildProfile({
        openMeldProfileId: MEMBER_TWO_ID,
        profileName: "my-codex",
        profileKind: "agent",
        ownerName: OWNER_NAME_OPAQUE,
      })
    );

    const captured = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceAddMembers({
          profile: MEMBER_TWO_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID],
          details: true,
          view: "human",
        })
      )
    );

    const plainStdout = stripAnsi(captured.stdout);
    expect(plainStdout).toContain("Added to This Space");
    expect(plainStdout).toContain(
      "my-claude can join this space now. OpenMeld has not confirmed its local reply path on this device yet. OpenMeld could not finish connecting this Agent Profile to this computer. Open this Agent in OpenMeld Web and reconnect it to the right local agent on this device."
    );
    expect(plainStdout).not.toContain("Ready for background replies");
  });

  it("keeps formal Binding failure reason codes in agent view follow-up diagnostics", async () => {
    resolveCurrentReplyReadinessSnapshotMock.mockImplementation(
      async ({ profile }: { profile?: { openMeldProfileId?: string } }) =>
        buildCurrentReplyReadinessSnapshot({
          agentBindingReady: false,
          profileId: profile?.openMeldProfileId,
        })
    );
    syncAgentProfileRuntimeBindingFromCurrentReadinessMock.mockResolvedValueOnce(
      {
        agentProfileBindingEnsure: {
          reason: "binding_rejected",
          reasonCodes: ["agent_profile_binding.owner_mismatch"],
          routable: false,
          source: "agent_profile_binding_api",
          status: "rejected",
        },
        runtimeReportSubmission: {
          agentControllerRef: "builtin:my-claude",
          agentControllerReportStatus: "accepted",
          deviceId: "device-1",
          lane: "dev-local",
          reasonCodes: [],
          registrationStatus: "reused",
          openMeldServiceRuntimeId: "runtime_opaque_1",
          source: "runtime_reporting_api",
          status: "submitted",
        },
      }
    );
    resolveOpenMeldProfileOrNullMock.mockResolvedValueOnce(
      buildProfile({
        openMeldProfileId: MEMBER_TWO_ID,
        profileName: "my-codex",
        profileKind: "agent",
        ownerName: OWNER_NAME_OPAQUE,
      })
    );

    const captured = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceAddMembers({
          profile: MEMBER_TWO_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID],
          details: true,
          view: "agent",
        })
      )
    );

    const resultEnvelope = parseJsonLines(captured.stdout).find(
      (line) => line.code === "space.add_members"
    );
    const progressEnvelopes = parseJsonLines(captured.stdout).filter(
      (line) => line.code === "space.add_members.progress"
    );
    const executionTargetProfileIds =
      resolveAgentProfilePrimaryAgentControllerReportMock.mock.calls.map(
        (call) => {
          const input = call[0] as { profile?: { openMeldProfileId?: string } };
          return input.profile?.openMeldProfileId;
        }
      );
    expect(executionTargetProfileIds).toEqual([MEMBER_ONE_ID]);
    const progressStages = progressEnvelopes
      .filter((line) => line.code === "space.add_members.progress")
      .map((line) =>
        String((line as { data?: { stage?: unknown } }).data?.stage ?? "")
      );
    const progressPhases = progressEnvelopes.map((line) =>
      String((line as { data?: { phase?: unknown } }).data?.phase ?? "")
    );
    const progressStagePhases = progressEnvelopes.map((line) => {
      const data = line.data ?? {};
      return `${String(data.stage ?? "")}/${String(data.phase ?? "")}`;
    });
    const progressTexts = progressEnvelopes.map((line) =>
      String((line as { text?: unknown }).text ?? "")
    );
    for (const envelope of progressEnvelopes) {
      expect(envelope.data).toEqual(
        expect.objectContaining({
          doesNotMeanReady: true,
          factSource: expect.any(String),
          owner: expect.any(String),
          waitingFor: expect.any(String),
        })
      );
    }
    expect(progressStages).toContain("resolve_candidates");
    expect(progressStages).toContain("check_local_wake_readiness");
    expect(progressStages).toContain("plan_local_wake_participation");
    expect(progressStages).toContain("confirm_local_wake_bindings");
    expect(progressStages).toContain("add_members");
    expect(progressStages).toContain("record_join_notices");
    expect(progressPhases).toContain("read_local_targets");
    expect(progressPhases).toContain("read_profile_readiness");
    expect(progressPhases).toContain("profile_binding_sync");
    expect(progressPhases).toContain("profile_binding_not_confirmed");
    for (const stagePhase of progressStagePhases) {
      expect(SPACE_ADD_MEMBERS_PROGRESS_OVERVIEW_STAGES).toContain(stagePhase);
    }
    expect(progressTexts).toContain(
      "check_local_wake_readiness/start: Checking whether selected agent profiles can handle work from this computer. Members can still be added if local setup needs attention."
    );
    expect(
      progressTexts.some(
        (text) =>
          text.startsWith(
            "plan_local_wake_participation/plan: Local agent plan:"
          ) &&
          text.includes(
            "Adding members is separate from local agent participation on this computer."
          )
      )
    ).toBe(true);
    expect(
      progressTexts.some(
        (text) =>
          text.includes("validating gateway-chain diagnostics") &&
          text.includes("writing the Agent Profile binding") &&
          text.includes("waiting for Core execution readiness projection")
      )
    ).toBe(true);
    expect(progressTexts.join("\n")).not.toContain(
      "Ready for background replies"
    );
    expect(resultEnvelope?.payload).toMatchObject({
      localParticipationFollowUps: [
        {
          profileId: MEMBER_ONE_ID,
          reasonCodes: ["agent_profile_binding.owner_mismatch"],
        },
      ],
    });
  });

  it("emits a wait progress phase when formal Binding confirmation takes longer than five seconds", async () => {
    vi.useFakeTimers();
    resolveCurrentReplyReadinessSnapshotMock.mockImplementation(
      async ({ profile }: { profile?: { openMeldProfileId?: string } }) =>
        buildCurrentReplyReadinessSnapshot({
          agentBindingReady: false,
          profileId: profile?.openMeldProfileId,
        })
    );
    let bindingResolved = false;
    const bindingResult = {
      agentProfileBindingEnsure: {
        outcome: "reused",
        reasonCodes: [],
        routable: true,
        source: "agent_profile_binding_api",
        status: "accepted",
      },
      runtimeReportSubmission: {
        agentControllerRef: "builtin:my-claude",
        agentControllerReportStatus: "accepted",
        deviceId: "device-1",
        lane: "dev-local",
        reasonCodes: [],
        registrationStatus: "reused",
        openMeldServiceRuntimeId: "runtime_opaque_1",
        source: "runtime_reporting_api",
        status: "submitted",
      },
    };
    let resolveBinding: (value: typeof bindingResult) => void = () => undefined;
    const bindingPromise = new Promise<typeof bindingResult>((resolve) => {
      resolveBinding = resolve;
    });
    const settleBinding = () => {
      if (bindingResolved) {
        return;
      }
      bindingResolved = true;
      resolveBinding(bindingResult);
    };
    syncAgentProfileRuntimeBindingFromCurrentReadinessMock.mockImplementationOnce(
      () => bindingPromise
    );

    const runPromise = withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID],
          details: true,
          view: "agent",
        })
      )
    );
    try {
      await waitForFakeTimerCondition(
        "formal Binding sync to start",
        () =>
          syncAgentProfileRuntimeBindingFromCurrentReadinessMock.mock.calls
            .length > 0
      );
      expect(
        syncAgentProfileRuntimeBindingFromCurrentReadinessMock
      ).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5000);
      settleBinding();
      const captured = await runPromise;

      const waitEnvelope = parseJsonLines(captured.stdout).find(
        (line) =>
          line.code === "space.add_members.progress" &&
          line.data?.stage === "confirm_local_wake_bindings" &&
          line.data?.phase === "profile_binding_sync_wait"
      );
      expect(waitEnvelope?.data).toEqual(
        expect.objectContaining({
          doesNotMeanReady: true,
          factSource: "agent_profile_binding_api",
          owner: "local_participation",
          waitingFor:
            "local runtime evidence submission and Agent Profile Binding write",
        })
      );
    } finally {
      settleBinding();
      await runPromise.catch(() => undefined);
    }
  });

  it("adds an unbound agent profile and explains that it joined without local wakeability", async () => {
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: OWNER_PROFILE_NAME,
        profileKind: "human",
      }),
      {
        openMeldProfileId: MEMBER_ONE_ID,
        profileHandle: "ops-agent",
        profileName: "Ops Agent",
        profileKind: "agent",
        status: "active",
        ownerUserId: "user-felix",
        ownerName: OWNER_PROFILE_NAME,
        source: "cli_test",
        createdByUserId: "user-felix",
        lastUsedAt: null,
        createdAt: "2026-03-05T00:00:00.000Z",
        updatedAt: "2026-03-05T00:00:00.000Z",
      },
    ]);

    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: { url: string; init?: RequestInit }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "POST"
        ) {
          return new Response(
            JSON.stringify({
              addedMemberIds: [MEMBER_ONE_ID],
              alreadyMemberIds: [],
              items: [
                buildWakeableAgentSpaceMemberSnapshot({
                  profileId: MEMBER_ONE_ID,
                  profileName: "Ops Agent",
                }),
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
        if (input.url.includes("/cursors/") && method === "GET") {
          return new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (input.url.includes("/cursors/") && method === "PATCH") {
          return new Response('{"mentionAlias":"configured"}', {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return forwardToSharedFetch(input);
      }
    );

    const captured = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID],
          details: true,
          view: "human",
        })
      )
    );

    const plainStdout = stripAnsi(captured.stdout);
    expect(plainStdout).toContain("Added to This Space");
    expect(plainStdout).toContain(
      "Ops Agent joined this space. OpenMeld has not confirmed its local reply path on this device yet."
    );
    expect(plainStdout).toContain(
      "Open this Agent in OpenMeld Web and choose the local agent that should handle work from the Space."
    );
    expect(plainStdout).not.toContain(
      `openmeld service status --profile ${MEMBER_ONE_ID}`
    );
  });

  it("sanitizes join-only warning text before printing it to the terminal", async () => {
    const maliciousMemberId = "agt_11111111-1111-4111-8111-111111111111";
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: OWNER_PROFILE_NAME,
        profileKind: "human",
      }),
      {
        openMeldProfileId: maliciousMemberId,
        profileHandle: "ops-agent",
        profileName: "Ops Agent\nspoof-name",
        profileKind: "agent",
        status: "active",
        ownerUserId: "user-felix",
        ownerName: OWNER_PROFILE_NAME,
        source: "cli_test",
        createdByUserId: "user-felix",
        lastUsedAt: null,
        createdAt: "2026-03-05T00:00:00.000Z",
        updatedAt: "2026-03-05T00:00:00.000Z",
      },
    ]);
    listAgentTargetStatesMock.mockResolvedValue([
      {
        agentId: "join-only-agent",
        displayName: "join-only-agent",
        launchStatus: "ready",
        selectable: true,
      },
    ]);
    resolveCurrentReplyReadinessSnapshotMock.mockImplementation(
      ({ profile }: { profile?: { openMeldProfileId?: string } }) => {
        if (profile?.openMeldProfileId === maliciousMemberId) {
          return {
            agentReplyReadiness: {
              replyReadiness: "blocked",
              reasonCodes: ["route.offline"],
              reasonText: "Ready",
            },
            daemonRouteObservation: READY_DAEMON_ROUTE_OBSERVATION,
            daemonStatus: {
              installed: true,
              status: "running",
              version: "0.3.2",
            },
            deviceReplyReadiness: {
              reasonCodes: ["route.offline"],
              reasonText: "Route offline.\nspoof reason\u001b[2J",
              replyReadiness: "blocked",
              updatedAt: "2026-04-11T00:00:00.000Z",
              wakeableRouteCount: 0,
            },
            displayRuntimeStatus: { status: "running" },
            gatewayChainReadiness: null,
            inventory: null,
            observedAt: "2026-04-11T00:00:00.000Z",
            openClawLocalDiagnostics: null,
            profileWorkspaceRuntimeResolution: {
              status: "ready",
              effectiveRuntimeWorkingDirectory: "/tmp/workspace",
            },
            runtimeProjection: null,
            runtimeStatus: { status: "running" },
            serviceManagerStatus: null,
          };
        }
        return {
          agentReplyReadiness: {
            replyReadiness: "ready",
            reasonCodes: [],
            reasonText: "Ready",
          },
          daemonRouteObservation: READY_DAEMON_ROUTE_OBSERVATION,
          daemonStatus: {
            installed: true,
            status: "running",
            version: "0.3.2",
          },
          deviceReplyReadiness: {
            reasonCodes: [],
            reasonText: "Ready",
            replyReadiness: "ready",
            updatedAt: "2026-04-11T00:00:00.000Z",
            wakeableRouteCount: 1,
          },
          displayRuntimeStatus: { status: "running" },
          gatewayChainReadiness: null,
          inventory: null,
          observedAt: "2026-04-11T00:00:00.000Z",
          openClawLocalDiagnostics: null,
          profileWorkspaceRuntimeResolution: {
            status: "ready",
            effectiveRuntimeWorkingDirectory: "/tmp/workspace",
          },
          runtimeProjection: null,
          runtimeStatus: { status: "running" },
          serviceManagerStatus: null,
        };
      }
    );
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: {
        url: string;
        init?: {
          method?: string;
        };
      }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/meta`) &&
          method === "GET"
        ) {
          return new Response(
            JSON.stringify({
              spaceId: SPACE_ID,
              organizationId: "org-1",
              visibility: "private",
              passwordProtected: true,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "GET"
        ) {
          return new Response(
            JSON.stringify(
              buildSpaceMembersSnapshot({
                agents: [],
              })
            ),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "POST"
        ) {
          return new Response(
            JSON.stringify({
              addedMemberIds: [],
              alreadyMemberIds: [maliciousMemberId],
              items: [],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
        if (input.url.includes("/cursors/") && method === "GET") {
          return new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(
          `Unexpected fetch-with-timeout request: ${method} ${input.url}`
        );
      }
    );

    const captured = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [maliciousMemberId],
          details: true,
          view: "human",
        })
      )
    );

    const plainStdout = stripAnsi(captured.stdout);
    expect(captured.stdout).not.toContain("\u001b[2J");
    expect(plainStdout).toContain(
      "Ops Agent spoof-name can join this space now. OpenMeld has not confirmed its local reply path on this device yet. Connect a local agent before this profile can reply. Open this Agent in OpenMeld Web and choose the local agent that should handle work from the Space."
    );
    expect(plainStdout).not.toContain(
      `openmeld service status --profile ${maliciousMemberId}`
    );
  });

  it("sanitizes repair follow-up text before printing it to the terminal", async () => {
    const maliciousMemberId = "agt_22222222-2222-4222-8222-222222222222";
    const maliciousAgentId = "repair-agent\n--spoof";
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: OWNER_PROFILE_NAME,
        profileKind: "human",
      }),
      {
        openMeldProfileId: maliciousMemberId,
        profileHandle: "repair-agent",
        profileName: "Repair Agent\nspoof-name",
        profileKind: "agent",
        status: "active",
        ownerUserId: "user-felix",
        ownerName: OWNER_PROFILE_NAME,
        source: "cli_test",
        createdByUserId: "user-felix",
        lastUsedAt: null,
        createdAt: "2026-03-05T00:00:00.000Z",
        updatedAt: "2026-03-05T00:00:00.000Z",
      },
    ]);
    listAgentTargetStatesMock.mockResolvedValue([
      {
        agentId: maliciousAgentId,
        displayName: "Local Target\u001b[31m red\nspoof-label",
        launchStatus: "needs_repair",
        selectable: true,
      },
    ]);
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: {
        url: string;
        init?: {
          method?: string;
        };
      }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/meta`) &&
          method === "GET"
        ) {
          return new Response(
            JSON.stringify({
              spaceId: SPACE_ID,
              organizationId: "org-1",
              visibility: "private",
              passwordProtected: true,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "GET"
        ) {
          return new Response(
            JSON.stringify(
              buildSpaceMembersSnapshot({
                agents: [],
              })
            ),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "POST"
        ) {
          return new Response(
            JSON.stringify({
              addedMemberIds: [maliciousMemberId],
              alreadyMemberIds: [],
              items: [],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
        if (input.url.includes("/cursors/") && method === "GET") {
          return new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(
          `Unexpected fetch-with-timeout request: ${method} ${input.url}`
        );
      }
    );

    const captured = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [maliciousMemberId],
          details: true,
          view: "human",
        })
      )
    );

    const plainStdout = stripAnsi(captured.stdout);
    expect(captured.stdout).not.toContain("\u001b[31m");
    expect(plainStdout).toContain(
      "Repair Agent spoof-name joined this space. Local Target red spoof-label still needs repair on this device before it can handle work from the Space. Use `openmeld agents repair --agent repair-agent --spoof` to repair the local agent."
    );
  });

  it("uses the repair command in repair-needed warning text before add-members continues", async () => {
    const maliciousMemberId = "agt_33333333-3333-4333-8333-333333333333";
    const maliciousAgentId = "repair-warning-agent\n--spoof";
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: OWNER_PROFILE_NAME,
        profileKind: "human",
      }),
      {
        openMeldProfileId: maliciousMemberId,
        profileHandle: "repair-warning-agent",
        profileName: "Repair Warning Agent\nspoof-name",
        profileKind: "agent",
        status: "active",
        ownerUserId: "user-felix",
        ownerName: OWNER_PROFILE_NAME,
        source: "cli_test",
        createdByUserId: "user-felix",
        lastUsedAt: null,
        createdAt: "2026-03-05T00:00:00.000Z",
        updatedAt: "2026-03-05T00:00:00.000Z",
      },
    ]);
    listAgentTargetStatesMock.mockResolvedValue([
      {
        agentId: maliciousAgentId,
        displayName: "Repair Warning Target\nspoof-label",
        launchStatus: "needs_repair",
        selectable: true,
      },
    ]);
    resolveCurrentReplyReadinessSnapshotMock.mockImplementation(
      ({ profile }: { profile?: { openMeldProfileId?: string } }) => {
        if (profile?.openMeldProfileId === maliciousMemberId) {
          return {
            agentReplyReadiness: {
              replyReadiness: "blocked",
              reasonCodes: ["controller.launch.needs_repair"],
              reasonText: "Repair required",
            },
            daemonRouteObservation: READY_DAEMON_ROUTE_OBSERVATION,
            daemonStatus: {
              installed: true,
              status: "running",
              version: "0.3.2",
            },
            deviceReplyReadiness: {
              reasonCodes: ["controller.launch.needs_repair"],
              reasonText: "Repair required",
              replyReadiness: "blocked",
              updatedAt: "2026-04-11T00:00:00.000Z",
              wakeableRouteCount: 0,
            },
            displayRuntimeStatus: { status: "running" },
            gatewayChainReadiness: null,
            inventory: null,
            observedAt: "2026-04-11T00:00:00.000Z",
            openClawLocalDiagnostics: null,
            profileWorkspaceRuntimeResolution: {
              status: "ready",
              effectiveRuntimeWorkingDirectory: "/tmp/workspace",
            },
            runtimeProjection: null,
            runtimeStatus: { status: "running" },
            serviceManagerStatus: null,
          };
        }
        return {
          agentReplyReadiness: {
            replyReadiness: "ready",
            reasonCodes: [],
            reasonText: "Ready",
          },
          daemonRouteObservation: READY_DAEMON_ROUTE_OBSERVATION,
          daemonStatus: {
            installed: true,
            status: "running",
            version: "0.3.2",
          },
          deviceReplyReadiness: {
            reasonCodes: [],
            reasonText: "Ready",
            replyReadiness: "ready",
            updatedAt: "2026-04-11T00:00:00.000Z",
            wakeableRouteCount: 1,
          },
          displayRuntimeStatus: { status: "running" },
          gatewayChainReadiness: null,
          inventory: null,
          observedAt: "2026-04-11T00:00:00.000Z",
          openClawLocalDiagnostics: null,
          profileWorkspaceRuntimeResolution: {
            status: "ready",
            effectiveRuntimeWorkingDirectory: "/tmp/workspace",
          },
          runtimeProjection: null,
          runtimeStatus: { status: "running" },
          serviceManagerStatus: null,
        };
      }
    );
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: {
        url: string;
        init?: {
          method?: string;
        };
      }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/meta`) &&
          method === "GET"
        ) {
          return new Response(
            JSON.stringify({
              spaceId: SPACE_ID,
              organizationId: "org-1",
              visibility: "private",
              passwordProtected: true,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "GET"
        ) {
          return new Response(
            JSON.stringify(
              buildSpaceMembersSnapshot({
                agents: [],
              })
            ),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "POST"
        ) {
          return new Response(
            JSON.stringify({
              addedMemberIds: [],
              alreadyMemberIds: [maliciousMemberId],
              items: [],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
        if (input.url.includes("/cursors/") && method === "GET") {
          return new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(
          `Unexpected fetch-with-timeout request: ${method} ${input.url}`
        );
      }
    );

    const captured = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [maliciousMemberId],
          details: true,
          view: "human",
        })
      )
    );

    const plainStdout = stripAnsi(captured.stdout);
    expect(plainStdout).toContain(
      "Repair Warning Agent spoof-name can join this space now. Repair Warning Target spoof-label still needs local setup on this device before it can handle work from the Space. Use `openmeld agents repair --agent repair-warning-agent --spoof` to repair the local agent."
    );
    expect(plainStdout).not.toContain(
      "Use `openmeld setup --profile agt_33333333-3333-4333-8333-333333333333` to check the local reply path."
    );
  });

  it("redirects the current profile to space join instead of add-members", async () => {
    await withTempHome(async () => {
      await expect(
        runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [CURRENT_PROFILE_ID],
          view: "agent",
        })
      ).rejects.toMatchObject({
        code: "space.add_members.current_profile_join_required",
      });
    });
  });

  it("keeps already-present member labels in the human success card", async () => {
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: {
        url: string;
        init?: {
          method?: string;
          body?: string;
        };
      }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "GET"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: SPACE_ID,
                generatedAt: "2026-03-06T00:00:00.000Z",
                summary: {
                  totalCount: 0,
                  humanCount: 0,
                  agentCount: 0,
                  liveNowCount: 0,
                },
                humans: [],
                agents: [],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                addedMemberIds: [MEMBER_ONE_ID],
                alreadyMemberIds: [MEMBER_TWO_ID],
                items: [
                  buildWakeableAgentSpaceMemberSnapshot({
                    profileId: MEMBER_ONE_ID,
                    profileName: "my-claude",
                  }),
                  buildWakeableAgentSpaceMemberSnapshot({
                    profileId: MEMBER_TWO_ID,
                    profileName: "my-codex",
                  }),
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (input.url.includes("/cursors/") && method === "GET") {
          return Promise.resolve(
            new Response("{}", {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        if (input.url.includes("/cursors/") && method === "PATCH") {
          return Promise.resolve(
            new Response('{"mentionAlias":"configured"}', {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/signals`) &&
          method === "POST"
        ) {
          const body = JSON.parse(String(input.init?.body ?? "{}")) as {
            text?: string;
          };
          return Promise.resolve(createPostSignalResponse(body.text ?? ""));
        }
        return forwardToSharedFetch(input);
      }
    );

    const captured = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID, MEMBER_TWO_ID],
          view: "human",
        })
      )
    );

    const plainStdout = stripAnsi(captured.stdout);
    expect(plainStdout).toContain("Already here: my-codex (agent)");
  });

  it("keeps join-notice partial failure visible in agent output", async () => {
    resolveOpenMeldProfileOrNullMock.mockResolvedValue(
      buildProfile({
        openMeldProfileId: MEMBER_TWO_ID,
        profileName: "my-codex",
        profileKind: "agent",
        ownerName: OWNER_NAME_OPAQUE,
      })
    );
    let signalPostCount = 0;
    const defaultSharedFetchImplementation = sharedFetchImplementation;
    sharedFetchImplementation = async (request) => {
      const method = String(request.init?.method ?? "GET").toUpperCase();
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/signals`) &&
        method === "POST"
      ) {
        signalPostCount += 1;
        const body = JSON.parse(String(request.init?.body ?? "{}")) as {
          text?: string;
        };
        if (signalPostCount === 2) {
          return createGatewayErrorResponse({
            code: "space.not_found",
            message: "space not found",
            requestId: "req-join-notice",
            status: 404,
          });
        }
        return createPostSignalResponse(body.text ?? "");
      }
      return await defaultSharedFetchImplementation(request);
    };
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: {
        url: string;
        init?: {
          method?: string;
          body?: string;
        };
      }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                addedMemberIds: [MEMBER_ONE_ID, MEMBER_THREE_ID],
                alreadyMemberIds: [],
                items: [
                  buildWakeableAgentSpaceMemberSnapshot({
                    profileId: MEMBER_ONE_ID,
                    profileName: "my-claude",
                  }),
                  buildWakeableAgentSpaceMemberSnapshot({
                    profileId: MEMBER_THREE_ID,
                    profileName: "my-gemini",
                  }),
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (input.url.includes("/cursors/") && method === "GET") {
          return Promise.resolve(
            new Response("{}", {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        if (input.url.includes("/cursors/") && method === "PATCH") {
          return Promise.resolve(
            new Response('{"mentionAlias":"configured"}', {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        return forwardToSharedFetch(input);
      }
    );

    const captured = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceAddMembers({
          profile: MEMBER_TWO_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID, MEMBER_THREE_ID],
          details: true,
          view: "agent",
        })
      )
    );

    const resultEnvelope = parseJsonLines(captured.stdout).find(
      (line) => line.code === "space.add_members"
    );

    expect(resultEnvelope?.payload).toMatchObject({
      joinNotice: {
        recordedCount: 1,
        failedCount: 1,
        firstFailure: {
          code: "space.not_found",
          message: "space not found",
          requestId: "req-join-notice",
          status: 404,
        },
      },
    });

    const signalPosts = sharedFetchRequests.filter(
      (request) =>
        request.url.includes(`/v1/spaces/${SPACE_ID}/signals`) &&
        String(request.init?.method ?? "").toUpperCase() === "POST"
    );
    const secondSignalBody = JSON.parse(
      String(signalPosts[1]?.init?.body ?? "{}")
    ) as {
      text?: string;
      meta?: { purpose?: string; targetProfileId?: string };
      type?: string;
      data?: unknown;
    };
    expect(secondSignalBody).toMatchObject({
      text: "my-codex added 🤖 my-gemini to this space.",
      meta: {
        purpose: "space_membership_join_notice",
        targetProfileId: MEMBER_THREE_ID,
      },
    });
    expect(secondSignalBody.type).toBeUndefined();
    expect(secondSignalBody.data).toBeUndefined();
  });

  it("reports join-notice failures when the post-mutation members snapshot cannot be read", async () => {
    resolveOpenMeldProfileOrNullMock.mockResolvedValue(
      buildProfile({
        openMeldProfileId: MEMBER_TWO_ID,
        profileName: "my-codex",
        profileKind: "agent",
        ownerName: OWNER_NAME_OPAQUE,
      })
    );
    let membersGetCount = 0;
    const defaultSharedFetchImplementation = sharedFetchImplementation;
    sharedFetchImplementation = async (request) => {
      const method = String(request.init?.method ?? "GET").toUpperCase();
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
        method === "GET"
      ) {
        membersGetCount += 1;
        if (membersGetCount === 1) {
          return new Response(
            JSON.stringify(
              buildSpaceMembersSnapshot({
                agents: [],
              })
            ),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
        return new Response("snapshot failed", {
          status: 503,
        });
      }
      return await defaultSharedFetchImplementation(request);
    };

    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: { url: string; init?: RequestInit }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "POST"
        ) {
          return new Response(
            JSON.stringify({
              addedMemberIds: [MEMBER_ONE_ID],
              alreadyMemberIds: [],
              items: [],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
        return forwardToSharedFetch(input);
      }
    );

    const captured = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceAddMembers({
          profile: MEMBER_TWO_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID],
          details: true,
          view: "agent",
        })
      )
    );

    const resultEnvelope = parseJsonLines(captured.stdout).find(
      (line) => line.code === "space.add_members"
    );
    expect(resultEnvelope?.payload).toMatchObject({
      joinNotice: {
        recordedCount: 0,
        failedCount: 1,
        firstFailure: {
          message: "snapshot failed",
          status: 503,
        },
      },
    });
    expect(
      sharedFetchRequests.filter(
        (request) =>
          request.url.includes(`/v1/spaces/${SPACE_ID}/signals`) &&
          String(request.init?.method ?? "").toUpperCase() === "POST"
      )
    ).toHaveLength(0);
  });

  it("renders clean human join-notice failures with request id", async () => {
    let membersGetCount = 0;
    let signalPostCount = 0;
    const defaultSharedFetchImplementation = sharedFetchImplementation;
    sharedFetchImplementation = async (request) => {
      const method = String(request.init?.method ?? "GET").toUpperCase();
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
        method === "GET"
      ) {
        membersGetCount += 1;
        return new Response(
          JSON.stringify(
            buildSpaceMembersSnapshot({
              agents:
                membersGetCount === 1
                  ? []
                  : [
                      buildWakeableAgentSpaceMemberSnapshot({
                        profileId: MEMBER_ONE_ID,
                        profileName: "my-claude",
                      }),
                    ],
            })
          ),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/signals`) &&
        method === "POST"
      ) {
        signalPostCount += 1;
        const body = JSON.parse(String(request.init?.body ?? "{}")) as {
          text?: string;
        };
        if (signalPostCount === 1) {
          return createGatewayErrorResponse({
            code: "space.not_found",
            message: "space not found",
            requestId: "req-human-join-notice",
            status: 404,
          });
        }
        return createPostSignalResponse(body.text ?? "");
      }
      return await defaultSharedFetchImplementation(request);
    };
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: {
        url: string;
        init?: {
          method?: string;
          body?: string;
        };
      }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/meta`) &&
          method === "GET"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: SPACE_ID,
                organizationId: "org-1",
                visibility: "private",
                passwordProtected: false,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                addedMemberIds: [MEMBER_ONE_ID],
                alreadyMemberIds: [],
                items: [
                  buildWakeableAgentSpaceMemberSnapshot({
                    profileId: MEMBER_ONE_ID,
                    profileName: "my-claude",
                  }),
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        return forwardToSharedFetch(input);
      }
    );

    const captured = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID],
          view: "human",
        })
      )
    );

    const visibleOutput = stripAnsi(captured.stdout);
    expect(visibleOutput).toContain(
      "warn: failed to broadcast 1 join notice: space not found"
    );
    expect(visibleOutput).toContain("Request ID: req-human-join-notice");
    expect(visibleOutput).not.toContain("HTTP 404:");
  });

  it("does not reopen the bring-profiles prompt after add-members hands off to join", async () => {
    canUseInteractivePromptsMock.mockReturnValue(true);
    selectMock.mockImplementation((input: unknown) => {
      const message = (input as { message?: string }).message;
      if (
        typeof message === "string" &&
        message.includes("OpenMeld Service is missing. Install it now?")
      ) {
        return Promise.resolve("not_now");
      }
      throw new Error(`unexpected select prompt: ${String(message ?? "")}`);
    });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID],
          view: "human",
        });
      });
    });

    const metaRequests = fetchSpaceRequestWithTimeoutMock.mock.calls.filter(
      ([request]) =>
        String((request as { url?: string }).url ?? "").includes(
          `/v1/spaces/${SPACE_ID}/meta`
        ) &&
        String(
          (
            request as {
              init?: {
                method?: string;
              };
            }
          ).init?.method ?? "GET"
        ).toUpperCase() === "GET"
    );

    expect(metaRequests).toHaveLength(1);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(
      (confirmMock.mock.calls[0]?.[0] as { message?: string } | undefined)
        ?.message
    ).toBe("Join this space now?");
    expect(
      selectMock.mock.calls.some(
        (call) =>
          (call[0] as { message?: string } | undefined)?.message ===
          "Bring your agents or other profiles with you?"
      )
    ).toBe(false);
  });

  it("forwards an explicit space password to protected add-members requests", async () => {
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          password: "secret-space-123",
          members: [MEMBER_ONE_ID],
          view: "human",
        });
      });
    });

    const addMembersRequest = fetchSpaceRequestWithTimeoutMock.mock.calls
      .map(
        (call) =>
          call[0] as {
            url: string;
            init?: { method?: string; headers?: Record<string, string> };
          }
      )
      .find(
        (request) =>
          request.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
          String(request.init?.method ?? "GET").toUpperCase() === "POST"
      );

    expect(addMembersRequest).toBeDefined();
    expect(addMembersRequest?.init?.headers).toEqual(
      expect.objectContaining({
        "x-openmeld-space-password": "secret-space-123",
      })
    );
  });

  it("does not write a history space name when adding members by explicit space id", async () => {
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID],
          view: "human",
        });
      });
    });

    expect(upsertProfileSpaceHistoryMock).toHaveBeenCalledTimes(1);
    const historyUpsert = upsertProfileSpaceHistoryMock.mock.calls[0]?.[0] as
      | {
          body?: Record<string, unknown>;
        }
      | undefined;
    expect(historyUpsert?.body).toEqual(
      expect.objectContaining({
        gatewayHost: "gateway.openmeld.invalid",
        status: "active",
        lastJoinedAt: expect.any(String),
      })
    );
    expect(historyUpsert?.body).not.toHaveProperty("spaceName");
  });

  it("writes the known target space name into added member history", async () => {
    canUseInteractivePromptsMock.mockReturnValue(true);
    listProfileSpaceHistoryMock.mockResolvedValue([
      {
        profileId: CURRENT_PROFILE_ID,
        spaceId: SPACE_ID,
        gatewayHost: "gateway.openmeld.invalid",
        spaceName: "Design Review",
        creatorProfileId: CURRENT_PROFILE_ID,
        creatorKind: "human",
        spaceCreatedAt: "2026-03-05T10:00:00.000Z",
        spaceUpdatedAt: "2026-03-05T10:00:00.000Z",
        lastJoinedAt: "2026-03-06T10:00:00.000Z",
        lastSeenTs: 1_772_717_200_000,
        status: "active",
        createdAt: "2026-03-05T10:00:00.000Z",
        updatedAt: "2026-03-06T10:00:00.000Z",
      },
    ]);
    promptSearchSelectMock.mockResolvedValue({
      status: "submitted",
      value: "known:0",
    });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          members: [MEMBER_ONE_ID],
          view: "human",
        });
      });
    });

    expect(promptSearchSelectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Choose a space to add members",
      })
    );
    expect(promptSearchMultiselectMock).not.toHaveBeenCalled();
    expect(upsertProfileSpaceHistoryMock).toHaveBeenCalledTimes(1);
    expect(upsertProfileSpaceHistoryMock.mock.calls[0]?.[0]).toMatchObject({
      openMeldProfileId: MEMBER_ONE_ID,
      profileName: "my-claude",
      spaceId: SPACE_ID,
      body: {
        gatewayHost: "gateway.openmeld.invalid",
        spaceName: "Design Review",
        status: "active",
        lastJoinedAt: expect.any(String),
      },
    });
  });

  it("uses searchable prompts for human space and member selection", async () => {
    canUseInteractivePromptsMock.mockReturnValue(true);
    listProfileSpaceHistoryMock.mockResolvedValue([
      {
        profileId: CURRENT_PROFILE_ID,
        spaceId: SPACE_ID,
        gatewayHost: "gateway.openmeld.invalid",
        spaceName: "Design Review",
        creatorProfileId: CURRENT_PROFILE_ID,
        creatorKind: "human",
        spaceCreatedAt: "2026-03-05T10:00:00.000Z",
        spaceUpdatedAt: "2026-03-05T10:00:00.000Z",
        lastJoinedAt: "2026-03-06T10:00:00.000Z",
        lastSeenTs: 1_772_717_200_000,
        status: "active",
        createdAt: "2026-03-05T10:00:00.000Z",
        updatedAt: "2026-03-06T10:00:00.000Z",
      },
      {
        profileId: CURRENT_PROFILE_ID,
        spaceId:
          "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
        gatewayHost: "gateway.openmeld.invalid",
        spaceName: "Ops Followup",
        creatorProfileId: CURRENT_PROFILE_ID,
        creatorKind: "human",
        spaceCreatedAt: "2026-03-04T10:00:00.000Z",
        spaceUpdatedAt: "2026-03-04T10:00:00.000Z",
        lastJoinedAt: "2026-03-04T12:00:00.000Z",
        lastSeenTs: 1_772_544_000_000,
        status: "active",
        createdAt: "2026-03-04T10:00:00.000Z",
        updatedAt: "2026-03-04T12:00:00.000Z",
      },
    ]);
    promptSearchSelectMock.mockResolvedValue({
      status: "submitted",
      value: "known:0",
    });
    promptSearchMultiselectMock.mockResolvedValue({
      status: "submitted",
      value: [MEMBER_ONE_ID, MEMBER_TWO_ID],
    });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          view: "human",
        });
      });
    });

    expect(promptSearchSelectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Choose a space to add members",
        maxVisible: 8,
      })
    );
    const spacePrompt = promptSearchSelectMock.mock.calls[0]?.[0] as
      | {
          items?: Array<{ label?: string; detail?: string; value?: string }>;
        }
      | undefined;
    const spaceLabels = (spacePrompt?.items ?? [])
      .map((item) => [item.label ?? "", item.detail ?? ""].join("\n"))
      .join("\n");
    expect(spaceLabels).toContain("Design Review");
    expect(spaceLabels).toContain("Enter a space ID manually");

    expect(promptSearchMultiselectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Choose at least one agent or profile to bring into this space",
        required: true,
        maxVisible: 8,
      })
    );
    const membersPrompt = promptSearchMultiselectMock.mock.calls[0]?.[0] as
      | {
          items?: Array<{ label?: string; detail?: string; value?: string }>;
        }
      | undefined;
    const memberLabels = (membersPrompt?.items ?? [])
      .map((item) => [item.label ?? "", item.detail ?? ""].join("\n"))
      .join("\n");
    expect(memberLabels).toContain("my-claude (agent)");
    expect(memberLabels).toContain(MEMBER_ONE_ID);
    expect(memberLabels).toContain("my-codex (agent)");
    expect(memberLabels).toContain("local setup connected");
    expect(memberLabels).not.toContain("Ready for background replies");

    const membersPost = fetchSpaceRequestWithTimeoutMock.mock.calls.find(
      ([request]) =>
        String((request as { url?: string }).url ?? "").includes(
          `/v1/spaces/${SPACE_ID}/members`
        ) &&
        String(
          (
            request as {
              init?: {
                method?: string;
              };
            }
          ).init?.method ?? "GET"
        ).toUpperCase() === "POST"
    );
    expect(membersPost).toBeDefined();
    const membersPostRequest = membersPost?.[0] as
      | {
          init?: {
            body?: string;
          };
        }
      | undefined;
    expect(
      JSON.parse(String(membersPostRequest?.init?.body ?? "{}"))
    ).toMatchObject({
      memberProfileIds: [MEMBER_ONE_ID, MEMBER_TWO_ID],
    });
    expect(
      selectMock.mock.calls.some((call) =>
        String(
          (call[0] as { message?: string } | undefined)?.message ?? ""
        ).includes("OpenMeld Service")
      )
    ).toBe(false);
  });

  it("shows workspace-missing agent profiles as repair-needed instead of ready for background replies", async () => {
    canUseInteractivePromptsMock.mockReturnValue(true);
    listProfileSpaceHistoryMock.mockResolvedValue([
      {
        profileId: CURRENT_PROFILE_ID,
        spaceId: SPACE_ID,
        gatewayHost: "gateway.openmeld.invalid",
        spaceName: "Design Review",
        creatorProfileId: CURRENT_PROFILE_ID,
        creatorKind: "human",
        spaceCreatedAt: "2026-03-05T10:00:00.000Z",
        spaceUpdatedAt: "2026-03-05T10:00:00.000Z",
        lastJoinedAt: "2026-03-06T10:00:00.000Z",
        lastSeenTs: 1_772_717_200_000,
        status: "active",
        createdAt: "2026-03-05T10:00:00.000Z",
        updatedAt: "2026-03-06T10:00:00.000Z",
      },
    ]);
    promptSearchSelectMock
      .mockResolvedValueOnce({
        status: "submitted",
        value: "known:0",
      })
      .mockResolvedValueOnce({
        status: "back",
      });
    promptSearchMultiselectMock.mockResolvedValueOnce({
      status: "back",
    });
    resolveCurrentReplyReadinessSnapshotMock.mockImplementation(
      ({ profile }: { profile?: { openMeldProfileId?: string } }) => {
        if (profile?.openMeldProfileId === MEMBER_TWO_ID) {
          return {
            agentReplyReadiness: {
              replyReadiness: "blocked",
              reasonCodes: ["workspace.missing"],
              reasonText:
                "This profile is missing its local workspace on this device.",
            },
            daemonRouteObservation: READY_DAEMON_ROUTE_OBSERVATION,
            daemonStatus: {
              installed: true,
              status: "running",
              version: "0.3.2",
            },
            deviceReplyReadiness: {
              reasonCodes: ["workspace.missing"],
              reasonText:
                "This profile is missing its local workspace on this device.",
              replyReadiness: "blocked",
              updatedAt: "2026-04-11T00:00:00.000Z",
              wakeableRouteCount: 0,
            },
            displayRuntimeStatus: { status: "running" },
            gatewayChainReadiness: null,
            inventory: null,
            observedAt: "2026-04-11T00:00:00.000Z",
            openClawLocalDiagnostics: null,
            profileWorkspaceRuntimeResolution: {
              status: "missing",
              reasonCode: "workspace.missing",
              reasonText:
                "This profile is missing its local workspace on this device.",
            },
            runtimeProjection: null,
            runtimeStatus: { status: "running" },
            serviceManagerStatus: null,
          };
        }
        return {
          agentReplyReadiness: {
            replyReadiness: "ready",
            reasonCodes: [],
            reasonText: "Ready",
          },
          daemonRouteObservation: READY_DAEMON_ROUTE_OBSERVATION,
          daemonStatus: {
            installed: true,
            status: "running",
            version: "0.3.2",
          },
          deviceReplyReadiness: {
            reasonCodes: [],
            reasonText: "Ready",
            replyReadiness: "ready",
            updatedAt: "2026-04-11T00:00:00.000Z",
            wakeableRouteCount: 1,
          },
          displayRuntimeStatus: { status: "running" },
          gatewayChainReadiness: null,
          inventory: null,
          observedAt: "2026-04-11T00:00:00.000Z",
          openClawLocalDiagnostics: null,
          profileWorkspaceRuntimeResolution: {
            status: "ready",
            effectiveRuntimeWorkingDirectory: "/tmp/workspace",
          },
          runtimeProjection: null,
          runtimeStatus: { status: "running" },
          serviceManagerStatus: null,
        };
      }
    );

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          view: "human",
        });
      });
    });

    const membersPrompt = promptSearchMultiselectMock.mock.calls[0]?.[0] as
      | {
          items?: Array<{ detail?: string; value?: string }>;
        }
      | undefined;
    const memberTwoDetail =
      membersPrompt?.items?.find((item) => item.value === MEMBER_TWO_ID)
        ?.detail ?? "";
    expect(memberTwoDetail).toContain("needs repair");
    expect(memberTwoDetail).not.toContain("Ready for background replies");
  });

  it("repairs missing local workspaces inline before bringing an agent profile", async () => {
    canUseInteractivePromptsMock.mockReturnValue(true);
    listProfileSpaceHistoryMock.mockResolvedValue([
      {
        profileId: CURRENT_PROFILE_ID,
        spaceId: SPACE_ID,
        gatewayHost: "gateway.openmeld.invalid",
        spaceName: "Design Review",
        creatorProfileId: CURRENT_PROFILE_ID,
        creatorKind: "human",
        spaceCreatedAt: "2026-03-05T10:00:00.000Z",
        spaceUpdatedAt: "2026-03-05T10:00:00.000Z",
        lastJoinedAt: "2026-03-06T10:00:00.000Z",
        lastSeenTs: 1_772_717_200_000,
        status: "active",
        createdAt: "2026-03-05T10:00:00.000Z",
        updatedAt: "2026-03-06T10:00:00.000Z",
      },
    ]);
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "submitted",
      value: "known:0",
    });
    promptSearchMultiselectMock.mockResolvedValueOnce({
      status: "submitted",
      value: [MEMBER_TWO_ID],
    });

    let workspaceRepaired = false;
    syncProfileWorkspaceStateMock.mockImplementation(() => {
      workspaceRepaired = true;
      return {
        invalidWorkspaceProfileIds: [],
        migratedProfileIds: [],
        missingWorkspaceProfileIds: [],
        mode: "repair",
        projectedProfileIds: [MEMBER_TWO_ID],
        provisionedProfileIds: [MEMBER_TWO_ID],
        reason: "projected agent profile workspaces were provisioned",
        status: "ok",
      };
    });
    resolveCurrentReplyReadinessSnapshotMock.mockImplementation(
      ({ profile }: { profile?: { openMeldProfileId?: string } }) => {
        const memberTwoBlocked =
          profile?.openMeldProfileId === MEMBER_TWO_ID && !workspaceRepaired;
        return {
          agentReplyReadiness: {
            replyReadiness: memberTwoBlocked ? "blocked" : "ready",
            reasonCodes: memberTwoBlocked ? ["workspace.missing"] : [],
            reasonText: memberTwoBlocked
              ? "This profile is missing its local workspace on this device."
              : "Ready",
          },
          daemonRouteObservation: READY_DAEMON_ROUTE_OBSERVATION,
          daemonStatus: {
            installed: true,
            status: "running",
            version: "0.3.2",
          },
          deviceReplyReadiness: {
            reasonCodes: memberTwoBlocked ? ["workspace.missing"] : [],
            reasonText: memberTwoBlocked
              ? "This profile is missing its local workspace on this device."
              : "Ready",
            replyReadiness: memberTwoBlocked ? "blocked" : "ready",
            updatedAt: "2026-04-11T00:00:00.000Z",
            wakeableRouteCount: memberTwoBlocked ? 0 : 1,
          },
          displayRuntimeStatus: { status: "running" },
          gatewayChainReadiness: null,
          inventory: null,
          observedAt: "2026-04-11T00:00:00.000Z",
          openClawLocalDiagnostics: null,
          profileWorkspaceRuntimeResolution: memberTwoBlocked
            ? {
                status: "missing",
                reasonCode: "workspace.missing",
                reasonText:
                  "This profile is missing its local workspace on this device.",
              }
            : {
                status: "ready",
                effectiveRuntimeWorkingDirectory: "/tmp/workspace",
              },
          runtimeProjection: null,
          runtimeStatus: { status: "running" },
          serviceManagerStatus: null,
        };
      }
    );

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          view: "human",
        });
      });
    });

    expect(syncProfileWorkspaceStateMock).toHaveBeenCalledWith({
      mode: "repair",
      profileIds: ["agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    });
    expect(runAgentsRepairMock).not.toHaveBeenCalled();
  });

  it("returns back to the caller after backing out of member selection and then target selection", async () => {
    canUseInteractivePromptsMock.mockReturnValue(true);
    listProfileSpaceHistoryMock.mockResolvedValue([
      {
        profileId: CURRENT_PROFILE_ID,
        spaceId: SPACE_ID,
        gatewayHost: "gateway.openmeld.invalid",
        spaceName: "Design Review",
        creatorProfileId: CURRENT_PROFILE_ID,
        creatorKind: "human",
        spaceCreatedAt: "2026-03-05T10:00:00.000Z",
        spaceUpdatedAt: "2026-03-05T10:00:00.000Z",
        lastJoinedAt: "2026-03-06T10:00:00.000Z",
        lastSeenTs: 1_772_717_200_000,
        status: "active",
        createdAt: "2026-03-05T10:00:00.000Z",
        updatedAt: "2026-03-06T10:00:00.000Z",
      },
    ]);
    promptSearchSelectMock
      .mockResolvedValueOnce({
        status: "submitted",
        value: "known:0",
      })
      .mockResolvedValueOnce({
        status: "back",
      });
    promptSearchMultiselectMock.mockResolvedValueOnce({
      status: "back",
    });

    await withTempHome(async () => {
      const result = await withSilencedStdio(async () =>
        runSpaceAddMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          view: "human",
          allowBackToCaller: true,
        })
      );

      expect(result).toBe("back");
    });

    expect(promptSearchSelectMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        allowBack: true,
        backLabel: "Back",
      })
    );
    expect(promptSearchMultiselectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowBack: true,
        backLabel: "Back",
      })
    );
  });
});

function parseJsonLines(output: string | null): Array<{
  code?: string;
  data?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  text?: string;
}> {
  return String(output ?? "")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(
      (line) =>
        JSON.parse(line) as {
          code?: string;
          data?: Record<string, unknown>;
          payload?: Record<string, unknown>;
          text?: string;
        }
    );
}

function buildProfile(input: {
  openMeldProfileId: string;
  profileName: string;
  profileKind: "human" | "agent" | "system";
  ownerName?: string;
  ownerUserId?: string;
  status?: "active" | "inactive";
}) {
  return {
    openMeldProfileId: input.openMeldProfileId,
    profileHandle: input.profileName,
    profileName: input.profileName,
    profileKind: input.profileKind,
    status: input.status ?? "active",
    ownerUserId: input.ownerUserId ?? "user-felix",
    ownerName: input.ownerName ?? OWNER_PROFILE_NAME,
    source: "cli_test",
    createdByUserId: "user-felix",
    lastUsedAt: null,
    createdAt: "2026-03-05T00:00:00.000Z",
    updatedAt: "2026-03-05T00:00:00.000Z",
  } as const;
}

function buildSpaceMembersSnapshot(input: {
  agents: ReturnType<typeof buildWakeableAgentSpaceMemberSnapshot>[];
  humans?: ReturnType<typeof buildHumanSpaceMemberSnapshot>[];
}) {
  const humans = input.humans ?? [];
  return {
    spaceId: SPACE_ID,
    generatedAt: "2026-03-06T00:00:00.000Z",
    summary: {
      totalCount: humans.length + input.agents.length,
      humanCount: humans.length,
      agentCount: input.agents.length,
      liveNowCount: 0,
    },
    humans,
    agents: input.agents,
  };
}

function buildAccountSpacesIndexResponse() {
  return {
    pinnedItems: [],
    spaceItems: [
      {
        creatorKind: "human",
        creatorOwnerUserId: "user-felix",
        creatorProfileId: CURRENT_PROFILE_ID,
        creatorProfileName: OWNER_PROFILE_NAME,
        gatewayHost: "gateway.openmeld.invalid",
        joinedProfiles: [
          {
            lastJoinedAt: "2026-03-06T10:00:00.000Z",
            pinnedAt: null,
            profileId: CURRENT_PROFILE_ID,
            profileName: OWNER_PROFILE_NAME,
          },
        ],
        lastJoinedAt: "2026-03-06T10:00:00.000Z",
        lastSeenTs: 1_772_717_200_000,
        openProfileId: CURRENT_PROFILE_ID,
        openProfileName: OWNER_PROFILE_NAME,
        organizationId: "org-1",
        pinnedAt: null,
        pinnedProfileIds: [],
        spaceCreatedAt: "2026-03-05T10:00:00.000Z",
        spaceId: SPACE_ID,
        spaceName: "Design Review",
        spaceUpdatedAt: "2026-03-05T10:00:00.000Z",
        status: "active",
        updatedAt: "2026-03-06T10:00:00.000Z",
        visibility: "private",
      },
    ],
  };
}

function createPostSignalResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      v: 1,
      id: "sig-1",
      spaceId: SPACE_ID,
      ts: 1,
      profile: {
        kind: "human",
        profileId: CURRENT_PROFILE_ID,
        profileName: OWNER_PROFILE_NAME,
      },
      type: "signal.text",
      data: {
        text,
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

function createGatewayErrorResponse(input: {
  code: string;
  message: string;
  requestId: string;
  status: number;
}): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: input.code,
        message: input.message,
        requestId: input.requestId,
      },
    }),
    {
      status: input.status,
      headers: {
        "content-type": "application/json",
        "x-openmeld-request-id": input.requestId,
      },
    }
  );
}

function buildWakeableAgentSpaceMemberSnapshot(input: {
  profileId: string;
  profileName: string;
  mentionAlias?: string | null;
}) {
  return {
    profileId: input.profileId,
    profileName: input.profileName,
    profileKind: "agent" as const,
    mentionAlias: input.mentionAlias ?? null,
    status: "active" as const,
    memberSource: "added_by_member" as const,
    memberSourceLabel: `Added by ${OWNER_PROFILE_NAME}`,
    addedAt: "2026-03-06T00:00:00.000Z",
    removedAt: null,
    createdAt: "2026-03-06T00:00:00.000Z",
    updatedAt: "2026-03-06T00:00:00.000Z",
    addedByProfileId: CURRENT_PROFILE_ID,
    addedByOwnerUserId: "user-felix",
    addedByDisplayName: OWNER_PROFILE_NAME,
    removedByProfileId: null,
    removedByOwnerUserId: null,
    removalReason: null,
    firstEnteredAt: null,
    lastEnteredAt: null,
    lastSeenAt: null,
    lastSeenLabel: null,
    liveNow: false,
    ownerUserId: "user-felix",
    ownerName: OWNER_NAME_OPAQUE,
    agentControllerRef: `builtin:${input.profileName}`,
    agentControllerConversationId: null,
    agentWakeAvailability: {
      action: "none" as const,
      badgeLabel: "Available",
      category: "available" as const,
      isRefreshing: false,
      label: "This profile can be woken in Space",
      phase: "available" as const,
      reasonCode: "agent_execution.ready",
      status: "available_for_wake" as const,
      summary: "Can reply from this computer in Spaces.",
      tooltip: "Available for Wake",
    },
  };
}

function buildHumanSpaceMemberSnapshot(input: {
  profileId: string;
  profileName: string;
  mentionAlias?: string | null;
}) {
  return {
    profileId: input.profileId,
    profileName: input.profileName,
    profileKind: "human" as const,
    mentionAlias: input.mentionAlias ?? null,
    status: "active" as const,
    memberSource: "added_by_member" as const,
    memberSourceLabel: `Added by ${OWNER_PROFILE_NAME}`,
    addedAt: "2026-03-06T00:00:00.000Z",
    removedAt: null,
    createdAt: "2026-03-06T00:00:00.000Z",
    updatedAt: "2026-03-06T00:00:00.000Z",
    addedByProfileId: CURRENT_PROFILE_ID,
    addedByOwnerUserId: "user-felix",
    addedByDisplayName: OWNER_PROFILE_NAME,
    removedByProfileId: null,
    removedByOwnerUserId: null,
    removalReason: null,
    firstEnteredAt: null,
    lastEnteredAt: null,
    lastSeenAt: null,
    lastSeenLabel: null,
    liveNow: false,
    ownerUserId: "user-felix",
    ownerName: OWNER_NAME_OPAQUE,
  };
}

function toRecordedFetchRequest(
  input: string | URL | Request,
  init?: RequestInit
): RecordedFetchRequest {
  if (typeof input === "string" || input instanceof URL) {
    return {
      url: String(input),
      init,
    };
  }

  return {
    url: input.url,
    init: {
      method: init?.method ?? input.method,
      headers: init?.headers ?? Object.fromEntries(input.headers.entries()),
      body: init?.body,
      signal: init?.signal ?? input.signal,
    },
  };
}
