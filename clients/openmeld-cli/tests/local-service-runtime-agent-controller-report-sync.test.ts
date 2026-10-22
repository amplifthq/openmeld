import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  collectLocalAgentControllerInventoryMock,
  notifyRuntimeReportingAttemptObserverMock,
  submitRuntimeAgentControllerReportsMock,
} = vi.hoisted(() => ({
  collectLocalAgentControllerInventoryMock: vi.fn(),
  notifyRuntimeReportingAttemptObserverMock: vi.fn(
    async (observer, attempt) => await observer?.(attempt)
  ),
  submitRuntimeAgentControllerReportsMock: vi.fn(),
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
      collectLocalAgentControllerInventory: async (
        input: Parameters<typeof actual.collectLocalAgentControllerInventory>[0]
      ) => {
        const inventory = await collectLocalAgentControllerInventoryMock(input);
        for (const capability of inventory.capabilities) {
          await input?.onCapability?.(capability);
        }
        return inventory;
      },
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
    collectLocalAgentControllerInventoryMock.mockReset();
    notifyRuntimeReportingAttemptObserverMock.mockClear();
    submitRuntimeAgentControllerReportsMock.mockReset();
    submitRuntimeAgentControllerReportsMock.mockImplementation(
      async ({ reports }) =>
        reports.map((report: { reasonCodes: string[] }) => ({
          agentControllerReportStatus: "accepted",
          reasonCodes: report.reasonCodes,
          source: "runtime_reporting_api",
          status: "submitted",
        }))
    );
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
      // Bounded so one slow controller cannot delay every other report renewal.
      concurrency: 3,
      includeControllerInterface: true,
      localAdapterContainer,
      onCapability: expect.any(Function),
      reconcileNewRegistrations: true,
    });
    expect(submitRuntimeAgentControllerReportsMock).toHaveBeenCalledWith({
      reports: [
        {
          agentControllerRef: "builtin:codex",
          agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
          enabled: true,
          localParticipationState: "ready",
          reasonCodes: [],
        },
      ],
    });
    expect(submitRuntimeAgentControllerReportsMock).toHaveBeenCalledWith({
      reports: [
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
      status: "not_applicable",
    });
  });

  it("keeps a failed report visible when a later controller succeeds", async () => {
    collectLocalAgentControllerInventoryMock.mockResolvedValue({
      capabilities: ["codex", "claude-code"].map((agentId) => ({
        agentId,
        agentControllerRef: `builtin:${agentId}`,
        registered: true,
        enabled: true,
        blockerReasonCodes: [],
        launchability: "launchable",
        selectable: true,
        selectableReason: null,
      })),
    });
    const failed = {
      authenticationRejected: false,
      family: "runtime_agent_controller",
      message: "Report failed",
      reasonCode: "runtime.reporting.failed",
      status: "failed",
    };
    submitRuntimeAgentControllerReportsMock
      .mockImplementationOnce(async ({ onAttempt }) => {
        await onAttempt(failed);
        return [{ status: "failed", reasonCodes: [failed.reasonCode] }];
      })
      .mockImplementationOnce(async ({ onAttempt }) => {
        await onAttempt({
          ...failed,
          message: null,
          reasonCode: null,
          status: "succeeded",
        });
        return [
          {
            status: "submitted",
            agentControllerReportStatus: "accepted",
            reasonCodes: [],
          },
        ];
      });
    const onAttempt = vi.fn();
    const { syncLocalServiceRuntimeAgentControllerReports } = await import(
      "../src/local-service/reporting/runtime-agent-controller-report-sync"
    );
    await syncLocalServiceRuntimeAgentControllerReports({
      localAdapterContainer: {} as never,
      onAttempt,
    });
    expect(onAttempt).toHaveBeenLastCalledWith(failed);
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
      status: "failed",
    });
  });
});
