import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  reconcileControllersMock,
  collectLocalAgentControllerInventoryMock,
  notifyRuntimeReportingAttemptObserverMock,
  submitRuntimeAgentControllerReportsMock,
} = vi.hoisted(() => ({
  reconcileControllersMock: vi.fn(async () => undefined),
  collectLocalAgentControllerInventoryMock: vi.fn(),
  notifyRuntimeReportingAttemptObserverMock: vi.fn(
    async (observer, attempt) => await observer?.(attempt)
  ),
  submitRuntimeAgentControllerReportsMock: vi.fn(),
}));

vi.mock("../src/agents/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/agents/registry")>()),
  reconcileNewRunnableBuiltinAgentRegistrations: reconcileControllersMock,
}));

vi.mock(
  "../src/local-service/inventory/agent-controller-inventory",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../src/local-service/inventory/agent-controller-inventory")
      >();
    return {
      ...actual,
      collectLocalAgentControllerInventory:
        collectLocalAgentControllerInventoryMock,
    };
  }
);

vi.mock(
  "../src/local-service/reporting/runtime-agent-controller-reporting-submission",
  () => ({
    notifyRuntimeReportingAttemptObserver:
      notifyRuntimeReportingAttemptObserverMock,
    submitRuntimeAgentControllerReports:
      submitRuntimeAgentControllerReportsMock,
  })
);

describe("local service runtime agent controller report sync", () => {
  const CODEX_AGENT_CONTROLLER_INTERFACE = {
    agentControllerRef: "builtin:codex",
    auth: { status: "authenticated", label: "Signed in" },
    capabilities: {
      approvals: true,
      cancel: true,
      interrupt: true,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: false,
    },
    checkedAt: "2026-06-28T00:00:00.000Z",
    controllerId: "codex",
    displayName: "Codex",
    launch: {
      argsPrefix: [],
      commandPath: "/usr/local/bin/codex",
      installChoiceCount: 1,
      status: "ready",
    },
    message: null,
    models: [{ id: "gpt-5.5", displayName: "GPT-5.5" }],
    nativeInterface: "codex-app-server",
    schemaVersion: 1,
    skills: [],
    status: "ready",
    version: "0.1.0",
  };

  beforeEach(() => {
    reconcileControllersMock.mockClear();
    collectLocalAgentControllerInventoryMock.mockReset();
    notifyRuntimeReportingAttemptObserverMock.mockClear();
    submitRuntimeAgentControllerReportsMock.mockReset();
    submitRuntimeAgentControllerReportsMock.mockResolvedValue([
      {
        agentControllerReportStatus: "accepted",
        reasonCodes: [],
        source: "runtime_reporting_api",
        status: "submitted",
      },
      {
        agentControllerReportStatus: "accepted",
        reasonCodes: ["local_agent_preparation.not_enabled"],
        source: "runtime_reporting_api",
        status: "submitted",
      },
    ]);
  });

  it("submits registered LocalAgentControllerInventory capabilities as runtime evidence", async () => {
    collectLocalAgentControllerInventoryMock.mockResolvedValue({
      capabilities: [
        {
          agentId: "codex",
          agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
          blockerReasonCodes: [],
          agentControllerRef: "builtin:codex",
          enabled: true,
          launchability: "launchable",
          registered: true,
          selectable: true,
          selectableReason: null,
        },
        {
          agentId: "claude-code",
          blockerReasonCodes: [],
          agentControllerRef: "builtin:claude-code",
          enabled: false,
          launchability: "launchable",
          registered: true,
          selectable: true,
          selectableReason: null,
        },
        {
          agentId: "openclaw",
          blockerReasonCodes: [],
          agentControllerRef: "builtin:openclaw",
          enabled: true,
          launchability: "launchable",
          registered: false,
          selectable: true,
          selectableReason: null,
        },
      ],
    });
    const localAdapterContainer = { marker: "container" };
    const { syncLocalServiceRuntimeAgentControllerReports } = await import(
      "../src/local-service/reporting/runtime-agent-controller-report-sync"
    );

    await expect(
      syncLocalServiceRuntimeAgentControllerReports({
        localAdapterContainer: localAdapterContainer as never,
      })
    ).resolves.toEqual({
      failedCount: 0,
      reasonCodes: ["local_agent_preparation.not_enabled"],
      reportCount: 2,
      status: "submitted",
      submittedCount: 2,
    });
    expect(collectLocalAgentControllerInventoryMock).toHaveBeenCalledWith({
      includeControllerInterface: true,
      localAdapterContainer,
    });
    expect(reconcileControllersMock).toHaveBeenCalledWith();
    const [inventoryOrder] =
      collectLocalAgentControllerInventoryMock.mock.invocationCallOrder;
    if (inventoryOrder === undefined) {
      throw new Error("Controller inventory was not collected");
    }
    expect(reconcileControllersMock.mock.invocationCallOrder[0]).toBeLessThan(
      inventoryOrder
    );
    expect(submitRuntimeAgentControllerReportsMock).toHaveBeenCalledWith({
      reports: [
        {
          agentControllerRef: "builtin:codex",
          agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
          enabled: true,
          localParticipationState: "ready",
          reasonCodes: [],
        },
        {
          agentControllerRef: "builtin:claude-code",
          enabled: false,
          localParticipationState: "needs_agent_prepare",
          reasonCodes: ["local_agent_preparation.not_enabled"],
        },
      ],
    });
  });

  it("does not report ready when a registered controller is not signed in", async () => {
    const unauthenticatedControllerInterface = {
      ...CODEX_AGENT_CONTROLLER_INTERFACE,
      auth: { status: "unauthenticated", label: "Not signed in" },
      message: "Sign in to Codex.",
      status: "error",
    };
    collectLocalAgentControllerInventoryMock.mockResolvedValue({
      capabilities: [
        {
          agentId: "codex",
          agentControllerInterface: unauthenticatedControllerInterface,
          blockerReasonCodes: [],
          agentControllerRef: "builtin:codex",
          enabled: true,
          launchability: "launchable",
          registered: true,
          selectable: true,
          selectableReason: null,
        },
      ],
    });
    submitRuntimeAgentControllerReportsMock.mockResolvedValueOnce([
      {
        agentControllerReportStatus: "accepted",
        reasonCodes: [
          "provider_account.access_required",
          "controller.auth.unauthenticated",
        ],
        source: "runtime_reporting_api",
        status: "submitted",
      },
    ]);
    const { syncLocalServiceRuntimeAgentControllerReports } = await import(
      "../src/local-service/reporting/runtime-agent-controller-report-sync"
    );

    await expect(
      syncLocalServiceRuntimeAgentControllerReports({
        localAdapterContainer: {} as never,
      })
    ).resolves.toEqual({
      failedCount: 0,
      reasonCodes: [
        "provider_account.access_required",
        "controller.auth.unauthenticated",
      ],
      reportCount: 1,
      status: "submitted",
      submittedCount: 1,
    });
    expect(submitRuntimeAgentControllerReportsMock).toHaveBeenCalledWith({
      reports: [
        {
          agentControllerRef: "builtin:codex",
          agentControllerInterface: unauthenticatedControllerInterface,
          enabled: true,
          localParticipationState: "needs_agent_prepare",
          reasonCodes: [
            "provider_account.access_required",
            "controller.auth.unauthenticated",
          ],
        },
      ],
    });
  });

  it("skips sync when no registered local execution target exists and reports not_applicable to the health observer", async () => {
    collectLocalAgentControllerInventoryMock.mockResolvedValue({
      capabilities: [
        {
          agentId: "codex",
          blockerReasonCodes: [],
          agentControllerRef: "builtin:codex",
          enabled: true,
          launchability: "launchable",
          registered: false,
          selectable: true,
          selectableReason: null,
        },
      ],
    });
    const onAttempt = vi.fn(async () => undefined);
    const { syncLocalServiceRuntimeAgentControllerReports } = await import(
      "../src/local-service/reporting/runtime-agent-controller-report-sync"
    );

    await expect(
      syncLocalServiceRuntimeAgentControllerReports({
        localAdapterContainer: {} as never,
        onAttempt,
      })
    ).resolves.toEqual({
      failedCount: 0,
      reasonCodes: ["runtime.agent_controller_report.no_local_controllers"],
      reportCount: 0,
      status: "skipped",
      submittedCount: 0,
    });
    expect(submitRuntimeAgentControllerReportsMock).not.toHaveBeenCalled();
    expect(onAttempt).toHaveBeenCalledWith({
      authenticationRejected: false,
      family: "runtime_agent_controller",
      message: "No local controllers are installed on this computer.",
      reasonCode: "runtime.agent_controller_report.no_local_controllers",
      requiresCarrierHandshake: false,
      status: "not_applicable",
    });
  });

  it("reports inventory failures to the health observer before rethrowing", async () => {
    collectLocalAgentControllerInventoryMock.mockRejectedValue(
      new Error("inventory scan exposed private details")
    );
    const onAttempt = vi.fn(async () => undefined);
    const { syncLocalServiceRuntimeAgentControllerReports } = await import(
      "../src/local-service/reporting/runtime-agent-controller-report-sync"
    );

    await expect(
      syncLocalServiceRuntimeAgentControllerReports({
        localAdapterContainer: {} as never,
        onAttempt,
      })
    ).rejects.toThrow("inventory scan exposed private details");
    expect(onAttempt).toHaveBeenCalledWith({
      authenticationRejected: false,
      family: "runtime_agent_controller",
      message: "Local agent inventory collection failed.",
      reasonCode: "runtime.reporting.inventory_failed",
      requiresCarrierHandshake: false,
      status: "failed",
    });
  });
});
