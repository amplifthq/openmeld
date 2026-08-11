import type {
  CurrentDeviceTargetResponse,
  LocalAgentCatalogWithLifecycle,
  LocalRuntimeExecutionTarget,
  PrepareSessionSnapshot,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveComputerReplyReadiness } from "../src";
import { shouldUseCompletedPrepareSessionForComputerReadiness } from "../src/recovery/computer-reply-readiness";

const CURRENT_DEVICE_TARGET = {
  availability: "resolved",
  deviceId: "device-macbook-pro",
  runtimeLane: "dev-local",
} satisfies CurrentDeviceTargetResponse;

const READY_EXECUTION_TARGET: LocalRuntimeExecutionTarget = {
  deviceId: "device-macbook-pro",
  runtimeLane: "dev-local",
  userFacingCommand: "openmeld-dev",
  openMeldServiceRuntimeId: {
    source: "runtime_registry_authority",
    value: "runtime-registry-authority-device-macbook-pro",
  },
  status: "ready",
  capabilities: [],
  localAgentControl: { refreshCatalog: true, setEnabled: true },
  localAgentCatalog: createReadyLocalAgentCatalog(),
  reasonCodes: [],
  lastObservedAtMs: Date.parse("2026-04-07T10:00:00.000Z"),
  isCurrent: true,
};

describe("resolveComputerReplyReadiness", () => {
  it("uses Runtime Registry status instead of legacy Start observations", () => {
    const readiness = resolveComputerReplyReadiness({
      currentDeviceTarget: CURRENT_DEVICE_TARGET,
      selectedExecutionTarget: {
        ...READY_EXECUTION_TARGET,
        status: "stale",
        reasonCodes: ["runtime_registry.stale"],
      },
    });

    expect(readiness.status).toBe("needs_repair");
    expect(readiness.reasonCode).toBe("execution_target.stale");
    expect(readiness.service).toBeNull();
  });

  it("uses ready Local Runtime catalog as current computer readiness truth", () => {
    const readiness = resolveComputerReplyReadiness({
      currentDeviceTarget: CURRENT_DEVICE_TARGET,
      selectedExecutionTarget: READY_EXECUTION_TARGET,
    });

    expect(readiness.status).toBe("ready");
    expect(readiness.reasonCode).toBe("ready");
    expect(readiness.service).toBeNull();
  });

  it("requires repair when a completed Prepare Session captured an incompatible service contract", () => {
    const readiness = resolveComputerReplyReadiness({
      completedPrepareSessionSnapshot: createCompletedPrepareSessionSnapshot({
        executionCompatibility: {
          status: "update_required",
          reasonCode: "daemon.runtime_contract.mismatch",
          expectedEpoch: "daemon-runtime-epoch-current",
          observedEpoch: "daemon-runtime-epoch-old",
          updatedAt: "2026-04-07T10:00:00.000Z",
        },
        installedVersion: "0.4.0",
      }),
      currentDeviceTarget: CURRENT_DEVICE_TARGET,
      selectedExecutionTarget: READY_EXECUTION_TARGET,
    });

    expect(readiness.status).toBe("needs_repair");
    expect(readiness.reasonCode).toBe("background_helper.update_required");
  });

  it("uses the current expected service version with completed Prepare Session service evidence", () => {
    const readiness = resolveComputerReplyReadiness({
      completedPrepareSessionSnapshot: createCompletedPrepareSessionSnapshot({
        installedVersion: "0.3.50",
      }),
      currentDeviceTarget: CURRENT_DEVICE_TARGET,
      currentExpectedServiceVersion: "0.4.0",
      selectedExecutionTarget: READY_EXECUTION_TARGET,
    });

    expect(readiness.status).toBe("ready");
    expect(readiness.reasonCode).toBe("ready");
    expect(readiness.service).toMatchObject({
      installStatus: "installed_outdated",
      runtimeStatus: "running",
      installedVersion: "0.3.50",
      expectedVersion: "0.4.0",
    });
  });

  it("lets a completed Prepare Session override stale Local Runtime inventory while setup is catching up", () => {
    const readiness = resolveComputerReplyReadiness({
      completedPrepareSessionSnapshot: createCompletedPrepareSessionSnapshot({
        installedVersion: "0.4.3",
      }),
      currentDeviceTarget: CURRENT_DEVICE_TARGET,
      currentExpectedServiceVersion: "0.4.3",
      selectedExecutionTarget: {
        ...READY_EXECUTION_TARGET,
        status: "stale",
        reasonCodes: ["runtime_registry.stale"],
      },
    });

    expect(readiness.status).toBe("ready");
    expect(readiness.reasonCode).toBe("ready");
    expect(readiness.executionTargetStatus).toBeNull();
    expect(readiness.service).toMatchObject({
      installStatus: "installed_current",
      runtimeStatus: "running",
      installedVersion: "0.4.3",
      expectedVersion: "0.4.3",
    });
  });

  it("keeps legacy completed Prepare Sessions eligible for recovery display without local readiness details", () => {
    const snapshot = createCompletedPrepareSessionSnapshot({
      installedVersion: "0.4.3",
    });

    expect(
      shouldUseCompletedPrepareSessionForComputerReadiness({
        currentDeviceTarget: CURRENT_DEVICE_TARGET,
        snapshot: {
          ...snapshot,
          localReadinessSnapshot: null,
        },
      })
    ).toBe(true);
  });
});

function createReadyLocalAgentCatalog(): LocalAgentCatalogWithLifecycle {
  return {
    totalBuiltins: 1,
    detectedSupported: 1,
    needsChoice: 0,
    needsRepair: 0,
    detectedNotSupportedYet: 0,
    notDetected: 0,
    entries: [
      {
        agentId: "codex",
        displayName: "Codex",
        targetKind: "builtin",
        detected: true,
        enabled: true,
        lifecycleStatus: "active",
        launchStatus: "ready",
        selectable: true,
        selectableReason: null,
      },
    ],
  };
}

function createCompletedPrepareSessionSnapshot(input: {
  executionCompatibility?: NonNullable<
    PrepareSessionSnapshot["localReadinessSnapshot"]
  >["service"]["executionCompatibility"];
  installedVersion: string;
}): PrepareSessionSnapshot {
  const now = "2026-05-09T12:00:00.000Z";
  return {
    blockers: [],
    completedAt: now,
    createdAt: now,
    deviceId: CURRENT_DEVICE_TARGET.deviceId,
    diagnosticCorrelationId: "prepare:completed",
    expiresAt: "2026-05-09T12:30:00.000Z",
    humanProfileId: "human-profile-1",
    lifecycleStatus: "completed",
    localAgentCatalog: createReadyLocalAgentCatalog(),
    localReadinessSnapshot: {
      observedAt: now,
      service: {
        expectedVersion: input.installedVersion,
        installedVersion: input.installedVersion,
        installStatus: "installed_current",
        runtimeStatus: "running",
        ...(input.executionCompatibility === undefined
          ? {}
          : { executionCompatibility: input.executionCompatibility }),
      },
      skills: {
        status: "up_to_date",
        targetCount: 1,
        summary: {
          externalConflict: 0,
          missing: 0,
          outdated: 0,
          upToDate: 1,
        },
      },
    },
    ownerUserId: "user-1",
    phase: "ready",
    prepareSessionId: "prepare-session-1",
    runtimeLane: CURRENT_DEVICE_TARGET.runtimeLane,
    selectedLocalAgentIds: ["codex"],
    sessionRevision: 5,
    steps: [
      "computer",
      "connect_terminal",
      "choose_local_agents",
      "prepare_selected_agents",
      "refresh_service",
      "report_runtime",
      "verify_setup",
      "ready",
    ].map((stepId) => ({
      blockerReasonCode: null,
      completedAt: now,
      id: stepId,
      startedAt: now,
      state: "complete",
      summary: stepId,
      title: stepId,
      updatedAt: now,
    })) as PrepareSessionSnapshot["steps"],
    targetSpaceId: null,
    terminalConnection: {
      connectedAt: now,
      connectionEpoch: 1,
      connectionId: "terminal-1",
      disconnectedAt: null,
      disconnectReason: null,
      lastSeenAt: now,
      status: "connected",
    },
    updatedAt: now,
  };
}
