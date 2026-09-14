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
    const markEffectStarted = vi.fn(async () => undefined);

    const result = await executeExecutionRecovery({
      command: command("recover_result"),
      dependencies: {
        replayDurableResult,
        resumeControllerConversation,
      },
      markEffectStarted,
      projection,
    });

    expect(result.status).toBe("completed");
    expect(result.publicationId).toBe("recovered-signal-1");
    expect(replayDurableResult).toHaveBeenCalledOnce();
    expect(resumeControllerConversation).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "remote_agent.empty_assistant_response",
  ])("offers verified conversation recovery for %s", (terminalFailureCode) => {
    const projection = inspectExecutionRecovery({
      destination,
      explicitUserStop: false,
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
      terminalFailureCode,
      replyRecoverySupported: true,
      updatedAtMs: 100,
    });

    expect(projection.tier).toBe("exact_controller_conversation_resume");
    expect(projection.recommendedAction).toBe("resume_controller_conversation");
    expect(projection.actions.resumeControllerConversation.enabled).toBe(true);
    expect(projection.actions.retryAsNewExecution.enabled).toBe(false);
  });

  it("does not turn an exhausted Wake outcome into authority for a new Wake", () => {
    const projection = inspectExecutionRecovery({
      destination,
      explicitUserStop: false,
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
      terminalFailureCode: "usage_exhausted",
      replyRecoverySupported: true,
      updatedAtMs: 100,
    });

    expect(projection).toMatchObject({
      recommendedAction: null,
      status: "unavailable",
      tier: "none",
    });
    expect(projection.actions.resumeControllerConversation.enabled).toBe(false);
    expect(projection.actions.retryAsNewExecution).toMatchObject({
      enabled: false,
      label: "Start a new Wake",
      reasonCode: "execution_recovery.new_wake_required",
    });
  });

  it.each(
    surfaceDestinations
  )("keeps a new Wake outside $surface outcome recovery", async (surfaceDestination) => {
    const projection = inspectExecutionRecovery({
      destination: surfaceDestination,
      explicitUserStop: false,
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
    const markEffectStarted = vi.fn(async () => undefined);

    const run = () =>
      executeExecutionRecovery({
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
        },
        markEffectStarted,
        projection,
      });

    expect(projection.actions.retryAsNewExecution.label).toBe(
      "Start a new Wake"
    );
    expect(projection.actions.retryAsNewExecution.enabled).toBe(false);
    await expect(run()).rejects.toThrow(
      "execution_recovery.action_unavailable:execution_recovery.new_wake_required"
    );
    expect(markEffectStarted).not.toHaveBeenCalled();
  });

  it("keeps a history-limited rerun as a separate new Wake", () => {
    const recoveryInput = {
      destination,
      explicitUserStop: false,
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
      recommendedAction: null,
      status: "unavailable",
      tier: "none",
    });
    expect(projection.actions.retryAsNewExecution).toMatchObject({
      enabled: false,
      reasonCode: "execution_recovery.new_wake_required",
    });
  });

  it("keeps outcome-unknown and explicit user-stop executions out of automatic recovery", () => {
    const outcomeUnknown = inspectExecutionRecovery({
      destination,
      explicitUserStop: false,
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
        },
        markEffectStarted,
        projection,
      })
    ).rejects.toThrow("execution_recovery.identity_mismatch");

    expect(replayDurableResult).not.toHaveBeenCalled();
    expect(resumeControllerConversation).not.toHaveBeenCalled();
  });
});
