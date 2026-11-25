import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInflightTaskControlRegistry,
  createLocalAdapterContainer,
  createPendingAgentInteractionRegistry,
  type LocalDaemonAdapterEntry,
} from "@openmeld/local-service";
import {
  RUNTIME_COORDINATOR_EXECUTION_TOKEN_MODEL_VERSION,
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
} from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { systemDir } from "../src/config/paths";
import type {
  DaemonProfileRouteConfig,
  LedgerPaths,
} from "../src/local-service/core/types";
import { handleDispatchDeliverFrame } from "../src/local-service/dispatch/execute-dispatch-task";
import { auditExecutionContextGitConfig } from "../src/local-service/dispatch/execution-context-git-config";
import { acquireExecutionHostOwnership } from "../src/local-service/execution-host/ownership";
import { withProviderInvocationObserver } from "../src/local-service/execution-host/runtime";
import { resolveCurrentEffectiveProfileWorkingFolderRuntime } from "../src/profile-workspace/effective-runtime-resolution";
import { setCustomProfileWorkspace } from "../src/profile-workspace/service";
import type { Presenter } from "../src/runtime/presenter/types";
import { createInProcessExecutionHost } from "./helpers/execution-host";
import { withTempHome } from "./helpers/fs";

vi.mock("../src/agent-activity/integration-refresh", () => ({
  createManagedAgentActivityIntegrationRefreshScheduler: () => ({
    request: () => undefined,
    stop: async () => undefined,
  }),
}));
vi.mock("../src/agent-activity/local-sync", () => ({
  startLocalAgentActivitySyncLoop: () => ({
    requestSync: () => undefined,
    stop: async () => undefined,
  }),
}));

vi.mock("../src/local-service/dispatch/execution-context-git-config", {
  spy: true,
});

const RUNTIME_COORDINATOR_EXECUTION_ID =
  "rce_space-1_dispatch-1_agent-profile-1";

function createPresenter(): Presenter {
  return {
    data: () => undefined,
    event: () => undefined,
    line: () => undefined,
    view: "human",
  };
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function createLedgerPaths(): LedgerPaths {
  const rootDirPath = mkdtempSync(
    join(tmpdir(), "openmeld-token-backed-start-")
  );
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

function createDeliveryExecutionIdentity() {
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
      agentControllerRef: "builtin:codex",
    },
  };
}

function createDeliverRequest() {
  return {
    v: 1 as const,
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
      dispatchPolicy: "mention_only" as const,
      controllerSnapshot: {
        targetBindingState: "bound" as const,
        targetBindingEnabled: true,
        agentControllerRef: "builtin:codex",
      },
      contextIdMappingSpec: null,
      dispatchId: "dispatch-1",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      executionIdentity: createDeliveryExecutionIdentity(),
      executionToken: {
        authorityScope: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-1",
        },
        deliveryIdempotencyKey: `${RUNTIME_COORDINATOR_EXECUTION_ID}:run-1`,
        deliveryProvenance: {
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-1",
          leaseEpoch: 1,
        },
        executionScope: {
          dispatchId: "dispatch-1",
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
          sourceClientMessageId: "client-message-1",
          spaceId: "space-1",
          targetProfileId: "agent-profile-1",
        },
        executionToken:
          "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        expiresAtMs: null,
        issuedAtMs: 1_700_000_000_000,
        modelVersion: RUNTIME_COORDINATOR_EXECUTION_TOKEN_MODEL_VERSION,
        runId: "run-1",
        tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        tokenStatus: "active" as const,
      },
      dispatchRulesSnapshot: {
        dispatchPolicy: "mention_only" as const,
        ruleSource: "registry" as const,
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
      enqueuedAtMs: 1_700_000_000_000,
      idempotencyKey: "dispatch-1:target:agent-profile-1",
      sourceEventId: "signal-1",
      sourceClientMessageId: "client-message-1",
      sourceSignal: {
        profileId: "user-profile-1",
        profileKind: "human" as const,
        text: "ping",
      },
      sourceSignalSnapshot: {
        profileId: "user-profile-1",
        profileKind: "human" as const,
        text: "ping",
      },
      spaceId: "space-1",
      streamingMode: "final" as const,
      targetProfileId: "agent-profile-1",
      taskId: "task-1",
      transportMode: "local-cli" as const,
    },
  };
}

type TestHost = Awaited<ReturnType<typeof createInProcessExecutionHost>>;

function createTokenHost(input: {
  ledgerPaths: LedgerPaths;
  adapter: LocalDaemonAdapterEntry;
  route?: DaemonProfileRouteConfig;
  onWorkStateChange?: Parameters<
    typeof createInProcessExecutionHost
  >[0]["onWorkStateChange"];
}) {
  const profileId = "agent-profile-1";
  return createInProcessExecutionHost({
    stateRoot: input.ledgerPaths.rootDirPath,
    daemonSessionId: "daemon-session-1",
    deviceId: "device-1",
    ownerUserId: "user-1",
    profileOwnerName: null,
    presenter: createPresenter(),
    onWorkStateChange: input.onWorkStateChange,
    resources: {
      ledgerPaths: input.ledgerPaths,
      contextStore: new Map(),
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: createInflightTaskControlRegistry(),
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      dispatchLimits: { globalConcurrency: 1, queueMax: 4 },
      localAdapterContainer: createLocalAdapterContainer([input.adapter]),
      initialCatalog: {
        profileIds: [profileId],
        skippedProfiles: [],
        routeByProfileId: new Map(
          input.route ? [[profileId, input.route]] : []
        ),
      },
    },
  });
}

function acknowledgeAdmission(
  host: TestHost,
  payload: Record<string, unknown>,
  connectionGeneration: number,
  accepted: boolean
) {
  return host.port.call("handleFrame", {
    connectionGeneration,
    frame: {
      v: 1,
      code: "daemon.dispatch.lifecycle_acknowledged",
      payload: {
        acknowledgementId: payload.acknowledgementId,
        dispatchId: payload.dispatchId,
        attemptId: payload.attemptId,
        connectionGeneration,
        accepted,
        validForMs: accepted ? 30_000 : 0,
        reasonCode: accepted
          ? null
          : "runtime_coordinator.execution_not_active",
      },
    },
  });
}

describe("local service token-backed execution start", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("preserves the control result, invalidation and stop when only the release observation fails", async () => {
    await withTempHome(async () => {
      const host = await createTokenHost({
        ledgerPaths: createLedgerPaths(),
        adapter: {
          adapterId: "codex",
          transportModes: ["codex-app-server"],
          adapter: {
            adapterId: "codex",
            dispatch: vi.fn(),
            interrupt: vi.fn(),
          },
        },
        onWorkStateChange: (state) => {
          if (!state.unattributedWork) {
            throw new Error("fixture release observation failed");
          }
        },
      });
      const events = vi.fn();
      host.port.onEvent(events);
      try {
        await expect(
          host.port.call("setEnabled", {
            agentId: "unknown-fixture-agent",
            enabled: true,
          })
        ).resolves.toMatchObject({ accepted: false, status: "rejected" });
        expect(events).toHaveBeenCalledWith(
          expect.objectContaining({ type: "invalidate", scope: "execution" })
        );
        await expect(host.port.call("stop", {})).resolves.toMatchObject({
          localQuiescent: true,
        });
      } finally {
        await host.close();
      }
    });
  });

  it("fences isolated workspace cleanup after the provider finishes, including during drain", async () => {
    await withTempHome(async (home) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("offline fixture"))
      );
      execFileSync("git", ["init", "--template=", "--quiet"], { cwd: home });
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=test@example.invalid",
          "-c",
          "core.hooksPath=/dev/null",
          "commit",
          "--quiet",
          "--allow-empty",
          "-m",
          "fixture",
        ],
        { cwd: home }
      );
      const request = createDeliverRequest();
      const profileId = request.profileId;
      await setCustomProfileWorkspace({
        openMeldProfileId: profileId,
        customWorkspacePath: home,
      });
      const folder = await resolveCurrentEffectiveProfileWorkingFolderRuntime({
        openMeldProfileId: profileId,
        mode: "dispatch",
      });
      const ledgerPaths = createLedgerPaths();
      const owner = await acquireExecutionHostOwnership({
        stateRoot: ledgerPaths.rootDirPath,
        hostInstanceId: randomUUID(),
        lane: "dev-local",
        ownerUserId: request.ownerUserId,
        deviceId: "device",
        bootIdentity: null,
      });
      const receipt = () =>
        JSON.parse(
          readFileSync(
            join(
              systemDir({ env: { OPENMELD_HOME: ledgerPaths.rootDirPath } }),
              "execution-host-owner.json"
            ),
            "utf8"
          )
        );
      const finishProvider = Promise.withResolvers<void>();
      const providerStarted = Promise.withResolvers<void>();
      const dispatch = vi.fn(async () => {
        providerStarted.resolve();
        await finishProvider.promise;
        return {
          status: "failed" as const,
          errorType: "adapter" as const,
          errorMessage: "fixture provider finished",
        };
      });
      const adapter = withProviderInvocationObserver(
        {
          adapterId: "codex",
          transportModes: ["codex-app-server"],
          adapter: { adapterId: "codex", dispatch, interrupt: vi.fn() },
        },
        owner.observeProviderInvocation
      );
      const host = await createTokenHost({
        ledgerPaths,
        adapter,
        onWorkStateChange: owner.observeWork,
        route: {
          profileId,
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-1",
          configurationRevision: 1,
          contextIdMappingSpec: {
            mappingVersion: 1,
            sourceField: "OPENMELD_CLI_CONTEXT_ID",
          },
          transportMode: "codex-app-server",
          streamingMode: "final",
          workingFolderRuntime: folder,
        },
      });
      const receiptsDuringCleanup: unknown[] = [];
      vi.mocked(auditExecutionContextGitConfig).mockImplementationOnce(() => {
        receiptsDuringCleanup.push(receipt());
        return Promise.resolve({
          restoredSettings: 0,
          declaredHookInstallers: 0,
          unverifiedHookSettings: 0,
        });
      });
      host.port.onEvent((event) => {
        if (
          event.type === "frame" &&
          event.frame.code === "daemon.dispatch.result"
        ) {
          providerStarted.reject(
            new Error(
              `Provider did not start: ${JSON.stringify(event.frame.payload)}`
            )
          );
        }
        if (
          event.type !== "frame" ||
          event.frame.code !== "daemon.dispatch.lifecycle"
        ) {
          return;
        }
        const p = event.frame.payload as Record<string, unknown>;
        if (p.acknowledgementId) {
          return acknowledgeAdmission(host, p, 1, true);
        }
      });
      try {
        await host.port.call("configureConnection", {
          connectionGeneration: 1,
          catalogRevision: 0,
          executionAdmissionConfirmation: true,
          leases: [{ profileId, leaseEpoch: 1 }],
        });
        await host.port.call("handleFrame", {
          connectionGeneration: 1,
          frame: {
            v: 1,
            code: "daemon.dispatch.deliver",
            payload: {
              ...request,
              payload: {
                ...request.payload,
                transportMode: "codex-app-server",
                controllerSnapshot: {
                  ...request.payload.controllerSnapshot,
                  bindingId: "binding-1",
                  configurationRevision: 1,
                },
                executionContext: {
                  version: 1,
                  id: randomUUID(),
                  scope: {
                    organizationId: "org",
                    requesterProfileId: "human",
                    spaceId: "space-1",
                    targetProfileId: profileId,
                    threadId: null,
                  },
                  access: "workspace",
                  workspace: "isolated",
                  permissionSource: "agent_settings",
                  nativeConversationId: null,
                  runtimeWorkspaceFingerprint: null,
                },
              },
            },
          },
        });
        await providerStarted.promise;
        await host.port.call("beginDrain", {});
        finishProvider.resolve();
        await host.port.call("drain", {});
        expect(receiptsDuringCleanup).toEqual([
          expect.objectContaining({
            localQuiescent: false,
            processEvidenceComplete: false,
          }),
        ]);
        expect(receipt()).toMatchObject({
          localQuiescent: true,
          processEvidenceComplete: true,
        });
      } finally {
        finishProvider.resolve();
        await host.close();
        await owner.release();
      }
    });
  });

  it.each([
    "reconnect",
    "connector_exit",
  ])("retains accepted queued work across transport loss and fences provider admission on %s", async (outcome) => {
    const ledgerPaths = createLedgerPaths();
    vi.stubEnv("OPENMELD_HOME", ledgerPaths.rootDirPath);
    const dispatch = vi.fn();
    const host = await createTokenHost({
      ledgerPaths,
      adapter: {
        adapterId: "codex",
        transportModes: ["local-cli"],
        adapter: { adapterId: "codex", dispatch, interrupt: vi.fn() },
      },
    });
    let rejectAdmissions = false;
    const acknowledgements: Record<string, unknown>[] = [];
    host.port.onEvent((event) => {
      if (
        event.type !== "frame" ||
        event.frame.code !== "daemon.dispatch.lifecycle"
      ) {
        return;
      }
      const payload = event.frame.payload as Record<string, unknown>;
      if (!payload.acknowledgementId) {
        return;
      }
      acknowledgements.push(payload);
      if (rejectAdmissions) {
        return acknowledgeAdmission(host, payload, 2, false);
      }
    });
    const configure = (connectionGeneration: number, leaseEpoch: number) =>
      host.port.call("configureConnection", {
        connectionGeneration,
        catalogRevision: 0,
        executionAdmissionConfirmation: true,
        leases: [{ profileId: "agent-profile-1", leaseEpoch }],
      });
    try {
      await configure(1, 1);
      const first = createDeliverRequest();
      await host.port.call("handleFrame", {
        connectionGeneration: 1,
        frame: { v: 1, code: "daemon.dispatch.deliver", payload: first },
      });
      await vi.waitFor(() => expect(acknowledgements).toHaveLength(1));
      const second = {
        ...first,
        attemptId: "attempt-2",
        payload: { ...first.payload, attemptId: "attempt-2", taskId: "task-2" },
      };
      await host.port.call("handleFrame", {
        connectionGeneration: 1,
        frame: { v: 1, code: "daemon.dispatch.deliver", payload: second },
      });
      expect(host.port.snapshot()).toMatchObject({
        activeCount: 1,
        pendingCount: 1,
        localQuiescent: false,
      });
      await host.port.call("detachConnection", { connectionGeneration: 1 });
      expect(host.port.snapshot()).toMatchObject({
        activeCount: 1,
        pendingCount: 1,
        localQuiescent: false,
      });
    } finally {
      // The replacement route rejects the first task's admission and revokes the
      // queued task's old lease. Neither task may reach the native provider.
      rejectAdmissions = true;
      if (outcome === "reconnect") {
        await configure(2, 2);
      }
      await host.close();
      vi.unstubAllEnvs();
    }
    expect(dispatch).not.toHaveBeenCalled();
    expect(host.port.snapshot()).toMatchObject({
      activeCount: 0,
      pendingCount: 0,
      localQuiescent: true,
    });
  });

  it("does not use final claim rejection semantics for the current token-backed task", async () => {
    const socketSend = vi.fn();
    const socket = { send: socketSend } as never;

    const result = await handleDispatchDeliverFrame({
      computerFileAccessStorePath:
        "/tmp/openmeld-test-missing-computer-file-access-policy.json",
      contextStore: new Map(),
      currentSocketRef: { connectionGeneration: 1, socket },
      daemonSessionId: "daemon-session-1",
      deliverRequest: createDeliverRequest(),
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: createInflightTaskControlRegistry(),
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      ledgerPaths: createLedgerPaths(),
      leasesByProfileId: new Map([["agent-profile-1", 1]]),
      localAdapterContainer: {
        getAdapter: () => null,
      } as never,
      profileOwnerName: "Owner",
      profileOwnerUserId: "user-1",
      presenter: createPresenter(),
      routeByProfileId: new Map(),
      socket,
    });

    expect(result).toMatchObject({
      errorCode: "controller.kind.unsupported",
      result: "failed",
    });
    const resultFrame = socketSend.mock.calls
      .map(([frame]) => JSON.parse(String(frame)))
      .find((frame) => frame.code === "daemon.dispatch.result");
    const runtimeEvidenceFrames = socketSend.mock.calls
      .map(([frame]) => JSON.parse(String(frame)))
      .filter((frame) => frame.code === "daemon.dispatch.runtime_evidence");
    expect(resultFrame?.payload.taskResult.payload).toMatchObject({
      errorCode: "controller.kind.unsupported",
      status: "failed",
    });
    expect(resultFrame?.payload.taskResult.payload.claimLease).toBeUndefined();
    expect(resultFrame?.payload.taskResult.payload.status).not.toBe("success");
    expect(resultFrame?.payload.executionTokenEcho).toMatchObject({
      executionToken:
        "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      runId: "run-1",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(runtimeEvidenceFrames.map((frame) => frame.payload.phase)).toEqual([
      "failed",
    ]);
    expect(runtimeEvidenceFrames[0]?.payload).not.toHaveProperty(
      "claimLeaseId"
    );
    expect(runtimeEvidenceFrames[0]?.payload).toMatchObject({
      dispatchId: "dispatch-1",
      executionTokenEcho: {
        executionToken:
          "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        runId: "run-1",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      phase: "failed",
      reasonCode: "controller.kind.unsupported",
      sourceClientMessageId: "client-message-1",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-profile-1",
    });
  });

  it("does not attach legacy claim lease evidence when handling unsupported-controller diagnostics", async () => {
    const socketSend = vi.fn();
    const socket = { send: socketSend } as never;

    const result = await handleDispatchDeliverFrame({
      computerFileAccessStorePath:
        "/tmp/openmeld-test-missing-computer-file-access-policy.json",
      contextStore: new Map(),
      currentSocketRef: { connectionGeneration: 1, socket },
      daemonSessionId: "daemon-session-1",
      deliverRequest: createDeliverRequest(),
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: createInflightTaskControlRegistry(),
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      ledgerPaths: createLedgerPaths(),
      leasesByProfileId: new Map([["agent-profile-1", 1]]),
      localAdapterContainer: {
        getAdapter: () => null,
      } as never,
      profileOwnerName: "Owner",
      profileOwnerUserId: "user-1",
      presenter: createPresenter(),
      routeByProfileId: new Map(),
      socket,
    });

    const resultFrame = socketSend.mock.calls
      .map(([frame]) => JSON.parse(String(frame)))
      .find((frame) => frame.code === "daemon.dispatch.result");
    const runtimeEvidenceFrames = socketSend.mock.calls
      .map(([frame]) => JSON.parse(String(frame)))
      .filter((frame) => frame.code === "daemon.dispatch.runtime_evidence");

    expect(result).toMatchObject({
      errorCode: "controller.kind.unsupported",
      result: "failed",
    });
    expect(result.errorMessage).toContain("controller.kind.unsupported:");
    expect(resultFrame?.payload.taskResult.payload).toMatchObject({
      errorCode: "controller.kind.unsupported",
      status: "failed",
    });
    expect(resultFrame?.payload.taskResult.payload.claimLease).toBeUndefined();
    expect(resultFrame?.payload.taskResult.payload.status).not.toBe("success");
    expect(resultFrame?.payload.executionTokenEcho?.executionToken).toBe(
      "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    expect(runtimeEvidenceFrames.map((frame) => frame.payload.phase)).toEqual([
      "failed",
    ]);
    expect(runtimeEvidenceFrames[0]?.payload).not.toHaveProperty(
      "claimLeaseId"
    );
    expect(runtimeEvidenceFrames[0]?.payload).toMatchObject({
      executionIdentityEcho: {
        echoSource: "daemon_delivery_context",
        core: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
        },
      },
    });
  });
});
