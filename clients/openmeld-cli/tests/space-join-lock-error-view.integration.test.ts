import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenMeldLockError } from "../src/config/lock";
import { runSpaceJoin } from "../src/space/command";
import { withSilencedStdio, withTempHome } from "./helpers/fs";

const runConnectMock = vi.hoisted(() => vi.fn());
const resolveRuntimeContextMock = vi.hoisted(() => vi.fn());
const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const ensureCommandAuthenticationOrCancelMock = vi.hoisted(() => vi.fn());
const emitSpaceCommandPreflightMock = vi.hoisted(() => vi.fn());

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

const SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const LOCK_ERROR = new OpenMeldLockError({
  path: "/tmp/space-join.lock",
  key: "localhost_8080__space-id__profile-id",
  metaRaw:
    '{"pid":20012,"profile":"profile-id","sessionId":"terminal-ppid-69862","at":"2026-03-04T09:36:28.619Z"}',
});

vi.mock("@clack/prompts", () => {
  return {
    cancel: vi.fn(),
    confirm: vi.fn(),
    isCancel: vi.fn(() => false),
    password: vi.fn(),
    select: vi.fn(),
    text: vi.fn(),
  };
});

vi.mock("../src/runtime/context", () => {
  return {
    parseCliViewMode: vi.fn(),
    resolveRuntimeContext: (
      ...args: Parameters<typeof resolveRuntimeContextMock>
    ) => resolveRuntimeContextMock(...args),
  };
});

vi.mock("../src/auth/command-auth", async () => {
  const actual = await vi.importActual<
    typeof import("../src/auth/command-auth")
  >("../src/auth/command-auth");
  return {
    ...actual,
    ensureCommandAuthenticationOrCancel: (
      ...args: Parameters<typeof ensureCommandAuthenticationOrCancelMock>
    ) => ensureCommandAuthenticationOrCancelMock(...args),
  };
});

vi.mock("../src/space/connect", () => {
  return {
    runConnect: (...args: Parameters<typeof runConnectMock>) =>
      runConnectMock(...args),
  };
});

vi.mock("../src/space/preflight", () => ({
  emitSpaceCommandPreflight: (
    ...args: Parameters<typeof emitSpaceCommandPreflightMock>
  ) => emitSpaceCommandPreflightMock(...args),
  emitResolvedSpaceCommandPreflight: vi.fn(),
  emitSpaceFailureNextStep: vi.fn(),
  resolveSpaceFailureGuidance: vi.fn(),
}));

vi.mock("../src/space/join-access-bootstrap", () => {
  return {
    resolveSpaceJoinAccessBootstrap: vi.fn(async () => ({
      status: "ready" as const,
      publicSpace: true,
    })),
  };
});

vi.mock("../src/space/join-membership-bootstrap", () => {
  return {
    resolveSpaceJoinMembershipBootstrap: vi.fn(async () => ({
      status: "ready" as const,
    })),
  };
});

vi.mock("../src/space/join-role-alias-bootstrap", () => {
  return {
    resolveSpaceJoinRoleAliasBootstrap: vi.fn(async () => ({
      status: "ready" as const,
    })),
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

vi.mock("../src/config/resolve-openmeld-profile", () => {
  const profile = {
    openMeldProfileId: "agt-space-lock",
    profileName: "Codex",
    profileKind: "agent",
    status: "active",
    ownerUserId: "user-1",
    source: "cli_create",
    createdByUserId: "user-1",
    lastUsedAt: null,
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
  } as const;
  return {
    requireOpenMeldProfile: vi.fn(async () => profile),
    resolveOpenMeldProfileOrNull: vi.fn(async () => profile),
  };
});

describe("space join lock error view output", () => {
  beforeEach(() => {
    runConnectMock.mockReset();
    getAuthSessionStateMock.mockReset().mockResolvedValue(VALID_AUTH_STATE);
    ensureCommandAuthenticationOrCancelMock.mockReset().mockResolvedValue(true);
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
    resolveRuntimeContextMock.mockReset();
    resolveRuntimeContextMock.mockImplementation(
      async ({ view }: { view?: "auto" | "human" | "agent" }) => ({
        viewMode: view ?? "human",
        resolvedView: view === "agent" ? "agent" : "human",
        interactive: false,
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    getAuthSessionStateMock.mockReset();
    emitSpaceCommandPreflightMock.mockReset();
  });

  it("renders a human-readable guided message in human view", async () => {
    runConnectMock.mockRejectedValueOnce(LOCK_ERROR);

    let thrown: unknown = null;
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        thrown = await runSpaceJoin({
          profile: "agt-space-lock",
          view: "human",
          space: SPACE_ID,
          allowPrompt: false,
          role: "Space Engineer",
        }).catch((error) => error);
      });
    });

    expect(thrown).toBeInstanceOf(Error);
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    expect(message).toContain("🔒 Join blocked");
    expect(message).toContain(
      "Reason: This profile has already joined this space."
    );
    expect(message).toContain("✅ What to do now");
    expect(message).toContain("create a new profile or switch");
    expect(message).toContain("--view agent");
    expect(message).not.toContain("/tmp/space-join.lock");
    expect(message).not.toContain("Meta:");
  });

  it("keeps full raw lock diagnostics in agent view", async () => {
    runConnectMock.mockRejectedValueOnce(LOCK_ERROR);

    let thrown: unknown = null;
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        thrown = await runSpaceJoin({
          profile: "agt-space-lock",
          view: "agent",
          space: SPACE_ID,
          allowPrompt: false,
          role: "Space Engineer",
        }).catch((error) => error);
      });
    });

    expect(thrown).toBeInstanceOf(OpenMeldLockError);
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    expect(message).toContain("space is locked (/tmp/space-join.lock)");
    expect(message).toContain('"sessionId":"terminal-ppid-69862"');
    expect(message).toContain("Meta:");
    expect(message).not.toContain("🔒 Join blocked");
  });
});
