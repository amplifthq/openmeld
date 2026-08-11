import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StartReadinessSnapshot } from "../src/start-local/readiness-types";

const {
  collectLocalAgentControllerInventoryMock,
  submitRuntimeAgentControllerReportsMock,
} = vi.hoisted(() => ({
  collectLocalAgentControllerInventoryMock: vi.fn(),
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
      collectLocalAgentControllerInventory:
        collectLocalAgentControllerInventoryMock,
    };
  }
);

vi.mock(
  "../src/local-service/reporting/runtime-agent-controller-reporting-submission",
  () => ({
    submitRuntimeAgentControllerReports:
      submitRuntimeAgentControllerReportsMock,
  })
);

const READY_READINESS: StartReadinessSnapshot = {
  auth: {
    status: "valid",
    email: null,
    authBaseUrl: null,
    gatewayUrl: "https://gateway.openmeld.test",
  },
  skills: {
    status: "up_to_date",
    targetCount: 1,
    summary: {
      upToDate: 1,
      outdated: 0,
      missing: 0,
      externalConflict: 0,
    },
  },
  agents: {
    status: "ok",
    totalBuiltins: 1,
    detectedSupported: 1,
    needsChoice: 0,
    needsRepair: 0,
    detectedNotSupportedYet: 0,
    notDetected: 0,
    candidates: [
      {
        agentId: "codex",
        detected: true,
        displayName: "Codex",
        enabled: true,
        lifecycleStatus: "active",
        launchStatus: "ready",
        selectable: true,
        selectableReason: null,
      },
    ],
  },
  service: {
    status: "installed_current",
    installedVersion: "0.2.9",
    expectedVersion: "0.2.9",
    runtime: {
      status: "running",
      autoStart: true,
      managedBySystemService: true,
      mode: "background",
      pid: 123,
      serviceController: "launchd",
      startedAt: "2026-04-08T00:00:00.000Z",
      updatedAt: "2026-04-08T00:00:00.000Z",
    },
  },
};

describe("selected Agent Controller reporting", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    collectLocalAgentControllerInventoryMock.mockResolvedValue({
      capabilities: [],
    });
    submitRuntimeAgentControllerReportsMock.mockResolvedValue([
      {
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
    ]);
  });

  it("reports selected Agent Controllers without requiring Agent Profile Binding truth", async () => {
    const { submitSelectedAgentControllerReports } = await import(
      "../src/local-service/reporting/selected-agent-controller-reporting"
    );

    const result = await submitSelectedAgentControllerReports({
      readiness: READY_READINESS,
      localAgentIds: ["codex"],
    });

    expect(submitRuntimeAgentControllerReportsMock).toHaveBeenCalledWith({
      reports: [
        {
          agentControllerRef: "builtin:codex",
          localParticipationState: "ready",
          reasonCodes: [],
        },
      ],
    });
    expect(result).toEqual([
      {
        agentId: "codex",
        agentControllerRef: "builtin:codex",
        localParticipationState: "ready",
        reasonCodes: [],
        runtimeReportSubmission: expect.objectContaining({
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime_opaque_1",
          status: "submitted",
        }),
      },
    ]);
  });

  it("submits multiple selected Agent Controllers in one Agent Controller report batch", async () => {
    submitRuntimeAgentControllerReportsMock.mockResolvedValueOnce([
      {
        agentControllerRef: "builtin:claude",
        agentControllerReportStatus: "accepted",
        deviceId: "device-1",
        lane: "dev-local",
        reasonCodes: [],
        registrationStatus: "reused",
        openMeldServiceRuntimeId: "runtime_opaque_1",
        source: "runtime_reporting_api",
        status: "submitted",
      },
      {
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
    ]);
    const { submitSelectedAgentControllerReports } = await import(
      "../src/local-service/reporting/selected-agent-controller-reporting"
    );
    const codexCandidate = READY_READINESS.agents.candidates[0];
    if (!codexCandidate) {
      throw new Error("test fixture is missing the local Codex candidate");
    }

    const result = await submitSelectedAgentControllerReports({
      readiness: {
        ...READY_READINESS,
        agents: {
          ...READY_READINESS.agents,
          detectedSupported: 2,
          totalBuiltins: 2,
          candidates: [
            codexCandidate,
            {
              ...codexCandidate,
              agentId: "claude",
              displayName: "Claude",
            },
          ],
        },
      },
      localAgentIds: ["codex", "claude", "codex"],
    });

    expect(submitRuntimeAgentControllerReportsMock).toHaveBeenCalledTimes(1);
    expect(submitRuntimeAgentControllerReportsMock).toHaveBeenCalledWith({
      reports: [
        {
          agentControllerRef: "builtin:claude",
          localParticipationState: "ready",
          reasonCodes: [],
        },
        {
          agentControllerRef: "builtin:codex",
          localParticipationState: "ready",
          reasonCodes: [],
        },
      ],
    });
    expect(result.map((item) => item.agentId)).toEqual(["claude", "codex"]);
  });

  it("does not report fallback ready when the selected local capability is missing", async () => {
    const { submitSelectedAgentControllerReports } = await import(
      "../src/local-service/reporting/selected-agent-controller-reporting"
    );

    await submitSelectedAgentControllerReports({
      readiness: {
        ...READY_READINESS,
        agents: {
          ...READY_READINESS.agents,
          candidates: [],
        },
      },
      localAgentIds: ["codex"],
    });

    expect(submitRuntimeAgentControllerReportsMock).toHaveBeenCalledWith({
      reports: [
        {
          agentControllerRef: "builtin:codex",
          localParticipationState: "needs_agent_prepare",
          reasonCodes: ["local_agent_preparation.not_found"],
        },
      ],
    });
  });

  it("fails closed when selected controller ACI proves the provider account is not signed in", async () => {
    const agentControllerInterface = agentControllerInterfaceSnapshot({
      authStatus: "unauthenticated",
      status: "error",
    });
    collectLocalAgentControllerInventoryMock.mockResolvedValueOnce({
      capabilities: [
        {
          agentControllerInterface,
          agentControllerRef: "builtin:codex",
          agentId: "codex",
        },
      ],
    });
    const {
      assertSelectedAgentControllerReportsAccepted,
      submitSelectedAgentControllerReports,
    } = await import(
      "../src/local-service/reporting/selected-agent-controller-reporting"
    );

    const result = await submitSelectedAgentControllerReports({
      readiness: READY_READINESS,
      localAgentIds: ["codex"],
    });

    expect(submitRuntimeAgentControllerReportsMock).toHaveBeenCalledWith({
      reports: [
        {
          agentControllerInterface,
          agentControllerRef: "builtin:codex",
          localParticipationState: "needs_agent_prepare",
          reasonCodes: [
            "provider_account.access_required",
            "controller.auth.unauthenticated",
          ],
        },
      ],
    });
    expect(result).toEqual([
      expect.objectContaining({
        agentControllerInterface,
        agentControllerRef: "builtin:codex",
        agentId: "codex",
        localParticipationState: "needs_agent_prepare",
        reasonCodes: [
          "provider_account.access_required",
          "controller.auth.unauthenticated",
        ],
      }),
    ]);
    expect(() => assertSelectedAgentControllerReportsAccepted(result)).toThrow(
      "OpenMeld could not connect selected agents to OpenMeld for codex because this local controller is not signed in on this computer. Sign in to codex, then retry this Web setup command. Support code: provider_account.access_required."
    );
  });

  it("lets Prepare continue after a non-ready controller report is durably accepted", async () => {
    const {
      assertSelectedAgentControllerReportSubmissionsAccepted,
      submitSelectedAgentControllerReports,
    } = await import(
      "../src/local-service/reporting/selected-agent-controller-reporting"
    );
    const agentControllerInterface = agentControllerInterfaceSnapshot({
      authStatus: "unauthenticated",
      status: "error",
    });
    collectLocalAgentControllerInventoryMock.mockResolvedValueOnce({
      capabilities: [
        {
          agentControllerInterface,
          agentControllerRef: "builtin:codex",
          agentId: "codex",
        },
      ],
    });

    const result = await submitSelectedAgentControllerReports({
      readiness: READY_READINESS,
      localAgentIds: ["codex"],
    });

    expect(result[0]).toMatchObject({
      localParticipationState: "needs_agent_prepare",
      runtimeReportSubmission: {
        agentControllerReportStatus: "accepted",
        status: "submitted",
        openMeldServiceRuntimeId: "runtime_opaque_1",
      },
    });
    expect(() =>
      assertSelectedAgentControllerReportSubmissionsAccepted(result)
    ).not.toThrow();
  });

  it("fails closed when a selected local capability is not ready even if the report write is accepted", async () => {
    const {
      assertSelectedAgentControllerReportsAccepted,
      submitSelectedAgentControllerReports,
    } = await import(
      "../src/local-service/reporting/selected-agent-controller-reporting"
    );
    const candidate = READY_READINESS.agents.candidates[0];
    if (!candidate) {
      throw new Error("test fixture is missing the local Codex candidate");
    }

    const result = await submitSelectedAgentControllerReports({
      readiness: {
        ...READY_READINESS,
        agents: {
          ...READY_READINESS.agents,
          candidates: [
            {
              ...candidate,
              launchStatus: "not_available",
            },
          ],
        },
      },
      localAgentIds: ["codex"],
    });

    expect(result).toEqual([
      expect.objectContaining({
        agentId: "codex",
        agentControllerRef: "builtin:codex",
        localParticipationState: "needs_agent_prepare",
        reasonCodes: ["local_agent_preparation.not_enabled"],
        runtimeReportSubmission: expect.objectContaining({
          openMeldServiceRuntimeId: "runtime_opaque_1",
          status: "submitted",
        }),
      }),
    ]);
    expect(() => assertSelectedAgentControllerReportsAccepted(result)).toThrow(
      "OpenMeld could not connect selected agents to OpenMeld for codex. Support code: local_agent_preparation.not_enabled."
    );
  });

  it("preserves install choice required as the selected local agent reason", async () => {
    const {
      assertSelectedAgentControllerReportsAccepted,
      submitSelectedAgentControllerReports,
    } = await import(
      "../src/local-service/reporting/selected-agent-controller-reporting"
    );
    const candidate = READY_READINESS.agents.candidates[0];
    if (!candidate) {
      throw new Error("test fixture is missing the local Codex candidate");
    }

    const result = await submitSelectedAgentControllerReports({
      readiness: {
        ...READY_READINESS,
        agents: {
          ...READY_READINESS.agents,
          detectedSupported: 0,
          needsChoice: 1,
          candidates: [
            {
              ...candidate,
              launchStatus: "needs_choice",
            },
          ],
        },
      },
      localAgentIds: ["codex"],
    });

    expect(result).toEqual([
      expect.objectContaining({
        agentId: "codex",
        agentControllerRef: "builtin:codex",
        localParticipationState: "needs_agent_prepare",
        reasonCodes: ["controller.launch.choice_required"],
      }),
    ]);
    expect(() => assertSelectedAgentControllerReportsAccepted(result)).toThrow(
      "OpenMeld found more than one codex install on this computer. Run `openmeld agents enable --agent codex` in an interactive Terminal and choose one install. If this Terminal cannot prompt, run `openmeld agents enable --agent codex --install <install-id>` with one of the install IDs shown by that enable command, then return to OpenMeld Web setup."
    );
  });

  it("gives repair commands when OpenMeld Service is not running", async () => {
    const {
      assertSelectedAgentControllerReportSubmissionsAccepted,
      assertSelectedAgentControllerReportsAccepted,
      submitSelectedAgentControllerReports,
    } = await import(
      "../src/local-service/reporting/selected-agent-controller-reporting"
    );
    const result = await submitSelectedAgentControllerReports({
      readiness: {
        ...READY_READINESS,
        service: {
          ...READY_READINESS.service,
          runtime: {
            status: "not_running",
            autoStart: false,
            managedBySystemService: false,
            mode: null,
            pid: null,
            serviceController: "unknown",
            startedAt: null,
            updatedAt: null,
          },
        },
      },
      localAgentIds: ["codex"],
    });

    expect(() => assertSelectedAgentControllerReportsAccepted(result)).toThrow(
      "OpenMeld could not connect selected agents to OpenMeld for codex because OpenMeld Service is not running. Run `openmeld service status` to inspect it, then `openmeld service start` to start it and retry this Web setup command."
    );
    expect(() =>
      assertSelectedAgentControllerReportSubmissionsAccepted(result)
    ).toThrow(
      "OpenMeld could not connect selected agents to OpenMeld for codex because OpenMeld Service is not running. Run `openmeld service status` to inspect it, then `openmeld service start` to start it and retry this Web setup command."
    );
  });

  it("fails closed when Runtime reporting cannot return authority runtime evidence", async () => {
    const { assertSelectedAgentControllerReportsAccepted } = await import(
      "../src/local-service/reporting/selected-agent-controller-reporting"
    );

    expect(() =>
      assertSelectedAgentControllerReportsAccepted([
        {
          agentId: "codex",
          agentControllerRef: "builtin:codex",
          localParticipationState: "ready",
          reasonCodes: [],
          runtimeReportSubmission: {
            agentControllerRef: "builtin:codex",
            reason: "write_failed",
            reasonCodes: ["runtime.reporting.write_failed"],
            source: "runtime_reporting_api",
            status: "failed",
          },
        },
      ])
    ).toThrow(
      "OpenMeld could not connect selected agents to OpenMeld for codex. Support code: runtime.reporting.write_failed."
    );
  });

  it("explains forgotten computers without hiding the support code", async () => {
    const { assertSelectedAgentControllerReportsAccepted } = await import(
      "../src/local-service/reporting/selected-agent-controller-reporting"
    );

    expect(() =>
      assertSelectedAgentControllerReportsAccepted([
        {
          agentId: "codex",
          agentControllerRef: "builtin:codex",
          localParticipationState: "ready",
          reasonCodes: [],
          runtimeReportSubmission: {
            agentControllerRef: "builtin:codex",
            reason: "registration_rejected",
            reasonCodes: ["runtime.registration.device_forgotten"],
            source: "runtime_reporting_api",
            status: "failed",
          },
        },
      ])
    ).toThrow(
      "OpenMeld could not reconnect this computer for codex because this computer was previously removed from your OpenMeld account. Support code: runtime.registration.device_forgotten."
    );
  });
});

function agentControllerInterfaceSnapshot(input: {
  authStatus: AgentControllerInterfaceSnapshot["auth"]["status"];
  status: AgentControllerInterfaceSnapshot["status"];
}): AgentControllerInterfaceSnapshot {
  return {
    agentControllerRef: "builtin:codex",
    auth: { status: input.authStatus },
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
    models: [],
    nativeInterface: "codex-app-server",
    schemaVersion: 1,
    skills: [],
    status: input.status,
    version: "0.1.0",
  };
}
