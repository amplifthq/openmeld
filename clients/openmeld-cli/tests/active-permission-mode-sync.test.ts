import {
  type ClaudeAgentSdkQueryFactory,
  createClaudeCodeAdapter,
} from "@openmeld/adapter-claude-code";
import { createCodexAdapter } from "@openmeld/adapter-codex";
import type { RuntimeAdapter } from "@openmeld/adapter-core";
import { createOpenCodeAdapter } from "@openmeld/adapter-opencode";
import {
  createInflightTaskControlRegistry,
  createLocalAdapterContainer,
} from "@openmeld/local-service";
import { describe, expect, it, vi } from "vitest";
import { syncActiveTaskPermissionModes } from "../src/local-service/routing/active-permission-mode-sync";

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve: () => void = () => {
    throw new Error("deferred promise was not initialized");
  };
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("active permission mode sync", () => {
  it("serializes native writes and reads the newest choice after acknowledgement", async () => {
    const registry = createInflightTaskControlRegistry();
    registry.registerTask({
      adapterId: "codex",
      taskId: "task",
      dispatchId: "dispatch",
      attemptId: "attempt",
      targetProfileId: "profile",
      agentControllerPermissionMode: "codex:askForApproval",
    });
    const acknowledgement = createDeferred();
    const updatePermissionMode = vi
      .fn<NonNullable<RuntimeAdapter["updatePermissionMode"]>>()
      .mockImplementation(async ({ taskId }) => {
        await acknowledgement.promise;
        return {
          taskId,
          status: "applied",
          effectiveFrom: "subsequent_tool_requests",
        };
      });
    const adapter: RuntimeAdapter = {
      adapterId: "codex",
      dispatch: vi.fn(),
      interrupt: vi.fn(),
      updatePermissionMode,
    };
    const catalogState: Parameters<
      typeof syncActiveTaskPermissionModes
    >[0]["catalogState"] = {
      routeByProfileId: new Map([
        [
          "profile",
          {
            profileId: "profile",
            agentControllerRef: "builtin:codex",
            agentControllerPermissionMode: "codex:approveForMe",
            transportMode: "local-cli",
            streamingMode: "final",
            contextIdMappingSpec: {
              mappingVersion: 1,
              sourceField: "session_id",
            },
          },
        ],
      ]),
    };
    const input = {
      catalogState,
      inflightTaskControlRegistry: registry,
      localAdapterContainer: createLocalAdapterContainer([
        { adapter, adapterId: "codex", transportModes: ["local-cli"] },
      ]),
    };
    const first = syncActiveTaskPermissionModes(input);
    const route = catalogState.routeByProfileId.get("profile");
    if (!route) {
      throw new Error("test route is missing");
    }
    route.agentControllerPermissionMode = "codex:askForApproval";
    const second = syncActiveTaskPermissionModes(input);
    expect(updatePermissionMode).toHaveBeenCalledTimes(1);
    expect(registry.getTask("task")?.agentControllerPermissionMode).toBe(
      "codex:askForApproval"
    );
    acknowledgement.resolve();
    await Promise.all([first, second]);
    expect(
      updatePermissionMode.mock.calls.map(
        ([request]) => request.agentControllerPermissionMode
      )
    ).toEqual(["codex:approveForMe", "codex:askForApproval"]);
    expect(registry.getTask("task")?.agentControllerPermissionMode).toBe(
      "codex:askForApproval"
    );
  });

  it("keeps the active mode unchanged without a registered native turn", async () => {
    const inflightTaskControlRegistry = createInflightTaskControlRegistry();
    inflightTaskControlRegistry.registerTask({
      adapterId: "codex",
      agentControllerPermissionMode: "codex:askForApproval",
      dispatchId: "dispatch-1",
      targetProfileId: "agt-1",
      taskId: "task-1",
    });
    const adapter = createCodexAdapter({
      invoke: vi.fn().mockResolvedValue({ output: "unused" }),
    });

    const outcomes = await syncActiveTaskPermissionModes({
      catalogState: {
        routeByProfileId: new Map([
          [
            "agt-1",
            {
              agentControllerPermissionMode: "codex:approveForMe",
              agentControllerRef: "builtin:codex",
              contextIdMappingSpec: {
                mappingVersion: 1,
                sourceField: "session_id",
              },
              profileId: "agt-1",
              streamingMode: "final",
              transportMode: "local-cli",
            },
          ],
        ]),
      },
      inflightTaskControlRegistry,
      localAdapterContainer: createLocalAdapterContainer([
        {
          adapter,
          adapterId: "codex",
          transportModes: ["local-cli"],
        },
      ]),
    });

    expect(outcomes).toEqual([
      {
        adapterId: "codex",
        agentControllerPermissionMode: "codex:approveForMe",
        reasonCode: "adapter.task_not_active",
        status: "not_applied",
        targetProfileId: "agt-1",
        taskId: "task-1",
      },
    ]);
    expect(inflightTaskControlRegistry.getTask("task-1")).toMatchObject({
      agentControllerPermissionMode: "codex:askForApproval",
    });
  });

  it("smokes a live Claude mode change through the real adapter without a subscription", async () => {
    const queryStarted = createDeferred();
    const releaseQuery = createDeferred();
    const permissionModes: string[] = [];
    const createAgentSdkQuery: ClaudeAgentSdkQueryFactory = ({ prompt }) => {
      const runtime = (async function* () {
        for await (const _message of prompt) {
          // Consume the real SDK prompt before exposing an active query.
          // The prompt stream stays open for later steering messages.
          break;
        }
        queryStarted.resolve();
        await releaseQuery.promise;
        yield {
          is_error: false,
          result: "synthetic smoke complete",
          session_id: "claude-synthetic-smoke",
          subtype: "success",
          type: "result",
        };
      })();
      return Object.assign(runtime, {
        close: () => undefined,
        initializationResult: () => Promise.resolve({}),
        interrupt: () => Promise.resolve(),
        setMaxThinkingTokens: () => Promise.resolve(),
        setModel: () => Promise.resolve(),
        setPermissionMode: (permissionMode: string) => {
          permissionModes.push(permissionMode);
          return Promise.resolve();
        },
      }) as unknown as ReturnType<ClaudeAgentSdkQueryFactory>;
    };
    const adapter = createClaudeCodeAdapter({
      claudeTimeoutMs: 5000,
      createAgentSdkQuery,
      launchContract: {
        commandPath: process.execPath,
        kind: "executable",
      },
    });
    const inflightTaskControlRegistry = createInflightTaskControlRegistry();
    inflightTaskControlRegistry.registerTask({
      adapterId: "claude-code",
      agentControllerPermissionMode: "claude-code:default",
      dispatchId: "dispatch-claude-smoke",
      targetProfileId: "agt-claude-smoke",
      taskId: "task-claude-smoke",
    });
    const dispatchPromise = adapter.dispatch({
      agentControllerPermissionMode: "claude-code:default",
      agentId: "agt-claude-smoke",
      prompt: "wait while the owner changes permission mode",
      runtimeContext: {
        providerRuntimeWorkingDirectory: process.cwd(),
      },
      sourceEventId: "event-claude-smoke",
      spaceId: "space-claude-smoke",
      taskId: "task-claude-smoke",
    });

    await queryStarted.promise;
    try {
      const outcomes = await syncActiveTaskPermissionModes({
        catalogState: {
          routeByProfileId: new Map([
            [
              "agt-claude-smoke",
              {
                agentControllerPermissionMode: "claude-code:auto",
                agentControllerRef: "builtin:claude-code",
                contextIdMappingSpec: {
                  mappingVersion: 1,
                  sourceField: "session_id",
                },
                profileId: "agt-claude-smoke",
                streamingMode: "final",
                transportMode: "local-cli",
              },
            ],
          ]),
        },
        inflightTaskControlRegistry,
        localAdapterContainer: createLocalAdapterContainer([
          {
            adapter,
            adapterId: "claude-code",
            transportModes: ["local-cli"],
          },
        ]),
      });

      expect(permissionModes).toEqual(["auto"]);
      expect(outcomes).toEqual([
        {
          adapterId: "claude-code",
          agentControllerPermissionMode: "claude-code:auto",
          status: "applied",
          targetProfileId: "agt-claude-smoke",
          taskId: "task-claude-smoke",
        },
      ]);
      expect(
        inflightTaskControlRegistry.getTask("task-claude-smoke")
      ).toMatchObject({
        agentControllerPermissionMode: "claude-code:auto",
      });
    } finally {
      releaseQuery.resolve();
      await dispatchPromise;
    }
  });

  it("leaves OpenCode permission JSON outside generic live-mode reconciliation", async () => {
    const inflightTaskControlRegistry = createInflightTaskControlRegistry();
    inflightTaskControlRegistry.registerTask({
      adapterId: "opencode",
      agentControllerPermissionMode: null,
      dispatchId: "dispatch-opencode",
      targetProfileId: "agt-opencode",
      taskId: "task-opencode",
    });
    const adapter = createOpenCodeAdapter({
      invoke: vi.fn().mockResolvedValue({ output: "unused" }),
    });

    const outcomes = await syncActiveTaskPermissionModes({
      catalogState: {
        routeByProfileId: new Map([
          [
            "agt-opencode",
            {
              agentControllerRef: "builtin:opencode",
              contextIdMappingSpec: {
                mappingVersion: 1,
                sourceField: "session_id",
              },
              openCodePermission: {
                bash: "allow",
                edit: "ask",
              },
              profileId: "agt-opencode",
              streamingMode: "final",
              transportMode: "local-cli",
            },
          ],
        ]),
      },
      inflightTaskControlRegistry,
      localAdapterContainer: createLocalAdapterContainer([
        {
          adapter,
          adapterId: "opencode",
          transportModes: ["local-cli"],
        },
      ]),
    });

    expect(outcomes).toEqual([]);
    expect(inflightTaskControlRegistry.getTask("task-opencode")).toMatchObject({
      agentControllerPermissionMode: null,
    });
  });
});
