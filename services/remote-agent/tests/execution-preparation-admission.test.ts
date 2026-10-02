import { describe, expect, it, vi } from "vitest";
import { createRemoteAgentCallbackContext } from "../agent-core/callback-context";
import {
  buildRemoteAgentExecutionIdentity,
  initializeRemoteAgentExecutionState,
  RemoteAgentExecutionCancelledError,
  requestRemoteAgentExecutionCancellation,
} from "../agent-core/execution-state";
import { acknowledgeRemoteAgentExecutionPreparation } from "../flue-adapter/execution-context";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

async function admittedExecution() {
  const request = createSubmitTurnRequest();
  const context = createRemoteAgentCallbackContext({
    request,
    nowMs: TEST_NOW_MS,
    ack: {
      accepted: true,
      createdAt: TEST_NOW_MS,
      idempotencyKey: request.idempotencyKey,
      requestId: request.dispatchId,
      status: "pending",
      submissionId: request.dispatchId,
    },
  });
  const storage = new InMemoryDurableObjectStorage();
  const identity = buildRemoteAgentExecutionIdentity(context);
  await initializeRemoteAgentExecutionState({
    acceptedAtMs: TEST_NOW_MS,
    identity,
    storage,
  });
  return { context, identity, storage };
}

describe("execution preparation admission barrier", () => {
  it("waits for durable Core admission before allowing resource preparation", async () => {
    const execution = await admittedExecution();
    let accept: ((value: unknown) => void) | undefined;
    const acknowledged = new Promise((resolve) => {
      accept = resolve;
    });
    const acknowledgeRemoteAgentAdmission = vi.fn(() => acknowledged);
    const prepareResources = vi.fn();
    const preparation = acknowledgeRemoteAgentExecutionPreparation({
      ...execution,
      coreWorker: { acknowledgeRemoteAgentAdmission },
    }).then(prepareResources);
    await vi.waitFor(() =>
      expect(acknowledgeRemoteAgentAdmission).toHaveBeenCalledOnce()
    );
    expect(prepareResources).not.toHaveBeenCalled();
    expect(acknowledgeRemoteAgentAdmission).toHaveBeenCalledWith({
      agentProfileId: execution.context.agentProfileId,
      bindingId: execution.context.bindingId,
      dispatchId: execution.context.dispatchId,
      idempotencyKey: execution.context.idempotencyKey,
      organizationId: execution.context.organizationId,
      spaceId: execution.context.spaceId,
      submissionId: execution.context.submissionId,
      triggerMessageId: execution.context.triggerMessageId,
    });
    accept?.({ status: "accepted" });
    await preparation;
    expect(prepareResources).toHaveBeenCalledOnce();
  });

  it.each([
    "before",
    "during",
  ])("preserves a Stop arriving %s the Core acknowledgement", async (when) => {
    const execution = await admittedExecution();
    const cancel = () =>
      requestRemoteAgentExecutionCancellation({
        ...execution,
        nowMs: TEST_NOW_MS + 1,
      });
    if (when === "before") {
      await cancel();
    }
    const acknowledgeRemoteAgentAdmission = vi.fn(async () => {
      await cancel();
      return { status: "accepted" };
    });
    await expect(
      acknowledgeRemoteAgentExecutionPreparation({
        ...execution,
        coreWorker: { acknowledgeRemoteAgentAdmission },
      })
    ).rejects.toBeInstanceOf(RemoteAgentExecutionCancelledError);
    expect(acknowledgeRemoteAgentAdmission).toHaveBeenCalledTimes(
      when === "before" ? 0 : 1
    );
  });

  it("preserves a Core Stop as cancellation, and fails closed on unavailable or rejected admission", async () => {
    const execution = await admittedExecution();
    await expect(
      acknowledgeRemoteAgentExecutionPreparation({
        ...execution,
        coreWorker: {},
      })
    ).rejects.toThrow("remote_agent.admission_acknowledgement_unavailable");
    await expect(
      acknowledgeRemoteAgentExecutionPreparation({
        ...execution,
        coreWorker: {
          acknowledgeRemoteAgentAdmission: async () => ({
            status: "rejected",
            reasonCode: "remote_agent.execution_cancelled",
          }),
        },
      })
    ).rejects.toBeInstanceOf(RemoteAgentExecutionCancelledError);
    await expect(
      acknowledgeRemoteAgentExecutionPreparation({
        ...execution,
        coreWorker: {
          acknowledgeRemoteAgentAdmission: async () => ({
            status: "rejected",
            reasonCode: "remote_agent.admission_identity_not_active",
          }),
        },
      })
    ).rejects.toThrow("remote_agent.admission_identity_not_active");
  });
});
