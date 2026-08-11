import type {
  AgentTaskHandle,
  AgentTaskTerminalOutcome,
  OpenMeldRequestContext,
  PostSpaceWakeStopResponse,
} from "@openmeld/schemas/types";
import { createAuthenticatedSpaceAccessContext } from "@openmeld/space";
import type { CoreBindings } from "../../lib/bindings";
import { requestRemoteAgentNativeDeliveryStop } from "../../remote-agent/application/native-delivery-cancellation-service";
import {
  readRemoteAgentNativeDeliveryByDeliveryId,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
} from "../../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { isRpcReceiverMethodNotImplementedErrorForMethod } from "../../rpc/errors";
import { resolveSpaceStub } from "../../rpc/space-ref";
import { RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE } from "../../runtime-transport/application/runtime-coordinator-authority";
import {
  listAgentTaskCompletionSubscriptionsNeedingEnqueue,
  recordAgentTaskTerminalOutcome,
  recordAgentTaskTerminalOutcomeIfMatching,
} from "../infrastructure/d1/agent-task-coordination-repo";

const POST_WAKE_STOP_RPC_METHOD_NAME = "rpcPostWakeStop";

type SpaceWakeStopRpcStub = {
  rpcPostWakeStop: (request: {
    body: {
      reason: string;
      target: {
        by: "client_message";
        clientMessageId: string;
        targetProfileId: string;
      };
    };
    spaceAccess: ReturnType<typeof createAuthenticatedSpaceAccessContext>;
    spaceId: string;
  }) => Promise<PostSpaceWakeStopResponse>;
};

export async function recordAndEnqueueAgentTaskTerminalOutcome(input: {
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
  outcome: AgentTaskTerminalOutcome;
  task: AgentTaskHandle;
}): Promise<void> {
  await recordAndEnqueueAgentTaskTerminalOutcomeWithStoredOutcome(input);
}

export async function recordAndEnqueueAgentTaskTerminalOutcomeWithStoredOutcome(input: {
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
  outcome: AgentTaskTerminalOutcome;
  task: AgentTaskHandle;
}): Promise<AgentTaskTerminalOutcome> {
  const recorded = await recordAgentTaskTerminalOutcome({
    db: input.db,
    nowMs: input.nowMs,
    outcome: input.outcome,
    task: input.task,
  });
  await propagateAndEnqueueRecordedAgentTaskTerminalOutcome({
    env: input.env,
    nowMs: input.nowMs,
    recorded,
    task: input.task,
    db: input.db,
  });
  return recorded.outcome;
}

export async function recordAndEnqueueAgentTaskTerminalOutcomeIfMatching(input: {
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
  outcome: AgentTaskTerminalOutcome;
  task: AgentTaskHandle;
}): Promise<{
  matches: boolean;
  storedOutcome: AgentTaskTerminalOutcome;
}> {
  const recorded = await recordAgentTaskTerminalOutcomeIfMatching({
    db: input.db,
    nowMs: input.nowMs,
    outcome: input.outcome,
    task: input.task,
  });
  if (!recorded.matches) {
    return { matches: false, storedOutcome: recorded.outcome };
  }
  await propagateAndEnqueueRecordedAgentTaskTerminalOutcome({
    db: input.db,
    env: input.env,
    nowMs: input.nowMs,
    recorded,
    task: input.task,
  });
  return { matches: true, storedOutcome: recorded.outcome };
}

async function propagateAndEnqueueRecordedAgentTaskTerminalOutcome(input: {
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
  recorded: Awaited<ReturnType<typeof recordAgentTaskTerminalOutcome>>;
  task: AgentTaskHandle;
}): Promise<void> {
  const propagationResults = await Promise.allSettled([
    propagateStoppedParentToChildren({
      childTasks: input.recorded.cancelledChildTasks,
      db: input.db,
      env: input.env,
      parentTask: input.task,
    }),
    propagateStoppedParentToContinuations({
      continuationIdempotencyKeys:
        input.recorded.cancelledContinuationIdempotencyKeys,
      db: input.db,
      env: input.env,
      nowMs: input.nowMs,
    }),
  ]);
  const propagationErrors = propagationResults.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
  if (propagationErrors.length > 0) {
    throw new AggregateError(
      propagationErrors,
      buildPropagationErrorMessage(
        "agent_task_parent_stop.propagation_failed",
        propagationErrors
      )
    );
  }
  try {
    await enqueueAgentTaskContinuationMessages({
      env: input.env,
      nowMs: input.nowMs,
      subscriptionIds: input.recorded.newlyReadySubscriptionIds,
    });
  } catch (error) {
    console.warn("[core.openmeld.agent_task.continuation_enqueue_deferred]", {
      error: error instanceof Error ? error.message : String(error),
      subscriptionCount: input.recorded.newlyReadySubscriptionIds.length,
    });
  }
}

async function propagateStoppedParentToContinuations(input: {
  continuationIdempotencyKeys: string[];
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
}): Promise<void> {
  const errors: unknown[] = [];
  for (const idempotencyKey of input.continuationIdempotencyKeys) {
    try {
      const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: input.db,
        idempotencyKey,
      });
      if (!delivery) {
        continue;
      }
      const stopOutcome = await requestRemoteAgentNativeDeliveryStop({
        db: input.db,
        delivery,
        env: input.env,
        nowMs: input.nowMs,
      });
      if (stopOutcome === "stop_requested") {
        throw new Error("remote_agent.parent_stop_cancellation_pending");
      }
      if (stopOutcome === "not_stoppable") {
        throw new Error("remote_agent.parent_stop_cancellation_not_confirmed");
      }
      await recordAndEnqueueAgentTaskTerminalOutcome({
        db: input.db,
        env: input.env,
        nowMs: input.nowMs,
        outcome: {
          errorCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
          eventId: `agent-task-parent-stop:${delivery.deliveryId}`,
          occurredAtMs: input.nowMs,
          publishedSignalId: null,
          status: "stopped",
        },
        task: {
          deliveryId: delivery.deliveryId,
          kind: "native_delivery",
          v: 1,
        },
      });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      buildPropagationErrorMessage(
        "agent_task_parent_stop.continuation_propagation_failed",
        errors
      )
    );
  }
}

async function propagateStoppedParentToChildren(input: {
  childTasks: AgentTaskHandle[];
  db: D1Database;
  env: CoreBindings;
  parentTask: AgentTaskHandle;
}): Promise<void> {
  if (input.childTasks.length === 0) {
    return;
  }
  if (input.parentTask.kind !== "native_delivery") {
    throw new Error("agent_task_parent_stop.unsupported_parent_task");
  }
  const observerDelivery = await readRemoteAgentNativeDeliveryByDeliveryId({
    db: input.db,
    deliveryId: input.parentTask.deliveryId,
  });
  if (!observerDelivery) {
    throw new Error("agent_task_parent_stop.observer_delivery_missing");
  }
  const context: OpenMeldRequestContext = {
    activeOrganizationId: observerDelivery.organizationId,
    actorContext: {
      requestId: `agent-task-parent-stop:${observerDelivery.deliveryId}`,
      openMeldProfileId: observerDelivery.profileId,
      profileKind: "agent",
      profileName: "Center Agent",
    },
    ...(observerDelivery.submissionId
      ? { agentControllerConversationId: observerDelivery.submissionId }
      : {}),
  };
  const errors: unknown[] = [];
  for (const childTask of input.childTasks) {
    try {
      if (childTask.kind !== "space_wake") {
        throw new Error("agent_task_parent_stop.unsupported_child_task");
      }
      const stub = resolveSpaceStub(
        input.env.OPENMELD_SPACES,
        childTask.spaceId
      ) as SpaceWakeStopRpcStub | null;
      if (!stub) {
        throw new Error("agent_task_parent_stop.space_unavailable");
      }
      const response = await postParentStopToSpaceWake({
        childTask,
        context,
        stub,
      });
      if (response.status === "cancellation_requested") {
        throw new Error("agent_task_parent_stop.cancellation_requested");
      }
      const alreadyTerminal =
        response.status === "not_stoppable" &&
        (response.reasonCode ===
          "runtime_coordinator.wake_stop_execution_terminal" ||
          response.reasonCode === "remote_agent.execution_terminal");
      if (
        response.status === "not_found" ||
        response.status === "retry_later" ||
        response.status === "unsupported" ||
        (response.status === "not_stoppable" && !alreadyTerminal)
      ) {
        throw new Error(
          `agent_task_parent_stop.${response.status}:${response.reasonCode}`
        );
      }
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      buildPropagationErrorMessage(
        "agent_task_parent_stop.child_propagation_failed",
        errors
      )
    );
  }
}

async function postParentStopToSpaceWake(input: {
  childTask: Extract<AgentTaskHandle, { kind: "space_wake" }>;
  context: OpenMeldRequestContext;
  stub: SpaceWakeStopRpcStub;
}): Promise<PostSpaceWakeStopResponse> {
  try {
    return await input.stub.rpcPostWakeStop({
      body: {
        reason: "Parent task was stopped.",
        target: {
          by: "client_message",
          clientMessageId: input.childTask.sourceClientMessageId,
          targetProfileId: input.childTask.targetProfileId,
        },
      },
      spaceAccess: createAuthenticatedSpaceAccessContext({
        requestContext: input.context,
        spaceId: input.childTask.spaceId,
      }),
      spaceId: input.childTask.spaceId,
    });
  } catch (error) {
    if (
      isRpcReceiverMethodNotImplementedErrorForMethod(
        error,
        POST_WAKE_STOP_RPC_METHOD_NAME
      )
    ) {
      throw new Error("agent_task_parent_stop.space_unavailable");
    }
    throw error;
  }
}

function buildPropagationErrorMessage(code: string, errors: unknown[]): string {
  const details = errors
    .map((error) => (error instanceof Error ? error.message : String(error)))
    .join("; ");
  return details ? `${code}: ${details}` : code;
}

export async function enqueueAgentTaskContinuationMessages(input: {
  env: CoreBindings;
  nowMs: number;
  subscriptionIds: string[];
}): Promise<void> {
  if (input.subscriptionIds.length === 0) {
    return;
  }
  const queue = input.env.OPENMELD_DAEMON_DISPATCH_QUEUE;
  if (!queue) {
    throw new Error("agent_task_continuation.queue_unavailable");
  }
  await Promise.all(
    input.subscriptionIds.map((subscriptionId) =>
      queue.send({
        enqueuedAtMs: input.nowMs,
        idempotencyKey: `agent-task-continuation-event:${subscriptionId}`,
        kind: "agent_task_continuation",
        subscriptionId,
        v: 4,
      })
    )
  );
}

export async function retryReadyAgentTaskContinuations(input: {
  db: D1Database;
  env: CoreBindings;
  limit?: number;
  nowMs: number;
}): Promise<{ enqueuedCount: number }> {
  const subscriptionIds =
    await listAgentTaskCompletionSubscriptionsNeedingEnqueue({
      db: input.db,
      limit: input.limit ?? 500,
      nowMs: input.nowMs,
    });
  await enqueueAgentTaskContinuationMessages({
    env: input.env,
    nowMs: input.nowMs,
    subscriptionIds,
  });
  return { enqueuedCount: subscriptionIds.length };
}
