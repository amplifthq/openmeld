import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeAdapter } from "@openmeld/adapter-core";
import {
  createInflightTaskControlRegistry,
  createLocalAdapterContainer,
  createPendingAgentInteractionRegistry,
} from "@openmeld/local-service";
import { serviceExecutionHostMethods } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { createServiceExecutionInputReceiver } from "../src/local-service/execution-host/execution-input";
import { buildLedgerPaths } from "../src/local-service/state/daemon-device-id";
import { createInProcessExecutionHost } from "./helpers/execution-host";

// Inventory is an unrelated external boundary; this test must never inspect
// installed providers, private histories or the real Service state.
vi.mock("../src/agent-activity/integration-refresh", () => ({
  createManagedAgentActivityIntegrationRefreshScheduler: () => ({
    request: () => undefined,
    stop: () => Promise.resolve(),
  }),
}));
vi.mock("../src/agent-activity/local-sync", () => ({
  startLocalAgentActivitySyncLoop: () => ({
    requestSync: () => undefined,
    stop: () => Promise.resolve(),
  }),
}));

function fixture(steer?: RuntimeAdapter["steer"]) {
  const registry = createInflightTaskControlRegistry();
  registry.registerTask({
    adapterId: "codex",
    dispatchId: "dispatch-1",
    runtimeCoordinatorExecutionId: "execution-1",
    attemptId: "attempt-1",
    runtimeCoordinatorRunId: "run-1",
    targetProfileId: "agent-1",
    taskId: "task-1",
  });
  const unexpectedControl = (): never => {
    throw new Error("Steer must not start or interrupt a task.");
  };
  const adapter: RuntimeAdapter = {
    adapterId: "codex",
    steer,
    dispatch: unexpectedControl,
    interrupt: unexpectedControl,
  };
  const adapters = createLocalAdapterContainer([
    { adapter, adapterId: "codex", transportModes: ["codex-app-server"] },
  ]);
  const receiver = createServiceExecutionInputReceiver({
    ownerUserId: "owner-1",
    registry,
    adapters,
  });
  const request = {
    inputId: "input-1",
    ownerUserId: "owner-1",
    dispatchId: "dispatch-1",
    runtimeCoordinatorExecutionId: "execution-1",
    attemptId: "attempt-1",
    runtimeCoordinatorRunId: "run-1",
    targetProfileId: "agent-1",
    source: {
      spaceId: "space-1",
      signalId: "signal-1",
      authorProfileId: "author-1",
      requesterUserId: "requester-1",
      effect: "steer" as const,
    },
    text: "Use the revised requirement.",
  };
  const call = (operation: "apply" | "read", value = request) =>
    receiver(
      serviceExecutionHostMethods.executionInput.input.parse({
        operation,
        request: value,
        connectionGeneration: 1,
        leaseEpoch: 1,
      })
    );
  return { call, registry, request, adapters };
}

describe("Service exact-execution input receiver", () => {
  it("does not retarget an input to a replacement attempt of the same logical execution", async () => {
    const steer = vi.fn(({ taskId }: { taskId: string }) =>
      Promise.resolve({
        status: "applied" as const,
        taskId,
        threadId: "thread-new",
        turnId: "turn-new",
      })
    );
    const { call, registry } = fixture(steer);
    registry.registerTask({
      adapterId: "codex",
      dispatchId: "dispatch-1",
      runtimeCoordinatorExecutionId: "execution-1",
      targetProfileId: "agent-1",
      taskId: "replacement-task",
      attemptId: "attempt-2",
      runtimeCoordinatorRunId: "run-2",
    });
    expect(await call("apply")).toMatchObject({
      status: "not_applied",
      reasonCode: "execution_input.target_unavailable",
    });
    expect(steer).not.toHaveBeenCalled();
  });

  it("fences retired connectors and leases, retains receipts across reconnect, and allows only reads while draining", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "openmeld-input-host-"));
    vi.stubEnv("OPENMELD_HOME", stateRoot);
    const native = Promise.withResolvers<{
      status: "applied";
      taskId: string;
      threadId: string;
      turnId: string;
    }>();
    const steer = vi.fn(() => native.promise);
    const { registry, request, adapters } = fixture(steer);
    const host = await createInProcessExecutionHost({
      stateRoot,
      daemonSessionId: "session-1",
      deviceId: "device-1",
      ownerUserId: "owner-1",
      profileOwnerName: null,
      presenter: {
        view: "agent",
        data: () => undefined,
        line: () => undefined,
        event: () => undefined,
      },
      resources: {
        contextStore: new Map(),
        inflightDispatchMetaByTaskId: new Map(),
        inflightTaskControlRegistry: registry,
        pendingAgentInteractionRegistry:
          createPendingAgentInteractionRegistry(),
        localAdapterContainer: adapters,
        ledgerPaths: buildLedgerPaths(join(stateRoot, "ledger")),
        initialCatalog: {
          profileIds: ["agent-1"],
          routeByProfileId: new Map(),
          skippedProfiles: [],
        },
        dispatchLimits: { globalConcurrency: 1, queueMax: 4 },
      },
    });
    const receipt = {
      status: "applied" as const,
      taskId: "task-1",
      threadId: "thread-1",
      turnId: "turn-1",
    };
    try {
      const configure = (connectionGeneration: number, leaseEpoch: number) =>
        host.port.call("configureConnection", {
          connectionGeneration,
          catalogRevision: 0,
          executionAdmissionConfirmation: true,
          leases: [{ profileId: "agent-1", leaseEpoch }],
        });
      await configure(1, 1);
      const payload = {
        operation: "apply" as const,
        request,
        connectionGeneration: 1,
        leaseEpoch: 1,
      };
      const applying = host.port.call("executionInput", payload);
      await vi.waitFor(() => expect(steer).toHaveBeenCalledTimes(1));
      await configure(2, 2);
      await expect(
        host.port.call("executionInput", payload)
      ).rejects.toMatchObject({ code: "host.connection_replaced" });
      const current = { ...payload, connectionGeneration: 2, leaseEpoch: 2 };
      expect(
        await host.port.call("executionInput", {
          ...current,
          operation: "read",
        })
      ).toMatchObject({ status: "unconfirmed" });
      await host.port.call("heartbeat", {
        connectionGeneration: 2,
        staleProfileIds: ["agent-1"],
      });
      await expect(
        host.port.call("executionInput", current)
      ).rejects.toMatchObject({ code: "host.execution_input_unavailable" });
      await configure(2, 2);
      native.resolve(receipt);
      await applying;
      await host.port.call("beginDrain", {});
      await expect(
        host.port.call("executionInput", {
          ...current,
          request: { ...request, inputId: "input-2" },
        })
      ).rejects.toMatchObject({ code: "host.draining" });
      expect(
        await host.port.call("executionInput", {
          ...current,
          operation: "read",
        })
      ).toMatchObject(receipt);
      expect(steer).toHaveBeenCalledTimes(1);
    } finally {
      native.resolve(receipt);
      await host.close();
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it.each([
    "ownerUserId",
    "dispatchId",
    "runtimeCoordinatorExecutionId",
    "attemptId",
    "runtimeCoordinatorRunId",
    "targetProfileId",
  ] as const)("rejects a mismatched %s before native input", async (key) => {
    const steer = vi.fn();
    const { call, request } = fixture(steer);
    expect(
      await call("apply", { ...request, [key]: "different" })
    ).toMatchObject({
      status: "not_applied",
      reasonCode: "execution_input.target_unavailable",
    });
    expect(steer).not.toHaveBeenCalled();
  });

  it("joins duplicate delivery, reads uncertainty without resending, and preserves the original receipt after task retirement", async () => {
    const pending = Promise.withResolvers<{
      status: "applied";
      taskId: string;
      threadId: string;
      turnId: string;
    }>();
    const steer = vi.fn(() => pending.promise);
    const { call, registry, request } = fixture(steer);
    const first = call("apply");
    const duplicate = call("apply");
    expect(steer).toHaveBeenCalledTimes(1);
    expect(steer).toHaveBeenCalledWith({
      taskId: "task-1",
      inputId: request.inputId,
      text: request.text,
    });
    expect(await call("read")).toMatchObject({ status: "unconfirmed" });
    expect(
      await call("apply", { ...request, text: "Changed input" })
    ).toMatchObject({
      status: "conflict",
    });
    pending.resolve({
      status: "applied",
      taskId: "task-1",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    const receipt = await first;
    expect(await duplicate).toEqual(receipt);
    expect(receipt).toMatchObject({ status: "applied", inputId: "input-1" });
    registry.removeTask("task-1");
    expect(await call("read")).toEqual(receipt);
    expect(await call("apply")).toEqual(receipt);
    expect(steer).toHaveBeenCalledTimes(1);
  });

  it.each([
    "throws",
    "wrong_task",
  ])("holds an uncertain %s outcome without another send", async (mode) => {
    const steer = vi.fn(() => {
      if (mode === "throws") {
        throw new Error("Private provider failure details");
      }
      return Promise.resolve({
        status: "applied" as const,
        taskId: "another-task",
        threadId: "t",
        turnId: "u",
      });
    });
    const { call } = fixture(steer);
    const receipt = await call("apply");
    expect(receipt).toMatchObject({ status: "unconfirmed" });
    expect(JSON.stringify(receipt)).not.toContain("Private provider");
    expect(await call("read")).toEqual(receipt);
    expect(await call("apply")).toEqual(receipt);
    expect(steer).toHaveBeenCalledTimes(1);
  });

  it("distinguishes unsupported application from a missing receipt after Host replacement", async () => {
    const { call } = fixture();
    expect(await call("read")).toMatchObject({ status: "not_found" });
    expect(await call("apply")).toMatchObject({
      status: "not_applied",
      reasonCode: "execution_input.unsupported",
    });
    const replacement = fixture();
    expect(await replacement.call("read")).toMatchObject({
      status: "not_found",
    });
  });
});
