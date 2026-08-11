import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  notifyRuntimeReportingAttemptObserverMock,
  resolveLocalProviderConversationProofMock,
  resolveProfileWorkspaceRuntimeMock,
  submitRuntimeProviderConversationProofsMock,
} = vi.hoisted(() => ({
  notifyRuntimeReportingAttemptObserverMock: vi.fn(
    async (observer, attempt) => await observer?.(attempt)
  ),
  resolveLocalProviderConversationProofMock: vi.fn(),
  resolveProfileWorkspaceRuntimeMock: vi.fn(),
  submitRuntimeProviderConversationProofsMock: vi.fn(),
}));

vi.mock("../src/profile-workspace/runtime-resolution", () => ({
  resolveProfileWorkspaceRuntime: (
    ...args: Parameters<typeof resolveProfileWorkspaceRuntimeMock>
  ) => resolveProfileWorkspaceRuntimeMock(...args),
}));

vi.mock(
  "../src/local-service/control-plane/conversation-execution-status",
  () => ({
    resolveLocalProviderConversationProof:
      resolveLocalProviderConversationProofMock,
  })
);

vi.mock(
  "../src/local-service/reporting/runtime-agent-controller-reporting-submission",
  () => ({
    notifyRuntimeReportingAttemptObserver:
      notifyRuntimeReportingAttemptObserverMock,
    submitRuntimeProviderConversationProofs:
      submitRuntimeProviderConversationProofsMock,
  })
);

describe("local service provider conversation proof sync", () => {
  beforeEach(() => {
    notifyRuntimeReportingAttemptObserverMock.mockClear();
    resolveLocalProviderConversationProofMock.mockReset();
    resolveProfileWorkspaceRuntimeMock.mockReset();
    submitRuntimeProviderConversationProofsMock.mockReset();
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
    resolveLocalProviderConversationProofMock.mockResolvedValue({
      agentControllerConversationId: "thread_1",
      checkedAt: "2026-06-06T07:00:00.000Z",
      errorCode: null,
      errorMessage: null,
      errorType: null,
      expiresAt: "2026-06-06T07:10:00.000Z",
      intrusive: false,
      method: "codex_app_server_thread_resume",
      provider: "codex",
      status: "passed",
      transportMode: "codex-app-server",
    });
    submitRuntimeProviderConversationProofsMock.mockResolvedValue([
      {
        agentProfileId: "agt_codex",
        bindingId: "binding_1",
        providerConversationProofStatus: "accepted",
        reasonCodes: [],
        source: "runtime_reporting_api",
        status: "submitted",
      },
    ]);
  });

  it("submits Codex App Server thread proof evidence for accepted routes", async () => {
    const { syncLocalServiceProviderConversationProofs } = await import(
      "../src/local-service/reporting/provider-conversation-proof-sync"
    );

    await expect(
      syncLocalServiceProviderConversationProofs({
        routeCatalog: {
          routeByProfileId: new Map([
            [
              "agt_codex",
              {
                agentControllerConversationId: "thread_1",
                agentControllerRef: "builtin:codex",
                bindingId: "binding_1",
                launchContract: {
                  commandPath: "/tmp/codex",
                  kind: "executable",
                },
                profileId: "agt_codex",
                transportMode: "codex-app-server",
              },
            ],
          ]),
        } as never,
      })
    ).resolves.toEqual({
      failedCount: 0,
      proofCount: 1,
      reasonCodes: [],
      status: "submitted",
      submittedCount: 1,
    });
    expect(resolveLocalProviderConversationProofMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentControllerConversationId: "thread_1",
        boundAgentControllerRef: "builtin:codex",
        profileAgentControllerRef: "builtin:codex",
        runtimeWorkingDirectory: "/tmp/openmeld-agent",
        transportMode: "codex-app-server",
      })
    );
    expect(submitRuntimeProviderConversationProofsMock).toHaveBeenCalledWith({
      proofs: [
        {
          agentProfileId: "agt_codex",
          bindingId: "binding_1",
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: "thread_1",
          transportMode: "codex-app-server",
          provider: "codex",
          method: "codex_app_server_thread_resume",
          intrusive: false,
          observedAtMs: Date.parse("2026-06-06T07:00:00.000Z"),
          expiresAtMs: Date.parse("2026-06-06T07:10:00.000Z"),
          status: "passed",
        },
      ],
    });
  });

  it("skips sync when no Codex App Server route has a provider conversation", async () => {
    const onAttempt = vi.fn(async () => undefined);
    const { syncLocalServiceProviderConversationProofs } = await import(
      "../src/local-service/reporting/provider-conversation-proof-sync"
    );

    await expect(
      syncLocalServiceProviderConversationProofs({
        onAttempt,
        routeCatalog: {
          routeByProfileId: new Map([
            [
              "agt_claude",
              {
                agentControllerConversationId: "session_1",
                agentControllerRef: "builtin:claude-code",
                bindingId: "binding_2",
                launchContract: {
                  commandPath: "/tmp/claude",
                  kind: "executable",
                },
                profileId: "agt_claude",
                transportMode: "local-cli",
              },
            ],
          ]),
        } as never,
      })
    ).resolves.toEqual({
      failedCount: 0,
      proofCount: 0,
      reasonCodes: ["provider_conversation.proof.no_applicable_routes"],
      status: "skipped",
      submittedCount: 0,
    });
    expect(resolveLocalProviderConversationProofMock).not.toHaveBeenCalled();
    expect(submitRuntimeProviderConversationProofsMock).not.toHaveBeenCalled();
    expect(onAttempt).toHaveBeenCalledWith({
      authenticationRejected: false,
      family: "provider_conversation_proof",
      message: null,
      reasonCode: "provider_conversation.proof.no_applicable_routes",
      requiresCarrierHandshake: false,
      status: "not_applicable",
    });
  });

  it("reports proof collection failures to the health observer before rethrowing", async () => {
    resolveProfileWorkspaceRuntimeMock.mockRejectedValue(
      new Error("workspace lookup exposed private details")
    );
    const onAttempt = vi.fn(async () => undefined);
    const { syncLocalServiceProviderConversationProofs } = await import(
      "../src/local-service/reporting/provider-conversation-proof-sync"
    );

    await expect(
      syncLocalServiceProviderConversationProofs({
        onAttempt,
        routeCatalog: {
          routeByProfileId: new Map([
            [
              "agt_codex",
              {
                agentControllerConversationId: "thread_1",
                agentControllerRef: "builtin:codex",
                bindingId: "binding_1",
                launchContract: {
                  commandPath: "/tmp/codex",
                  kind: "executable",
                },
                profileId: "agt_codex",
                transportMode: "codex-app-server",
              },
            ],
          ]),
        } as never,
      })
    ).rejects.toThrow("workspace lookup exposed private details");
    expect(onAttempt).toHaveBeenCalledWith({
      authenticationRejected: false,
      family: "provider_conversation_proof",
      message: "Provider conversation proof collection failed.",
      reasonCode: "provider_conversation.runtime_reporting.collection_failed",
      requiresCarrierHandshake: false,
      status: "failed",
    });
  });
});
