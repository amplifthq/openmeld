import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";
import { runSpaceJoin } from "../src/space/command";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";

const SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const CURRENT_PROFILE_ID = "hum-current-profile";
const OTHER_HUMAN_PROFILE_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_AGENT_PROFILE_ID = "agt_11111111-1111-1111-1111-111111111111";
const EXISTING_AGENT_PROFILE_ID = "agt_22222222-2222-2222-2222-222222222222";
const CREATED_HUMAN_PROFILE_ID = "33333333-3333-3333-3333-333333333333";
const CREATED_AGENT_PROFILE_ID = "agt_33333333-3333-3333-3333-333333333333";
const EXISTING_AGENT_PROFILE_ID_2 = "agt_44444444-4444-4444-4444-444444444444";
const BUILTIN_CAPABILITY_PREFIX_RE = /^builtin:/;
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

const runConnectMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());
const multiselectMock = vi.hoisted(() => vi.fn());
const promptSearchSelectMock = vi.hoisted(() => vi.fn());
const promptSearchMultiselectMock = vi.hoisted(() => vi.fn());
const promptSearchMultiselectWorkbenchMock = vi.hoisted(() => vi.fn());
const promptTextEntryMock = vi.hoisted(() => vi.fn());
const textMock = vi.hoisted(() => vi.fn());
const cancelMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() => vi.fn());

const listOpenMeldProfilesMock = vi.hoisted(() => vi.fn());
const getOpenMeldProfileCapabilitiesMock = vi.hoisted(() => vi.fn());
const createOpenMeldHumanProfileMock = vi.hoisted(() => vi.fn());
const createOpenMeldAgentProfileMock = vi.hoisted(() => vi.fn());
const listAgentTargetStatesMock = vi.hoisted(() => vi.fn());
const updateAgentRegistrationsMock = vi.hoisted(() => vi.fn());
const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const emitSpaceCommandPreflightMock = vi.hoisted(() => vi.fn());

const listAccountSpaceIndexMock = vi.hoisted(() => vi.fn());
const listProfileSpaceHistoryMock = vi.hoisted(() => vi.fn());
const upsertProfileSpaceHistoryMock = vi.hoisted(() => vi.fn());

const fetchSpaceRequestWithTimeoutMock = vi.hoisted(() => vi.fn());
const getDaemonStatusMock = vi.hoisted(() => vi.fn());
const inspectDaemonServiceInventoryMock = vi.hoisted(() => vi.fn());
const getEffectiveDaemonRuntimeStatusMock = vi.hoisted(() => vi.fn());
const readCurrentObservedDaemonRuntimeStatusMock = vi.hoisted(() => vi.fn());
const maybeAutoStopIdleLocalServiceMock = vi.hoisted(() => vi.fn());
const resolveLocalServiceDemandMock = vi.hoisted(() => vi.fn());
const resolveDaemonRuntimeStateMock = vi.hoisted(() => vi.fn());
const resolveDaemonServiceManagerForRuntimeStateMock = vi.hoisted(() =>
  vi.fn()
);
const runDaemonBackgroundStartForDecisionMock = vi.hoisted(() => vi.fn());
const runDaemonStartDecisionPromptMock = vi.hoisted(() => vi.fn());
const shouldOfferDaemonStartDecisionMock = vi.hoisted(() => vi.fn());
const resolveCurrentReplyReadinessSnapshotMock = vi.hoisted(() => vi.fn());
const resolveAgentProfilePrimaryAgentControllerReportMock = vi.hoisted(() =>
  vi.fn()
);
const ensureAgentProfileRuntimeBindingMock = vi.hoisted(() => vi.fn());
const syncAgentProfileRuntimeBindingFromCurrentReadinessMock = vi.hoisted(() =>
  vi.fn()
);

vi.mock("@clack/prompts", () => {
  return {
    cancel: (...args: unknown[]) => cancelMock(...args),
    confirm: (...args: unknown[]) => confirmMock(...args),
    isCancel: (value: unknown) => isCancelMock(value),
    multiselect: (input: unknown) => multiselectMock(input),
    password: vi.fn(),
    select: (input: unknown) => selectMock(input),
    text: (input: unknown) => textMock(input),
  };
});

vi.mock("../src/runtime/context", () => {
  return {
    parseCliViewMode: vi.fn(),
    resolveRuntimeContext: vi.fn(async () => ({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    })),
  };
});

vi.mock("../src/space/connect", () => {
  return {
    runConnect: (...args: unknown[]) => runConnectMock(...args),
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

vi.mock("../src/system/ensure-agent-profile-runtime-binding", () => ({
  ensureAgentProfileRuntimeBinding: (
    ...args: Parameters<typeof ensureAgentProfileRuntimeBindingMock>
  ) => ensureAgentProfileRuntimeBindingMock(...args),
  syncAgentProfileRuntimeBindingFromCurrentReadiness: (
    ...args: Parameters<
      typeof syncAgentProfileRuntimeBindingFromCurrentReadinessMock
    >
  ) => syncAgentProfileRuntimeBindingFromCurrentReadinessMock(...args),
}));

vi.mock("../src/space/preflight", () => ({
  emitSpaceCommandPreflight: (
    ...args: Parameters<typeof emitSpaceCommandPreflightMock>
  ) => emitSpaceCommandPreflightMock(...args),
  emitResolvedSpaceCommandPreflight: vi.fn(),
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

vi.mock("../src/ui/text-entry", () => ({
  promptTextEntry: (...args: Parameters<typeof promptTextEntryMock>) =>
    promptTextEntryMock(...args),
}));

vi.mock("../src/config/resolve-openmeld-profile", () => {
  const profile = {
    openMeldProfileId: "hum-current-profile",
    profileName: "Felix",
    profileKind: "human",
    status: "active",
    ownerUserId: "user-1",
    source: "cli_create",
    createdByUserId: "user-1",
    lastUsedAt: null,
    createdAt: "2026-03-05T00:00:00.000Z",
    updatedAt: "2026-03-05T00:00:00.000Z",
  } as const;
  return {
    requireOpenMeldProfile: vi.fn(async () => profile),
    resolveOpenMeldProfileOrNull: vi.fn(async () => profile),
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

vi.mock("../src/config/daemon-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/daemon-state")
  >("../src/config/daemon-state");
  return {
    ...actual,
    getDaemonStatus: (...args: unknown[]) => getDaemonStatusMock(...args),
  };
});

vi.mock("../src/config/openmeld-profiles-api", () => {
  return {
    listOpenMeldProfiles: (...args: unknown[]) =>
      listOpenMeldProfilesMock(...args),
    getOpenMeldProfileCapabilities: (...args: unknown[]) =>
      getOpenMeldProfileCapabilitiesMock(...args),
    createOpenMeldHumanProfile: (...args: unknown[]) =>
      createOpenMeldHumanProfileMock(...args),
    createOpenMeldAgentProfile: (...args: unknown[]) =>
      createOpenMeldAgentProfileMock(...args),
  };
});

vi.mock("../src/agents/registry", () => {
  return {
    listAgentTargetStates: (...args: unknown[]) =>
      listAgentTargetStatesMock(...args),
    updateAgentRegistrations: (...args: unknown[]) =>
      updateAgentRegistrationsMock(...args),
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
      this.status = input.status ?? null;
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

vi.mock("../src/config/account-space-index-api", () => ({
  listAccountSpaceIndex: (...args: unknown[]) =>
    listAccountSpaceIndexMock(...args),
}));

vi.mock("../src/space/fetch-with-timeout", () => {
  return {
    fetchSpaceRequestWithTimeout: (...args: unknown[]) =>
      fetchSpaceRequestWithTimeoutMock(...args),
    resolveSpaceRequestTimeoutMsForDiagnostics: vi.fn(() => 10_000),
  };
});

vi.mock("../src/system/local-service-start-decision", async () => {
  const actual = await vi.importActual<
    typeof import("../src/system/local-service-start-decision")
  >("../src/system/local-service-start-decision");
  return {
    ...actual,
    runDaemonStartDecisionPrompt: (...args: unknown[]) =>
      runDaemonStartDecisionPromptMock(...args),
    shouldOfferDaemonStartDecision: (...args: unknown[]) =>
      shouldOfferDaemonStartDecisionMock(...args),
  };
});

vi.mock("../src/local-service/lifecycle/local-service-demand", () => ({
  maybeAutoStopIdleLocalService: maybeAutoStopIdleLocalServiceMock,
  resolveLocalServiceDemand: resolveLocalServiceDemandMock,
}));

vi.mock("../src/local-service/lifecycle/daemon-service-runtime", () => ({
  getEffectiveDaemonRuntimeStatus: (...args: unknown[]) =>
    getEffectiveDaemonRuntimeStatusMock(...args),
  readCurrentObservedDaemonRuntimeStatus: (...args: unknown[]) =>
    readCurrentObservedDaemonRuntimeStatusMock(...args),
  resolveDaemonRuntimeState: (...args: unknown[]) =>
    resolveDaemonRuntimeStateMock(...args),
  resolveDaemonServiceManagerForRuntimeState: (...args: unknown[]) =>
    resolveDaemonServiceManagerForRuntimeStateMock(...args),
}));

vi.mock("../src/commands/service", () => ({
  runDaemonBackgroundStartForDecision: (...args: unknown[]) =>
    runDaemonBackgroundStartForDecisionMock(...args),
}));

vi.mock("../src/local-service/lifecycle/daemon-service-inventory", () => ({
  inspectDaemonServiceInventory: (...args: unknown[]) =>
    inspectDaemonServiceInventoryMock(...args),
}));

function createDaemonInventory(
  input: {
    installedVersion?: string | null;
    runtimeStatus?: "not_running" | "running" | "stale" | "unknown";
    anomalyCodes?: string[];
  } = {}
) {
  const installedVersion =
    input.installedVersion === undefined
      ? packageJson.version
      : input.installedVersion;
  return {
    expectedVersion: packageJson.version,
    installStatus:
      installedVersion === null
        ? {
            installed: false,
            state: null,
          }
        : {
            installed: true,
            state: {
              v: 1,
              schema: "openmeld-daemon-install-v1",
              daemonVersion: installedVersion,
              installSource: "test",
              installedAt: "2026-03-06T00:00:00.000Z",
              updatedAt: "2026-03-06T00:00:00.000Z",
            },
          },
    runtimeStatus: {
      status: input.runtimeStatus ?? "running",
      mode: input.runtimeStatus === "running" ? "background" : null,
      pid: input.runtimeStatus === "running" ? 123 : null,
      startedAt:
        input.runtimeStatus === "running" ? "2026-03-06T00:00:00.000Z" : null,
      updatedAt:
        input.runtimeStatus === "running" ? "2026-03-06T00:00:00.000Z" : null,
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    },
    anomalies: (input.anomalyCodes ?? []).map((code) => ({
      code,
      message: String(code),
    })),
  };
}

type SelectPromptInput = {
  message?: string;
  options?: Array<{
    value: string;
    label: string;
    hint?: string;
    disabled?: boolean;
  }>;
};

type ConfirmPromptInput = {
  active?: string;
  inactive?: string;
  initialValue?: boolean;
  message?: string;
};

type MultiSelectPromptInput = {
  message?: string;
  maxVisible?: number;
  required?: boolean;
  allowBack?: boolean;
  backLabel?: string;
  initialSelectedValues?: string[];
  items?: Array<{
    value: string;
    label: string;
    detail?: string;
    disabled?: boolean;
  }>;
};

type WorkbenchPromptInput = MultiSelectPromptInput & {
  footerActions?: Array<{
    value: string;
    label: string;
    icon?: string;
    accent?: boolean;
    hint?: string;
    disabled?: boolean;
  }>;
};

describe("space join pre-join flow", () => {
  beforeEach(() => {
    runConnectMock.mockResolvedValue(undefined);
    getOpenMeldProfileCapabilitiesMock.mockReset().mockResolvedValue({
      ok: true,
      additionalHumanProfileCreationEnabled: true,
    });
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
    getDaemonStatusMock.mockReset().mockResolvedValue({
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.0.1",
        installSource: "test",
        installedAt: "2026-03-06T00:00:00.000Z",
        updatedAt: "2026-03-06T00:00:00.000Z",
      },
    });
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValue(createDaemonInventory());
    getEffectiveDaemonRuntimeStatusMock.mockReset().mockReturnValue("running");
    maybeAutoStopIdleLocalServiceMock.mockReset().mockResolvedValue({
      autoStopped: false,
      effectiveRuntimeStatus: "running",
      localDemand: {
        decision: "keep_running",
        hasLocalExecutionRoute: true,
        repairableReplyCandidateCount: 0,
        reason: "local execution routes are available",
        localExecutionRouteCount: 1,
        projection: null,
      },
    });
    resolveLocalServiceDemandMock.mockReset().mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: true,
      repairableReplyCandidateCount: 0,
      reason: "local execution routes are available",
      localExecutionRouteCount: 1,
      projection: null,
    });
    confirmMock.mockReset().mockResolvedValue(true);
    isCancelMock.mockReturnValue(false);
    selectMock.mockReset().mockResolvedValue("no");
    listAccountSpaceIndexMock
      .mockReset()
      .mockResolvedValue({ pinnedItems: [], spaceItems: [] });
    listProfileSpaceHistoryMock.mockResolvedValue([]);
    upsertProfileSpaceHistoryMock.mockResolvedValue({ item: {} });
    listAgentTargetStatesMock.mockResolvedValue([
      buildEnabledControllerState(),
    ]);
    updateAgentRegistrationsMock.mockResolvedValue(undefined);
    promptSearchSelectMock.mockReset();
    promptSearchMultiselectMock.mockReset();
    promptSearchMultiselectWorkbenchMock.mockReset();
    promptTextEntryMock.mockReset();
    readCurrentObservedDaemonRuntimeStatusMock.mockReset().mockResolvedValue({
      status: "running",
      mode: "background",
      pid: 123,
      startedAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    });
    resolveDaemonRuntimeStateMock.mockReset().mockResolvedValue({
      status: "running",
      mode: "background",
      pid: 123,
      startedAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    });
    resolveDaemonServiceManagerForRuntimeStateMock
      .mockReset()
      .mockResolvedValue({
        serviceManager: null,
        serviceManagerStatus: null,
      });
    runDaemonBackgroundStartForDecisionMock
      .mockReset()
      .mockResolvedValue("started");
    runDaemonStartDecisionPromptMock.mockReset().mockResolvedValue("not_now");
    shouldOfferDaemonStartDecisionMock.mockReset().mockReturnValue(false);
    resolveAgentProfilePrimaryAgentControllerReportMock
      .mockReset()
      .mockImplementation(
        ({
          profile,
        }: {
          profile?: {
            openMeldProfileId?: string;
            agentControllerRef?: string;
            profileKind?: string;
          };
        }) => {
          if (profile?.profileKind !== "agent") {
            return Promise.resolve(null);
          }
          const agentControllerRef = profile.agentControllerRef;
          if (!agentControllerRef) {
            return Promise.resolve(null);
          }
          return Promise.resolve({
            bindingState: "enabled_primary",
            capabilityId: agentControllerRef.replace(
              BUILTIN_CAPABILITY_PREFIX_RE,
              ""
            ),
            capabilityKind: agentControllerRef.startsWith("builtin:")
              ? "builtin"
              : "custom",
            agentControllerRef,
            localAgentId: agentControllerRef.replace(
              BUILTIN_CAPABILITY_PREFIX_RE,
              ""
            ),
            primaryBinding: null,
            reasonCodes: [],
            routable: true,
          });
        }
      );
    ensureAgentProfileRuntimeBindingMock.mockReset().mockResolvedValue({
      outcome: "reused",
      reasonCodes: [],
      routable: true,
      source: "agent_profile_binding_api",
      status: "accepted",
    });
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
          agentControllerRef: "builtin:codex",
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
    resolveCurrentReplyReadinessSnapshotMock
      .mockReset()
      .mockImplementation(
        async ({ profile }: { profile?: { openMeldProfileId?: string } }) => ({
          agentReplyReadiness:
            profile?.openMeldProfileId &&
            String(profile.openMeldProfileId).startsWith("agt_")
              ? {
                  replyReadiness: "ready",
                  reasonCodes: [],
                  reasonText: "Ready",
                }
              : null,
          daemonRouteObservation: {
            detail: null,
            observedAt: "2026-04-11T00:00:00.000Z",
            profileId: profile?.openMeldProfileId ?? null,
            reasonCode: "online",
            route: {
              profileId: profile?.openMeldProfileId ?? "profile",
              connectedAt: "2026-04-11T00:00:00.000Z",
              routeKey: "route-key",
              sessionId: "session-id",
              userId: "user-1",
            },
            status: "online",
          },
          daemonStatus: {
            installed: true,
            state: {
              v: 1,
              schema: "openmeld-daemon-install-v1",
              daemonVersion: "0.0.1",
              installSource: "test",
              installedAt: "2026-03-06T00:00:00.000Z",
              updatedAt: "2026-03-06T00:00:00.000Z",
            },
          },
          deviceReplyReadiness: {
            reasonCodes: [],
            reasonText: "Ready",
            replyReadiness: "ready",
            updatedAt: "2026-04-11T00:00:00.000Z",
            wakeableRouteCount: 1,
          },
          displayRuntimeStatus: {
            status: "running",
            mode: "background",
            pid: 123,
            startedAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
          },
          gatewayChainReadiness: null,
          inventory: null,
          observedAt: "2026-04-11T00:00:00.000Z",
          openClawLocalDiagnostics: null,
          profileWorkspaceRuntimeResolution:
            profile?.openMeldProfileId &&
            String(profile.openMeldProfileId).startsWith("agt_")
              ? {
                  status: "ready",
                  effectiveRuntimeWorkingDirectory: "/tmp/workspace",
                }
              : null,
          runtimeProjection: null,
          runtimeStatus: {
            status: "running",
            mode: "background",
            pid: 123,
            startedAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
          },
          serviceManagerStatus: null,
        })
      );

    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: { url: string; init?: { method?: string; body?: unknown } }) => {
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
                accessMode: "public",
                visibility: "public",
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
          const rawBody = String(input.init?.body ?? "{}");
          const parsedBody = JSON.parse(rawBody) as {
            memberProfileIds?: string[];
          };
          const memberProfileIds = parsedBody.memberProfileIds ?? [];
          return Promise.resolve(
            new Response(
              JSON.stringify({
                addedMemberIds: memberProfileIds,
                alreadyMemberIds: [],
                items: [],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/signals`) &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        if (input.url.includes("/cursors/") && method === "GET") {
          return Promise.resolve(
            new Response(JSON.stringify({}), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        if (input.url.includes("/cursors/") && method === "PATCH") {
          return Promise.resolve(
            new Response(JSON.stringify({ mentionAlias: "configured" }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        return Promise.reject(
          new Error(`Unexpected request: ${method} ${input.url}`)
        );
      }
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    getAuthSessionStateMock.mockReset();
    emitSpaceCommandPreflightMock.mockReset();
  });

  it("joins directly when first prompt selects No", async () => {
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
      }),
    ]);

    const selectCalls: SelectPromptInput[] = [];
    selectMock.mockImplementation((input: unknown) => {
      selectCalls.push(input as SelectPromptInput);
      return "no";
    });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: CURRENT_PROFILE_ID,
          view: "human",
          space: SPACE_ID,
          allowPrompt: true,
        });
      });
    });

    expect(runConnectMock).toHaveBeenCalledTimes(1);
    expect(selectCalls[0]?.message).toBe(
      "Bring your agents or other profiles with you?"
    );
    expect(
      (selectCalls[0]?.options ?? []).map((option) => option.value)
    ).toEqual(["no", "yes"]);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(confirmMock.mock.calls[0]?.[0]).toMatchObject({
      active: "Yes, join this Space",
      inactive: "No, go back",
      message: expect.stringContaining("Do you want to join this Space?"),
      initialValue: true,
      vertical: true,
    });
  });

  it("offers Back when join can return to target selection and reopens the previous step", async () => {
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
      }),
    ]);

    const selectCalls: SelectPromptInput[] = [];
    let bringPromptCount = 0;
    selectMock.mockImplementation((input: unknown) => {
      const prompt = input as SelectPromptInput;
      selectCalls.push(prompt);

      if (
        typeof prompt.message === "string" &&
        prompt.message.includes("No spaces yet")
      ) {
        return "manual";
      }
      if (prompt.message === "Bring your agents or other profiles with you?") {
        bringPromptCount += 1;
        return bringPromptCount === 1 ? "back" : "no";
      }
      return "no";
    });
    promptTextEntryMock
      .mockResolvedValueOnce({
        status: "submitted",
        value: SPACE_ID,
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: SPACE_ID,
      });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: CURRENT_PROFILE_ID,
          view: "human",
          allowPrompt: true,
        });
      });
    });

    const bringPrompt = selectCalls.find(
      (call) => call.message === "Bring your agents or other profiles with you?"
    );

    expect((bringPrompt?.options ?? []).map((option) => option.value)).toEqual([
      "no",
      "yes",
      "back",
    ]);
    expect(
      selectCalls.filter(
        (call) =>
          typeof call.message === "string" &&
          call.message.includes("No spaces yet")
      )
    ).toHaveLength(2);
    expect(promptTextEntryMock).toHaveBeenCalledTimes(2);
    expect(runConnectMock).toHaveBeenCalledTimes(1);
  });

  it("does not offer the service-start path before join when the current profile is human-only", async () => {
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
      }),
    ]);
    resolveDaemonRuntimeStateMock.mockResolvedValue({
      status: "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    });
    getEffectiveDaemonRuntimeStatusMock.mockReturnValue("not_running");
    inspectDaemonServiceInventoryMock.mockResolvedValueOnce(
      createDaemonInventory({
        runtimeStatus: "not_running",
      })
    );
    shouldOfferDaemonStartDecisionMock.mockReturnValue(true);
    runDaemonStartDecisionPromptMock.mockImplementation(
      async (input: { startService: () => Promise<string> }) =>
        await input.startService()
    );

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: CURRENT_PROFILE_ID,
          view: "human",
          space: SPACE_ID,
          allowPrompt: true,
        });
      });
    });

    expect(runDaemonStartDecisionPromptMock).not.toHaveBeenCalled();
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
    expect(runConnectMock).toHaveBeenCalledTimes(1);
  });

  it("skips the service-start prompt when no local execution routes remain", async () => {
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
      }),
    ]);
    resolveLocalServiceDemandMock.mockResolvedValue({
      decision: "allow_auto_stop",
      hasLocalExecutionRoute: false,
      repairableReplyCandidateCount: 0,
      reason: "no local execution routes are available",
      localExecutionRouteCount: 0,
      projection: null,
    });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: CURRENT_PROFILE_ID,
          view: "human",
          space: SPACE_ID,
          allowPrompt: true,
        });
      });
    });

    expect(runDaemonStartDecisionPromptMock).not.toHaveBeenCalled();
    expect(maybeAutoStopIdleLocalServiceMock).not.toHaveBeenCalled();
    expect(runConnectMock).toHaveBeenCalledTimes(1);
  });

  it("does not join when public-space confirmation is declined", async () => {
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
      }),
    ]);

    selectMock.mockResolvedValue("no");
    confirmMock.mockResolvedValue(false);

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: CURRENT_PROFILE_ID,
          view: "human",
          space: SPACE_ID,
          allowPrompt: true,
        });
      });
    });

    expect(runConnectMock).not.toHaveBeenCalled();
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("opens the join workbench with create and join actions when there are available profiles", async () => {
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: OTHER_HUMAN_PROFILE_ID,
        profileName: "Felix Secondary",
        profileKind: "human",
      }),
    ]);

    selectMock.mockImplementation((input: unknown) => {
      const prompt = input as SelectPromptInput;
      if (prompt.message === "Bring your agents or other profiles with you?") {
        return "yes";
      }
      return "no";
    });
    const workbenchCalls: WorkbenchPromptInput[] = [];
    promptSearchMultiselectWorkbenchMock.mockImplementation(
      (input: unknown) => {
        workbenchCalls.push(input as WorkbenchPromptInput);
        return Promise.resolve({
          status: "action",
          action: "join_now",
          selectedValues: [],
        });
      }
    );

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: CURRENT_PROFILE_ID,
          view: "human",
          space: SPACE_ID,
        });
      });
    });

    expect(workbenchCalls).toHaveLength(1);
    expect(workbenchCalls[0]).toMatchObject({
      message: "Review the profiles to bring into this space",
      allowBack: true,
      backLabel: "Back",
      initialSelectedValues: [],
    });
    expect(workbenchCalls[0]?.footerActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "create_new",
          icon: "🆕",
          label: "Create new profile",
        }),
        expect.objectContaining({
          value: "join_now",
          icon: "➡️",
          label: "Join this space with 0 selected profiles",
          disabled: true,
          separatorBefore: true,
        }),
      ])
    );
    expect(runConnectMock).toHaveBeenCalledTimes(1);
  });

  it("highlights the join action once profiles are already selected in the workbench", async () => {
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: OTHER_AGENT_PROFILE_ID,
        profileName: "Ops Agent",
        profileKind: "agent",
        agentControllerRef: "builtin:codex",
        controllerEnabled: true,
      }),
    ]);

    let bringPromptCount = 0;
    selectMock.mockImplementation((input: unknown) => {
      const prompt = input as SelectPromptInput;
      if (prompt.message === "Bring your agents or other profiles with you?") {
        bringPromptCount += 1;
        return bringPromptCount === 1 ? "yes" : "no";
      }
      return "no";
    });

    const workbenchCalls: WorkbenchPromptInput[] = [];
    promptSearchMultiselectWorkbenchMock.mockImplementation(
      (input: unknown) => {
        workbenchCalls.push(input as WorkbenchPromptInput);
        return Promise.resolve({
          status: "action",
          action: "join_now",
          selectedValues: [OTHER_AGENT_PROFILE_ID],
        });
      }
    );

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: CURRENT_PROFILE_ID,
          view: "human",
          space: SPACE_ID,
        });
      });
    });

    expect(workbenchCalls).toHaveLength(1);
    const createAction = workbenchCalls[0]?.footerActions?.find(
      (action) => action.value === "create_new"
    );
    const joinAction = workbenchCalls[0]?.footerActions?.find(
      (action) => action.value === "join_now"
    );

    expect(createAction).toMatchObject({
      value: "create_new",
      icon: "🆕",
      label: "Create new profile",
    });
    expect(createAction?.accent).toBeUndefined();
    expect(workbenchCalls).toHaveLength(1);
    expect(joinAction).toMatchObject({
      value: "join_now",
      icon: "➡️",
      label: "Join this space with 0 selected profiles",
      separatorBefore: true,
    });
    expect(joinAction?.accent).toBeUndefined();
    expect(joinAction?.disabled).toBe(true);
    expect(runConnectMock).toHaveBeenCalledTimes(1);
  });

  it("asks for extra confirmation before bringing agent profiles into a public space", async () => {
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: OTHER_AGENT_PROFILE_ID,
        profileName: "Ops Agent",
        profileKind: "agent",
        agentControllerRef: "builtin:codex",
        controllerEnabled: true,
      }),
    ]);

    const confirmInputs: ConfirmPromptInput[] = [];
    confirmMock.mockImplementation((input: unknown) => {
      confirmInputs.push(input as ConfirmPromptInput);
      return true;
    });

    selectMock.mockImplementation((input: unknown) => {
      const prompt = input as SelectPromptInput;
      if (prompt.message === "Bring your agents or other profiles with you?") {
        return "yes";
      }
      return "no";
    });
    promptSearchMultiselectWorkbenchMock.mockResolvedValue({
      status: "action",
      action: "join_now",
      selectedValues: [OTHER_AGENT_PROFILE_ID],
    });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: CURRENT_PROFILE_ID,
          view: "human",
          space: SPACE_ID,
          allowPrompt: true,
        });
      });
    });

    expect(runConnectMock).toHaveBeenCalledTimes(1);
    expect(confirmInputs).toHaveLength(2);
    expect(confirmInputs[0]?.message).toContain(
      "Do you want to join this Space?"
    );
    expect(confirmInputs[0]).toMatchObject({
      active: "Yes, join this Space",
      inactive: "No, go back",
      initialValue: true,
      vertical: true,
    });
    expect(confirmInputs[1]?.message).toContain(
      "Bring this agent into a Space that anyone with the link can read?"
    );
    expect(confirmInputs[1]).toMatchObject({
      active: "Yes, bring this agent",
      inactive: "No, join without this agent",
      initialValue: true,
      vertical: true,
    });
  });

  it("forwards protected-space password while resolving bring-profiles candidates", async () => {
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: OTHER_AGENT_PROFILE_ID,
        profileName: "Ops Agent",
        profileKind: "agent",
      }),
    ]);

    const membersHeaders: Record<string, string>[] = [];
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: {
        url: string;
        init?: {
          method?: string;
          headers?: Record<string, string>;
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
                accessMode: "protected",
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
          method === "GET"
        ) {
          membersHeaders.push({ ...(input.init?.headers ?? {}) });
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
        if (input.url.includes("/cursors/") && method === "GET") {
          return Promise.resolve(
            new Response(JSON.stringify({}), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/signals`) &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        return Promise.reject(
          new Error(`Unexpected request: ${method} ${input.url}`)
        );
      }
    );

    let bringPromptCount = 0;
    selectMock.mockImplementation((input: unknown) => {
      const prompt = input as SelectPromptInput;
      if (prompt.message === "Bring your agents or other profiles with you?") {
        bringPromptCount += 1;
        return bringPromptCount === 1 ? "yes" : "no";
      }
      return "no";
    });
    promptSearchMultiselectWorkbenchMock.mockResolvedValue({
      status: "back",
      selectedValues: [],
    });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: CURRENT_PROFILE_ID,
          view: "human",
          space: SPACE_ID,
          password: "pw-123456",
          allowPrompt: true,
        });
      });
    });

    expect(runConnectMock).toHaveBeenCalledTimes(1);
    expect(membersHeaders.length).toBeGreaterThan(0);
    for (const headers of membersHeaders) {
      expect(headers["x-openmeld-space-password"]).toBe("pw-123456");
    }
  });

  it("skips selected agents when the public-space agent confirmation is declined", async () => {
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: OTHER_AGENT_PROFILE_ID,
        profileName: "Ops Agent",
        profileKind: "agent",
      }),
    ]);

    let confirmCallCount = 0;
    confirmMock.mockImplementation(() => {
      confirmCallCount += 1;
      return confirmCallCount === 1;
    });
    selectMock.mockImplementation((input: unknown) => {
      const prompt = input as SelectPromptInput;
      if (prompt.message === "Bring your agents or other profiles with you?") {
        return "yes";
      }
      return "no";
    });
    promptSearchMultiselectWorkbenchMock.mockResolvedValue({
      status: "action",
      action: "join_now",
      selectedValues: [OTHER_AGENT_PROFILE_ID],
    });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: CURRENT_PROFILE_ID,
          view: "human",
          space: SPACE_ID,
          allowPrompt: true,
        });
      });
    });

    expect(runConnectMock).toHaveBeenCalledTimes(1);
    const memberPosts = fetchSpaceRequestWithTimeoutMock.mock.calls.filter(
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
          ).init?.method ?? ""
        ).toUpperCase() === "POST"
    );
    expect(memberPosts).toHaveLength(0);
  });

  it("opens the join workbench even when there are no available profiles", async () => {
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
      }),
    ]);

    let bringPromptCount = 0;
    selectMock.mockImplementation((input: unknown) => {
      const prompt = input as SelectPromptInput;
      if (prompt.message === "Bring your agents or other profiles with you?") {
        bringPromptCount += 1;
        return bringPromptCount === 1 ? "yes" : "no";
      }
      return "no";
    });
    const workbenchCalls: WorkbenchPromptInput[] = [];
    promptSearchMultiselectWorkbenchMock.mockImplementation(
      (input: unknown) => {
        workbenchCalls.push(input as WorkbenchPromptInput);
        return Promise.resolve({
          status: "back",
          selectedValues: [],
        });
      }
    );

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: CURRENT_PROFILE_ID,
          view: "human",
          space: SPACE_ID,
        });
      });
    });

    expect(workbenchCalls).toHaveLength(1);
    expect(workbenchCalls[0]).toMatchObject({
      message: "Review the profiles to bring into this space",
      emptyLabel: "No other profiles are available yet.",
      initialSelectedValues: [],
    });
    expect(workbenchCalls[0]?.items).toEqual([]);
    expect(workbenchCalls[0]?.footerActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "create_new",
          icon: "🆕",
          label: "Create new profile",
        }),
      ])
    );
    expect(runConnectMock).toHaveBeenCalledTimes(1);
  });

  it("adds an unbound agent profile and explains that local wakeability is not ready yet", async () => {
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
      }),
      {
        openMeldProfileId: OTHER_AGENT_PROFILE_ID,
        profileName: "Ops Agent",
        profileHandle: "ops-agent",
        profileKind: "agent",
        status: "active",
        ownerUserId: "user-1",
        ownerName: "Felix",
        source: "cli_test",
        createdByUserId: "user-1",
        lastUsedAt: null,
        createdAt: "2026-03-05T00:00:00.000Z",
        updatedAt: "2026-03-05T00:00:00.000Z",
      },
    ]);
    maybeAutoStopIdleLocalServiceMock.mockResolvedValue({
      autoStopped: false,
      effectiveRuntimeStatus: "running",
      localDemand: {
        decision: "allow_auto_stop",
        hasLocalExecutionRoute: false,
        repairableReplyCandidateCount: 0,
        reason: "no local agents need OpenMeld Service right now",
        localExecutionRouteCount: 0,
        projection: null,
      },
    });
    resolveLocalServiceDemandMock.mockResolvedValue({
      decision: "allow_auto_stop",
      hasLocalExecutionRoute: false,
      repairableReplyCandidateCount: 0,
      reason: "no local agents need OpenMeld Service right now",
      localExecutionRouteCount: 0,
      projection: null,
    });
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    selectMock.mockImplementation((input: unknown) => {
      const prompt = input as SelectPromptInput;
      if (prompt.message === "Bring your agents or other profiles with you?") {
        return "yes";
      }
      return "no";
    });
    promptSearchMultiselectWorkbenchMock.mockResolvedValue({
      status: "action",
      action: "join_now",
      selectedValues: [OTHER_AGENT_PROFILE_ID],
    });

    const { stdout } = await withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runSpaceJoin({
          profile: CURRENT_PROFILE_ID,
          view: "human",
          space: SPACE_ID,
          allowPrompt: true,
        });
      });
    });

    const addMemberCalls = fetchSpaceRequestWithTimeoutMock.mock.calls.filter(
      ([request]) => {
        const input = request as { url?: string; init?: { method?: string } };
        return (
          String(input.url ?? "").includes(`/v1/spaces/${SPACE_ID}/members`) &&
          String(input.init?.method ?? "").toUpperCase() === "POST"
        );
      }
    );

    expect(addMemberCalls).toHaveLength(1);
    const addMemberRequest = addMemberCalls[0]?.[0] as
      | {
          init?: { body?: string };
        }
      | undefined;
    expect(
      JSON.parse(String(addMemberRequest?.init?.body ?? "{}"))
    ).toMatchObject({
      memberProfileIds: [OTHER_AGENT_PROFILE_ID],
    });
    expect(stdout).toContain(
      "Ops Agent can join this space now. OpenMeld has not confirmed its local reply path on this device yet. Connect a local agent before this profile can reply."
    );
    expect(stdout).toContain(
      "Ops Agent joined this space. OpenMeld has not confirmed its local reply path on this device yet."
    );
    expect(stdout).toContain(
      "Open this Agent in OpenMeld Web and choose the local agent that should handle work from the Space."
    );
    expect(stdout).not.toContain(
      `openmeld service status --profile ${OTHER_AGENT_PROFILE_ID}`
    );
    expect(runConnectMock).toHaveBeenCalledTimes(1);
  });

  it("reuses a current Core Binding verdict before bringing a ready local agent into the space", async () => {
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: OTHER_AGENT_PROFILE_ID,
        profileName: "Ops Agent",
        profileKind: "agent",
        agentControllerRef: "builtin:codex",
        controllerEnabled: true,
      }),
    ]);
    selectMock.mockImplementation((input: unknown) => {
      const prompt = input as SelectPromptInput;
      if (prompt.message === "Bring your agents or other profiles with you?") {
        return "yes";
      }
      return "no";
    });
    promptSearchMultiselectWorkbenchMock.mockResolvedValue({
      action: "join_now",
      selectedValues: [OTHER_AGENT_PROFILE_ID],
      status: "action",
    });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          allowPrompt: true,
          profile: CURRENT_PROFILE_ID,
          space: SPACE_ID,
          view: "human",
        });
      });
    });

    expect(
      syncAgentProfileRuntimeBindingFromCurrentReadinessMock
    ).not.toHaveBeenCalled();
    const workbenchPrompt = promptSearchMultiselectWorkbenchMock.mock
      .calls[0]?.[0] as WorkbenchPromptInput | undefined;
    const workbenchDetails = (workbenchPrompt?.items ?? [])
      .map((item) => [item.label ?? "", item.detail ?? ""].join("\n"))
      .join("\n");
    expect(workbenchDetails).toContain("local setup connected");
    expect(workbenchDetails).not.toContain("Ready for background replies");
  });

  it("brings a ready local agent as membership-only when formal Binding cannot be confirmed", async () => {
    const resolveReadySnapshot =
      resolveCurrentReplyReadinessSnapshotMock.getMockImplementation();
    if (!resolveReadySnapshot) {
      throw new Error("expected a default reply readiness implementation");
    }
    resolveCurrentReplyReadinessSnapshotMock.mockImplementation(
      async (...args: unknown[]) => {
        const snapshot = await resolveReadySnapshot(...args);
        return {
          ...snapshot,
          agentReplyReadiness: {
            replyReadiness: "blocked",
            reasonCodes: ["agent_profile_binding.not_ready"],
            reasonText: "Agent Profile Binding is not ready.",
          },
        };
      }
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
          agentControllerRef: "builtin:codex",
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
    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: OTHER_AGENT_PROFILE_ID,
        profileName: "Ops Agent",
        profileKind: "agent",
        agentControllerRef: "builtin:codex",
        controllerEnabled: true,
      }),
    ]);
    selectMock.mockImplementation((input: unknown) => {
      const prompt = input as SelectPromptInput;
      if (prompt.message === "Bring your agents or other profiles with you?") {
        return "yes";
      }
      return "no";
    });
    promptSearchMultiselectWorkbenchMock.mockResolvedValue({
      action: "join_now",
      selectedValues: [OTHER_AGENT_PROFILE_ID],
      status: "action",
    });

    const { stdout } = await withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runSpaceJoin({
          allowPrompt: true,
          profile: CURRENT_PROFILE_ID,
          space: SPACE_ID,
          view: "human",
        });
      });
    });

    expect(stdout).toContain(
      "Ops Agent can join this space now. OpenMeld has not confirmed its local reply path on this device yet."
    );
    expect(stdout).toContain(
      "Ops Agent joined this space. OpenMeld has not confirmed its local reply path on this device yet."
    );
    expect(
      syncAgentProfileRuntimeBindingFromCurrentReadinessMock
    ).toHaveBeenCalledWith({
      profile: expect.objectContaining({
        openMeldProfileId: OTHER_AGENT_PROFILE_ID,
      }),
    });
  });

  it("keeps created human profiles selected in the workbench before join", async () => {
    const profiles = [
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: EXISTING_AGENT_PROFILE_ID,
        profileName: "A Existing Agent",
        profileKind: "agent",
        agentControllerRef: "builtin:codex",
        controllerEnabled: true,
      }),
    ];
    listOpenMeldProfilesMock.mockImplementation(() => profiles);

    const createdProfile = buildProfile({
      openMeldProfileId: CREATED_HUMAN_PROFILE_ID,
      profileName: "Fresh Human",
      profileKind: "human",
    });
    createOpenMeldHumanProfileMock.mockImplementation(() => {
      profiles.push(createdProfile);
      return createdProfile;
    });

    let bringPromptCount = 0;
    selectMock.mockImplementation((input: unknown) => {
      const prompt = input as SelectPromptInput;
      if (prompt.message === "Bring your agents or other profiles with you?") {
        bringPromptCount += 1;
        return bringPromptCount === 1 ? "yes" : "no";
      }
      if (prompt.message === "Profile kind") {
        return "human";
      }
      return "no";
    });
    promptTextEntryMock.mockResolvedValue({
      status: "submitted",
      value: "Fresh Human",
    });

    const workbenchCalls: WorkbenchPromptInput[] = [];
    promptSearchMultiselectWorkbenchMock.mockImplementation(
      (input: unknown) => {
        workbenchCalls.push(input as WorkbenchPromptInput);
        if (workbenchCalls.length === 1) {
          return Promise.resolve({
            status: "action",
            action: "create_new",
            selectedValues: [EXISTING_AGENT_PROFILE_ID],
          });
        }
        return Promise.resolve({
          status: "action",
          action: "join_now",
          selectedValues: [EXISTING_AGENT_PROFILE_ID, CREATED_HUMAN_PROFILE_ID],
        });
      }
    );

    const { stdout } = await withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runSpaceJoin({
          profile: CURRENT_PROFILE_ID,
          view: "human",
          space: SPACE_ID,
        });
      });
    });

    expect(createOpenMeldHumanProfileMock).toHaveBeenCalledTimes(1);
    expect(workbenchCalls[0]).toMatchObject({
      message: "Review the profiles to bring into this space",
      allowBack: true,
      backLabel: "Back",
    });
    expect(workbenchCalls[0]?.initialSelectedValues).toEqual([]);
    expect(workbenchCalls[1]?.initialSelectedValues).toEqual([
      EXISTING_AGENT_PROFILE_ID,
      CREATED_HUMAN_PROFILE_ID,
    ]);
    expect(workbenchCalls[1]?.items?.[0]?.value).toBe(
      EXISTING_AGENT_PROFILE_ID
    );
    expect(workbenchCalls[1]?.items?.[1]?.value).toBe(CREATED_HUMAN_PROFILE_ID);
    expect(stdout).toContain("Profile Created");
    expect(runConnectMock).toHaveBeenCalledTimes(1);
  });

  it("returns to the previous step when the join workbench backs out", async () => {
    const profiles = [
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: EXISTING_AGENT_PROFILE_ID_2,
        profileName: "A Existing Agent",
        profileKind: "agent",
      }),
    ];
    listOpenMeldProfilesMock.mockImplementation(() => profiles);

    const createdProfile = buildProfile({
      openMeldProfileId: CREATED_AGENT_PROFILE_ID,
      profileName: "Fresh Agent",
      profileKind: "agent",
    });
    createOpenMeldAgentProfileMock.mockImplementation(() => {
      profiles.push(createdProfile);
      return createdProfile;
    });

    let bringPromptCount = 0;
    selectMock.mockImplementation((input: unknown) => {
      const prompt = input as SelectPromptInput;
      if (prompt.message === "Bring your agents or other profiles with you?") {
        bringPromptCount += 1;
        return bringPromptCount === 1 ? "yes" : "no";
      }
      if (prompt.message === "Profile kind") {
        return "agent";
      }
      if (prompt.message === "When should this profile auto-reply?") {
        return "mention_only";
      }
      return "no";
    });
    promptTextEntryMock.mockResolvedValue({
      status: "submitted",
      value: "Fresh Agent",
    });
    promptSearchSelectMock.mockResolvedValue({
      status: "submitted",
      value: "codex",
    });
    promptSearchMultiselectWorkbenchMock
      .mockResolvedValueOnce({
        status: "action",
        action: "create_new",
        selectedValues: [],
      })
      .mockResolvedValueOnce({
        status: "back",
        selectedValues: [CREATED_AGENT_PROFILE_ID],
      });

    const { stdout } = await withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runSpaceJoin({
          profile: CURRENT_PROFILE_ID,
          view: "human",
          space: SPACE_ID,
        });
      });
    });

    expect(createOpenMeldAgentProfileMock).toHaveBeenCalledTimes(1);
    expect(createOpenMeldAgentProfileMock).toHaveBeenCalledWith({
      profileName: "Fresh Agent",
      creatorProfileId: CURRENT_PROFILE_ID,
    });
    expect(promptSearchMultiselectWorkbenchMock).toHaveBeenCalledTimes(2);
    expect(
      promptSearchMultiselectWorkbenchMock.mock.calls[1]?.[0] as
        | WorkbenchPromptInput
        | undefined
    ).toMatchObject({
      message: "Review the profiles to bring into this space",
      allowBack: true,
      backLabel: "Back",
      initialSelectedValues: [CREATED_AGENT_PROFILE_ID],
    });
    expect(
      (
        promptSearchMultiselectWorkbenchMock.mock.calls[1]?.[0] as
          | WorkbenchPromptInput
          | undefined
      )?.items?.[0]?.value
    ).toBe(CREATED_AGENT_PROFILE_ID);
    expect(stdout).toContain("Profile Created");
    expect(runConnectMock).toHaveBeenCalledTimes(1);
  });

  it("cancels join when controller picker is cancelled during agent profile creation", async () => {
    listOpenMeldProfilesMock.mockImplementation(() => [
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
      }),
    ]);
    selectMock.mockImplementation((input: unknown) => {
      const prompt = input as SelectPromptInput;
      if (prompt.message === "Bring your agents or other profiles with you?") {
        return "yes";
      }
      if (prompt.message === "Profile kind") {
        return "agent";
      }
      return "no";
    });
    promptSearchMultiselectWorkbenchMock.mockResolvedValue({
      status: "action",
      action: "create_new",
      selectedValues: [],
    });
    promptTextEntryMock.mockResolvedValue({
      status: "submitted",
      value: "Cancelled Agent",
    });
    promptSearchSelectMock.mockResolvedValue({
      status: "cancelled",
    });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: CURRENT_PROFILE_ID,
          view: "human",
          space: SPACE_ID,
        });
      });
    });

    expect(createOpenMeldAgentProfileMock).not.toHaveBeenCalled();
    expect(runConnectMock).not.toHaveBeenCalled();
    expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
  });
});

function buildEnabledControllerState() {
  return {
    targetKind: "builtin",
    agentId: "codex",
    displayName: "Codex",
    registered: true,
    enabled: true,
    installChoices: [],
    selectable: true,
    transportModes: [
      {
        mode: "local-cli",
        label: "Local CLI",
        description: "Use local cli transport",
      },
    ],
    defaultTransportMode: "local-cli",
    dispatchPolicy: "mention_only",
  } as const;
}

function buildProfile(input: {
  openMeldProfileId: string;
  profileName: string;
  profileKind: "human" | "agent" | "system";
  agentControllerRef?: string;
  controllerEnabled?: boolean;
}) {
  return {
    openMeldProfileId: input.openMeldProfileId,
    profileName: input.profileName,
    profileKind: input.profileKind,
    ...(input.agentControllerRef
      ? { agentControllerRef: input.agentControllerRef }
      : {}),
    ...(input.controllerEnabled === undefined
      ? {}
      : { controllerEnabled: input.controllerEnabled }),
    status: "active",
    ownerUserId: "user-1",
    ownerName: "Felix",
    source: "cli_test",
    createdByUserId: "user-1",
    lastUsedAt: null,
    createdAt: "2026-03-05T00:00:00.000Z",
    updatedAt: "2026-03-05T00:00:00.000Z",
  } as const;
}
