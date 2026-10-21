import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  LocalExecutionSlots,
  LocalExecutionSlotTask,
} from "@openmeld/local-service";
import {
  createInflightTaskControlRegistry,
  createPendingAgentInteractionRegistry,
} from "@openmeld/local-service";
import { RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION } from "@openmeld/schemas";
import { afterEach, describe, expect, it } from "vitest";
import type {
  DaemonProfileRouteConfig,
  LedgerPaths,
} from "../src/local-service/core/types";
import { enqueueDispatchDeliverFrame } from "../src/local-service/dispatch/execute-dispatch-task";
import type { Presenter } from "../src/runtime/presenter/types";

function createPresenter(): Presenter {
  return {
    view: "human",
    event: () => undefined,
    line: () => undefined,
    data: () => undefined,
  };
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function createLedgerPaths(): LedgerPaths {
  const rootDirPath = mkdtempSync(join(tmpdir(), "openmeld-controller-key-"));
  tempDirs.push(rootDirPath);
  return {
    backupStateFilePath: join(rootDirPath, "backup.json"),
    historyFilePath: join(rootDirPath, "history.json"),
    historyTempFilePath: join(rootDirPath, "history.tmp.json"),
    rootDirPath,
    stateFilePath: join(rootDirPath, "state.json"),
    stateTempFilePath: join(rootDirPath, "state.tmp.json"),
  };
}

function createDeliveryExecutionIdentity(agentControllerRef = "builtin:codex") {
  return {
    authority: "core_runtime_registry_binding_route" as const,
    core: {
      modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
      spaceId: "space-1",
      dispatchId: "dispatch-1",
      targetProfileId: "agent-profile-1",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority" as const,
        value: "runtime-1",
      },
      bindingId: "binding-1",
      agentControllerRef,
    },
  };
}

function createReadyRoutes(input: {
  agentControllerRef: string;
  folder: string;
}): Map<string, DaemonProfileRouteConfig> {
  return new Map([
    [
      "agent-profile-1",
      {
        agentControllerRef: input.agentControllerRef,
        bindingId: "binding-1",
        contextIdMappingSpec: {
          mappingVersion: 1,
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
        },
        openMeldServiceRuntimeId: "runtime-1",
        profileId: "agent-profile-1",
        streamingMode: "final",
        transportMode: "local-cli",
        workingFolderRuntime: {
          configPath: "/tmp/profile-workspace.json",
          configuredWorkspacePath: input.folder,
          effectiveRuntimeWorkingDirectory: input.folder,
          runtimeContext: {
            providerRuntimeWorkingDirectory: input.folder,
          },
          status: "ready",
          workingFolderFact: {
            defaultProjectId: null,
            localProjectBindingGeneration: null,
            observedAtMs: Date.now(),
            reasonCode: null,
            source: "profile_workspace",
            status: "ready",
          },
          workingFolderSource: "profile_workspace",
          workspaceMode: "custom",
        },
      },
    ],
  ]);
}

function enqueueLegacyTask(input: {
  agentControllerRef: string;
  routeByProfileId?: Map<string, DaemonProfileRouteConfig>;
}): LocalExecutionSlotTask {
  const capturedTasks: LocalExecutionSlotTask[] = [];
  const localExecutionSlots = {
    isQuiescent: () => true,
    request: (task) => {
      capturedTasks.push(task);
      return {
        accepted: true as const,
        deduped: false,
        snapshot: {
          activeForLane: 0,
          activeGlobal: 0,
          limits: {
            globalConcurrency: 1,
            queueMax: 10,
          },
          queueDepth: 0,
        },
      };
    },
    getAdapterOperationStatus: () => "available" as const,
    runAdapterOperationIfIdle: async <T>(
      _adapterId: string,
      operation: () => Promise<T>
    ) => ({ accepted: true as const, value: await operation() }),
    beginDrain: () => ({ ownedAttemptKeys: [] }),
    drain: async () => undefined,
    dropPendingTasks: () => ({
      droppedCount: 0,
    }),
    getDrainState: () => ({
      activeGlobal: 0,
      pendingCount: 0,
    }),
    getSharedFolderSessions: () => [],
    getSnapshot: () => ({
      activeForLane: 0,
      activeGlobal: 0,
      limits: {
        globalConcurrency: 1,
        queueMax: 10,
      },
      queueDepth: 0,
    }),
  } satisfies LocalExecutionSlots;

  enqueueDispatchDeliverFrame({
    computerFileAccessStorePath:
      "/tmp/openmeld-test-missing-computer-file-access-policy.json",
    contextStore: new Map(),
    daemonSessionId: "daemon-session-1",
    localExecutionSlots,
    inflightTaskControlRegistry: createInflightTaskControlRegistry(),
    pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
    inflightDispatchMetaByTaskId: new Map(),
    ledgerPaths: createLedgerPaths(),
    leasesByProfileId: new Map(),
    localAdapterContainer: {
      getAdapter: () => null,
    } as never,
    payload: {
      v: 1,
      dispatchId: "dispatch-1",
      attemptId: "attempt-1",
      ownerUserId: "user-1",
      profileId: "agent-profile-1",
      daemonSessionId: "daemon-session-1",
      connectionGeneration: 1,
      leaseEpoch: 1,
      payload: {
        attemptId: "attempt-1",
        dispatchContractVersion: 2,
        dispatchPolicy: "mention_only",
        controllerSnapshot: {
          targetBindingState: "bound",
          targetBindingEnabled: true,
          agentControllerRef: input.agentControllerRef,
        },
        contextIdMappingSpec: null,
        agentControllerConversationId: "thread-shared-1",
        dispatchId: "dispatch-1",
        runtimeCoordinatorExecutionId: "rce_space-1_dispatch-1_agent-profile-1",
        executionIdentity: createDeliveryExecutionIdentity(
          input.agentControllerRef
        ),
        executionToken: {
          authorityScope: {
            bindingId: "binding-1",
            agentControllerRef: input.agentControllerRef,
            openMeldServiceRuntimeId: "runtime-1",
          },
          deliveryIdempotencyKey:
            "rce_space-1_dispatch-1_agent-profile-1:run-1",
          deliveryProvenance: {
            connectionGeneration: 1,
            daemonSessionId: "daemon-session-1",
            leaseEpoch: 1,
          },
          executionScope: {
            dispatchId: "dispatch-1",
            runtimeCoordinatorExecutionId:
              "rce_space-1_dispatch-1_agent-profile-1",
            sourceClientMessageId: null,
            spaceId: "space-1",
            targetProfileId: "agent-profile-1",
          },
          executionToken:
            "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          expiresAtMs: null,
          issuedAtMs: 1_700_000_000_000,
          modelVersion: "openmeld.runtime_coordinator.execution_token.v1",
          runId: "run-1",
          tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          tokenStatus: "active",
        },
        dispatchRulesSnapshot: {
          dispatchPolicy: "mention_only",
          ruleSource: "registry",
          ruleId: "registry.default.all_members.v1",
          ruleReason: "default allow all members mention",
        },
        enqueuedAtMs: 1_700_000_000_000,
        idempotencyKey: "idempotency-1",
        sourceEventId: "event-1",
        sourceSignal: {
          profileId: "user-profile-1",
          profileKind: "human",
          text: "ping",
        },
        sourceSignalSnapshot: {
          profileId: "user-profile-1",
          profileKind: "human",
          text: "ping",
        },
        spaceId: "space-1",
        streamingMode: "final",
        targetProfileId: "agent-profile-1",
        taskId: "task-1",
        transportMode: "local-cli",
      },
    },
    profileOwnerName: "Owner",
    profileOwnerUserId: "user-1",
    presenter: createPresenter(),
    routeByProfileId: input.routeByProfileId ?? new Map(),
    socket: {} as never,
  });

  const capturedTask = capturedTasks[0];
  if (!capturedTask) {
    throw new Error("expected dispatch task to be captured");
  }
  return capturedTask;
}

describe("enqueueDispatchDeliverFrame controllerKey", () => {
  it("canonicalizes builtin agentControllerRef before queue bucketing", () => {
    const capturedTask = enqueueLegacyTask({
      agentControllerRef: "builtin:codex",
    });
    expect(capturedTask.controllerKey).toBe("builtin:codex");
    expect(capturedTask.localExecutionLaneKey).toBe(
      "agent-controller-conversation:builtin:codex:thread-shared-1"
    );
  });

  it("claims an unknown folder for an OpenCode continuation that may move to its earlier folder", () => {
    const folder = realpathSync(
      mkdtempSync(join(tmpdir(), "openmeld-claim-folder-"))
    );
    tempDirs.push(folder);
    const claimFor = (agentControllerRef: string) =>
      enqueueLegacyTask({
        agentControllerRef,
        routeByProfileId: createReadyRoutes({ agentControllerRef, folder }),
      }).resourceClaim;
    expect(claimFor("builtin:codex")).toEqual({
      kind: "shared",
      access: "write",
      legacy: true,
      roots: [folder],
    });
    expect(claimFor("builtin:opencode")).toEqual({
      kind: "shared",
      access: "write",
      legacy: true,
      roots: null,
    });
  });

  it("reports an invalid deliver payload instead of silently dropping it", () => {
    const sentFrames: string[] = [];
    const localExecutionSlots = {
      isQuiescent: () => true,
      request: () => {
        throw new Error("invalid payload must not enter the dispatch queue");
      },
      getAdapterOperationStatus: () => "available" as const,
      runAdapterOperationIfIdle: async <T>(
        _adapterId: string,
        operation: () => Promise<T>
      ) => ({ accepted: true as const, value: await operation() }),
      beginDrain: () => ({ ownedAttemptKeys: [] }),
      drain: async () => undefined,
      dropPendingTasks: () => ({
        droppedCount: 0,
      }),
      getDrainState: () => ({
        activeGlobal: 0,
        pendingCount: 0,
      }),
      getSharedFolderSessions: () => [],
      getSnapshot: () => ({
        activeForLane: 0,
        activeGlobal: 0,
        limits: {
          globalConcurrency: 1,
          queueMax: 10,
        },
        queueDepth: 0,
      }),
    } satisfies LocalExecutionSlots;

    enqueueDispatchDeliverFrame({
      computerFileAccessStorePath:
        "/tmp/openmeld-test-missing-computer-file-access-policy.json",
      contextStore: new Map(),
      daemonSessionId: "daemon-session-1",
      localExecutionSlots,
      inflightTaskControlRegistry: createInflightTaskControlRegistry(),
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      inflightDispatchMetaByTaskId: new Map(),
      ledgerPaths: createLedgerPaths(),
      leasesByProfileId: new Map(),
      localAdapterContainer: {
        getAdapter: () => null,
      } as never,
      payload: {
        v: 1,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        ownerUserId: "user-1",
        profileId: "agent-profile-1",
        daemonSessionId: "daemon-session-1",
        connectionGeneration: 1,
        leaseEpoch: 1,
        payload: {
          attemptId: "attempt-1",
          dispatchContractVersion: 2,
          dispatchPolicy: "mention_only",
          controllerSnapshot: {
            targetBindingState: "bound",
            targetBindingEnabled: true,
            agentControllerRef: "builtin:codex",
          },
          contextIdMappingSpec: null,
          dispatchId: "dispatch-1",
          executionIdentity: createDeliveryExecutionIdentity(),
          dispatchRulesSnapshot: {
            dispatchPolicy: "mention_only",
            ruleSource: "registry",
            ruleId: "registry.default.all_members.v1",
            ruleReason: "default allow all members mention",
          },
          enqueuedAtMs: 1_700_000_000_000,
          idempotencyKey: "idempotency-1",
          sourceEventId: "event-1",
          sourceSignal: {
            profileId: "user-profile-1",
            profileKind: "human",
            text: "ping",
          },
          sourceSignalSnapshot: {
            profileId: "user-profile-1",
            profileKind: "human",
            text: "ping",
          },
          spaceId: "space-1",
          streamingMode: "final",
          targetProfileId: "agent-profile-1",
          taskId: "task-1",
          transportMode: "local-cli",
          unknownFutureField: true,
        },
      },
      profileOwnerName: "Owner",
      profileOwnerUserId: "user-1",
      presenter: createPresenter(),
      routeByProfileId: new Map(),
      socket: {
        send: (frame: string) => {
          sentFrames.push(frame);
        },
      } as never,
    });

    expect(sentFrames).toHaveLength(1);
    const frame = JSON.parse(sentFrames[0] ?? "{}") as {
      code?: string;
      payload?: {
        taskResult?: {
          payload?: {
            agentId?: string;
            errorCode?: string;
            sourceEventId?: string;
            status?: string;
            taskId?: string;
          };
        };
      };
    };
    expect(frame.code).toBe("daemon.dispatch.result");
    expect(frame.payload?.taskResult?.payload).toMatchObject({
      agentId: "agent-profile-1",
      errorCode: "schema.invalid",
      sourceEventId: "event-1",
      status: "failed",
      taskId: "task-1",
    });
  });

  it("sends owner conflict as token-scoped diagnostic evidence", () => {
    const sentFrames: string[] = [];
    const localExecutionSlots = {
      request: () => ({
        accepted: false as const,
        activeOwner: {
          attemptId: "attempt-active",
          dispatchId: "dispatch-active",
          executionTokenRunId: "run-active",
          runtimeCoordinatorExecutionId: "rce-active",
          taskId: "task-1",
        },
        reason: "task.owner_conflict" as const,
        snapshot: {
          activeForLane: 1,
          activeGlobal: 1,
          limits: {
            globalConcurrency: 1,
            queueMax: 10,
          },
          queueDepth: 0,
        },
      }),
      getAdapterOperationStatus: () => "available" as const,
      runAdapterOperationIfIdle: async <T>(
        _adapterId: string,
        operation: () => Promise<T>
      ) => ({ accepted: true as const, value: await operation() }),
      beginDrain: () => ({ ownedAttemptKeys: [] }),
      drain: async () => undefined,
      dropPendingTasks: () => ({
        droppedCount: 0,
      }),
      getDrainState: () => ({
        activeGlobal: 1,
        pendingCount: 0,
      }),
      isQuiescent: () => false,
      getSharedFolderSessions: () => [],
      getSnapshot: () => ({
        activeForLane: 1,
        activeGlobal: 1,
        limits: {
          globalConcurrency: 1,
          queueMax: 10,
        },
        queueDepth: 0,
      }),
    } satisfies LocalExecutionSlots;

    enqueueDispatchDeliverFrame({
      computerFileAccessStorePath:
        "/tmp/openmeld-test-missing-computer-file-access-policy.json",
      contextStore: new Map(),
      daemonSessionId: "daemon-session-1",
      localExecutionSlots,
      inflightTaskControlRegistry: createInflightTaskControlRegistry(),
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      inflightDispatchMetaByTaskId: new Map(),
      ledgerPaths: createLedgerPaths(),
      leasesByProfileId: new Map(),
      localAdapterContainer: {
        getAdapter: () => null,
      } as never,
      payload: {
        v: 1,
        dispatchId: "dispatch-rejected",
        attemptId: "attempt-rejected",
        ownerUserId: "user-1",
        profileId: "agent-profile-1",
        daemonSessionId: "daemon-session-1",
        connectionGeneration: 1,
        leaseEpoch: 1,
        payload: {
          attemptId: "attempt-rejected",
          dispatchContractVersion: 2,
          dispatchPolicy: "mention_only",
          controllerSnapshot: {
            targetBindingState: "bound",
            targetBindingEnabled: true,
            agentControllerRef: "builtin:codex",
          },
          contextIdMappingSpec: null,
          dispatchId: "dispatch-rejected",
          runtimeCoordinatorExecutionId: "rce-rejected",
          executionIdentity: createDeliveryExecutionIdentity(),
          executionToken: {
            authorityScope: {
              bindingId: "binding-1",
              agentControllerRef: "builtin:codex",
              openMeldServiceRuntimeId: "runtime-1",
            },
            deliveryIdempotencyKey: "rce-rejected:run-rejected",
            deliveryProvenance: {
              connectionGeneration: 1,
              daemonSessionId: "daemon-session-1",
              leaseEpoch: 1,
            },
            executionScope: {
              dispatchId: "dispatch-rejected",
              runtimeCoordinatorExecutionId: "rce-rejected",
              sourceClientMessageId: null,
              spaceId: "space-1",
              targetProfileId: "agent-profile-1",
            },
            executionToken:
              "rcet_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            expiresAtMs: null,
            issuedAtMs: 1_700_000_000_000,
            modelVersion: "openmeld.runtime_coordinator.execution_token.v1",
            runId: "run-rejected",
            tokenFingerprint: "etfp_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            tokenStatus: "active",
          },
          dispatchRulesSnapshot: {
            dispatchPolicy: "mention_only",
            ruleSource: "registry",
            ruleId: "registry.default.all_members.v1",
            ruleReason: "default allow all members mention",
          },
          enqueuedAtMs: 1_700_000_000_000,
          idempotencyKey: "idempotency-rejected",
          sourceEventId: "event-1",
          sourceSignal: {
            profileId: "user-profile-1",
            profileKind: "human",
            text: "ping",
          },
          sourceSignalSnapshot: {
            profileId: "user-profile-1",
            profileKind: "human",
            text: "ping",
          },
          spaceId: "space-1",
          streamingMode: "final",
          targetProfileId: "agent-profile-1",
          taskId: "task-1",
          transportMode: "local-cli",
        },
      },
      profileOwnerName: "Owner",
      profileOwnerUserId: "user-1",
      presenter: createPresenter(),
      routeByProfileId: new Map(),
      socket: {
        send: (frame: string) => {
          sentFrames.push(frame);
        },
      } as never,
    });

    const resultFrame = sentFrames
      .map((frame) => JSON.parse(frame) as { code?: string; payload?: unknown })
      .find((frame) => frame.code === "daemon.dispatch.result") as
      | {
          payload?: {
            executionTokenEcho?: { runId?: string };
            runtimeCoordinatorExecutionId?: string;
            taskResult?: {
              payload?: {
                errorCode?: string;
                localOwnerConflict?: unknown;
                status?: string;
                suppressPublicOutcome?: boolean;
              };
            };
          };
        }
      | undefined;
    expect(resultFrame).toBeDefined();
    expect(resultFrame?.payload?.runtimeCoordinatorExecutionId).toBe(
      "rce-rejected"
    );
    expect(resultFrame?.payload?.executionTokenEcho?.runId).toBe(
      "run-rejected"
    );
    expect(resultFrame?.payload?.taskResult?.payload).toMatchObject({
      errorCode: "runtime.task.local_owner_conflict",
      status: "failed",
      suppressPublicOutcome: true,
    });
    expect(
      resultFrame?.payload?.taskResult?.payload?.localOwnerConflict
    ).toEqual({
      activeAttemptId: "attempt-active",
      activeDispatchId: "dispatch-active",
      activeExecutionTokenRunId: "run-active",
      activeRuntimeCoordinatorExecutionId: "rce-active",
      activeTaskId: "task-1",
      reason: "task.owner_conflict",
      rejectedAttemptId: "attempt-rejected",
      rejectedDispatchId: "dispatch-rejected",
      rejectedExecutionTokenRunId: "run-rejected",
      rejectedRuntimeCoordinatorExecutionId: "rce-rejected",
      rejectedTaskId: "task-1",
    });
  });
});
