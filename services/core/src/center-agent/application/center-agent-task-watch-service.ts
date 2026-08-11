import { buildAgentTaskKey } from "@openmeld/schemas";
import type {
  AgentTaskCompletionCondition,
  AgentTaskHandle,
  SubmitAgentControllerTaskLifecycleEventItem,
} from "@openmeld/schemas/types";
import { enqueueAgentTaskContinuationMessages } from "../../agent-task-coordination/application/agent-task-terminal-outcome-service";
import {
  AgentControllerTaskRegistrationMissingError,
  type AgentTaskCompletionSubscriptionRecord,
  registerAgentTaskCompletionSubscription,
} from "../../agent-task-coordination/infrastructure/d1/agent-task-coordination-repo";
import type { CoreBindings } from "../../lib/bindings";
import {
  CenterAgentDelegationPreparationError,
  requireCenterAgentContinuationParent,
} from "./center-agent-delegation-service";
import { shouldWriteDestinationNeutralTaskContinuations } from "./task-continuation-rollout";

export type PreparedCenterAgentTaskWatch = {
  completionCondition: AgentTaskCompletionCondition;
  controllerTaskRegistration?: {
    ownerUserId: string;
    registrationSource: SubmitAgentControllerTaskLifecycleEventItem["source"];
  };
  onBehalfOfProfileId: string;
  outcome: AgentTaskCompletionSubscriptionRecord["outcome"];
  status:
    | "condition_not_met"
    | "continuation_created"
    | "continuation_pending"
    | "watching";
  subscriptionId: string;
  task: AgentTaskHandle;
  watchId: string;
};

export async function prepareCenterAgentTaskWatch(input: {
  actorProfileId: string;
  completionCondition: AgentTaskCompletionCondition;
  controllerTaskRegistration?: {
    ownerUserId: string;
    registrationSource: SubmitAgentControllerTaskLifecycleEventItem["source"];
  };
  db: D1Database;
  env: CoreBindings;
  instruction: string;
  nowMs: number;
  organizationId: string;
  parentSubmissionId: string;
  task: AgentTaskHandle;
  watchId: string;
}): Promise<PreparedCenterAgentTaskWatch> {
  const destinationNeutralContinuations =
    shouldWriteDestinationNeutralTaskContinuations(input.env);
  const parentDelivery = await requireCenterAgentContinuationParent({
    actorProfileId: input.actorProfileId,
    destinationNeutralContinuations,
    db: input.db,
    organizationId: input.organizationId,
    parentSubmissionId: input.parentSubmissionId,
    resumesParent: true,
  });
  const onBehalfOfProfileId = parentDelivery.onBehalfOfProfileId;
  if (!onBehalfOfProfileId) {
    throw new CenterAgentDelegationPreparationError(
      "center_agent.delegation_requester_unavailable",
      "Task watch continuation requires a verified human requester."
    );
  }
  const observerTask: AgentTaskHandle = {
    deliveryId: parentDelivery.deliveryId,
    kind: "native_delivery",
    v: 1,
  };
  if (buildAgentTaskKey(observerTask) === buildAgentTaskKey(input.task)) {
    throw new CenterAgentDelegationPreparationError(
      "center_agent.task_watch_self_reference",
      "A task cannot watch its own completion."
    );
  }

  const subscriptionId = `sub:${input.watchId}`;
  let subscription: AgentTaskCompletionSubscriptionRecord;
  try {
    subscription = await registerAgentTaskCompletionSubscription({
      completionCondition: input.completionCondition,
      continuation: destinationNeutralContinuations
        ? {
            instruction: input.instruction,
            kind: "resume_task_watch",
            watchId: input.watchId,
          }
        : {
            instruction: input.instruction,
            kind: "resume_task_watch",
            sourceSignalId: parentDelivery.triggerMessageId,
            spaceId: parentDelivery.spaceId,
            threadContext: parentDelivery.threadContext,
            watchId: input.watchId,
          },
      ...(input.controllerTaskRegistration
        ? { controllerTaskRegistration: input.controllerTaskRegistration }
        : {}),
      db: input.db,
      idempotencyKey: `center-agent-task-watch:${input.watchId}`,
      nowMs: input.nowMs,
      observerTask,
      organizationId: input.organizationId,
      subscriptionId,
      watchedTask: input.task,
    });
  } catch (error) {
    if (!(error instanceof AgentControllerTaskRegistrationMissingError)) {
      throw error;
    }
    throw new CenterAgentDelegationPreparationError(
      "center_agent.task_watch_target_not_found",
      error.message
    );
  }
  if (
    subscription.state === "ready" ||
    subscription.state === "continuation_claimed"
  ) {
    try {
      await enqueueAgentTaskContinuationMessages({
        env: input.env,
        nowMs: input.nowMs,
        subscriptionIds: [subscription.subscriptionId],
      });
    } catch (error) {
      console.warn("[core.openmeld.agent_task.watch_enqueue_deferred]", {
        error: error instanceof Error ? error.message : String(error),
        subscriptionId: subscription.subscriptionId,
        watchId: input.watchId,
      });
    }
  }
  if (subscription.state === "cancelled") {
    throw new CenterAgentDelegationPreparationError(
      "center_agent.task_watch_parent_unavailable",
      "The active Center Agent task stopped before the watch was registered."
    );
  }
  let status: PreparedCenterAgentTaskWatch["status"] = "continuation_pending";
  if (subscription.state === "settled") {
    status = subscription.continuationTask
      ? "continuation_created"
      : "condition_not_met";
  } else if (subscription.state === "pending") {
    status = "watching";
  }
  return {
    completionCondition: input.completionCondition,
    onBehalfOfProfileId,
    outcome: subscription.outcome,
    status,
    subscriptionId: subscription.subscriptionId,
    task: input.task,
    watchId: input.watchId,
  };
}
