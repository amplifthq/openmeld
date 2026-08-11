import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";
import type { OpenMeldProfile } from "../src/config/openmeld-profiles-api";
import { runSpaceJoin } from "../src/space/command";
import { assertSpaceJoinTargetPreflightReady } from "../src/space/join-entry";
import { withSilencedStdio, withTempHome } from "./helpers/fs";

const HUMAN_PROFILE: OpenMeldProfile = {
  openMeldProfileId: "hum-current-profile",
  profileName: "Felix",
  profileHandle: "felix",
  profileKind: "human",
  ownerUserId: "user-1",
  source: "cli_create",
  createdByUserId: "user-1",
  lastUsedAt: null,
  createdAt: "2026-03-05T00:00:00.000Z",
  updatedAt: "2026-03-05T00:00:00.000Z",
  status: "active",
};

const AGENT_PROFILE_WITHOUT_LOCAL_SETUP: OpenMeldProfile = {
  ...HUMAN_PROFILE,
  openMeldProfileId: "agt-local-not-ready",
  profileName: "Codex",
  profileHandle: "codex",
  profileKind: "agent",
};

const emitSpaceCommandPreflightMock = vi.hoisted(() => vi.fn());
const emitResolvedSpaceCommandPreflightMock = vi.hoisted(() => vi.fn());
const emitSpaceFailureNextStepMock = vi.hoisted(() => vi.fn());
const resolveRuntimeContextMock = vi.hoisted(() => vi.fn());
const resolveLocalServiceDemandMock = vi.hoisted(() => vi.fn());
const inspectDaemonServiceInventoryMock = vi.hoisted(() => vi.fn());
const getDaemonStatusMock = vi.hoisted(() => vi.fn());
const resolveDaemonRuntimeStateMock = vi.hoisted(() => vi.fn());
const resolveDaemonServiceManagerForRuntimeStateMock = vi.hoisted(() =>
  vi.fn()
);
const shouldOfferDaemonStartDecisionMock = vi.hoisted(() => vi.fn());
const runDaemonStartDecisionPromptMock = vi.hoisted(() => vi.fn());
const runDaemonBackgroundStartForDecisionMock = vi.hoisted(() => vi.fn());
const runConnectMock = vi.hoisted(() => vi.fn());

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  multiselect: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
}));

vi.mock("../src/runtime/context", () => ({
  parseCliViewMode: vi.fn(),
  resolveRuntimeContext: (
    ...args: Parameters<typeof resolveRuntimeContextMock>
  ) => resolveRuntimeContextMock(...args),
}));

vi.mock("../src/auth/command-auth", () => ({
  buildCommandAuthenticationPromptMessage: vi.fn(() => "joining a space"),
  ensureCommandAuthenticationOrCancel: vi.fn(async () => true),
}));

vi.mock("../src/space/command-context", () => ({
  assertValidSpaceIdTarget: vi.fn(),
  ensureSpaceCommandGatewayAuthenticationOrCancel: vi.fn(async () => null),
  prepareAuthenticatedSpaceCommandContext: vi.fn(),
  resolveOpenMeldProfileForSpaceCommand: vi.fn(async () => HUMAN_PROFILE),
}));

vi.mock("../src/space/preflight", () => ({
  emitSpaceCommandPreflight: (
    ...args: Parameters<typeof emitSpaceCommandPreflightMock>
  ) => emitSpaceCommandPreflightMock(...args),
  emitResolvedSpaceCommandPreflight: (
    ...args: Parameters<typeof emitResolvedSpaceCommandPreflightMock>
  ) => emitResolvedSpaceCommandPreflightMock(...args),
  emitSpaceFailureNextStep: (
    ...args: Parameters<typeof emitSpaceFailureNextStepMock>
  ) => emitSpaceFailureNextStepMock(...args),
  resolveSpaceFailureGuidance: vi.fn(),
}));

vi.mock("../src/local-service/lifecycle/local-service-demand", () => ({
  maybeAutoStopIdleLocalService: vi.fn(),
  resolveLocalServiceDemand: (
    ...args: Parameters<typeof resolveLocalServiceDemandMock>
  ) => resolveLocalServiceDemandMock(...args),
}));

vi.mock("../src/config/daemon-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/daemon-state")
  >("../src/config/daemon-state");
  return {
    ...actual,
    getDaemonStatus: (...args: Parameters<typeof getDaemonStatusMock>) =>
      getDaemonStatusMock(...args),
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-runtime", () => ({
  getEffectiveDaemonRuntimeStatus: vi.fn(() => "not_running"),
  readCurrentObservedDaemonRuntimeStatus: vi.fn(),
  resolveDaemonRuntimeState: (
    ...args: Parameters<typeof resolveDaemonRuntimeStateMock>
  ) => resolveDaemonRuntimeStateMock(...args),
  resolveDaemonServiceManagerForRuntimeState: (
    ...args: Parameters<typeof resolveDaemonServiceManagerForRuntimeStateMock>
  ) => resolveDaemonServiceManagerForRuntimeStateMock(...args),
}));

vi.mock("../src/system/local-service-start-decision", async () => {
  const actual = await vi.importActual<
    typeof import("../src/system/local-service-start-decision")
  >("../src/system/local-service-start-decision");
  return {
    ...actual,
    runDaemonStartDecisionPrompt: (
      ...args: Parameters<typeof runDaemonStartDecisionPromptMock>
    ) => runDaemonStartDecisionPromptMock(...args),
    shouldOfferDaemonStartDecision: (
      ...args: Parameters<typeof shouldOfferDaemonStartDecisionMock>
    ) => shouldOfferDaemonStartDecisionMock(...args),
  };
});

vi.mock("../src/commands/service", () => ({
  runDaemonBackgroundStartForDecision: (
    ...args: Parameters<typeof runDaemonBackgroundStartForDecisionMock>
  ) => runDaemonBackgroundStartForDecisionMock(...args),
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
    input.installedVersion === undefined ? "0.2.8" : input.installedVersion;
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
              daemonVersion: installedVersion,
            },
          },
    runtimeStatus: {
      status: input.runtimeStatus ?? "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
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

vi.mock("../src/space/connect", () => ({
  runConnect: (...args: Parameters<typeof runConnectMock>) =>
    runConnectMock(...args),
}));

describe("space join gateway-chain blocked handling", () => {
  beforeEach(() => {
    resolveRuntimeContextMock.mockReset().mockResolvedValue({
      interactive: true,
      resolvedView: "human",
      viewMode: "human",
    });
    emitSpaceCommandPreflightMock.mockReset().mockResolvedValue({
      deviceReplyReadiness: {
        reasonCodes: ["service.gateway_chain_unhealthy"],
        reasonText: "Gateway auth chain is unavailable",
        replyReadiness: "blocked",
        updatedAt: "2026-03-24T00:00:00.000Z",
        wakeableRouteCount: 1,
      },
    });
    emitResolvedSpaceCommandPreflightMock.mockReset();
    emitSpaceFailureNextStepMock.mockReset();
    resolveLocalServiceDemandMock.mockReset().mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: true,
      repairableReplyCandidateCount: 0,
      projection: null,
      reason: "local execution routes are available",
      localExecutionRouteCount: 1,
    });
    getDaemonStatusMock.mockReset().mockResolvedValue({
      installed: true,
      state: {
        daemonVersion: "0.2.8",
      },
    });
    inspectDaemonServiceInventoryMock.mockReset().mockResolvedValue(
      createDaemonInventory({
        runtimeStatus: "not_running",
        installedVersion: packageJson.version,
      })
    );
    resolveDaemonRuntimeStateMock.mockReset().mockResolvedValue({
      autoStart: true,
      managedBySystemService: true,
      mode: null,
      pid: null,
      reason: "service not running",
      serviceController: "launchd",
      startedAt: null,
      status: "not_running",
      updatedAt: null,
    });
    resolveDaemonServiceManagerForRuntimeStateMock
      .mockReset()
      .mockResolvedValue({
        serviceManager: null,
        serviceManagerStatus: null,
      });
    shouldOfferDaemonStartDecisionMock.mockReset().mockReturnValue(true);
    runDaemonBackgroundStartForDecisionMock
      .mockReset()
      .mockResolvedValue("started");
    runDaemonStartDecisionPromptMock
      .mockReset()
      .mockImplementation(
        async (input: { startService: () => Promise<string> }) => {
          return await input.startService();
        }
      );
    runConnectMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("keeps joining without OpenMeld Service prompts when human-only join is blocked by the gateway chain", async () => {
    let result: unknown = null;

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        result = await runSpaceJoin({
          profile: "hum-current-profile",
          view: "human",
          space:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          allowPrompt: true,
        });
      });
    });

    expect(runDaemonStartDecisionPromptMock).not.toHaveBeenCalled();
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
    expect(emitSpaceFailureNextStepMock).not.toHaveBeenCalled();
    expect(runConnectMock).not.toHaveBeenCalled();
    expect(result).toBe("cancelled");
  });

  it("routes preflight throws through the guarded join failure path", async () => {
    let thrown: unknown = null;
    emitSpaceCommandPreflightMock.mockRejectedValueOnce(
      new Error("Gateway preflight exploded")
    );

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        thrown = await runSpaceJoin({
          profile: "hum-current-profile",
          view: "human",
          space:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          allowPrompt: true,
        }).catch((error) => error);
      });
    });

    expect(runDaemonStartDecisionPromptMock).not.toHaveBeenCalled();
    expect(emitSpaceFailureNextStepMock).toHaveBeenCalledTimes(1);
    expect(runConnectMock).not.toHaveBeenCalled();
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Gateway preflight exploded");
  });

  it("re-runs join preflight against the final target baseUrl", async () => {
    emitSpaceCommandPreflightMock.mockResolvedValueOnce({
      deviceReplyReadiness: {
        reasonCodes: [],
        reasonText: "Ready",
        replyReadiness: "ready",
        updatedAt: "2026-03-24T00:00:00.000Z",
        wakeableRouteCount: 1,
      },
    });
    emitSpaceCommandPreflightMock.mockResolvedValueOnce({
      deviceReplyReadiness: {
        reasonCodes: [],
        reasonText: "Ready",
        replyReadiness: "ready",
        updatedAt: "2026-03-24T00:00:01.000Z",
        wakeableRouteCount: 1,
      },
    });

    const runtimeProjection = {
      status: "ok" as const,
      mode: "check" as const,
      projectedControllerIds: ["codex"],
      missingControllerIds: [],
      disabledControllerIds: [],
      repairedControllerIds: [],
      reason: "projection was already checked for this command",
    };

    await assertSpaceJoinTargetPreflightReady({
      openMeldProfile: HUMAN_PROFILE,
      baseUrl: "https://target.gateway.example.com",
      localDemand: {
        decision: "keep_running",
        hasLocalExecutionRoute: true,
        repairableReplyCandidateCount: 0,
        projection: runtimeProjection,
        reason: "local execution routes are available",
        localExecutionRouteCount: 1,
      },
      presenter: {
        data: vi.fn(),
        event: vi.fn(),
        line: vi.fn(),
      } as never,
      resolvedView: "human",
      view: "human",
    });

    expect(emitSpaceCommandPreflightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://target.gateway.example.com",
        command: "join",
        runtimeProjection,
      })
    );
  });

  it("continues join when service-only attention remains but local agents are not needed for this action", async () => {
    emitSpaceCommandPreflightMock
      .mockResolvedValueOnce({
        deviceReplyReadiness: {
          reasonCodes: ["service.not_running"],
          reasonText: "OpenMeld Service is not running on this device",
          replyReadiness: "blocked",
          updatedAt: "2026-03-24T00:00:00.000Z",
          wakeableRouteCount: 1,
        },
      })
      .mockResolvedValueOnce({
        deviceReplyReadiness: {
          reasonCodes: ["service.not_running"],
          reasonText: "OpenMeld Service is still not running on this device",
          replyReadiness: "blocked",
          updatedAt: "2026-03-24T00:00:01.000Z",
          wakeableRouteCount: 1,
        },
      });

    await assertSpaceJoinTargetPreflightReady({
      openMeldProfile: HUMAN_PROFILE,
      baseUrl: "https://target.gateway.example.com",
      localDemand: {
        decision: "keep_running",
        hasLocalExecutionRoute: true,
        repairableReplyCandidateCount: 0,
        projection: null,
        reason: "local execution routes are available",
        localExecutionRouteCount: 1,
      },
      presenter: {
        data: vi.fn(),
        event: vi.fn(),
        line: vi.fn(),
      } as never,
      resolvedView: "human",
      view: "human",
    });

    expect(emitSpaceCommandPreflightMock).toHaveBeenCalledTimes(1);
    expect(runDaemonStartDecisionPromptMock).not.toHaveBeenCalled();
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
  });

  it("continues human-only join when service-only readiness is blocked but local agents are not needed", async () => {
    emitSpaceCommandPreflightMock.mockResolvedValueOnce({
      deviceReplyReadiness: {
        reasonCodes: ["service.not_installed"],
        reasonText: "OpenMeld Service is not installed on this device",
        replyReadiness: "blocked",
        updatedAt: "2026-03-24T00:00:00.000Z",
        wakeableRouteCount: 0,
      },
    });
    const presenter = {
      data: vi.fn(),
      event: vi.fn(),
      line: vi.fn(),
    };

    await assertSpaceJoinTargetPreflightReady({
      openMeldProfile: HUMAN_PROFILE,
      baseUrl: "https://target.gateway.example.com",
      localDemand: {
        decision: "allow_auto_stop",
        hasLocalExecutionRoute: false,
        repairableReplyCandidateCount: 0,
        projection: null,
        reason: "no local agents need OpenMeld Service right now",
        localExecutionRouteCount: 0,
      },
      presenter: presenter as never,
      resolvedView: "human",
      view: "human",
    });

    expect(runDaemonStartDecisionPromptMock).not.toHaveBeenCalled();
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.join.service.not_needed",
      })
    );
  });

  it("continues joining with membership-only guidance when an explicit local agent profile is not ready on this device", async () => {
    emitSpaceCommandPreflightMock.mockResolvedValueOnce({
      deviceReplyReadiness: {
        reasonCodes: ["profile.unbound"],
        reasonText: "This profile is not connected to an agent yet",
        replyReadiness: "blocked",
        updatedAt: "2026-03-24T00:00:00.000Z",
        wakeableRouteCount: 0,
      },
    });
    const presenter = {
      data: vi.fn(),
      event: vi.fn(),
      line: vi.fn(),
    };

    const result = await assertSpaceJoinTargetPreflightReady({
      openMeldProfile: AGENT_PROFILE_WITHOUT_LOCAL_SETUP,
      baseUrl: "https://target.gateway.example.com",
      localDemand: {
        decision: "allow_auto_stop",
        hasLocalExecutionRoute: false,
        repairableReplyCandidateCount: 0,
        projection: null,
        reason: "no local agents need OpenMeld Service right now",
        localExecutionRouteCount: 0,
      },
      presenter: presenter as never,
      resolvedView: "human",
      view: "human",
    });

    expect(result).toBe("continue");
    expect(emitSpaceCommandPreflightMock).toHaveBeenCalledTimes(1);
    expect(runDaemonStartDecisionPromptMock).not.toHaveBeenCalled();
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.join.local_participation.pending",
      })
    );
  });

  it("does not offer OpenMeld Service when a bound local agent still needs repair on this device", async () => {
    emitSpaceCommandPreflightMock.mockResolvedValueOnce({
      deviceReplyReadiness: {
        reasonCodes: ["controller.launch.needs_repair"],
        reasonText: "This local agent still needs repair on this device",
        replyReadiness: "blocked",
        updatedAt: "2026-03-24T00:00:00.000Z",
        wakeableRouteCount: 0,
      },
      serviceParticipationReadiness: {
        serviceReadiness: "needs_repair",
        summaryText: "Needs repair",
        detailText: "This local agent still needs repair on this device",
        nextStepSummary: "Repair it first",
        nextSteps: ["openmeld agents repair --agent codex"],
        runtimeHeadline: "running",
      },
    });
    emitSpaceCommandPreflightMock.mockResolvedValueOnce({
      deviceReplyReadiness: {
        reasonCodes: ["controller.launch.needs_repair"],
        reasonText: "This local agent still needs repair on this device",
        replyReadiness: "blocked",
        updatedAt: "2026-03-24T00:00:01.000Z",
        wakeableRouteCount: 0,
      },
      serviceParticipationReadiness: {
        serviceReadiness: "needs_repair",
        summaryText: "Needs repair",
        detailText: "This local agent still needs repair on this device",
        nextStepSummary: "Repair it first",
        nextSteps: ["openmeld agents repair --agent codex"],
        runtimeHeadline: "running",
      },
    });
    const presenter = {
      data: vi.fn(),
      event: vi.fn(),
      line: vi.fn(),
    };

    const result = await assertSpaceJoinTargetPreflightReady({
      openMeldProfile: {
        ...AGENT_PROFILE_WITHOUT_LOCAL_SETUP,
      },
      baseUrl: "https://target.gateway.example.com",
      localDemand: {
        decision: "keep_running",
        hasLocalExecutionRoute: true,
        repairableReplyCandidateCount: 0,
        projection: null,
        reason: "local execution routes are available",
        localExecutionRouteCount: 1,
      },
      presenter: presenter as never,
      resolvedView: "human",
      view: "human",
    });

    expect(result).toBe("continue");
    expect(runDaemonStartDecisionPromptMock).not.toHaveBeenCalled();
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.join.local_participation.pending",
      })
    );
  });

  it("does not retry target-specific preflight for human-only join just because ambient keep-running exists", async () => {
    emitSpaceCommandPreflightMock
      .mockResolvedValueOnce({
        deviceReplyReadiness: {
          reasonCodes: ["service.not_running"],
          reasonText: "OpenMeld Service is not running on this device",
          replyReadiness: "blocked",
          updatedAt: "2026-03-24T00:00:00.000Z",
          wakeableRouteCount: 1,
        },
      })
      .mockResolvedValueOnce({
        deviceReplyReadiness: {
          reasonCodes: [],
          reasonText: "Ready",
          replyReadiness: "ready",
          updatedAt: "2026-03-24T00:00:01.000Z",
          wakeableRouteCount: 1,
        },
      });

    await assertSpaceJoinTargetPreflightReady({
      openMeldProfile: HUMAN_PROFILE,
      baseUrl: "https://target.gateway.example.com",
      localDemand: {
        decision: "keep_running",
        hasLocalExecutionRoute: true,
        repairableReplyCandidateCount: 0,
        projection: null,
        reason: "local execution routes are available",
        localExecutionRouteCount: 1,
      },
      presenter: {
        data: vi.fn(),
        event: vi.fn(),
        line: vi.fn(),
      } as never,
      resolvedView: "human",
      view: "human",
    });

    expect(emitSpaceCommandPreflightMock).toHaveBeenCalledTimes(1);
    expect(runDaemonStartDecisionPromptMock).not.toHaveBeenCalled();
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
  });

  it("continues join without OpenMeld Service prompts even when ambient keep-running exists", async () => {
    emitSpaceCommandPreflightMock.mockResolvedValueOnce({
      deviceReplyReadiness: {
        reasonCodes: ["service.gateway_chain_unhealthy"],
        reasonText: "Gateway auth chain is unavailable",
        replyReadiness: "blocked",
        updatedAt: "2026-03-24T00:00:00.000Z",
        wakeableRouteCount: 1,
      },
    });
    emitSpaceCommandPreflightMock.mockResolvedValueOnce({
      deviceReplyReadiness: {
        reasonCodes: ["service.gateway_chain_unhealthy"],
        reasonText: "Gateway auth chain is unavailable",
        replyReadiness: "blocked",
        updatedAt: "2026-03-24T00:00:01.000Z",
        wakeableRouteCount: 1,
      },
    });
    runDaemonStartDecisionPromptMock.mockResolvedValueOnce("not_now");

    await expect(
      assertSpaceJoinTargetPreflightReady({
        openMeldProfile: HUMAN_PROFILE,
        baseUrl: "https://target.gateway.example.com",
        localDemand: {
          decision: "keep_running",
          hasLocalExecutionRoute: true,
          repairableReplyCandidateCount: 0,
          projection: null,
          reason: "local execution routes are available",
          localExecutionRouteCount: 1,
        },
        presenter: {
          data: vi.fn(),
          event: vi.fn(),
          line: vi.fn(),
        } as never,
        resolvedView: "human",
        view: "human",
      })
    ).resolves.toBe("continue");

    expect(emitSpaceCommandPreflightMock).toHaveBeenCalledTimes(1);
    expect(runDaemonStartDecisionPromptMock).not.toHaveBeenCalled();
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
  });

  it("never triggers OpenMeld Service prompts for human-only join when the caller cannot prompt", async () => {
    emitSpaceCommandPreflightMock
      .mockResolvedValueOnce({
        deviceReplyReadiness: {
          reasonCodes: ["service.not_running"],
          reasonText: "OpenMeld Service is not running on this device",
          replyReadiness: "blocked",
          updatedAt: "2026-03-24T00:00:00.000Z",
          wakeableRouteCount: 1,
        },
      })
      .mockResolvedValueOnce({
        deviceReplyReadiness: {
          reasonCodes: ["service.not_running"],
          reasonText: "OpenMeld Service is not running on this device",
          replyReadiness: "blocked",
          updatedAt: "2026-03-24T00:00:01.000Z",
          wakeableRouteCount: 1,
        },
      });

    await expect(
      assertSpaceJoinTargetPreflightReady({
        openMeldProfile: HUMAN_PROFILE,
        baseUrl: "https://target.gateway.example.com",
        localDemand: {
          decision: "keep_running",
          hasLocalExecutionRoute: true,
          repairableReplyCandidateCount: 0,
          projection: null,
          reason: "local execution routes are available",
          localExecutionRouteCount: 1,
        },
        presenter: {
          data: vi.fn(),
          event: vi.fn(),
          line: vi.fn(),
        } as never,
        resolvedView: "human",
        allowPrompt: false,
        view: "human",
      })
    ).resolves.toBe("continue");

    expect(emitSpaceCommandPreflightMock).toHaveBeenCalledTimes(1);
    expect(runDaemonStartDecisionPromptMock).not.toHaveBeenCalled();
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
  });

  it("does not offer direct repair for service drift when local participation is not needed for this action", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createDaemonInventory({
        installedVersion: packageJson.version,
        runtimeStatus: "stale",
        anomalyCodes: ["runtime_stale"],
      })
    );
    emitSpaceCommandPreflightMock.mockResolvedValueOnce({
      deviceReplyReadiness: {
        reasonCodes: ["service.drifted"],
        reasonText:
          "OpenMeld Service artifact drift was detected on this device",
        replyReadiness: "blocked",
        updatedAt: "2026-03-24T00:00:00.000Z",
        wakeableRouteCount: 1,
      },
    });
    emitSpaceCommandPreflightMock.mockResolvedValueOnce({
      deviceReplyReadiness: {
        reasonCodes: ["service.drifted"],
        reasonText:
          "OpenMeld Service artifact drift was detected on this device",
        replyReadiness: "blocked",
        updatedAt: "2026-03-24T00:00:01.000Z",
        wakeableRouteCount: 1,
      },
    });
    runDaemonBackgroundStartForDecisionMock.mockResolvedValueOnce(
      "deferred_with_card"
    );

    await assertSpaceJoinTargetPreflightReady({
      openMeldProfile: HUMAN_PROFILE,
      baseUrl: "https://target.gateway.example.com",
      localDemand: {
        decision: "keep_running",
        hasLocalExecutionRoute: true,
        repairableReplyCandidateCount: 0,
        projection: null,
        reason: "local execution routes are available",
        localExecutionRouteCount: 1,
      },
      presenter: {
        data: vi.fn(),
        event: vi.fn(),
        line: vi.fn(),
      } as never,
      resolvedView: "human",
      view: "human",
    });

    expect(emitSpaceCommandPreflightMock).toHaveBeenCalledTimes(1);
    expect(runDaemonStartDecisionPromptMock).not.toHaveBeenCalled();
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
  });

  it("does not offer daemon start for human-only join after target-specific preflight is ready", async () => {
    emitSpaceCommandPreflightMock.mockResolvedValueOnce({
      deviceReplyReadiness: {
        reasonCodes: [],
        reasonText: "Ready",
        replyReadiness: "ready",
        updatedAt: "2026-03-24T00:00:00.000Z",
        wakeableRouteCount: 1,
      },
    });
    emitSpaceCommandPreflightMock.mockResolvedValueOnce({
      deviceReplyReadiness: {
        reasonCodes: [],
        reasonText: "Ready",
        replyReadiness: "ready",
        updatedAt: "2026-03-24T00:00:01.000Z",
        wakeableRouteCount: 1,
      },
    });

    await assertSpaceJoinTargetPreflightReady({
      openMeldProfile: HUMAN_PROFILE,
      baseUrl: "https://target.gateway.example.com",
      localDemand: {
        decision: "keep_running",
        hasLocalExecutionRoute: true,
        repairableReplyCandidateCount: 0,
        projection: null,
        reason: "local execution routes are available",
        localExecutionRouteCount: 1,
      },
      presenter: {
        data: vi.fn(),
        event: vi.fn(),
        line: vi.fn(),
      } as never,
      resolvedView: "human",
      view: "human",
    });

    expect(emitSpaceCommandPreflightMock).toHaveBeenCalledTimes(1);
    expect(runDaemonStartDecisionPromptMock).not.toHaveBeenCalled();
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
  });
});
