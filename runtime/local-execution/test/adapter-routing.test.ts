import { describe, expect, it, vi } from "vitest";
import {
  ADAPTER_ROUTE_ERROR_CODES,
  resolveAdapterRoute,
  toDispatchFailureFromRouteFailure,
} from "../src/adapter-routing";

const createAdapter = () => ({
  adapterId: "codex",
  dispatch: vi.fn().mockResolvedValue({
    output: "ok",
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

describe("adapter routing", () => {
  it("returns service.not_installed with human next step when daemon service is missing", () => {
    const result = resolveAdapterRoute({
      contextIdMappingSpec: {
        mappingVersion: 1,
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
      },
      agentControllerRef: "builtin:codex",
      serviceInstalled: false,
      targets: [
        {
          adapter: createAdapter(),
          agentControllerRef: "builtin:codex",
          transportMode: "local-cli",
        },
      ],
      transportMode: "local-cli",
      view: "human",
    });

    expect(result).toEqual({
      errorCode: "service.not_installed",
      errorMessage: "service.not_installed",
      errorType: "config",
      nextStep: "run `openmeld-dev service install` and retry dispatch",
      ok: false,
    });
  });

  it("returns dispatch.policy.unsupported when policy is not mention_only", () => {
    const result = resolveAdapterRoute({
      contextIdMappingSpec: {
        mappingVersion: 1,
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
      },
      agentControllerRef: "builtin:codex",
      dispatchPolicy: "legacy_policy" as never,
      targets: [
        {
          adapter: createAdapter(),
          agentControllerRef: "builtin:codex",
          transportMode: "local-cli",
        },
      ],
      transportMode: "local-cli",
      view: "agent",
    });

    expect(result).toEqual({
      errorCode: "dispatch.policy.unsupported",
      errorMessage: "dispatch.policy.unsupported",
      errorType: "config",
      nextStep:
        "ask a human to switch dispatch policy to mention_only for this target",
      ok: false,
    });
  });

  it("returns adapter.unreachable when no target is available", () => {
    const result = resolveAdapterRoute({
      contextIdMappingSpec: {
        mappingVersion: 1,
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
      },
      agentControllerRef: "builtin:codex",
      targets: [],
      transportMode: "local-cli",
      view: "agent",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected route resolution failure");
    }
    expect(result.errorCode).toBe(ADAPTER_ROUTE_ERROR_CODES.adapterUnreachable);
  });

  it("resolves adapter and context mapping using registry spec", () => {
    const adapter = createAdapter();
    const result = resolveAdapterRoute({
      contextIdMappingSpec: {
        mappingVersion: 2,
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
      },
      agentControllerRef: "builtin:codex",
      env: {
        OPENMELD_CLI_CONTEXT_ID: "thread-123",
      },
      targets: [
        {
          adapter,
          agentControllerRef: "builtin:codex",
          transportMode: "local-cli",
        },
      ],
      transportMode: "local-cli",
    });

    expect(result).toEqual({
      adapter,
      contextResolution: {
        agentControllerConversationId: "thread-123",
        mappingVersion: 2,
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
        agentControllerConversation: {
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: "thread-123",
          agentControllerConversationKind: "thread",
        },
      },
      dispatchPolicy: "mention_only",
      ok: true,
      transportMode: "local-cli",
    });
  });

  it("converts route failures into adapter dispatch failures with stable error code", () => {
    const route = resolveAdapterRoute({
      contextIdMappingSpec: {
        mappingVersion: 1,
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
      },
      agentControllerRef: "builtin:codex",
      serviceHealthy: false,
      targets: [],
      transportMode: "local-cli",
    });
    if (route.ok) {
      throw new Error("expected route failure");
    }

    const dispatchFailure = toDispatchFailureFromRouteFailure(route);
    expect(dispatchFailure).toMatchObject({
      errorCode: "service.unhealthy",
      errorType: "network",
      status: "failed",
    });
    expect(dispatchFailure.errorMessage).toContain("service.unhealthy");
  });
});
