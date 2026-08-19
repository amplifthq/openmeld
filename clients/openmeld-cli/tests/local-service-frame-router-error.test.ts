import type { RuntimeAdapter } from "@openmeld/adapter-core";
import {
  createInflightTaskControlRegistry,
  createLocalAdapterContainer,
  createPendingAgentInteractionRegistry,
} from "@openmeld/local-service";
import { RUNTIME_TRANSPORT_SCHEMA_VERSION } from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emitDaemonErrorFrame,
  handleDaemonSocketFrame,
} from "../src/local-service/carrier/frame-router";
import type { Presenter } from "../src/runtime/presenter/types";
import type { WsClient } from "../src/transport/ws";

type FrameRouterInput = Parameters<typeof handleDaemonSocketFrame>[0];

const createPresenter = (): {
  presenter: Presenter;
  lines: Array<{ code: string; text: string }>;
} => {
  const lines: Array<{ code: string; text: string }> = [];
  return {
    presenter: {
      view: "human",
      data: () => undefined,
      event: () => undefined,
      line: (input) => {
        lines.push({
          code: input.code,
          text: input.text,
        });
      },
    },
    lines,
  };
};

function createSocket(): WsClient & { send: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn(),
  } as unknown as WsClient & { send: ReturnType<typeof vi.fn> };
}

function createCancelableAdapter(
  cancel: RuntimeAdapter["cancel"]
): RuntimeAdapter {
  return {
    adapterId: "claude-code",
    cancel,
    dispatch: vi.fn(),
    interrupt: vi.fn(),
  } as unknown as RuntimeAdapter;
}

function createInterruptibleAdapter(
  interrupt: RuntimeAdapter["interrupt"]
): RuntimeAdapter {
  return {
    adapterId: "codex",
    dispatch: vi.fn(),
    interrupt,
  } as unknown as RuntimeAdapter;
}

describe("local service frame-router error handling", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows restart guidance for register contract mismatch", () => {
    const { presenter, lines } = createPresenter();
    emitDaemonErrorFrame({
      payload: {
        code: "schema.invalid",
        message: "invalid register payload",
      },
      presenter,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.code).toBe("daemon.run.register_contract_mismatch");
    expect(lines[0]?.text).toContain(
      "OpenMeld service is out of sync with this CLI version."
    );
    expect(lines[0]?.text).toContain("openmeld service stop --force");
    expect(lines[0]?.text).toContain("openmeld service start");
  });

  it("keeps uncorrelated daemon errors away from pending register and heartbeat waiters", () => {
    const { presenter, lines } = createPresenter();
    const registerRejecter = vi.fn();
    const heartbeatRejecter = vi.fn();
    const registerResolver = vi.fn();
    const heartbeatResolver = vi.fn();
    const waiters = {
      registerResolver,
      registerRejecter,
      heartbeatResolver,
      heartbeatRejecter,
    };
    emitDaemonErrorFrame({
      payload: {
        code: "schema.invalid",
        message: "invalid daemon stream frame",
      },
      presenter,
      waiters,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.code).toBe("daemon.run.daemon_error");
    expect(lines[0]?.text).toContain("invalid daemon stream frame");
    expect(registerRejecter).not.toHaveBeenCalled();
    expect(heartbeatRejecter).not.toHaveBeenCalled();
    expect(waiters.registerResolver).toBe(registerResolver);
    expect(waiters.registerRejecter).toBe(registerRejecter);
    expect(waiters.heartbeatResolver).toBe(heartbeatResolver);
    expect(waiters.heartbeatRejecter).toBe(heartbeatRejecter);
  });

  it("rejects only the register waiter for an explicit invalid-register contract mismatch", () => {
    const { presenter } = createPresenter();
    const registerRejecter = vi.fn();
    const heartbeatRejecter = vi.fn();
    const registerResolver = vi.fn();
    const heartbeatResolver = vi.fn();
    const waiters = {
      registerResolver,
      registerRejecter,
      heartbeatResolver,
      heartbeatRejecter,
    };

    emitDaemonErrorFrame({
      payload: {
        code: "schema.invalid",
        message: "invalid register payload",
      },
      presenter,
      waiters,
    });

    expect(registerRejecter).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "schema.invalid: invalid register payload",
      })
    );
    expect(heartbeatRejecter).not.toHaveBeenCalled();
    expect(waiters.registerResolver).toBeNull();
    expect(waiters.registerRejecter).toBeNull();
    expect(waiters.heartbeatResolver).toBe(heartbeatResolver);
    expect(waiters.heartbeatRejecter).toBe(heartbeatRejecter);
  });

  it("rejects only the heartbeat waiter for an explicit invalid-heartbeat contract mismatch", () => {
    const { presenter, lines } = createPresenter();
    const registerRejecter = vi.fn();
    const heartbeatRejecter = vi.fn();
    const registerResolver = vi.fn();
    const heartbeatResolver = vi.fn();
    const waiters = {
      registerResolver,
      registerRejecter,
      heartbeatResolver,
      heartbeatRejecter,
    };

    emitDaemonErrorFrame({
      payload: {
        code: "schema.invalid",
        message: "invalid heartbeat payload",
      },
      presenter,
      waiters,
    });

    expect(lines).toContainEqual(
      expect.objectContaining({
        code: "daemon.run.heartbeat_contract_mismatch",
      })
    );
    expect(heartbeatRejecter).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "schema.invalid: invalid heartbeat payload",
      })
    );
    expect(registerRejecter).not.toHaveBeenCalled();
    expect(waiters.heartbeatResolver).toBeNull();
    expect(waiters.heartbeatRejecter).toBeNull();
    expect(waiters.registerResolver).toBe(registerResolver);
    expect(waiters.registerRejecter).toBe(registerRejecter);
  });

  it("renders openmeld-dev restart guidance when the dev shortcut is active", () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    const { presenter, lines } = createPresenter();

    emitDaemonErrorFrame({
      payload: {
        code: "schema.invalid",
        message: "invalid register payload",
      },
      presenter,
    });

    expect(lines[0]?.text).toContain("openmeld-dev service stop --force");
    expect(lines[0]?.text).toContain("openmeld-dev service start");
  });

  it("returns accepted local cancel control results with resolved task identity", async () => {
    const { presenter } = createPresenter();
    const socket = createSocket();
    const registry = createInflightTaskControlRegistry();
    registry.registerTask({
      adapterId: "claude-code",
      dispatchId: "dispatch-1",
      runtimeCoordinatorExecutionId: "rce-1",
      taskId: "task-1",
    });
    const cancel = vi.fn(async () => ({
      accepted: true,
      deliveryPath: "cancel" as const,
      reasonCode: "accepted" as const,
      signalDelivery: "sent" as const,
      taskId: "task-1",
    }));
    const localAdapterContainer = createLocalAdapterContainer([
      {
        adapter: createCancelableAdapter(cancel),
        adapterId: "claude-code",
        transportModes: ["local-cli"],
      },
    ]);

    handleDaemonSocketFrame({
      computerFileAccessStorePath:
        "/tmp/openmeld-test-missing-computer-file-access-policy.json",
      contextStore: new Map(),
      currentSocketRef: {
        connectionGeneration: 1,
        socket,
      },
      daemonSessionId: "daemon-session-1",
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: registry,
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      leasesByProfileId: new Map(),
      localAdapterContainer,
      localExecutionSlots: {} as FrameRouterInput["localExecutionSlots"],
      ledgerPaths: {} as FrameRouterInput["ledgerPaths"],
      parsedFrame: {
        code: "daemon.local_agent_control.cancel",
        payload: {
          payload: {
            reason: "wake.stop",
            runtimeCoordinatorExecutionId: "rce-1",
            target: {
              by: "task",
              taskId: "task-1",
            },
          },
          requestId: "wake-stop:rce-1",
        },
      },
      presenter,
      profileOwnerName: null,
      profileOwnerUserId: "user-1",
      routeByProfileId: new Map(),
      socket,
      waiters: {
        heartbeatRejecter: null,
        heartbeatResolver: null,
        registerRejecter: null,
        registerResolver: null,
      },
    });

    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(1));
    expect(cancel).toHaveBeenCalledWith({
      reason: "wake.stop",
      taskId: "task-1",
    });
    expect(registry.getTask("task-1")).toBeNull();
    expect(JSON.parse(socket.send.mock.calls[0]?.[0] ?? "")).toEqual({
      code: "daemon.local_agent_control.result",
      payload: {
        payload: {
          accepted: true,
          note: "cancel",
          reasonCode: "adapter.cancel.accepted",
          resolvedDispatchId: "dispatch-1",
          resolvedRuntimeCoordinatorExecutionId: "rce-1",
          resolvedTaskId: "task-1",
          target: {
            by: "task",
            taskId: "task-1",
          },
        },
        requestId: "wake-stop:rce-1",
      },
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    });
  });

  it("rejects local cancel control when RuntimeCoordinator identity does not match", async () => {
    const { presenter } = createPresenter();
    const socket = createSocket();
    const registry = createInflightTaskControlRegistry();
    registry.registerTask({
      adapterId: "claude-code",
      dispatchId: "dispatch-1",
      runtimeCoordinatorExecutionId: "rce-1",
      taskId: "task-1",
    });
    const cancel = vi.fn(async () => ({
      accepted: true,
      deliveryPath: "cancel" as const,
      reasonCode: "accepted" as const,
      signalDelivery: "sent" as const,
      taskId: "task-1",
    }));
    const localAdapterContainer = createLocalAdapterContainer([
      {
        adapter: createCancelableAdapter(cancel),
        adapterId: "claude-code",
        transportModes: ["local-cli"],
      },
    ]);

    handleDaemonSocketFrame({
      computerFileAccessStorePath:
        "/tmp/openmeld-test-missing-computer-file-access-policy.json",
      contextStore: new Map(),
      currentSocketRef: {
        connectionGeneration: 1,
        socket,
      },
      daemonSessionId: "daemon-session-1",
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: registry,
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      leasesByProfileId: new Map(),
      localAdapterContainer,
      localExecutionSlots: {} as FrameRouterInput["localExecutionSlots"],
      ledgerPaths: {} as FrameRouterInput["ledgerPaths"],
      parsedFrame: {
        code: "daemon.local_agent_control.cancel",
        payload: {
          payload: {
            runtimeCoordinatorExecutionId: "rce-other",
            target: {
              by: "task",
              taskId: "task-1",
            },
          },
          requestId: "wake-stop:rce-other",
        },
      },
      presenter,
      profileOwnerName: null,
      profileOwnerUserId: "user-1",
      routeByProfileId: new Map(),
      socket,
      waiters: {
        heartbeatRejecter: null,
        heartbeatResolver: null,
        registerRejecter: null,
        registerResolver: null,
      },
    });

    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(1));
    expect(cancel).not.toHaveBeenCalled();
    expect(JSON.parse(socket.send.mock.calls[0]?.[0] ?? "")).toEqual({
      code: "daemon.local_agent_control.result",
      payload: {
        payload: {
          accepted: false,
          note: "runtime_coordinator.execution_id_mismatch",
          reasonCode: "runtime_coordinator.execution_id_mismatch",
          resolvedDispatchId: "dispatch-1",
          resolvedRuntimeCoordinatorExecutionId: "rce-1",
          resolvedTaskId: "task-1",
          target: {
            by: "task",
            taskId: "task-1",
          },
        },
        requestId: "wake-stop:rce-other",
      },
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    });
  });

  it("returns accepted local interrupt control results with resolved task identity", async () => {
    const { presenter } = createPresenter();
    const socket = createSocket();
    const registry = createInflightTaskControlRegistry();
    registry.registerTask({
      adapterId: "codex",
      dispatchId: "dispatch-1",
      runtimeCoordinatorExecutionId: "rce-1",
      taskId: "task-1",
    });
    const interrupt = vi.fn(async () => ({
      accepted: true,
      plan: {
        initial: {
          mode: "force" as const,
          reason: "wake.stop",
          taskId: "task-1",
        },
      },
      reasonCode: "accepted" as const,
      signalDelivery: "sent" as const,
      taskId: "task-1",
    }));
    const localAdapterContainer = createLocalAdapterContainer([
      {
        adapter: createInterruptibleAdapter(interrupt),
        adapterId: "codex",
        transportModes: ["codex-app-server"],
      },
    ]);

    handleDaemonSocketFrame({
      computerFileAccessStorePath:
        "/tmp/openmeld-test-missing-computer-file-access-policy.json",
      contextStore: new Map(),
      currentSocketRef: {
        connectionGeneration: 1,
        socket,
      },
      daemonSessionId: "daemon-session-1",
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: registry,
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      leasesByProfileId: new Map(),
      localAdapterContainer,
      localExecutionSlots: {} as FrameRouterInput["localExecutionSlots"],
      ledgerPaths: {} as FrameRouterInput["ledgerPaths"],
      parsedFrame: {
        code: "daemon.local_agent_control.interrupt",
        payload: {
          payload: {
            mode: "force",
            reason: "wake.stop",
            runtimeCoordinatorExecutionId: "rce-1",
            target: {
              by: "task",
              taskId: "task-1",
            },
          },
          requestId: "wake-stop:rce-1",
        },
      },
      presenter,
      profileOwnerName: null,
      profileOwnerUserId: "user-1",
      routeByProfileId: new Map(),
      socket,
      waiters: {
        heartbeatRejecter: null,
        heartbeatResolver: null,
        registerRejecter: null,
        registerResolver: null,
      },
    });

    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(1));
    expect(interrupt).toHaveBeenCalledWith({
      mode: "force",
      reason: "wake.stop",
      taskId: "task-1",
    });
    expect(JSON.parse(socket.send.mock.calls[0]?.[0] ?? "")).toEqual({
      code: "daemon.local_agent_control.result",
      payload: {
        payload: {
          accepted: true,
          note: "adapter.interrupt.accepted",
          reasonCode: "adapter.interrupt.accepted",
          resolvedDispatchId: "dispatch-1",
          resolvedRuntimeCoordinatorExecutionId: "rce-1",
          resolvedTaskId: "task-1",
          target: {
            by: "task",
            taskId: "task-1",
          },
        },
        requestId: "wake-stop:rce-1",
      },
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    });
  });

  it("rejects local interrupt control when RuntimeCoordinator identity does not match", async () => {
    const { presenter } = createPresenter();
    const socket = createSocket();
    const registry = createInflightTaskControlRegistry();
    registry.registerTask({
      adapterId: "codex",
      dispatchId: "dispatch-1",
      runtimeCoordinatorExecutionId: "rce-1",
      taskId: "task-1",
    });
    const interrupt = vi.fn();
    const localAdapterContainer = createLocalAdapterContainer([
      {
        adapter: createInterruptibleAdapter(interrupt),
        adapterId: "codex",
        transportModes: ["codex-app-server"],
      },
    ]);

    handleDaemonSocketFrame({
      computerFileAccessStorePath:
        "/tmp/openmeld-test-missing-computer-file-access-policy.json",
      contextStore: new Map(),
      currentSocketRef: {
        connectionGeneration: 1,
        socket,
      },
      daemonSessionId: "daemon-session-1",
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: registry,
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      leasesByProfileId: new Map(),
      localAdapterContainer,
      localExecutionSlots: {} as FrameRouterInput["localExecutionSlots"],
      ledgerPaths: {} as FrameRouterInput["ledgerPaths"],
      parsedFrame: {
        code: "daemon.local_agent_control.interrupt",
        payload: {
          payload: {
            runtimeCoordinatorExecutionId: "rce-other",
            target: {
              by: "task",
              taskId: "task-1",
            },
          },
          requestId: "wake-stop:rce-other",
        },
      },
      presenter,
      profileOwnerName: null,
      profileOwnerUserId: "user-1",
      routeByProfileId: new Map(),
      socket,
      waiters: {
        heartbeatRejecter: null,
        heartbeatResolver: null,
        registerRejecter: null,
        registerResolver: null,
      },
    });

    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(1));
    expect(interrupt).not.toHaveBeenCalled();
    expect(JSON.parse(socket.send.mock.calls[0]?.[0] ?? "")).toEqual({
      code: "daemon.local_agent_control.result",
      payload: {
        payload: {
          accepted: false,
          note: "runtime_coordinator.execution_id_mismatch",
          reasonCode: "runtime_coordinator.execution_id_mismatch",
          resolvedDispatchId: "dispatch-1",
          resolvedRuntimeCoordinatorExecutionId: "rce-1",
          resolvedTaskId: "task-1",
          target: {
            by: "task",
            taskId: "task-1",
          },
        },
        requestId: "wake-stop:rce-other",
      },
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    });
  });
});
