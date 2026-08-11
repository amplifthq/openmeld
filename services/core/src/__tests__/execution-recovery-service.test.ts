import type {
  ExecuteExecutionRecoveryBody,
  ExecutionRecoveryDestination,
  ExecutionRecoveryIdentity,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  executeExecutionRecovery,
  inspectExecutionRecovery,
} from "../execution-recovery/application/execution-recovery-service";

const identity: ExecutionRecoveryIdentity = {
  agentControllerConversationId: "conversation-1",
  agentControllerRef: "builtin:codex",
  attemptId: "attempt-1",
  dispatchId: "dispatch-1",
  resultRef: "dispatch-1::attempt-1",
  runtimeCoordinatorExecutionId: "runtime-execution-1",
  spaceId: "space-1",
  targetProfileId: "profile-1",
  taskId: "task-1",
};

const destination = {
  spaceId: "space-1",
  surface: "space" as const,
  threadId: "thread-1",
};
const connectorDestinations = [
  {
    conversationId: "slack-conversation-1",
    messageId: "slack-message-1",
    spaceId: "space-1",
    surface: "slack" as const,
  },
  {
    conversationId: "lark-conversation-1",
    messageId: "lark-message-1",
    spaceId: "space-1",
    surface: "lark" as const,
  },
] satisfies ExecutionRecoveryDestination[];
const surfaceDestinations = [
  destination,
  ...connectorDestinations,
] satisfies ExecutionRecoveryDestination[];

function command(
  action: ExecuteExecutionRecoveryBody["action"]
): ExecuteExecutionRecoveryBody {
  return {
    action,
    destination,
    expectedIdentity: identity,
    operationId: "operation-1",
  };
}

describe("execution recovery service", () => {
  it.each(
    surfaceDestinations
  )("projects the same Core-owned recovery truth for $surface consumers", (surfaceDestination) => {
    const projection = inspectExecutionRecovery({
      destination: surfaceDestination,
      explicitUserStop: false,
      freshExecutionCapability: { exactSourceWakeVerified: true },
      identity,
      outcomeUnknown: false,
      retainedResult: {
        available: true,
        recoveredPublicationId: null,
      },
      resumeCapability: {
        exactAssociationVerified: true,
        serviceSupportsResume: true,
      },
      updatedAtMs: 100,
    });

    expect(projection).toMatchObject({
      destination: surfaceDestination,
      recommendedAction: "recover_result",
      status: "available",
      tier: "durable_result_replay",
    });
    expect(projection.actions.recoverResult.enabled).toBe(true);
    expect(projection.actions.resumeControllerConversation.enabled).toBe(false);
    expect(projection.actions.retryAsNewExecution.enabled).toBe(false);
  });

  it.each(
    connectorDestinations
  )("projects a connector-owned retained result without inventing workstation task identity for $surface", (surfaceDestination) => {
    const projection = inspectExecutionRecovery({
      destination: surfaceDestination,
      explicitUserStop: false,
      freshExecutionCapability: { exactSourceWakeVerified: true },
      identity: {
        ...identity,
        attemptId: null,
        resultRef: "native-delivery-result:v1:delivery-1:sha256:exact",
        runtimeCoordinatorExecutionId: null,
        taskId: null,
      },
      outcomeUnknown: false,
      retainedResult: {
        available: true,
        recoveredPublicationId: null,
      },
      resumeCapability: {
        exactAssociationVerified: true,
        serviceSupportsResume: true,
      },
      updatedAtMs: 100,
    });

    expect(projection).toMatchObject({
      destination: surfaceDestination,
      recommendedAction: "recover_result",
      tier: "durable_result_replay",
    });
    expect(projection.actions.recoverResult.enabled).toBe(true);
    expect(projection.identity.attemptId).toBeNull();
    expect(projection.identity.taskId).toBeNull();
  });

  it("prioritizes retained result replay and never calls controller or model I/O", async () => {
    const projection = inspectExecutionRecovery({
      destination,
      explicitUserStop: false,
      freshExecutionCapability: { exactSourceWakeVerified: true },
      identity,
      outcomeUnknown: false,
      retainedResult: {
        available: true,
        recoveredPublicationId: null,
      },
      resumeCapability: {
        exactAssociationVerified: true,
        serviceSupportsResume: true,
      },
      updatedAtMs: 100,
    });
    const replayDurableResult = vi.fn(async () => ({
      publicationId: "recovered-signal-1",
      status: "completed" as const,
    }));
    const resumeControllerConversation = vi.fn();
    const retryAsNewExecution = vi.fn();
    const markEffectStarted = vi.fn(async () => undefined);

    const result = await executeExecutionRecovery({
      command: command("recover_result"),
      dependencies: {
        replayDurableResult,
        resumeControllerConversation,
        retryAsNewExecution,
      },
      markEffectStarted,
      projection,
    });

    expect(result.status).toBe("completed");
    expect(result.publicationId).toBe("recovered-signal-1");
    expect(replayDurableResult).toHaveBeenCalledOnce();
    expect(resumeControllerConversation).not.toHaveBeenCalled();
    expect(retryAsNewExecution).not.toHaveBeenCalled();
  });

  it("offers exact conversation resume only after owner, controller, conversation, and destination verification", () => {
    const projection = inspectExecutionRecovery({
      destination,
      explicitUserStop: false,
      freshExecutionCapability: { exactSourceWakeVerified: true },
      identity: { ...identity, resultRef: null },
      outcomeUnknown: false,
      retainedResult: {
        available: false,
        recoveredPublicationId: null,
      },
      resumeCapability: {
        exactAssociationVerified: true,
        serviceSupportsResume: true,
      },
      updatedAtMs: 100,
    });

    expect(projection.tier).toBe("exact_controller_conversation_resume");
    expect(projection.recommendedAction).toBe("resume_controller_conversation");
    expect(projection.actions.resumeControllerConversation.enabled).toBe(true);
    expect(projection.actions.retryAsNewExecution.enabled).toBe(false);
  });

  it.each(
    surfaceDestinations
  )("runs Tier 3 for $surface through one control-plane dependency with an explicit rerun warning and new identity", async (surfaceDestination) => {
    const projection = inspectExecutionRecovery({
      destination: surfaceDestination,
      explicitUserStop: false,
      freshExecutionCapability: { exactSourceWakeVerified: true },
      identity: {
        ...identity,
        agentControllerConversationId: null,
        resultRef: null,
      },
      outcomeUnknown: false,
      retainedResult: {
        available: false,
        recoveredPublicationId: null,
      },
      resumeCapability: {
        exactAssociationVerified: false,
        serviceSupportsResume: false,
      },
      updatedAtMs: 100,
    });
    const retryAsNewExecution = vi.fn(async () => ({
      newExecutionId: "client-message-new",
      status: "new_execution_requested" as const,
    }));
    const markEffectStarted = vi.fn(async () => undefined);

    const result = await executeExecutionRecovery({
      command: {
        ...command("retry_as_new_execution"),
        destination: surfaceDestination,
        expectedIdentity: {
          ...identity,
          agentControllerConversationId: null,
          resultRef: null,
        },
      },
      dependencies: {
        replayDurableResult: vi.fn(),
        resumeControllerConversation: vi.fn(),
        retryAsNewExecution,
      },
      markEffectStarted,
      projection,
    });

    expect(projection.actions.retryAsNewExecution.label).toBe(
      "Retry as new execution"
    );
    expect(projection.actions.retryAsNewExecution.warning).toContain(
      "run the task again"
    );
    expect(result.newExecutionId).toBe("client-message-new");
    expect(result.newExecutionId).not.toBe(identity.dispatchId);
    expect(retryAsNewExecution).toHaveBeenCalledOnce();
    expect(retryAsNewExecution).toHaveBeenCalledWith({
      command: expect.objectContaining({
        action: "retry_as_new_execution",
        destination: surfaceDestination,
      }),
      markEffectStarted,
      projection,
    });
  });

  it("retries a history-limited execution after automatic conversation rollover", () => {
    const recoveryInput = {
      destination,
      explicitUserStop: false,
      freshExecutionCapability: { exactSourceWakeVerified: true },
      identity: {
        ...identity,
        agentControllerConversationId: null,
        resultRef: null,
      },
      outcomeUnknown: false,
      retainedResult: {
        available: false,
        recoveredPublicationId: null,
      },
      resumeCapability: {
        exactAssociationVerified: false,
        serviceSupportsResume: false,
      },
      terminalFailureCode: "remote_agent.conversation_history_limit_exceeded",
      updatedAtMs: 100,
    };

    const projection = inspectExecutionRecovery(recoveryInput);

    expect(projection).toMatchObject({
      recommendedAction: "retry_as_new_execution",
      status: "available",
      tier: "fresh_execution",
    });
    expect(projection.actions.retryAsNewExecution).toMatchObject({
      enabled: true,
      reasonCode: "execution_recovery.fresh_execution_only",
    });
  });

  it("keeps outcome-unknown and explicit user-stop executions out of automatic recovery", () => {
    const outcomeUnknown = inspectExecutionRecovery({
      destination,
      explicitUserStop: false,
      freshExecutionCapability: { exactSourceWakeVerified: true },
      identity,
      outcomeUnknown: true,
      retainedResult: {
        available: true,
        recoveredPublicationId: null,
      },
      resumeCapability: {
        exactAssociationVerified: true,
        serviceSupportsResume: true,
      },
      updatedAtMs: 100,
    });
    const userStopped = inspectExecutionRecovery({
      destination,
      explicitUserStop: true,
      freshExecutionCapability: { exactSourceWakeVerified: true },
      identity,
      outcomeUnknown: false,
      retainedResult: {
        available: true,
        recoveredPublicationId: null,
      },
      resumeCapability: {
        exactAssociationVerified: true,
        serviceSupportsResume: true,
      },
      updatedAtMs: 100,
    });

    expect(outcomeUnknown.tier).toBe("manual_review");
    expect(outcomeUnknown.recommendedAction).toBeNull();
    expect(userStopped.tier).toBe("none");
    expect(userStopped.recommendedAction).toBeNull();
  });

  it("rejects identity or destination mismatch before publication, controller, or provider I/O", async () => {
    const projection = inspectExecutionRecovery({
      destination,
      explicitUserStop: false,
      freshExecutionCapability: { exactSourceWakeVerified: true },
      identity,
      outcomeUnknown: false,
      retainedResult: {
        available: true,
        recoveredPublicationId: null,
      },
      resumeCapability: {
        exactAssociationVerified: true,
        serviceSupportsResume: true,
      },
      updatedAtMs: 100,
    });
    const replayDurableResult = vi.fn();
    const resumeControllerConversation = vi.fn();
    const retryAsNewExecution = vi.fn();
    const markEffectStarted = vi.fn(async () => undefined);

    await expect(
      executeExecutionRecovery({
        command: {
          ...command("recover_result"),
          expectedIdentity: {
            ...identity,
            agentControllerConversationId: "other-conversation",
          },
        },
        dependencies: {
          replayDurableResult,
          resumeControllerConversation,
          retryAsNewExecution,
        },
        markEffectStarted,
        projection,
      })
    ).rejects.toThrow("execution_recovery.identity_mismatch");

    expect(replayDurableResult).not.toHaveBeenCalled();
    expect(resumeControllerConversation).not.toHaveBeenCalled();
    expect(retryAsNewExecution).not.toHaveBeenCalled();
  });
});
