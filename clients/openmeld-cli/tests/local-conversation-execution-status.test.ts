import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLocalConversationExecutionStatus } from "../src/local-service/control-plane/conversation-execution-status";

const loadLedgerStateMock = vi.hoisted(() => vi.fn());
const ensureDaemonRuntimePathsMock = vi.hoisted(() => vi.fn());
const buildLedgerPathsMock = vi.hoisted(() => vi.fn());
const createLedgerIoMock = vi.hoisted(() => vi.fn());
const resolveCompatibleAgentContextMatchMock = vi.hoisted(() => vi.fn());
const resolveCompatibleConversationExecutionStateMock = vi.hoisted(() =>
  vi.fn()
);
const readLocalEnabledControllersMock = vi.hoisted(() => vi.fn());
const resolveProfileWorkspaceRuntimeMock = vi.hoisted(() => vi.fn());
const verifyCodexAppServerThreadMock = vi.hoisted(() => vi.fn());
const resolveCodexTimeoutMsMock = vi.hoisted(() => vi.fn(() => null));
const buildRuntimeWorkspaceFingerprintMock = vi.hoisted(() =>
  vi.fn(() => "sha256:workspace-a")
);

vi.mock("@openmeld/local-execution", async () => {
  const actual = await vi.importActual<
    typeof import("@openmeld/local-execution")
  >("@openmeld/local-execution");
  return {
    ...actual,
    buildRuntimeWorkspaceFingerprint: (
      ...args: Parameters<typeof buildRuntimeWorkspaceFingerprintMock>
    ) => buildRuntimeWorkspaceFingerprintMock(...args),
    loadLedgerState: (...args: Parameters<typeof loadLedgerStateMock>) =>
      loadLedgerStateMock(...args),
  };
});

vi.mock("../src/local-service/state/daemon-device-id", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/state/daemon-device-id")
  >("../src/local-service/state/daemon-device-id");
  return {
    ...actual,
    buildLedgerPaths: (...args: Parameters<typeof buildLedgerPathsMock>) =>
      buildLedgerPathsMock(...args),
    ensureDaemonRuntimePaths: (
      ...args: Parameters<typeof ensureDaemonRuntimePathsMock>
    ) => ensureDaemonRuntimePathsMock(...args),
  };
});

vi.mock("../src/local-service/state/ledger-io", () => ({
  createLedgerIo: (...args: Parameters<typeof createLedgerIoMock>) =>
    createLedgerIoMock(...args),
}));

vi.mock("@openmeld/local-service", async () => {
  const actual = await vi.importActual<
    typeof import("@openmeld/local-service")
  >("@openmeld/local-service");
  return {
    ...actual,
    resolveCompatibleAgentContextMatch: (
      ...args: Parameters<typeof resolveCompatibleAgentContextMatchMock>
    ) => resolveCompatibleAgentContextMatchMock(...args),
    resolveCompatibleConversationExecutionState: (
      ...args: Parameters<
        typeof resolveCompatibleConversationExecutionStateMock
      >
    ) => resolveCompatibleConversationExecutionStateMock(...args),
  };
});

vi.mock("../src/local-service/routing/resolve-controller-support", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/routing/resolve-controller-support")
  >("../src/local-service/routing/resolve-controller-support");
  return {
    ...actual,
    readLocalEnabledControllers: (
      ...args: Parameters<typeof readLocalEnabledControllersMock>
    ) => readLocalEnabledControllersMock(...args),
  };
});

vi.mock("../src/profile-workspace/runtime-resolution", () => ({
  resolveProfileWorkspaceRuntime: (
    ...args: Parameters<typeof resolveProfileWorkspaceRuntimeMock>
  ) => resolveProfileWorkspaceRuntimeMock(...args),
}));

vi.mock("@openmeld/adapter-codex", () => ({
  resolveCodexTimeoutMs: () => resolveCodexTimeoutMsMock(),
  verifyCodexAppServerThread: (
    ...args: Parameters<typeof verifyCodexAppServerThreadMock>
  ) => verifyCodexAppServerThreadMock(...args),
}));

const SPACE_ID =
  "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b";
const PROFILE_ID = "agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c";
const THREAD_ID = "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8";
const INVALID_THREAD_ID = "invalid-thread-id";
const CLAUDE_CONVERSATION_ID = "session-valid-123";

describe("local conversation execution status", () => {
  afterEach(() => {
    loadLedgerStateMock.mockReset();
    ensureDaemonRuntimePathsMock.mockReset();
    buildLedgerPathsMock.mockReset();
    createLedgerIoMock.mockReset();
    resolveCompatibleAgentContextMatchMock.mockReset();
    resolveCompatibleConversationExecutionStateMock.mockReset();
    readLocalEnabledControllersMock.mockReset();
    resolveProfileWorkspaceRuntimeMock.mockReset();
    verifyCodexAppServerThreadMock.mockReset();
    resolveCodexTimeoutMsMock.mockClear();
    buildRuntimeWorkspaceFingerprintMock.mockClear();
  });

  it("returns a failed Codex App Server thread proof for an invalid thread id", async () => {
    createLedgerIoMock.mockReturnValue({});
    ensureDaemonRuntimePathsMock.mockResolvedValue({
      ledgerRootPath: "/tmp/ledger",
    });
    buildLedgerPathsMock.mockReturnValue({ statePath: "/tmp/ledger.json" });
    loadLedgerStateMock.mockResolvedValue({});
    resolveCompatibleAgentContextMatchMock.mockReturnValue({
      agentContext: {
        agentControllerConversationId: INVALID_THREAD_ID,
      },
      agentContextLookupKey:
        "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b|agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c|builtin%3Acodex|codex-app-server|sha256%3Aworkspace-a",
    });
    resolveCompatibleConversationExecutionStateMock.mockReturnValue({
      activeContextId: INVALID_THREAD_ID,
      agentContextLookupKey:
        "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b|agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c|builtin%3Acodex|codex-app-server|sha256%3Aworkspace-a",
      dispatchesSinceBootstrapApplied: 0,
      lastRuntimeWorkspacePath: "/tmp/openmeld-agent",
      runtimeWorkspaceFingerprint: "sha256:workspace-a",
      updatedAt: "2026-04-14T00:00:00.000Z",
    });
    readLocalEnabledControllersMock.mockResolvedValue(
      new Map([
        [
          "builtin:codex",
          {
            enabled: true,
            launchContract: {
              commandPath: "/usr/local/bin/codex",
            },
          },
        ],
      ])
    );
    resolveProfileWorkspaceRuntimeMock.mockResolvedValue({
      configPath: "/tmp/profile-workspace.json",
      configuredWorkspacePath: "/tmp/openmeld-agent",
      effectiveRuntimeWorkingDirectory: "/tmp/openmeld-agent",
      runtimeContext: {
        providerRuntimeWorkingDirectory: "/tmp/openmeld-agent",
      },
      status: "ready",
      workspaceMode: "openmeld_managed",
    });
    verifyCodexAppServerThreadMock.mockRejectedValue(
      Object.assign(new Error("cannot resume thread invalid-thread-id"), {
        code: "context_not_found",
        errorType: "provider",
      })
    );

    const result = await resolveLocalConversationExecutionStatus({
      agentControllerConversationId: INVALID_THREAD_ID,
      boundAgentControllerRef: "builtin:codex",
      agentControllerRef: "builtin:codex",
      spaceId: SPACE_ID,
      targetProfileId: PROFILE_ID,
      transportMode: "codex-app-server",
      validate: true,
    });

    expect(result.controllerLaunchStatus).toBe("ready");
    expect(result.localRuntimeContext.status).toBe("ready");
    expect(result.providerConversationProof.status).toBe("failed");
    expect(result.providerConversationProof.errorCode).toBe(
      "context_not_found"
    );
    expect(result.runtimeWorkspace.fingerprint).toBe("sha256:workspace-a");
    expect(verifyCodexAppServerThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        codexTimeoutMs: 30_000,
        threadId: INVALID_THREAD_ID,
      })
    );
    expect(
      verifyCodexAppServerThreadMock.mock.calls[0]?.[0]
    ).not.toHaveProperty("prompt");
    expect(loadLedgerStateMock).toHaveBeenCalledWith({
      invalidStateStrategy: "backup_and_reset",
      io: {},
      paths: { statePath: "/tmp/ledger.json" },
    });
  });

  it("marks Claude provider conversation proof not applicable without probing", async () => {
    createLedgerIoMock.mockReturnValue({});
    ensureDaemonRuntimePathsMock.mockResolvedValue({
      ledgerRootPath: "/tmp/ledger",
    });
    buildLedgerPathsMock.mockReturnValue({ statePath: "/tmp/ledger.json" });
    loadLedgerStateMock.mockResolvedValue({});
    resolveCompatibleAgentContextMatchMock.mockReturnValue({
      agentContext: {
        agentControllerConversationId: CLAUDE_CONVERSATION_ID,
      },
      agentContextLookupKey:
        "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b|agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c|builtin%3Aclaude-code|local-cli|sha256%3Aworkspace-a",
    });
    resolveCompatibleConversationExecutionStateMock.mockReturnValue({
      activeContextId: CLAUDE_CONVERSATION_ID,
      agentContextLookupKey:
        "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b|agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c|builtin%3Aclaude-code|local-cli|sha256%3Aworkspace-a",
      dispatchesSinceBootstrapApplied: 0,
      lastRuntimeWorkspacePath: "/tmp/openmeld-agent",
      runtimeWorkspaceFingerprint: "sha256:workspace-a",
      updatedAt: "2026-04-14T00:00:00.000Z",
    });
    readLocalEnabledControllersMock.mockResolvedValue(
      new Map([
        [
          "builtin:claude-code",
          {
            enabled: true,
            launchContract: {
              commandPath: "/usr/local/bin/claude",
            },
          },
        ],
      ])
    );
    resolveProfileWorkspaceRuntimeMock.mockResolvedValue({
      configPath: "/tmp/profile-workspace.json",
      configuredWorkspacePath: "/tmp/openmeld-agent",
      effectiveRuntimeWorkingDirectory: "/tmp/openmeld-agent",
      runtimeContext: {
        providerRuntimeWorkingDirectory: "/tmp/openmeld-agent",
      },
      status: "ready",
      workspaceMode: "openmeld_managed",
    });
    const result = await resolveLocalConversationExecutionStatus({
      agentControllerConversationId: CLAUDE_CONVERSATION_ID,
      boundAgentControllerRef: "builtin:claude-code",
      agentControllerRef: "builtin:claude-code",
      spaceId: SPACE_ID,
      targetProfileId: PROFILE_ID,
      transportMode: "local-cli",
      validate: true,
    });

    expect(result.controllerLaunchStatus).toBe("ready");
    expect(result.localRuntimeContext.status).toBe("ready");
    expect(result.providerConversationProof.status).toBe("not_applicable");
    expect(result.providerConversationProof.provider).toBe("claude-code");
    expect(result.providerConversationProof.method).toBeNull();
    expect(verifyCodexAppServerThreadMock).not.toHaveBeenCalled();
  });

  it("marks non-App-Server Codex provider conversation proof not applicable", async () => {
    createLedgerIoMock.mockReturnValue({});
    ensureDaemonRuntimePathsMock.mockResolvedValue({
      ledgerRootPath: "/tmp/ledger",
    });
    buildLedgerPathsMock.mockReturnValue({ statePath: "/tmp/ledger.json" });
    loadLedgerStateMock.mockResolvedValue({});
    resolveCompatibleAgentContextMatchMock.mockReturnValue({
      agentContext: {
        agentControllerConversationId: THREAD_ID,
      },
      agentContextLookupKey:
        "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b|agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c|builtin%3Acodex|local-cli|sha256%3Aworkspace-a",
    });
    resolveCompatibleConversationExecutionStateMock.mockReturnValue({
      activeContextId: THREAD_ID,
      agentContextLookupKey:
        "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b|agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c|builtin%3Acodex|local-cli|sha256%3Aworkspace-a",
      dispatchesSinceBootstrapApplied: 0,
      lastRuntimeWorkspacePath: "/tmp/openmeld-agent",
      runtimeWorkspaceFingerprint: "sha256:workspace-a",
      updatedAt: "2026-04-14T00:00:00.000Z",
    });
    readLocalEnabledControllersMock.mockResolvedValue(
      new Map([
        [
          "builtin:codex",
          {
            enabled: true,
            launchContract: {
              commandPath: "/usr/local/bin/codex",
            },
          },
        ],
      ])
    );
    resolveProfileWorkspaceRuntimeMock.mockResolvedValue({
      configPath: "/tmp/profile-workspace.json",
      configuredWorkspacePath: "/tmp/openmeld-agent",
      effectiveRuntimeWorkingDirectory: "/tmp/openmeld-agent",
      runtimeContext: {
        providerRuntimeWorkingDirectory: "/tmp/openmeld-agent",
      },
      status: "ready",
      workspaceMode: "openmeld_managed",
    });

    const result = await resolveLocalConversationExecutionStatus({
      agentControllerConversationId: THREAD_ID,
      boundAgentControllerRef: "builtin:claude-code",
      agentControllerRef: "builtin:codex",
      spaceId: SPACE_ID,
      targetProfileId: PROFILE_ID,
      transportMode: "local-cli",
      validate: true,
    });

    expect(result.providerConversationProof.status).toBe("not_applicable");
    expect(result.providerConversationProof.errorCode).toBeNull();
    expect(verifyCodexAppServerThreadMock).not.toHaveBeenCalled();
  });
});
