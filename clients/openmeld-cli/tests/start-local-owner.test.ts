import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  collectSkillsReadinessSnapshotMock,
  getDaemonStatusMock,
  listAgentTargetStatesMock,
  readDaemonRuntimeContractMetaMock,
  readCurrentObservedDaemonRuntimeStatusMock,
  runAgentsDisableMock,
  resolveCurrentDaemonExpectedVersionMock,
  resolveLocalServiceDemandMock,
  runAgentsEnableMock,
  runDaemonBackgroundStartForDecisionMock,
  runDaemonInstallMock,
  runSkillsInstallMock,
} = vi.hoisted(() => ({
  collectSkillsReadinessSnapshotMock: vi.fn(),
  getDaemonStatusMock: vi.fn(),
  listAgentTargetStatesMock: vi.fn(),
  readDaemonRuntimeContractMetaMock: vi.fn(),
  readCurrentObservedDaemonRuntimeStatusMock: vi.fn(),
  runAgentsDisableMock: vi.fn(),
  resolveCurrentDaemonExpectedVersionMock: vi.fn(),
  resolveLocalServiceDemandMock: vi.fn(),
  runAgentsEnableMock: vi.fn(),
  runDaemonBackgroundStartForDecisionMock: vi.fn(),
  runDaemonInstallMock: vi.fn(),
  runSkillsInstallMock: vi.fn(),
}));

vi.mock("../src/commands/skills", () => ({
  runSkillsInstall: runSkillsInstallMock,
}));
vi.mock("../src/skills/installation-inventory", () => ({
  collectSkillsReadinessSnapshot: collectSkillsReadinessSnapshotMock,
}));

vi.mock("../src/agents/registry", () => ({
  listAgentTargetStates: listAgentTargetStatesMock,
}));

vi.mock("../src/commands/agents", () => ({
  runAgentsDisable: runAgentsDisableMock,
  runAgentsEnable: runAgentsEnableMock,
}));

vi.mock("../src/config/daemon-state", () => ({
  getDaemonStatus: getDaemonStatusMock,
}));

vi.mock("../src/local-service/state/runtime-contract-guard", () => ({
  readDaemonRuntimeContractMeta: readDaemonRuntimeContractMetaMock,
}));

vi.mock("../src/local-service/lifecycle/current-daemon-version", () => ({
  resolveCurrentDaemonExpectedVersion: resolveCurrentDaemonExpectedVersionMock,
}));

vi.mock("../src/local-service/lifecycle/local-service-demand", () => ({
  resolveLocalServiceDemand: resolveLocalServiceDemandMock,
}));

vi.mock("../src/local-service/lifecycle/daemon-service-runtime", () => ({
  readCurrentObservedDaemonRuntimeStatus:
    readCurrentObservedDaemonRuntimeStatusMock,
}));

vi.mock("../src/commands/service", () => ({
  runDaemonBackgroundStartForDecision: runDaemonBackgroundStartForDecisionMock,
  runDaemonInstall: runDaemonInstallMock,
}));

import {
  collectStartLocalAgentsReadiness,
  listStartLocalBuiltinAgentCandidates,
  listStartLocalRunnableControllerIds,
  runStartLocalAgentsDisable,
  runStartLocalAgentsEnable,
} from "../src/start-local/agents-local";
import {
  collectStartLocalBackgroundHelperReadiness,
  resolveStartLocalBackgroundHelperDemand,
  runStartLocalBackgroundHelperBackgroundStart,
  runStartLocalBackgroundHelperInstall,
} from "../src/start-local/background-helper-local";
import { collectStartLocalReadiness } from "../src/start-local/readiness";
import {
  collectStartLocalSkillsReadiness,
  runStartLocalSkillsInstall,
} from "../src/start-local/skills-local";

describe("start-local owner implementation", () => {
  beforeEach(() => {
    collectSkillsReadinessSnapshotMock.mockReset();
    getDaemonStatusMock.mockReset();
    listAgentTargetStatesMock.mockReset();
    readDaemonRuntimeContractMetaMock.mockReset();
    readCurrentObservedDaemonRuntimeStatusMock.mockReset();
    runAgentsDisableMock.mockReset();
    resolveCurrentDaemonExpectedVersionMock.mockReset();
    resolveLocalServiceDemandMock.mockReset();
    runAgentsEnableMock.mockReset();
    runDaemonBackgroundStartForDecisionMock.mockReset();
    runDaemonInstallMock.mockReset();
    runSkillsInstallMock.mockReset();

    resolveCurrentDaemonExpectedVersionMock.mockReturnValue("0.2.9");
    readDaemonRuntimeContractMetaMock.mockResolvedValue({
      schema: "daemon.runtime.contract.meta",
      v: 1,
      contractEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      updatedAt: "2026-05-08T00:00:00.000Z",
    });
    readCurrentObservedDaemonRuntimeStatusMock.mockResolvedValue(null);
  });

  it("normalizes start-local skills readiness and keeps unknown on failure", async () => {
    collectSkillsReadinessSnapshotMock
      .mockResolvedValueOnce({
        status: "action_required",
        targetCount: 2,
        summary: {
          upToDate: 1,
          outdated: 1,
          missing: 0,
          externalConflict: 0,
        },
      })
      .mockRejectedValueOnce(new Error("skills unavailable"));

    await expect(collectStartLocalSkillsReadiness()).resolves.toEqual({
      status: "action_required",
      targetCount: 2,
      summary: {
        upToDate: 1,
        outdated: 1,
        missing: 0,
        externalConflict: 0,
      },
    });

    await expect(collectStartLocalSkillsReadiness()).resolves.toEqual({
      status: "unknown",
      targetCount: 0,
      summary: {
        upToDate: 0,
        outdated: 0,
        missing: 0,
        externalConflict: 0,
      },
      error: "skills unavailable",
    });
  });

  it("passes through the local skills install action", async () => {
    runSkillsInstallMock.mockResolvedValue("guided");

    await expect(
      runStartLocalSkillsInstall({
        view: "human",
        allowBackToCaller: true,
      })
    ).resolves.toBe("guided");

    expect(runSkillsInstallMock).toHaveBeenCalledWith({
      view: "human",
      allowBackToCaller: true,
    });
  });

  it("normalizes builtin agent candidates and runnable controller ids", async () => {
    listAgentTargetStatesMock.mockResolvedValue([
      {
        targetKind: "builtin",
        agentId: "codex",
        displayName: "Codex",
        detected: true,
        enabled: false,
        lifecycleStatus: "active",
        selectable: true,
        selectableReason: null,
      },
      {
        targetKind: "builtin",
        agentId: "claude",
        displayName: "Claude Code",
        detected: true,
        enabled: true,
        lifecycleStatus: "active",
        selectable: true,
        selectableReason: null,
      },
      {
        targetKind: "builtin",
        agentId: "stale-codex",
        displayName: "Stale Codex",
        detected: true,
        enabled: true,
        lifecycleStatus: "active",
        launchStatus: "needs_repair",
        selectable: true,
        selectableReason: null,
      },
      {
        targetKind: "builtin",
        agentId: "openclaw",
        displayName: "OpenClaw",
        detected: true,
        enabled: false,
        lifecycleStatus: "suspended",
        selectable: false,
        selectableReason: "not_supported_yet",
      },
      {
        targetKind: "custom",
        agentId: "custom",
        displayName: "Custom",
        detected: true,
        enabled: true,
        lifecycleStatus: "active",
        selectable: true,
        selectableReason: null,
      },
    ]);

    await expect(listStartLocalBuiltinAgentCandidates()).resolves.toEqual([
      {
        agentId: "codex",
        displayName: "Codex",
        detected: true,
        enabled: false,
        lifecycleStatus: "active",
        launchStatus: "ready",
        selectable: true,
        selectableReason: null,
      },
      {
        agentId: "claude",
        displayName: "Claude Code",
        detected: true,
        enabled: true,
        lifecycleStatus: "active",
        launchStatus: "ready",
        selectable: true,
        selectableReason: null,
      },
      {
        agentId: "stale-codex",
        displayName: "Stale Codex",
        detected: true,
        enabled: true,
        lifecycleStatus: "active",
        launchStatus: "needs_repair",
        selectable: true,
        selectableReason: null,
      },
      {
        agentId: "openclaw",
        displayName: "OpenClaw",
        detected: true,
        enabled: false,
        lifecycleStatus: "suspended",
        launchStatus: "not_available",
        selectable: false,
        selectableReason: "not_supported_yet",
      },
    ]);

    await expect(listStartLocalRunnableControllerIds()).resolves.toEqual([
      "claude",
      "codex",
    ]);
  });

  it("normalizes local agents readiness and passes through local agent actions", async () => {
    listAgentTargetStatesMock.mockResolvedValue([
      {
        targetKind: "builtin",
        agentId: "codex",
        displayName: "Codex",
        detected: true,
        enabled: false,
        lifecycleStatus: "active",
        selectable: true,
        selectableReason: null,
      },
      {
        targetKind: "builtin",
        agentId: "openclaw",
        displayName: "OpenClaw",
        detected: false,
        enabled: false,
        lifecycleStatus: "suspended",
        selectable: false,
        selectableReason: null,
      },
    ]);

    await expect(collectStartLocalAgentsReadiness()).resolves.toEqual({
      status: "ok",
      totalBuiltins: 2,
      detectedSupported: 1,
      needsChoice: 0,
      needsRepair: 0,
      detectedNotSupportedYet: 0,
      notDetected: 1,
      candidates: [
        {
          agentId: "codex",
          displayName: "Codex",
          detected: true,
          enabled: false,
          lifecycleStatus: "active",
          launchStatus: "ready",
          selectable: true,
          selectableReason: null,
        },
        {
          agentId: "openclaw",
          displayName: "OpenClaw",
          detected: false,
          enabled: false,
          lifecycleStatus: "suspended",
          launchStatus: "not_available",
          selectable: false,
          selectableReason: null,
        },
      ],
    });

    await runStartLocalAgentsEnable({
      agent: ["codex"],
      profile: "human-default",
      view: "human",
    });
    await runStartLocalAgentsDisable({
      agent: ["codex"],
      profile: "human-default",
      view: "human",
    });

    expect(runAgentsEnableMock).toHaveBeenCalledWith({
      agent: ["codex"],
      profile: "human-default",
      view: "human",
    });
    expect(runAgentsDisableMock).toHaveBeenCalledWith({
      agent: ["codex"],
      profile: "human-default",
      view: "human",
    });
  });

  it("normalizes background helper readiness and local helper actions", async () => {
    getDaemonStatusMock.mockResolvedValue({
      installed: true,
      state: {
        daemonVersion: "0.2.9",
      },
    });
    readCurrentObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "running",
      mode: "background",
    });
    resolveLocalServiceDemandMock.mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: true,
      repairableReplyCandidateCount: 0,
      projection: null,
      reason: "local execution routes are available",
      localExecutionRouteCount: 1,
    });
    runDaemonInstallMock.mockResolvedValue(undefined);
    runDaemonBackgroundStartForDecisionMock.mockResolvedValue("started");

    await expect(collectStartLocalBackgroundHelperReadiness()).resolves.toEqual(
      {
        status: "installed_current",
        installedVersion: "0.2.9",
        expectedVersion: "0.2.9",
        executionCompatibility: {
          expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          reasonCode: "daemon.runtime_contract.compatible",
          status: "compatible",
          updatedAt: "2026-05-08T00:00:00.000Z",
        },
        runtime: {
          status: "running",
          mode: "background",
        },
      }
    );

    await expect(
      resolveStartLocalBackgroundHelperDemand({
        ownerUserId: "owner-1",
      })
    ).resolves.toEqual({
      decision: "keep_running",
      hasLocalExecutionRoute: true,
      repairableReplyCandidateCount: 0,
      projection: null,
      reason: "local execution routes are available",
      localExecutionRouteCount: 1,
    });
    await expect(
      runStartLocalBackgroundHelperInstall({
        view: "human",
      })
    ).resolves.toBeUndefined();
    await expect(
      runStartLocalBackgroundHelperBackgroundStart({
        view: "human",
      })
    ).resolves.toBe("started");
  });

  it("keeps CLI and service version drift as diagnostic when execution is compatible", async () => {
    getDaemonStatusMock.mockResolvedValue({
      installed: true,
      state: {
        daemonVersion: "0.2.8",
      },
    });
    readCurrentObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "running",
      mode: "background",
    });

    await expect(collectStartLocalBackgroundHelperReadiness()).resolves.toEqual(
      {
        status: "installed_current",
        installedVersion: "0.2.8",
        expectedVersion: "0.2.9",
        executionCompatibility: {
          expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          reasonCode: "daemon.runtime_contract.compatible",
          status: "compatible",
          updatedAt: "2026-05-08T00:00:00.000Z",
        },
        runtime: {
          status: "running",
          mode: "background",
        },
      }
    );
  });

  it("keeps background helper readiness unknown on failure", async () => {
    getDaemonStatusMock.mockRejectedValue(new Error("service unavailable"));

    await expect(collectStartLocalBackgroundHelperReadiness()).resolves.toEqual(
      {
        status: "unknown",
        installedVersion: null,
        expectedVersion: "0.2.9",
        runtime: null,
        error: "service unavailable",
      }
    );
  });

  it("composes start-local readiness from local owners without changing auth", async () => {
    collectSkillsReadinessSnapshotMock.mockResolvedValue({
      status: "up_to_date",
      targetCount: 1,
      summary: {
        upToDate: 1,
        outdated: 0,
        missing: 0,
        externalConflict: 0,
      },
    });
    listAgentTargetStatesMock.mockResolvedValue([]);
    getDaemonStatusMock.mockResolvedValue({
      installed: false,
    });

    await expect(
      collectStartLocalReadiness({
        auth: {
          status: "valid",
          email: "felix@openmeld.invalid",
          authBaseUrl: "https://auth.openmeld.invalid",
          gatewayUrl: "https://gateway.openmeld.invalid",
        },
      })
    ).resolves.toEqual({
      auth: {
        status: "valid",
        email: "felix@openmeld.invalid",
        authBaseUrl: "https://auth.openmeld.invalid",
        gatewayUrl: "https://gateway.openmeld.invalid",
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
        totalBuiltins: 0,
        detectedSupported: 0,
        needsChoice: 0,
        needsRepair: 0,
        detectedNotSupportedYet: 0,
        notDetected: 0,
        candidates: [],
      },
      service: {
        status: "not_installed",
        installedVersion: null,
        expectedVersion: "0.2.9",
        executionCompatibility: {
          expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          observedEpoch: null,
          reasonCode: "daemon.runtime_contract.not_observed",
          status: "compatible",
          updatedAt: null,
        },
        runtime: null,
      },
    });
  });
});
