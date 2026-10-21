import { readFile, rm } from "node:fs/promises";
import { createCodexAdapter } from "@openmeld/adapter-codex";
import type {
  AdapterRuntimeEvent,
  RuntimeAdapter,
} from "@openmeld/adapter-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyLedgerState,
  loadLedgerState,
  persistLedgerState,
  upsertAgentContext,
} from "../src/ledger-store";
import {
  type RuntimeTask,
  runRuntimeTask,
} from "../src/runtime-task-orchestrator";
import { buildRuntimeWorkspaceFingerprint } from "../src/runtime-workspace-fingerprint";
import {
  createNodeLedgerFileIo,
  createTempLedgerPaths,
} from "./ledger-test-io";

const createdDirs = new Set<string>();
const DEFAULT_RUNTIME_CONTEXT = {
  providerRuntimeWorkingDirectory: "/tmp/provider-runtime",
} as const;

function createRuntimeTask(
  overrides: Omit<RuntimeTask, "runtimeContext">
): RuntimeTask {
  return {
    runtimeContext: DEFAULT_RUNTIME_CONTEXT,
    ...overrides,
  };
}

afterEach(async () => {
  for (const dirPath of createdDirs) {
    await rm(dirPath, { force: true, recursive: true });
  }
  createdDirs.clear();
});

describe("ledger-recovery+mention-dispatch runtime orchestration", () => {
  it("wires ledger + recovery + mention_only dispatch in one runtime path", async () => {
    const paths = await createTempLedgerPaths("openMeldDaemon-g34-runtime-");
    createdDirs.add(paths.rootDirPath);

    const invoke = vi.fn().mockResolvedValue({
      output: "runtime-output",
    });
    const adapter = createCodexAdapter({
      invoke,
    });

    const io = createNodeLedgerFileIo();
    const result = await runRuntimeTask({
      adapter,
      io,
      nowMs: Date.UTC(2026, 1, 25, 14, 0, 0),
      paths,
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-1|agent-codex",
        mentioned: true,
        prompt: "hello",
        sequence: 1,
        sourceEventId: "evt-runtime-1",
        spaceId: "space-1",
        taskId: "task-runtime-1",
        triggerMode: "mention_only",
      }),
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.runtimeState).toBe("idle");
    expect(result.deduped).toBe(false);
    expect(result.dispatchResult.dispatched).toBe(true);
    expect(result.resultPayload).toMatchObject({
      deduped: false,
      output: "runtime-output",
      status: "success",
      taskId: "task-runtime-1",
    });

    const finalState = await loadLedgerState({
      io,
      paths,
    });
    expect(finalState.inflightByTaskId).toEqual({});
    expect(finalState.replayedTaskIds).toEqual({});

    const historyRaw = await readFile(paths.historyFilePath, "utf8");
    const historyEntries = historyRaw
      .trim()
      .split("\n")
      .map(
        (line) => JSON.parse(line) as { reasonCode: string; status: string }
      );

    expect(historyEntries).toHaveLength(1);
    expect(historyEntries[0]).toMatchObject({
      reasonCode: "task.dispatched",
      status: "success",
    });
  });

  it("passes route conversation policy to the runtime adapter request", async () => {
    const paths = await createTempLedgerPaths("openMeldDaemon-policy-runtime-");
    createdDirs.add(paths.rootDirPath);

    const invoke = vi.fn().mockResolvedValue({
      output: "policy-output",
    });
    const adapter = createCodexAdapter({ invoke });
    const io = createNodeLedgerFileIo();

    await runRuntimeTask({
      io,
      nowMs: Date.UTC(2026, 1, 25, 14, 5, 0),
      paths,
      route: {
        agentControllerPermissionMode: "codex:approveForMe",
        agentControllerRef: "builtin:codex",
        contextIdMappingSpec: {
          mappingVersion: 1,
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
        },
        conversationPolicy: {
          fallbackModel: "gpt-5.5",
          model: "gpt-5.4-mini",
          reasoningLevel: "medium",
        },
        openCodePermission: {
          edit: "ask",
          websearch: "deny",
        },
        targets: [
          {
            adapter,
            agentControllerRef: "builtin:codex",
            transportMode: "local-cli",
          },
        ],
        transportMode: "local-cli",
      },
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-1|agent-codex",
        mentioned: true,
        prompt: "hello with policy",
        sequence: 1,
        sourceEventId: "evt-runtime-policy",
        spaceId: "space-1",
        taskId: "task-runtime-policy",
        triggerMode: "mention_only",
      }),
    });

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        agentControllerPermissionMode: "codex:approveForMe",
        conversationPolicy: {
          fallbackModel: "gpt-5.5",
          model: "gpt-5.4-mini",
          reasoningLevel: "medium",
        },
        openCodePermission: {
          edit: "ask",
          websearch: "deny",
        },
      })
    );
  });

  it("passes the optional native instruction prompt without replacing the fallback prompt", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-native-instruction-runtime-"
    );
    createdDirs.add(paths.rootDirPath);

    const invoke = vi.fn().mockResolvedValue({ output: "native-output" });
    const adapter = createCodexAdapter({ invoke });

    await runRuntimeTask({
      adapter,
      io: createNodeLedgerFileIo(),
      nowMs: Date.UTC(2026, 7, 3, 12, 0, 0),
      paths,
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-1|agent-codex",
        instructionPrompt: {
          developerInstructions: "stable developer contract",
          instructionEpoch: "sha256:test",
          userPrompt: "current Wake only",
        },
        mentioned: true,
        prompt: "complete fallback prompt",
        newSessionTitle: "OpenMeld · Monica · Adjust the close button",
        sequence: 1,
        sourceEventId: "evt-native-instructions",
        spaceId: "space-1",
        taskId: "task-native-instructions",
        triggerMode: "mention_only",
      }),
    });

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        instructionPrompt: {
          developerInstructions: "stable developer contract",
          instructionEpoch: "sha256:test",
          userPrompt: "current Wake only",
        },
        prompt: "complete fallback prompt",
        newSessionTitle: "OpenMeld · Monica · Adjust the close button",
      })
    );
  });

  it("passes the Computer file access boundary to the runtime adapter request", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-computer-file-access-runtime-"
    );
    createdDirs.add(paths.rootDirPath);
    const invoke = vi.fn().mockResolvedValue({ output: "bounded-output" });
    const adapter = createCodexAdapter({ invoke });
    const boundary = {
      folders: ["/tmp/provider-runtime"],
      mode: "only_selected_folders" as const,
      revision: 2,
      updatedAtMs: 100,
    };

    await runRuntimeTask({
      adapter,
      io: createNodeLedgerFileIo(),
      nowMs: Date.UTC(2026, 7, 10, 12, 0, 0),
      paths,
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-1|agent-codex",
        computerFileAccessBoundary: boundary,
        mentioned: true,
        prompt: "complete bounded task",
        sequence: 1,
        sourceEventId: "evt-computer-file-access",
        spaceId: "space-1",
        taskId: "task-computer-file-access",
        triggerMode: "mention_only",
      }),
    });

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ computerFileAccessBoundary: boundary })
    );
  });

  it("suppresses duplicate event replay within 24h window across restart", async () => {
    const paths = await createTempLedgerPaths("openMeldDaemon-g34-dedupe-");
    createdDirs.add(paths.rootDirPath);

    const io = createNodeLedgerFileIo();
    const firstInvoke = vi.fn().mockResolvedValue({
      output: "first-output",
    });

    await runRuntimeTask({
      adapter: createCodexAdapter({ invoke: firstInvoke }),
      io,
      nowMs: Date.UTC(2026, 1, 25, 15, 0, 0),
      paths,
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-1|agent-codex",
        mentioned: true,
        prompt: "first",
        sequence: 1,
        sourceEventId: "evt-runtime-dedupe",
        spaceId: "space-1",
        taskId: "task-runtime-first",
        triggerMode: "mention_only",
      }),
    });

    const secondInvoke = vi.fn().mockResolvedValue({
      output: "second-output",
    });

    const replayResult = await runRuntimeTask({
      adapter: createCodexAdapter({ invoke: secondInvoke }),
      io,
      nowMs: Date.UTC(2026, 1, 25, 15, 1, 0),
      paths,
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-1|agent-codex",
        mentioned: true,
        prompt: "second",
        sequence: 2,
        sourceEventId: "evt-runtime-dedupe",
        spaceId: "space-1",
        taskId: "task-runtime-second",
        triggerMode: "mention_only",
      }),
    });

    expect(firstInvoke).toHaveBeenCalledTimes(1);
    expect(secondInvoke).not.toHaveBeenCalled();
    expect(replayResult.deduped).toBe(true);
    expect(replayResult.dispatchResult).toEqual({
      dispatched: false,
      reason: "deduped",
    });
    expect(replayResult.resultPayload).toMatchObject({
      deduped: true,
      errorType: "policy",
      errorMessage: "runtime.task.deduped: task deduped within 24h window",
      status: "failed",
      taskId: "task-runtime-second",
    });

    const historyRaw = await readFile(paths.historyFilePath, "utf8");
    const historyEntries = historyRaw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { reasonCode: string });

    expect(historyEntries).toHaveLength(2);
    expect(historyEntries[1]).toMatchObject({
      reasonCode: "task.deduped",
    });
  });

  it("runs repair execution without dedupe or ledger side effects", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-g34-repair-mode-"
    );
    createdDirs.add(paths.rootDirPath);

    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        contextDelta: {
          agentControllerConversationId: "thread-runtime-repair-1",
        },
        output: "first-output",
      })
      .mockResolvedValueOnce({
        contextDelta: {
          agentControllerConversationId: "thread-runtime-repair-1",
        },
        output: "repair-output",
      });
    const adapter = createCodexAdapter({
      invoke,
    });
    const route = {
      contextIdMappingSpec: {
        mappingVersion: 1,
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
      },
      agentControllerRef: "builtin:codex",
      env: {},
      runtimeWorkspaceFingerprint: buildRuntimeWorkspaceFingerprint(
        DEFAULT_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory
      ),
      targets: [
        {
          adapter,
          agentControllerRef: "builtin:codex",
          transportMode: "local-cli" as const,
        },
      ],
      transportMode: "local-cli" as const,
    };

    const io = createNodeLedgerFileIo();

    const firstResult = await runRuntimeTask({
      io,
      nowMs: Date.UTC(2026, 1, 25, 15, 10, 0),
      paths,
      route,
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-1|agent-codex",
        mentioned: true,
        prompt: "first",
        sequence: 1,
        sourceEventId: "evt-runtime-repair",
        spaceId: "space-1",
        taskId: "task-runtime-repair-1",
        triggerMode: "mention_only",
      }),
    });

    const repairResult = await runRuntimeTask({
      io,
      nowMs: Date.UTC(2026, 1, 25, 15, 11, 0),
      paths,
      route,
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-1|agent-codex",
        executionMode: "repair",
        mentioned: true,
        prompt: "repair",
        sequence: 2,
        sourceEventId: "evt-runtime-repair",
        spaceId: "space-1",
        taskId: "task-runtime-repair-1",
        triggerMode: "mention_only",
      }),
    });

    expect(firstResult.deduped).toBe(false);
    expect(repairResult.deduped).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        executionMode: "normal",
        sourceEventId: "evt-runtime-repair",
      })
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        agentControllerConversationId: "thread-runtime-repair-1",
        executionMode: "repair",
        sourceEventId: "evt-runtime-repair",
      })
    );
    expect(repairResult.resultPayload).toMatchObject({
      output: "repair-output",
      status: "success",
      taskId: "task-runtime-repair-1",
    });

    const historyRaw = await readFile(paths.historyFilePath, "utf8");
    const historyEntries = historyRaw
      .trim()
      .split("\n")
      .map(
        (line) => JSON.parse(line) as { reasonCode: string; status: string }
      );

    expect(historyEntries).toHaveLength(1);
    expect(historyEntries[0]).toMatchObject({
      reasonCode: "task.dispatched",
      status: "success",
    });

    const finalState = await loadLedgerState({
      io,
      paths,
    });
    expect(finalState.inflightByTaskId).toEqual({});
    expect(finalState.replayedTaskIds).toEqual({});
  });

  it("fails repair before provider invocation when the canonical conversation is missing", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-g34-repair-missing-conversation-"
    );
    createdDirs.add(paths.rootDirPath);

    const invoke = vi.fn().mockResolvedValue({
      contextDelta: {
        agentControllerConversationId: "thread-runtime-repair-new-1",
      },
      output: "unsafe repair output",
    });
    const result = await runRuntimeTask({
      adapter: createCodexAdapter({ invoke }),
      io: createNodeLedgerFileIo(),
      nowMs: Date.UTC(2026, 1, 25, 15, 12, 0),
      paths,
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-1|agent-codex",
        executionMode: "repair",
        mentioned: true,
        prompt: "repair without a canonical conversation",
        sequence: 1,
        sourceEventId: "evt-runtime-repair-missing-conversation",
        spaceId: "space-1",
        taskId: "task-runtime-repair-missing-conversation",
        triggerMode: "mention_only",
      }),
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(result.resultPayload).toMatchObject({
      errorCode: "repair.conversation_missing",
      errorMessage:
        "repair.conversation_missing: repair requires an existing Agent Controller conversation",
      errorType: "adapter",
      status: "failed",
      taskId: "task-runtime-repair-missing-conversation",
    });
  });

  it("routes dispatch by transport mode and emits context resolution metadata", async () => {
    const paths = await createTempLedgerPaths("openMeldDaemon-g34-route-");
    createdDirs.add(paths.rootDirPath);

    const io = createNodeLedgerFileIo();
    const appServerDispatch = vi.fn().mockResolvedValue({
      output: "from-app-server",
      status: "success",
    });
    const appServerAdapter = {
      adapterId: "codex",
      dispatch: appServerDispatch,
      interrupt: vi.fn().mockResolvedValue({
        accepted: true,
        plan: {
          initial: {
            mode: "graceful",
            reason: "service.interrupt",
            taskId: "task-route-1",
          },
        },
        signalDelivery: "sent",
        taskId: "task-route-1",
      }),
    };

    const result = await runRuntimeTask({
      io,
      nowMs: Date.UTC(2026, 1, 25, 16, 0, 0),
      paths,
      route: {
        contextIdMappingSpec: {
          mappingVersion: 2,
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
        },
        agentControllerRef: "builtin:codex",
        env: {
          OPENMELD_CLI_CONTEXT_ID: "ctx-777",
        },
        targets: [
          {
            adapter: appServerAdapter,
            agentControllerRef: "builtin:codex",
            transportMode: "codex-app-server",
          },
        ],
        transportMode: "codex-app-server",
        view: "agent",
      },
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-1|agent-codex",
        mentioned: true,
        prompt: "route-test",
        sequence: 1,
        sourceEventId: "evt-route-1",
        spaceId: "space-1",
        taskId: "task-route-1",
        triggerMode: "mention_only",
      }),
    });

    expect(appServerDispatch).toHaveBeenCalledWith({
      agentControllerConversationId: "ctx-777",
      agentId: "agent-codex",
      env: {
        OPENMELD_CLI_CONTEXT_ID: "ctx-777",
      },
      executionMode: "normal",
      prompt: "route-test",
      runtimeContext: DEFAULT_RUNTIME_CONTEXT,
      sourceEventId: "evt-route-1",
      spaceId: "space-1",
      streamingMode: "final",
      taskId: "task-route-1",
      transportMode: "codex-app-server",
      agentControllerConversation: {
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "ctx-777",
        agentControllerConversationKind: "thread",
      },
    });
    expect(result.contextResolution).toEqual({
      agentControllerConversationId: "ctx-777",
      mappingVersion: 2,
      sourceField: "OPENMELD_CLI_CONTEXT_ID",
      agentControllerConversation: {
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "ctx-777",
        agentControllerConversationKind: "thread",
      },
    });
    expect(result.resultPayload).toMatchObject({
      output: "from-app-server",
      status: "success",
      taskId: "task-route-1",
      transportMode: "codex-app-server",
    });
    expect(result.agentContextLifecycle).toMatchObject({
      lifecycleReason: "created_missing_context",
      resolvedAgentControllerConversationId: "ctx-777",
    });
    expect(result.agentContextLifecycleCounters).toMatchObject({
      created: 1,
      guardBlocked: 0,
      recreated: 0,
      reused: 0,
    });
  });

  it("persists a Codex App Server thread id returned by first dispatch and reuses it", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-g34-app-server-thread-"
    );
    createdDirs.add(paths.rootDirPath);

    const io = createNodeLedgerFileIo();
    const dispatch = vi
      .fn()
      .mockResolvedValueOnce({
        contextDelta: {
          agentControllerConversationId: "thread-app-server-1",
        },
        output: "first-output",
        status: "success",
      })
      .mockResolvedValueOnce({
        contextDelta: {
          agentControllerConversationId: "thread-app-server-1",
        },
        output: "second-output",
        status: "success",
      })
      .mockResolvedValueOnce({
        contextDelta: {
          agentControllerConversationId: "thread-app-server-1",
        },
        output: "third-output",
        status: "success",
      });
    const adapter = {
      adapterId: "codex",
      dispatch,
      interrupt: vi.fn().mockResolvedValue({
        accepted: true,
        plan: {
          initial: {
            mode: "graceful",
            reason: "service.interrupt",
            taskId: "task-app-server-thread-1",
          },
        },
        signalDelivery: "sent",
        taskId: "task-app-server-thread-1",
      }),
    };
    const route = {
      contextIdMappingSpec: {
        mappingVersion: 1,
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
      },
      agentControllerRef: "builtin:codex",
      env: {},
      runtimeWorkspaceFingerprint: buildRuntimeWorkspaceFingerprint(
        DEFAULT_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory
      ),
      targets: [
        {
          adapter,
          agentControllerRef: "builtin:codex",
          transportMode: "codex-app-server" as const,
        },
      ],
      transportMode: "codex-app-server" as const,
    };

    const first = await runRuntimeTask({
      io,
      nowMs: Date.UTC(2026, 1, 25, 16, 5, 0),
      paths,
      route,
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-app-server-thread|agent-codex",
        mentioned: true,
        prompt: "first",
        sequence: 1,
        sourceEventId: "evt-app-server-thread-1",
        spaceId: "space-app-server-thread",
        taskId: "task-app-server-thread-1",
        triggerMode: "mention_only",
      }),
    });

    const stateAfterFirst = await loadLedgerState({
      io,
      paths,
    });
    const persistedContext = Object.values(
      stateAfterFirst.agentContextByLookupKey
    )[0];

    expect(first.agentContextLifecycle).toMatchObject({
      lifecycleReason: "created_missing_context",
      resolvedAgentControllerConversationId: "thread-app-server-1",
    });
    expect(persistedContext).toMatchObject({
      agentControllerConversationId: "thread-app-server-1",
      agentControllerRef: "builtin:codex",
      spaceId: "space-app-server-thread",
      targetProfileId: "agent-codex",
      transportMode: "codex-app-server",
    });

    const second = await runRuntimeTask({
      io,
      nowMs: Date.UTC(2026, 1, 25, 16, 6, 0),
      paths,
      route,
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-app-server-thread|agent-codex",
        mentioned: true,
        prompt: "second",
        sequence: 2,
        sourceEventId: "evt-app-server-thread-2",
        spaceId: "space-app-server-thread",
        taskId: "task-app-server-thread-2",
        triggerMode: "mention_only",
      }),
    });

    expect(dispatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        agentControllerConversationId: "thread-app-server-1",
        taskId: "task-app-server-thread-2",
        transportMode: "codex-app-server",
      })
    );
    expect(second.agentContextLifecycle).toMatchObject({
      lifecycleReason: "reused_existing_context",
      resolvedAgentControllerConversationId: "thread-app-server-1",
    });
    expect(second.contextResolution).toMatchObject({
      agentControllerConversationId: "thread-app-server-1",
      sourceField: "openMeldDaemon.agent_context_ledger",
    });

    const third = await runRuntimeTask({
      io,
      nowMs: Date.UTC(2026, 1, 25, 16, 7, 0),
      paths,
      route,
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-app-server-thread-other|agent-codex",
        mentioned: true,
        prompt: "third",
        sequence: 3,
        sourceEventId: "evt-app-server-thread-3",
        spaceId: "space-app-server-thread-other",
        taskId: "task-app-server-thread-3",
        triggerMode: "mention_only",
      }),
    });

    expect(dispatch).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        agentControllerConversationId: "thread-app-server-1",
        taskId: "task-app-server-thread-3",
        transportMode: "codex-app-server",
      })
    );
    expect(third.agentContextLifecycle).toMatchObject({
      lifecycleReason: "reused_existing_context",
      resolvedAgentControllerConversationId: "thread-app-server-1",
    });
    expect(third.contextResolution).toMatchObject({
      agentControllerConversationId: "thread-app-server-1",
      sourceField: "openMeldDaemon.agent_context_ledger",
    });
  });

  it("keeps a colleague Wake's conversation in its own scope (member-agent-program.md §4.3)", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-colleague-scope-"
    );
    createdDirs.add(paths.rootDirPath);
    const io = createNodeLedgerFileIo();
    const dispatch = vi
      .fn()
      .mockResolvedValueOnce({
        contextDelta: { agentControllerConversationId: "owner-thread" },
        output: "owner",
        status: "success",
      })
      .mockResolvedValueOnce({
        contextDelta: { agentControllerConversationId: "colleague-thread" },
        output: "colleague",
        status: "success",
      })
      .mockResolvedValueOnce({
        contextDelta: { agentControllerConversationId: "owner-thread" },
        output: "owner again",
        status: "success",
      });
    const route = {
      contextIdMappingSpec: {
        mappingVersion: 1,
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
      },
      agentControllerRef: "builtin:codex",
      env: {},
      runtimeWorkspaceFingerprint: buildRuntimeWorkspaceFingerprint(
        DEFAULT_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory
      ),
      targets: [
        {
          adapter: {
            adapterId: "codex",
            dispatch,
            interrupt: vi.fn(),
          },
          agentControllerRef: "builtin:codex",
          transportMode: "codex-app-server" as const,
        },
      ],
      transportMode: "codex-app-server" as const,
    };
    const run = (input: {
      scopeId?: string;
      sequence: number;
      taskId: string;
    }) =>
      runRuntimeTask({
        io,
        nowMs: Date.UTC(2026, 9, 19, 9, input.sequence, 0),
        paths,
        route,
        task: createRuntimeTask({
          agentId: "agent-felix",
          ...(input.scopeId ? { agentContextScopeId: input.scopeId } : {}),
          bindingKey: "space-shared|agent-felix",
          mentioned: true,
          prompt: input.taskId,
          sequence: input.sequence,
          sourceEventId: `evt-${input.taskId}`,
          spaceId: "space-shared",
          taskId: input.taskId,
          triggerMode: "mention_only",
        }),
      });

    await run({ sequence: 1, taskId: "task-owner-1" });
    await run({
      scopeId: "0f8fad5b-d9cb-469f-a165-70867728950e",
      sequence: 2,
      taskId: "task-colleague",
    });
    // The colleague started fresh instead of resuming the owner's thread.
    expect(dispatch.mock.calls[1]?.[0]?.agentControllerConversationId).not.toBe(
      "owner-thread"
    );
    // The ledger stays valid on disk and holds both, apart.
    const persisted = await loadLedgerState({ io, paths });
    expect(
      Object.values(persisted.agentContextByLookupKey)
        .map((context) => context.agentControllerConversationId)
        .sort()
    ).toEqual(["colleague-thread", "owner-thread"]);
    // The owner's next Wake resumes the owner's thread, not the colleague's.
    const ownerAgain = await run({ sequence: 3, taskId: "task-owner-2" });
    expect(dispatch.mock.calls[2]?.[0]).toMatchObject({
      agentControllerConversationId: "owner-thread",
    });
    expect(ownerAgain.agentContextLifecycle).toMatchObject({
      resolvedAgentControllerConversationId: "owner-thread",
    });
  });

  it("passes streaming mode to adapter request and keeps final-result semantics", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-g34-streaming-intent-"
    );
    createdDirs.add(paths.rootDirPath);

    const io = createNodeLedgerFileIo();
    const dispatch = vi.fn().mockResolvedValue({
      output: "stream-intent-output",
      status: "success",
    });
    const adapter = {
      adapterId: "codex-local-cli",
      dispatch,
      interrupt: vi.fn().mockResolvedValue({
        accepted: true,
        plan: {
          initial: {
            mode: "graceful",
            reason: "service.interrupt",
            taskId: "task-stream-intent-1",
          },
        },
        signalDelivery: "sent",
        taskId: "task-stream-intent-1",
      }),
    };

    const result = await runRuntimeTask({
      io,
      nowMs: Date.UTC(2026, 1, 25, 16, 10, 0),
      paths,
      route: {
        contextIdMappingSpec: {
          mappingVersion: 1,
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
        },
        agentControllerRef: "builtin:codex",
        targets: [
          {
            adapter,
            agentControllerRef: "builtin:codex",
            transportMode: "local-cli",
          },
        ],
        transportMode: "local-cli",
        streamingMode: "stream",
      },
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-1|agent-codex",
        mentioned: true,
        prompt: "stream-intent",
        sequence: 1,
        sourceEventId: "evt-stream-intent-1",
        spaceId: "space-1",
        taskId: "task-stream-intent-1",
        triggerMode: "mention_only",
      }),
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        streamingMode: "stream",
      })
    );
    expect(result.resultPayload).toMatchObject({
      status: "success",
      output: "stream-intent-output",
      taskId: "task-stream-intent-1",
    });
  });

  it("delivers adapter runtime events to the execution caller", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-g34-runtime-event-"
    );
    createdDirs.add(paths.rootDirPath);

    const runtimeEvent = {
      phase: "tool_activity",
      state: "input-available",
      toolCallId: "tool-runtime-event-1",
      toolName: "agent_read_files",
      tsMs: Date.UTC(2026, 1, 25, 16, 15, 0),
    } as const satisfies AdapterRuntimeEvent;
    const observedEvents: AdapterRuntimeEvent[] = [];
    const dispatch: RuntimeAdapter["dispatch"] = async (request) => {
      await request.onRuntimeEvent?.(runtimeEvent);
      return {
        output: "runtime-event-output",
        status: "success",
      };
    };

    const result = await runRuntimeTask({
      io: createNodeLedgerFileIo(),
      nowMs: Date.UTC(2026, 1, 25, 16, 15, 0),
      onRuntimeEvent: (event) => {
        observedEvents.push(event);
      },
      paths,
      route: {
        contextIdMappingSpec: {
          mappingVersion: 1,
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
        },
        agentControllerRef: "builtin:codex",
        targets: [
          {
            adapter: {
              adapterId: "codex-local-cli",
              dispatch,
              interrupt: vi.fn().mockResolvedValue({
                accepted: true,
                plan: {
                  initial: {
                    mode: "graceful",
                    reason: "service.interrupt",
                    taskId: "task-runtime-event-1",
                  },
                },
                signalDelivery: "sent",
                taskId: "task-runtime-event-1",
              }),
            },
            agentControllerRef: "builtin:codex",
            transportMode: "local-cli",
          },
        ],
        transportMode: "local-cli",
        streamingMode: "stream",
      },
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-1|agent-codex",
        mentioned: true,
        prompt: "report-runtime-events",
        sequence: 1,
        sourceEventId: "evt-runtime-event-1",
        spaceId: "space-1",
        taskId: "task-runtime-event-1",
        triggerMode: "mention_only",
      }),
    });

    expect(observedEvents).toEqual([runtimeEvent]);
    expect(result.resultPayload).toMatchObject({
      output: "runtime-event-output",
      status: "success",
      taskId: "task-runtime-event-1",
    });
  });

  it("keeps provider account evidence in the task result payload from adapter dispatch failures", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-provider-access-"
    );
    createdDirs.add(paths.rootDirPath);

    const providerAccessEvidence = {
      observedAtMs: Date.UTC(2026, 1, 25, 16, 20, 0),
      provider: "claude-code",
      reasonCode: "provider_account.subscription_access_unavailable",
      source: "wake_failure",
    } as const;
    const dispatch = vi.fn().mockResolvedValue({
      errorCode: "quota.exceeded",
      errorMessage:
        "Claude Code subscription access is unavailable for this account.",
      errorType: "adapter",
      originalError: "Your account does not have access to this model.",
      providerAccessEvidence,
      status: "failed",
    });
    const adapter = {
      adapterId: "claude-code",
      dispatch,
      interrupt: vi.fn().mockResolvedValue({
        accepted: true,
        plan: {
          initial: {
            mode: "graceful",
            reason: "service.interrupt",
            taskId: "task-provider-access-1",
          },
        },
        signalDelivery: "sent",
        taskId: "task-provider-access-1",
      }),
    };

    const result = await runRuntimeTask({
      adapter,
      io: createNodeLedgerFileIo(),
      nowMs: Date.UTC(2026, 1, 25, 16, 20, 0),
      paths,
      task: createRuntimeTask({
        agentId: "agent-claude-code",
        bindingKey: "space-1|agent-claude-code",
        mentioned: true,
        prompt: "hello",
        sequence: 1,
        sourceEventId: "evt-provider-access-1",
        spaceId: "space-1",
        taskId: "task-provider-access-1",
        triggerMode: "mention_only",
      }),
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(result.resultPayload).toMatchObject({
      errorCode: "quota.exceeded",
      errorMessage:
        "Claude Code subscription access is unavailable for this account.",
      errorType: "adapter",
      originalError: "Your account does not have access to this model.",
      providerAccessEvidence,
      status: "failed",
      taskId: "task-provider-access-1",
    });
  });

  it("reuses persisted agent context across restart when provider context id is missing", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-g34-session-reuse-"
    );
    createdDirs.add(paths.rootDirPath);

    const io = createNodeLedgerFileIo();
    const appServerDispatch = vi.fn().mockResolvedValue({
      output: "session-reuse-output",
      status: "success",
    });
    const appServerAdapter = {
      adapterId: "codex-local-cli",
      dispatch: appServerDispatch,
      interrupt: vi.fn().mockResolvedValue({
        accepted: true,
        plan: {
          initial: {
            mode: "graceful",
            reason: "service.interrupt",
            taskId: "task-session-1",
          },
        },
        signalDelivery: "sent",
        taskId: "task-session-1",
      }),
    };

    const first = await runRuntimeTask({
      io,
      nowMs: Date.UTC(2026, 1, 25, 17, 0, 0),
      paths,
      route: {
        contextIdMappingSpec: {
          mappingVersion: 1,
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
        },
        agentControllerRef: "builtin:codex",
        env: {
          OPENMELD_CLI_CONTEXT_ID: "ctx-reuse-1",
        },
        targets: [
          {
            adapter: appServerAdapter,
            agentControllerRef: "builtin:codex",
            transportMode: "local-cli",
          },
        ],
        transportMode: "local-cli",
      },
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-reuse|agent-codex",
        mentioned: true,
        prompt: "first-run",
        sequence: 1,
        sourceEventId: "evt-session-reuse-1",
        spaceId: "space-reuse",
        taskId: "task-session-1",
        triggerMode: "mention_only",
      }),
    });

    const second = await runRuntimeTask({
      io: createNodeLedgerFileIo(),
      nowMs: Date.UTC(2026, 1, 25, 17, 10, 0),
      paths,
      route: {
        contextIdMappingSpec: {
          mappingVersion: 1,
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
        },
        agentControllerRef: "builtin:codex",
        env: {},
        targets: [
          {
            adapter: appServerAdapter,
            agentControllerRef: "builtin:codex",
            transportMode: "local-cli",
          },
        ],
        transportMode: "local-cli",
      },
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-reuse|agent-codex",
        mentioned: true,
        prompt: "second-run",
        sequence: 2,
        sourceEventId: "evt-session-reuse-2",
        spaceId: "space-reuse",
        taskId: "task-session-2",
        triggerMode: "mention_only",
      }),
    });

    expect(first.agentContextLifecycle).toMatchObject({
      lifecycleReason: "created_missing_context",
      resolvedAgentControllerConversationId: "ctx-reuse-1",
    });
    expect(second.agentContextLifecycle).toMatchObject({
      lifecycleReason: "reused_existing_context",
      resolvedAgentControllerConversationId: "ctx-reuse-1",
    });
    expect(second.contextResolution).toMatchObject({
      agentControllerConversationId: "ctx-reuse-1",
      sourceField: "openMeldDaemon.agent_context_ledger",
    });
    expect(appServerDispatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        agentControllerConversationId: "ctx-reuse-1",
        taskId: "task-session-2",
      })
    );
    expect(second.agentContextLifecycleCounters).toMatchObject({
      created: 1,
      guardBlocked: 0,
      recreated: 0,
      reused: 1,
    });
  });

  it("does not reuse a legacy bare builtin lookup key", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-g34-session-canonical-"
    );
    createdDirs.add(paths.rootDirPath);
    const runtimeWorkspaceFingerprint = buildRuntimeWorkspaceFingerprint(
      DEFAULT_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory
    );

    const io = createNodeLedgerFileIo();
    await persistLedgerState({
      io,
      paths,
      state: upsertAgentContext({
        agentContext: {
          agentControllerConversationId: "ctx-legacy-1",
          agentContextLookupKey: `space-reuse|agent-codex|codex|local-cli|${encodeURIComponent(
            runtimeWorkspaceFingerprint
          )}`,
          agentControllerRef: "builtin:codex",
          createdAtMs: Date.UTC(2026, 1, 25, 16, 0, 0),
          lastTaskId: "task-legacy-0",
          runtimeWorkspaceFingerprint,
          spaceId: "space-reuse",
          targetProfileId: "agent-codex",
          transportMode: "local-cli",
          updatedAtMs: Date.UTC(2026, 1, 25, 16, 0, 0),
        },
        state: createEmptyLedgerState(Date.UTC(2026, 1, 25, 16, 0, 0)),
      }),
    });

    const appServerDispatch = vi.fn().mockResolvedValue({
      output: "session-reuse-output",
      status: "success",
    });
    const appServerAdapter = {
      adapterId: "codex-local-cli",
      dispatch: appServerDispatch,
      interrupt: vi.fn().mockResolvedValue({
        accepted: true,
        plan: {
          initial: {
            mode: "graceful",
            reason: "service.interrupt",
            taskId: "task-session-canonical-1",
          },
        },
        signalDelivery: "sent",
        taskId: "task-session-canonical-1",
      }),
    };

    const result = await runRuntimeTask({
      io,
      nowMs: Date.UTC(2026, 1, 25, 17, 0, 0),
      paths,
      route: {
        contextIdMappingSpec: {
          mappingVersion: 1,
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
        },
        agentControllerRef: "builtin:codex",
        env: {},
        targets: [
          {
            adapter: appServerAdapter,
            agentControllerRef: "builtin:codex",
            transportMode: "local-cli",
          },
        ],
        transportMode: "local-cli",
      },
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-reuse|agent-codex",
        mentioned: true,
        prompt: "reuse-legacy-bare-key",
        sequence: 1,
        sourceEventId: "evt-session-canonical-1",
        spaceId: "space-reuse",
        taskId: "task-session-canonical-1",
        triggerMode: "mention_only",
      }),
    });

    expect(result.agentContextLifecycle).toMatchObject({
      lifecycleReason: "missing_context_unresolved",
      resolvedAgentControllerConversationId: null,
      agentContextLookupKey: `agent-codex|builtin%3Acodex|local-cli|${encodeURIComponent(
        runtimeWorkspaceFingerprint
      )}`,
    });

    const finalState = await loadLedgerState({
      io,
      paths,
    });
    expect(
      finalState.agentContextByLookupKey[
        `space-reuse|agent-codex|codex|local-cli|${encodeURIComponent(
          runtimeWorkspaceFingerprint
        )}`
      ]
    ).toBeUndefined();
    expect(
      finalState.agentContextByLookupKey[
        `space-reuse|agent-codex|builtin%3Acodex|local-cli|${encodeURIComponent(
          runtimeWorkspaceFingerprint
        )}`
      ]
    ).toBeUndefined();
    expect(
      finalState.agentContextByLookupKey[
        `agent-codex|builtin%3Acodex|local-cli|${encodeURIComponent(
          runtimeWorkspaceFingerprint
        )}`
      ]
    ).toBeUndefined();
  });

  it("guards against creating a new context id for the same session key", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-g34-session-guard-"
    );
    createdDirs.add(paths.rootDirPath);

    const io = createNodeLedgerFileIo();
    const dispatch = vi.fn().mockResolvedValue({
      output: "guard-output",
      status: "success",
    });
    const adapter = {
      adapterId: "codex-stdio",
      dispatch,
      interrupt: vi.fn().mockResolvedValue({
        accepted: true,
        plan: {
          initial: {
            mode: "graceful",
            reason: "service.interrupt",
            taskId: "task-guard-1",
          },
        },
        signalDelivery: "sent",
        taskId: "task-guard-1",
      }),
    };

    await runRuntimeTask({
      io,
      nowMs: Date.UTC(2026, 1, 25, 18, 0, 0),
      paths,
      route: {
        contextIdMappingSpec: {
          mappingVersion: 1,
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
        },
        agentControllerRef: "builtin:codex",
        env: {
          OPENMELD_CLI_CONTEXT_ID: "ctx-guard-1",
        },
        targets: [
          {
            adapter,
            agentControllerRef: "builtin:codex",
            transportMode: "local-cli",
          },
        ],
        transportMode: "local-cli",
      },
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-guard|agent-codex",
        mentioned: true,
        prompt: "first-guard",
        sequence: 1,
        sourceEventId: "evt-guard-1",
        spaceId: "space-guard",
        taskId: "task-guard-1",
        triggerMode: "mention_only",
      }),
    });

    const guarded = await runRuntimeTask({
      io,
      nowMs: Date.UTC(2026, 1, 25, 18, 5, 0),
      paths,
      route: {
        contextIdMappingSpec: {
          mappingVersion: 1,
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
        },
        agentControllerRef: "builtin:codex",
        env: {
          OPENMELD_CLI_CONTEXT_ID: "ctx-guard-2",
        },
        targets: [
          {
            adapter,
            agentControllerRef: "builtin:codex",
            transportMode: "local-cli",
          },
        ],
        transportMode: "local-cli",
      },
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-guard|agent-codex",
        mentioned: true,
        prompt: "second-guard",
        sequence: 2,
        sourceEventId: "evt-guard-2",
        spaceId: "space-guard",
        taskId: "task-guard-2",
        triggerMode: "mention_only",
      }),
    });

    expect(guarded.agentContextLifecycle).toMatchObject({
      lifecycleReason: "guard_reused_existing_context",
      resolvedAgentControllerConversationId: "ctx-guard-1",
    });
    expect(dispatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        agentControllerConversationId: "ctx-guard-1",
        taskId: "task-guard-2",
      })
    );
    expect(guarded.contextResolution).toMatchObject({
      sourceField: "openMeldDaemon.agent_context_ledger",
    });
    expect(guarded.agentContextLifecycleCounters).toMatchObject({
      created: 1,
      guardBlocked: 1,
      recreated: 0,
      reused: 1,
    });
  });

  it("keeps existing session when provider context changes for the same target", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-g34-session-recreate-"
    );
    createdDirs.add(paths.rootDirPath);

    const io = createNodeLedgerFileIo();
    const stdioDispatch = vi.fn().mockResolvedValue({
      output: "stdio-output",
      status: "success",
    });
    const secondDispatch = vi.fn().mockResolvedValue({
      output: "local-cli-output",
      status: "success",
    });
    const stdioAdapter = {
      adapterId: "codex-stdio",
      dispatch: stdioDispatch,
      interrupt: vi.fn().mockResolvedValue({
        accepted: true,
        plan: {
          initial: {
            mode: "graceful",
            reason: "service.interrupt",
            taskId: "task-recreate-1",
          },
        },
        signalDelivery: "sent",
        taskId: "task-recreate-1",
      }),
    };
    const secondAdapter = {
      adapterId: "codex-local-cli",
      dispatch: secondDispatch,
      interrupt: vi.fn().mockResolvedValue({
        accepted: true,
        plan: {
          initial: {
            mode: "graceful",
            reason: "service.interrupt",
            taskId: "task-recreate-2",
          },
        },
        signalDelivery: "sent",
        taskId: "task-recreate-2",
      }),
    };

    await runRuntimeTask({
      io,
      nowMs: Date.UTC(2026, 1, 25, 19, 0, 0),
      paths,
      route: {
        contextIdMappingSpec: {
          mappingVersion: 1,
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
        },
        agentControllerRef: "builtin:codex",
        env: {
          OPENMELD_CLI_CONTEXT_ID: "ctx-recreate-stdio",
        },
        targets: [
          {
            adapter: stdioAdapter,
            agentControllerRef: "builtin:codex",
            transportMode: "local-cli",
          },
        ],
        transportMode: "local-cli",
      },
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-recreate|agent-codex",
        mentioned: true,
        prompt: "stdio-first",
        sequence: 1,
        sourceEventId: "evt-recreate-1",
        spaceId: "space-recreate",
        taskId: "task-recreate-1",
        triggerMode: "mention_only",
      }),
    });

    const guarded = await runRuntimeTask({
      io,
      nowMs: Date.UTC(2026, 1, 25, 19, 5, 0),
      paths,
      route: {
        contextIdMappingSpec: {
          mappingVersion: 1,
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
        },
        agentControllerRef: "builtin:codex",
        env: {
          OPENMELD_CLI_CONTEXT_ID: "ctx-recreate-second",
        },
        targets: [
          {
            adapter: secondAdapter,
            agentControllerRef: "builtin:codex",
            transportMode: "local-cli",
          },
        ],
        transportMode: "local-cli",
      },
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-recreate|agent-codex",
        mentioned: true,
        prompt: "second-dispatch",
        sequence: 2,
        sourceEventId: "evt-recreate-2",
        spaceId: "space-recreate",
        taskId: "task-recreate-2",
        triggerMode: "mention_only",
      }),
    });

    expect(guarded.agentContextLifecycle).toMatchObject({
      lifecycleReason: "guard_reused_existing_context",
      resolvedAgentControllerConversationId: "ctx-recreate-stdio",
    });
    expect(guarded.agentContextRotationAudit).toBeUndefined();
    expect(secondDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        agentControllerConversationId: "ctx-recreate-stdio",
      })
    );
    expect(guarded.agentContextLifecycleCounters).toMatchObject({
      created: 1,
      guardBlocked: 1,
      recreated: 0,
      reused: 1,
    });
    expect(guarded.state.agentContextRotations).toHaveLength(0);
  });

  it("does not emit session lifecycle or commit counters when route fails", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-g34-session-route-fail-"
    );
    createdDirs.add(paths.rootDirPath);

    const io = createNodeLedgerFileIo();
    const dispatch = vi.fn().mockResolvedValue({
      output: "route-ok",
      status: "success",
    });
    const adapter = {
      adapterId: "codex-stdio",
      dispatch,
      interrupt: vi.fn().mockResolvedValue({
        accepted: true,
        plan: {
          initial: {
            mode: "graceful",
            reason: "service.interrupt",
            taskId: "task-route-fail-1",
          },
        },
        signalDelivery: "sent",
        taskId: "task-route-fail-1",
      }),
    };

    const first = await runRuntimeTask({
      io,
      nowMs: Date.UTC(2026, 1, 25, 20, 0, 0),
      paths,
      route: {
        contextIdMappingSpec: {
          mappingVersion: 1,
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
        },
        agentControllerRef: "builtin:codex",
        env: {
          OPENMELD_CLI_CONTEXT_ID: "ctx-route-fail-1",
        },
        targets: [
          {
            adapter,
            agentControllerRef: "builtin:codex",
            transportMode: "local-cli",
          },
        ],
        transportMode: "local-cli",
      },
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-route-fail|agent-codex",
        mentioned: true,
        prompt: "seed-session",
        sequence: 1,
        sourceEventId: "evt-route-fail-1",
        spaceId: "space-route-fail",
        taskId: "task-route-fail-1",
        triggerMode: "mention_only",
      }),
    });

    const failed = await runRuntimeTask({
      io,
      nowMs: Date.UTC(2026, 1, 25, 20, 5, 0),
      paths,
      route: {
        contextIdMappingSpec: {
          mappingVersion: 1,
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
        },
        agentControllerRef: "builtin:codex",
        env: {
          OPENMELD_CLI_CONTEXT_ID: "ctx-route-fail-2",
        },
        serviceInstalled: false,
        targets: [
          {
            adapter,
            agentControllerRef: "builtin:codex",
            transportMode: "local-cli",
          },
        ],
        transportMode: "local-cli",
      },
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-route-fail|agent-codex",
        mentioned: true,
        prompt: "route-failure-run",
        sequence: 2,
        sourceEventId: "evt-route-fail-2",
        spaceId: "space-route-fail",
        taskId: "task-route-fail-2",
        triggerMode: "mention_only",
      }),
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(first.agentContextLifecycleCounters).toMatchObject({
      created: 1,
      guardBlocked: 0,
      recreated: 0,
      reused: 0,
    });
    expect(failed.dispatchResult).toMatchObject({
      dispatched: true,
      routeFailure: {
        errorCode: "service.not_installed",
      },
    });
    expect(failed.agentContextLifecycle).toBeUndefined();
    expect(failed.agentContextLifecycleCounters).toMatchObject({
      created: 1,
      guardBlocked: 0,
      recreated: 0,
      reused: 0,
    });

    const finalState = await loadLedgerState({
      io,
      paths,
    });
    const sessions = Object.values(finalState.agentContextByLookupKey);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      agentControllerConversationId: "ctx-route-fail-1",
      lastTaskId: "task-route-fail-1",
    });
    expect(finalState.agentContextLifecycleCounters).toMatchObject({
      created: 1,
      guardBlocked: 0,
      recreated: 0,
      reused: 0,
    });
  });

  it("keeps session store empty when provider context is unresolved on first dispatch", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-g34-session-unresolved-"
    );
    createdDirs.add(paths.rootDirPath);

    const io = createNodeLedgerFileIo();
    const dispatch = vi.fn().mockResolvedValue({
      output: "unresolved-output",
      status: "success",
    });
    const adapter = {
      adapterId: "codex-local-cli",
      dispatch,
      interrupt: vi.fn().mockResolvedValue({
        accepted: true,
        plan: {
          initial: {
            mode: "graceful",
            reason: "service.interrupt",
            taskId: "task-unresolved-1",
          },
        },
        signalDelivery: "sent",
        taskId: "task-unresolved-1",
      }),
    };

    const result = await runRuntimeTask({
      io,
      nowMs: Date.UTC(2026, 1, 25, 21, 0, 0),
      paths,
      route: {
        contextIdMappingSpec: {
          mappingVersion: 1,
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
        },
        agentControllerRef: "builtin:codex",
        env: {},
        targets: [
          {
            adapter,
            agentControllerRef: "builtin:codex",
            transportMode: "local-cli",
          },
        ],
        transportMode: "local-cli",
      },
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-unresolved|agent-codex",
        mentioned: true,
        prompt: "missing-provider-context",
        sequence: 1,
        sourceEventId: "evt-unresolved-1",
        spaceId: "space-unresolved",
        taskId: "task-unresolved-1",
        triggerMode: "mention_only",
      }),
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.not.objectContaining({
        agentControllerConversationId: expect.anything(),
      })
    );
    expect(result.agentContextLifecycle).toMatchObject({
      lifecycleReason: "missing_context_unresolved",
      resolvedAgentControllerConversationId: null,
    });
    expect(result.agentContextLifecycleCounters).toMatchObject({
      created: 0,
      guardBlocked: 0,
      recreated: 0,
      reused: 0,
    });

    const finalState = await loadLedgerState({
      io,
      paths,
    });
    expect(finalState.agentContextByLookupKey).toEqual({});
    expect(finalState.agentContextLifecycleCounters).toMatchObject({
      created: 0,
      guardBlocked: 0,
      recreated: 0,
      reused: 0,
    });
  });
});
