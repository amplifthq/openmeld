import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEmptyLedgerState,
  type RuntimeTaskResult,
} from "@openmeld/local-execution";
import {
  createInflightTaskControlRegistry,
  createPendingAgentInteractionRegistry,
} from "@openmeld/local-service";
import type { SignalEnvelope } from "@openmeld/protocol";
import {
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
  spaceMetaSchema,
} from "@openmeld/schemas";
import type { RuntimeTransportDeliverDispatchRequest } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindProject,
  setDefaultProjectConnection,
} from "../src/agent-activity/project-bindings";
import { handleLocalControlPlaneCancel } from "../src/local-service/carrier/local-control-handlers";
import type {
  CurrentDaemonSocketRef,
  DaemonProfileRouteConfig,
  LedgerPaths,
} from "../src/local-service/core/types";
import { readRecentDaemonDispatchJournalEvents } from "../src/local-service/dispatch/daemon-dispatch-journal";
import { acknowledgeDispatchResultOutboxRecord } from "../src/local-service/dispatch/dispatch-result-outbox";
import { handleDispatchDeliverFrame } from "../src/local-service/dispatch/execute-dispatch-task";
import { OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV } from "../src/runtime/dispatch-space-action-context";
import type { Presenter } from "../src/runtime/presenter/types";
import { runSpaceActionReply } from "../src/space/action-command";
import type { fetchSpaceMeta } from "../src/space/meta-api";
import type { fetchSpaceUpdates } from "../src/space/updates-api";
import { withTempHome } from "./helpers/fs";

const {
  downloadDispatchImageAttachmentMock,
  fetchSpaceMetaMock,
  fetchSpaceUpdatesMock,
  prepareProviderRuntimeMock,
  resolveProfileWorkspaceRuntimeMock,
  runRuntimeTaskMock,
} = vi.hoisted(() => ({
  downloadDispatchImageAttachmentMock: vi.fn(),
  fetchSpaceMetaMock: vi.fn<typeof fetchSpaceMeta>(),
  fetchSpaceUpdatesMock: vi.fn<typeof fetchSpaceUpdates>(),
  prepareProviderRuntimeMock: vi.fn(),
  resolveProfileWorkspaceRuntimeMock: vi.fn(),
  runRuntimeTaskMock: vi.fn(),
}));

vi.mock("../src/space/meta-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/space/meta-api")>();
  return {
    ...actual,
    fetchSpaceMeta: fetchSpaceMetaMock,
  };
});

vi.mock("../src/space/updates-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/space/updates-api")>();
  return {
    ...actual,
    fetchSpaceUpdates: fetchSpaceUpdatesMock,
  };
});

vi.mock(
  "../src/local-service/dispatch/dispatch-image-attachments",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../src/local-service/dispatch/dispatch-image-attachments")
      >();
    return {
      ...actual,
      downloadDispatchImageAttachment: downloadDispatchImageAttachmentMock,
    };
  }
);

vi.mock("@openmeld/local-execution", async () => {
  const actual = await vi.importActual<
    typeof import("@openmeld/local-execution")
  >("@openmeld/local-execution");
  return {
    ...actual,
    runRuntimeTask: runRuntimeTaskMock,
  };
});

vi.mock("../src/profile-workspace/runtime-resolution", () => ({
  resolveProfileWorkspaceRuntime: resolveProfileWorkspaceRuntimeMock,
}));

vi.mock("../src/provider-hosts/prepare-provider-runtime", () => ({
  prepareProviderRuntime: prepareProviderRuntimeMock,
}));

const tempDirs: string[] = [];
const CLI_SPACE_ACTION_FINALIZATION_TIMEOUT_MS = 15_000;

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

beforeEach(() => {
  vi.resetAllMocks();
  fetchSpaceMetaMock.mockRejectedValue(new Error("Space meta is unavailable"));
  fetchSpaceUpdatesMock.mockResolvedValue({ signals: [] });
});

function createPresenter(): Presenter & { events: Array<{ code?: string }> } {
  const events: Array<{ code?: string }> = [];
  return {
    data: (line) => {
      events.push(line as { code?: string });
    },
    event: () => undefined,
    line: (line) => {
      events.push(line as { code?: string });
    },
    events,
    view: "agent",
  } as Presenter & { events: Array<{ code?: string }> };
}

function createAcceptedSettlementSocket(input: {
  ledgerPaths: LedgerPaths;
  presenter: Presenter;
  reviewFirst?: boolean;
}): { send: ReturnType<typeof vi.fn> } {
  let acknowledgementQueued = false;
  return {
    send: vi.fn((rawFrame: string) => {
      const frame = JSON.parse(rawFrame) as {
        code?: string;
        payload?: { attemptId?: string; dispatchId?: string };
      };
      if (
        acknowledgementQueued ||
        frame.code !== "daemon.dispatch.result" ||
        !frame.payload?.attemptId ||
        !frame.payload.dispatchId
      ) {
        return;
      }
      acknowledgementQueued = true;
      queueMicrotask(() => {
        acknowledgeDispatchResultOutboxRecord({
          attemptId: frame.payload?.attemptId ?? null,
          dispatchId: frame.payload?.dispatchId ?? "unknown",
          ledgerPaths: input.ledgerPaths,
          ok: !input.reviewFirst,
          presenter: input.presenter,
          status: input.reviewFirst ? "review_required" : "accepted",
          ...(input.reviewFirst
            ? { reasonCode: "space.agent_reply.context_changed" }
            : {}),
        });
      });
    }),
  };
}

function readSentTaskResultPayload(socket: {
  send: ReturnType<typeof vi.fn>;
}): ReturnType<
  typeof readOutboxFile
>["records"][number]["taskResult"]["payload"] {
  const resultFrame = socket.send.mock.calls
    .map(
      ([rawFrame]) => JSON.parse(String(rawFrame)) as Record<string, unknown>
    )
    .find((frame) => frame.code === "daemon.dispatch.result") as
    | {
        payload?: {
          taskResult?: {
            payload?: ReturnType<
              typeof readOutboxFile
            >["records"][number]["taskResult"]["payload"];
          };
        };
      }
    | undefined;
  const payload = resultFrame?.payload?.taskResult?.payload;
  if (!payload) {
    throw new Error("expected one daemon.dispatch.result frame");
  }
  return payload;
}

function createLedgerPaths(): LedgerPaths {
  const rootDirPath = mkdtempSync(
    join(tmpdir(), "openmeld-result-outbox-preview-")
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

function createCurrentRouteByProfileId(
  workspacePath = process.cwd()
): Map<string, DaemonProfileRouteConfig> {
  return new Map([
    [
      "agent-profile-1",
      {
        agentControllerRef: "builtin:codex",
        bindingId: "binding-1",
        configurationRevision: 7,
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
          configuredWorkspacePath: workspacePath,
          effectiveRuntimeWorkingDirectory: workspacePath,
          runtimeContext: {
            providerRuntimeWorkingDirectory: workspacePath,
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

function createCurrentDefaultProjectRouteByProfileId(
  workspacePath: string,
  bindingGeneration = "project-generation-1"
): ReturnType<typeof createCurrentRouteByProfileId> {
  const routes = createCurrentRouteByProfileId(workspacePath);
  const route = routes.get("agent-profile-1");
  if (!route) {
    throw new Error("test route missing");
  }
  route.workingFolderRuntime = {
    configPath: null,
    configuredWorkspacePath: workspacePath,
    defaultProjectBindingGeneration: bindingGeneration,
    defaultProjectId: "project-1",
    effectiveRuntimeWorkingDirectory: workspacePath,
    runtimeContext: {
      providerRuntimeWorkingDirectory: workspacePath,
    },
    status: "ready",
    workingFolderFact: {
      defaultProjectId: "project-1",
      localProjectBindingGeneration: bindingGeneration,
      observedAtMs: Date.now(),
      reasonCode: null,
      source: "default_project",
      status: "ready",
    },
    workingFolderSource: "default_project",
    workspaceMode: null,
  };
  return routes;
}

function readOutboxFile(ledgerPaths: LedgerPaths): {
  records: Array<{
    dispatchId: string;
    taskResult: {
      payload: {
        errorCode?: string;
        errorMessage?: string;
        output?: string;
        spaceAction?: unknown;
        spaceActionProvenance?: string;
        status?: string;
      };
    };
  }>;
} {
  return JSON.parse(
    readFileSync(join(ledgerPaths.rootDirPath, "dispatch-result-outbox.json"), {
      encoding: "utf8",
    })
  ) as {
    records: Array<{
      dispatchId: string;
      taskResult: {
        payload: {
          errorCode?: string;
          errorMessage?: string;
          output?: string;
          spaceAction?: unknown;
          spaceActionProvenance?: string;
          status?: string;
        };
      };
    }>;
  };
}

function createDeliverRequest(): RuntimeTransportDeliverDispatchRequest {
  return {
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
      dispatchId: "dispatch-1",
      runtimeCoordinatorExecutionId: "rce_space-1_dispatch-1_agent-profile-1",
      dispatchPolicy: "mention_only",
      controllerSnapshot: {
        agentControllerRef: "builtin:codex",
        bindingId: "binding-1",
        configurationRevision: 7,
        targetBindingEnabled: true,
        targetBindingState: "bound",
      },
      agentControllerConversationId: "ctx-1",
      contextIdMappingSpec: null,
      dispatchRulesSnapshot: {
        dispatchPolicy: "mention_only",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        ruleSource: "registry",
      },
      enqueuedAtMs: 1_700_000_000_000,
      executionIdentity: createDeliveryExecutionIdentity(),
      executionToken: {
        authorityScope: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-1",
        },
        deliveryIdempotencyKey: "rce_space-1_dispatch-1_agent-profile-1:run-1",
        deliveryProvenance: {
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-1",
          leaseEpoch: 1,
        },
        executionScope: {
          dispatchId: "dispatch-1",
          runtimeCoordinatorExecutionId:
            "rce_space-1_dispatch-1_agent-profile-1",
          sourceClientMessageId: "client-message-1",
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
      idempotencyKey: "dispatch-1:target:agent-profile-1",
      sourceEventId: "signal-1",
      sourceClientMessageId: "client-message-1",
      sourceSignal: {
        profileId: "user-profile-1",
        profileKind: "human",
        text: "please reply",
      },
      sourceSignalSnapshot: {
        profileId: "user-profile-1",
        profileKind: "human",
        text: "please reply",
      },
      spaceId: "space-1",
      streamingMode: "final",
      targetProfileId: "agent-profile-1",
      taskId: "task-1",
      transportMode: "local-cli",
    },
  };
}

function createRuntimeResult(input?: {
  output?: string;
  spaceAction?: RuntimeTaskResult["resultPayload"]["spaceAction"];
  spaceActionProvenance?: RuntimeTaskResult["resultPayload"]["spaceActionProvenance"];
}): RuntimeTaskResult {
  const state = createEmptyLedgerState(0);
  const output = input?.output ?? "durable reply";
  return {
    agentContextLifecycleCounters: state.agentContextLifecycleCounters,
    deduped: false,
    dispatchResult: {
      adapterResult: {
        contextDelta: {
          agentControllerConversationId: "ctx-1",
        },
        output,
        status: "success",
      },
      dispatched: true,
      reason: "dispatched",
    },
    resultPayload: {
      agentId: "agent-profile-1",
      attemptId: "attempt-1",
      deduped: false,
      output,
      sourceEventId: "signal-1",
      ...(input?.spaceAction ? { spaceAction: input.spaceAction } : {}),
      ...(input?.spaceActionProvenance
        ? { spaceActionProvenance: input.spaceActionProvenance }
        : {}),
      status: "success",
      taskId: "task-1",
    },
    runtimeState: "idle",
    state,
  };
}

function createRuntimeSuccessResult(): RuntimeTaskResult {
  return createRuntimeResult({
    output: "durable reply",
    spaceAction: {
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: [],
        text: "durable reply",
      },
      type: "post_message",
    },
    spaceActionProvenance: "direct",
  });
}

function createSiblingReplySignal(input: {
  profileId: string;
}): SignalEnvelope {
  return {
    data: {
      meta: {
        dispatchId: "dispatch-sibling-1",
        purpose: "agent_reply_final",
        targetProfileId: input.profileId,
      },
      replyTo: {
        profileId: "user-profile-1",
        profileKind: "human",
        profileName: "User",
        previewText: "please reply",
        signalId: "signal-1",
      },
      text: "Sibling Agent replied first.",
    },
    id: "signal-sibling-reply-1",
    profile: {
      kind: "agent",
      profileId: input.profileId,
      profileName: "Sibling Agent",
    },
    spaceId: "space-1",
    ts: 1_700_000_000_100,
    type: "signal.text",
    v: 1,
  };
}

describe("dispatch result outbox around preview teardown", () => {
  it("does not start the controller when a legacy dispatch has no current route working-folder fact", async () => {
    await withTempHome(async () => {
      const ledgerPaths = createLedgerPaths();
      const presenter = createPresenter();
      const socket = createAcceptedSettlementSocket({
        ledgerPaths,
        presenter,
      }) as never;

      const result = await handleDispatchDeliverFrame({
        computerFileAccessStorePath:
          "/tmp/openmeld-test-missing-computer-file-access-policy.json",
        contextStore: new Map(),
        currentSocketRef: { connectionGeneration: 1, socket },
        daemonSessionId: "daemon-session-1",
        deliverRequest: createDeliverRequest(),
        inflightDispatchMetaByTaskId: new Map(),
        inflightTaskControlRegistry: createInflightTaskControlRegistry(),
        pendingAgentInteractionRegistry:
          createPendingAgentInteractionRegistry(),
        ledgerPaths,
        leasesByProfileId: new Map([["agent-profile-1", 1]]),
        localAdapterContainer: {
          getAdapter: () => ({ adapter: {} }),
        } as never,
        profileOwnerName: "Owner",
        profileOwnerUserId: "user-1",
        presenter,
        routeByProfileId: new Map<string, DaemonProfileRouteConfig>(),
        socket,
      });

      expect(result).toMatchObject({
        errorCode: "profile.working_folder.current_fact_missing",
        result: "failed",
      });
      expect(prepareProviderRuntimeMock).not.toHaveBeenCalled();
      expect(runRuntimeTaskMock).not.toHaveBeenCalled();
    });
  });

  it("launches a dispatch with an explicit Default Project only after its current route matches", async () => {
    await withTempHome(async (home) => {
      const ledgerPaths = createLedgerPaths();
      const presenter = createPresenter();
      const socket = createAcceptedSettlementSocket({
        ledgerPaths,
        presenter,
      }) as never;
      const workspacePath = join(home, "current-default-project");
      mkdirSync(workspacePath, { recursive: true });
      const connection = await bindProject({
        organizationId: "org-1",
        projectId: "project-1",
        projectSlug: "openmeld",
        repositoryFingerprint: null,
        repositoryPath: workspacePath,
      });
      const runtimeContext = {
        providerRuntimeWorkingDirectory: connection.repositoryPath,
      };
      prepareProviderRuntimeMock.mockImplementation((input) => {
        expect(input.runtimeContext).toEqual(runtimeContext);
        return {
          envOverrides: undefined,
          preparationDetails: { kind: "none" },
          runtimeContext,
        };
      });
      runRuntimeTaskMock.mockResolvedValue(createRuntimeSuccessResult());

      const deliverRequest = createDeliverRequest();
      deliverRequest.payload.defaultProjectId = "project-1";
      const result = await handleDispatchDeliverFrame({
        computerFileAccessStorePath:
          "/tmp/openmeld-test-missing-computer-file-access-policy.json",
        contextStore: new Map(),
        currentSocketRef: { connectionGeneration: 1, socket },
        daemonSessionId: "daemon-session-1",
        deliverRequest,
        inflightDispatchMetaByTaskId: new Map(),
        inflightTaskControlRegistry: createInflightTaskControlRegistry(),
        pendingAgentInteractionRegistry:
          createPendingAgentInteractionRegistry(),
        ledgerPaths,
        leasesByProfileId: new Map([["agent-profile-1", 1]]),
        localAdapterContainer: {
          getAdapter: () => ({ adapter: {} }),
        } as never,
        profileOwnerName: "Owner",
        profileOwnerUserId: "user-1",
        presenter,
        routeByProfileId: createCurrentDefaultProjectRouteByProfileId(
          runtimeContext.providerRuntimeWorkingDirectory,
          connection.bindingGeneration
        ),
        socket,
      });

      expect(result).toEqual({
        errorCode: null,
        errorMessage: null,
        result: "success",
      });
      expect(prepareProviderRuntimeMock).toHaveBeenCalled();
      expect(runRuntimeTaskMock).toHaveBeenCalledOnce();
      expect(resolveProfileWorkspaceRuntimeMock).not.toHaveBeenCalled();
    });
  });

  it("does not start an explicit Default Project dispatch after the durable folder changes but before its route refresh finishes", async () => {
    await withTempHome(async (home) => {
      const firstPath = join(home, "first-default-project");
      const secondPath = join(home, "second-default-project");
      mkdirSync(firstPath, { recursive: true });
      mkdirSync(secondPath, { recursive: true });
      const first = await bindProject({
        organizationId: "org-1",
        projectId: "project-1",
        projectSlug: "openmeld",
        repositoryFingerprint: null,
        repositoryPath: firstPath,
      });
      const second = await bindProject({
        organizationId: "org-1",
        projectId: "project-1",
        projectSlug: "openmeld",
        repositoryFingerprint: null,
        repositoryPath: secondPath,
      });
      await setDefaultProjectConnection({
        expectedBindingGeneration: second.bindingGeneration,
        organizationId: "org-1",
        projectId: "project-1",
      });
      const ledgerPaths = createLedgerPaths();
      const presenter = createPresenter();
      const socket = createAcceptedSettlementSocket({
        ledgerPaths,
        presenter,
      }) as never;

      const deliverRequest = createDeliverRequest();
      deliverRequest.payload.defaultProjectId = "project-1";
      const requestCurrentWorkingFolderFactRefresh = vi.fn();
      const result = await handleDispatchDeliverFrame({
        computerFileAccessStorePath:
          "/tmp/openmeld-test-missing-computer-file-access-policy.json",
        contextStore: new Map(),
        currentSocketRef: { connectionGeneration: 1, socket },
        daemonSessionId: "daemon-session-1",
        deliverRequest,
        inflightDispatchMetaByTaskId: new Map(),
        inflightTaskControlRegistry: createInflightTaskControlRegistry(),
        pendingAgentInteractionRegistry:
          createPendingAgentInteractionRegistry(),
        ledgerPaths,
        leasesByProfileId: new Map([["agent-profile-1", 1]]),
        localAdapterContainer: {
          getAdapter: () => ({ adapter: {} }),
        } as never,
        profileOwnerName: "Owner",
        profileOwnerUserId: "user-1",
        requestCurrentWorkingFolderFactRefresh,
        presenter,
        routeByProfileId: createCurrentDefaultProjectRouteByProfileId(
          firstPath,
          first.bindingGeneration
        ),
        socket,
      });

      expect(result).toMatchObject({
        errorCode: "profile.working_folder.current_fact_changed",
        result: "failed",
      });
      expect(prepareProviderRuntimeMock).not.toHaveBeenCalled();
      expect(runRuntimeTaskMock).not.toHaveBeenCalled();
      expect(requestCurrentWorkingFolderFactRefresh).toHaveBeenCalledOnce();
    });
  });

  it("does not start the controller after a Profile workspace changes but before its route refresh finishes", async () => {
    await withTempHome(async (home) => {
      const firstPath = join(home, "first-profile-workspace");
      const secondPath = join(home, "second-profile-workspace");
      mkdirSync(firstPath, { recursive: true });
      mkdirSync(secondPath, { recursive: true });
      resolveProfileWorkspaceRuntimeMock.mockResolvedValue({
        configPath: join(home, "profile-workspace.json"),
        configuredWorkspacePath: secondPath,
        effectiveRuntimeWorkingDirectory: secondPath,
        runtimeContext: {
          providerRuntimeWorkingDirectory: secondPath,
        },
        status: "ready",
        workspaceMode: "custom",
      });
      const ledgerPaths = createLedgerPaths();
      const presenter = createPresenter();
      const socket = createAcceptedSettlementSocket({
        ledgerPaths,
        presenter,
      }) as never;

      const result = await handleDispatchDeliverFrame({
        computerFileAccessStorePath:
          "/tmp/openmeld-test-missing-computer-file-access-policy.json",
        contextStore: new Map(),
        currentSocketRef: { connectionGeneration: 1, socket },
        daemonSessionId: "daemon-session-1",
        deliverRequest: createDeliverRequest(),
        inflightDispatchMetaByTaskId: new Map(),
        inflightTaskControlRegistry: createInflightTaskControlRegistry(),
        pendingAgentInteractionRegistry:
          createPendingAgentInteractionRegistry(),
        ledgerPaths,
        leasesByProfileId: new Map([["agent-profile-1", 1]]),
        localAdapterContainer: {
          getAdapter: () => ({ adapter: {} }),
        } as never,
        profileOwnerName: "Owner",
        profileOwnerUserId: "user-1",
        presenter,
        routeByProfileId: createCurrentRouteByProfileId(firstPath),
        socket,
      });

      expect(result).toMatchObject({
        errorCode: "profile.working_folder.current_fact_changed",
        result: "failed",
      });
      expect(prepareProviderRuntimeMock).not.toHaveBeenCalled();
      expect(runRuntimeTaskMock).not.toHaveBeenCalled();
    });
  });

  it.each([
    false,
    true,
  ])("preserves the reply proposal without inspecting Service installation (observation unavailable: %s)", async (observationUnavailable) => {
    await withTempHome(async () => {
      const serviceInventory = await import(
        "../src/local-service/lifecycle/daemon-service-inventory"
      );
      const inspectInstallation = vi
        .spyOn(serviceInventory, "inspectDaemonServiceInventory")
        .mockRejectedValue(new Error("Maintenance inspection is unavailable"));
      const ledgerPaths = createLedgerPaths();
      const presenter = createPresenter();
      const settlementSocket = createAcceptedSettlementSocket({
        ledgerPaths,
        presenter,
      });
      if (observationUnavailable) {
        fetchSpaceUpdatesMock.mockRejectedValue(
          new Error("space.updates.read request timed out after 10000ms")
        );
      }
      const socket = settlementSocket as never;
      const runtimeContext = {
        providerRuntimeWorkingDirectory: process.cwd(),
      };
      fetchSpaceMetaMock.mockResolvedValueOnce(
        spaceMetaSchema.parse({
          spaceId: "space-1",
          organizationId: "org-1",
          visibility: "private",
          name: "Launch Room",
          purpose: "Coordinate the launch",
          guide: "Prefer reversible decisions.",
        })
      );
      resolveProfileWorkspaceRuntimeMock.mockResolvedValue({
        runtimeContext,
        status: "ready",
      });
      prepareProviderRuntimeMock.mockResolvedValue({
        envOverrides: undefined,
        preparationDetails: { kind: "none" },
        runtimeContext,
      });
      runRuntimeTaskMock.mockImplementationOnce((input) => {
        expect(input.task.prompt).toContain(
          '- This space: "Launch Room" — Coordinate the launch'
        );
        expect(input.task.prompt).toContain(
          "- Space guide (maintained by this space's steward):\nPrefer reversible decisions."
        );
        return createRuntimeSuccessResult();
      });

      const result = await handleDispatchDeliverFrame({
        computerFileAccessStorePath:
          "/tmp/openmeld-test-missing-computer-file-access-policy.json",
        contextStore: new Map(),
        currentSocketRef: { connectionGeneration: 1, socket },
        daemonSessionId: "daemon-session-1",
        deliverRequest: createDeliverRequest(),
        inflightDispatchMetaByTaskId: new Map(),
        inflightTaskControlRegistry: createInflightTaskControlRegistry(),
        pendingAgentInteractionRegistry:
          createPendingAgentInteractionRegistry(),
        ledgerPaths,
        leasesByProfileId: new Map([["agent-profile-1", 1]]),
        localAdapterContainer: {
          getAdapter: () => ({ adapter: {} }),
        } as never,
        profileOwnerName: "Owner",
        profileOwnerUserId: "user-1",
        presenter,
        routeByProfileId: createCurrentRouteByProfileId(),
        socket,
      });

      expect(result).toEqual({
        errorCode: null,
        errorMessage: null,
        result: "success",
      });
      expect(fetchSpaceMetaMock).toHaveBeenCalledTimes(1);
      expect(inspectInstallation).not.toHaveBeenCalled();
      expect(runRuntimeTaskMock).toHaveBeenCalledOnce();
      const proposal = settlementSocket.send.mock.calls
        .map(([raw]) => JSON.parse(raw))
        .find((frame) => frame.code === "daemon.dispatch.result");
      expect(proposal.payload.taskResult.payload).toMatchObject({
        status: "success",
        spaceAction: {
          type: "post_message",
          observedThroughSignalId: "signal-1",
        },
      });
    });
  });

  it("ends result review without restarting the controller when the context cursor cannot advance", async () => {
    await withTempHome(async () => {
      const ledgerPaths = createLedgerPaths();
      const presenter = createPresenter();
      const settlementSocket = createAcceptedSettlementSocket({
        reviewFirst: true,
        ledgerPaths,
        presenter,
      });
      const socket = settlementSocket as never;
      const runtimeContext = {
        providerRuntimeWorkingDirectory: process.cwd(),
      };
      fetchSpaceMetaMock.mockResolvedValueOnce(
        spaceMetaSchema.parse({
          spaceId: "space-1",
          organizationId: "org-1",
          visibility: "private",
          name: "Launch Room",
          purpose: "Coordinate the launch",
          guide: "Prefer reversible decisions.",
        })
      );
      resolveProfileWorkspaceRuntimeMock.mockResolvedValue({
        runtimeContext,
        status: "ready",
      });
      prepareProviderRuntimeMock.mockResolvedValue({
        envOverrides: undefined,
        preparationDetails: { kind: "none" },
        runtimeContext,
      });
      runRuntimeTaskMock.mockImplementationOnce((input) => {
        expect(input.task.prompt).toContain(
          '- This space: "Launch Room" — Coordinate the launch'
        );
        expect(input.task.prompt).toContain(
          "- Space guide (maintained by this space's steward):\nPrefer reversible decisions."
        );
        return createRuntimeSuccessResult();
      });

      const result = await handleDispatchDeliverFrame({
        computerFileAccessStorePath:
          "/tmp/openmeld-test-missing-computer-file-access-policy.json",
        contextStore: new Map(),
        currentSocketRef: { connectionGeneration: 1, socket },
        daemonSessionId: "daemon-session-1",
        deliverRequest: createDeliverRequest(),
        inflightDispatchMetaByTaskId: new Map(),
        inflightTaskControlRegistry: createInflightTaskControlRegistry(),
        pendingAgentInteractionRegistry:
          createPendingAgentInteractionRegistry(),
        ledgerPaths,
        leasesByProfileId: new Map([["agent-profile-1", 1]]),
        localAdapterContainer: {
          getAdapter: () => ({ adapter: {} }),
        } as never,
        profileOwnerName: "Owner",
        profileOwnerUserId: "user-1",
        presenter,
        routeByProfileId: createCurrentRouteByProfileId(),
        socket,
      });

      expect(result).toMatchObject({
        errorCode: "dispatch.agent_reply_observation.no_progress",
        result: "failed",
      });
      expect(runRuntimeTaskMock).toHaveBeenCalledOnce();
      const submitted = settlementSocket.send.mock.calls
        .map(([raw]) => JSON.parse(raw))
        .filter((frame) => frame.code === "daemon.dispatch.result");
      expect(submitted).toHaveLength(2);
      expect(submitted[1].payload.taskResult.payload).toMatchObject({
        status: "failed",
        errorCode: "dispatch.agent_reply_observation.no_progress",
      });
      expect(fetchSpaceMetaMock).toHaveBeenCalledTimes(1);
    });
  });

  it("continues dispatch with an omitted meta section when Space meta loading fails", async () => {
    await withTempHome(async () => {
      const ledgerPaths = createLedgerPaths();
      const presenter = createPresenter();
      const settlementSocket = createAcceptedSettlementSocket({
        ledgerPaths,
        presenter,
      });
      const socket = settlementSocket as never;
      const runtimeContext = {
        providerRuntimeWorkingDirectory: process.cwd(),
      };
      resolveProfileWorkspaceRuntimeMock.mockResolvedValue({
        runtimeContext,
        status: "ready",
      });
      prepareProviderRuntimeMock.mockResolvedValue({
        envOverrides: undefined,
        preparationDetails: { kind: "none" },
        runtimeContext,
      });
      runRuntimeTaskMock.mockImplementationOnce((input) => {
        expect(input.task.prompt).toContain("Space Entry Brief:");
        expect(input.task.prompt).toContain("Space Dispatch Brief:");
        expect(input.task.prompt).not.toContain("- This space:");
        expect(input.task.prompt).not.toContain("Space guide (maintained by");
        return createRuntimeSuccessResult();
      });

      const result = await handleDispatchDeliverFrame({
        computerFileAccessStorePath:
          "/tmp/openmeld-test-missing-computer-file-access-policy.json",
        contextStore: new Map(),
        currentSocketRef: { connectionGeneration: 1, socket },
        daemonSessionId: "daemon-session-1",
        deliverRequest: createDeliverRequest(),
        inflightDispatchMetaByTaskId: new Map(),
        inflightTaskControlRegistry: createInflightTaskControlRegistry(),
        pendingAgentInteractionRegistry:
          createPendingAgentInteractionRegistry(),
        ledgerPaths,
        leasesByProfileId: new Map([["agent-profile-1", 1]]),
        localAdapterContainer: {
          getAdapter: () => ({ adapter: {} }),
        } as never,
        profileOwnerName: "Owner",
        profileOwnerUserId: "user-1",
        presenter,
        routeByProfileId: createCurrentRouteByProfileId(),
        socket,
      });

      expect(result).toEqual({
        errorCode: null,
        errorMessage: null,
        result: "success",
      });
      expect(fetchSpaceMetaMock).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps provider conversation occupancy accepted until the provider accepts the turn", async () => {
    await withTempHome(async () => {
      vi.spyOn(globalThis, "setInterval").mockImplementation((handler) => {
        if (typeof handler === "function") {
          for (let index = 0; index < 5; index += 1) {
            handler();
          }
        }
        return 1 as never;
      });
      const ledgerPaths = createLedgerPaths();
      const presenter = createPresenter();
      const settlementSocket = createAcceptedSettlementSocket({
        ledgerPaths,
        presenter,
      });
      const socket = settlementSocket as never;
      const runtimeContext = {
        providerRuntimeWorkingDirectory: process.cwd(),
      };
      resolveProfileWorkspaceRuntimeMock.mockResolvedValue({
        runtimeContext,
        status: "ready",
      });
      prepareProviderRuntimeMock.mockResolvedValue({
        envOverrides: undefined,
        preparationDetails: { kind: "none" },
        runtimeContext,
      });
      runRuntimeTaskMock.mockImplementationOnce((input) => {
        input.onRuntimeEvent?.({
          agentControllerConversationId: "thread-occupied",
          contractVersion: 1,
          phase: "agent_controller_conversation_occupied",
          tsMs: 1_700_000_000_100,
        });
        const lifecycleBeforeProviderAdmission =
          settlementSocket.send.mock.calls
            .map(([rawFrame]) => JSON.parse(String(rawFrame)))
            .filter((frame) => frame.code === "daemon.dispatch.lifecycle");
        expect(
          lifecycleBeforeProviderAdmission.map((frame) => frame.payload.phase)
        ).toEqual(lifecycleBeforeProviderAdmission.map(() => "accepted_local"));
        input.onRuntimeEvent?.({
          agentControllerConversationId: "thread-occupied",
          contractVersion: 1,
          phase: "agent_controller_conversation_available",
          tsMs: 1_700_000_000_200,
        });
        input.onRuntimeEvent?.({
          agentControllerConversationId: "thread-occupied",
          phase: "provider_turn_accepted",
          tsMs: 1_700_000_000_300,
          turnId: "turn-1",
        });
        return createRuntimeSuccessResult();
      });

      const result = await handleDispatchDeliverFrame({
        computerFileAccessStorePath:
          "/tmp/openmeld-test-missing-computer-file-access-policy.json",
        contextStore: new Map(),
        currentSocketRef: { connectionGeneration: 1, socket },
        daemonSessionId: "daemon-session-1",
        deliverRequest: createDeliverRequest(),
        inflightDispatchMetaByTaskId: new Map(),
        inflightTaskControlRegistry: createInflightTaskControlRegistry(),
        pendingAgentInteractionRegistry:
          createPendingAgentInteractionRegistry(),
        ledgerPaths,
        leasesByProfileId: new Map([["agent-profile-1", 1]]),
        localAdapterContainer: {
          getAdapter: () => ({ adapter: {} }),
        } as never,
        profileOwnerName: "Owner",
        profileOwnerUserId: "user-1",
        presenter,
        routeByProfileId: createCurrentRouteByProfileId(),
        socket,
      });

      expect(result).toEqual({
        errorCode: null,
        errorMessage: null,
        result: "success",
      });
      const occupancyFrames = settlementSocket.send.mock.calls
        .map(([rawFrame]) => JSON.parse(String(rawFrame)))
        .filter(
          (frame) =>
            frame.code === "daemon.dispatch.lifecycle" &&
            frame.payload.agentControllerConversationOccupancy
        );
      expect(
        occupancyFrames.every(
          (frame) => frame.payload.phase === "accepted_local"
        )
      ).toBe(true);
      expect(
        occupancyFrames.map(
          (frame) => frame.payload.agentControllerConversationOccupancy
        )
      ).toEqual([
        {
          agentControllerConversationId: "thread-occupied",
          contractVersion: 1,
          state: "occupied",
        },
        {
          agentControllerConversationId: "thread-occupied",
          contractVersion: 1,
          state: "occupied",
        },
        {
          agentControllerConversationId: "thread-occupied",
          contractVersion: 1,
          state: "occupied",
        },
        {
          agentControllerConversationId: "thread-occupied",
          contractVersion: 1,
          state: "available",
        },
        {
          agentControllerConversationId: "thread-occupied",
          contractVersion: 1,
          state: "available",
        },
        {
          agentControllerConversationId: "thread-occupied",
          contractVersion: 1,
          state: "available",
        },
      ]);
      expect(
        settlementSocket.send.mock.calls
          .map(([rawFrame]) => JSON.parse(String(rawFrame)))
          .filter(
            (frame) =>
              frame.code === "daemon.dispatch.lifecycle" &&
              frame.payload.phase === "running" &&
              !frame.payload.agentControllerConversationOccupancy
          ).length
      ).toBeGreaterThanOrEqual(6);
      expect(
        readRecentDaemonDispatchJournalEvents({
          dispatchId: "dispatch-1",
          limit: 100,
        })
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            attemptId: "attempt-1",
            dispatchId: "dispatch-1",
            metadata: expect.objectContaining({
              agentControllerConversationId: "thread-occupied",
              phase: "provider_turn_accepted",
              turnId: "turn-1",
            }),
            result: "accepted",
            taskId: "task-1",
            type: "dispatch.local.phase",
          }),
        ])
      );
    });
  });

  it("downloads a Wake image into the runtime workspace before invoking Codex", async () => {
    await withTempHome(async () => {
      const ledgerPaths = createLedgerPaths();
      const workspace = mkdtempSync(
        join(tmpdir(), "openmeld-image-wake-runtime-")
      );
      tempDirs.push(workspace);
      const presenter = createPresenter();
      const socket = createAcceptedSettlementSocket({
        ledgerPaths,
        presenter,
      }) as never;
      const runtimeContext = {
        providerRuntimeWorkingDirectory: workspace,
      };
      const deliverRequest = createDeliverRequest();
      deliverRequest.payload.sourceSignalSnapshot = {
        attachments: [
          {
            id: "attachment-1",
            mimeType: "image/png",
            sizeBytes: 4,
            fileName: "diagram.png",
          },
        ],
        profileId: "user-profile-1",
        profileKind: "human",
        text: "please inspect this image",
      };
      downloadDispatchImageAttachmentMock.mockResolvedValue(
        new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { "content-type": "image/png" },
        })
      );
      resolveProfileWorkspaceRuntimeMock.mockResolvedValue({
        runtimeContext,
        status: "ready",
      });
      prepareProviderRuntimeMock.mockResolvedValue({
        envOverrides: undefined,
        preparationDetails: { kind: "none" },
        runtimeContext,
      });
      const localPath = join(
        workspace,
        ".openmeld",
        "attachments",
        "task-1",
        "attachment-1.png"
      );
      runRuntimeTaskMock.mockImplementationOnce((input) => {
        expect(input.task.prompt).toContain("Attached images (local files):");
        expect(input.task.prompt).toContain(`\`${localPath}\``);
        return createRuntimeSuccessResult();
      });

      const result = await handleDispatchDeliverFrame({
        computerFileAccessStorePath:
          "/tmp/openmeld-test-missing-computer-file-access-policy.json",
        contextStore: new Map(),
        currentSocketRef: { connectionGeneration: 1, socket },
        daemonSessionId: "daemon-session-1",
        deliverRequest,
        inflightDispatchMetaByTaskId: new Map(),
        inflightTaskControlRegistry: createInflightTaskControlRegistry(),
        pendingAgentInteractionRegistry:
          createPendingAgentInteractionRegistry(),
        ledgerPaths,
        leasesByProfileId: new Map([["agent-profile-1", 1]]),
        localAdapterContainer: {
          getAdapter: () => ({ adapter: {} }),
        } as never,
        profileOwnerName: "Owner",
        profileOwnerUserId: "user-1",
        presenter,
        routeByProfileId: createCurrentRouteByProfileId(workspace),
        socket,
      });

      expect(result).toEqual({
        errorCode: null,
        errorMessage: null,
        result: "success",
      });
      expect(new Uint8Array(readFileSync(localPath))).toEqual(
        new Uint8Array([137, 80, 78, 71])
      );
      expect(downloadDispatchImageAttachmentMock).toHaveBeenCalledWith({
        attachmentId: "attachment-1",
        ownerName: "Owner",
        ownerUserId: "user-1",
        spaceId: "space-1",
        spacePassword: null,
        targetProfileId: "agent-profile-1",
        targetProfileName: null,
      });
    });
  });

  it("finalizes a dispatch from a CLI Space action even if the controller runtime keeps running", async () => {
    await withTempHome(async () => {
      const ledgerPaths = createLedgerPaths();
      const presenter = createPresenter();
      const settlementSocket = createAcceptedSettlementSocket({
        ledgerPaths,
        presenter,
      });
      const socket = settlementSocket as never;
      const currentSocketRef: CurrentDaemonSocketRef = {
        connectionGeneration: 1,
        socket,
      };
      const runtimeContext = {
        providerRuntimeWorkingDirectory: process.cwd(),
      };
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      resolveProfileWorkspaceRuntimeMock.mockResolvedValue({
        runtimeContext,
        status: "ready",
      });
      prepareProviderRuntimeMock.mockResolvedValue({
        envOverrides: undefined,
        preparationDetails: { kind: "none" },
        runtimeContext,
      });
      runRuntimeTaskMock.mockImplementationOnce((input) => {
        const previousContextPath =
          process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
        const actionContextPath =
          input.route.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
        process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV] = actionContextPath;
        try {
          runSpaceActionReply({
            messageParts: ["CLI action should finalize this Wake."],
          });
        } finally {
          if (previousContextPath === undefined) {
            delete process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
          } else {
            process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV] =
              previousContextPath;
          }
        }
        return new Promise<RuntimeTaskResult>(() => undefined);
      });

      const resultPromise = handleDispatchDeliverFrame({
        computerFileAccessStorePath:
          "/tmp/openmeld-test-missing-computer-file-access-policy.json",
        contextStore: new Map(),
        currentSocketRef,
        daemonSessionId: "daemon-session-1",
        deliverRequest: createDeliverRequest(),
        inflightDispatchMetaByTaskId: new Map(),
        inflightTaskControlRegistry: createInflightTaskControlRegistry(),
        pendingAgentInteractionRegistry:
          createPendingAgentInteractionRegistry(),
        ledgerPaths,
        leasesByProfileId: new Map([["agent-profile-1", 1]]),
        localAdapterContainer: {
          getAdapter: () => ({ adapter: {} }),
        } as never,
        profileOwnerName: "Owner",
        profileOwnerUserId: "user-1",
        presenter,
        routeByProfileId: createCurrentRouteByProfileId(),
        socket,
      });
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<{
        errorCode: string;
        errorMessage: string;
        result: "failed";
      }>((resolve) => {
        timeout = setTimeout(() => {
          resolve({
            errorCode: "test.timeout",
            errorMessage: "dispatch did not finalize from the CLI action",
            result: "failed",
          });
        }, CLI_SPACE_ACTION_FINALIZATION_TIMEOUT_MS);
      });
      const result = await Promise.race([resultPromise, timeoutPromise]);
      if (timeout) {
        clearTimeout(timeout);
      }

      stdoutSpy.mockRestore();
      expect(result).toEqual({
        errorCode: null,
        errorMessage: null,
        result: "success",
      });
      expect(readOutboxFile(ledgerPaths).records).toHaveLength(0);
      expect(readSentTaskResultPayload(settlementSocket)).toMatchObject({
        agentControllerConversationId: "ctx-1",
        output: "CLI action should finalize this Wake.",
        spaceAction: {
          messageEnvelope: {
            text: "CLI action should finalize this Wake.",
          },
          type: "post_message",
        },
        spaceActionProvenance: "cli_action",
        status: "success",
      });
    });
  });

  it("waits for the active controller turn before reviewing a sibling Agent reply after an ordinary runtime failure", async () => {
    await withTempHome(async () => {
      const ledgerPaths = createLedgerPaths();
      const presenter = createPresenter();
      const settlementSocket = createAcceptedSettlementSocket({
        ledgerPaths,
        presenter,
      });
      const socket = settlementSocket as never;
      const currentSocketRef: CurrentDaemonSocketRef = {
        connectionGeneration: 1,
        socket,
      };
      const runtimeContext = {
        providerRuntimeWorkingDirectory: process.cwd(),
      };
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
      const siblingProfileId = "agent-profile-2";
      const siblingReply = createSiblingReplySignal({
        profileId: siblingProfileId,
      });
      let firstTurnActive = true;
      let rejectFirstTurn: (error: Error) => void = () => {
        throw new Error("first controller turn rejection was not registered");
      };
      const firstTurnCompletion = new Promise<RuntimeTaskResult>(
        (_resolve, reject) => {
          rejectFirstTurn = reject;
        }
      );
      let reportSiblingReviewRequired: () => void = () => {
        throw new Error("sibling review signal was not registered");
      };
      const siblingReviewRequired = new Promise<void>((resolve) => {
        reportSiblingReviewRequired = resolve;
      });

      resolveProfileWorkspaceRuntimeMock.mockResolvedValue({
        runtimeContext,
        status: "ready",
      });
      prepareProviderRuntimeMock.mockResolvedValue({
        envOverrides: undefined,
        preparationDetails: { kind: "none" },
        runtimeContext,
      });
      fetchSpaceUpdatesMock
        .mockImplementationOnce(() => {
          reportSiblingReviewRequired();
          return Promise.resolve({ signals: [siblingReply] });
        })
        .mockResolvedValue({ signals: [] });
      runRuntimeTaskMock
        .mockImplementationOnce((input) => {
          const previousContextPath =
            process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
          const actionContextPath =
            input.route.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
          process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV] =
            actionContextPath;
          try {
            runSpaceActionReply({
              messageParts: ["Original proposal before the sibling reply."],
            });
          } finally {
            if (previousContextPath === undefined) {
              delete process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
            } else {
              process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV] =
                previousContextPath;
            }
          }
          return firstTurnCompletion;
        })
        .mockImplementationOnce(() => {
          if (firstTurnActive) {
            throw new Error("thread ctx-1 already has an active writer");
          }
          return createRuntimeResult({
            output: "Reviewed after the sibling reply.",
            spaceAction: {
              messageEnvelope: {
                activationTargets: [],
                referenceTargets: [],
                text: "Reviewed after the sibling reply.",
              },
              type: "post_message",
            },
            spaceActionProvenance: "direct",
          });
        });

      const deliverRequest = createDeliverRequest();
      deliverRequest.payload.sourceMessageEnvelope = {
        activationTargets: ["agent-profile-1", siblingProfileId],
        referenceTargets: [],
        text: "please reply",
      };
      const resultPromise = handleDispatchDeliverFrame({
        computerFileAccessStorePath:
          "/tmp/openmeld-test-missing-computer-file-access-policy.json",
        contextStore: new Map(),
        currentSocketRef,
        daemonSessionId: "daemon-session-1",
        deliverRequest,
        inflightDispatchMetaByTaskId: new Map(),
        inflightTaskControlRegistry: createInflightTaskControlRegistry(),
        pendingAgentInteractionRegistry:
          createPendingAgentInteractionRegistry(),
        ledgerPaths,
        leasesByProfileId: new Map([["agent-profile-1", 1]]),
        localAdapterContainer: {
          getAdapter: () => ({ adapter: {} }),
        } as never,
        profileOwnerName: "Owner",
        profileOwnerUserId: "user-1",
        presenter,
        routeByProfileId: createCurrentRouteByProfileId(),
        socket,
      });
      await siblingReviewRequired;
      firstTurnActive = false;
      rejectFirstTurn(new Error("ordinary controller cleanup failure"));
      const result = await resultPromise;

      stdoutSpy.mockRestore();
      expect(result).toEqual({
        errorCode: null,
        errorMessage: null,
        result: "success",
      });
      expect(runRuntimeTaskMock).toHaveBeenCalledTimes(2);
      expect(readOutboxFile(ledgerPaths).records).toHaveLength(0);
      expect(readSentTaskResultPayload(settlementSocket)).toMatchObject({
        output: "Reviewed after the sibling reply.",
        spaceAction: {
          messageEnvelope: {
            text: "Reviewed after the sibling reply.",
          },
          observedThroughSignalId: siblingReply.id,
          type: "post_message",
        },
        status: "success",
      });
    });
  });

  it("does not review a sibling Agent reply after the matching Wake is cancelled", async () => {
    await withTempHome(async () => {
      const ledgerPaths = createLedgerPaths();
      const presenter = createPresenter();
      const settlementSocket = createAcceptedSettlementSocket({
        ledgerPaths,
        presenter,
      });
      const socket = settlementSocket as never;
      const currentSocketRef: CurrentDaemonSocketRef = {
        connectionGeneration: 1,
        socket,
      };
      const runtimeContext = {
        providerRuntimeWorkingDirectory: process.cwd(),
      };
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
      const siblingProfileId = "agent-profile-2";
      const siblingReply = createSiblingReplySignal({
        profileId: siblingProfileId,
      });
      const inflightTaskControlRegistry = createInflightTaskControlRegistry();
      let rejectFirstTurn: (error: Error) => void = () => {
        throw new Error("first controller turn rejection was not registered");
      };
      const firstTurnCompletion = new Promise<RuntimeTaskResult>(
        (_resolve, reject) => {
          rejectFirstTurn = reject;
        }
      );
      let reportSiblingReviewRequired: () => void = () => {
        throw new Error("sibling review signal was not registered");
      };
      const siblingReviewRequired = new Promise<void>((resolve) => {
        reportSiblingReviewRequired = resolve;
      });
      const cancel = vi.fn(async () => ({
        accepted: true,
        deliveryPath: "cancel" as const,
        reasonCode: "accepted" as const,
        signalDelivery: "sent" as const,
        taskId: "task-1",
      }));
      const localAdapterContainer = {
        getAdapter: () => ({
          adapter: { cancel },
        }),
      } as never;

      resolveProfileWorkspaceRuntimeMock.mockResolvedValue({
        runtimeContext,
        status: "ready",
      });
      prepareProviderRuntimeMock.mockResolvedValue({
        envOverrides: undefined,
        preparationDetails: { kind: "none" },
        runtimeContext,
      });
      fetchSpaceUpdatesMock
        .mockImplementationOnce(() => {
          reportSiblingReviewRequired();
          return Promise.resolve({ signals: [siblingReply] });
        })
        .mockResolvedValue({ signals: [] });
      runRuntimeTaskMock
        .mockImplementationOnce((input) => {
          const previousContextPath =
            process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
          const actionContextPath =
            input.route.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
          process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV] =
            actionContextPath;
          try {
            runSpaceActionReply({
              messageParts: ["Proposal recorded before the Wake Stop."],
            });
          } finally {
            if (previousContextPath === undefined) {
              delete process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
            } else {
              process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV] =
                previousContextPath;
            }
          }
          return firstTurnCompletion;
        })
        .mockResolvedValueOnce(
          createRuntimeResult({
            output: "This review must not run after Wake Stop.",
            spaceAction: {
              messageEnvelope: {
                activationTargets: [],
                referenceTargets: [],
                text: "This review must not run after Wake Stop.",
              },
              type: "post_message",
            },
            spaceActionProvenance: "direct",
          })
        );

      const deliverRequest = createDeliverRequest();
      deliverRequest.payload.sourceMessageEnvelope = {
        activationTargets: ["agent-profile-1", siblingProfileId],
        referenceTargets: [],
        text: "please reply",
      };
      const resultPromise = handleDispatchDeliverFrame({
        computerFileAccessStorePath:
          "/tmp/openmeld-test-missing-computer-file-access-policy.json",
        contextStore: new Map(),
        currentSocketRef,
        daemonSessionId: "daemon-session-1",
        deliverRequest,
        inflightDispatchMetaByTaskId: new Map(),
        inflightTaskControlRegistry,
        pendingAgentInteractionRegistry:
          createPendingAgentInteractionRegistry(),
        ledgerPaths,
        leasesByProfileId: new Map([["agent-profile-1", 1]]),
        localAdapterContainer,
        profileOwnerName: "Owner",
        profileOwnerUserId: "user-1",
        presenter,
        routeByProfileId: createCurrentRouteByProfileId(),
        socket,
      });

      await siblingReviewRequired;
      const cancelResult = await handleLocalControlPlaneCancel({
        localAdapterContainer,
        payload: {
          reason: "wake.stop",
          runtimeCoordinatorExecutionId:
            deliverRequest.payload.runtimeCoordinatorExecutionId,
          target: {
            by: "task",
            taskId: deliverRequest.payload.taskId,
          },
        },
        presenter,
        registry: inflightTaskControlRegistry,
      });
      rejectFirstTurn(new Error("controller turn cancelled by Wake Stop"));
      const result = await resultPromise;

      stdoutSpy.mockRestore();
      expect(cancelResult).toMatchObject({
        accepted: true,
        reasonCode: "adapter.cancel.accepted",
        resolvedRuntimeCoordinatorExecutionId:
          deliverRequest.payload.runtimeCoordinatorExecutionId,
        resolvedTaskId: deliverRequest.payload.taskId,
      });
      expect(runRuntimeTaskMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        errorCode: "dispatch.agent_reply_reconsideration.execution_inactive",
        errorMessage: expect.stringContaining(
          "dispatch.agent_reply_reconsideration.execution_inactive"
        ),
        result: "failed",
      });
      expect(readSentTaskResultPayload(settlementSocket)).toMatchObject({
        errorCode: "dispatch.agent_reply_reconsideration.execution_inactive",
        status: "failed",
      });
    });
  });

  it("uses a CLI action recorded during controller repair as the final Space action", async () => {
    await withTempHome(async () => {
      const ledgerPaths = createLedgerPaths();
      const presenter = createPresenter();
      const settlementSocket = createAcceptedSettlementSocket({
        ledgerPaths,
        presenter,
      });
      const socket = settlementSocket as never;
      const currentSocketRef: CurrentDaemonSocketRef = {
        connectionGeneration: 1,
        socket,
      };
      const runtimeContext = {
        providerRuntimeWorkingDirectory: process.cwd(),
      };
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      resolveProfileWorkspaceRuntimeMock.mockResolvedValue({
        runtimeContext,
        status: "ready",
      });
      prepareProviderRuntimeMock.mockResolvedValue({
        envOverrides: undefined,
        preparationDetails: { kind: "none" },
        runtimeContext,
      });
      runRuntimeTaskMock
        .mockResolvedValueOnce(
          createRuntimeResult({
            output: "plain repairable answer without a structured action",
          })
        )
        .mockImplementationOnce((input) => {
          const previousContextPath =
            process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
          const actionContextPath =
            input.route.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
          process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV] =
            actionContextPath;
          try {
            runSpaceActionReply({
              messageParts: ["Recovered", "via", "CLI."],
            });
          } finally {
            if (previousContextPath === undefined) {
              delete process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
            } else {
              process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV] =
                previousContextPath;
            }
          }
          return createRuntimeResult({
            output: "repair run output without a structured action",
          });
        });

      const result = await handleDispatchDeliverFrame({
        computerFileAccessStorePath:
          "/tmp/openmeld-test-missing-computer-file-access-policy.json",
        contextStore: new Map(),
        currentSocketRef,
        daemonSessionId: "daemon-session-1",
        deliverRequest: createDeliverRequest(),
        inflightDispatchMetaByTaskId: new Map(),
        inflightTaskControlRegistry: createInflightTaskControlRegistry(),
        pendingAgentInteractionRegistry:
          createPendingAgentInteractionRegistry(),
        ledgerPaths,
        leasesByProfileId: new Map([["agent-profile-1", 1]]),
        localAdapterContainer: {
          getAdapter: () => ({ adapter: {} }),
        } as never,
        profileOwnerName: "Owner",
        profileOwnerUserId: "user-1",
        presenter,
        routeByProfileId: createCurrentRouteByProfileId(),
        socket,
      });

      stdoutSpy.mockRestore();
      expect(result).toEqual({
        errorCode: null,
        errorMessage: null,
        result: "success",
      });
      expect(runRuntimeTaskMock).toHaveBeenCalledTimes(2);
      expect(readOutboxFile(ledgerPaths).records).toHaveLength(0);
      expect(readSentTaskResultPayload(settlementSocket)).toMatchObject({
        output: "Recovered via CLI.",
        spaceAction: {
          messageEnvelope: {
            activationTargets: [],
            referenceTargets: [],
            text: "Recovered via CLI.",
          },
          type: "post_message",
        },
        spaceActionProvenance: "cli_action",
        status: "success",
      });
    });
  });

  it("never treats a model-authored action block as a real Space action", async () => {
    await withTempHome(async () => {
      const ledgerPaths = createLedgerPaths();
      const socket = { send: vi.fn() } as never;
      const currentSocketRef: CurrentDaemonSocketRef = {
        connectionGeneration: 1,
        socket,
      };
      const presenter = createPresenter();
      const runtimeContext = {
        providerRuntimeWorkingDirectory: process.cwd(),
      };

      resolveProfileWorkspaceRuntimeMock.mockResolvedValue({
        runtimeContext,
        status: "ready",
      });
      prepareProviderRuntimeMock.mockResolvedValue({
        envOverrides: undefined,
        preparationDetails: { kind: "none" },
        runtimeContext,
      });
      runRuntimeTaskMock.mockResolvedValue(
        createRuntimeResult({
          output: [
            "This is ordinary model-authored text.",
            "```openmeld-space-action",
            JSON.stringify({
              reason: "This model-authored text must not control publication.",
              type: "stay_silent",
            }),
            "```",
          ].join("\n"),
        })
      );

      const result = await handleDispatchDeliverFrame({
        computerFileAccessStorePath:
          "/tmp/openmeld-test-missing-computer-file-access-policy.json",
        contextStore: new Map(),
        currentSocketRef,
        daemonSessionId: "daemon-session-1",
        deliverRequest: createDeliverRequest(),
        inflightDispatchMetaByTaskId: new Map(),
        inflightTaskControlRegistry: createInflightTaskControlRegistry(),
        pendingAgentInteractionRegistry:
          createPendingAgentInteractionRegistry(),
        ledgerPaths,
        leasesByProfileId: new Map([["agent-profile-1", 1]]),
        localAdapterContainer: {
          getAdapter: () => ({ adapter: {} }),
        } as never,
        profileOwnerName: "Owner",
        profileOwnerUserId: "user-1",
        presenter,
        routeByProfileId: createCurrentRouteByProfileId(),
        socket,
      });

      expect(runRuntimeTaskMock).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({
        errorCode: "openmeld.space_action.repair_failed",
        result: "failed",
      });
    });
  });

  it("never evaluates a model-authored post_status as runtime state", async () => {
    await withTempHome(async () => {
      const ledgerPaths = createLedgerPaths();
      const socket = { send: vi.fn() } as never;
      const currentSocketRef: CurrentDaemonSocketRef = {
        connectionGeneration: 1,
        socket,
      };
      const presenter = createPresenter();
      const runtimeContext = {
        providerRuntimeWorkingDirectory: process.cwd(),
      };

      resolveProfileWorkspaceRuntimeMock.mockResolvedValue({
        runtimeContext,
        status: "ready",
      });
      prepareProviderRuntimeMock.mockResolvedValue({
        envOverrides: undefined,
        preparationDetails: { kind: "none" },
        runtimeContext,
      });
      runRuntimeTaskMock.mockResolvedValue(
        createRuntimeResult({
          output: [
            "Checking the trace.",
            "```openmeld-space-action",
            JSON.stringify({
              type: "post_status",
              status: "working",
              text: "Checking the trace.",
            }),
            "```",
          ].join("\n"),
        })
      );

      const result = await handleDispatchDeliverFrame({
        computerFileAccessStorePath:
          "/tmp/openmeld-test-missing-computer-file-access-policy.json",
        contextStore: new Map(),
        currentSocketRef,
        daemonSessionId: "daemon-session-1",
        deliverRequest: createDeliverRequest(),
        inflightDispatchMetaByTaskId: new Map(),
        inflightTaskControlRegistry: createInflightTaskControlRegistry(),
        pendingAgentInteractionRegistry:
          createPendingAgentInteractionRegistry(),
        ledgerPaths,
        leasesByProfileId: new Map([["agent-profile-1", 1]]),
        localAdapterContainer: {
          getAdapter: () => ({ adapter: {} }),
        } as never,
        profileOwnerName: "Owner",
        profileOwnerUserId: "user-1",
        presenter,
        routeByProfileId: createCurrentRouteByProfileId(),
        socket,
      });

      expect(result).toEqual({
        errorCode: "openmeld.space_action.repair_failed",
        errorMessage:
          "A valid OpenMeld Space action is required in collaboration mode.",
        result: "failed",
      });
    });
  });

  it("durably records the runtime result even when preview end has no active socket", async () => {
    await withTempHome(async () => {
      const ledgerPaths = createLedgerPaths();
      const socketSend = vi.fn();
      const socket = { send: socketSend } as never;
      const currentSocketRef: CurrentDaemonSocketRef = {
        connectionGeneration: 1,
        socket,
      };
      const presenter = createPresenter();
      const runtimeContext = {
        providerRuntimeWorkingDirectory: process.cwd(),
      };

      resolveProfileWorkspaceRuntimeMock.mockResolvedValue({
        runtimeContext,
        status: "ready",
      });
      prepareProviderRuntimeMock.mockResolvedValue({
        envOverrides: undefined,
        preparationDetails: { kind: "none" },
        runtimeContext,
      });
      runRuntimeTaskMock.mockImplementation((input) => {
        input.onRuntimeEvent?.({
          phase: "process_spawned",
          processId: 1234,
          tsMs: 1_700_000_000_100,
        });
        input.onRuntimeEvent?.({
          exitCode: 0,
          phase: "process_exit",
          processId: 1234,
          signal: null,
          tsMs: 1_700_000_000_200,
        });
        currentSocketRef.socket = null;
        currentSocketRef.connectionGeneration = null;
        return createRuntimeSuccessResult();
      });

      const resultPromise = handleDispatchDeliverFrame({
        computerFileAccessStorePath:
          "/tmp/openmeld-test-missing-computer-file-access-policy.json",
        contextStore: new Map(),
        currentSocketRef,
        daemonSessionId: "daemon-session-1",
        deliverRequest: createDeliverRequest(),
        inflightDispatchMetaByTaskId: new Map(),
        inflightTaskControlRegistry: createInflightTaskControlRegistry(),
        pendingAgentInteractionRegistry:
          createPendingAgentInteractionRegistry(),
        ledgerPaths,
        leasesByProfileId: new Map([["agent-profile-1", 1]]),
        localAdapterContainer: {
          getAdapter: () => ({ adapter: {} }),
        } as never,
        profileOwnerName: "Owner",
        profileOwnerUserId: "user-1",
        presenter,
        routeByProfileId: createCurrentRouteByProfileId(),
        socket,
      });

      await vi.waitFor(
        () => {
          expect(readOutboxFile(ledgerPaths).records).toHaveLength(1);
        },
        { timeout: 5000 }
      );
      const persistedOutbox = readOutboxFile(ledgerPaths);
      acknowledgeDispatchResultOutboxRecord({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        ledgerPaths,
        ok: true,
        presenter,
        status: "accepted",
      });
      const result = await resultPromise;

      expect(result).toEqual({
        errorCode: null,
        errorMessage: null,
        result: "success",
      });
      expect(readOutboxFile(ledgerPaths).records).toHaveLength(0);
      expect(persistedOutbox.records[0]).toMatchObject({
        dispatchId: "dispatch-1",
        taskResult: {
          payload: {
            output: "durable reply",
            status: "success",
          },
        },
      });
      const payload = persistedOutbox.records[0]?.taskResult.payload;
      expect(payload).toBeDefined();
      expect(payload && "claimLease" in payload).toBe(false);
      const journalEvents = readRecentDaemonDispatchJournalEvents({
        dispatchId: "dispatch-1",
      });
      const localPhases = journalEvents.flatMap((event) =>
        event.type === "dispatch.local.phase" &&
        typeof event.metadata?.phase === "string"
          ? [event.metadata.phase]
          : []
      );
      expect(localPhases).toEqual([
        "task_started",
        "preflight_ready",
        "bootstrap_context_ready",
        "send_target_reference_ready",
        "runtime_context_ready",
        "ledger_context_ready",
        "runtime_invocation_started",
        "process_spawned",
        "process_exit",
        "runtime_completed",
      ]);
      expect(journalEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            attemptId: "attempt-1",
            dispatchId: "dispatch-1",
            profileId: "agent-profile-1",
            taskId: "task-1",
            type: "dispatch.local.phase",
          }),
        ])
      );
      const serializedJournal = JSON.stringify(journalEvents);
      expect(serializedJournal).not.toContain("durable reply");
      expect(serializedJournal).not.toContain("rcet_v1_");
      expect(serializedJournal).not.toContain("prompt");
      expect(presenter.events).toContainEqual(
        expect.objectContaining({ code: "daemon.run.preview_end_send_failed" })
      );
    });
  });
});
