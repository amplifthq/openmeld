import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import {
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
  spaceMetaSchema,
} from "@openmeld/schemas";
import type { RuntimeTransportDeliverDispatchRequest } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CurrentDaemonSocketRef,
  LedgerPaths,
} from "../src/local-service/core/types";
import { readRecentDaemonDispatchJournalEvents } from "../src/local-service/dispatch/daemon-dispatch-journal";
import { handleDispatchDeliverFrame } from "../src/local-service/dispatch/execute-dispatch-task";
import { OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV } from "../src/runtime/dispatch-space-action-context";
import type { Presenter } from "../src/runtime/presenter/types";
import { runSpaceActionReply } from "../src/space/action-command";
import type { fetchSpaceMeta } from "../src/space/meta-api";
import { withTempHome } from "./helpers/fs";

const {
  downloadDispatchImageAttachmentMock,
  fetchSpaceMetaMock,
  prepareProviderRuntimeMock,
  resolveProfileWorkspaceRuntimeMock,
  runRuntimeTaskMock,
} = vi.hoisted(() => ({
  downloadDispatchImageAttachmentMock: vi.fn(),
  fetchSpaceMetaMock: vi.fn<typeof fetchSpaceMeta>(),
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
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

beforeEach(() => {
  vi.resetAllMocks();
  fetchSpaceMetaMock.mockRejectedValue(new Error("Space meta is unavailable"));
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

describe("dispatch result outbox around preview teardown", () => {
  it("injects current Space meta into the runtime prompt", async () => {
    await withTempHome(async () => {
      const ledgerPaths = createLedgerPaths();
      const socket = { send: vi.fn() } as never;
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
        presenter: createPresenter(),
        routeByProfileId: new Map(),
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

  it("continues dispatch with an omitted meta section when Space meta loading fails", async () => {
    await withTempHome(async () => {
      const ledgerPaths = createLedgerPaths();
      const socket = { send: vi.fn() } as never;
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
        presenter: createPresenter(),
        routeByProfileId: new Map(),
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

  it("downloads a Wake image into the runtime workspace before invoking Codex", async () => {
    await withTempHome(async () => {
      const ledgerPaths = createLedgerPaths();
      const workspace = mkdtempSync(
        join(tmpdir(), "openmeld-image-wake-runtime-")
      );
      tempDirs.push(workspace);
      const socket = { send: vi.fn() } as never;
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
        presenter: createPresenter(),
        routeByProfileId: new Map(),
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
      const socket = { send: vi.fn() } as never;
      const currentSocketRef: CurrentDaemonSocketRef = {
        connectionGeneration: 1,
        socket,
      };
      const presenter = createPresenter();
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
        routeByProfileId: new Map(),
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
      const outbox = readOutboxFile(ledgerPaths);
      expect(outbox.records).toHaveLength(1);
      expect(outbox.records[0]?.taskResult.payload).toMatchObject({
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

  it("uses a CLI action recorded during controller repair as the final Space action", async () => {
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
        routeByProfileId: new Map(),
        socket,
      });

      stdoutSpy.mockRestore();
      expect(result).toEqual({
        errorCode: null,
        errorMessage: null,
        result: "success",
      });
      expect(runRuntimeTaskMock).toHaveBeenCalledTimes(2);
      const outbox = readOutboxFile(ledgerPaths);
      expect(outbox.records).toHaveLength(1);
      expect(outbox.records[0]?.taskResult.payload).toMatchObject({
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

  it("rejects fallback post_status working instead of finalizing the Wake as progress", async () => {
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
        routeByProfileId: new Map(),
        socket,
      });

      expect(result).toEqual({
        errorCode: "openmeld.space_action.repair_failed",
        errorMessage:
          "post_status working is not allowed for a final OpenMeld Space Action. Use done, blocked, needs_input, handoff, post_message, or stay_silent.",
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
        routeByProfileId: new Map(),
        socket,
      });

      expect(result).toEqual({
        errorCode: null,
        errorMessage: null,
        result: "success",
      });
      const outbox = readOutboxFile(ledgerPaths);
      expect(outbox.records).toHaveLength(1);
      expect(outbox.records[0]).toMatchObject({
        dispatchId: "dispatch-1",
        taskResult: {
          payload: {
            output: "durable reply",
            status: "success",
          },
        },
      });
      const payload = outbox.records[0]?.taskResult.payload;
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
