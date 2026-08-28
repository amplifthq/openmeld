import {
  type ClaudeAgentSdkQueryFactory,
  createClaudeCodeAdapter,
} from "@openmeld/adapter-claude-code";
import { createCodexAdapter } from "@openmeld/adapter-codex";
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
  it("keeps the active mode unchanged when the adapter has no live update capability", async () => {
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
        fingerprint: "codex-auto",
        profileIds: ["agt-1"],
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
        skippedProfiles: [],
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
        reasonCode: "adapter.permission_mode_update_unsupported",
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
          fingerprint: "claude-auto",
          profileIds: ["agt-claude-smoke"],
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
          skippedProfiles: [],
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
        fingerprint: "opencode-permission-json",
        profileIds: ["agt-opencode"],
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
        skippedProfiles: [],
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
