import type { RuntimeAdapter } from "@openmeld/adapter-core";
import {
  createInflightTaskControlRegistry,
  createLocalAdapterContainer,
  createPendingAgentInteractionRegistry,
} from "@openmeld/local-service";
import { describe, expect, it, vi } from "vitest";
import { handleExecutionHostFrame } from "../src/local-service/execution-host/frame-router";

type FrameInput = Parameters<typeof handleExecutionHostFrame>[0];

function fixture() {
  const pending = createPendingAgentInteractionRegistry();
  const tasks = createInflightTaskControlRegistry();
  const updatePermissionMode =
    vi.fn<NonNullable<RuntimeAdapter["updatePermissionMode"]>>();
  const adapter: RuntimeAdapter = {
    adapterId: "codex",
    updatePermissionMode,
    dispatch: vi.fn(),
    interrupt: vi.fn(),
  };
  const socket = { send: vi.fn() } as unknown as FrameInput["socket"];
  const response = pending.register({
    taskId: "task-1",
    authority: {
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      targetProfileId: "profile-1",
      runtimeCoordinatorExecutionId: "execution-1",
      executionIdentityEcho: {
        echoSource: "daemon_delivery_context",
        core: {
          modelVersion: "openmeld.runtime.execution_identity.v1",
          spaceId: "space-1",
          dispatchId: "dispatch-1",
          targetProfileId: "profile-1",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
        },
      },
      executionTokenEcho: {
        executionToken: `rcet_v1_${"a".repeat(64)}`,
        runId: "run-1",
        runtimeCoordinatorExecutionId: "execution-1",
        tokenFingerprint: `etfp_v1_${"a".repeat(32)}`,
      },
    },
    request: {
      v: 1,
      interactionId: "interaction-1",
      kind: "permission",
      title: "Allow this command?",
      requestedAtMs: Date.now(),
      expiresAtMs: Date.now() + 60_000,
      supportsPermissionModeUpdate: true,
      subject: { type: "command", command: "printf hello" },
      options: [
        { optionId: "accept", label: "Allow once", intent: "allow_once" },
      ],
    },
  });
  tasks.registerTask({
    taskId: "task-1",
    attemptId: "attempt-1",
    dispatchId: "dispatch-1",
    adapterId: "codex",
    targetProfileId: "profile-1",
    agentControllerPermissionMode: "codex:askForApproval",
  });
  let routes: FrameInput["routeByProfileId"] = new Map();
  const reference = {
    bindingId: "binding-1",
    mode: "codex:approveForMe" as const,
  };
  const input: FrameInput = {
    computerFileAccessStorePath: "/tmp/openmeld-test-unused-policy.json",
    contextStore: new Map(),
    currentSocketRef: { connectionGeneration: 1, socket },
    daemonSessionId: "session-1",
    inflightDispatchMetaByTaskId: new Map(),
    inflightTaskControlRegistry: tasks,
    pendingAgentInteractionRegistry: pending,
    leasesByProfileId: new Map(),
    localAdapterContainer: createLocalAdapterContainer([
      { adapter, adapterId: "codex", transportModes: ["local-cli"] },
    ]),
    localExecutionSlots: {} as FrameInput["localExecutionSlots"],
    ledgerPaths: {} as FrameInput["ledgerPaths"],
    presenter: { view: "human", data: vi.fn(), event: vi.fn(), line: vi.fn() },
    profileOwnerName: null,
    profileOwnerUserId: "owner-1",
    socket,
    routeByProfileId: routes,
    readRouteByProfileId: () => routes,
    parsedFrame: {
      code: "daemon.dispatch.interaction_response",
      payload: {
        interactionId: "interaction-1",
        runtimeCoordinatorExecutionId: "execution-1",
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        respondedAtMs: Date.now(),
        response: {
          kind: "permission",
          optionId: "accept",
          permissionModeUpdate: reference,
        },
      },
    },
  };
  return {
    input,
    pending,
    response,
    tasks,
    updatePermissionMode,
    reference,
    publishRoute(
      mode: "codex:approveForMe" | "codex:askForApproval" = "codex:approveForMe"
    ) {
      routes = new Map([
        [
          "profile-1",
          {
            profileId: "profile-1",
            bindingId: "binding-1",
            configurationRevision: mode === reference.mode ? 2 : 3,
            agentControllerRef: "builtin:codex",
            agentControllerPermissionMode: mode,
            transportMode: "local-cli",
            streamingMode: "final",
            contextIdMappingSpec: {
              mappingVersion: 1,
              sourceField: "session_id",
            },
          },
        ],
      ]);
    },
  };
}

describe("permission response ordering", () => {
  it.each([
    true,
    false,
  ])("acknowledges redelivery without reporting another local resume (initial lease=%s)", async (hasInitialLease) => {
    const test = fixture();
    test.publishRoute();
    if (hasInitialLease) {
      test.input.leasesByProfileId.set("profile-1", 1);
    }
    test.updatePermissionMode.mockResolvedValue({
      taskId: "task-1",
      status: "applied",
      effectiveFrom: "subsequent_tool_requests",
    });
    handleExecutionHostFrame(test.input);
    await expect(test.response).resolves.toMatchObject({ optionId: "accept" });
    expect(test.input.socket.send).toHaveBeenCalledTimes(
      hasInitialLease ? 1 : 0
    );
    expect(test.input.presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({ code: "daemon.run.interaction_resolved" })
    );

    test.input.leasesByProfileId.set("profile-1", 1);
    handleExecutionHostFrame(test.input);
    await vi.waitFor(() =>
      expect(test.input.socket.send).toHaveBeenCalledTimes(
        hasInitialLease ? 2 : 1
      )
    );
    for (const [frame] of vi.mocked(test.input.socket.send).mock.calls) {
      expect(JSON.parse(String(frame))).toMatchObject({
        code: "daemon.dispatch.interaction_delivered",
        payload: { interactionId: "interaction-1" },
      });
    }
    expect(test.updatePermissionMode).toHaveBeenCalledOnce();
    const resumes = vi
      .mocked(test.input.presenter.line)
      .mock.calls.filter(
        ([line]) => line.code === "daemon.run.interaction_resolved"
      );
    expect(resumes).toHaveLength(1);
  });

  it("waits for the canonical route and native acknowledgement before releasing approval", async () => {
    const test = fixture();
    let acknowledge!: () => void;
    test.updatePermissionMode.mockImplementation(
      () =>
        new Promise((resolve) => {
          acknowledge = () =>
            resolve({
              taskId: "task-1",
              status: "applied",
              effectiveFrom: "subsequent_tool_requests",
            });
        })
    );
    handleExecutionHostFrame(test.input);
    expect(test.updatePermissionMode).not.toHaveBeenCalled();
    expect(test.pending.get("interaction-1")?.response).toBeNull();
    test.publishRoute();
    await vi.waitFor(() =>
      expect(test.updatePermissionMode).toHaveBeenCalledOnce()
    );
    expect(test.pending.get("interaction-1")?.response).toBeNull();
    expect(test.tasks.getTask("task-1")?.agentControllerPermissionMode).toBe(
      "codex:askForApproval"
    );
    acknowledge();
    await expect(test.response).resolves.toMatchObject({
      optionId: "accept",
      permissionModeUpdate: test.reference,
    });
    expect(test.tasks.getTask("task-1")?.agentControllerPermissionMode).toBe(
      "codex:approveForMe"
    );
  });

  it("does not reapply an old choice after a newer saved mode supersedes it", async () => {
    vi.useFakeTimers();
    try {
      const test = fixture();
      test.publishRoute("codex:askForApproval");
      handleExecutionHostFrame(test.input);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(test.response).resolves.toMatchObject({
        optionId: "accept",
      });
      expect(test.updatePermissionMode).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the selected approval when the native provider cannot apply the new mode", async () => {
    const test = fixture();
    test.publishRoute();
    test.updatePermissionMode.mockResolvedValue({
      taskId: "task-1",
      status: "not_applied",
      reasonCode: "adapter.permission_mode_update_unsupported",
    });
    handleExecutionHostFrame(test.input);
    await expect(test.response).resolves.toMatchObject({ optionId: "accept" });
    expect(test.tasks.getTask("task-1")?.agentControllerPermissionMode).toBe(
      "codex:askForApproval"
    );
  });
});
