import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSpaceCreate, runSpaceJoin } from "../src/space/command";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";

const GATEWAY_URL = "https://gateway.openmeld.invalid";
const CREATED_SPACE_ID =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HUMAN_PROFILE_ID = "hum-space-create-join";
const AGENT_PROFILE_ID = "agt-space-create-join";

const confirmMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() =>
  vi.fn((value: unknown) => value === "__cancel__")
);
const passwordPromptMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());
const promptTextEntryMock = vi.hoisted(() => vi.fn());
const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const resolveRuntimeContextMock = vi.hoisted(() => vi.fn());
const emitSpaceCommandPreflightMock = vi.hoisted(() => vi.fn());
const emitSpaceFailureNextStepMock = vi.hoisted(() => vi.fn());
const runConnectMock = vi.hoisted(() => vi.fn());
const fetchSpaceRequestWithTimeoutMock = vi.hoisted(() => vi.fn());
const resolveLocalServiceDemandMock = vi.hoisted(() => vi.fn());
const listAccountSpaceIndexMock = vi.hoisted(() => vi.fn());
const listProfileSpaceHistoryMock = vi.hoisted(() => vi.fn());
const upsertProfileSpaceHistoryMock = vi.hoisted(() => vi.fn());
const listOpenMeldProfilesMock = vi.hoisted(() => vi.fn());
const listAgentTargetStatesMock = vi.hoisted(() => vi.fn());
const updateAgentRegistrationsMock = vi.hoisted(() => vi.fn());
const mockSpaceConfigStore = vi.hoisted(
  () => new Map<string, Record<string, unknown>>()
);

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  confirm: (...args: unknown[]) => confirmMock(...args),
  isCancel: (value: unknown) => isCancelMock(value),
  multiselect: vi.fn(),
  password: (...args: unknown[]) => passwordPromptMock(...args),
  select: (...args: unknown[]) => selectMock(...args),
  text: vi.fn(),
}));

vi.mock("../src/runtime/context", () => ({
  parseCliViewMode: vi.fn(),
  resolveRuntimeContext: (
    ...args: Parameters<typeof resolveRuntimeContextMock>
  ) => resolveRuntimeContextMock(...args),
}));

vi.mock("../src/ui/text-entry", () => ({
  promptTextEntry: (...args: Parameters<typeof promptTextEntryMock>) =>
    promptTextEntryMock(...args),
}));

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: (
      ...args: Parameters<typeof getAuthSessionStateMock>
    ) => getAuthSessionStateMock(...args),
  };
});

vi.mock("../src/auth/command-auth", () => ({
  buildCommandAuthenticationPromptMessage: vi.fn(() => "joining a space"),
  ensureCommandAuthenticationOrCancel: vi.fn(async () => true),
}));

vi.mock("../src/config/resolve-openmeld-profile", () => {
  const toProfile = (openMeldProfileId: string) => {
    const isAgent = openMeldProfileId.startsWith("agt");
    return {
      openMeldProfileId,
      profileName: isAgent ? "Codex" : "Felix",
      profileKind: isAgent ? "agent" : "human",
      status: "active",
      ownerUserId: "user-1",
      source: "cli_create",
      createdByUserId: "user-1",
      lastUsedAt: null,
      createdAt: "2026-03-05T00:00:00.000Z",
      updatedAt: "2026-03-05T00:00:00.000Z",
    } as const;
  };

  return {
    requireOpenMeldProfile: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
        toProfile(String(openMeldProfileId ?? HUMAN_PROFILE_ID))
    ),
    resolveOpenMeldProfileOrNull: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
        toProfile(String(openMeldProfileId ?? HUMAN_PROFILE_ID))
    ),
  };
});

vi.mock("../src/config/account-space-index-api", () => ({
  listAccountSpaceIndex: (
    ...args: Parameters<typeof listAccountSpaceIndexMock>
  ) => listAccountSpaceIndexMock(...args),
}));

vi.mock("../src/config/profile-space-history-api", () => ({
  listProfileSpaceHistory: (
    ...args: Parameters<typeof listProfileSpaceHistoryMock>
  ) => listProfileSpaceHistoryMock(...args),
  upsertProfileSpaceHistory: (
    ...args: Parameters<typeof upsertProfileSpaceHistoryMock>
  ) => upsertProfileSpaceHistoryMock(...args),
  updateProfileSpaceHistoryStatus: vi.fn(),
  resolveGatewayHost: vi.fn(() => "gateway.openmeld.invalid"),
}));

vi.mock("../src/space/local-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/space/local-state")
  >("../src/space/local-state");
  return {
    ...actual,
    listSpaceConfigs: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string } = {}) => ({
        kind: "ok" as const,
        items: [...mockSpaceConfigStore.values()].filter(
          (item) => item.openMeldProfileId === openMeldProfileId
        ),
      })
    ),
    readSpaceConfig: vi.fn(
      ({
        openMeldProfileId,
        space,
      }: {
        openMeldProfileId: string;
        space: string;
      }) => {
        const key = `${openMeldProfileId}:${space}`;
        const value = mockSpaceConfigStore.get(key);
        if (!value) {
          return {
            kind: "missing" as const,
            fileKind: "space_config" as const,
            currentPath: "mock-space-config",
            legacyPath: "mock-space-config",
          };
        }
        return {
          kind: "ok" as const,
          fileKind: "space_config" as const,
          path: "mock-space-config",
          value,
        };
      }
    ),
    upsertSpaceConfig: vi.fn(
      (input: {
        openMeldProfileId: string;
        baseUrl: string;
        space: string;
        profileName: string;
        profileHandle?: string;
        role?: string;
        mentionAlias?: string;
        creator?: unknown;
        guide?: string;
        passwordProtected?: boolean;
        spaceCreatedAt?: string | null;
        spaceUpdatedAt?: string | null;
      }) => {
        const key = `${input.openMeldProfileId}:${input.space}`;
        const now = "2026-04-11T00:00:00.000Z";
        mockSpaceConfigStore.set(key, {
          v: 2,
          schemaVersion: 1,
          source: "local-cache",
          syncedAt: now,
          createdAt: now,
          updatedAt: now,
          ...input,
          ...(input.spaceCreatedAt
            ? { spaceCreatedAt: input.spaceCreatedAt }
            : {}),
          ...(input.spaceUpdatedAt
            ? { spaceUpdatedAt: input.spaceUpdatedAt }
            : {}),
        });
      }
    ),
  };
});

vi.mock("../src/space/preflight", () => ({
  emitSpaceCommandPreflight: (
    ...args: Parameters<typeof emitSpaceCommandPreflightMock>
  ) => emitSpaceCommandPreflightMock(...args),
  emitResolvedSpaceCommandPreflight: vi.fn(),
  emitSpaceFailureNextStep: (
    ...args: Parameters<typeof emitSpaceFailureNextStepMock>
  ) => emitSpaceFailureNextStepMock(...args),
  resolveSpaceFailureGuidance: vi.fn(),
}));

vi.mock("../src/space/connect", () => ({
  runConnect: (...args: Parameters<typeof runConnectMock>) =>
    runConnectMock(...args),
}));

vi.mock("../src/space/fetch-with-timeout", () => ({
  fetchSpaceRequestWithTimeout: (
    ...args: Parameters<typeof fetchSpaceRequestWithTimeoutMock>
  ) => fetchSpaceRequestWithTimeoutMock(...args),
  resolveSpaceRequestTimeoutMsForDiagnostics: vi.fn(() => 10_000),
}));

vi.mock("../src/local-service/lifecycle/local-service-demand", () => ({
  maybeAutoStopIdleLocalService: vi.fn(),
  resolveLocalServiceDemand: (
    ...args: Parameters<typeof resolveLocalServiceDemandMock>
  ) => resolveLocalServiceDemandMock(...args),
}));

vi.mock("../src/config/openmeld-profiles-api", () => ({
  listOpenMeldProfiles: (
    ...args: Parameters<typeof listOpenMeldProfilesMock>
  ) => listOpenMeldProfilesMock(...args),
  createOpenMeldHumanProfile: vi.fn(),
  createOpenMeldAgentProfile: vi.fn(),
}));

vi.mock("../src/agents/registry", () => ({
  listAgentTargetStates: (
    ...args: Parameters<typeof listAgentTargetStatesMock>
  ) => listAgentTargetStatesMock(...args),
  updateAgentRegistrations: (
    ...args: Parameters<typeof updateAgentRegistrationsMock>
  ) => updateAgentRegistrationsMock(...args),
}));

const createValidAuthState = () => ({
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
    activeOrganization: {
      id: "org-1",
      slug: "acme",
      name: "Acme",
    },
  },
});

function createAuthProbeResponse() {
  return new Response(
    JSON.stringify({
      session: {
        expiresAt: "2026-12-31T23:59:59.000Z",
        activeOrganizationId: "org-1",
      },
      user: {
        id: "user-1",
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    }
  );
}

describe("space create to join forwarding", () => {
  beforeEach(() => {
    mockSpaceConfigStore.clear();
    confirmMock.mockReset().mockResolvedValue(true);
    isCancelMock
      .mockReset()
      .mockImplementation((value: unknown) => value === "__cancel__");
    passwordPromptMock.mockReset();
    selectMock.mockReset();
    promptTextEntryMock.mockReset();
    getAuthSessionStateMock
      .mockReset()
      .mockResolvedValue(createValidAuthState());
    resolveRuntimeContextMock.mockReset().mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
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
    emitSpaceFailureNextStepMock.mockReset();
    runConnectMock.mockReset().mockResolvedValue(undefined);
    resolveLocalServiceDemandMock.mockReset().mockResolvedValue({
      decision: "allow_auto_stop",
      hasLocalExecutionRoute: false,
      repairableReplyCandidateCount: 0,
      reason: "no local execution routes are available",
      localExecutionRouteCount: 0,
      projection: null,
    });
    listAccountSpaceIndexMock
      .mockReset()
      .mockResolvedValue({ pinnedItems: [], spaceItems: [] });
    listProfileSpaceHistoryMock.mockReset().mockResolvedValue([]);
    upsertProfileSpaceHistoryMock.mockReset().mockResolvedValue({ item: {} });
    listOpenMeldProfilesMock.mockReset().mockResolvedValue([
      {
        openMeldProfileId: HUMAN_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
        status: "active",
      },
    ]);
    listAgentTargetStatesMock.mockReset().mockResolvedValue([]);
    updateAgentRegistrationsMock.mockReset().mockResolvedValue(undefined);
    fetchSpaceRequestWithTimeoutMock
      .mockReset()
      .mockImplementation(
        (input: {
          url: string;
          init?: { method?: string; body?: unknown };
        }) => {
          const method = String(input.init?.method ?? "GET").toUpperCase();
          if (input.url.endsWith("/v1/spaces") && method === "POST") {
            return new Response(
              JSON.stringify({
                spaceId: CREATED_SPACE_ID,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            );
          }
          if (
            input.url.includes(`/v1/spaces/${CREATED_SPACE_ID}/meta`) &&
            method === "GET"
          ) {
            return new Response(
              JSON.stringify({
                spaceId: CREATED_SPACE_ID,
                organizationId: "org-1",
                visibility: "private",
                passwordProtected: false,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            );
          }
          if (
            input.url.includes(`/v1/spaces/${CREATED_SPACE_ID}/members`) &&
            method === "GET"
          ) {
            return new Response(
              JSON.stringify({
                spaceId: CREATED_SPACE_ID,
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
            );
          }
          if (input.url.includes("/cursors/") && method === "GET") {
            return new Response(JSON.stringify({}), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          if (input.url.includes("/cursors/") && method === "PATCH") {
            return new Response(
              JSON.stringify({ mentionAlias: "configured" }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            );
          }
          throw new Error(`Unexpected request: ${method} ${input.url}`);
        }
      );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(createAuthProbeResponse());
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("forwards join semantics through the human create-and-join fallback", async () => {
    const selectMessages: string[] = [];
    selectMock.mockImplementation((input: { message?: string }) => {
      const message = String(input.message ?? "");
      selectMessages.push(message);
      if (message.includes("No spaces yet")) {
        return "create";
      }
      if (message === "Organization visibility") {
        return "private";
      }
      if (message.includes("Set password protection now?")) {
        return "skip";
      }
      throw new Error(`Unexpected select prompt: ${message}`);
    });
    promptTextEntryMock
      .mockResolvedValueOnce({
        status: "submitted",
        value: "ops-room",
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: "",
      });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: HUMAN_PROFILE_ID,
          baseUrl: GATEWAY_URL,
          view: "human",
          allowPrompt: true,
          localEcho: true,
          historyLimit: 12,
          role: "Architect",
          mentionAlias: "ops-architect",
          rawStream: false,
          skipBringProfilesPrompt: true,
        });
      });
    });

    expect(runConnectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: HUMAN_PROFILE_ID,
        baseUrl: GATEWAY_URL,
        space: CREATED_SPACE_ID,
        localEcho: true,
        historyLimit: 12,
        role: "Architect",
        mentionAlias: "ops-architect",
        rawStream: false,
      })
    );
    expect(selectMessages).not.toContain(
      "Bring your agents or other profiles with you?"
    );
  });

  it("returns agent-view follow-up commands instead of opening post-create join", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "agent",
      resolvedView: "agent",
      interactive: false,
    });

    let stdout = "";
    await withTempHome(async () => {
      ({ stdout } = await withCapturedStdio(async () => {
        await runSpaceCreate({
          profile: AGENT_PROFILE_ID,
          baseUrl: GATEWAY_URL,
          name: "ops-room",
          visibility: "private",
          guide: "Keep decisions concise.",
          join: true,
          output: "ndjson",
          view: "agent",
          entryChecksHandled: true,
          postCreateJoin: {
            localEcho: false,
            historyLimit: 5,
            role: "Agent Architect",
            mentionAlias: "arch-bot",
            rawStream: true,
            skipBringProfilesPrompt: true,
            output: "ndjson",
            view: "agent",
          },
        });
      }));
    });

    expect(runConnectMock).not.toHaveBeenCalled();
    expect(parseAgentEnvelopeCodes(stdout)).not.toContain(
      "space.create.agent_overview"
    );
    expect(
      parseAgentEnvelope(stdout, "space.create.next_commands")
    ).toMatchObject({
      payload: {
        spaceId: CREATED_SPACE_ID,
        spaceUrl: `https://openmeld.invalid/o/acme/spaces/${CREATED_SPACE_ID}`,
        joinRequested: true,
        joinedByCreate: true,
        organization: {
          active: {
            id: "org-1",
            slug: "acme",
            name: "Acme",
          },
        },
        nextCommands: expect.arrayContaining([
          expect.stringContaining("space history"),
          expect.stringContaining("space send"),
        ]),
      },
    });
    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextEntryMock).not.toHaveBeenCalled();
  });

  it("does not forward agent-view post-create join output overrides", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "agent",
      resolvedView: "agent",
      interactive: false,
    });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceCreate({
          profile: AGENT_PROFILE_ID,
          baseUrl: GATEWAY_URL,
          name: "ops-room",
          visibility: "private",
          guide: "Keep decisions concise.",
          join: true,
          output: "ndjson",
          view: "agent",
          entryChecksHandled: true,
          postCreateJoin: {
            localEcho: false,
            historyLimit: 5,
            role: "Agent Architect",
            mentionAlias: "arch-bot",
            rawStream: true,
            skipBringProfilesPrompt: true,
            output: "text",
            view: "agent",
          },
        });
      });
    });

    expect(runConnectMock).not.toHaveBeenCalled();
  });

  it("propagates cancellation when post-create join is cancelled", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    runConnectMock.mockRejectedValueOnce(
      new Error(
        'HTTP 403: {"error":{"code":"space.password_invalid","message":"Invalid space password."}}'
      )
    );
    passwordPromptMock.mockResolvedValueOnce("__cancel__");

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await expect(
          runSpaceCreate({
            profile: HUMAN_PROFILE_ID,
            baseUrl: GATEWAY_URL,
            name: "ops-room",
            visibility: "private",
            guidePromptHandled: true,
            guide: undefined,
            password: "stale-pass",
            join: true,
            output: "text",
            view: "human",
            entryChecksHandled: true,
            postCreateJoin: {
              skipBringProfilesPrompt: true,
              output: "text",
              view: "human",
            },
          })
        ).resolves.toBe("cancelled");
      });
    });
  });
});

function parseAgentEnvelope(
  stdout: string,
  code: string
): Record<string, unknown> {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed.code === code) {
      return parsed;
    }
  }
  throw new Error(`Missing agent envelope ${code} in stdout: ${stdout}`);
}

function parseAgentEnvelopeCodes(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line) as { code?: unknown };
      } catch {
        return {};
      }
    })
    .map((envelope) => String(envelope.code ?? "").trim())
    .filter((code) => code.length > 0);
}
