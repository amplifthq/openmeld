import { describe, expect, it, vi } from "vitest";
import { dispatchMentionOnlyTaskWithRouting } from "../src/mention-dispatch-integration";

const createAdapter = () => ({
  adapterId: "codex",
  dispatch: vi.fn().mockResolvedValue({
    output: "adapter-output",
    status: "success",
  }),
  interrupt: vi.fn().mockResolvedValue({
    accepted: true,
    plan: {
      initial: {
        mode: "graceful",
        reason: "service.interrupt",
        taskId: "task-1",
      },
    },
    signalDelivery: "sent",
    taskId: "task-1",
  }),
});

const baseRequest = {
  agentId: "agent-codex",
  prompt: "hello from mention routing",
  sourceEventId: "evt-routing-1",
  spaceId: "space-routing",
  taskId: "task-routing-1",
} as const;

describe("mention dispatch with adapter routing", () => {
  it("skips routing when mention_only policy is not triggered", async () => {
    const adapter = createAdapter();

    const result = await dispatchMentionOnlyTaskWithRouting({
      contextIdMappingSpec: {
        mappingVersion: 1,
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
      },
      agentControllerRef: "builtin:codex",
      mentioned: false,
      request: baseRequest,
      targets: [
        {
          adapter,
          agentControllerRef: "builtin:codex",
          transportMode: "local-cli",
        },
      ],
      transportMode: "local-cli",
      triggerMode: "mention_only",
    });

    expect(result).toEqual({
      dispatched: false,
      reason: "not_mentioned",
    });
    expect(adapter.dispatch).not.toHaveBeenCalled();
  });

  it("returns fail-fast service.unhealthy without invoking adapter", async () => {
    const adapter = createAdapter();
    const result = await dispatchMentionOnlyTaskWithRouting({
      contextIdMappingSpec: {
        mappingVersion: 1,
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
      },
      agentControllerRef: "builtin:codex",
      mentioned: true,
      request: baseRequest,
      serviceHealthy: false,
      targets: [
        {
          adapter,
          agentControllerRef: "builtin:codex",
          transportMode: "local-cli",
        },
      ],
      transportMode: "local-cli",
      view: "human",
    });

    expect(result.dispatched).toBe(true);
    if (!result.dispatched) {
      throw new Error("expected dispatched=true");
    }
    expect(result.adapterResult).toMatchObject({
      errorCode: "service.unhealthy",
      errorType: "network",
      status: "failed",
    });
    expect(adapter.dispatch).not.toHaveBeenCalled();
  });

  it("dispatches through selected transport and exposes context resolution", async () => {
    const adapter = createAdapter();
    const result = await dispatchMentionOnlyTaskWithRouting({
      contextIdMappingSpec: {
        mappingVersion: 3,
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
      },
      agentControllerRef: "builtin:codex",
      env: {
        OPENMELD_CLI_CONTEXT_ID: "thread-ctx-1",
      },
      mentioned: true,
      request: baseRequest,
      targets: [
        {
          adapter,
          agentControllerRef: "builtin:codex",
          transportMode: "local-cli",
        },
      ],
      transportMode: "local-cli",
    });

    expect(result).toMatchObject({
      contextResolution: {
        agentControllerConversationId: "thread-ctx-1",
        mappingVersion: 3,
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
        agentControllerConversation: {
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: "thread-ctx-1",
          agentControllerConversationKind: "thread",
        },
      },
      dispatched: true,
      reason: "dispatched",
    });
    expect(adapter.dispatch).toHaveBeenCalledWith({
      ...baseRequest,
      agentControllerConversationId: "thread-ctx-1",
      env: {
        OPENMELD_CLI_CONTEXT_ID: "thread-ctx-1",
      },
      agentControllerConversation: {
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "thread-ctx-1",
        agentControllerConversationKind: "thread",
      },
      transportMode: "local-cli",
    });
  });

  it("uses session override context id when provided", async () => {
    const adapter = createAdapter();
    const result = await dispatchMentionOnlyTaskWithRouting({
      agentControllerConversationIdOverride: "session-ledger-ctx-1",
      contextIdMappingSpec: {
        mappingVersion: 3,
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
      },
      agentControllerRef: "builtin:codex",
      env: {
        OPENMELD_CLI_CONTEXT_ID: "provider-ctx-2",
      },
      mentioned: true,
      request: baseRequest,
      sourceFieldOverride: "openMeldDaemon.agent_context_ledger",
      targets: [
        {
          adapter,
          agentControllerRef: "builtin:codex",
          transportMode: "local-cli",
        },
      ],
      transportMode: "local-cli",
    });

    expect(result).toMatchObject({
      contextResolution: {
        agentControllerConversationId: "session-ledger-ctx-1",
        mappingVersion: 3,
        sourceField: "openMeldDaemon.agent_context_ledger",
        agentControllerConversation: {
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: "session-ledger-ctx-1",
          agentControllerConversationKind: "thread",
        },
      },
      dispatched: true,
      reason: "dispatched",
    });
    expect(adapter.dispatch).toHaveBeenCalledWith({
      ...baseRequest,
      agentControllerConversationId: "session-ledger-ctx-1",
      env: {
        OPENMELD_CLI_CONTEXT_ID: "provider-ctx-2",
      },
      agentControllerConversation: {
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "session-ledger-ctx-1",
        agentControllerConversationKind: "thread",
      },
      transportMode: "local-cli",
    });
  });

  it("passes explicit agent controller conversation override without forcing contextId equality", async () => {
    const adapter = createAdapter();
    adapter.adapterId = "openclaw";

    const result = await dispatchMentionOnlyTaskWithRouting({
      agentControllerConversationIdOverride: null,
      contextIdMappingSpec: {
        mappingVersion: 3,
        sourceField: "OPENCLAW_SESSION_ID",
      },
      agentControllerRef: "builtin:openclaw",
      env: {
        OPENMELD_DAEMON_RUNTIME_OPENCLAW_AGENT_ID: "openmeld-demo-bot",
      },
      mentioned: true,
      request: baseRequest,
      targets: [
        {
          adapter,
          agentControllerRef: "builtin:openclaw",
          transportMode: "local-cli",
        },
      ],
      transportMode: "local-cli",
      agentControllerConversationOverride: {
        agentControllerRef: "builtin:openclaw",
        agentControllerConversationId:
          "agent:openmeld-demo-bot:openmeld-space:ops-room--abc12345",
        agentControllerConversationKind: "session",
      },
    });

    expect(result).toMatchObject({
      contextResolution: {
        agentControllerConversationId: null,
        mappingVersion: 3,
        sourceField: "OPENCLAW_SESSION_ID",
        agentControllerConversation: {
          agentControllerRef: "builtin:openclaw",
          agentControllerConversationId:
            "agent:openmeld-demo-bot:openmeld-space:ops-room--abc12345",
          agentControllerConversationKind: "session",
        },
      },
      dispatched: true,
      reason: "dispatched",
    });
    expect(adapter.dispatch).toHaveBeenCalledWith({
      ...baseRequest,
      env: {
        OPENMELD_DAEMON_RUNTIME_OPENCLAW_AGENT_ID: "openmeld-demo-bot",
      },
      transportMode: "local-cli",
      agentControllerConversation: {
        agentControllerRef: "builtin:openclaw",
        agentControllerConversationId:
          "agent:openmeld-demo-bot:openmeld-space:ops-room--abc12345",
        agentControllerConversationKind: "session",
      },
    });
  });
});
