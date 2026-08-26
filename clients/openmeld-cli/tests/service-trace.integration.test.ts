import {
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION,
  RUNTIME_COORDINATOR_CREATION_DIAGNOSTIC_MODEL_VERSION,
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
  TARGET_WAKE_LIFECYCLE_IDENTITY_MODEL_VERSION,
} from "@openmeld/schemas";
import type { SpaceDispatchTraceResponse } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenMeldProfile } from "../src/config/openmeld-profiles-api";
import { emitDaemonDispatchJournalEvent } from "../src/local-service/dispatch/daemon-dispatch-journal";
import { formatOpenMeldCliCommand } from "../src/runtime/cli-entry-command";
import type { CurrentReplyReadinessSnapshot } from "../src/system/current-reply-readiness-snapshot";
import type { AgentReplyReadinessStatus } from "../src/system/reply-readiness";
import { withCapturedStdio, withTempHome } from "./helpers/fs";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

const {
  cancelMock,
  isCancelMock,
  promptForOpenMeldProfileSelectionMock,
  resolveOpenMeldProfileMock,
  resolveCurrentReplyReadinessSnapshotMock,
  resolveRuntimeContextMock,
  selectMock,
  setSelectedOpenMeldProfileIdMock,
} = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  isCancelMock: vi.fn(),
  promptForOpenMeldProfileSelectionMock: vi.fn(),
  resolveOpenMeldProfileMock: vi.fn(),
  resolveCurrentReplyReadinessSnapshotMock: vi.fn(),
  resolveRuntimeContextMock: vi.fn(),
  selectMock: vi.fn(),
  setSelectedOpenMeldProfileIdMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  cancel: (...args: Parameters<typeof cancelMock>) => cancelMock(...args),
  isCancel: (...args: Parameters<typeof isCancelMock>) => isCancelMock(...args),
  select: (...args: Parameters<typeof selectMock>) => selectMock(...args),
}));

vi.mock("../src/config/openmeld-profile-selection", () => ({
  setSelectedOpenMeldProfileId: (
    ...args: Parameters<typeof setSelectedOpenMeldProfileIdMock>
  ) => setSelectedOpenMeldProfileIdMock(...args),
}));

vi.mock("../src/config/openmeld-profiles-api", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/openmeld-profiles-api")
  >("../src/config/openmeld-profiles-api");
  return {
    ...actual,
    resolveOpenMeldProfile: (
      ...args: Parameters<typeof resolveOpenMeldProfileMock>
    ) => resolveOpenMeldProfileMock(...args),
  };
});

vi.mock("../src/profile/profile-selection-prompt", async () => {
  const actual = await vi.importActual<
    typeof import("../src/profile/profile-selection-prompt")
  >("../src/profile/profile-selection-prompt");
  return {
    ...actual,
    promptForOpenMeldProfileSelection: (
      ...args: Parameters<typeof promptForOpenMeldProfileSelectionMock>
    ) => promptForOpenMeldProfileSelectionMock(...args),
  };
});

vi.mock("../src/runtime/context", () => ({
  resolveRuntimeContext: (
    ...args: Parameters<typeof resolveRuntimeContextMock>
  ) => resolveRuntimeContextMock(...args),
}));

vi.mock("../src/system/current-reply-readiness-snapshot", async () => {
  const actual = await vi.importActual<
    typeof import("../src/system/current-reply-readiness-snapshot")
  >("../src/system/current-reply-readiness-snapshot");
  return {
    ...actual,
    resolveCurrentReplyReadinessSnapshot:
      resolveCurrentReplyReadinessSnapshotMock,
  };
});

import { runServiceTrace } from "../src/commands/service-trace";

type TraceSnapshot = NonNullable<SpaceDispatchTraceResponse["trace"]>;

function createAgentReplyReadiness(
  overrides: Partial<AgentReplyReadinessStatus> = {}
): AgentReplyReadinessStatus {
  return {
    deviceReplyReadiness: {
      reasonCodes: [],
      reasonText:
        "This device is ready for Space replies from local agent profiles",
      replyReadiness: "ready",
      updatedAt: "2026-03-09T00:00:00.000Z",
      wakeableRouteCount: 1,
    },
    profileId: "agt-target",
    reasonCodes: [],
    reasonText: "This profile can reply from Space when mentioned",
    replyReadiness: "ready",
    transportMode: "local-cli",
    updatedAt: "2026-03-09T00:00:00.000Z",
    ...overrides,
  };
}

function createReplyReadinessSnapshot(
  overrides: Partial<CurrentReplyReadinessSnapshot> = {}
): CurrentReplyReadinessSnapshot {
  const agentReplyReadiness = createAgentReplyReadiness();
  return {
    daemonRouteObservation: {
      detail: "No OpenMeld profile was selected for a server route lookup.",
      observedAt: "2026-03-09T00:00:00.000Z",
      profileId: null,
      reasonCode: "profile_not_selected",
      route: null,
      status: "unavailable",
    },
    observedAt: "2026-03-09T00:00:00.000Z",
    daemonStatus: {
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.0.1",
        installSource: "daemon.command.install",
        installedAt: "2026-03-09T00:00:00.000Z",
        updatedAt: "2026-03-09T00:00:00.000Z",
      },
    },
    inventory: null,
    gatewayChainReadiness: null,
    runtimeProjection: null,
    runtimeStatus: null,
    displayRuntimeStatus: null,
    serviceManagerStatus: null,
    deviceReplyReadiness: agentReplyReadiness.deviceReplyReadiness,
    agentReplyReadiness,
    openClawLocalDiagnostics: null,
    profileWorkspaceRuntimeResolution: null,
    ...overrides,
  };
}

function createTraceResponse(): SpaceDispatchTraceResponse {
  return {
    correlation: {
      modelVersion: OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION,
      selector: {
        kind: "dispatch",
        spaceId: "space-demo",
        dispatchId: "dispatch-demo",
      },
      spaceId: "space-demo",
      clientMessageId: "client-message-1",
      sourceSignalId: "evt-1",
      targetProfileId: "agt-target",
      dispatchId: "dispatch-demo",
      runtimeCoordinatorExecutionId: null,
      latestAttemptId: "attempt-2",
      claimLeaseId: null,
      bindingId: "binding-1",
      openMeldServiceRuntimeId: "runtime-1",
      agentControllerRef: "builtin:codex",
      resultRef: "result-1",
      publishedSignalId: "sig-1",
      replySignalId: "sig-1",
      cloudflare: {
        cfRayId: null,
        requestId: null,
        traceId: null,
      },
    },
    query: {
      spaceId: "space-demo",
      dispatchId: "dispatch-demo",
    },
    trace: {
      dispatch: {
        factSource: "dispatch_ledger",
        dispatchId: "dispatch-demo",
        idempotencyKey: "idem-1",
        sourceEventId: "evt-1",
        sourceClientMessageId: "client-message-1",
        owner: {
          id: "owner-1",
          kind: "owner_account",
        },
        targetProfileId: "agt-target",
        status: "dispatching",
        firstSeenAt: "2026-03-09T00:00:00.000Z",
        lastAttemptAt: "2026-03-09T00:00:01.000Z",
        attemptCount: 2,
        latestAttemptId: "attempt-2",
      },
      latestAttempt: {
        factSource: "dispatch_attempt",
        attemptId: "attempt-2",
        dispatchId: "dispatch-demo",
        idempotencyKey: "idem-1",
        attemptNo: 2,
        status: "waiting_result",
        daemonSessionId: "daemon-session-1",
        connectionGeneration: 1,
        leaseEpoch: 3,
        createdAt: "2026-03-09T00:00:01.000Z",
        startedAt: "2026-03-09T00:00:02.000Z",
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
      },
      executionIdentity: {
        factSource: "dispatch_attempt_execution_identity",
        authority: "authoritative",
        core: {
          modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
          spaceId: "space-demo",
          dispatchId: "dispatch-demo",
          targetProfileId: "agt-target",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
        },
      },
      runtimeCoordinatorExecution: null,
      runtimeCoordinatorCreationDiagnostics: [],
      runtimeCoordinatorEvents: [],
      runtimeCoordinatorHeadLifecycle: null,
      claimLease: null,
      result: {
        factSource: "dispatch_result",
        resultRef: "result-1",
        dispatchId: "dispatch-demo",
        resultKind: "final_text",
        publicOutcome: "succeeded",
        publishedSignalId: "sig-1",
        statusType: null,
        createdAt: "2026-03-09T00:00:04.000Z",
      },
      resultInbox: {
        factSource: "dispatch_result_inbox",
        resultKey: "dispatch-demo::attempt-2",
        dispatchId: "dispatch-demo",
        attemptId: "attempt-2",
        taskId: "task-demo",
        targetProfileId: "agt-target",
        daemonSessionId: "daemon-session-1",
        leaseEpoch: 3,
        submittedConnectionGeneration: 2,
        publishState: "reply_published",
        publishedSignalId: "sig-1",
        publicationErrorCode: null,
        acceptedAt: "2026-03-09T00:00:03.500Z",
        updatedAt: "2026-03-09T00:00:04.000Z",
      },
      recentOpsDecisions: [
        {
          factSource: "ops_decision",
          id: "ops-1",
          decisionCode: "dispatch.execution.lifecycle",
          decidedBy: "dispatch-execution-service",
          source: "core",
          decidedAt: "2026-03-09T00:00:03.000Z",
          correlationId: "dispatch-demo",
          expectedRecoveryCriteria: null,
        },
      ],
      streaming: {
        streamingMode: "stream",
        previewEmitted: true,
        firstStdoutAt: "2026-03-09T00:00:02.100Z",
        firstOutputAt: "2026-03-09T00:00:02.500Z",
      },
      runtime: {
        processId: 4321,
        processSpawnedAt: "2026-03-09T00:00:02.000Z",
        stdinClosedAt: "2026-03-09T00:00:02.010Z",
        firstStderrAt: null,
        exitObservedAt: null,
        exitCode: null,
        exitSignal: null,
        timeoutTriggeredAt: null,
      },
      execution: {
        phase: "running",
        phaseEnteredAt: "2026-03-09T00:00:02.050Z",
        lastLifecycleAt: "2026-03-09T00:00:03.000Z",
        progressEvidenceState: "active",
        timeoutPolicy: {
          startTimeoutMs: 30_000,
          waitWindowMs: 30_000,
          taskProgressEvidenceStaleAfterMs: 90_000,
          finalizationTimeoutMs: 30_000,
        },
      },
      origin: {
        agentControllerConversationId: "session-demo-1",
        agentControllerRef: "builtin:openclaw",
        agentControllerConversationKind: "session",
        resolvedAgentControllerConversationId: "agent:demo:space:demo",
        effectiveRuntimeWorkingDirectory: "/tmp/openmeld-openclaw",
        runtimeWorkspaceFingerprint: "sha256:openmeld-openclaw-workspace",
      },
      prompt: {
        fingerprint: "sha256:prompt-demo",
        length: 512,
        preview:
          "Space Dispatch Brief:\\n- Actions: Complete this Wake with exactly one final outcome",
      },
      dispatchExecution: {
        agentControllerConversationResume: {
          status: "continued",
        },
        localRuntimeContext: {
          status: "recreated",
          reason: "workspace_changed",
        },
        bootstrap: {
          status: "pending",
          reason: "compatibility_recreate",
        },
      },
      openClawBinding: {
        classification: "legacy",
        bindingSource: "daemon-launch",
        upgradeApplied: true,
      },
      openClawGatewayVisibility: {
        agentId: "openmeld-demo-bot",
        gatewayRestartAttempted: true,
        gatewayVisibility: "visible_after_restart",
      },
      structuredActionFailure: null,
      replySignal: {
        factSource: "space_signal_by_published_signal_id",
        signalId: "sig-1",
        profileId: "agt-target",
        profileKind: "agent",
        profileName: "Demo Bot",
        text: "All done.",
        createdAt: "2026-03-09T00:00:04.000Z",
      },
    },
  };
}

function createFinalVisibleTextMessage(): NonNullable<
  TraceSnapshot["finalVisibleMessage"]
> {
  return {
    factSource: "space_signal_by_published_signal_id",
    signalId: "sig-1",
    signalType: "signal.text",
    dispatchId: "dispatch-demo",
    targetProfileId: "agt-target",
    profileId: "agt-target",
    profileKind: "agent",
    profileName: "Demo Bot",
    text: "All done.",
    reasonCode: null,
    noticeType: null,
    statusType: null,
    createdAt: "2026-03-09T00:00:04.000Z",
  };
}

function createExecutionLinkedHeadLifecycle(input: {
  runtimeCoordinatorExecutionId: string;
}): NonNullable<TraceSnapshot["runtimeCoordinatorHeadLifecycle"]> {
  const targetWakeLifecycleId = "twl_v1|10:space-demo|5:evt-1|10:agt-target";
  return {
    createdAt: "2026-03-09T00:00:01.100Z",
    duplicateDispatchCount: 0,
    executionLinkedAt: "2026-03-09T00:00:01.400Z",
    factSource: "runtime_coordinator_head_lifecycle",
    modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
    noExecutionDecision: null,
    ownerUserId: "owner-1",
    primaryDispatchId: "dispatch-demo",
    publicationIntent: null,
    readStatus: "found",
    runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    status: "execution_linked",
    targetWakeLifecycleIdentity: {
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-demo",
      modelVersion: TARGET_WAKE_LIFECYCLE_IDENTITY_MODEL_VERSION,
      sourceSignalId: "evt-1",
      spaceId: "space-demo",
      targetProfileId: "agt-target",
      targetWakeLifecycleId,
    },
    targetWakeLifecycleId,
    updatedAt: "2026-03-09T00:00:01.400Z",
    waitingBoundary: null,
  };
}

function createReadOnlyTraceDependencies(
  traceResponse: SpaceDispatchTraceResponse
): Parameters<typeof runServiceTrace>[1] {
  return {
    requireProfile: vi.fn().mockResolvedValue(
      createProfile({
        openMeldProfileId: "hum-actor",
        profileName: "Felix",
        profileKind: "human",
      })
    ),
    fetchPrimaryBinding: vi.fn().mockResolvedValue({
      binding: {
        agentProfileId: "agt-target",
        authoritySource: "binding_truth",
        bindingId: "bind-trace-1",
        bindingState: "enabled_primary",
        dispatchEligibility: {
          reasonCodes: ["agent_profile_binding.enabled_primary"],
          routable: true,
          status: "routable",
        },
        grantsClaimSuccess: false,
        reasonCodes: ["agent_profile_binding.enabled_primary"],
        resolutionSource: "binding_truth",
        routable: true,
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
          },
        },
      },
      grantsClaimSuccess: false,
      status: "found",
    }),
    resolvePrepareReadinessEvidence: vi.fn().mockResolvedValue({
      nonRunnableCapabilityCount: 0,
      reasonCodes: ["runtime.ready"],
      runnableCapabilityCount: 1,
      source: "prepare_readiness_api",
      status: "ready",
    }),
    fetchTrace: vi.fn().mockResolvedValue(traceResponse),
    resolveProfile: vi.fn().mockResolvedValue(
      createProfile({
        openMeldProfileId: "agt-target",
        profileName: "Demo Bot",
        profileKind: "agent",
      })
    ),
  };
}

function createProfile(
  overrides: Partial<OpenMeldProfile> &
    Pick<OpenMeldProfile, "openMeldProfileId" | "profileName" | "profileKind">
): OpenMeldProfile {
  return createTestOpenMeldProfile({
    openMeldProfileId: overrides.openMeldProfileId,
    profileName: overrides.profileName,
    profileKind: overrides.profileKind,
    status: overrides.status ?? "active",
    ownerUserId: overrides.ownerUserId ?? "owner-1",
    ownerName: overrides.ownerName ?? "Owner",
    source: overrides.source ?? "cli_create",
    createdByUserId: overrides.createdByUserId ?? "owner-1",
    lastUsedAt: overrides.lastUsedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-03-09T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-09T00:00:00.000Z",
    ...(overrides.profileHandle
      ? { profileHandle: overrides.profileHandle }
      : {}),
  });
}

describe("service trace command", () => {
  beforeEach(() => {
    cancelMock.mockReset();
    isCancelMock.mockReset().mockReturnValue(false);
    promptForOpenMeldProfileSelectionMock.mockReset();
    resolveOpenMeldProfileMock.mockReset();
    resolveCurrentReplyReadinessSnapshotMock.mockReset();
    resolveRuntimeContextMock.mockReset();
    selectMock.mockReset();
    setSelectedOpenMeldProfileIdMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a readable trace card in human view", async () => {
    await withTempHome(async () => {
      emitDaemonDispatchJournalEvent({
        attemptId: "attempt-2",
        connectionGeneration: 2,
        daemonSessionId: "daemon-session-1",
        dispatchId: "dispatch-demo",
        leaseEpoch: 3,
        taskId: "task-demo",
        type: "dispatch.result.queued",
      });
      emitDaemonDispatchJournalEvent({
        attemptId: "attempt-2",
        connectionGeneration: 2,
        daemonSessionId: "daemon-session-1",
        dispatchId: "dispatch-demo",
        leaseEpoch: 3,
        metadata: {
          phase: "runtime_invocation_started",
        },
        profileId: "agt-target",
        taskId: "task-demo",
        type: "dispatch.local.phase",
      });
      emitDaemonDispatchJournalEvent({
        attemptId: "attempt-2",
        connectionGeneration: 2,
        daemonSessionId: "daemon-session-1",
        dispatchId: "dispatch-demo",
        leaseEpoch: 3,
        taskId: "task-demo",
        type: "dispatch.result.accepted",
      });
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot({
          daemonRouteObservation: {
            detail: null,
            observedAt: "2026-03-09T00:00:00.000Z",
            profileId: "agt-target",
            reasonCode: "online",
            route: {
              online: true,
              daemonSessionId: "daemon-session-1",
              deviceId: "device-1",
              lane: "dev-local",
              connectionGeneration: 1,
              leaseEpoch: 3,
              lastHeartbeatMs: 1,
              capabilities: {
                runtimeAdapters: [],
              },
              executionCompatibility: {
                expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
                observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
                reasonCode: "daemon.runtime_contract.compatible",
                status: "compatible",
              },
            },
            status: "online",
          },
          profileWorkspaceRuntimeResolution: {
            configPath: "/tmp/local-meta.json",
            configuredWorkspacePath: "/tmp/current-trace-workspace",
            effectiveRuntimeWorkingDirectory: "/tmp/current-trace-workspace",
            runtimeContext: {
              providerRuntimeWorkingDirectory: "/tmp/current-trace-workspace",
            },
            status: "ready",
            workspaceMode: "openmeld_managed",
          },
        })
      );
      const deliveredTraceResponse = createTraceResponse();
      if (!deliveredTraceResponse.trace?.resultInbox) {
        throw new Error("test fixture expected a trace payload");
      }
      deliveredTraceResponse.trace = {
        ...deliveredTraceResponse.trace,
        finalVisibleMessage: createFinalVisibleTextMessage(),
        resultInbox: {
          ...deliveredTraceResponse.trace.resultInbox,
          projectFailureContext: {
            bindingGeneration: "binding-project-1",
            projectId: "project-1",
          },
        },
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            space: "space-demo",
            dispatchId: "dispatch-demo",
            baseUrl: "https://gateway.openmeld.invalid",
            view: "human",
          },
          {
            requireProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "hum-actor",
                profileName: "Felix",
                profileKind: "human",
              })
            ),
            fetchPrimaryBinding: vi.fn().mockResolvedValue({
              binding: {
                agentProfileId: "agt-target",
                authoritySource: "binding_truth",
                bindingId: "bind-trace-1",
                bindingState: "enabled_primary",
                dispatchEligibility: {
                  reasonCodes: ["agent_profile_binding.enabled_primary"],
                  routable: true,
                  status: "routable",
                },
                grantsClaimSuccess: false,
                reasonCodes: ["agent_profile_binding.enabled_primary"],
                resolutionSource: "binding_truth",
                routable: true,
                executionTarget: {
                  agentControllerRef: "builtin:codex",
                  openMeldServiceRuntimeId: {
                    source: "runtime_registry_authority",
                    value: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
                  },
                },
              },
              grantsClaimSuccess: false,
              status: "found",
            }),
            resolvePrepareReadinessEvidence: vi.fn().mockResolvedValue({
              nonRunnableCapabilityCount: 0,
              reasonCodes: ["runtime.ready"],
              runnableCapabilityCount: 1,
              source: "prepare_readiness_api",
              status: "ready",
            }),
            fetchTrace: vi.fn().mockResolvedValue(deliveredTraceResponse),
            resolveProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "agt-target",
                profileName: "Demo Bot",
                profileKind: "agent",
              })
            ),
          }
        );
      });

      expect(resolveCurrentReplyReadinessSnapshotMock).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "https://gateway.openmeld.invalid",
          includeDaemonRouteObservation: true,
        })
      );

      expect(stdout).toContain("Wake Trace Diagnostics");
      expect(stdout).toContain("Actor: Felix (hum-actor) · human");
      expect(stdout).toContain("Target: Demo Bot");
      expect(stdout).toContain(
        `Correlation Model: ${OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION}`
      );
      expect(stdout).toContain(
        "Selector: dispatch · space=space-demo · dispatch=dispatch-demo"
      );
      expect(stdout).toContain(
        "Correlation Chain: space=space-demo -> client=client-message-1 -> source=evt-1 -> target=agt-target -> dispatch=dispatch-demo -> attempt=attempt-2 -> binding=binding-1 -> runtime=runtime-1 -> agentController=builtin:codex -> result=result-1 -> published=sig-1 -> reply=sig-1"
      );
      expect(stdout).not.toContain("Current Agent Reply Readiness");
      expect(stdout).not.toContain("Reply status: Ready");
      expect(stdout).not.toContain("Dispatch: succeeded");
      expect(stdout).not.toContain("Result Accepted:");
      expect(stdout).toContain("Dispatch Ledger Evidence: dispatching");
      expect(stdout).toContain("Final Visible Outcome: delivered");
      expect(stdout.indexOf("Final Visible Outcome:")).toBeLessThan(
        stdout.indexOf("Dispatch Ledger Evidence:")
      );
      expect(stdout.indexOf("Final Visible Outcome:")).toBeLessThan(
        stdout.indexOf("Latest Attempt:")
      );
      expect(stdout).toContain(
        "Current Local Reply Evidence: Local evidence: reply-capable"
      );
      expect(stdout).toContain(
        "Current Local Execution Diagnostics: Local binding, execution target, daemon route, and execution authority evidence only; not Core AgentExecutionReadiness and not this Wake's final result."
      );
      expect(stdout).toContain(
        "Current Local Execution Projection: Local evidence: reply-capable · This agent can reply from this computer."
      );
      expect(stdout).toContain(
        "Current Binding Evidence: Local agent connection is set."
      );
      expect(stdout).toContain(
        "Current Local Agent Capability: Local agent capability is current."
      );
      expect(stdout).toContain(
        "Current Daemon Route Evidence: OpenMeld Service is online for replies."
      );
      expect(stdout).toContain(
        "Current Wake Diagnostic: Wake has not been checked yet."
      );
      expect(stdout).toContain(
        "Current Local Service Link Evidence: Local evidence: reply-capable"
      );
      expect(stdout).toContain("Current Local Reply Route Evidence: Online");
      expect(stdout).toContain("Workspace: OpenMeld-managed");
      expect(stdout).toContain("Workspace Type: OpenMeld-managed");
      expect(stdout).toContain(
        "Workspace Folder: /tmp/current-trace-workspace"
      );
      expect(stdout).toContain(
        "Current Working Folder: /tmp/current-trace-workspace"
      );
      expect(stdout).toContain("Latest Attempt: waiting_result · no.2");
      expect(stdout).toContain(
        "Result Inbox Evidence: reply_published · dispatch-demo::attempt-2"
      );
      expect(stdout).toContain(
        "Default Project Failure Context: project-1 · binding binding-project-1"
      );
      expect(stdout).toContain(
        "Daemon Result Delivery Evidence: dispatch.result.queued/attempt-2@connection 2, dispatch.local.phase:runtime_invocation_started/attempt-2@connection 2, dispatch.result.accepted/attempt-2@connection 2"
      );
      expect(stdout).toContain("Streaming: stream · preview emitted");
      expect(stdout).toContain("Runtime: pid 4321 · no_timeout");
      expect(stdout).toContain("Execution: running · active");
      expect(stdout).toContain("Spawned: 2026-03-09T00:00:02.000Z");
      expect(stdout).toContain("Stdin Closed: 2026-03-09T00:00:02.010Z");
      expect(stdout).toContain("Exit: n/a");
      expect(stdout).toContain(
        "Agent Controller Conversation: builtin:openclaw/session · agent:demo:space:demo"
      );
      expect(stdout).toContain("Origin Context: session-demo-1");
      expect(stdout).toContain(
        "Dispatch Effective Runtime Working Directory: /tmp/openmeld-openclaw"
      );
      expect(stdout).toContain("Binding Classification: legacy");
      expect(stdout).toContain("Binding Source: daemon-launch");
      expect(stdout).toContain("Binding Upgrade: applied");
      expect(stdout).toContain(
        "OpenClaw Gateway: visible_after_restart · restart attempted"
      );
      expect(stdout).toContain("OpenClaw Agent: openmeld-demo-bot");
      expect(stdout).toContain("Prompt: sha256:prompt-demo · 512 chars");
      expect(stdout).toContain(
        "Prompt Preview: Space Dispatch Brief:\\n- Actions: Complete this Wake with exactly one final outcome"
      );
      expect(stdout).toContain("First Stdout: 2026-03-09T00:00:02.100Z");
      expect(stdout).toContain("First Output: 2026-03-09T00:00:02.500Z");
      expect(stdout).toContain(
        "Agent Controller Conversation Resume: continued"
      );
      expect(stdout).toContain(
        "Local Runtime Context: recreated · workspace_changed"
      );
      expect(stdout).toContain("Bootstrap: pending · compatibility_recreate");
      expect(stdout).toContain("Reply Signal: All done.");
      expect(stdout).toContain("Ops Decisions: dispatch.execution.lifecycle");
    });
  });

  it("renders a delivered final visible outcome from a verified Space final reply claim", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const traceResponse = createTraceResponse();
      if (!traceResponse.trace?.resultInbox) {
        throw new Error("expected trace fixture");
      }
      const resultInbox = traceResponse.trace.resultInbox;
      traceResponse.correlation = {
        ...traceResponse.correlation,
        resultRef: null,
        publishedSignalId: null,
        replySignalId: null,
      };
      traceResponse.trace = {
        ...traceResponse.trace,
        result: null,
        resultInbox: {
          ...resultInbox,
          publishState: "result_accepted",
          publishedSignalId: null,
          publicationErrorCode: null,
        },
        replySignal: null,
        finalVisibleMessage: {
          ...createFinalVisibleTextMessage(),
          factSource: "space_final_reply_claim",
          signalId: "sig-claim-final",
        },
        finalVisibleMessageLinkage: {
          status: "matched_final_reply_claim",
          reasonCode: "final_visible_message.matched_final_reply_claim",
          sourceFact: "space_final_reply_claim",
          candidateSignalIds: [],
          claimSignalId: "sig-claim-final",
          selectedSignalId: "sig-claim-final",
        },
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "human",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      expect(stdout).toContain("Final Visible Outcome: delivered");
      expect(stdout).toContain(
        "Final Visible Message: signal.text · sig-claim-final · All done."
      );
      expect(stdout).toContain(
        "Final Visible Linkage: matched_final_reply_claim · reason=final_visible_message.matched_final_reply_claim · source=space_final_reply_claim · claim=sig-claim-final · selected=sig-claim-final"
      );
      expect(stdout.indexOf("Final Visible Outcome:")).toBeLessThan(
        stdout.indexOf("Dispatch Ledger Evidence:")
      );
      expect(stdout).not.toContain("Root Cause: reply.not_found");
    });
  });

  it("surfaces final visible message linkage gaps above diagnostic evidence", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const traceResponse = createTraceResponse();
      if (!traceResponse.trace) {
        throw new Error("expected trace fixture");
      }
      traceResponse.trace = {
        ...traceResponse.trace,
        replySignal: null,
        finalVisibleMessage: null,
        finalVisibleMessageLinkage: {
          status: "linkage_missing",
          reasonCode: "final_visible_message.published_signal_missing",
          sourceFact: "published_signal_candidate",
          candidateSignalIds: ["sig-1"],
          claimSignalId: null,
          selectedSignalId: null,
        },
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "human",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      expect(stdout).toContain(
        "Final Visible Outcome: linkage missing · publication_unresolved"
      );
      expect(stdout).toContain(
        "Final Visible Linkage: linkage_missing · reason=final_visible_message.published_signal_missing · source=published_signal_candidate · candidates=sig-1"
      );
      expect(stdout).toContain(
        "Root Cause: final_visible_message.published_signal_missing"
      );
      expect(stdout.indexOf("Final Visible Outcome:")).toBeLessThan(
        stdout.indexOf("Dispatch Ledger Evidence:")
      );
      expect(stdout.indexOf("Final Visible Linkage:")).toBeLessThan(
        stdout.indexOf("Dispatch Ledger Evidence:")
      );
    });
  });

  it("tells agents to rerun trace when final projection is still pending", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "agent",
        resolvedView: "agent",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const traceResponse = createTraceResponse();
      if (!traceResponse.trace?.resultInbox) {
        throw new Error("expected trace fixture");
      }
      const resultInbox = traceResponse.trace.resultInbox;
      traceResponse.correlation = {
        ...traceResponse.correlation,
        resultRef: null,
        publishedSignalId: null,
        replySignalId: null,
      };
      traceResponse.trace = {
        ...traceResponse.trace,
        result: null,
        resultInbox: {
          ...resultInbox,
          publishState: "result_accepted",
          publishedSignalId: null,
          publicationErrorCode: null,
        },
        replySignal: null,
        finalVisibleMessage: null,
        finalVisibleMessageLinkage: {
          status: "projection_pending",
          reasonCode: "final_visible_message.projection_pending",
          sourceFact: "none",
          candidateSignalIds: [],
          claimSignalId: null,
          selectedSignalId: null,
        },
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "agent",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.trim().startsWith("{"))
        .map(
          (line) =>
            JSON.parse(line) as {
              code?: string;
              data?: unknown;
              payload?: unknown;
              text?: string;
            }
        );
      const summary = lines.find(
        (line) => line.code === "service.trace.summary"
      );
      expect(summary).toMatchObject({
        data: {
          diagnosticSummary: expect.stringContaining(
            "finalVisibleOutcome=not_applicable delivered=false"
          ),
        },
      });
      expect(summary).toMatchObject({
        data: {
          diagnosticSummary: expect.stringContaining(
            "finalVisibleLinkage=projection_pending"
          ),
        },
      });
      expect(summary?.text).toBe(
        "delivered=false visible_outcome=not_applicable current_state=final_projection_pending reason=final_visible_message.projection_pending next_action=wait - if the target computer is offline, this Wake is delivered automatically when its OpenMeld Service reconnects; rerun trace with the same selector to confirm"
      );
      expect(stdout).toContain("finalVisibleLinkage=projection_pending");
      expect(stdout).toContain(
        "delivered=false visible_outcome=not_applicable current_state=final_projection_pending reason=final_visible_message.projection_pending next_action=wait - if the target computer is offline, this Wake is delivered automatically when its OpenMeld Service reconnects; rerun trace with the same selector to confirm"
      );
    });
  });

  it("keeps an active RuntimeCoordinator execution ahead of final projection diagnostics", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "agent",
        resolvedView: "agent",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const traceResponse = createTraceResponse();
      if (!traceResponse.trace) {
        throw new Error("expected trace fixture");
      }
      traceResponse.correlation = {
        ...traceResponse.correlation,
        publishedSignalId: null,
        replySignalId: null,
        resultRef: null,
        runtimeCoordinatorExecutionId: "rce-demo-running",
      };
      traceResponse.trace = {
        ...traceResponse.trace,
        result: null,
        resultInbox: null,
        replySignal: null,
        finalVisibleMessage: null,
        finalVisibleMessageLinkage: {
          status: "projection_pending",
          reasonCode: "final_visible_message.projection_pending",
          sourceFact: "none",
          candidateSignalIds: [],
          claimSignalId: null,
          selectedSignalId: null,
        },
        runtimeCoordinatorExecution: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          createdAtMs: 1_762_473_599_000,
          dispatchId: "dispatch-demo",
          factSource: "runtime_coordinator_projection",
          legacyPointers: {
            attemptId: "attempt-2",
            claimLeaseId: null,
            connectionGeneration: 1,
            daemonSessionId: "daemon-session-1",
            leaseEpoch: 3,
          },
          modelVersion: "openmeld.runtime_coordinator.execution.v1",
          runtimeCoordinatorExecutionId: "rce-demo-running",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
          sourceClientMessageId: "client-message-1",
          spaceId: "space-demo",
          status: "running",
          targetProfileId: "agt-target",
          terminalOutcome: null,
          updatedAtMs: 1_762_473_604_000,
        },
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "agent",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      expect(stdout).toContain(
        "current_state=running reason=runtime_coordinator.running"
      );
      expect(stdout).not.toContain("current_state=final_projection_pending");
      expect(stdout).not.toContain("target computer is offline");
    });
  });

  it("keeps token-backed published replies anchored to the visible reply", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot({
          daemonRouteObservation: {
            detail: null,
            observedAt: "2026-03-09T00:00:00.000Z",
            profileId: "agt-target",
            reasonCode: "online",
            route: {
              online: true,
              daemonSessionId: "daemon-session-1",
              deviceId: "device-1",
              lane: "dev-local",
              connectionGeneration: 1,
              leaseEpoch: 3,
              lastHeartbeatMs: 1,
              capabilities: {
                runtimeAdapters: [],
              },
              executionCompatibility: {
                expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
                observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
                reasonCode: "daemon.runtime_contract.compatible",
                status: "compatible",
              },
            },
            status: "online",
          },
        })
      );
      const tokenTrace = createTraceResponse();
      if (!(tokenTrace.trace?.result && tokenTrace.trace.resultInbox)) {
        throw new Error("expected trace fixture with published result");
      }
      tokenTrace.correlation = {
        ...tokenTrace.correlation,
        runtimeCoordinatorExecutionId: "rce-demo-published",
        claimLeaseId: null,
      };
      tokenTrace.trace = {
        ...tokenTrace.trace,
        claimLease: null,
        executionIdentity: null,
        result: {
          ...tokenTrace.trace.result,
          publicOutcome: "post_message",
          resultKind: "space_action",
        },
        resultInbox: {
          ...tokenTrace.trace.resultInbox,
          publishState: "reply_published",
        },
        runtimeCoordinatorExecution: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          createdAtMs: 1_762_473_599_000,
          dispatchId: "dispatch-demo",
          factSource: "runtime_coordinator_projection",
          legacyPointers: {
            attemptId: "attempt-2",
            claimLeaseId: null,
            connectionGeneration: 1,
            daemonSessionId: "daemon-session-1",
            leaseEpoch: 3,
          },
          modelVersion: "openmeld.runtime_coordinator.execution.v1",
          runtimeCoordinatorExecutionId: "rce-demo-published",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
          sourceClientMessageId: "client-message-1",
          spaceId: "space-demo",
          status: "reply_published",
          targetProfileId: "agt-target",
          terminalOutcome: {
            kind: "reply_published",
            observedAtMs: 1_762_473_604_000,
            reasonCode: null,
          },
          updatedAtMs: 1_762_473_604_000,
        },
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            space: "space-demo",
            dispatchId: "dispatch-demo",
            baseUrl: "https://gateway.openmeld.invalid",
            view: "human",
          },
          {
            requireProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "hum-actor",
                profileName: "Felix",
                profileKind: "human",
              })
            ),
            fetchPrimaryBinding: vi.fn().mockResolvedValue({
              binding: {
                agentProfileId: "agt-target",
                authoritySource: "binding_truth",
                bindingId: "bind-trace-1",
                bindingState: "enabled_primary",
                dispatchEligibility: {
                  reasonCodes: ["agent_profile_binding.enabled_primary"],
                  routable: true,
                  status: "routable",
                },
                grantsClaimSuccess: false,
                reasonCodes: ["agent_profile_binding.enabled_primary"],
                resolutionSource: "binding_truth",
                routable: true,
                executionTarget: {
                  agentControllerRef: "builtin:codex",
                  openMeldServiceRuntimeId: {
                    source: "runtime_registry_authority",
                    value: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
                  },
                },
              },
              grantsClaimSuccess: false,
              status: "found",
            }),
            resolvePrepareReadinessEvidence: vi.fn().mockResolvedValue({
              nonRunnableCapabilityCount: 0,
              reasonCodes: ["runtime.ready"],
              runnableCapabilityCount: 1,
              source: "prepare_readiness_api",
              status: "ready",
            }),
            fetchTrace: vi.fn().mockResolvedValue(tokenTrace),
            resolveProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "agt-target",
                profileName: "Demo Bot",
                profileKind: "agent",
              })
            ),
          }
        );
      });

      expect(stdout).toContain(
        "Current Local Execution Projection: Local evidence: reply-capable · This agent can reply from this computer."
      );
      expect(stdout).toContain(
        "Current Wake Diagnostic: Local evidence says Wake can be attempted from this computer."
      );
      expect(stdout).toContain("Dispatch Result Evidence: post_message");
      expect(stdout).not.toContain(
        "Current Local Execution Projection: Local evidence: blocked"
      );
      expect(stdout).not.toContain("Wake execution authority is missing");
    });
  });

  it("keeps running RuntimeCoordinator executions anchored to RuntimeCoordinator state", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot({
          daemonRouteObservation: {
            detail: null,
            observedAt: "2026-03-09T00:00:00.000Z",
            profileId: "agt-target",
            reasonCode: "online",
            route: {
              online: true,
              daemonSessionId: "daemon-session-1",
              deviceId: "device-1",
              lane: "dev-local",
              connectionGeneration: 1,
              leaseEpoch: 3,
              lastHeartbeatMs: 1,
              capabilities: {
                runtimeAdapters: [],
              },
              executionCompatibility: {
                expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
                observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
                reasonCode: "daemon.runtime_contract.compatible",
                status: "compatible",
              },
            },
            status: "online",
          },
        })
      );
      const tokenTrace = createTraceResponse();
      if (!tokenTrace.trace) {
        throw new Error("expected trace fixture");
      }
      tokenTrace.correlation = {
        ...tokenTrace.correlation,
        claimLeaseId: null,
        publishedSignalId: null,
        replySignalId: null,
        resultRef: null,
        runtimeCoordinatorExecutionId: "rce-demo-running",
      };
      tokenTrace.trace = {
        ...tokenTrace.trace,
        claimLease: null,
        result: null,
        resultInbox: null,
        replySignal: null,
        runtimeCoordinatorExecution: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          createdAtMs: 1_762_473_599_000,
          dispatchId: "dispatch-demo",
          factSource: "runtime_coordinator_projection",
          legacyPointers: {
            attemptId: "attempt-2",
            claimLeaseId: null,
            connectionGeneration: 1,
            daemonSessionId: "daemon-session-1",
            leaseEpoch: 3,
          },
          modelVersion: "openmeld.runtime_coordinator.execution.v1",
          runtimeCoordinatorExecutionId: "rce-demo-running",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
          sourceClientMessageId: "client-message-1",
          spaceId: "space-demo",
          status: "running",
          targetProfileId: "agt-target",
          terminalOutcome: null,
          updatedAtMs: 1_762_473_604_000,
        },
        runtimeCoordinatorHeadLifecycle: createExecutionLinkedHeadLifecycle({
          runtimeCoordinatorExecutionId: "rce-demo-running",
        }),
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            space: "space-demo",
            dispatchId: "dispatch-demo",
            baseUrl: "https://gateway.openmeld.invalid",
            view: "human",
          },
          {
            requireProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "hum-actor",
                profileName: "Felix",
                profileKind: "human",
              })
            ),
            fetchPrimaryBinding: vi.fn().mockResolvedValue({
              binding: {
                agentProfileId: "agt-target",
                authoritySource: "binding_truth",
                bindingId: "bind-trace-1",
                bindingState: "enabled_primary",
                dispatchEligibility: {
                  reasonCodes: ["agent_profile_binding.enabled_primary"],
                  routable: true,
                  status: "routable",
                },
                grantsClaimSuccess: false,
                reasonCodes: ["agent_profile_binding.enabled_primary"],
                resolutionSource: "binding_truth",
                routable: true,
                executionTarget: {
                  agentControllerRef: "builtin:codex",
                  openMeldServiceRuntimeId: {
                    source: "runtime_registry_authority",
                    value: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
                  },
                },
              },
              grantsClaimSuccess: false,
              status: "found",
            }),
            resolvePrepareReadinessEvidence: vi.fn().mockResolvedValue({
              nonRunnableCapabilityCount: 0,
              reasonCodes: ["runtime.ready"],
              runnableCapabilityCount: 1,
              source: "prepare_readiness_api",
              status: "ready",
            }),
            fetchTrace: vi.fn().mockResolvedValue(tokenTrace),
            resolveProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "agt-target",
                profileName: "Demo Bot",
                profileKind: "agent",
              })
            ),
          }
        );
      });

      expect(stdout).toContain(
        "RuntimeCoordinator Execution: rce-demo-running · running"
      );
      expect(stdout).toContain("RuntimeCoordinator Head: execution_linked");
      expect(stdout).toContain("Root Cause: runtime_coordinator.running");
      expect(stdout).not.toContain(
        "Root Cause: runtime_coordinator.head_execution_linked"
      );
      expect(stdout).not.toContain("Root Cause: attempt.waiting_result");
      expect(stdout).toContain(
        "Current Local Execution Projection: Local evidence: reply-capable · This agent can reply from this computer."
      );
      expect(stdout).not.toContain(
        "Current Local Execution Projection: Local evidence: blocked"
      );
      expect(stdout).not.toContain("Wake execution authority is missing");
    });
  });

  it("renders RuntimeCoordinator token diagnostics without retired claim output", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const tokenTrace = createTraceResponse();
      if (!tokenTrace.trace) {
        throw new Error("expected trace fixture");
      }
      tokenTrace.trace.runtimeCoordinatorExecution = {
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        createdAtMs: 1_762_473_599_000,
        dispatchId: "dispatch-demo",
        factSource: "runtime_coordinator_projection",
        legacyPointers: {
          attemptId: "attempt-2",
          claimLeaseId: null,
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-1",
          leaseEpoch: 3,
        },
        modelVersion: "openmeld.runtime_coordinator.execution.v1",
        runtimeCoordinatorExecutionId: "rce-demo",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-1",
        },
        sourceClientMessageId: "client-message-1",
        spaceId: "space-demo",
        status: "result_accepted",
        targetProfileId: "agt-target",
        terminalOutcome: {
          kind: "reply_published",
          observedAtMs: 1_762_473_604_000,
          reasonCode: "reply_published",
        },
        updatedAtMs: 1_762_473_604_000,
      };
      tokenTrace.trace.runtimeCoordinatorHeadLifecycle =
        createExecutionLinkedHeadLifecycle({
          runtimeCoordinatorExecutionId: "rce-demo",
        });
      tokenTrace.correlation.runtimeCoordinatorExecutionId = "rce-demo";
      tokenTrace.trace.runtimeCoordinatorEvents = [
        {
          eventId: "event-token-issued",
          eventType: "execution_token_issued",
          factSource: "runtime_coordinator_projection",
          idempotencyKey: "rce-demo::run-1",
          observedAtMs: 1_762_473_600_000,
          payloadJson: JSON.stringify({
            runId: "run-1",
            tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaa",
            tokenStatus: "active",
          }),
          reasonCode: "execution_token_issued",
          runtimeCoordinatorExecutionId: "rce-demo",
          statusAfter: "delivery_accepted",
        },
        {
          eventId: "event-token-superseded",
          eventType: "execution_token_validation_failed",
          factSource: "runtime_coordinator_projection",
          idempotencyKey: "rce-demo::run-old::late-result",
          observedAtMs: 1_762_473_601_000,
          payloadJson: JSON.stringify({
            ignoredEventSummary: "late result ignored",
            runId: "run-old",
            tokenFingerprint: "etfp_v1_bbbbbbbbbbbbbbbb",
            tokenStatus: "superseded",
          }),
          reasonCode: "execution_token_superseded",
          runtimeCoordinatorExecutionId: "rce-demo",
          statusAfter: null,
        },
        {
          eventId: "event-token-terminal-late",
          eventType: "execution_token_terminal_late",
          factSource: "runtime_coordinator_projection",
          idempotencyKey: "rce-demo::run-old::after-terminal",
          observedAtMs: 1_762_473_602_000,
          payloadJson: JSON.stringify({
            ignoredEventSummary: "arrived after final reply",
            runId: "run-old",
            tokenFingerprint: "etfp_v1_bbbbbbbbbbbbbbbb",
            tokenStatus: "terminal",
          }),
          reasonCode: "execution_token_terminal_late",
          runtimeCoordinatorExecutionId: "rce-demo",
          statusAfter: "result_accepted",
        },
        {
          eventId: "event-owner-conflict-stale",
          eventType: "owner_conflict_stale_token",
          factSource: "runtime_coordinator_projection",
          idempotencyKey: "rce-demo::run-old::owner-conflict",
          observedAtMs: 1_762_473_603_000,
          payloadJson: JSON.stringify({
            tokenFingerprint: "etfp_v1_bbbbbbbbbbbbbbbb",
            tokenStatus: "superseded",
          }),
          reasonCode: "owner_conflict.stale_token",
          runtimeCoordinatorExecutionId: "rce-demo",
          statusAfter: null,
        },
      ];

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
          },
          {
            requireProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "hum-actor",
                profileName: "Felix",
                profileKind: "human",
              })
            ),
            fetchTrace: vi.fn().mockResolvedValue(tokenTrace),
            resolveProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "agt-target",
                profileName: "Demo Bot",
                profileKind: "agent",
              })
            ),
          }
        );
      });

      expect(stdout).toContain(
        "RuntimeCoordinator Execution: rce-demo · result_accepted"
      );
      expect(stdout).toContain("RuntimeCoordinator Head: execution_linked");
      expect(stdout).toContain(
        "Root Cause: final_visible_outcome.publication_unresolved"
      );
      expect(stdout).toContain(
        "Final Visible Outcome: not delivered · publication_unresolved"
      );
      expect(stdout).not.toContain(
        "Root Cause: runtime_coordinator.head_execution_linked"
      );
      expect(stdout).toContain(
        "Execution Token: status=terminal · fingerprint=etfp_v1_bbbbbbbbbbbbbbbb · run=run-old · reason=execution_token_terminal_late · event=execution_token_terminal_late"
      );
      expect(stdout).toContain(
        "Ignored Runtime Events: execution_token_validation_failed:execution_token_superseded status=superseded fingerprint=etfp_v1_bbbbbbbbbbbbbbbb, execution_token_terminal_late:execution_token_terminal_late status=terminal fingerprint=etfp_v1_bbbbbbbbbbbbbbbb, owner_conflict_stale_token:owner_conflict.stale_token status=superseded fingerprint=etfp_v1_bbbbbbbbbbbbbbbb"
      );
      expect(stdout).not.toContain("Final Claim");
      expect(stdout).not.toContain("rcet_v1_");
      expect(stdout).not.toContain("Execution Permit");
    });
  });

  it("renders result publication retrying diagnostics without implying a visible failure", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const traceResponse = createTraceResponse();
      if (!(traceResponse.trace?.result && traceResponse.trace.resultInbox)) {
        throw new Error("expected result and inbox fixture");
      }
      traceResponse.correlation = {
        ...traceResponse.correlation,
        publishedSignalId: null,
        replySignalId: null,
        runtimeCoordinatorExecutionId: "rce-demo-publication-retrying",
      };
      traceResponse.trace = {
        ...traceResponse.trace,
        runtimeCoordinatorExecution: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          createdAtMs: 1_762_473_599_000,
          dispatchId: "dispatch-demo",
          factSource: "runtime_coordinator_projection",
          legacyPointers: {
            attemptId: "attempt-2",
            claimLeaseId: null,
            connectionGeneration: 1,
            daemonSessionId: "daemon-session-1",
            leaseEpoch: 3,
          },
          modelVersion: "openmeld.runtime_coordinator.execution.v1",
          runtimeCoordinatorExecutionId: "rce-demo-publication-retrying",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
          sourceClientMessageId: "client-message-1",
          spaceId: "space-demo",
          status: "result_accepted",
          targetProfileId: "agt-target",
          terminalOutcome: null,
          updatedAtMs: 1_762_473_604_000,
        },
        result: {
          ...traceResponse.trace.result,
          publicOutcome: "post_message",
          publishedSignalId: null,
        },
        resultInbox: {
          ...traceResponse.trace.resultInbox,
          publishState: "reply_publication_failed",
          publicationErrorCode: "space.signal.persist_failed",
          publishedSignalId: null,
        },
        replySignal: null,
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "human",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      expect(stdout).toContain(
        "Final Visible Outcome: publishing retrying · publication_retrying"
      );
      expect(stdout).toContain(
        "Publication Closure: publishing retrying · publication_retrying · success_reply · diagnostic_only · no Space-visible final outcome"
      );
      expect(stdout).toContain(
        "Publication Diagnostic Evidence: success_reply · source=result_inbox · reason=final_visible_outcome.publication_retrying · detail=space.signal.persist_failed · error=space.signal.persist_failed · sourceStatus=reply_publication_failed"
      );
      expect(stdout).toContain(
        "Result Publication Diagnostic Evidence: reply_publication_failed · dispatch-demo::attempt-2 · error=space.signal.persist_failed"
      );
      expect(stdout).not.toContain("visible_failure");
      expect(stdout).not.toContain("user-visible failure");
    });
  });

  it("renders RuntimeCoordinator publication blocker evidence for unresolved publications", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const traceResponse = createTraceResponse();
      if (!traceResponse.trace) {
        throw new Error("expected trace fixture");
      }
      traceResponse.correlation = {
        ...traceResponse.correlation,
        publishedSignalId: null,
        replySignalId: null,
        runtimeCoordinatorExecutionId: "rce-demo-publication-blocked",
      };
      traceResponse.trace = {
        ...traceResponse.trace,
        result: null,
        resultInbox: null,
        replySignal: null,
        runtimeCoordinatorExecution: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          createdAtMs: 1_762_473_599_000,
          dispatchId: "dispatch-demo",
          factSource: "runtime_coordinator_projection",
          legacyPointers: {
            attemptId: "attempt-2",
            claimLeaseId: null,
            connectionGeneration: 1,
            daemonSessionId: "daemon-session-1",
            leaseEpoch: 3,
          },
          modelVersion: "openmeld.runtime_coordinator.execution.v1",
          runtimeCoordinatorExecutionId: "rce-demo-publication-blocked",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
          sourceClientMessageId: "client-message-1",
          spaceId: "space-demo",
          status: "result_accepted",
          targetProfileId: "agt-target",
          terminalOutcome: null,
          updatedAtMs: 1_762_473_604_000,
        },
        runtimeCoordinatorEvents: [
          {
            eventId: "event-publication-blocker",
            eventType: "runtime_coordinator_decision_recorded",
            factSource: "runtime_coordinator_projection",
            idempotencyKey: "publication-blocker:finalization:rcfc-demo",
            observedAtMs: 1_762_473_605_000,
            payloadJson: JSON.stringify({
              blockerId: "finalization:rcfc-demo",
              blockerKind: "publication_unavailable",
              dispatchId: "dispatch-demo",
              publicationKind: "success_reply",
              reasonCode: "runtime_coordinator.publication_retry_exhausted",
              spaceId: "space-demo",
              status: "unresolved_publication_failure",
              targetProfileId: "agt-target",
              targetWakeLifecycleId: "twl-demo",
            }),
            reasonCode: "runtime_coordinator.publication_unresolved",
            runtimeCoordinatorExecutionId: "rce-demo-publication-blocked",
            statusAfter: null,
          },
        ],
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "human",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      expect(stdout).toContain(
        "Final Visible Outcome: not delivered · publication_unresolved"
      );
      expect(stdout).toContain(
        "Publication Diagnostic Evidence: success_reply · source=runtime_coordinator_event · reason=final_visible_outcome.publication_unresolved · detail=runtime_coordinator.publication_retry_exhausted · sourceStatus=unresolved_publication_failure"
      );
      expect(stdout).toContain(
        "RuntimeCoordinator Publication Blocker Evidence: finalization:rcfc-demo · publication_unavailable · success_reply · unresolved_publication_failure · reason=runtime_coordinator.publication_retry_exhausted · target=agt-target · targetWake=twl-demo"
      );
      expect(stdout).toContain(
        "Finalization Command Evidence: rcfc-demo · diagnostic_only"
      );
      expect(stdout).not.toContain("visible_failure");
    });
  });

  it("renders head failure publication exhaustion diagnostics", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const traceResponse = createTraceResponse();
      if (!traceResponse.trace) {
        throw new Error("expected trace fixture");
      }
      const targetWakeLifecycleId =
        "twl_v1|10:space-demo|5:evt-1|10:agt-target";
      traceResponse.correlation = {
        ...traceResponse.correlation,
        publishedSignalId: null,
        replySignalId: null,
        runtimeCoordinatorExecutionId: null,
      };
      traceResponse.trace = {
        ...traceResponse.trace,
        result: null,
        resultInbox: null,
        replySignal: null,
        runtimeCoordinatorExecution: null,
        runtimeCoordinatorHeadLifecycle: {
          createdAt: "2026-03-09T00:00:01.100Z",
          duplicateDispatchCount: 0,
          executionLinkedAt: null,
          factSource: "runtime_coordinator_head_lifecycle",
          modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
          noExecutionDecision: {
            decidedAt: "2026-03-09T00:00:01.200Z",
            publicationCategory: "service_not_connected",
            reasonCode: "daemon.profile.offline",
            source: "runtime_coordinator_head_waiting_deadline",
            userRecoveryAction: "start_or_restart_openmeld_service",
          },
          ownerUserId: "owner-1",
          primaryDispatchId: "dispatch-demo",
          publicationExhaustion: {
            attemptCount: 60,
            exhaustedAt: "2026-03-09T00:05:01.000Z",
            lastFailureAt: "2026-03-09T00:05:00.000Z",
            lastReasonCode:
              "runtime_coordinator.failure_publication_unavailable",
            reasonCode: "runtime_coordinator.publication_retry_exhausted",
            status: "publication_exhausted",
          },
          publicationIntent: {
            intentId: "publication-intent-1",
            kind: "no_execution_failure",
            publicationCategory: "service_not_connected",
            readyAt: "2026-03-09T00:00:01.300Z",
            reasonCode: "daemon.profile.offline",
            status: "ready_for_phase_6",
            userRecoveryAction: "start_or_restart_openmeld_service",
          },
          publicationOutcome: {
            failurePublicationCommandId: "failure-command-1",
            finalMessageKind: null,
            observedAt: "2026-03-09T00:05:00.000Z",
            publicationErrorCode:
              "runtime_coordinator.failure_publication_unavailable",
            publishedSignalId: null,
            status: "failure_publication_failed",
          },
          readStatus: "found",
          runtimeCoordinatorExecutionId: null,
          status: "publication_intent_ready",
          targetWakeLifecycleIdentity: {
            clientMessageId: "client-message-1",
            dispatchId: "dispatch-demo",
            modelVersion: TARGET_WAKE_LIFECYCLE_IDENTITY_MODEL_VERSION,
            sourceSignalId: "evt-1",
            spaceId: "space-demo",
            targetProfileId: "agt-target",
            targetWakeLifecycleId,
          },
          targetWakeLifecycleId,
          updatedAt: "2026-03-09T00:05:01.000Z",
          waitingBoundary: null,
        },
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "human",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      expect(stdout).toContain(
        "Final Visible Outcome: not delivered · publication_unresolved"
      );
      expect(stdout).toContain(
        "Publication Diagnostic Evidence: failure_notice · source=runtime_coordinator_head_lifecycle · reason=final_visible_outcome.publication_unresolved · detail=runtime_coordinator.publication_retry_exhausted · sourceStatus=publication_exhausted"
      );
      expect(stdout).toContain(
        "Failure Publication Command Evidence: failure-command-1 · failure_publication_failed · unknown_message_kind · error=runtime_coordinator.failure_publication_unavailable"
      );
      expect(stdout).toContain(
        "Publication Exhaustion Evidence: publication_exhausted · attempts 60 · exhausted=2026-03-09T00:05:01.000Z · lastFailure=2026-03-09T00:05:00.000Z · lastReason=runtime_coordinator.failure_publication_unavailable"
      );
      expect(stdout).not.toContain("visible_failure");
    });
  });

  it("explains missing RuntimeCoordinator authority instead of guessing from legacy attempt failure", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "agent",
        resolvedView: "agent",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const traceResponse = createTraceResponse();
      if (!(traceResponse.trace?.latestAttempt && traceResponse.trace.result)) {
        throw new Error("expected latest attempt and result fixture");
      }
      traceResponse.trace = {
        ...traceResponse.trace,
        dispatch: {
          ...traceResponse.trace.dispatch,
          status: "failed_terminal",
        },
        latestAttempt: {
          ...traceResponse.trace.latestAttempt,
          status: "failed_terminal",
          errorCode: "queue.dlq.exhausted",
        },
        runtimeCoordinatorExecution: null,
        runtimeCoordinatorCreationDiagnostics: [
          {
            modelVersion: RUNTIME_COORDINATOR_CREATION_DIAGNOSTIC_MODEL_VERSION,
            factSource: "runtime_coordinator_projection",
            spaceId: "space-demo",
            dispatchId: "dispatch-demo",
            targetProfileId: "agt-target",
            sourceClientMessageId: "client-message-1",
            creationStatus: "not_created",
            reasonCode: "runtime_coordinator.authority_unavailable",
            observedAtMs: 1_762_473_600_000,
            legacyAttemptId: "attempt-2",
          },
        ],
        result: null,
        resultInbox: null,
        replySignal: null,
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "agent",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      expect(stdout).toContain(
        "rootCause=runtime_coordinator.authority_unavailable"
      );
      expect(stdout).not.toContain("rootCause=queue.dlq.exhausted");
      expect(stdout).not.toContain("rootCause=attempt.failed_terminal");
    });
  });

  it("shows RuntimeCoordinator head no-execution intent without claiming final Space publication", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const traceResponse = createTraceResponse();
      if (!traceResponse.trace) {
        throw new Error("expected trace fixture");
      }
      const targetWakeLifecycleId =
        "twl_v1|10:space-demo|5:evt-1|10:agt-target";
      traceResponse.correlation = {
        ...traceResponse.correlation,
        bindingId: null,
        agentControllerRef: null,
        claimLeaseId: null,
        latestAttemptId: null,
        publishedSignalId: null,
        replySignalId: null,
        resultRef: null,
        openMeldServiceRuntimeId: null,
      };
      traceResponse.trace = {
        ...traceResponse.trace,
        claimLease: null,
        dispatch: {
          ...traceResponse.trace.dispatch,
          latestAttemptId: null,
          status: "failed_terminal",
        },
        execution: null,
        executionIdentity: null,
        latestAttempt: null,
        result: null,
        resultInbox: null,
        replySignal: null,
        runtime: null,
        runtimeCoordinatorCreationDiagnostics: [
          {
            modelVersion: RUNTIME_COORDINATOR_CREATION_DIAGNOSTIC_MODEL_VERSION,
            factSource: "runtime_coordinator_projection",
            spaceId: "space-demo",
            dispatchId: "dispatch-demo",
            targetProfileId: "agt-target",
            sourceClientMessageId: "client-message-1",
            creationStatus: "not_created",
            reasonCode: "runtime_coordinator.authority_unavailable",
            observedAtMs: 1_762_473_600_000,
            legacyAttemptId: "attempt-2",
          },
        ],
        runtimeCoordinatorHeadLifecycle: {
          createdAt: "2026-03-09T00:00:01.100Z",
          duplicateDispatchCount: 0,
          executionLinkedAt: null,
          factSource: "runtime_coordinator_head_lifecycle",
          modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
          noExecutionDecision: {
            decidedAt: "2026-03-09T00:00:01.200Z",
            publicationCategory: "binding_required",
            reasonCode: "agent_profile_binding.missing",
            source: "dispatch_preflight",
            userRecoveryAction: "set_up_agent_binding",
          },
          ownerUserId: "owner-1",
          primaryDispatchId: "dispatch-demo",
          publicationIntent: {
            intentId: `${targetWakeLifecycleId}::no-execution-failure`,
            kind: "no_execution_failure",
            publicationCategory: "binding_required",
            readyAt: "2026-03-09T00:00:01.300Z",
            reasonCode: "agent_profile_binding.missing",
            status: "ready_for_phase_6",
            userRecoveryAction: "set_up_agent_binding",
          },
          readStatus: "found",
          runtimeCoordinatorExecutionId: null,
          status: "publication_intent_ready",
          targetWakeLifecycleIdentity: {
            clientMessageId: "client-message-1",
            dispatchId: "dispatch-demo",
            modelVersion: TARGET_WAKE_LIFECYCLE_IDENTITY_MODEL_VERSION,
            sourceSignalId: "evt-1",
            spaceId: "space-demo",
            targetProfileId: "agt-target",
            targetWakeLifecycleId,
          },
          targetWakeLifecycleId,
          updatedAt: "2026-03-09T00:00:01.300Z",
          waitingBoundary: null,
        },
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "human",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      expect(stdout).toContain(
        "Root Cause: final_visible_outcome.publication_pending"
      );
      expect(stdout).toContain(
        "Final Visible Outcome: publishing · publication_pending"
      );
      expect(stdout).toContain(
        "RuntimeCoordinator Head: publication_intent_ready"
      );
      expect(stdout).toContain("noExecution=agent_profile_binding.missing");
      expect(stdout).toContain(
        "Head Publication Intent: ready_for_phase_6 · binding_required · agent_profile_binding.missing · set_up_agent_binding"
      );
      expect(stdout).toContain(
        "RuntimeCoordinator Creation Diagnostic: diagnostic_only · runtime_coordinator.authority_unavailable"
      );
      expect(stdout).not.toContain(
        "Root Cause: runtime_coordinator.authority_unavailable"
      );
      expect(stdout).not.toContain("RuntimeCoordinator Execution: not_created");
      expect(stdout).not.toContain("Root Cause: reply.delivered");
      expect(stdout).not.toContain("Root Cause: reply.not_found");
    });
  });

  it("shows unavailable RuntimeCoordinator head authority without rebuilding truth from D1", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "agent",
        resolvedView: "agent",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const traceResponse = createTraceResponse();
      if (!(traceResponse.trace?.latestAttempt && traceResponse.trace.result)) {
        throw new Error("expected latest attempt and result fixture");
      }
      traceResponse.trace = {
        ...traceResponse.trace,
        dispatch: {
          ...traceResponse.trace.dispatch,
          status: "failed_terminal",
        },
        latestAttempt: {
          ...traceResponse.trace.latestAttempt,
          status: "failed_terminal",
          errorCode: "queue.dlq.exhausted",
        },
        result: null,
        resultInbox: null,
        replySignal: null,
        runtimeCoordinatorHeadLifecycle: {
          factSource: "runtime_coordinator_head_lifecycle",
          readStatus: "authority_unavailable",
          reasonCode: "runtime_coordinator.head_lifecycle_trace_unavailable",
          targetWakeLifecycleId: "twl_v1|10:space-demo|5:evt-1|10:agt-target",
        },
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "agent",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      expect(stdout).toContain(
        "rootCause=runtime_coordinator.head_lifecycle_trace_unavailable"
      );
      expect(stdout).toContain(
        "head=authority_unavailable:runtime_coordinator.head_lifecycle_trace_unavailable"
      );
      expect(stdout).not.toContain("rootCause=queue.dlq.exhausted");
      expect(stdout).not.toContain("rootCause=attempt.failed_terminal");
    });
  });

  it("keeps retryable Queue and creation diagnostics below an accepted RuntimeCoordinator head", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "agent",
        resolvedView: "agent",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const traceResponse = createTraceResponse();
      if (!(traceResponse.trace?.latestAttempt && traceResponse.trace.result)) {
        throw new Error("expected latest attempt and result fixture");
      }
      const targetWakeLifecycleId =
        "twl_v1|10:space-demo|5:evt-1|10:agt-target";
      traceResponse.trace = {
        ...traceResponse.trace,
        dispatch: {
          ...traceResponse.trace.dispatch,
          status: "failed_retryable",
        },
        latestAttempt: {
          ...traceResponse.trace.latestAttempt,
          status: "failed_retryable",
          errorCode: "daemon.profile.offline",
        },
        result: null,
        resultInbox: null,
        replySignal: null,
        runtimeCoordinatorCreationDiagnostics: [
          {
            modelVersion: RUNTIME_COORDINATOR_CREATION_DIAGNOSTIC_MODEL_VERSION,
            factSource: "runtime_coordinator_projection",
            spaceId: "space-demo",
            dispatchId: "dispatch-demo",
            targetProfileId: "agt-target",
            sourceClientMessageId: "client-message-1",
            creationStatus: "not_created",
            reasonCode: "queue.dlq.exhausted",
            observedAtMs: 1_762_473_600_000,
            legacyAttemptId: "attempt-2",
          },
        ],
        runtimeCoordinatorHeadLifecycle: {
          createdAt: "2026-03-09T00:00:01.100Z",
          duplicateDispatchCount: 0,
          executionLinkedAt: null,
          factSource: "runtime_coordinator_head_lifecycle",
          modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
          noExecutionDecision: null,
          ownerUserId: "owner-1",
          primaryDispatchId: "dispatch-demo",
          publicationIntent: null,
          readStatus: "found",
          runtimeCoordinatorExecutionId: null,
          status: "accepted",
          targetWakeLifecycleIdentity: {
            clientMessageId: "client-message-1",
            dispatchId: "dispatch-demo",
            modelVersion: TARGET_WAKE_LIFECYCLE_IDENTITY_MODEL_VERSION,
            sourceSignalId: "evt-1",
            spaceId: "space-demo",
            targetProfileId: "agt-target",
            targetWakeLifecycleId,
          },
          targetWakeLifecycleId,
          updatedAt: "2026-03-09T00:00:01.300Z",
          waitingBoundary: null,
        },
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "agent",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      expect(stdout).toContain("rootCause=runtime_coordinator.head_accepted");
      expect(stdout).toContain("head=accepted");
      expect(stdout).not.toContain("rootCause=daemon.profile.offline");
      expect(stdout).not.toContain("rootCause=queue.dlq.exhausted");
    });
  });

  it("keeps local service identity mismatch diagnostic evidence below an accepted RuntimeCoordinator head", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot({
          daemonRouteObservation: {
            detail: null,
            observedAt: "2026-03-09T00:00:00.000Z",
            profileId: "agt-target",
            reasonCode: "online",
            route: {
              online: true,
              daemonSessionId: "daemon-session-1",
              deviceId: "device-1",
              lane: "dev-local",
              connectionGeneration: 1,
              leaseEpoch: 3,
              lastHeartbeatMs: 1,
              capabilities: { runtimeAdapters: [] },
              executionCompatibility: {
                expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
                observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
                reasonCode: "daemon.runtime_contract.compatible",
                status: "compatible",
              },
            },
            status: "online",
          },
        })
      );
      const traceResponse = createTraceResponse();
      if (!(traceResponse.trace?.latestAttempt && traceResponse.trace.result)) {
        throw new Error("expected latest attempt and result fixture");
      }
      const targetWakeLifecycleId =
        "twl_v1|10:space-demo|5:evt-1|10:agt-target";
      traceResponse.trace = {
        ...traceResponse.trace,
        dispatch: {
          ...traceResponse.trace.dispatch,
          status: "failed_retryable",
        },
        execution: null,
        executionIdentity: null,
        latestAttempt: {
          ...traceResponse.trace.latestAttempt,
          status: "failed_retryable",
          errorCode: "local_service.identity_mismatch",
          errorMessage:
            "daemon route does not match the target profile Core primary binding runtime identity",
        },
        result: null,
        resultInbox: null,
        replySignal: null,
        runtimeCoordinatorCreationDiagnostics: [
          {
            modelVersion: RUNTIME_COORDINATOR_CREATION_DIAGNOSTIC_MODEL_VERSION,
            factSource: "runtime_coordinator_projection",
            spaceId: "space-demo",
            dispatchId: "dispatch-demo",
            targetProfileId: "agt-target",
            sourceClientMessageId: "client-message-1",
            creationStatus: "not_created",
            reasonCode: "local_service.identity_mismatch",
            observedAtMs: 1_762_473_600_000,
            legacyAttemptId: "attempt-2",
          },
        ],
        runtimeCoordinatorHeadLifecycle: {
          createdAt: "2026-03-09T00:00:01.100Z",
          duplicateDispatchCount: 0,
          executionLinkedAt: null,
          factSource: "runtime_coordinator_head_lifecycle",
          modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
          noExecutionDecision: null,
          ownerUserId: "owner-1",
          primaryDispatchId: "dispatch-demo",
          publicationIntent: null,
          readStatus: "found",
          runtimeCoordinatorExecutionId: null,
          status: "accepted",
          targetWakeLifecycleIdentity: {
            clientMessageId: "client-message-1",
            dispatchId: "dispatch-demo",
            modelVersion: TARGET_WAKE_LIFECYCLE_IDENTITY_MODEL_VERSION,
            sourceSignalId: "evt-1",
            spaceId: "space-demo",
            targetProfileId: "agt-target",
            targetWakeLifecycleId,
          },
          targetWakeLifecycleId,
          updatedAt: "2026-03-09T00:00:01.300Z",
          waitingBoundary: null,
        },
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "human",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      expect(stdout).toContain("Root Cause: runtime_coordinator.head_accepted");
      expect(stdout).toContain("local_service.identity_mismatch");
      expect(stdout).not.toContain(
        "Root Cause: local_service.identity_mismatch"
      );
      expect(stdout).not.toContain(
        "Current Local Execution Projection: Local evidence: reply-capable"
      );
    });
  });

  it("explains pre-execution offline creation failure instead of missing reply", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "agent",
        resolvedView: "agent",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const traceResponse = createTraceResponse();
      if (!(traceResponse.trace?.latestAttempt && traceResponse.trace.result)) {
        throw new Error("expected latest attempt and result fixture");
      }
      traceResponse.trace = {
        ...traceResponse.trace,
        dispatch: {
          ...traceResponse.trace.dispatch,
          status: "failed_terminal",
        },
        latestAttempt: {
          ...traceResponse.trace.latestAttempt,
          status: "failed_retryable",
          errorCode: "daemon.profile.offline",
        },
        runtimeCoordinatorExecution: null,
        runtimeCoordinatorCreationDiagnostics: [
          {
            modelVersion: RUNTIME_COORDINATOR_CREATION_DIAGNOSTIC_MODEL_VERSION,
            factSource: "runtime_coordinator_projection",
            spaceId: "space-demo",
            dispatchId: "dispatch-demo",
            targetProfileId: "agt-target",
            sourceClientMessageId: "client-message-1",
            creationStatus: "not_created",
            reasonCode: "daemon.profile.offline",
            observedAtMs: 1_762_473_600_000,
            legacyAttemptId: "attempt-2",
          },
        ],
        result: {
          ...traceResponse.trace.result,
          publicOutcome: "system_notice",
          publishedSignalId: "sig-terminal-failure",
        },
        replySignal: null,
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "agent",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      expect(stdout).toContain(
        "rootCause=final_visible_outcome.publication_unresolved"
      );
      expect(stdout).toContain("finalVisibleOutcome=publication_unresolved");
      expect(stdout).not.toContain("rootCause=reply.not_found");
    });
  });

  it("keeps provider access failure as root cause when Space published a terminal failure notice", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const traceResponse = createTraceResponse();
      if (!(traceResponse.trace?.latestAttempt && traceResponse.trace.result)) {
        throw new Error("expected latest attempt and result fixture");
      }
      traceResponse.correlation = {
        ...traceResponse.correlation,
        publishedSignalId: "sig-terminal-failure",
        replySignalId: null,
      };
      traceResponse.trace = {
        ...traceResponse.trace,
        latestAttempt: {
          ...traceResponse.trace.latestAttempt,
          status: "failed_terminal",
          finishedAt: "2026-03-09T00:00:04.000Z",
          errorCode: "auth.required",
          errorMessage:
            "Your organization has disabled Claude subscription access for Claude Code",
        },
        runtimeCoordinatorExecution: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:claude-code",
          createdAtMs: 1_762_473_599_000,
          dispatchId: "dispatch-demo",
          factSource: "runtime_coordinator_projection",
          legacyPointers: {
            attemptId: "attempt-2",
            claimLeaseId: null,
            connectionGeneration: 1,
            daemonSessionId: "daemon-session-1",
            leaseEpoch: 3,
          },
          modelVersion: "openmeld.runtime_coordinator.execution.v1",
          runtimeCoordinatorExecutionId: "rce-demo-claude-access-failure",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
          sourceClientMessageId: "client-message-1",
          spaceId: "space-demo",
          status: "reply_published",
          targetProfileId: "agt-target",
          terminalOutcome: {
            kind: "reply_published",
            observedAtMs: 1_762_473_604_000,
            reasonCode: null,
          },
          updatedAtMs: 1_762_473_604_000,
        },
        result: {
          ...traceResponse.trace.result,
          publicOutcome: "system_notice",
          publishedSignalId: "sig-terminal-failure",
        },
        resultInbox: traceResponse.trace.resultInbox
          ? {
              ...traceResponse.trace.resultInbox,
              publishedSignalId: "sig-terminal-failure",
            }
          : null,
        replySignal: null,
        finalVisibleMessage: {
          factSource: "space_signal_by_published_signal_id",
          signalId: "sig-terminal-failure",
          signalType: "signal.system_notice",
          dispatchId: "dispatch-demo",
          targetProfileId: "agt-target",
          profileId: "openmeld-system",
          profileKind: "system",
          profileName: "OpenMeld",
          text: "Claude Code subscription access is unavailable for this account.",
          reasonCode: "auth.required",
          noticeType: "terminal_failure",
          statusType: null,
          createdAt: "2026-03-09T00:00:04.000Z",
        },
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "human",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      expect(stdout).toContain("Root Cause: auth.required");
      expect(stdout).toContain(
        "Final Visible Message: signal.system_notice · terminal_failure · auth.required · sig-terminal-failure"
      );
      expect(stdout).toContain(
        "Claude Code subscription access is unavailable for this account."
      );
      expect(stdout).not.toContain("Root Cause: reply.not_found");
    });
  });

  it("does not show a Space publication failure as a delivered reply", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "agent",
        resolvedView: "agent",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const traceResponse = createTraceResponse();
      if (!(traceResponse.trace?.result && traceResponse.trace.resultInbox)) {
        throw new Error("expected result and inbox fixture");
      }
      traceResponse.trace = {
        ...traceResponse.trace,
        runtimeCoordinatorExecution: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          createdAtMs: 1_762_473_599_000,
          dispatchId: "dispatch-demo",
          factSource: "runtime_coordinator_projection",
          legacyPointers: {
            attemptId: "attempt-2",
            claimLeaseId: null,
            connectionGeneration: 1,
            daemonSessionId: "daemon-session-1",
            leaseEpoch: 3,
          },
          modelVersion: "openmeld.runtime_coordinator.execution.v1",
          runtimeCoordinatorExecutionId: "rce-demo-publication-failed",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
          sourceClientMessageId: "client-message-1",
          spaceId: "space-demo",
          status: "result_accepted",
          targetProfileId: "agt-target",
          terminalOutcome: null,
          updatedAtMs: 1_762_473_604_000,
        },
        result: {
          ...traceResponse.trace.result,
          publicOutcome: "post_message",
          publishedSignalId: "sig-1",
        },
        resultInbox: {
          ...traceResponse.trace.resultInbox,
          publishState: "reply_publication_failed",
          publicationErrorCode: "space.signal.persist_failed",
          publishedSignalId: null,
        },
        replySignal: null,
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "agent",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      expect(stdout).toContain(
        "rootCause=final_visible_outcome.publication_retrying"
      );
      expect(stdout).toContain("finalVisibleOutcome=publication_retrying");
      expect(stdout).not.toContain("rootCause=reply.delivered");
    });
  });

  it("does not let stale result inbox publication failure override a running RuntimeCoordinator root cause", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "agent",
        resolvedView: "agent",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const traceResponse = createTraceResponse();
      if (!traceResponse.trace?.resultInbox) {
        throw new Error("expected result inbox fixture");
      }
      traceResponse.trace = {
        ...traceResponse.trace,
        runtimeCoordinatorExecution: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          createdAtMs: 1_762_473_599_000,
          dispatchId: "dispatch-demo",
          factSource: "runtime_coordinator_projection",
          legacyPointers: {
            attemptId: "attempt-2",
            claimLeaseId: null,
            connectionGeneration: 1,
            daemonSessionId: "daemon-session-1",
            leaseEpoch: 3,
          },
          modelVersion: "openmeld.runtime_coordinator.execution.v1",
          runtimeCoordinatorExecutionId: "rce-demo-running-old-publish",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
          sourceClientMessageId: "client-message-1",
          spaceId: "space-demo",
          status: "running",
          targetProfileId: "agt-target",
          terminalOutcome: null,
          updatedAtMs: 1_762_473_604_000,
        },
        result: null,
        resultInbox: {
          ...traceResponse.trace.resultInbox,
          publishState: "reply_publication_failed",
          publicationErrorCode: "space.signal.persist_failed",
          publishedSignalId: null,
        },
        replySignal: null,
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "agent",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      expect(stdout).toContain("rootCause=runtime_coordinator.running");
      expect(stdout).not.toContain("rootCause=reply.publication_failed");
      expect(stdout).not.toContain("rootCause=reply.delivered");
    });
  });

  it("shows stale progress instead of normal running for a running RuntimeCoordinator trace", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const traceResponse = createTraceResponse();
      if (!traceResponse.trace?.execution) {
        throw new Error("expected execution fixture");
      }
      traceResponse.trace = {
        ...traceResponse.trace,
        runtimeCoordinatorExecution: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          createdAtMs: 1_762_473_599_000,
          dispatchId: "dispatch-demo",
          factSource: "runtime_coordinator_projection",
          legacyPointers: {
            attemptId: "attempt-2",
            claimLeaseId: null,
            connectionGeneration: 1,
            daemonSessionId: "daemon-session-1",
            leaseEpoch: 3,
          },
          modelVersion: "openmeld.runtime_coordinator.execution.v1",
          runtimeCoordinatorExecutionId: "rce-demo-running-stale-progress",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
          sourceClientMessageId: "client-message-1",
          spaceId: "space-demo",
          status: "running",
          targetProfileId: "agt-target",
          terminalOutcome: null,
          updatedAtMs: 1_762_473_604_000,
        },
        runtimeCoordinatorHeadLifecycle: createExecutionLinkedHeadLifecycle({
          runtimeCoordinatorExecutionId: "rce-demo-running-stale-progress",
        }),
        execution: {
          ...traceResponse.trace.execution,
          progressEvidenceState: "stalled",
        },
        result: null,
        resultInbox: null,
        replySignal: null,
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "human",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      expect(stdout).toContain("Root Cause: runtime.progress_stale");
      expect(stdout).not.toContain("Root Cause: runtime_coordinator.running");
      expect(stdout).not.toContain(
        "Root Cause: runtime_coordinator.head_execution_linked"
      );
      expect(stdout).toContain("RuntimeCoordinator Head: execution_linked");
      expect(stdout).toContain("Execution: running · stalled");
    });
  });

  it("uses RuntimeCoordinator progress-stale decision evidence when legacy progress evidence still looks active", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const traceResponse = createTraceResponse();
      if (!traceResponse.trace?.execution) {
        throw new Error("expected execution fixture");
      }
      traceResponse.trace = {
        ...traceResponse.trace,
        runtimeCoordinatorExecution: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          createdAtMs: 1_762_473_599_000,
          dispatchId: "dispatch-demo",
          factSource: "runtime_coordinator_projection",
          legacyPointers: {
            attemptId: "attempt-2",
            claimLeaseId: null,
            connectionGeneration: 1,
            daemonSessionId: "daemon-session-1",
            leaseEpoch: 3,
          },
          modelVersion: "openmeld.runtime_coordinator.execution.v1",
          runtimeCoordinatorExecutionId: "rce-demo-rc-progress-stale",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
          sourceClientMessageId: "client-message-1",
          spaceId: "space-demo",
          status: "running",
          targetProfileId: "agt-target",
          terminalOutcome: null,
          updatedAtMs: 1_762_473_604_000,
        },
        runtimeCoordinatorHeadLifecycle: createExecutionLinkedHeadLifecycle({
          runtimeCoordinatorExecutionId: "rce-demo-rc-progress-stale",
        }),
        runtimeCoordinatorEvents: [
          {
            eventId: "event-rc-progress-stale-policy",
            eventType: "runtime_coordinator_decision_recorded",
            factSource: "runtime_coordinator_projection",
            idempotencyKey: "decision:1",
            observedAtMs: 1_762_473_604_000,
            payloadJson: JSON.stringify({
              action: "keep_waiting",
              eventKind: "timeout",
              reasonCode: "runtime_coordinator.progress_stale_policy_pending",
            }),
            reasonCode: "runtime_coordinator.progress_stale_policy_pending",
            runtimeCoordinatorExecutionId: "rce-demo-rc-progress-stale",
            statusAfter: "running",
          },
        ],
        execution: {
          ...traceResponse.trace.execution,
          progressEvidenceState: "active",
        },
        result: null,
        resultInbox: null,
        replySignal: null,
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "human",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      expect(stdout).toContain("Root Cause: runtime.progress_stale");
      expect(stdout).not.toContain("Root Cause: runtime_coordinator.running");
      expect(stdout).not.toContain(
        "Root Cause: runtime_coordinator.head_execution_linked"
      );
      expect(stdout).toContain("RuntimeCoordinator Head: execution_linked");
      expect(stdout).toContain("Execution: running · active");
    });
  });

  it("renders current-token owner conflict as ignored diagnostic evidence", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const traceResponse = createTraceResponse();
      if (!traceResponse.trace) {
        throw new Error("expected trace fixture");
      }
      traceResponse.trace = {
        ...traceResponse.trace,
        runtimeCoordinatorExecution: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          createdAtMs: 1_762_473_599_000,
          dispatchId: "dispatch-demo",
          factSource: "runtime_coordinator_projection",
          legacyPointers: {
            attemptId: "attempt-2",
            claimLeaseId: null,
            connectionGeneration: 1,
            daemonSessionId: "daemon-session-1",
            leaseEpoch: 3,
          },
          modelVersion: "openmeld.runtime_coordinator.execution.v1",
          runtimeCoordinatorExecutionId: "rce-demo-owner-conflict",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
          sourceClientMessageId: "client-message-1",
          spaceId: "space-demo",
          status: "running",
          targetProfileId: "agt-target",
          terminalOutcome: null,
          updatedAtMs: 1_762_473_604_000,
        },
        runtimeCoordinatorEvents: [
          {
            eventId: "event-owner-conflict-current",
            eventType: "owner_conflict_current_token",
            factSource: "runtime_coordinator_projection",
            idempotencyKey: "rce-demo-owner-conflict::run-1::owner-conflict",
            observedAtMs: 1_762_473_603_000,
            payloadJson: JSON.stringify({
              tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaa",
              tokenStatus: "active",
            }),
            reasonCode: "owner_conflict.current_token",
            runtimeCoordinatorExecutionId: "rce-demo-owner-conflict",
            statusAfter: null,
          },
        ],
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
            view: "human",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      expect(stdout).toContain(
        "Ignored Runtime Events: owner_conflict_current_token:owner_conflict.current_token status=active fingerprint=etfp_v1_aaaaaaaaaaaaaaaa"
      );
      expect(stdout).not.toContain(
        "runtime_coordinator_owner_conflict_terminal"
      );
    });
  });

  it("renders structured action diagnostics when repair failed", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );

      const failedTrace = createTraceResponse();
      if (!failedTrace.trace?.latestAttempt) {
        throw new Error("expected a latest attempt");
      }
      if (
        !(failedTrace.trace?.dispatch && failedTrace.trace?.openClawBinding)
      ) {
        throw new Error("expected dispatch and OpenClaw binding trace data");
      }
      failedTrace.trace.dispatch = {
        ...failedTrace.trace.dispatch,
        status: "failed_terminal",
      };
      failedTrace.trace.latestAttempt = {
        ...failedTrace.trace.latestAttempt,
        errorCode: "openmeld.space_action.repair_failed",
        errorMessage: "SENTINEL_ATTEMPT_ERROR_MESSAGE",
        status: "failed_terminal",
      };
      failedTrace.trace.openClawBinding = {
        ...failedTrace.trace.openClawBinding,
        upgradeApplied: false,
      };
      failedTrace.trace.structuredActionFailure = {
        carrierKind: "none",
        invalidOutputPreview: "hi",
        publicFailureReason: "SENTINEL_PUBLIC_FAILURE_REASON",
        repairMode: "controller_roundtrip",
        spaceActionCandidatePresent: false,
        spaceActionParseError: null,
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
          },
          {
            requireProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "hum-actor",
                profileName: "Felix",
                profileKind: "human",
              })
            ),
            fetchTrace: vi.fn().mockResolvedValue(failedTrace),
            resolveProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "agt-target",
                profileName: "Demo Bot",
                profileKind: "agent",
              })
            ),
          }
        );
      });

      expect(stdout).toContain(
        "Structured Action: none · controller_roundtrip"
      );
      expect(stdout).toContain(
        "Attempt Error: openmeld.space_action.repair_failed (SENTINEL_ATTEMPT_ERROR_MESSAGE)"
      );
      expect(stdout).toContain(
        "Public Failure Reason: SENTINEL_PUBLIC_FAILURE_REASON"
      );
      expect(stdout).toContain("Invalid Output: hi");
      expect(stdout).toContain(
        "Binding Upgrade: not_applied (dispatch_failed)"
      );
    });
  });

  it("renders daemon execution stalls as stale progress", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );

      const timeoutTrace = createTraceResponse();
      if (!timeoutTrace.trace?.latestAttempt) {
        throw new Error("expected a latest attempt");
      }
      timeoutTrace.trace.dispatch = {
        ...timeoutTrace.trace.dispatch,
        status: "failed_terminal",
      };
      timeoutTrace.trace.latestAttempt = {
        ...timeoutTrace.trace.latestAttempt,
        errorCode: "daemon.delivery.execution_stalled",
        errorMessage:
          "daemon.delivery.execution_stalled: local runtime progress evidence became stale",
        status: "timed_out",
      };
      timeoutTrace.trace.result = null;
      timeoutTrace.trace.resultInbox = null;

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            profile: "hum-actor",
            space: "space-demo",
            dispatchId: "dispatch-demo",
          },
          {
            requireProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "hum-actor",
                profileName: "Felix",
                profileKind: "human",
              })
            ),
            fetchTrace: vi.fn().mockResolvedValue(timeoutTrace),
            resolveProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "agt-target",
                profileName: "Demo Bot",
                profileKind: "agent",
              })
            ),
          }
        );
      });

      expect(stdout).toContain("Root Cause: runtime.progress_stale");
      expect(stdout).toContain(
        "Attempt Error: daemon.delivery.execution_stalled"
      );
    });
  });

  it("emits structured trace payload in agent view", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "agent",
        resolvedView: "agent",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot({
          profileWorkspaceRuntimeResolution: {
            configPath: "/tmp/local-meta.json",
            configuredWorkspacePath: "/tmp/trace-agent-workspace",
            effectiveRuntimeWorkingDirectory: "/tmp/trace-agent-workspace",
            runtimeContext: {
              providerRuntimeWorkingDirectory: "/tmp/trace-agent-workspace",
            },
            status: "ready",
            workspaceMode: "custom",
          },
        })
      );

      const traceResponse = createTraceResponse();
      traceResponse.remoteAgentRuntimeDiagnostics = {
        activeRuns: [],
        attemptMarkers: [],
        callbackContexts: [],
        collectedAt: "2026-03-09T00:00:03.000Z",
        durableObjectAlarmAtMs: null,
        fibers: [],
        schedules: [],
        spaceId: "space-demo",
        submissions: [],
        v: 1,
      };
      const fetchTrace = vi.fn().mockResolvedValue(traceResponse);

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            space: "space-demo",
            dispatchId: "dispatch-demo",
            baseUrl: "https://gateway.openmeld.invalid",
            details: true,
            view: "agent",
          },
          {
            requireProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "hum-actor",
                profileName: "Felix",
                profileKind: "human",
              })
            ),
            fetchTrace,
            resolveProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "agt-target",
                profileName: "Demo Bot",
                profileKind: "agent",
              })
            ),
          }
        );
      });

      expect(fetchTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          includeRemoteAgentRuntimeDiagnostics: true,
        })
      );

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.trim().startsWith("{"))
        .map(
          (line) =>
            JSON.parse(line) as {
              code?: string;
              data?: unknown;
              payload?: unknown;
              text?: string;
            }
        );
      const result = lines.find((line) => line.code === "service.trace.result");
      expect(result).toMatchObject({
        payload: {
          query: {
            spaceId: "space-demo",
            dispatchId: "dispatch-demo",
          },
          selector: {
            kind: "dispatch",
            spaceId: "space-demo",
            dispatchId: "dispatch-demo",
          },
          correlation: {
            modelVersion: OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION,
            clientMessageId: "client-message-1",
            sourceSignalId: "evt-1",
            targetProfileId: "agt-target",
            dispatchId: "dispatch-demo",
            runtimeCoordinatorExecutionId: null,
            claimLeaseId: null,
            openMeldServiceRuntimeId: "runtime-1",
            agentControllerRef: "builtin:codex",
            resultRef: "result-1",
            publishedSignalId: "sig-1",
            replySignalId: "sig-1",
          },
          actorProfile: {
            profileId: "hum-actor",
            profileName: "Felix",
            profileKind: "human",
          },
          currentProfileWorkspace: {
            workspace: "Custom",
            workspaceSource: "Custom",
            configuredWorkspace: "/tmp/trace-agent-workspace",
            effectiveRuntimeWorkingDirectory: "/tmp/trace-agent-workspace",
          },
          remoteAgentRuntimeDiagnostics: {
            collectedAt: "2026-03-09T00:00:03.000Z",
            spaceId: "space-demo",
            v: 1,
          },
          agentSummary: {
            currentState: "not_delivered",
            delivered: false,
            nextAction:
              "report this Wake with the Signal ID or diagnostic report",
            reasonCode: "final_visible_outcome.publication_unresolved",
            visibleOutcome: "publication_unresolved",
          },
          trace: {
            dispatch: {
              status: "dispatching",
            },
            latestAttempt: {
              attemptId: "attempt-2",
              status: "waiting_result",
            },
            resultInbox: {
              resultKey: "dispatch-demo::attempt-2",
              publishState: "reply_published",
            },
            streaming: {
              streamingMode: "stream",
              previewEmitted: true,
            },
            runtime: {
              processId: 4321,
              processSpawnedAt: "2026-03-09T00:00:02.000Z",
            },
            origin: {
              agentControllerRef: "builtin:openclaw",
              agentControllerConversationKind: "session",
              resolvedAgentControllerConversationId: "agent:demo:space:demo",
            },
            prompt: {
              fingerprint: "sha256:prompt-demo",
              length: 512,
            },
            dispatchExecution: {
              agentControllerConversationResume: {
                status: "continued",
              },
              localRuntimeContext: {
                status: "recreated",
                reason: "workspace_changed",
              },
              bootstrap: {
                status: "pending",
                reason: "compatibility_recreate",
              },
            },
          },
          daemonDispatchJournal: {
            factSource: "daemon_dispatch_journal",
            eventCount: 0,
            events: [],
          },
          currentReplyReadiness: {
            daemonRouteObservation: {
              status: "unavailable",
              reasonCode: "profile_not_selected",
            },
            agentReplyReadiness: {
              replyReadiness: "ready",
            },
          },
        },
      });
      const summary = lines.find(
        (line) => line.code === "service.trace.summary"
      );
      expect(summary).toMatchObject({
        data: {
          diagnosticSummary: expect.stringContaining(
            "dispatch dispatch-demo: finalVisibleOutcome=publication_unresolved delivered=false"
          ),
        },
      });
      expect(summary?.text).toBe(
        "delivered=false visible_outcome=publication_unresolved current_state=not_delivered reason=final_visible_outcome.publication_unresolved next_action=report this Wake with the Signal ID or diagnostic report"
      );
      expect(stdout).toContain(
        "delivered=false visible_outcome=publication_unresolved current_state=not_delivered reason=final_visible_outcome.publication_unresolved next_action=report this Wake with the Signal ID or diagnostic report"
      );
    });
  });

  it("keeps agent view trace output compact unless details are requested", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "agent",
        resolvedView: "agent",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(null);
      const traceResponse = createTraceResponse();
      if (!traceResponse.trace?.resultInbox) {
        throw new Error("expected trace fixture");
      }
      traceResponse.trace.resultInbox.projectFailureContext = {
        bindingGeneration: "binding-project-1",
        projectId: "project-1",
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            space: "space-demo",
            dispatchId: "dispatch-demo",
            baseUrl: "https://gateway.openmeld.invalid",
            view: "agent",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.trim().startsWith("{"))
        .map(
          (line) =>
            JSON.parse(line) as {
              code?: string;
              data?: {
                agentSummary?: unknown;
                diagnosticSummary?: unknown;
                projectFailureContext?: unknown;
                trace?: unknown;
              };
              payload?: unknown;
            }
        );
      expect(
        lines.find((line) => line.code === "service.trace.result")
      ).toBeUndefined();
      const summary = lines.find(
        (line) => line.code === "service.trace.summary"
      );
      expect(summary?.data).toMatchObject({
        agentSummary: {
          delivered: false,
          visibleOutcome: "publication_unresolved",
        },
        diagnosticSummary: expect.stringContaining(
          "projectId=project-1 bindingGeneration=binding-project-1"
        ),
        projectFailureContext: {
          bindingGeneration: "binding-project-1",
          projectId: "project-1",
        },
      });
      expect(summary?.data?.trace).toBeUndefined();
    });
  });

  it("shows the authoritative pending route boundary in default agent view", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "agent",
        resolvedView: "agent",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(null);
      const traceResponse = createTraceResponse();
      if (!traceResponse.trace?.latestAttempt) {
        throw new Error("expected trace fixture");
      }
      traceResponse.correlation = {
        ...traceResponse.correlation,
        publishedSignalId: null,
        replySignalId: null,
        resultRef: null,
      };
      traceResponse.trace.latestAttempt.errorCode = "daemon.profile.offline";
      traceResponse.trace.result = null;
      traceResponse.trace.resultInbox = null;
      traceResponse.trace.replySignal = null;
      traceResponse.trace.finalVisibleMessage = null;
      traceResponse.trace.finalVisibleMessageLinkage = null;
      traceResponse.trace.runtimeCoordinatorHeadLifecycle = {
        createdAt: "2026-03-09T00:00:01.100Z",
        duplicateDispatchCount: 0,
        executionLinkedAt: null,
        factSource: "runtime_coordinator_head_lifecycle",
        modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
        noExecutionDecision: null,
        ownerUserId: "owner-1",
        primaryDispatchId: "dispatch-demo",
        publicationIntent: null,
        readStatus: "found",
        runtimeCoordinatorExecutionId: null,
        status: "waiting",
        targetWakeLifecycleIdentity: {
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-demo",
          modelVersion: TARGET_WAKE_LIFECYCLE_IDENTITY_MODEL_VERSION,
          sourceSignalId: "evt-1",
          spaceId: "space-demo",
          targetProfileId: "agt-target",
          targetWakeLifecycleId: "twl_v1|10:space-demo|5:evt-1|10:agt-target",
        },
        targetWakeLifecycleId: "twl_v1|10:space-demo|5:evt-1|10:agt-target",
        updatedAt: "2026-03-09T00:00:01.300Z",
        waitingBoundary: {
          deadlineAt: "2026-03-09T00:05:00.000Z",
          deadlineOutcome: "publication_intent_ready",
          observedAt: "2026-03-09T00:00:01.200Z",
          reasonCode: "daemon.profile.pending_first_report",
          softDeadlineAt: "2026-03-09T00:00:30.000Z",
          trigger: "wake_route_reported",
          triggerOwner: "runtime_coordinator",
          userRecoveryAction: "wait_for_wake_route_report",
          userVisibleState: "waiting_for_wake_route_report",
          waitingCategory: "wake_route_registration_pending",
          waitingFor: "wake_route_report",
          waitingSince: "2026-03-09T00:00:01.100Z",
        },
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            baseUrl: "https://gateway.openmeld.invalid",
            dispatchId: "dispatch-demo",
            space: "space-demo",
            view: "agent",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      const summary = stdout
        .trim()
        .split("\n")
        .filter((line) => line.trim().startsWith("{"))
        .map(
          (line) =>
            JSON.parse(line) as {
              code?: string;
              data?: { agentSummary?: unknown };
              text?: string;
            }
        )
        .find((line) => line.code === "service.trace.summary");

      expect(summary?.data?.agentSummary).toMatchObject({
        currentState: "waiting",
        delivered: false,
        nextAction:
          "wait for the Wake route report, then rerun trace with the same selector",
        reasonCode: "daemon.profile.pending_first_report",
        waitingBoundary: {
          deadlineAt: "2026-03-09T00:05:00.000Z",
          softDeadlineAt: "2026-03-09T00:00:30.000Z",
          userRecoveryAction: "wait_for_wake_route_report",
          waitingFor: "wake_route_report",
          waitingSince: "2026-03-09T00:00:01.100Z",
        },
      });
      expect(summary?.text).toContain(
        "reason=daemon.profile.pending_first_report waiting_for=wake_route_report waiting_deadline=2026-03-09T00:05:00.000Z recovery_action=wait_for_wake_route_report"
      );
      expect(summary?.data).not.toHaveProperty("trace");
    });
  });

  it("projects hosted native-delivery destination and normalization in agentSummary", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "agent",
        resolvedView: "agent",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(null);
      const traceResponse = createTraceResponse();
      if (!traceResponse.trace) {
        throw new Error("expected trace fixture");
      }
      traceResponse.trace.nativeDelivery = {
        bindingId: "binding-hosted-1",
        controllerNormalization: {
          bindingUpdatedAt: "2026-03-09T00:00:01.000Z",
          canonicalAgentControllerRef: "hosted:center-agent",
          factSource: "remote_agent_native_delivery_ledger",
          reasonCode: "hosted_runtime_family_controller_canonicalized",
          storedAgentControllerRef: "builtin:codex",
          storedAgentControllerRefStatus: "stale",
        },
        createdAt: "2026-03-09T00:00:01.000Z",
        deliveryId: "delivery-hosted-1",
        destination: {
          conversationKind: "space",
          organizationId: "org-1",
          spaceId: "space-demo",
          targetProfileId: "agt-target",
        },
        dispatchId: "dispatch-demo",
        factSource: "remote_agent_native_delivery_ledger",
        idempotencyKey: "idem-1",
        runtimeFamily: "hosted_center_agent",
        status: "accepted",
        submissionId: "submission-hosted-1",
        updatedAt: "2026-03-09T00:00:02.000Z",
      };
      traceResponse.trace.executionIdentity = null;

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            baseUrl: "https://gateway.openmeld.invalid",
            dispatchId: "dispatch-demo",
            space: "space-demo",
            view: "agent",
          },
          createReadOnlyTraceDependencies(traceResponse)
        );
      });

      const summary = stdout
        .trim()
        .split("\n")
        .filter((line) => line.trim().startsWith("{"))
        .map(
          (line) =>
            JSON.parse(line) as {
              code?: string;
              data?: { agentSummary?: unknown; diagnosticSummary?: string };
            }
        )
        .find((line) => line.code === "service.trace.summary");
      expect(summary?.data?.agentSummary).toMatchObject({
        controllerNormalizationStatus: "stale",
        deliveryDestination: "space:space-demo",
        runtimeFamily: "hosted_center_agent",
      });
      expect(summary?.data?.diagnosticSummary).toContain(
        "nativeDelivery=accepted destination=space:space-demo controllerNormalization=stale"
      );
    });
  });

  it("shows service drift setup guidance in human trace output", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot({
          deviceReplyReadiness: {
            reasonCodes: ["service.drifted"],
            reasonText:
              "OpenMeld Service artifact drift was detected on this device",
            updatedAt: "2026-03-09T00:00:00.000Z",
            replyReadiness: "blocked",
            wakeableRouteCount: 0,
          },
          agentReplyReadiness: createAgentReplyReadiness({
            deviceReplyReadiness: {
              reasonCodes: ["service.drifted"],
              reasonText:
                "OpenMeld Service artifact drift was detected on this device",
              updatedAt: "2026-03-09T00:00:00.000Z",
              replyReadiness: "blocked",
              wakeableRouteCount: 0,
            },
            reasonCodes: ["service.drifted"],
            reasonText:
              "OpenMeld Service artifact drift was detected on this device",
            replyReadiness: "blocked",
          }),
        })
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            space: "space-demo",
            dispatchId: "dispatch-demo",
            baseUrl: "https://gateway.openmeld.invalid",
            view: "human",
          },
          {
            requireProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "hum-actor",
                profileName: "Felix",
                profileKind: "human",
              })
            ),
            fetchTrace: vi.fn().mockResolvedValue(createTraceResponse()),
            resolveProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "agt-target",
                profileName: "Demo Bot",
                profileKind: "agent",
              })
            ),
          }
        );
      });

      expect(stdout).toContain(formatOpenMeldCliCommand("openmeld setup"));
    });
  });

  it("keeps current readiness repair guidance below a delivered Wake outcome", async () => {
    await withTempHome(async () => {
      const traceResponse = createTraceResponse();
      if (!traceResponse.trace) {
        throw new Error("expected trace fixture");
      }
      traceResponse.trace = {
        ...traceResponse.trace,
        finalVisibleMessage: createFinalVisibleTextMessage(),
      };
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot({
          deviceReplyReadiness: {
            reasonCodes: ["service.drifted"],
            reasonText:
              "OpenMeld Service artifact drift was detected on this device",
            updatedAt: "2026-03-09T00:00:00.000Z",
            replyReadiness: "blocked",
            wakeableRouteCount: 0,
          },
          agentReplyReadiness: createAgentReplyReadiness({
            deviceReplyReadiness: {
              reasonCodes: ["service.drifted"],
              reasonText:
                "OpenMeld Service artifact drift was detected on this device",
              updatedAt: "2026-03-09T00:00:00.000Z",
              replyReadiness: "blocked",
              wakeableRouteCount: 0,
            },
            reasonCodes: ["service.drifted"],
            reasonText:
              "OpenMeld Service artifact drift was detected on this device",
            replyReadiness: "blocked",
          }),
        })
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            space: "space-demo",
            dispatchId: "dispatch-demo",
            baseUrl: "https://gateway.openmeld.invalid",
            view: "human",
          },
          {
            ...createReadOnlyTraceDependencies(traceResponse),
            fetchTrace: vi.fn().mockResolvedValue(traceResponse),
          }
        );
      });

      expect(stdout).toContain("Final Visible Message: signal.text");
      expect(stdout).not.toContain(
        formatOpenMeldCliCommand("openmeld service repair")
      );
    });
  });

  it("keeps current readiness repair guidance below a running RuntimeCoordinator Wake", async () => {
    await withTempHome(async () => {
      const traceResponse = createTraceResponse();
      if (!traceResponse.trace) {
        throw new Error("expected trace fixture");
      }
      traceResponse.correlation = {
        ...traceResponse.correlation,
        claimLeaseId: null,
        publishedSignalId: null,
        replySignalId: null,
        resultRef: null,
        runtimeCoordinatorExecutionId: "rce-demo-running",
      };
      traceResponse.trace = {
        ...traceResponse.trace,
        claimLease: null,
        result: null,
        resultInbox: null,
        replySignal: null,
        runtimeCoordinatorExecution: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          createdAtMs: 1_762_473_599_000,
          dispatchId: "dispatch-demo",
          factSource: "runtime_coordinator_projection",
          legacyPointers: {
            attemptId: "attempt-2",
            claimLeaseId: null,
            connectionGeneration: 1,
            daemonSessionId: "daemon-session-1",
            leaseEpoch: 3,
          },
          modelVersion: "openmeld.runtime_coordinator.execution.v1",
          runtimeCoordinatorExecutionId: "rce-demo-running",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
          sourceClientMessageId: "client-message-1",
          spaceId: "space-demo",
          status: "running",
          targetProfileId: "agt-target",
          terminalOutcome: null,
          updatedAtMs: 1_762_473_604_000,
        },
        runtimeCoordinatorHeadLifecycle: createExecutionLinkedHeadLifecycle({
          runtimeCoordinatorExecutionId: "rce-demo-running",
        }),
      };
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "agent",
        resolvedView: "agent",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot({
          deviceReplyReadiness: {
            reasonCodes: ["service.drifted"],
            reasonText:
              "OpenMeld Service artifact drift was detected on this device",
            updatedAt: "2026-03-09T00:00:00.000Z",
            replyReadiness: "blocked",
            wakeableRouteCount: 0,
          },
          agentReplyReadiness: createAgentReplyReadiness({
            deviceReplyReadiness: {
              reasonCodes: ["service.drifted"],
              reasonText:
                "OpenMeld Service artifact drift was detected on this device",
              updatedAt: "2026-03-09T00:00:00.000Z",
              replyReadiness: "blocked",
              wakeableRouteCount: 0,
            },
            reasonCodes: ["service.drifted"],
            reasonText:
              "OpenMeld Service artifact drift was detected on this device",
            replyReadiness: "blocked",
          }),
        })
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            space: "space-demo",
            dispatchId: "dispatch-demo",
            baseUrl: "https://gateway.openmeld.invalid",
            details: true,
            view: "agent",
          },
          {
            ...createReadOnlyTraceDependencies(traceResponse),
            fetchTrace: vi.fn().mockResolvedValue(traceResponse),
          }
        );
      });

      const result = stdout
        .trim()
        .split("\n")
        .filter((line) => line.trim().startsWith("{"))
        .map(
          (line) =>
            JSON.parse(line) as {
              code?: string;
              payload?: { guidance?: unknown };
            }
        )
        .find((line) => line.code === "service.trace.result");
      expect(result?.payload?.guidance).toBeNull();
      expect(stdout).toContain("runtime_coordinator.running");
      expect(stdout).not.toContain(
        formatOpenMeldCliCommand("openmeld service repair")
      );
    });
  });

  it("offers a lightweight profile switch before reading a human trace", async () => {
    await withTempHome(async () => {
      const currentProfile = createProfile({
        openMeldProfileId: "hum-actor",
        profileName: "Felix",
        profileKind: "human",
      });
      const switchedProfile = createProfile({
        openMeldProfileId: "agt-actor",
        profileName: "Demo Bot",
        profileKind: "agent",
      });
      const fetchTraceMock = vi.fn().mockResolvedValue(createTraceResponse());

      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: true,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      selectMock.mockResolvedValue("choose_another");
      promptForOpenMeldProfileSelectionMock.mockResolvedValue({
        status: "submitted",
        value: switchedProfile.openMeldProfileId,
      });
      resolveOpenMeldProfileMock.mockResolvedValue(switchedProfile);

      await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            space: "space-demo",
            dispatchId: "dispatch-demo",
            baseUrl: "https://gateway.openmeld.invalid",
            view: "human",
          },
          {
            requireProfile: vi.fn().mockResolvedValue(currentProfile),
            fetchTrace: fetchTraceMock,
            resolveProfile: vi.fn().mockResolvedValue(switchedProfile),
          }
        );
      });

      expect(selectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Use Felix (hum-actor) to read this dispatch trace?",
        })
      );
      expect(promptForOpenMeldProfileSelectionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Which profile do you want to use to read this trace?",
          currentProfileId: currentProfile.openMeldProfileId,
          backLabel: "Back",
        })
      );
      expect(setSelectedOpenMeldProfileIdMock).not.toHaveBeenCalled();
      expect(fetchTraceMock).toHaveBeenCalledWith(
        expect.objectContaining({
          requestContext: {
            actorContext: {
              requestId: expect.any(String),
              openMeldProfileId: switchedProfile.openMeldProfileId,
              profileKind: switchedProfile.profileKind,
              profileName: switchedProfile.profileName,
              profileHandle: switchedProfile.profileHandle,
              ownerUserId: switchedProfile.ownerUserId,
              ownerName: switchedProfile.ownerName,
            },
          },
        })
      );
    });
  });

  it("returns from profile picker to the trace actor prompt before cancelling", async () => {
    await withTempHome(async () => {
      const currentProfile = createProfile({
        openMeldProfileId: "hum-actor",
        profileName: "Felix",
        profileKind: "human",
      });
      let actorPromptCount = 0;
      selectMock.mockImplementation((input?: { message?: string }) => {
        if (
          input?.message ===
          "Use Felix (hum-actor) to read this dispatch trace?"
        ) {
          actorPromptCount += 1;
          return actorPromptCount === 1 ? "choose_another" : "cancel";
        }
        throw new Error(`Unexpected select prompt: ${String(input?.message)}`);
      });
      promptForOpenMeldProfileSelectionMock.mockResolvedValueOnce({
        status: "back",
      });
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: true,
      });

      await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            space: "space-demo",
            dispatchId: "dispatch-demo",
            baseUrl: "https://gateway.openmeld.invalid",
            view: "human",
          },
          {
            requireProfile: vi.fn().mockResolvedValue(currentProfile),
            fetchTrace: vi.fn().mockResolvedValue(createTraceResponse()),
            resolveProfile: vi.fn().mockResolvedValue(currentProfile),
          }
        );
      });

      expect(promptForOpenMeldProfileSelectionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          backLabel: "Back",
        })
      );
      expect(selectMock).toHaveBeenCalledTimes(2);
      expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
      expect(setSelectedOpenMeldProfileIdMock).not.toHaveBeenCalled();
    });
  });

  it("resolves a trace from source signal when lookup returns one match", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const fetchLookupMock = vi.fn().mockResolvedValue({
        query: {
          spaceId: "space-demo",
          sourceSignalId: "sig-source-1",
          clientMessageId: null,
          targetProfileId: "agt-target",
        },
        matches: [
          {
            dispatchId: "dispatch-demo",
            sourceSignalId: "sig-source-1",
            targetProfileId: "agt-target",
            status: "dispatching",
            attemptCount: 1,
            latestAttemptId: "attempt-1",
            latestAttemptStatus: "waiting_result",
            latestAttemptErrorCode: null,
            latestAttemptErrorMessage: null,
          },
        ],
      });
      const fetchTraceMock = vi.fn().mockResolvedValue(createTraceResponse());

      await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            space: "space-demo",
            sourceSignalId: "sig-source-1",
            targetProfileId: "agt-target",
            baseUrl: "https://gateway.openmeld.invalid",
            view: "human",
          },
          {
            requireProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "hum-actor",
                profileName: "Felix",
                profileKind: "human",
              })
            ),
            fetchLookup: fetchLookupMock,
            fetchTrace: fetchTraceMock,
            resolveProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "agt-target",
                profileName: "Demo Bot",
                profileKind: "agent",
              })
            ),
          }
        );
      });

      expect(fetchLookupMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceSignalId: "sig-source-1",
          targetProfileId: "agt-target",
        })
      );
      expect(fetchTraceMock).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatchId: "dispatch-demo",
        })
      );
    });
  });

  it("resolves a trace from client message when lookup returns one match", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "agent",
        resolvedView: "agent",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const fetchLookupMock = vi.fn().mockResolvedValue({
        query: {
          spaceId: "space-demo",
          sourceSignalId: "sig-source-1",
          clientMessageId: "client-message-1",
          targetProfileId: "agt-target",
        },
        matches: [
          {
            dispatchId: "dispatch-demo",
            sourceSignalId: "sig-source-1",
            targetProfileId: "agt-target",
            status: "dispatching",
            attemptCount: 1,
            latestAttemptId: "attempt-1",
            latestAttemptStatus: "waiting_result",
            latestAttemptErrorCode: null,
            latestAttemptErrorMessage: null,
          },
        ],
      });
      const fetchTraceMock = vi.fn().mockResolvedValue(createTraceResponse());

      await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            space: "space-demo",
            clientMessageId: "client-message-1",
            targetProfileId: "agt-target",
            baseUrl: "https://gateway.openmeld.invalid",
            view: "agent",
          },
          {
            requireProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "hum-actor",
                profileName: "Felix",
                profileKind: "human",
              })
            ),
            fetchLookup: fetchLookupMock,
            fetchTrace: fetchTraceMock,
            resolveProfile: vi.fn().mockResolvedValue(null),
          }
        );
      });

      expect(fetchLookupMock).toHaveBeenCalledWith(
        expect.objectContaining({
          clientMessageId: "client-message-1",
          targetProfileId: "agt-target",
        })
      );
      expect(fetchTraceMock).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatchId: "dispatch-demo",
        })
      );
    });
  });

  it("renders a not-found lookup card when source signal has no dispatches", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const fetchTraceMock = vi.fn();

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            space: "space-demo",
            sourceSignalId: "sig-missing",
            baseUrl: "https://gateway.openmeld.invalid",
            view: "human",
          },
          {
            requireProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "hum-actor",
                profileName: "Felix",
                profileKind: "human",
              })
            ),
            fetchLookup: vi.fn().mockResolvedValue({
              query: {
                spaceId: "space-demo",
                sourceSignalId: "sig-missing",
                clientMessageId: null,
                targetProfileId: null,
              },
              matches: [],
            }),
            fetchTrace: fetchTraceMock,
            resolveProfile: vi.fn().mockResolvedValue(null),
          }
        );
      });

      expect(stdout).toContain("Wake Trace Diagnostics");
      expect(stdout).toContain("Status: not found");
      expect(stdout).toContain(
        "No dispatch ledger or planner non-ready record was found for this source and target."
      );
      expect(fetchTraceMock).not.toHaveBeenCalled();
    });
  });

  it("emits client-message correlation when lookup finds a source signal but no dispatch", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "agent",
        resolvedView: "agent",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const fetchTraceMock = vi.fn();

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            space: "space-demo",
            clientMessageId: "client-message-1",
            targetProfileId: "agt-target",
            baseUrl: "https://gateway.openmeld.invalid",
            view: "agent",
          },
          {
            requireProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "hum-actor",
                profileName: "Felix",
                profileKind: "human",
              })
            ),
            fetchLookup: vi.fn().mockResolvedValue({
              query: {
                spaceId: "space-demo",
                sourceSignalId: "sig-source-1",
                clientMessageId: "client-message-1",
                targetProfileId: "agt-target",
              },
              matches: [],
            }),
            fetchTrace: fetchTraceMock,
            resolveProfile: vi.fn().mockResolvedValue(null),
          }
        );
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.trim().startsWith("{"))
        .map(
          (line) => JSON.parse(line) as { code?: string; payload?: unknown }
        );
      expect(lines).toContainEqual(
        expect.objectContaining({
          code: "service.trace.lookup",
          payload: expect.objectContaining({
            reasonCode: "wake_trace.dispatch_not_found",
            selector: {
              kind: "client_message",
              spaceId: "space-demo",
              clientMessageId: "client-message-1",
              targetProfileId: "agt-target",
            },
            correlation: expect.objectContaining({
              modelVersion: OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION,
              selector: {
                kind: "client_message",
                spaceId: "space-demo",
                clientMessageId: "client-message-1",
                targetProfileId: "agt-target",
              },
              spaceId: "space-demo",
              clientMessageId: "client-message-1",
              sourceSignalId: "sig-source-1",
              targetProfileId: "agt-target",
              dispatchId: null,
            }),
          }),
        })
      );
      expect(fetchTraceMock).not.toHaveBeenCalled();
    });
  });

  it("renders an ambiguous lookup summary when source signal matches multiple dispatches", async () => {
    await withTempHome(async () => {
      resolveRuntimeContextMock.mockResolvedValue({
        viewMode: "agent",
        resolvedView: "agent",
        interactive: false,
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot()
      );
      const fetchTraceMock = vi.fn();

      const { stdout } = await withCapturedStdio(async () => {
        await runServiceTrace(
          {
            space: "space-demo",
            sourceSignalId: "sig-source-1",
            baseUrl: "https://gateway.openmeld.invalid",
            view: "agent",
          },
          {
            requireProfile: vi.fn().mockResolvedValue(
              createProfile({
                openMeldProfileId: "hum-actor",
                profileName: "Felix",
                profileKind: "human",
              })
            ),
            fetchLookup: vi.fn().mockResolvedValue({
              query: {
                spaceId: "space-demo",
                sourceSignalId: "sig-source-1",
                clientMessageId: null,
                targetProfileId: null,
              },
              matches: [
                {
                  dispatchId: "dispatch-a",
                  sourceSignalId: "sig-source-1",
                  targetProfileId: "agt-a",
                  status: "dispatching",
                  attemptCount: 1,
                  latestAttemptId: "attempt-a",
                  latestAttemptStatus: "waiting_result",
                  latestAttemptErrorCode: null,
                  latestAttemptErrorMessage: null,
                },
                {
                  dispatchId: "dispatch-b",
                  sourceSignalId: "sig-source-1",
                  targetProfileId: "agt-b",
                  status: "completed",
                  attemptCount: 1,
                  latestAttemptId: "attempt-b",
                  latestAttemptStatus: "succeeded",
                  latestAttemptErrorCode: null,
                  latestAttemptErrorMessage: null,
                },
              ],
            }),
            fetchTrace: fetchTraceMock,
            resolveProfile: vi.fn().mockResolvedValue(null),
          }
        );
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.trim().startsWith("{"))
        .map(
          (line) => JSON.parse(line) as { code?: string; payload?: unknown }
        );
      expect(lines).toContainEqual(
        expect.objectContaining({
          code: "service.trace.lookup.summary",
        })
      );
      expect(fetchTraceMock).not.toHaveBeenCalled();
    });
  });
});
