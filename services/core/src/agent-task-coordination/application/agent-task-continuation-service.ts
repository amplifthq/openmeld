import type {
  AgentDelegationSnapshot,
  AgentTaskCompletionObservation,
  AgentTaskContinuationQueueMessage,
  AgentTaskHandle,
  AgentTaskTerminalOutcome,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import {
  activateCenterAgentFallbackSpaceWake,
  RemoteAgentTaskContinuationTerminalError,
  submitRemoteAgentTaskContinuationDelivery,
} from "../../remote-agent/application/native-delivery-service";
import { readRemoteAgentNativeDeliveryByDeliveryId } from "../../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  type AgentDelegationRecord,
  activateFallbackAgentDelegationChild,
  readAgentDelegation,
} from "../infrastructure/d1/agent-delegation-repo";
import {
  type AgentTaskCompletionSubscriptionRecord,
  cancelAgentTaskCompletionSubscription,
  claimReadyAgentTaskCompletionSubscription,
  isClaimedAgentTaskContinuationAuthorized,
  isClaimedAgentTaskWatchContinuationAuthorized,
  readAgentTaskCompletionSubscription,
  releaseAgentTaskCompletionSubscriptionClaim,
  settleAgentTaskCompletionSubscription,
} from "../infrastructure/d1/agent-task-coordination-repo";

const AGENT_TASK_CONTINUATION_CLAIM_LEASE_MS = 60_000;

export async function processAgentTaskContinuationQueueMessage(input: {
  db: D1Database;
  env: CoreBindings;
  message: AgentTaskContinuationQueueMessage;
  nowMs: number;
}): Promise<
  | { status: "completed"; task: AgentTaskHandle | null }
  | { retryAfterSeconds: number; status: "retry_later" }
> {
  const current = await readAgentTaskCompletionSubscription({
    db: input.db,
    subscriptionId: input.message.subscriptionId,
  });
  if (
    !current ||
    current.state === "settled" ||
    current.state === "cancelled"
  ) {
    return { status: "completed", task: current?.continuationTask ?? null };
  }
  if (
    current.state === "continuation_claimed" &&
    current.claimExpiresAtMs !== null &&
    current.claimExpiresAtMs > input.nowMs
  ) {
    return {
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((current.claimExpiresAtMs - input.nowMs) / 1000)
      ),
      status: "retry_later",
    };
  }
  if (
    current.observerTask.kind === "native_delivery" &&
    (await isRoutineObserverStillRunning({
      db: input.db,
      deliveryId: current.observerTask.deliveryId,
    }))
  ) {
    return { retryAfterSeconds: 5, status: "retry_later" };
  }

  const claimId = crypto.randomUUID();
  const claimed = await claimReadyAgentTaskCompletionSubscription({
    claimId,
    claimLeaseMs: AGENT_TASK_CONTINUATION_CLAIM_LEASE_MS,
    db: input.db,
    nowMs: input.nowMs,
    subscriptionId: input.message.subscriptionId,
  });
  if (!claimed) {
    return { retryAfterSeconds: 5, status: "retry_later" };
  }
  try {
    const continuationTask = await executeClaimedAgentTaskContinuation({
      claimId,
      claimed,
      db: input.db,
      env: input.env,
      nowMs: input.nowMs,
    });
    return { status: "completed", task: continuationTask };
  } catch (error) {
    if (error instanceof RemoteAgentTaskContinuationTerminalError) {
      const cancelled = await cancelAgentTaskCompletionSubscription({
        db: input.db,
        nowMs: input.nowMs,
        subscriptionId: claimed.subscriptionId,
      });
      if (cancelled?.state !== "cancelled") {
        throw new Error(
          "agent_task_continuation.terminal_cancellation_failed",
          { cause: error }
        );
      }
      console.warn("[core.agent_task_continuation.terminal_failure]", {
        reasonCode: error.reasonCode,
        subscriptionId: claimed.subscriptionId,
      });
      return { status: "completed", task: null };
    }
    await releaseAgentTaskCompletionSubscriptionClaim({
      claimId,
      db: input.db,
      nowMs: Date.now(),
      subscriptionId: claimed.subscriptionId,
    });
    throw error;
  }
}

async function isRoutineObserverStillRunning(input: {
  db: D1Database;
  deliveryId: string;
}): Promise<boolean> {
  const observer = await readRemoteAgentNativeDeliveryByDeliveryId(input);
  return (
    observer?.routineRunId !== null &&
    (observer?.status === "accepted" || observer?.status === "retry_observed")
  );
}

async function executeClaimedAgentTaskContinuation(input: {
  claimId: string;
  claimed: AgentTaskCompletionSubscriptionRecord;
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
}): Promise<AgentTaskHandle | null> {
  const { claimed } = input;
  if (
    !(
      claimed.continuation &&
      claimed.continuationIdempotencyKey &&
      claimed.outcome
    ) ||
    claimed.observerTask.kind !== "native_delivery"
  ) {
    throw new Error("agent_task_continuation.subscription_contract_invalid");
  }
  const observerDelivery = await readRemoteAgentNativeDeliveryByDeliveryId({
    db: input.db,
    deliveryId: claimed.observerTask.deliveryId,
  });
  if (!observerDelivery) {
    throw new Error("agent_task_continuation.observer_delivery_missing");
  }
  if (claimed.continuation.kind === "resume_task_watch") {
    const continuation = claimed.continuation;
    const isAuthorized = () =>
      isClaimedAgentTaskWatchContinuationAuthorized({
        claimId: input.claimId,
        db: input.db,
        subscriptionId: claimed.subscriptionId,
        watchId: continuation.watchId,
      });
    if (!(await isAuthorized())) {
      await cancelAgentTaskCompletionSubscription({
        db: input.db,
        nowMs: input.nowMs,
        subscriptionId: claimed.subscriptionId,
      });
      return null;
    }
    const continuationTask = await executeTaskWatchResume({
      claimed,
      continuation,
      db: input.db,
      env: input.env,
      idempotencyKey: claimed.continuationIdempotencyKey,
      isAuthorized,
      nowMs: input.nowMs,
      observerDelivery,
      outcome: claimed.outcome,
    });
    return await settleClaimedAgentTaskContinuation({
      claimId: input.claimId,
      continuationTask,
      db: input.db,
      nowMs: input.nowMs,
      subscriptionId: claimed.subscriptionId,
    });
  }
  if (claimed.outcome.status === "needs_attention") {
    throw new Error(
      "agent_task_continuation.delegation_attention_outcome_invalid"
    );
  }
  const delegation = await readAgentDelegation({
    db: input.db,
    delegationId: claimed.continuation.delegationId,
  });
  if (!delegation || delegation.organizationId !== claimed.organizationId) {
    throw new Error("agent_task_continuation.delegation_missing");
  }
  const isAuthorized = () =>
    isClaimedAgentTaskContinuationAuthorized({
      claimId: input.claimId,
      db: input.db,
      delegationId: delegation.delegationId,
      expectedGeneration: delegation.generation,
      subscriptionId: claimed.subscriptionId,
    });
  if (!(await isAuthorized())) {
    await cancelAgentTaskCompletionSubscription({
      db: input.db,
      nowMs: input.nowMs,
      subscriptionId: claimed.subscriptionId,
    });
    return null;
  }

  const continuationTask =
    claimed.continuation.kind === "activate_fallback"
      ? await executeFallbackActivation({
          claimed,
          continuation: claimed.continuation,
          db: input.db,
          delegation,
          env: input.env,
          isAuthorized,
          nowMs: input.nowMs,
          observerDelivery,
        })
      : await executeParentResume({
          claimed,
          continuation: claimed.continuation,
          db: input.db,
          delegation,
          env: input.env,
          idempotencyKey: claimed.continuationIdempotencyKey,
          isAuthorized,
          nowMs: input.nowMs,
          observerDelivery,
          outcome: claimed.outcome,
        });
  return await settleClaimedAgentTaskContinuation({
    claimId: input.claimId,
    continuationTask,
    db: input.db,
    nowMs: input.nowMs,
    subscriptionId: claimed.subscriptionId,
  });
}

async function settleClaimedAgentTaskContinuation(input: {
  claimId: string;
  continuationTask: AgentTaskHandle | null;
  db: D1Database;
  nowMs: number;
  subscriptionId: string;
}): Promise<AgentTaskHandle | null> {
  if (!input.continuationTask) {
    return null;
  }
  const settled = await settleAgentTaskCompletionSubscription({
    claimId: input.claimId,
    continuationTask: input.continuationTask,
    db: input.db,
    nowMs: input.nowMs,
    subscriptionId: input.subscriptionId,
  });
  if (!settled) {
    throw new Error("agent_task_continuation.settlement_failed");
  }
  return input.continuationTask;
}

type ObserverDelivery = NonNullable<
  Awaited<ReturnType<typeof readRemoteAgentNativeDeliveryByDeliveryId>>
>;

async function executeFallbackActivation(input: {
  claimed: AgentTaskCompletionSubscriptionRecord;
  continuation: Extract<
    NonNullable<AgentTaskCompletionSubscriptionRecord["continuation"]>,
    { kind: "activate_fallback" }
  >;
  db: D1Database;
  delegation: AgentDelegationRecord;
  env: CoreBindings;
  isAuthorized: () => Promise<boolean>;
  nowMs: number;
  observerDelivery: ObserverDelivery;
}): Promise<AgentTaskHandle | null> {
  const fallbackChild = input.delegation.children.find(
    (child) =>
      child.role === "fallback" &&
      child.agentProfileId === input.continuation.agentProfileId &&
      child.task.kind === "space_wake" &&
      child.task.spaceId === input.continuation.spaceId
  );
  if (!fallbackChild || fallbackChild.task.kind !== "space_wake") {
    throw new Error("agent_task_continuation.fallback_task_contract_invalid");
  }
  const activated = await activateFallbackAgentDelegationChild({
    db: input.db,
    delegationId: input.delegation.delegationId,
    nowMs: input.nowMs,
    task: fallbackChild.task,
  });
  const activatedChild = activated?.children.find(
    (child) =>
      child.role === "fallback" &&
      child.agentProfileId === fallbackChild.agentProfileId
  );
  if (activated?.state !== "active" || activatedChild?.state !== "active") {
    await cancelAgentTaskCompletionSubscription({
      db: input.db,
      nowMs: input.nowMs,
      subscriptionId: input.claimed.subscriptionId,
    });
    return null;
  }
  const created = await activateCenterAgentFallbackSpaceWake({
    db: input.db,
    env: input.env,
    isAuthorized: input.isAuthorized,
    observerDelivery: input.observerDelivery,
    task: fallbackChild.task,
    text: input.continuation.text,
  });
  return created.task;
}

async function executeParentResume(input: {
  claimed: AgentTaskCompletionSubscriptionRecord;
  continuation: Extract<
    NonNullable<AgentTaskCompletionSubscriptionRecord["continuation"]>,
    { kind: "resume_agent" }
  >;
  db: D1Database;
  delegation: AgentDelegationRecord;
  env: CoreBindings;
  idempotencyKey: string;
  isAuthorized: () => Promise<boolean>;
  nowMs: number;
  observerDelivery: ObserverDelivery;
  outcome: AgentTaskTerminalOutcome;
}): Promise<AgentTaskHandle | null> {
  const delegationSnapshot: AgentDelegationSnapshot = {
    barrier:
      input.delegation.completionPolicy.mode === "resume_parent"
        ? input.delegation.completionPolicy.when
        : null,
    children: input.delegation.children.map((child) => ({
      agentProfileId: child.agentProfileId,
      role: child.role,
      state: child.state,
      task: child.task,
      terminalOutcome: child.terminalOutcome,
    })),
    delegationId: input.delegation.delegationId,
    generation: input.delegation.generation,
  };
  const created = await submitRemoteAgentTaskContinuationDelivery({
    db: input.db,
    delegation: delegationSnapshot,
    delegationId: input.continuation.delegationId,
    env: input.env,
    idempotencyKey: input.idempotencyKey,
    instruction: input.continuation.instruction,
    isAuthorized: input.isAuthorized,
    nowMs: input.nowMs,
    observerDelivery: input.observerDelivery,
    outcome: input.outcome,
    subscriptionId: input.claimed.subscriptionId,
    watchedTask: input.claimed.watchedTask,
  });
  return created.task;
}

async function executeTaskWatchResume(input: {
  claimed: AgentTaskCompletionSubscriptionRecord;
  continuation: Extract<
    NonNullable<AgentTaskCompletionSubscriptionRecord["continuation"]>,
    { kind: "resume_task_watch" }
  >;
  db: D1Database;
  env: CoreBindings;
  idempotencyKey: string;
  isAuthorized: () => Promise<boolean>;
  nowMs: number;
  observerDelivery: ObserverDelivery;
  outcome: AgentTaskCompletionObservation;
}): Promise<AgentTaskHandle | null> {
  const created = await submitRemoteAgentTaskContinuationDelivery({
    db: input.db,
    env: input.env,
    idempotencyKey: input.idempotencyKey,
    instruction: input.continuation.instruction,
    isAuthorized: input.isAuthorized,
    nowMs: input.nowMs,
    observerDelivery: input.observerDelivery,
    outcome: input.outcome,
    subscriptionId: input.claimed.subscriptionId,
    watchedTask: input.claimed.watchedTask,
    watchId: input.continuation.watchId,
  });
  return created.task;
}
